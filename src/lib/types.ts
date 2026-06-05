/** Shared types for all module outputs. */

export type TronNetwork = "mainnet" | "nile";

export type RotationPattern = "fixed" | "rotating" | "omnibus" | "unknown";
export type JitFeasibility = "high" | "medium" | "low";
export type PredictabilityScore = "high" | "medium" | "low";

export type Verdict =
  | "BYPASSABLE"
  | "REAL_LIMITATION"
  | "INCONCLUSIVE_NEW_ADDRESS"
  | "OMNIBUS_BLOCKER"
  | "PARTIAL"
  | "INCONCLUSIVE";

export type BillingModel = "pass_through" | "flat_estimate" | "marked_up" | "unknown";

export type HexApiStatus = "SKIPPED_NO_CREDENTIALS" | "PROBED" | "ERROR";

export type DelegationStrategy = "always-on" | "jit" | "omnibus";

export interface AddressAnalysis {
  address: string;
  activated: boolean;
  rotationRole: "sender" | "receiver" | "both" | "inactive";
  energyAvailable: number;
  energyLimit: number;
  bandwidthAvailable: number;
  trxBalance: number;
  outboundTrc20Count90d: number;
  inboundTrc20Count90d: number;
  outboundTrxCount90d: number;
  medianInterTxGapHours: number | null;
  predictabilityScore: PredictabilityScore;
  firstSeenAt: string | null;
  lastActiveAt: string | null;
}

export interface AddressIntelligenceReport {
  module: "address-intelligence";
  generatedAt: string;
  network: TronNetwork;
  historyDays: number;
  addresses: AddressAnalysis[];
  summary: {
    rotationPattern: RotationPattern;
    uniqueSenders90d: number;
    addressesToKeepEnergized: number;
    jitFeasibility: JitFeasibility;
    notes: string[];
  };
}

export interface FeeFieldMatch {
  path: string;
  key: string;
  value: unknown;
}

export interface HexApiProbeResult {
  endpoint: string;
  method: string;
  status: "skipped" | "success" | "error";
  statusCode?: number;
  feeRelatedFields: FeeFieldMatch[];
  error?: string;
}

export interface HexApiAuditReport {
  module: "hex-api-audit";
  generatedAt: string;
  status: HexApiStatus;
  apiBaseUrl: string;
  probes: HexApiProbeResult[];
  checklist: string[];
  findings: string[];
}

export interface DelegationRecord {
  receiverAddress: string;
  amountSun: number;
  resource: "ENERGY" | "BANDWIDTH";
  lock: boolean;
  lockPeriod: number;
  txId: string | null;
  delegatedAt: string;
  dryRun: boolean;
}

export interface DelegationAction {
  receiverAddress: string;
  action: "delegate" | "undelegate" | "skip";
  amountSun: number;
  reason: string;
  txId: string | null;
  dryRun: boolean;
}

export interface CostTracker {
  trxStakedForEnergy: number;
  trxBurnedAvoided: number;
  netSavingsTrx: number;
  breakEvenTxCount: number | null;
}

export interface DelegationServiceReport {
  module: "delegation-service";
  generatedAt: string;
  network: TronNetwork;
  strategy: DelegationStrategy;
  dryRun: boolean;
  sponsorAddress: string;
  actions: DelegationAction[];
  costTracker: CostTracker;
}

export interface TransactionReceiptForensics {
  txId: string;
  energyUsage: number;
  energyUsageTotal: number;
  originEnergyUsage: number;
  energyFeeSun: number;
  netFeeSun: number;
  netUsage: number;
  totalFeeSun: number;
  totalFeeTrx: number;
  result: string | null;
  senderAddress: string | null;
  contractAddress: string | null;
  feeLimitSun: number | null;
}

export interface RawTxInspection {
  feeLimitSun: number | null;
  ownerAddress: string | null;
  contractType: string | null;
  callValue: number | null;
  permissionId: number | null;
  disablesEnergyConsumption: boolean;
  notes: string[];
}

export interface TxForensicsReport {
  module: "tx-forensics";
  generatedAt: string;
  network: TronNetwork;
  txId: string;
  receipt: TransactionReceiptForensics;
  rawTx: RawTxInspection | null;
  knownDelegation: boolean;
  senderActivated: boolean | null;
  verdict: Verdict;
  verdictReason: string;
}

export interface FeeAuditReport {
  module: "fee-audit";
  generatedAt: string;
  txId: string | null;
  hexQuotedFeeTrx: number | null;
  onChainBurnTrx: number | null;
  theoreticalMinimumTrx: number;
  billingModel: BillingModel;
  trxSavedPerTx: number | null;
  annualSavingsTrx: number | null;
  monthlyTxVolume: number;
  notes: string[];
}

export interface RiskItem {
  scenario: string;
  likelihood: "low" | "medium" | "high";
  impact: "low" | "medium" | "high";
  mitigation: string;
}

export interface FeasibilityReport {
  module: "feasibility-report";
  generatedAt: string;
  executiveVerdict: Verdict;
  verdictSummary: string;
  recommendedAction: string;
  riskMatrix: RiskItem[];
  engineeringCostPersonDaysPerMonth: number;
  breakEven: {
    trxSavedPerTx: number | null;
    monthlySavingsTrx: number | null;
    annualSavingsTrx: number | null;
    stakingCapitalTrx: number | null;
    breakEvenMonths: number | null;
    opportunityCostApr: number;
  };
  evidenceTable: Array<{
    source: string;
    key: string;
    value: string;
  }>;
}

export interface SuiteRunContext {
  dryRun: boolean;
  network: TronNetwork;
  outputDir: string;
  verbose: boolean;
}
