import { getConfig } from "../lib/config.js";
import type { AddressAnalysis } from "../lib/types.js";

/** Strategy C: maintain a pool of pre-energized addresses for omnibus rotation. */
export function selectOmnibusPool(
  configuredAddresses: string[],
  analyses?: AddressAnalysis[],
): string[] {
  const config = getConfig();
  const poolSize = config.OMNIBUS_POOL_SIZE;

  if (analyses?.length) {
    const ranked = [...analyses]
      .filter((a) => a.rotationRole === "sender" || a.rotationRole === "both")
      .sort((a, b) => b.outboundTrc20Count90d - a.outboundTrc20Count90d);
    const fromAnalysis = ranked.slice(0, poolSize).map((a) => a.address);
    if (fromAnalysis.length > 0) {
      return fromAnalysis;
    }
  }

  return configuredAddresses.slice(0, poolSize);
}

export function poolUtilization(
  analyses: AddressAnalysis[],
  pool: string[],
): { utilized: number; total: number; utilizationPct: number } {
  const active = pool.filter((addr) => {
    const a = analyses.find((x) => x.address === addr);
    return a && a.outboundTrc20Count90d > 0;
  });
  return {
    utilized: active.length,
    total: pool.length,
    utilizationPct: pool.length ? (active.length / pool.length) * 100 : 0,
  };
}
