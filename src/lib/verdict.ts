import {
  BANDWIDTH_BURN_TRX,
  FEE_TOLERANCE,
  FULL_BURN_TRX_MAX,
  FULL_BURN_TRX_MIN,
} from "./constants.js";
import type {
  AddressIntelligenceReport,
  RotationPattern,
  TransactionReceiptForensics,
  Verdict,
} from "./types.js";

export function isApproxEqual(
  actual: number,
  expected: number,
  tolerance = FEE_TOLERANCE,
): boolean {
  if (expected === 0) {
    return actual === 0;
  }
  const diff = Math.abs(actual - expected) / expected;
  return diff <= tolerance;
}

export function isInRange(
  value: number,
  min: number,
  max: number,
  tolerance = FEE_TOLERANCE,
): boolean {
  const low = min * (1 - tolerance);
  const high = max * (1 + tolerance);
  return value >= low && value <= high;
}

export interface VerdictInput {
  receipt: Pick<
    TransactionReceiptForensics,
    "energyUsage" | "energyFeeSun" | "totalFeeTrx"
  >;
  knownDelegation: boolean;
  senderActivated: boolean | null;
  rotationPattern?: RotationPattern;
  jitFeasibility?: "high" | "medium" | "low";
}

/**
 * Classify whether external Energy delegation bypassed Hex's TRX burn.
 *
 * TRON protocol consumes Energy from the sender address first (including
 * delegated Energy). fee_limit only caps TRX burn for Energy shortfall.
 */
export function classifyVerdict(input: VerdictInput): {
  verdict: Verdict;
  reason: string;
} {
  const { receipt, knownDelegation, senderActivated, rotationPattern } = input;
  const energyFeeTrx = receipt.energyFeeSun / 1_000_000;
  const bandwidthOnly = isApproxEqual(receipt.totalFeeTrx, BANDWIDTH_BURN_TRX);

  if (
    receipt.energyUsage > 0 &&
    energyFeeTrx < 0.01 &&
    bandwidthOnly
  ) {
    return {
      verdict: "BYPASSABLE",
      reason:
        "Energy consumed from sender with minimal TRX burn (~0.345 TRX bandwidth only). External delegation works independently of Hex.",
    };
  }

  if (
    receipt.energyUsage > 0 &&
    energyFeeTrx < 0.01 &&
    receipt.totalFeeTrx < FULL_BURN_TRX_MIN
  ) {
    return {
      verdict: "BYPASSABLE",
      reason:
        "Energy consumed from sender; total fee well below full-burn threshold.",
    };
  }

  if (receipt.energyUsage === 0 && senderActivated === false) {
    return {
      verdict: "INCONCLUSIVE_NEW_ADDRESS",
      reason:
        "Sender appears unactivated or new; first USDT transfers cost ~2x Energy. Re-test with activated address.",
    };
  }

  if (
    receipt.energyUsage === 0 &&
    knownDelegation &&
    isInRange(receipt.totalFeeTrx, FULL_BURN_TRX_MIN, FULL_BURN_TRX_MAX)
  ) {
    return {
      verdict: "REAL_LIMITATION",
      reason:
        "Zero Energy usage despite known delegation; full TRX burn (~13-14 TRX). Hex signing may override protocol defaults.",
    };
  }

  if (
    receipt.energyUsage === 0 &&
    isInRange(receipt.totalFeeTrx, FULL_BURN_TRX_MIN, FULL_BURN_TRX_MAX)
  ) {
    return {
      verdict: "REAL_LIMITATION",
      reason:
        "Zero Energy usage with full TRX burn. Transaction did not consume delegated Energy.",
    };
  }

  if (rotationPattern === "rotating" || rotationPattern === "omnibus") {
    const jit = input.jitFeasibility ?? "low";
    if (jit === "low") {
      return {
        verdict: "OMNIBUS_BLOCKER",
        reason:
          "Address rotation/omnibus pattern with low JIT predictability makes pre-delegation operationally difficult.",
      };
    }
  }

  if (receipt.energyUsage > 0 && receipt.totalFeeTrx >= FULL_BURN_TRX_MIN * 0.5) {
    return {
      verdict: "PARTIAL",
      reason:
        "Some Energy consumed but significant TRX still burned. Mixed result — may work for fixed addresses only.",
    };
  }

  return {
    verdict: "INCONCLUSIVE",
    reason:
      "Insufficient evidence to classify. Run additional tests with known delegation and activated addresses.",
  };
}

export function synthesizeExecutiveVerdict(
  forensicsVerdicts: Verdict[],
  addressReport: AddressIntelligenceReport | null,
): { verdict: Verdict; summary: string; action: string } {
  if (forensicsVerdicts.includes("BYPASSABLE")) {
    return {
      verdict: "BYPASSABLE",
      summary: "On-chain evidence confirms Energy delegation bypasses TRX burn.",
      action: "Build the side-car delegation service for production.",
    };
  }

  if (forensicsVerdicts.includes("REAL_LIMITATION")) {
    return {
      verdict: "REAL_LIMITATION",
      summary: "Hex signing engine appears to construct transactions that bypass Energy.",
      action: "Escalate to Hex Trust with forensics evidence; do not invest in side-car.",
    };
  }

  if (
    addressReport?.summary.rotationPattern === "rotating" ||
    addressReport?.summary.rotationPattern === "omnibus"
  ) {
    if (addressReport.summary.jitFeasibility === "low") {
      return {
        verdict: "OMNIBUS_BLOCKER",
        summary: "Address rotation prevents reliable pre-delegation.",
        action: "Negotiate fixed sender addresses with Hex or abandon Energy bypass.",
      };
    }
  }

  if (forensicsVerdicts.includes("PARTIAL")) {
    return {
      verdict: "PARTIAL",
      summary: "Works for some addresses/scenarios but not universally.",
      action: "Deploy side-car for fixed hot-wallet addresses only.",
    };
  }

  return {
    verdict: "INCONCLUSIVE",
    summary: "More test transactions required before a definitive verdict.",
    action: "Run manual 1 USDT Hex withdrawal with pre-delegated Energy and re-analyze.",
  };
}
