import type { ScreenKey } from '@pos/domain';
import type { PosEvent } from '@pos/events';
import type Database from 'better-sqlite3';
import type { StaffDirectory } from './staff-directory.js';

// 05a §4.2: memory map device_id → profile of every unrevoked staff device with a `device_profiles` row. Built at
// server build (after boot's projection catch-up; 1 statement) and rebuilt (1 statement) after every commit with
// DeviceProfileSet, DevicePaired or DeviceRevoked (the `kds/device-roles.ts` pattern). Reads run no statement.

export type DeviceProfile = {
  access: 'everyone' | 'listed';
  staff_ids: ReadonlySet<string>;
  screens: readonly ScreenKey[];
  point_id: string | null;
  needs_review: boolean;
};

/** The events whose commit refreshes the map (§4.2). */
export const DEVICE_PROFILE_EVENT_TYPES: ReadonlySet<string> = new Set(['DeviceProfileSet', 'DevicePaired', 'DeviceRevoked']);

const LOAD_SQL = `
  SELECT p.device_id, p.access, p.screens, p.needs_review, d.point_id,
         (SELECT json_group_array(staff_id) FROM device_people dp WHERE dp.device_id = p.device_id) AS staff_ids
    FROM device_profiles p
    JOIN devices d ON d.device_id = p.device_id
   WHERE d.revoked_at IS NULL`;

interface LoadRow {
  device_id: string;
  access: 'everyone' | 'listed';
  screens: string;
  needs_review: number;
  point_id: string | null;
  staff_ids: string;
}

let profiles = new Map<string, DeviceProfile>();

/** Rebuilds the map from `device_profiles` ⋈ `devices` (1 statement). */
export function loadDeviceProfiles(db: Database.Database): void {
  const rows = db.prepare(LOAD_SQL).all() as LoadRow[];
  const next = new Map<string, DeviceProfile>();
  for (const row of rows) {
    next.set(row.device_id, {
      access: row.access,
      staff_ids: new Set(JSON.parse(row.staff_ids) as string[]),
      screens: JSON.parse(row.screens) as ScreenKey[],
      point_id: row.point_id,
      needs_review: row.needs_review === 1,
    });
  }
  profiles = next;
}

/** §4.2 `deviceProfile(device_id)`: memory, 0 statements. Undefined for a revoked, kds or profile-less device. */
export function deviceProfile(device_id: string): DeviceProfile | undefined {
  return profiles.get(device_id);
}

/**
 * M-8: unrevoked `listed` devices listing at least one person whose **unmasked** `manage-devices` resolves
 * `allowed`. Memory and the directory, 0 statements.
 */
export function listedAdminDeviceCount(dir: StaffDirectory): number {
  let count = 0;
  for (const profile of profiles.values()) {
    if (profile.access !== 'listed') continue;
    for (const staffId of profile.staff_ids) {
      if (dir.resolve(staffId, 'manage-devices').grant === 'allowed') {
        count += 1;
        break;
      }
    }
  }
  return count;
}

/** `writer.addAfterCommit` hook: rebuild the map when the commit holds one of the three events. */
export function refreshDeviceProfilesAfter(db: Database.Database): (appended: PosEvent[]) => void {
  return (appended) => {
    if (appended.some((e) => DEVICE_PROFILE_EVENT_TYPES.has(e.event_type))) loadDeviceProfiles(db);
  };
}
