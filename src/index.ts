#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig } from "./lib/config.js";
import { getLogger, setLogLevel } from "./lib/logger.js";
import { runAddressIntelligence } from "./address-intelligence.js";
import { runHexApiAudit } from "./hex-api-audit.js";
import {
  runDelegationService,
  type DelegationOptions,
} from "./delegation-service.js";
import { runTxForensics } from "./tx-forensics.js";
import { runFeeAudit } from "./fee-audit.js";
import { runFeasibilityReport } from "./feasibility-report.js";
import type { SuiteRunContext, TronNetwork } from "./lib/types.js";

const program = new Command();

program
  .name("tron-energy-bypass-suite")
  .description(
    "Test whether external TRON Energy delegation bypasses Hex Trust TRX burn",
  )
  .option("--dry-run", "Simulate delegation without broadcasting", false)
  .option("--network <network>", "mainnet or nile", "mainnet")
  .option("--verbose", "Enable debug logging", false)
  .option("--output-dir <dir>", "Report output directory", "reports");

function buildContext(opts: {
  dryRun?: boolean;
  network?: string;
  verbose?: boolean;
  outputDir?: string;
}): SuiteRunContext {
  loadConfig({
    network: (opts.network as TronNetwork) ?? "mainnet",
  });
  setLogLevel(Boolean(opts.verbose));
  return {
    dryRun: Boolean(opts.dryRun),
    network: (opts.network as TronNetwork) ?? "mainnet",
    outputDir: opts.outputDir ?? "reports",
    verbose: Boolean(opts.verbose),
  };
}

program
  .command("address-intelligence")
  .description("Analyze Hex-associated addresses (90-day history)")
  .action(async () => {
    const opts = program.opts();
    const ctx = buildContext(opts);
    await runAddressIntelligence(ctx);
  });

program
  .command("hex-audit")
  .description("Probe Hex Trust API for fee/resource parameters")
  .action(async () => {
    const opts = program.opts();
    const ctx = buildContext(opts);
    await runHexApiAudit(ctx);
  });

program
  .command("delegate")
  .description("Run independent Energy delegation side-car")
  .requiredOption(
    "--strategy <strategy>",
    "always-on | jit | omnibus",
  )
  .option("--jit-address <addr>", "Sender address for JIT strategy")
  .option("--lock", "Use 3-day locked delegation", false)
  .option("--lock-period <blocks>", "Lock period in blocks", "0")
  .option(
    "--allow-mainnet-delegation",
    "Allow delegation on mainnet (default: Nile only)",
    false,
  )
  .option("--retire-address <addr>", "Undelegate Energy from retired address")
  .action(async (cmdOpts) => {
    const opts = program.opts();
    const ctx = buildContext({ ...opts, network: opts.network ?? "nile" });

    const delegationOpts: DelegationOptions = {
      strategy: cmdOpts.strategy as DelegationOptions["strategy"],
      dryRun: Boolean(opts.dryRun),
      lock: Boolean(cmdOpts.lock),
      lockPeriod: Number(cmdOpts.lockPeriod),
      allowMainnetDelegation: Boolean(cmdOpts.allowMainnetDelegation),
      jitAddress: cmdOpts.jitAddress,
      retireAddress: cmdOpts.retireAddress,
    };

    await runDelegationService(ctx, delegationOpts);
  });

program
  .command("forensics")
  .description("Analyze on-chain transaction receipt and raw tx")
  .requiredOption("--tx <hash>", "Transaction ID from Hex withdrawal")
  .option("--known-delegation", "Energy was delegated before this tx", false)
  .action(async (cmdOpts) => {
    const opts = program.opts();
    const ctx = buildContext(opts);
    const { report } = await runTxForensics(ctx, cmdOpts.tx, {
      knownDelegation: Boolean(cmdOpts.knownDelegation),
    });
    getLogger().info(
      { verdict: report.verdict, reason: report.verdictReason },
      "Forensics verdict",
    );
  });

program
  .command("fee-audit")
  .description("Compare Hex quoted fee vs on-chain burn")
  .option("--tx <hash>", "Transaction ID (runs forensics if needed)")
  .option("--hex-quote <trx>", "Hex quoted fee in TRX")
  .action(async (cmdOpts) => {
    const opts = program.opts();
    const ctx = buildContext(opts);
    await runFeeAudit(ctx, {
      txId: cmdOpts.tx,
      hexQuoteTrx: cmdOpts.hexQuote ? Number(cmdOpts.hexQuote) : undefined,
    });
  });

program
  .command("feasibility")
  .description("Synthesize verdict report with risk matrix and break-even")
  .action(async () => {
    const opts = program.opts();
    const ctx = buildContext(opts);
    const { report, mdPath } = await runFeasibilityReport(ctx);
    console.log(`\nVerdict: ${report.executiveVerdict}`);
    console.log(`Report: ${mdPath}\n`);
  });

program
  .command("all")
  .description("Run full test suite (modules 1-6)")
  .option("--tx <hash>", "Optional Hex tx hash for forensics/fee-audit")
  .option("--hex-quote <trx>", "Optional Hex quoted fee in TRX")
  .action(async (cmdOpts) => {
    const opts = program.opts();
    const mainnetCtx = buildContext({ ...opts, network: "mainnet" });
    const nileCtx = buildContext({
      ...opts,
      network: "nile",
      dryRun: opts.dryRun ?? true,
    });

    const log = getLogger();
    log.info("Running full TRON Energy Bypass test suite");

    const config = loadConfig({ network: "mainnet" });
    if (config.targetAddresses.length > 0) {
      await runAddressIntelligence(mainnetCtx);
    } else {
      log.warn("Skipping address-intelligence — TARGET_ADDRESSES not set");
    }

    await runHexApiAudit(mainnetCtx);

    if (process.env.SPONSOR_WALLET_PRIVATE_KEY) {
      await runDelegationService(nileCtx, {
        strategy: "always-on",
        dryRun: Boolean(opts.dryRun ?? true),
        lock: false,
        lockPeriod: 0,
        allowMainnetDelegation: false,
      });
    } else {
      log.warn("Skipping delegation — SPONSOR_WALLET_PRIVATE_KEY not set");
    }

    if (cmdOpts.tx) {
      await runTxForensics(mainnetCtx, cmdOpts.tx);
      await runFeeAudit(mainnetCtx, {
        txId: cmdOpts.tx,
        hexQuoteTrx: cmdOpts.hexQuote ? Number(cmdOpts.hexQuote) : undefined,
      });
    } else {
      log.warn(
        "Skipping forensics/fee-audit — provide --tx <hash> for full verdict",
      );
    }

    const { report, mdPath } = await runFeasibilityReport(mainnetCtx);
    console.log(`\n=== VERDICT: ${report.executiveVerdict} ===`);
    console.log(report.verdictSummary);
    console.log(`\nFull report: ${mdPath}\n`);
  });

program.parseAsync(process.argv).catch((err) => {
  getLogger().error(err, "Fatal error");
  process.exit(1);
});
