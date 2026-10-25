import type { BranchConfig } from '@pos/events';

export interface ConfigEntry {
  config: BranchConfig;
  snapshotHash: string;
  configVersion: number;
  snapshotSchemaVersion: number;
  appliedAt: number;
}

let current: ConfigEntry | null = null;

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
