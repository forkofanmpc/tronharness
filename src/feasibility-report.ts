import { getConfig } from "./lib/config.js";
import { calculateBreakEven } from "./lib/break-even.js";
import { getLogger } from "./lib/logger.js";
import {
  loadLatestModuleReport,
  writeJsonReport,
  writeMarkdownReport,
} from "./lib/report.js";
import { synthesizeExecutiveVerdict } from "./lib/verdict.js";
import type {
  AddressIntelligenceReport,
  DelegationServiceReport,
  FeeAuditReport,
  FeasibilityReport,
  RiskItem,
  SuiteRunContext,
  TxForensicsReport,
  Verdict,
} from "./lib/types.js";

function buildRiskMatrix(
  addressReport: AddressIntelligenceReport | null,
  forensics: TxForensicsReport | null,
): RiskItem[] {
  const rotation = addressReport?.summary.rotationPattern ?? "unknown";
  const jit = addressReport?.summary.jitFeasibility ?? "low";

  return [
    {
      scenario: "Hex rotates addresses and we cannot predict them",
      likelihood: rotation === "rotating" ? "high" : "medium",
      impact: "high",
      mitigation:
        "Run address-intelligence quarterly; negotiate fixed sender pool with Hex.",
    },
    {
      scenario: "Hex API does not expose sender address until after signing",
      likelihood: "medium",
      impact: "high",
      mitigation:
        "Enable hex-api-audit when credentials arrive; use webhook JIT if available.",
    },
    {
      scenario: "Delegation window expires before Hex initiates tx",
      likelihood: jit === "low" ? "high" : "medium",
      impact: "medium",
      mitigation:
        "Use always-on strategy for fixed addresses; maintain Energy buffer above threshold.",
    },
    {
      scenario: "TRON protocol changes resource model (Stake 2.0 updates)",
      likelihood: "low",
      impact: "high",
      mitigation:
        "Monitor TRON release notes; pin TronWeb version; regression test on Nile.",
    },
    {
      scenario: "Hex explicitly sets tx parameters to disable Energy consumption",
      likelihood:
        forensics?.verdict === "REAL_LIMITATION" ? "high" : "medium",
      impact: "high",
      mitigation:
        "Inspect raw tx fee_limit and contract fields; escalate with forensics evidence.",
    },
  ];
}

function formatVerdictLabel(verdict: Verdict): string {
  switch (verdict) {
    case "BYPASSABLE":
      return "BYPASSABLE — Build the side car";
    case "REAL_LIMITATION":
      return "REAL LIMITATION — Hex's signing engine overrides protocol";
    case "OMNIBUS_BLOCKER":
      return "OMNIBUS BLOCKER — Address rotation makes this operationally impossible";
    case "PARTIAL":
      return "PARTIAL — Works for fixed addresses, not for rotating";
    default:
      return `INCONCLUSIVE — ${verdict}`;
  }
}

function buildMarkdown(report: FeasibilityReport): string {
  const lines: string[] = [
    "# TRON Energy Bypass — Verdict Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Executive Verdict",
    "",
    `**${formatVerdictLabel(report.executiveVerdict)}**`,
    "",
    report.verdictSummary,
    "",
    `**Recommended action:** ${report.recommendedAction}`,
    "",
    "## Evidence",
    "",
    "| Source | Key | Value |",
    "|--------|-----|-------|",
  ];

  for (const row of report.evidenceTable) {
    lines.push(`| ${row.source} | ${row.key} | ${row.value} |`);
  }

  lines.push("", "## Risk Matrix", "");
  lines.push("| Scenario | Likelihood | Impact | Mitigation |");
  lines.push("|----------|------------|--------|------------|");

  for (const risk of report.riskMatrix) {
    lines.push(
      `| ${risk.scenario} | ${risk.likelihood} | ${risk.impact} | ${risk.mitigation} |`,
    );
  }

  lines.push("", "## Cost Analysis", "");
  const b = report.breakEven;
  lines.push(`- TRX saved per tx: ${b.trxSavedPerTx ?? "N/A"}`);
  lines.push(`- Monthly savings: ${b.monthlySavingsTrx ?? "N/A"} TRX`);
  lines.push(`- Annual savings: ${b.annualSavingsTrx ?? "N/A"} TRX`);
  lines.push(`- Staking capital: ${b.stakingCapitalTrx ?? "N/A"} TRX`);
  lines.push(`- Break-even months: ${b.breakEvenMonths ?? "N/A"}`);
  lines.push(
    `- Engineering maintenance: ~${report.engineeringCostPersonDaysPerMonth} person-days/month`,
  );

  return lines.join("\n");
}

