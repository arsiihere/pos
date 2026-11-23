import type {
  DevicePairedPayload,
  DeviceProfileSetPayload,
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
// ⚠️ Changed by 05a (row D-1) (05a §3.8): the binding follows the device's latest DeviceProfileSet, kept in this
// projection's own `device_id → profile` map from events (no `device_profiles` read, so reset + replay is exact):
// - `listed` with exactly one person P (any hardware) → permanent row (device_id, P, session_id NULL), replacing any
//   session row; session events never touch it (the WHERE of the SessionStarted upsert, m2).
// - away from one person → the permanent row goes; the next SessionStarted binds by the hardware rule, where a
//   phone with a profile (`everyone` or several people) follows the tablet rule.
// - no profile yet (replay before the device's first DeviceProfileSet) → the rules by hardware above.
// DeviceProfileSet: 0 reads, 1 statement.

type DeviceType = z.infer<typeof DevicePairedPayload>['device_type'];
/** 05a §3.8: what the bindings need of a device's latest profile. A device with no entry has no profile yet. */
type ProfileShape = 'one_person' | 'other';

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
  const profiles = new Map<string, ProfileShape>();

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
    eventTypes: ['DevicePaired', 'DeviceRevoked', 'SessionStarted', 'SessionEnded', 'BusinessDayClosed', 'DeviceProfileSet'],
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
        case 'DeviceProfileSet': {
          // 05a §3.8 transitions: to one person P → upsert the permanent row; away from one person → delete it.
          const p = event.payload as DeviceProfileSetPayload;
          const person = p.access === 'listed' && p.staff_ids.length === 1 ? p.staff_ids[0]! : null;
          profiles.set(p.device_id, person === null ? 'other' : 'one_person');
          if (person !== null) {
            tx.prepare(
              `INSERT INTO device_bindings (device_id, staff_id, session_id, since) VALUES (?, ?, NULL, ?)
               ON CONFLICT (device_id) DO UPDATE SET staff_id = excluded.staff_id, session_id = NULL, since = excluded.since`,
            ).run(p.device_id, person, event.recorded_at);
          } else {
            tx.prepare('DELETE FROM device_bindings WHERE device_id = ? AND session_id IS NULL').run(p.device_id);
          }
          return;
        }
        case 'DeviceRevoked': {
          const p = event.payload as z.infer<typeof DeviceRevokedPayload>;
          tx.prepare('DELETE FROM device_bindings WHERE device_id = ?').run(p.device_id);
          return;
        }
        case 'SessionStarted':
          return applyStarted(tx, event, typeOf, profiles);
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
      profiles.clear();
      tx.prepare('DELETE FROM device_bindings').run();
    },
  };
}

function applyStarted(
  tx: Database.Database,
  event: PosEvent,
  typeOf: (tx: Database.Database, deviceId: string) => DeviceType | undefined,
  profiles: ReadonlyMap<string, ProfileShape>,
): void {
  const p = event.payload as z.infer<typeof SessionStartedPayload>;
  if (p.kind !== 'staff' || p.staff_id === null || p.device_id === null) return;
  const profile = profiles.get(p.device_id);
  if (profile === 'one_person') return; // 05a §3.8: the permanent row is never touched by sessions
  const type = typeOf(tx, p.device_id);
  // BF-3: a kiosk or KDS binds no one. A phone with no profile yet: its row belongs to its owner and is never
  // touched by sessions (m2); a phone with a profile here (`everyone` or several people) follows the tablet
  // rule (05a §3.8). A device unknown to both the map and `devices` follows the tablet rule (§3.7 default).
  if (type !== undefined && (UNBOUND_TYPES.has(type) || (type === 'phone' && profile === undefined))) return;
  // The WHERE keeps a permanent row (session_id NULL: a phone owner or one-person profile) in every case (m2).
  tx.prepare(
    `INSERT INTO device_bindings (device_id, staff_id, session_id, since) VALUES (?, ?, ?, ?)
     ON CONFLICT (device_id) DO UPDATE SET staff_id = excluded.staff_id, session_id = excluded.session_id, since = excluded.since
     WHERE device_bindings.session_id IS NOT NULL`,
  ).run(p.device_id, p.staff_id, p.session_id, event.recorded_at);
}
