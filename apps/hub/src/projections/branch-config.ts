import { BranchConfigSnapshotSchemaV2, SNAPSHOT_SCHEMA_VERSION, type BranchConfig } from '@pos/events';
import type Database from 'better-sqlite3';
import type { ConfigEntry } from '../sync/branch-config-holder.js';
import { itemAvailabilityProjection } from './item-availability.js';
import type { Projection, ProjectionRegistry } from './registry.js';

export interface BranchConfigRow {
  branch_id: string;
  config_version: number;
  snapshot_schema_version: number;
  snapshot_hash: string;
  applied_at: number;
}

export type LoadedConfig =
  | { state: 'NONE' }
  | { state: 'BODY_MISSING'; row: BranchConfigRow }
  | { state: 'APPLIED'; row: BranchConfigRow; entry: ConfigEntry };

export const branchConfigProjection: Projection = {
  name: 'branch_config',
  eventTypes: ['BranchConfigApplied'],
  apply(tx, event) {
    const payload = event.payload as { config_version: number; snapshot_schema_version: number; snapshot_hash: string };
    tx.prepare(
      `INSERT INTO branch_config (branch_id, config_version, snapshot_schema_version, snapshot_hash, applied_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (branch_id) DO UPDATE SET
         config_version = excluded.config_version,
         snapshot_schema_version = excluded.snapshot_schema_version,
         snapshot_hash = excluded.snapshot_hash,
         applied_at = excluded.applied_at`,
    ).run(event.branch_id, payload.config_version, payload.snapshot_schema_version, payload.snapshot_hash, event.recorded_at);
  },
  reset(tx) {
    tx.prepare('DELETE FROM branch_config').run();
  },
};

export function readBranchConfigRow(db: Database.Database, branchId: string): BranchConfigRow | undefined {
  return db
    .prepare(
      `SELECT branch_id, config_version, snapshot_schema_version, snapshot_hash, applied_at
       FROM branch_config WHERE branch_id = ?`,
    )
    .get(branchId) as BranchConfigRow | undefined;
}

export function parseStoredSnapshot(body: string): BranchConfig {
  return BranchConfigSnapshotSchemaV2.parse(JSON.parse(body));
}

// S5, §3.2: 2 primary-key reads. A body that is absent or of another schema version is BODY_MISSING (S28 b).
export function loadBranchConfig(db: Database.Database, branchId: string): LoadedConfig {
  const row = readBranchConfigRow(db, branchId);
  if (row === undefined) return { state: 'NONE' };
  if (row.snapshot_schema_version !== SNAPSHOT_SCHEMA_VERSION) return { state: 'BODY_MISSING', row };
  const stored = db.prepare('SELECT body FROM config_snapshots WHERE snapshot_hash = ?').get(row.snapshot_hash) as
    | { body: string }
    | undefined;
  if (stored === undefined) return { state: 'BODY_MISSING', row };
  const raw = JSON.parse(stored.body) as { snapshot_schema_version?: unknown };
  if (raw.snapshot_schema_version !== SNAPSHOT_SCHEMA_VERSION) return { state: 'BODY_MISSING', row };
  return {
    state: 'APPLIED',
    row,
    entry: {
      config: BranchConfigSnapshotSchemaV2.parse(raw),
      snapshotHash: row.snapshot_hash,
      configVersion: row.config_version,
      snapshotSchemaVersion: row.snapshot_schema_version,
      appliedAt: row.applied_at,
    },
  };
}

export function registerRestaurantProjections(projections: ProjectionRegistry): void {
  projections.register(branchConfigProjection);
  projections.register(itemAvailabilityProjection);
}
