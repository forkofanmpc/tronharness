import { getConfig } from "./lib/config.js";
import { BANDWIDTH_BURN_TRX } from "./lib/constants.js";
import { classifyBillingModel, calculateBreakEven } from "./lib/break-even.js";
import { getLogger } from "./lib/logger.js";
import { loadLatestModuleReport, writeJsonReport } from "./lib/report.js";
import { runTxForensics } from "./tx-forensics.js";
import type { FeeAuditReport, SuiteRunContext, TxForensicsReport } from "./lib/types.js";

export interface FeeAuditOptions {
  txId?: string;
  hexQuoteTrx?: number;
}

export async function runFeeAudit(
  ctx: SuiteRunContext,
  options: FeeAuditOptions = {},
): Promise<{ report: FeeAuditReport; filepath: string }> {
  const config = getConfig();
  const log = getLogger();

  let forensics: TxForensicsReport | null = null;

  if (options.txId) {
    const result = await runTxForensics(ctx, options.txId);
    forensics = result.report;
  } else {
    forensics = await loadLatestModuleReport<TxForensicsReport>(
      ctx.outputDir,
      "tx-forensics",
    );
  }

  const hexQuotedFeeTrx =
    options.hexQuoteTrx ?? config.HEX_QUOTED_FEE_TRX ?? null;
  const onChainBurnTrx = forensics?.receipt.totalFeeTrx ?? null;
  const theoreticalMinimumTrx = BANDWIDTH_BURN_TRX;

  const billingModel = classifyBillingModel(hexQuotedFeeTrx, onChainBurnTrx);

  const breakEven = onChainBurnTrx
    ? calculateBreakEven({
        onChainBurnTrx,
        monthlyTxVolume: config.MONTHLY_TX_VOLUME,
      })
    : null;

  const notes: string[] = [];
  if (!forensics) {
    notes.push(
      "No forensics data available. Run forensics --tx <hash> or provide --tx to fee-audit.",
    );
  }
  if (billingModel === "marked_up") {
    notes.push(
      "Hex quoted fee exceeds on-chain burn — potential markup if Energy reduces on-chain cost.",
    );
  }
  if (billingModel === "flat_estimate") {
    notes.push(
      "Hex quote differs from on-chain burn — may use static estimate regardless of Energy.",
    );
  }

  const report: FeeAuditReport = {
    module: "fee-audit",
    generatedAt: new Date().toISOString(),
    txId: forensics?.txId ?? options.txId ?? null,
    hexQuotedFeeTrx,
    onChainBurnTrx,
    theoreticalMinimumTrx,
    billingModel,
    trxSavedPerTx: breakEven?.trxSavedPerTx ?? null,
    annualSavingsTrx: breakEven?.annualSavingsTrx ?? null,
    monthlyTxVolume: config.MONTHLY_TX_VOLUME,
    notes,
  };

  const filepath = await writeJsonReport(ctx.outputDir, report);
  log.info({ filepath, billingModel }, "Fee audit complete");
  return { report, filepath };
}
