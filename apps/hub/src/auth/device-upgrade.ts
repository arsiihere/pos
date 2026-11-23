import type { ScreenKey } from '@pos/domain';
import type { DeviceProfileSetPayload, EventDraft } from '@pos/events';
import type Database from 'better-sqlite3';
import type { Writer } from '../engine-host/writer.js';
import type { Clock } from '../lib/clock.js';

// 05a §5.3, §6.10 (M-12, N-5): the upgrade boot step. After the projection catch-up (so `device_profiles` is current)
// and before listen: 1 read (unrevoked non-kds devices with no profile), then one writer.run appending one
// `DeviceProfileSet { cause: 'upgrade', needs_review: true, profile_version: 1 }` per device, carrying its current
// `point_id`; `actor_id` null, `device_id 'hub'` (00 M72). Idempotent: a device with a profile is skipped, so a second
// boot appends nothing.

const UNPROFILED_SQL = `
  SELECT d.device_id, d.device_name, d.device_type, d.owner_staff_id, d.point_id
    FROM devices d
    LEFT JOIN device_profiles p ON p.device_id = d.device_id
   WHERE d.revoked_at IS NULL AND d.device_type <> 'kds' AND p.device_id IS NULL
   ORDER BY d.paired_at, d.device_id`;

interface UnprofiledRow {
  device_id: string;
  device_name: string;
  device_type: 'tablet' | 'cashier_kiosk' | 'phone';
  owner_staff_id: string | null;
  point_id: string | null;
}

/** §5.3 table: each hardware's screens; `pass` goes first whenever the device has a point (N-5). */
const UPGRADE_SCREENS: Record<UnprofiledRow['device_type'], readonly ScreenKey[]> = {
  cashier_kiosk: ['takeaway', 'parking', 'dine_in', 'cashier', 'manager'],
  tablet: ['dine_in', 'takeaway', 'parking', 'cashier', 'manager'],
  phone: ['dine_in', 'takeaway', 'parking', 'manager'],
};

/** §5.3: the upgrade profile of one paired device (kiosk / tablet → `everyone`; phone → `listed` [its owner]). */
export function upgradeProfile(row: UnprofiledRow): DeviceProfileSetPayload {
  const listed = row.device_type === 'phone';
  return {
    device_id: row.device_id,
    device_name: row.device_name,
    access: listed ? 'listed' : 'everyone',
    staff_ids: listed && row.owner_staff_id !== null ? [row.owner_staff_id] : [], // ownerless phones are skipped
    screens: row.point_id === null ? [...UPGRADE_SCREENS[row.device_type]] : ['pass', ...UPGRADE_SCREENS[row.device_type]],
    point_id: row.point_id,
    profile_version: 1,
    cause: 'upgrade',
    needs_review: true,
  };
}

/**
 * §6.10: appends the upgrade profiles; returns how many devices it upgraded (0 → no writer.run). A phone with no
 * `owner_staff_id` (only reachable by raw SQL since 0027; 0002 forbade it) would get an invalid `listed` profile with
 * no people (§5.2): it is skipped and left unprofiled (masked as `everyone`, no PIN accepted: D-6), and its id goes to
 * `onSkipped` for a warning.
 */
export function upgradeDevices(
  deps: { db: Database.Database; writer: Writer; clock: Clock },
  onSkipped?: (device_ids: string[]) => void,
): number {
  const all = deps.db.prepare(UNPROFILED_SQL).all() as UnprofiledRow[];
  const ownerless = (row: UnprofiledRow): boolean => row.device_type === 'phone' && row.owner_staff_id === null;
  const skipped = all.filter(ownerless).map((row) => row.device_id);
  if (skipped.length > 0) onSkipped?.(skipped);
  const rows = all.filter((row) => !ownerless(row));
  if (rows.length === 0) return 0;
  deps.writer.run((tx) => {
    const occurred_at = deps.clock.branchNow();
    const drafts: EventDraft[] = rows.map((row) => ({
      stream_type: 'hub',
      stream_id: row.device_id,
      event_type: 'DeviceProfileSet',
      schema_version: 1,
      payload: upgradeProfile(row),
      occurred_at,
      actor_id: null,
      device_id: 'hub',
    }));
    tx.append(drafts);
  });
  return rows.length;
}
