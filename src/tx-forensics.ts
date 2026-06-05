import { getLogger } from "./lib/logger.js";
import { loadLatestModuleReport, writeJsonReport } from "./lib/report.js";
import { TronGridClient } from "./lib/trongrid.js";
import {
  createTronWeb,
  getAccountResourceSnapshot,
  sunToTrx,
} from "./lib/tron-client.js";
import { classifyVerdict } from "./lib/verdict.js";
import type {
  RawTxInspection,
  SuiteRunContext,
  AddressIntelligenceReport,
  TransactionReceiptForensics,
  TxForensicsReport,
} from "./lib/types.js";
import { sleep } from "./lib/retry.js";

interface TxInfoResponse {
  id?: string;
  fee?: number;
  receipt?: {
    energy_usage?: number;
    energy_usage_total?: number;
    origin_energy_usage?: number;
    energy_fee?: number;
    net_fee?: number;
    net_usage?: number;
    result?: string;
  };
}

interface TxResponse {
  txID?: string;
  raw_data?: {
    fee_limit?: number;
    contract?: Array<{
      type?: string;
      Permission_id?: number;
      parameter?: {
        value?: {
          owner_address?: string;
          contract_address?: string;
          call_value?: number;
        };
      };
    }>;
  };
  raw_data_hex?: string;
}

async function pollTransactionInfo(
  client: TronGridClient,
  txId: string,
  maxAttempts = 20,
): Promise<TxInfoResponse> {
  for (let i = 0; i < maxAttempts; i++) {
    const info = await client.post<TxInfoResponse>(
      "/walletsolidity/gettransactioninfobyid",
      { value: txId },
    );
    if (info.id) {
      return info;
    }
    await sleep(3000);
  }
  throw new Error(`Transaction ${txId} not found after ${maxAttempts} attempts`);
}

function parseReceipt(
  txId: string,
  info: TxInfoResponse,
  tx: TxResponse,
  tronWeb: ReturnType<typeof createTronWeb>,
): TransactionReceiptForensics {
  const receipt = info.receipt ?? {};
  const contract = tx.raw_data?.contract?.[0];
  const param = contract?.parameter?.value;

  let senderAddress: string | null = null;
  if (param?.owner_address) {
    try {
      senderAddress = tronWeb.address.fromHex(param.owner_address);
    } catch {
      senderAddress = param.owner_address;
    }
  }

  let contractAddress: string | null = null;
  if (param?.contract_address) {
    try {
      contractAddress = tronWeb.address.fromHex(param.contract_address);
    } catch {
      contractAddress = param.contract_address;
    }
  }

  return {
    txId,
    energyUsage: receipt.energy_usage ?? 0,
    energyUsageTotal: receipt.energy_usage_total ?? 0,
    originEnergyUsage: receipt.origin_energy_usage ?? 0,
    energyFeeSun: receipt.energy_fee ?? 0,
    netFeeSun: receipt.net_fee ?? 0,
    netUsage: receipt.net_usage ?? 0,
    totalFeeSun: info.fee ?? 0,
    totalFeeTrx: sunToTrx(info.fee ?? 0),
    result: receipt.result ?? null,
    senderAddress,
    contractAddress,
    feeLimitSun: tx.raw_data?.fee_limit ?? null,
  };
}

/**
 * Inspect raw transaction fields.
 * fee_limit caps max TRX burn for Energy shortfall — it does NOT disable Energy
 * consumption. If sender has delegated Energy, protocol consumes it first.
 */
function inspectRawTx(tx: TxResponse): RawTxInspection {
  const contract = tx.raw_data?.contract?.[0];
  const param = contract?.parameter?.value;
  const notes: string[] = [];

  const feeLimitSun = tx.raw_data?.fee_limit ?? null;
  if (feeLimitSun !== null) {
    notes.push(
      `fee_limit=${feeLimitSun} sun caps TRX burn for Energy shortfall; does not disable Energy usage.`,
    );
  }

  return {
    feeLimitSun,
    ownerAddress: param?.owner_address ?? null,
    contractType: contract?.type ?? null,
    callValue: param?.call_value ?? null,
    permissionId: contract?.Permission_id ?? null,
    disablesEnergyConsumption: false,
    notes,
  };
}

export async function runTxForensics(
  ctx: SuiteRunContext,
  txId: string,
  options?: { knownDelegation?: boolean },
): Promise<{ report: TxForensicsReport; filepath: string }> {
  const client = new TronGridClient({ network: "mainnet" });
  const tronWeb = createTronWeb({ network: "mainnet" });
  const log = getLogger();

  log.info({ txId }, "Fetching transaction forensics");

  const addressReport = await loadLatestModuleReport<AddressIntelligenceReport>(
    ctx.outputDir,
    "address-intelligence",
  );
  const rotationPattern = addressReport?.summary.rotationPattern;
  const jitFeasibility = addressReport?.summary.jitFeasibility;

  const [info, tx] = await Promise.all([
    pollTransactionInfo(client, txId),
    client.post<TxResponse>("/wallet/gettransactionbyid", { value: txId }),
  ]);

  const receipt = parseReceipt(txId, info, tx, tronWeb);
  const rawTx = inspectRawTx(tx);

  let senderActivated: boolean | null = null;
  if (receipt.senderAddress) {
    const snapshot = await getAccountResourceSnapshot(
      receipt.senderAddress,
      "mainnet",
    );
    senderActivated = snapshot.activated;
  }

  const knownDelegation = options?.knownDelegation ?? false;
  const { verdict, reason } = classifyVerdict({
    receipt,
    knownDelegation,
    senderActivated,
    rotationPattern,
    jitFeasibility,
  });

  const report: TxForensicsReport = {
    module: "tx-forensics",
    generatedAt: new Date().toISOString(),
    network: "mainnet",
    txId,
    receipt,
    rawTx,
    knownDelegation,
    senderActivated,
    verdict,
    verdictReason: reason,
  };

  const filepath = await writeJsonReport(ctx.outputDir, report);
  log.info({ filepath, verdict }, "Transaction forensics complete");
  return { report, filepath };
}
