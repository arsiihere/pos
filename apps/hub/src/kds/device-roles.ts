import type { DeviceRoleSetPayload, PosEvent } from '@pos/events';
import type Database from 'better-sqlite3';
import { cachedPrepare } from '../alerts/statements.js';
import { targetKey, type ResolvedTarget, type TargetResolver } from '../alerts/targets.js';
import type { Projection } from '../projections/registry.js';

// 03b §3.8, §5: projection `device_roles` (forward-only: DeviceRoleSet → devices.lane_label, 00 H-6; 05a K-1: the
// DeviceProfileSet fold is the one writer of devices.point_id) and the memory maps device_id → point_id (`devicePoint`,
// every non-kds device with a point = a "Pass tablet", 05a K-1) and station_id → paired, unrevoked `kds` devices (screen
// stations, §3.1). The maps are built at server build (1 statement) and rebuilt (1 statement) after every commit
// with DeviceRoleSet, DevicePaired, DeviceRevoked or DeviceProfileSet. G-1: the `point` target resolver (01d §3.4).

/** The events whose commit refreshes the maps (§3.8). */
export const DEVICE_MAP_EVENT_TYPES: ReadonlySet<string> = new Set(['DeviceRoleSet', 'DevicePaired', 'DeviceRevoked', 'DeviceProfileSet']);

const MAPS_SQL = `
  SELECT device_id, device_type, station_id, point_id FROM devices
   WHERE revoked_at IS NULL AND (point_id IS NOT NULL OR device_type = 'kds')`;

interface MapRow {
  device_id: string;
  device_type: string;
  station_id: string | null;
  point_id: string | null;
}

let pointByDevice = new Map<string, string>();
let kdsByStation = new Map<string, string[]>();

/** Rebuilds both maps from `devices` (1 statement). */
export function loadDeviceMaps(db: Database.Database): void {
  const rows = db.prepare(MAPS_SQL).all() as MapRow[];
  const points = new Map<string, string>();
  const stations = new Map<string, string[]>();
  for (const row of rows) {
    // 03b §3.1 (05a K-1): a Pass tablet is a non-kds device with a point; a kds device is never one
    if (row.point_id !== null && row.device_type !== 'kds') points.set(row.device_id, row.point_id);
    if (row.device_type === 'kds' && row.station_id !== null) {
      const list = stations.get(row.station_id);
      if (list === undefined) stations.set(row.station_id, [row.device_id]);
      else list.push(row.device_id);
    }
  }
  pointByDevice = points;
  kdsByStation = stations;
}

/** §4.2 `devicePoint`: memory, 0 statements. */
export function devicePointOf(device_id: string): string | null {
  return pointByDevice.get(device_id) ?? null;
}

/** §3.1 screen stations: station_id → its paired, unrevoked `kds` devices (memory, 0 statements). */
export function screenStations(): ReadonlyMap<string, readonly string[]> {
  return kdsByStation;
}

/** `writer.addAfterCommit` hook: rebuild the maps when the commit holds a device event. */
export function refreshDeviceMapsAfter(db: Database.Database): (appended: PosEvent[]) => void {
  return (appended) => {
    if (appended.some((e) => DEVICE_MAP_EVENT_TYPES.has(e.event_type))) loadDeviceMaps(db);
  };
}

/** §5: the `device_roles` projection (forward-only, no reset: `devices` is not rebuilt from events). Total. */
export function deviceRolesProjection(): Projection {
  return {
    name: 'device_roles',
    eventTypes: ['DeviceRoleSet'],
    apply(tx, event) {
      if (event.event_type !== 'DeviceRoleSet') return;
      const p = event.payload as DeviceRoleSetPayload;
      // 05a K-1 (N-11): lane_label only; a historic event's point_id is superseded by the device's DeviceProfileSet
      tx.prepare('UPDATE devices SET lane_label = ? WHERE device_id = ?').run(p.lane_label, p.device_id);
    },
  };
}

// G-1: one statement for every asked point — its unrevoked non-kds devices (05a K-1) and the staff with an open staff
// session on them.
const POINT_SQL = `
  SELECT d.point_id AS point_id, d.device_id AS device_id, s.staff_id AS staff_id
    FROM json_each(@point_ids) j
    JOIN devices d ON d.point_id = j.value AND d.device_type <> 'kds' AND d.revoked_at IS NULL
    LEFT JOIN staff_sessions s ON s.device_id = d.device_id AND s.ended_at IS NULL AND s.kind = 'staff'
   ORDER BY d.device_id`;

/** 01d §3.4 `point` (03b §3.8, G-1). A point with no Pass device gets no entry (01d reads a missing key as no recipients). */
export const pointResolver: TargetResolver<'point'> = (tx, targets) => {
  const ids = [...new Set(targets.map((t) => t.point_id))];
  const rows = cachedPrepare(tx.db, POINT_SQL).all({ point_ids: JSON.stringify(ids) }) as Array<{
    point_id: string;
    device_id: string;
    staff_id: string | null;
  }>;
  const out = new Map<string, ResolvedTarget>();
  for (const row of rows) {
    const key = targetKey({ kind: 'point', point_id: row.point_id });
    let entry = out.get(key);
    if (entry === undefined) {
      entry = { staff_ids: [], device_ids: [] };
      out.set(key, entry);
    }
    if (!entry.device_ids.includes(row.device_id)) entry.device_ids.push(row.device_id);
    if (row.staff_id !== null && !entry.staff_ids.includes(row.staff_id)) entry.staff_ids.push(row.staff_id);
  }
  return out;
};
