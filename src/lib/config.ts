import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import {
  DEFAULT_ENERGY_THRESHOLD,
  DEFAULT_POLL_INTERVAL_MS,
  MAINNET_USDT_CONTRACT,
} from "./constants.js";
import type { TronNetwork } from "./types.js";

loadDotenv();

const networkSchema = z.enum(["mainnet", "nile"]);

const envSchema = z.object({
  NETWORK: networkSchema.default("mainnet"),
  TRON_GRID_API_KEY: z.string().optional(),
  TARGET_ADDRESSES: z.string().default(""),
  SPONSOR_WALLET_PRIVATE_KEY: z.string().optional(),
  ENERGY_THRESHOLD: z.coerce.number().default(DEFAULT_ENERGY_THRESHOLD),
  POLL_INTERVAL_MS: z.coerce.number().default(DEFAULT_POLL_INTERVAL_MS),
  USDT_CONTRACT: z.string().default(MAINNET_USDT_CONTRACT),
  HEX_TRUST_API_KEY: z.string().optional(),
  HEX_ENTERPRISE_ID: z.string().optional(),
  HEX_PRIVATE_KEY: z.string().optional(),
  HEX_API_BASE_URL: z
    .string()
    .default("https://api.sandbox.hexsafe.hextrust.com"),
  MONTHLY_TX_VOLUME: z.coerce.number().default(100),
  HEX_QUOTED_FEE_TRX: z.coerce.number().optional(),
  OMNIBUS_POOL_SIZE: z.coerce.number().default(50),
  USE_TRONSCAN_FALLBACK: z
    .enum(["true", "false", "1", "0", ""])
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  DELEGATION_STATE_PATH: z.string().default("delegation-state.json"),
  OPPORTUNITY_COST_APR: z.coerce.number().default(0),
});

export type AppConfig = z.infer<typeof envSchema> & {
  targetAddresses: string[];
  hasHexCredentials: boolean;
};

let cachedConfig: AppConfig | null = null;

export function loadConfig(overrides?: { network?: TronNetwork }): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }

  const targetAddresses = parsed.data.TARGET_ADDRESSES.split(",")
    .map((a) => a.trim())
    .filter(Boolean);

  const hasHexCredentials = Boolean(
    parsed.data.HEX_TRUST_API_KEY &&
      parsed.data.HEX_ENTERPRISE_ID &&
      parsed.data.HEX_PRIVATE_KEY,
  );

  cachedConfig = {
    ...parsed.data,
    NETWORK: overrides?.network ?? parsed.data.NETWORK,
    targetAddresses,
    hasHexCredentials,
  };

  return cachedConfig;
}

export function getConfig(): AppConfig {
  if (!cachedConfig) {
    return loadConfig();
  }
  return cachedConfig;
}

export function parseAddresses(input?: string): string[] {
  if (!input) {
    return getConfig().targetAddresses;
  }
  return input
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
}