export async function runFeasibilityReport(
  ctx: SuiteRunContext,
): Promise<{ report: FeasibilityReport; jsonPath: string; mdPath: string }> {
  const config = getConfig();
  const log = getLogger();

  const addressReport = await loadLatestModuleReport<AddressIntelligenceReport>(
    ctx.outputDir,
    "address-intelligence",
  );
  const forensics = await loadLatestModuleReport<TxForensicsReport>(
    ctx.outputDir,
    "tx-forensics",
  );
  const feeAudit = await loadLatestModuleReport<FeeAuditReport>(
    ctx.outputDir,
    "fee-audit",
  );
  const delegation = await loadLatestModuleReport<DelegationServiceReport>(
    ctx.outputDir,
    "delegation-service",
  );

  const forensicsVerdicts: Verdict[] = forensics ? [forensics.verdict] : [];
  const executive = synthesizeExecutiveVerdict(forensicsVerdicts, addressReport);

  const onChainBurn = forensics?.receipt.totalFeeTrx ?? 13.5;
  const breakEven = calculateBreakEven({
    onChainBurnTrx: onChainBurn,
    monthlyTxVolume: config.MONTHLY_TX_VOLUME,
    stakingCapitalTrx: delegation?.costTracker.trxStakedForEnergy,
    opportunityCostApr: config.OPPORTUNITY_COST_APR,
  });

  const evidenceTable: FeasibilityReport["evidenceTable"] = [];

  if (addressReport) {
    evidenceTable.push({
      source: "address-intelligence",
      key: "rotationPattern",
      value: addressReport.summary.rotationPattern,
    });
    evidenceTable.push({
      source: "address-intelligence",
      key: "jitFeasibility",
      value: addressReport.summary.jitFeasibility,
    });
  }

  if (forensics) {
    evidenceTable.push({
      source: "tx-forensics",
      key: "energy_usage",
      value: String(forensics.receipt.energyUsage),
    });
    evidenceTable.push({
      source: "tx-forensics",
      key: "totalFeeTrx",
      value: String(forensics.receipt.totalFeeTrx),
    });
    evidenceTable.push({
      source: "tx-forensics",
      key: "verdict",
      value: forensics.verdict,
    });
  }

  if (feeAudit) {
    evidenceTable.push({
      source: "fee-audit",
      key: "billingModel",
      value: feeAudit.billingModel,
    });
    if (feeAudit.annualSavingsTrx !== null) {
      evidenceTable.push({
        source: "fee-audit",
        key: "annualSavingsTrx",
        value: String(feeAudit.annualSavingsTrx),
      });
    }
  }

  const engineeringCostPersonDaysPerMonth =
    addressReport?.summary.rotationPattern === "rotating" ? 3 : 1.5;

  const report: FeasibilityReport = {
    module: "feasibility-report",
    generatedAt: new Date().toISOString(),
    executiveVerdict: executive.verdict,
    verdictSummary: executive.summary,
    recommendedAction: executive.action,
    riskMatrix: buildRiskMatrix(addressReport, forensics),
    engineeringCostPersonDaysPerMonth,
    breakEven: {
      trxSavedPerTx: breakEven.trxSavedPerTx,
      monthlySavingsTrx: breakEven.monthlySavingsTrx,
      annualSavingsTrx: breakEven.annualSavingsTrx,
      stakingCapitalTrx: breakEven.stakingCapitalTrx,
      breakEvenMonths: breakEven.breakEvenMonths,
      opportunityCostApr: breakEven.opportunityCostApr,
    },
    evidenceTable,
  };

  const jsonPath = await writeJsonReport(ctx.outputDir, report);
  const mdPath = await writeMarkdownReport(
    ctx.outputDir,
    `verdict-report-${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
    buildMarkdown(report),
  );

  log.info(
    { jsonPath, mdPath, verdict: report.executiveVerdict },
    "Feasibility report complete",
  );

  return { report, jsonPath, mdPath };
}
