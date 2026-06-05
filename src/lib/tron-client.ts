import { TronWeb } from "tronweb";
import { getConfig } from "./config.js";
import { NETWORK_HOSTS, SUN_PER_TRX } from "./constants.js";
import type { TronNetwork } from "./types.js";
import { TronGridClient } from "./trongrid.js";

export function createTronWeb(options?: {
  network?: TronNetwork;
  privateKey?: string;
}): TronWeb {
  const config = getConfig();
  const network = options?.network ?? config.NETWORK;
  const privateKey = options?.privateKey ?? config.SPONSOR_WALLET_PRIVATE_KEY;

  const tronWeb = new TronWeb({
    fullHost: NETWORK_HOSTS[network],
    headers: config.TRON_GRID_API_KEY
      ? { "TRON-PRO-API-KEY": config.TRON_GRID_API_KEY }
      : undefined,
    privateKey: privateKey || undefined,
  });

  return tronWeb;
}

export interface AccountResourceSnapshot {
  energyAvailable: number;
  energyLimit: number;
  energyUsed: number;
  bandwidthAvailable: number;
  bandwidthLimit: number;
  bandwidthUsed: number;
  trxBalanceSun: number;
  trxBalance: number;
  activated: boolean;
}

export async function getAccountResourceSnapshot(
  address: string,
  network: TronNetwork,
): Promise<AccountResourceSnapshot> {
  const client = new TronGridClient({ network });

  const [resource, account] = await Promise.all([
    client.post<{
      EnergyLimit?: number;
      EnergyUsed?: number;
      NetLimit?: number;
      NetUsed?: number;
      freeNetLimit?: number;
      freeNetUsed?: number;
    }>("/wallet/getaccountresource", { address, visible: true }, true),
    client.post<{
      balance?: number;
      address?: string;
    }>("/wallet/getaccount", { address, visible: true }, true),
  ]);

  const energyLimit = resource.EnergyLimit ?? 0;
  const energyUsed = resource.EnergyUsed ?? 0;
  const netLimit = (resource.NetLimit ?? 0) + (resource.freeNetLimit ?? 0);
  const netUsed = (resource.NetUsed ?? 0) + (resource.freeNetUsed ?? 0);

  const trxBalanceSun = account.balance ?? 0;

  return {
    energyAvailable: Math.max(0, energyLimit - energyUsed),
    energyLimit,
    energyUsed,
    bandwidthAvailable: Math.max(0, netLimit - netUsed),
    bandwidthLimit: netLimit,
    bandwidthUsed: netUsed,
    trxBalanceSun,
    trxBalance: trxBalanceSun / SUN_PER_TRX,
    activated: Boolean(account.address) || trxBalanceSun > 0,
  };
}

export async function getCanDelegateMax(
  ownerAddress: string,
  resource: "ENERGY" | "BANDWIDTH",
  network: TronNetwork,
): Promise<number> {
  const client = new TronGridClient({ network });
  const result = await client.post<{ max_size?: number }>(
    "/wallet/getcandelegatedmaxsize",
    {
      owner_address: ownerAddress,
      type: resource === "ENERGY" ? 1 : 0,
      visible: true,
    },
  );
  return result.max_size ?? 0;
}

export async function getDelegatedResource(
  fromAddress: string,
  toAddress: string,
  network: TronNetwork,
): Promise<{ energySun: number; bandwidthSun: number }> {
  const client = new TronGridClient({ network });
  const result = await client.post<{
    delegatedResource?: Array<{
      frozen_balance_for_energy?: number;
      frozen_balance_for_bandwidth?: number;
    }>;
  }>("/wallet/getdelegatedresourcev2", {
    fromAddress,
    toAddress,
    visible: true,
  });

  let energySun = 0;
  let bandwidthSun = 0;
  for (const d of result.delegatedResource ?? []) {
    energySun += d.frozen_balance_for_energy ?? 0;
    bandwidthSun += d.frozen_balance_for_bandwidth ?? 0;
  }

  return { energySun, bandwidthSun };
}

/** Estimate TRX (sun) to delegate for target Energy using network ratio. */
export async function estimateDelegateSunForEnergy(
  targetEnergy: number,
  network: TronNetwork,
  referenceAddress: string,
): Promise<number> {
  const client = new TronGridClient({ network });
  const totals = await client.post<{
    TotalEnergyLimit?: number;
    TotalEnergyWeight?: number;
  }>("/wallet/getaccountresource", {
    // Any activated external account should return the same network-wide
    // TotalEnergyLimit/TotalEnergyWeight. Use our sponsor as a stable source.
    address: referenceAddress,
    visible: true,
  });

  const totalEnergy = totals.TotalEnergyLimit ?? 1;
  const totalWeight = totals.TotalEnergyWeight ?? 1;
  const sunPerEnergy = totalWeight / totalEnergy;
  return Math.ceil(targetEnergy * sunPerEnergy);
}

export function sunToTrx(sun: number): number {
  return sun / SUN_PER_TRX;
}

export function trxToSun(trx: number): number {
  return Math.ceil(trx * SUN_PER_TRX);
}
