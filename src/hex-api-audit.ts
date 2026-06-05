import { createSign } from "node:crypto";
import { getConfig } from "./lib/config.js";
import { walkFeeRelatedFields } from "./lib/fee-walker.js";
import { getLogger } from "./lib/logger.js";
import { writeJsonReport } from "./lib/report.js";
import type {
  HexApiAuditReport,
  HexApiProbeResult,
  SuiteRunContext,
} from "./lib/types.js";

const PROBE_CHECKLIST = [
  "Does withdrawal creation accept fee_preference or resource_preference?",
  "Does withdrawal creation accept energy_limit parameter?",
  "Does API return raw unsigned transaction hex before signing?",
  "Is sender (from) address exposed before broadcast?",
  "How is fee_estimate calculated — static TRX or dynamic?",
  "Are there undocumented fee/gas/resource fields in response bodies?",
  "Does Hex set fee_limit in a way that forces TRX burn?",
  "Can we subscribe to withdrawal-pending webhooks for JIT delegation?",
];

interface ProbeDefinition {
  name: string;
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

const PROBE_CATALOG: ProbeDefinition[] = [
  { name: "list_accounts", method: "GET", path: "/v1/accounts" },
  { name: "list_wallets", method: "GET", path: "/v1/wallets" },
  {
    name: "withdrawal_schema_probe",
    method: "OPTIONS",
    path: "/v1/withdrawals",
  },
  {
    name: "fee_estimate_probe",
    method: "POST",
    path: "/v1/withdrawals/estimate",
    body: {
      asset_ticker: "USDT",
      network: "TRON",
      quantity: 1,
      fee_price: 75,
      fee_limit: 15000000,
    },
  },
];

/**
 * ES256 request signing scaffold for Hex Safe API (HollaEx plugin pattern).
 * Disabled until HEX_TRUST_API_KEY, HEX_ENTERPRISE_ID, HEX_PRIVATE_KEY are set.
 */
function signHexRequest(
  method: string,
  path: string,
  body: string,
  apiKey: string,
  enterpriseId: string,
  privateKeyPem: string,
): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = `${method}\n${path}\n${timestamp}\n${body}`;

  const signer = createSign("SHA256");
  signer.update(payload);
  signer.end();

  const signature = signer.sign(privateKeyPem, "base64");

  return {
    "X-Api-Key": apiKey,
    "X-Enterprise-Id": enterpriseId,
    "X-Timestamp": timestamp,
    "X-Signature": signature,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function runProbe(
  baseUrl: string,
  probe: ProbeDefinition,
  headers: Record<string, string> | null,
): Promise<HexApiProbeResult> {
  const url = `${baseUrl}${probe.path}`;

  try {
    const init: RequestInit = {
      method: probe.method,
      headers: headers ?? { Accept: "application/json" },
    };
    if (probe.body && probe.method !== "GET" && probe.method !== "OPTIONS") {
      init.body = JSON.stringify(probe.body);
    }

    const response = await fetch(url, init);
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text.slice(0, 500) };
    }

    const feeRelatedFields = walkFeeRelatedFields(parsed);

    return {
      endpoint: probe.path,
      method: probe.method,
      status: response.ok ? "success" : "error",
      statusCode: response.status,
      feeRelatedFields,
      error: response.ok ? undefined : text.slice(0, 300),
    };
  } catch (err) {
    return {
      endpoint: probe.path,
      method: probe.method,
      status: "error",
      feeRelatedFields: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runHexApiAudit(
  ctx: SuiteRunContext,
): Promise<{ report: HexApiAuditReport; filepath: string }> {
  const config = getConfig();
  const log = getLogger();

  if (!config.hasHexCredentials) {
    log.warn("Hex API credentials not configured — running stub audit");

    const report: HexApiAuditReport = {
      module: "hex-api-audit",
      generatedAt: new Date().toISOString(),
      status: "SKIPPED_NO_CREDENTIALS",
      apiBaseUrl: config.HEX_API_BASE_URL,
      probes: PROBE_CATALOG.map((p) => ({
        endpoint: p.path,
        method: p.method,
        status: "skipped" as const,
        feeRelatedFields: p.body ? walkFeeRelatedFields(p.body) : [],
      })),
      checklist: PROBE_CHECKLIST,
      findings: [
        "Hex API audit skipped — set HEX_TRUST_API_KEY, HEX_ENTERPRISE_ID, HEX_PRIVATE_KEY to enable probing.",
        "Known withdrawal body fields from public integrations: fee_price, fee_limit, account_id, asset_ticker, wallet_name, to_address.",
        "Module 4 (tx-forensics) is the definitive test without Hex API access.",
      ],
    };

    const filepath = await writeJsonReport(ctx.outputDir, report);
    return { report, filepath };
  }

  const probes: HexApiProbeResult[] = [];
  for (const probe of PROBE_CATALOG) {
    log.info({ probe: probe.name }, "Probing Hex API endpoint");
    const bodyString = probe.body ? JSON.stringify(probe.body) : "";
    const signedHeaders = signHexRequest(
      probe.method,
      probe.path,
      bodyString,
      config.HEX_TRUST_API_KEY!,
      config.HEX_ENTERPRISE_ID!,
      config.HEX_PRIVATE_KEY!,
    );

    probes.push(
      await runProbe(config.HEX_API_BASE_URL, probe, signedHeaders),
    );
  }

  const allFeeFields = probes.flatMap((p) => p.feeRelatedFields);
  const findings: string[] = [
    `Probed ${probes.length} endpoints against ${config.HEX_API_BASE_URL}`,
    `Found ${allFeeFields.length} fee/resource-related fields across responses`,
  ];

  for (const field of allFeeFields.slice(0, 20)) {
    findings.push(`${field.path}: ${JSON.stringify(field.value)}`);
  }

  const report: HexApiAuditReport = {
    module: "hex-api-audit",
    generatedAt: new Date().toISOString(),
    status: "PROBED",
    apiBaseUrl: config.HEX_API_BASE_URL,
    probes,
    checklist: PROBE_CHECKLIST,
    findings,
  };

  const filepath = await writeJsonReport(ctx.outputDir, report);
  return { report, filepath };
}
