import { capacityForLanes } from '@pos/engine';
import type { BranchConfig, LanesSetPayload, PosEvent, StationCapacitySetPayload, StationScreenSetPayload } from '@pos/events';
import type Database from 'better-sqlite3';
import { loadBranchConfig } from '../projections/branch-config.js';
import type { Projection, ProjectionRegistry } from '../projections/registry.js';
import { branchConfig } from '../sync/branch-config-holder.js';

// 03b §5: projection `kds_config` (with reset) over kds_station_settings and station_lanes. §3.8 sound volume; §3.7
// lane mirror: the fold sees one event at a time, every lane-reason StationCapacitySet applies the inverse of
// capacityForLanes, a following LanesSet in the same commit sets lanes_on exactly (last write wins). Station numbers
// come from branchConfig() (memory). In catch-up with no config in memory (boot step 4 runs before step 5 loads it),
// the stored applied config is read once per catch-up (loadBranchConfig, 2 statements) and kept until the catch-up
// ends, so a rebuild equals live (§5). The fold is total: an unknown station or no config folds to `custom`.

export const KDS_CONFIG_EVENT_TYPES: readonly string[] = ['StationScreenSet', 'StationCapacitySet', 'LanesSet', 'BusinessDayOpened'];

/** §3.7 / H-6: `kds` devices of the station with a lane_label, not revoked; none → 1. 1 statement. */
export function laneCount(db: Database.Database, station_id: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM devices
       WHERE device_type = 'kds' AND station_id = ? AND lane_label IS NOT NULL AND revoked_at IS NULL`,
    )
    .get(station_id) as { n: number };
  return Math.max(1, row.n);
}

/**
 * §3.7 inverse: lanes_on for a StationCapacitySet, or null (`custom`). Null override → all on (any reason); `manager`
 * → custom; lane reasons → a k in 1…lane_count with capacityForLanes(station, k, lane_count) = override, ties →
 * smallest k for `lane_off`, largest for `lane_on`; no match (or no station numbers) → custom.
 */
export function lanesForOverride(
  station: { capacity: number; lane_units: number | null } | undefined,
  capacity_override: number | null,
  reason: StationCapacitySetPayload['reason'],
  lane_count: number,
): number | null {
  if (capacity_override === null) return lane_count;
  if (reason === 'manager' || station === undefined) return null;
  const matches: number[] = [];
  for (let k = 1; k <= lane_count; k += 1) {
    if (capacityForLanes(station, k, lane_count) === capacity_override) matches.push(k);
  }
  if (matches.length === 0) return null;
  return reason === 'lane_off' ? matches[0]! : matches[matches.length - 1]!;
}

// The config read for this catch-up (per db); cleared after every catch-up and on any live fold.
let catchUpConfig: { db: Database.Database; config: BranchConfig | null } | null = null;

function configFor(tx: Database.Database, event: PosEvent, mode: 'live' | 'catchup'): BranchConfig | null {
  const held = branchConfig();
  if (held !== null || mode === 'live') return held;
  if (catchUpConfig === null || catchUpConfig.db !== tx) {
    const loaded = loadBranchConfig(tx, event.branch_id);
    catchUpConfig = { db: tx, config: loaded.state === 'APPLIED' ? loaded.entry.config : null };
  }
  return catchUpConfig.config;
}

/** §5: registers `kds_config` and clears its catch-up config after each catch-up (boot createDeps, the test hub). */
export function registerKdsConfigProjection(projections: ProjectionRegistry): void {
  projections.register(kdsConfigProjection());
  projections.afterCatchUp(() => {
    catchUpConfig = null;
  });
}

/** §5: the `kds_config` projection. */
export function kdsConfigProjection(): Projection {
  return {
    name: 'kds_config',
    eventTypes: [...KDS_CONFIG_EVENT_TYPES],
    apply(tx, event, mode) {
      if (mode === 'live') catchUpConfig = null;
      applyKdsConfig(tx, event, mode);
    },
    reset(tx) {
      tx.prepare('DELETE FROM kds_station_settings').run();
      tx.prepare('DELETE FROM station_lanes').run();
    },
  };
}

function upsertLanes(tx: Database.Database, station_id: string, lanes_on: number | null, lane_count: number): void {
  tx.prepare(
    `INSERT INTO station_lanes (station_id, lanes_on, lane_count) VALUES (?, ?, ?)
     ON CONFLICT (station_id) DO UPDATE SET lanes_on = excluded.lanes_on, lane_count = excluded.lane_count`,
  ).run(station_id, lanes_on, lane_count);
}

function applyKdsConfig(tx: Database.Database, event: PosEvent, mode: 'live' | 'catchup'): void {
  switch (event.event_type) {
    case 'StationScreenSet': {
      const p = event.payload as StationScreenSetPayload;
      tx.prepare(
        `INSERT INTO kds_station_settings (station_id, sound_volume) VALUES (?, ?)
         ON CONFLICT (station_id) DO UPDATE SET sound_volume = excluded.sound_volume`,
      ).run(p.station_id, p.sound_volume);
      return;
    }
    case 'StationCapacitySet': {
      const p = event.payload as StationCapacitySetPayload;
      const lane_count = laneCount(tx, p.station_id);
      // station numbers only when the inverse needs them (a lane reason with an override)
      const needsStation = p.capacity_override !== null && p.reason !== 'manager';
      const station = needsStation ? configFor(tx, event, mode)?.stations.find((s) => s.station_id === p.station_id) : undefined;
      upsertLanes(tx, p.station_id, lanesForOverride(station, p.capacity_override, p.reason, lane_count), lane_count);
      return;
    }
    case 'LanesSet': {
      const p = event.payload as LanesSetPayload;
      upsertLanes(tx, p.station_id, p.lanes_on, p.lane_count);
      return;
    }
    case 'BusinessDayOpened':
      // §3.7: every lane back on at day open (no row = all on); sound volume is kept.
      tx.prepare('DELETE FROM station_lanes').run();
      return;
    default:
      return;
  }
}
