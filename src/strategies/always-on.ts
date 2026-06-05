import type { AddressAnalysis } from "../lib/types.js";

/** Strategy A: keep a fixed set of addresses permanently above Energy threshold. */
export function selectAlwaysOnTargets(
  configuredAddresses: string[],
  _analyses?: AddressAnalysis[],
): string[] {
  return configuredAddresses;
}
