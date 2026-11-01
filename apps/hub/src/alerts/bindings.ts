import type {
  DevicePairedPayload,
  DeviceRevokedPayload,
  PosEvent,
  SessionEndedPayload,
  SessionStartedPayload,
} from '@pos/events';
import type Database from 'better-sqlite3';
import type { z } from 'zod';
import type { Projection } from '../projections/registry.js';

// 01d §3.7, §5.2 row 4, BF-3: the `device_bindings` projection — which person each device is bound to,
// for alert routing (§3.4.3). Derived from session events; no new event; `since` is the event's recorded_at.
// - phone: its owner from DevicePaired (session_id NULL); session events never touch it (m2); ends on DeviceRevoked.
// - tablet: the last signed-in person (SessionStarted kind 'staff' upserts by device_id with its session_id).
// - cashier_kiosk, kds: no row at all (BF-3).
// The device type comes from DevicePaired, kept in this projection's own map (rebuilt on replay). When the
// map does not know a device (the hub restarted with the checkpoint at or near the tip, so DevicePaired was
// not replayed into memory), one read of `devices` by id fills it. Reads ≤ 1 per event (budget 2, §3.5 M10).

type DeviceType = z.infer<typeof DevicePairedPayload>['device_type'];

// §3.7: the SessionEnded reasons that end the binding (DELETE WHERE session_id = ?). `idle_timeout` and
// `replaced` keep the row; `taken_over` leaves it for the new session's SessionStarted to overwrite.
const ENDING_REASONS: ReadonlySet<z.infer<typeof SessionEndedPayload>['reason']> = new Set([
  'logout',
  'forced',
  'staff_removed',
  'credentials_changed',
  'device_revoked',
  'hub_restored',
]);

const UNBOUND_TYPES: ReadonlySet<DeviceType> = new Set(['cashier_kiosk', 'kds']);

export function deviceBindingsProjection(): Projection {
  const types = new Map<string, DeviceType>();

  function typeOf(tx: Database.Database, deviceId: string): DeviceType | undefined {
    const known = types.get(deviceId);
    if (known !== undefined) return known;
    const row = tx.prepare('SELECT device_type FROM devices WHERE device_id = ?').get(deviceId) as
      | { device_type: DeviceType }
      | undefined;
    if (row !== undefined) types.set(deviceId, row.device_type);
    return row?.device_type;
  }

  return {
    name: 'device_bindings',
    eventTypes: ['DevicePaired', 'DeviceRevoked', 'SessionStarted', 'SessionEnded', 'BusinessDayClosed'],
    apply(tx, event) {
      switch (event.event_type) {
        case 'DevicePaired': {
          const p = event.payload as z.infer<typeof DevicePairedPayload>;
          types.set(p.device_id, p.device_type);
          if (p.device_type === 'phone' && p.owner_staff_id !== null) {
            tx.prepare(
              `INSERT INTO device_bindings (device_id, staff_id, session_id, since) VALUES (?, ?, NULL, ?)
               ON CONFLICT (device_id) DO UPDATE SET staff_id = excluded.staff_id, session_id = NULL, since = excluded.since`,
            ).run(p.device_id, p.owner_staff_id, event.recorded_at);
          }
          return;
        }
        case 'DeviceRevoked': {
          const p = event.payload as z.infer<typeof DeviceRevokedPayload>;
          tx.prepare('DELETE FROM device_bindings WHERE device_id = ?').run(p.device_id);
          return;
        }
        case 'SessionStarted':
          return applyStarted(tx, event, typeOf);
        case 'SessionEnded': {
          const p = event.payload as z.infer<typeof SessionEndedPayload>;
          if (ENDING_REASONS.has(p.reason)) tx.prepare('DELETE FROM device_bindings WHERE session_id = ?').run(p.session_id);
          return;
        }
        case 'BusinessDayClosed':
          tx.prepare('DELETE FROM device_bindings WHERE session_id IS NOT NULL').run();
          return;
      }
    },
    reset(tx) {
      types.clear();
      tx.prepare('DELETE FROM device_bindings').run();
    },
  };
}

function applyStarted(
  tx: Database.Database,
  event: PosEvent,
  typeOf: (tx: Database.Database, deviceId: string) => DeviceType | undefined,
): void {
  const p = event.payload as z.infer<typeof SessionStartedPayload>;
  if (p.kind !== 'staff' || p.staff_id === null || p.device_id === null) return;
  const type = typeOf(tx, p.device_id);
  // BF-3: a kiosk or KDS binds no one; a phone row belongs to its owner and is never touched by sessions (m2).
  // A device unknown to both the map and `devices` follows the tablet rule (§3.7 default).
  if (type !== undefined && (UNBOUND_TYPES.has(type) || type === 'phone')) return;
  // The WHERE keeps a phone owner row (session_id NULL) even if the type were unknown (m2).
  tx.prepare(
    `INSERT INTO device_bindings (device_id, staff_id, session_id, since) VALUES (?, ?, ?, ?)
     ON CONFLICT (device_id) DO UPDATE SET staff_id = excluded.staff_id, session_id = excluded.session_id, since = excluded.since
     WHERE device_bindings.session_id IS NOT NULL`,
  ).run(p.device_id, p.staff_id, p.session_id, event.recorded_at);
}
