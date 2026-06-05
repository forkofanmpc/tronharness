import { BANDWIDTH_BURN_TRX } from "./constants.js";

export interface BreakEvenInput {
  onChainBurnTrx: number;
  delegatedCostTrx?: number;
  monthlyTxVolume: number;
  stakingCapitalTrx?: number;
  opportunityCostApr?: number;
}

export interface BreakEvenResult {
  trxSavedPerTx: number;
  monthlySavingsTrx: number;
  annualSavingsTrx: number;
  stakingCapitalTrx: number | null;
  breakEvenMonths: number | null;
  opportunityCostApr: number;
}

export function calculateBreakEven(input: BreakEvenInput): BreakEvenResult {
  const delegatedCostTrx = input.delegatedCostTrx ?? BANDWIDTH_BURN_TRX;
  const trxSavedPerTx = Math.max(0, input.onChainBurnTrx - delegatedCostTrx);
  const monthlySavingsTrx = trxSavedPerTx * input.monthlyTxVolume;
  const annualSavingsTrx = monthlySavingsTrx * 12;
  const opportunityCostApr = input.opportunityCostApr ?? 0;

  let breakEvenMonths: number | null = null;
  if (monthlySavingsTrx > 0 && input.stakingCapitalTrx) {
    const annualOpportunityCost =
      input.stakingCapitalTrx * opportunityCostApr;
    const netMonthly =
      monthlySavingsTrx - annualOpportunityCost / 12;
    if (netMonthly > 0) {
      breakEvenMonths = input.stakingCapitalTrx / netMonthly;
    }
  }

  return {
    trxSavedPerTx,
    monthlySavingsTrx,
    annualSavingsTrx,
    stakingCapitalTrx: input.stakingCapitalTrx ?? null,
    breakEvenMonths,
    opportunityCostApr,
  };
}

export function classifyBillingModel(
  hexQuote: number | null,
  onChainBurn: number | null,
): "pass_through" | "flat_estimate" | "marked_up" | "unknown" {
  if (hexQuote === null || onChainBurn === null) {
    return "unknown";
  }

  const tolerance = 0.1;
  const diff = Math.abs(hexQuote - onChainBurn) / Math.max(onChainBurn, 0.001);

  if (diff <= tolerance) {
    return "pass_through";
  }
  if (hexQuote > onChainBurn * (1 + tolerance)) {
    return "marked_up";
  }
  return "flat_estimate";
}
