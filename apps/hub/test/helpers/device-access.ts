import { PERMISSIONS } from '@pos/domain';
import type { DirectoryInput } from '@pos/events';
import { aDirectory, PIN, pinHash } from './fixtures';
import { appendDeviceProfile, openSession, type DeviceProfileInput, type TestHub } from './test-hub';

// 05a §10 test fixtures (plan task 8): device profiles through the writer, a session on a device, and a directory
// with the four roles the §10 cases name (Manager, Cashier, Waiter, Floor manager) and the people Ali and Bilal.

export const ALI = 'S_ALI';
export const BILAL = 'S_BILAL';

export type RoleName = 'Manager' | 'Cashier' | 'Waiter' | 'Floor manager';

const ROLE_IDS: Record<RoleName, string> = { Manager: 'R_MGR', Cashier: 'R_CASH', Waiter: 'R_WAIT', 'Floor manager': 'R_FLOOR' };

/**
 * Appends a `DeviceProfileSet` for the device through the writer (the projection and the `deviceProfile` map see it).
 * `profile_version` = the previous one + 1 (05a §4.2 N-4); `device_name` = the device's current name.
 */
export function withProfile(h: TestHub, deviceId: string, p: DeviceProfileInput): void {
  appendDeviceProfile(h, deviceId, p);
}

/**
 * A staff session for the person on the device, written straight to the session store. It **bypasses the PIN path**
 * (`POST /auth/pin`): no §3.5 sign-in check, no argon2, no counter. Tests of §3.5, the staff roster or `/admin/auth`
 * (plan tasks 17, 18) must use the real routes, not this helper.
 */
export function signInOn(h: TestHub, deviceId: string, staffId: string): { sessionId: string; token: string } {
  return openSession(h, { kind: 'staff', staffId, deviceId });
}

/**
 * `aDirectory()` plus the role `Floor manager` (void-item, approve-void allowed), `R_WAIT` named `Waiter`, and the
 * people of `people` (name → roles). Default: Ali = Manager (PIN 0123), Bilal = Cashier (PIN 999999). Staff ids are
 * `S_<NAME>`; a name listed with no roles is omitted.
 */
export async function directoryWith(people: Partial<Record<string, RoleName[]>> = { Ali: ['Manager'], Bilal: ['Cashier'] }): Promise<DirectoryInput> {
  const base = await aDirectory();
  const pins = [await pinHash(PIN.b), await pinHash(PIN.c)];
  const floor = {
    role_id: ROLE_IDS['Floor manager'],
    name: 'Floor manager',
    session_idle_ttl_ms: 1_800_000,
    permissions: PERMISSIONS.filter((p) => p === 'void-item' || p === 'approve-void').map((permission) => ({
      permission,
      grant_type: 'allowed' as const,
      approver_role_id: null,
      approver_role_ids: [],
      scope: 'branch' as const,
    })),
  };
  const roles = [...base.roles.map((r) => (r.role_id === 'R_WAIT' ? { ...r, name: 'Waiter' } : r)), floor];
  const staff = Object.entries(people)
    .filter((entry): entry is [string, RoleName[]] => entry[1] !== undefined && entry[1].length > 0)
    .map(([name, roleNames], index) => ({
      staff_id: `S_${name.toUpperCase()}`,
      display_name: name,
      pin_hash: pins[index % pins.length]!,
      role_ids: roleNames.map((r) => ROLE_IDS[r]).sort(),
      denied_permissions: [],
      lead_staff_id: null,
      floor_ids: [],
    }));
  return { ...base, roles, staff: [...base.staff, ...staff] };
}
