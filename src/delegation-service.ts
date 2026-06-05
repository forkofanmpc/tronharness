import { getConfig } from "./lib/config.js";
import {
  appendDelegationRecord,
  findDelegationForReceiver,
  hasRecentDelegation,
  loadDelegationState,
  saveDelegationState,
} from "./lib/delegation-state.js";
import { getLogger } from "./lib/logger.js";
import { writeJsonReport } from "./lib/report.js";
import {
  createTronWeb,
  estimateDelegateSunForEnergy,
  getAccountResourceSnapshot,
  getCanDelegateMax,
  getDelegatedResource,
  sunToTrx,
} from "./lib/tron-client.js";
import { selectAlwaysOnTargets } from "./strategies/always-on.js";
import { selectJitTarget } from "./strategies/jit.js";
import { selectOmnibusPool } from "./strategies/omnibus-pool.js";
import type {
  DelegationAction,
  DelegationServiceReport,
  DelegationStrategy,
  SuiteRunContext,
} from "./lib/types.js";

export interface DelegationOptions {
  strategy: DelegationStrategy;
  dryRun: boolean;
  lock: boolean;
  lockPeriod: number;
  allowMainnetDelegation: boolean;
  jitAddress?: string;
  pollOnce?: boolean;
  retireAddress?: string;
}

async function delegateEnergyToAddress(
  receiverAddress: string,
  network: "mainnet" | "nile",
  options: DelegationOptions,
  sponsorAddress: string,
): Promise<DelegationAction> {
  const config = getConfig();
  const log = getLogger();
  const state = await loadDelegationState(config.DELEGATION_STATE_PATH);

  const snapshot = await getAccountResourceSnapshot(receiverAddress, network);
  if (snapshot.energyAvailable >= config.ENERGY_THRESHOLD) {
    return {
      receiverAddress,
      action: "skip",
      amountSun: 0,
      reason: `Energy ${snapshot.energyAvailable} already above threshold ${config.ENERGY_THRESHOLD}`,
      txId: null,
      dryRun: options.dryRun,
    };
  }

  const existing = findDelegationForReceiver(state, receiverAddress);
  const onChain = await getDelegatedResource(sponsorAddress, receiverAddress, network);

  if (
    hasRecentDelegation(state, receiverAddress) ||
    onChain.energySun > 0
  ) {
    return {
      receiverAddress,
      action: "skip",
      amountSun: onChain.energySun || existing?.amountSun || 0,
      reason: "Delegation already exists on-chain or was recently recorded",
      txId: existing?.txId ?? null,
      dryRun: options.dryRun,
    };
  }

  const energyDeficit = config.ENERGY_THRESHOLD - snapshot.energyAvailable;
  const amountSun = await estimateDelegateSunForEnergy(energyDeficit, network);

  const maxDelegate = await getCanDelegateMax(sponsorAddress, "ENERGY", network);
  if (amountSun > maxDelegate) {
    return {
      receiverAddress,
      action: "skip",
      amountSun: 0,
      reason: `Insufficient delegatable ENERGY: need ${amountSun} sun, have ${maxDelegate} sun`,
      txId: null,
      dryRun: options.dryRun,
    };
  }

  if (options.dryRun) {
    log.info(
      { receiverAddress, amountSun, energyDeficit },
      "[DRY-RUN] Would delegate Energy",
    );
    return {
      receiverAddress,
      action: "delegate",
      amountSun,
      reason: `[DRY-RUN] Would delegate ~${sunToTrx(amountSun)} TRX worth of Energy`,
      txId: null,
      dryRun: true,
    };
  }

  const tronWeb = createTronWeb({ network, privateKey: config.SPONSOR_WALLET_PRIVATE_KEY });
  const unsigned = await tronWeb.transactionBuilder.delegateResource(
    amountSun,
    receiverAddress,
    "ENERGY",
    sponsorAddress,
    options.lock,
    options.lockPeriod,
  );

  const signed = await tronWeb.trx.sign(unsigned);
  const result = await tronWeb.trx.sendRawTransaction(signed);

  const txId =
    typeof result === "object" && result !== null && "txid" in result
      ? String((result as { txid: string }).txid)
      : null;

  const newState = appendDelegationRecord(state, {
    receiverAddress,
    amountSun,
    resource: "ENERGY",
    lock: options.lock,
    lockPeriod: options.lockPeriod,
    txId,
    delegatedAt: new Date().toISOString(),
    dryRun: false,
  });
  await saveDelegationState(config.DELEGATION_STATE_PATH, newState);

  log.info({ receiverAddress, txId, amountSun }, "Delegated Energy");

  return {
    receiverAddress,
    action: "delegate",
    amountSun,
    reason: `Delegated ${amountSun} sun ENERGY to ${receiverAddress}`,
    txId,
    dryRun: false,
  };
}

