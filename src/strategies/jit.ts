import type { AddressAnalysis } from "../lib/types.js";

/** Strategy B: Just-in-Time delegation when sender address is revealed. */
export function selectJitTarget(
  jitAddress: string | undefined,
  configuredAddresses: string[],
): string {
  if (jitAddress) {
    return jitAddress;
  }
  if (configuredAddresses.length === 1) {
    return configuredAddresses[0];
  }
  throw new Error(
    "JIT strategy requires --jit-address <addr> to simulate Hex sender reveal.",
  );
}

export function estimateJitWindowSeconds(
  analyses: AddressAnalysis[] | undefined,
): number {
  if (!analyses?.length) {
    return 30;
  }
  const sender = analyses.find((a) => a.rotationRole === "sender");
  if (sender?.medianInterTxGapHours && sender.medianInterTxGapHours > 24) {
    return 120;
  }
  return 30;
}
