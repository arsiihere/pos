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