async function undelegateFromAddress(
  receiverAddress: string,
  network: "mainnet" | "nile",
  options: DelegationOptions,
  sponsorAddress: string,
): Promise<DelegationAction> {
  const config = getConfig();
  const onChain = await getDelegatedResource(sponsorAddress, receiverAddress, network);

  if (onChain.energySun === 0) {
    return {
      receiverAddress,
      action: "skip",
      amountSun: 0,
      reason: "No delegated Energy to reclaim",
      txId: null,
      dryRun: options.dryRun,
    };
  }

  if (options.dryRun) {
    return {
      receiverAddress,
      action: "undelegate",
      amountSun: onChain.energySun,
      reason: `[DRY-RUN] Would undelegate ${onChain.energySun} sun ENERGY`,
      txId: null,
      dryRun: true,
    };
  }

  const tronWeb = createTronWeb({ network, privateKey: config.SPONSOR_WALLET_PRIVATE_KEY });
  const unsigned = await tronWeb.transactionBuilder.undelegateResource(
    onChain.energySun,
    receiverAddress,
    "ENERGY",
    sponsorAddress,
  );
  const signed = await tronWeb.trx.sign(unsigned);
  const result = await tronWeb.trx.sendRawTransaction(signed);
  const txId =
    typeof result === "object" && result !== null && "txid" in result
      ? String((result as { txid: string }).txid)
      : null;

  return {
    receiverAddress,
    action: "undelegate",
    amountSun: onChain.energySun,
    reason: `Undelegated ${onChain.energySun} sun ENERGY from ${receiverAddress}`,
    txId,
    dryRun: false,
  };
}

function resolveTargets(
  strategy: DelegationStrategy,
  configuredAddresses: string[],
  jitAddress?: string,
): string[] {
  switch (strategy) {
    case "always-on":
      return selectAlwaysOnTargets(configuredAddresses);
    case "jit":
      return [selectJitTarget(jitAddress, configuredAddresses)];
    case "omnibus":
      return selectOmnibusPool(configuredAddresses);
    default:
      return configuredAddresses;
  }
}

export async function runDelegationService(
  ctx: SuiteRunContext,
  options: DelegationOptions,
): Promise<{ report: DelegationServiceReport; filepath: string }> {
  const config = getConfig();
  const network = ctx.network === "mainnet" ? "mainnet" : "nile";
  const effectiveNetwork =
    network === "mainnet" && !options.allowMainnetDelegation ? "nile" : network;

  if (network === "mainnet" && !options.allowMainnetDelegation) {
    getLogger().warn(
      "Mainnet delegation blocked — using Nile. Pass --allow-mainnet-delegation to override.",
    );
  }

  if (!config.SPONSOR_WALLET_PRIVATE_KEY) {
    throw new Error(
      "SPONSOR_WALLET_PRIVATE_KEY required for delegation service (use Nile test wallet).",
    );
  }

  const tronWeb = createTronWeb({
    network: effectiveNetwork,
    privateKey: config.SPONSOR_WALLET_PRIVATE_KEY,
  });
  const sponsorAddress = tronWeb.defaultAddress.base58 as string;

  const sponsorSnapshot = await getAccountResourceSnapshot(
    sponsorAddress,
    effectiveNetwork,
  );
  if (!sponsorSnapshot.activated) {
    throw new Error(`Sponsor wallet ${sponsorAddress} is not activated on ${effectiveNetwork}`);
  }

  const targets = resolveTargets(
    options.strategy,
    config.targetAddresses,
    options.jitAddress,
  );

  if (targets.length === 0) {
    throw new Error("No target addresses for delegation strategy");
  }

  const actions: DelegationAction[] = [];

  if (options.retireAddress) {
    actions.push(
      await undelegateFromAddress(
        options.retireAddress,
        effectiveNetwork,
        options,
        sponsorAddress,
      ),
    );
  }

  for (const target of targets) {
    actions.push(
      await delegateEnergyToAddress(
        target,
        effectiveNetwork,
        options,
        sponsorAddress,
      ),
    );
  }

  const totalDelegatedSun = actions
    .filter((a) => a.action === "delegate")
    .reduce((s, a) => s + a.amountSun, 0);

  const report: DelegationServiceReport = {
    module: "delegation-service",
    generatedAt: new Date().toISOString(),
    network: effectiveNetwork,
    strategy: options.strategy,
    dryRun: options.dryRun,
    sponsorAddress,
    actions,
    costTracker: {
      trxStakedForEnergy: sunToTrx(totalDelegatedSun),
      trxBurnedAvoided: 0,
      netSavingsTrx: 0,
      breakEvenTxCount: null,
    },
  };

  const filepath = await writeJsonReport(ctx.outputDir, report);
  getLogger().info({ filepath, strategy: options.strategy }, "Delegation service complete");
  return { report, filepath };
}
