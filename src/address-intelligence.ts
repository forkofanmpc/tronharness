import { getConfig } from "./lib/config.js";
import { HISTORY_DAYS } from "./lib/constants.js";
import { getLogger } from "./lib/logger.js";
import { writeJsonReport } from "./lib/report.js";
import { TronGridClient } from "./lib/trongrid.js";
import { getAccountResourceSnapshot } from "./lib/tron-client.js";
import { createTronWeb } from "./lib/tron-client.js";
import type {
  AddressAnalysis,
  AddressIntelligenceReport,
  JitFeasibility,
  PredictabilityScore,
  RotationPattern,
  SuiteRunContext,
} from "./lib/types.js";

interface Trc20Tx {
  transaction_id: string;
  block_timestamp: number;
  from: string;
  to: string;
  value: string;
  token_info?: { symbol?: string };
}

interface TrxTx {
  txID: string;
  block_timestamp?: number;
  raw_data?: {
    timestamp?: number;
    contract?: Array<{
      type?: string;
      parameter?: { value?: { owner_address?: string; to_address?: string } };
    }>;
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function classifyPredictability(
  outboundCount: number,
  medianGapHours: number | null,
): PredictabilityScore {
  if (outboundCount >= 10 && medianGapHours !== null && medianGapHours > 1) {
    return "high";
  }
  if (outboundCount >= 3) {
    return "medium";
  }
  return "low";
}

function classifyRotationPattern(
  addresses: AddressAnalysis[],
): RotationPattern {
  const senders = addresses.filter(
    (a) => a.rotationRole === "sender" || a.rotationRole === "both",
  );
  const activeSenders = senders.filter((a) => a.outboundTrc20Count90d > 0);

  if (activeSenders.length <= 2 && activeSenders.some((a) => a.outboundTrc20Count90d >= 5)) {
    return "fixed";
  }
  if (activeSenders.length >= 5 && activeSenders.every((a) => a.outboundTrc20Count90d <= 3)) {
    return "rotating";
  }
  if (activeSenders.length >= 2 && activeSenders.length <= 10) {
    const totalOutbound = activeSenders.reduce((s, a) => s + a.outboundTrc20Count90d, 0);
    if (totalOutbound / activeSenders.length >= 10) {
      return "omnibus";
    }
  }
  return activeSenders.length > 3 ? "rotating" : "unknown";
}

function classifyJitFeasibility(
  pattern: RotationPattern,
  addresses: AddressAnalysis[],
): JitFeasibility {
  if (pattern === "fixed") {
    return "high";
  }
  const highPredict = addresses.filter((a) => a.predictabilityScore === "high").length;
  if (pattern === "omnibus" && highPredict >= 2) {
    return "medium";
  }
  if (pattern === "rotating") {
    return "low";
  }
  return highPredict > 0 ? "medium" : "low";
}

async function fetchTrc20History(
  client: TronGridClient,
  address: string,
  minTimestamp: number,
): Promise<Trc20Tx[]> {
  return client.paginateV1<Trc20Tx>(
    `/v1/accounts/${address}/transactions/trc20`,
    {
      only_confirmed: "true",
      limit: "200",
      min_timestamp: String(minTimestamp),
    },
    (page) => page.data ?? [],
  );
}

async function fetchTrxHistory(
  client: TronGridClient,
  address: string,
  minTimestamp: number,
): Promise<TrxTx[]> {
  return client.paginateV1<TrxTx>(
    `/v1/accounts/${address}/transactions`,
    {
      only_confirmed: "true",
      limit: "200",
      min_timestamp: String(minTimestamp),
    },
    (page) => page.data ?? [],
  );
}

async function analyzeAddress(
  address: string,
  client: TronGridClient,
  minTimestamp: number,
): Promise<AddressAnalysis> {
  const log = getLogger();
  log.info({ address }, "Analyzing address");

  // Used to normalize TRON addresses between hex and Base58 for direction classification.
  const tronWeb = createTronWeb({ network: "mainnet" });

  const [trc20Txs, trxTxs, resources] = await Promise.all([
    fetchTrc20History(client, address, minTimestamp),
    fetchTrxHistory(client, address, minTimestamp),
    getAccountResourceSnapshot(address, "mainnet"),
  ]);

  const outboundTrc20 = trc20Txs.filter(
    (tx) => tx.from?.toLowerCase() === address.toLowerCase(),
  );
  const inboundTrc20 = trc20Txs.filter(
    (tx) => tx.to?.toLowerCase() === address.toLowerCase(),
  );

  const outboundTrx = trxTxs.filter((tx) => {
    const owner = tx.raw_data?.contract?.[0]?.parameter?.value?.owner_address;
    const fromField = (tx as unknown as { from?: string }).from;

    const matches = (candidate: unknown): boolean => {
      if (typeof candidate !== "string") return false;
      if (candidate.toLowerCase() === address.toLowerCase()) return true;

      // If candidate is hex (starts with 41), try converting to Base58Check.
      if (candidate.startsWith("41") && candidate.length >= 42) {
        try {
          const base58 = tronWeb.address.fromHex(candidate);
          return base58.toLowerCase() === address.toLowerCase();
        } catch {
          return false;
        }
      }

      // Otherwise it may already be Base58 (or some other format).
      return false;
    };

    return matches(owner) || matches(fromField);
  });

  let rotationRole: AddressAnalysis["rotationRole"] = "inactive";
  if (outboundTrc20.length > 0 && inboundTrc20.length > 0) {
    rotationRole = "both";
  } else if (outboundTrc20.length > 0) {
    rotationRole = "sender";
  } else if (inboundTrc20.length > 0) {
    rotationRole = "receiver";
  }

  const timestamps = outboundTrc20
    .map((tx) => tx.block_timestamp)
    .sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    gaps.push((timestamps[i] - timestamps[i - 1]) / (1000 * 60 * 60));
  }
  const medianGapHours = median(gaps);

  const allTimestamps = [
    ...trc20Txs.map((t) => t.block_timestamp),
    ...trxTxs.map((t) => t.block_timestamp ?? t.raw_data?.timestamp ?? 0),
  ].filter(Boolean);

  const activated =
    resources.activated || inboundTrc20.length > 0 || outboundTrc20.length > 0;

  return {
    address,
    activated,
    rotationRole,
    energyAvailable: resources.energyAvailable,
    energyLimit: resources.energyLimit,
    bandwidthAvailable: resources.bandwidthAvailable,
    trxBalance: resources.trxBalance,
    outboundTrc20Count90d: outboundTrc20.length,
    inboundTrc20Count90d: inboundTrc20.length,
    outboundTrxCount90d: outboundTrx.length,
    medianInterTxGapHours: medianGapHours,
    predictabilityScore: classifyPredictability(
      outboundTrc20.length,
      medianGapHours,
    ),
    firstSeenAt: allTimestamps.length
      ? new Date(Math.min(...allTimestamps)).toISOString()
      : null,
    lastActiveAt: allTimestamps.length
      ? new Date(Math.max(...allTimestamps)).toISOString()
      : null,
  };
}

export async function runAddressIntelligence(
  ctx: SuiteRunContext,
): Promise<{ report: AddressIntelligenceReport; filepath: string }> {
  const config = getConfig();
  const addresses = config.targetAddresses;

  if (addresses.length === 0) {
    throw new Error(
      "TARGET_ADDRESSES is empty. Provide comma-separated Hex-associated TRON addresses.",
    );
  }

  const client = new TronGridClient({ network: "mainnet" });
  const minTimestamp = Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000;

  const analyses: AddressAnalysis[] = [];
  for (const address of addresses) {
    analyses.push(await analyzeAddress(address, client, minTimestamp));
  }

  const rotationPattern = classifyRotationPattern(analyses);
  const jitFeasibility = classifyJitFeasibility(rotationPattern, analyses);

  const activeSenders = analyses.filter(
    (a) => a.rotationRole === "sender" || a.rotationRole === "both",
  );
  const addressesToKeepEnergized =
    rotationPattern === "fixed"
      ? activeSenders.length || addresses.length
      : rotationPattern === "omnibus"
        ? Math.min(config.OMNIBUS_POOL_SIZE, activeSenders.length || addresses.length)
        : activeSenders.length;

  const notes: string[] = [];
  if (rotationPattern === "rotating") {
    notes.push(
      "Addresses appear to rotate frequently; JIT delegation may be required.",
    );
  }
  if (analyses.some((a) => !a.activated)) {
    notes.push(
      "Some addresses are unactivated; first USDT transfer costs ~130k Energy (2x).",
    );
  }

  const report: AddressIntelligenceReport = {
    module: "address-intelligence",
    generatedAt: new Date().toISOString(),
    network: "mainnet",
    historyDays: HISTORY_DAYS,
    addresses: analyses,
    summary: {
      rotationPattern,
      uniqueSenders90d: activeSenders.length,
      addressesToKeepEnergized,
      jitFeasibility,
      notes,
    },
  };

  const filepath = await writeJsonReport(ctx.outputDir, report);
  getLogger().info({ filepath, rotationPattern }, "Address intelligence complete");
  return { report, filepath };
}
