import type { BranchConfig } from '@pos/events';
import type { WriterTx } from '../engine-host/writer.js';

export interface ConfigEntry {
  config: BranchConfig;
  snapshotHash: string;
  configVersion: number;
  snapshotSchemaVersion: number;
  appliedAt: number;
}

type ConfigHook = (prev: BranchConfig | null, next: BranchConfig, tx: WriterTx) => void;

let current: ConfigEntry | null = null;
const hooks: ConfigHook[] = [];

// §4.2: null before the first apply; swapped after COMMIT (D45).
export function branchConfig(): BranchConfig | null {
  return current?.config ?? null;
}

export function currentConfigEntry(): ConfigEntry | null {
  return current;
}

export function swapBranchConfig(entry: ConfigEntry | null): void {
  current = entry;
}

// §4.2: runs inside the applying writer.run, before COMMIT; returns the unsubscribe function.
export function onBranchConfigApplied(fn: ConfigHook): () => void {
  hooks.push(fn);
  return () => {
    const index = hooks.indexOf(fn);
    if (index >= 0) hooks.splice(index, 1);
  };
}

// A throw propagates and fails the whole apply (S43).
export function runBranchConfigHooks(prev: BranchConfig | null, next: BranchConfig, tx: WriterTx): void {
  for (const fn of [...hooks]) fn(prev, next, tx);
}

// 01b v1.6 B-2 (AD-25): the zone of an active table in the current config (snapshot V4 `tables[].zone_id`), or null
// (no config yet, an unknown or archived table, or no zone). Read through on every call, so it is current after a
// config apply; the table index is built once per applied config.
const zoneIndex = new WeakMap<BranchConfig, Map<string, string | null>>();

export function zoneOfTable(tableId: string): string | null {
  const config = branchConfig();
  if (config === null) return null;
  let index = zoneIndex.get(config);
  if (index === undefined) {
    index = new Map();
    for (const floor of config.floors) for (const table of floor.tables) index.set(table.table_id, table.zone_id ?? null);
    zoneIndex.set(config, index);
  }
  return index.get(tableId) ?? null;
}
