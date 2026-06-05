/** TRON protocol constants for USDT TRC-20 transfers and fee analysis. */

export const SUN_PER_TRX = 1_000_000;

/** Energy required for USDT transfer to an existing activated wallet. */
export const ENERGY_PER_USDT_EXISTING = 65_000;

/** Energy required for USDT transfer to a new/unactivated wallet (2x cost). */
export const ENERGY_PER_USDT_NEW = 130_000;

/** TRX burned for bandwidth when no free/staked bandwidth is available. */
export const BANDWIDTH_BURN_TRX = 0.345;

/** TRX burned per Energy unit when account has insufficient Energy. */
export const TRX_PER_ENERGY = 0.00028;

/**
 * Default fee_limit in sun (150 TRX). This caps max TRX burn for Energy shortfall;
 * it does NOT disable Energy consumption — protocol uses available Energy first.
 */
export const FEE_LIMIT_DEFAULT_SUN = 15_000_000;

/** Expected full TRX burn when no Energy is consumed (typical Hex default). */
export const FULL_BURN_TRX_MIN = 13;
export const FULL_BURN_TRX_MAX = 14;

/** Tolerance for fee comparisons (±10%). */
export const FEE_TOLERANCE = 0.1;

export const MAINNET_USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

export const NETWORK_HOSTS = {
  mainnet: "https://api.trongrid.io",
  nile: "https://nile.trongrid.io",
} as const;

export const DEFAULT_ENERGY_THRESHOLD = 100_000;
export const DEFAULT_POLL_INTERVAL_MS = 30_000;
export const HISTORY_DAYS = 90;
