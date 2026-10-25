import type { BranchConfig } from '@pos/events';

export interface ConfigEntry {
  config: BranchConfig;
  snapshotHash: string;
  configVersion: number;
  snapshotSchemaVersion: number;
  appliedAt: number;
}
