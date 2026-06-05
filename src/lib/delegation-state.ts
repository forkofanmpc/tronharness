import { readFile, writeFile } from "node:fs/promises";
import type { DelegationRecord } from "./types.js";

export interface DelegationStateFile {
  version: 1;
  updatedAt: string;
  records: DelegationRecord[];
}

const DEFAULT_STATE: DelegationStateFile = {
  version: 1,
  updatedAt: new Date().toISOString(),
  records: [],
};

export async function loadDelegationState(
  filepath: string,
): Promise<DelegationStateFile> {
  try {
    const raw = await readFile(filepath, "utf-8");
    return JSON.parse(raw) as DelegationStateFile;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function saveDelegationState(
  filepath: string,
  state: DelegationStateFile,
): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await writeFile(filepath, JSON.stringify(state, null, 2), "utf-8");
}

export function findDelegationForReceiver(
  state: DelegationStateFile,
  receiverAddress: string,
): DelegationRecord | undefined {
  return state.records
    .filter((r) => r.receiverAddress === receiverAddress && !r.dryRun)
    .sort((a, b) => b.delegatedAt.localeCompare(a.delegatedAt))[0];
}

export function hasRecentDelegation(
  state: DelegationStateFile,
  receiverAddress: string,
  withinMs = 60_000,
): boolean {
  const record = findDelegationForReceiver(state, receiverAddress);
  if (!record) {
    return false;
  }
  const age = Date.now() - new Date(record.delegatedAt).getTime();
  return age < withinMs;
}

export function appendDelegationRecord(
  state: DelegationStateFile,
  record: DelegationRecord,
): DelegationStateFile {
  return {
    ...state,
    records: [...state.records, record],
  };
}

export function markAddressRetired(
  state: DelegationStateFile,
  receiverAddress: string,
): DelegationStateFile {
  return {
    ...state,
    records: state.records.filter((r) => r.receiverAddress !== receiverAddress),
  };
}
