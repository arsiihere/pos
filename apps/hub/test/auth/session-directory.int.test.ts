import { LISTED_ONLY_PERMISSIONS, MONEY_PERMISSIONS, PERMISSIONS, type Permission, type Scope } from '@pos/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { deviceProfile, type DeviceProfile } from '../../src/auth/device-profile';
import { currentDirectory } from '../../src/auth/guards';
import { StaffDirectory } from '../../src/auth/staff-directory';
import { ALI, directoryWith } from '../helpers/device-access';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

// 05a §3.3a (00 §3.6, row H-3): the session view `directory.forSession(session)` masks the session's own grants on an
// `everyone` device (or a device with no profile, v1.0.1 R-1); listed devices, the bootstrap admin and other staff
// ids resolve unmasked. In memory, no statement.

const LISTED = new Set<Permission>(LISTED_ONLY_PERMISSIONS);
const MONEY = new Set<Permission>(MONEY_PERMISSIONS);
const OTHER = PERMISSIONS.filter((p) => !LISTED.has(p) && !MONEY.has(p));

const S_ALL = 'S_ALL'; // every permission allowed, scope my_floors
const S_ALL2 = 'S_ALL2'; // the same grants, another person
const S_REQ = 'S_REQ'; // every permission requires_approval
const S_DEN = 'S_DEN'; // every permission allowed, every listed-only and money one denied
const S_NONE = 'S_NONE'; // no role

function grants(grant_type: 'allowed' | 'requires_approval', scope: Scope) {
  return PERMISSIONS.map((permission) => ({
    permission,
    grant_type,
    approver_role_ids: grant_type === 'allowed' ? [] : ['R_ALL'],
    scope,
  }));
}

const staff = (staff_id: string, role_ids: string[], denied_permissions: string[] = []) => ({
  staff_id,
  display_name: staff_id,
  pin_hash: 'h',
  role_ids,
  denied_permissions,
  lead_staff_id: null,
  floor_ids: [],
});

const dir = StaffDirectory.fromInput({
  directory_version: 7,
  roles: [
    { role_id: 'R_ALL', name: 'All', session_idle_ttl_ms: 600_000, permissions: grants('allowed', 'my_floors') },
    { role_id: 'R_REQ', name: 'Req', session_idle_ttl_ms: 300_000, permissions: grants('requires_approval', 'branch') },
  ],
  staff: [
    staff(S_ALL, ['R_ALL']),
    staff(S_ALL2, ['R_ALL']),
    staff(S_REQ, ['R_REQ']),
    staff(S_DEN, ['R_ALL'], [...LISTED_ONLY_PERMISSIONS, ...MONEY_PERMISSIONS]),
    staff(S_NONE, []),
  ],
  responsibilities: [],
});

const EVERYONE: DeviceProfile = { access: 'everyone', staff_ids: new Set(), screens: ['takeaway'], point_id: null, needs_review: false };
const LISTED_DEV: DeviceProfile = { access: 'listed', staff_ids: new Set([S_ALL]), screens: ['manager'], point_id: null, needs_review: false };
const profiles: Record<string, DeviceProfile> = { D_EVERYONE: EVERYONE, D_LISTED: LISTED_DEV };
const profileOf = (id: string): DeviceProfile | undefined => profiles[id];

function expectEveryoneTable(view: { resolve(s: string, p: Permission): unknown }, staffId: string, scope: Scope): void {
  for (const p of LISTED_ONLY_PERMISSIONS) expect(view.resolve(staffId, p), p).toEqual({ grant: 'not_granted', masked: 'listed_only' });
  for (const p of MONEY_PERMISSIONS) {
    expect(view.resolve(staffId, p), p).toEqual({ grant: 'requires_approval', approver_role_ids: [], scope, masked: 'downgraded' });
  }
  for (const p of OTHER) expect(view.resolve(staffId, p), p).toEqual(dir.resolve(staffId, p));
}

function expectUnmasked(view: { resolve(s: string, p: Permission): unknown }, staffId: string): void {
  for (const p of PERMISSIONS) expect(view.resolve(staffId, p), p).toEqual(dir.resolve(staffId, p));
}

describe('[05a §3.3a] StaffDirectory.forSession', () => {
  it('[05a #4] everyone device: each listed-only `allowed` → not_granted / listed_only, each money `allowed` → downgraded (scope kept), others unchanged', () => {
    expectEveryoneTable(dir.forSession({ staff_id: S_ALL, device_id: 'D_EVERYONE' }, profileOf), S_ALL, 'my_floors');
  });

  it('[05a #4] everyone device: `requires_approval`, `denied` and `not_granted` grants are unchanged', () => {
    for (const s of [S_REQ, S_DEN, S_NONE]) expectUnmasked(dir.forSession({ staff_id: s, device_id: 'D_EVERYONE' }, profileOf), s);
    expect(dir.forSession({ staff_id: S_REQ, device_id: 'D_EVERYONE' }, profileOf).resolve(S_REQ, 'void-item')).toEqual({
      grant: 'requires_approval',
      approver_role_ids: ['R_ALL'],
      scope: 'branch',
    });
    expect(dir.forSession({ staff_id: S_DEN, device_id: 'D_EVERYONE' }, profileOf).resolve(S_DEN, 'manage-devices')).toEqual({ grant: 'denied' });
  });

  it('[05a #4] listed device and bootstrap session (no device) are unmasked', () => {
    expectUnmasked(dir.forSession({ staff_id: S_ALL, device_id: 'D_LISTED' }, profileOf), S_ALL);
    expectUnmasked(dir.forSession({ staff_id: S_ALL, device_id: null }, profileOf), S_ALL);
  });

  it('[05a #4] another staff id is never masked; a station session (no staff) masks nothing', () => {
    expectUnmasked(dir.forSession({ staff_id: S_ALL, device_id: 'D_EVERYONE' }, profileOf), S_ALL2);
    expectUnmasked(dir.forSession({ staff_id: null, device_id: 'D_EVERYONE' }, profileOf), S_ALL);
  });

  it('[05a §3.3a] hasAdmin, adminPermissions and permissionsOf go through the mask; other reads delegate', () => {
    const view = dir.forSession({ staff_id: S_ALL, device_id: 'D_EVERYONE' }, profileOf);
    expect(dir.hasAdmin(S_ALL)).toBe(true);
    expect(view.hasAdmin(S_ALL)).toBe(false);
    expect(view.hasAdmin(S_ALL2)).toBe(true);
    expect(view.adminPermissions(S_ALL)).toEqual({ 'manage-devices': false, 'manage-staff': false, 'manage-fiscal-settings': false, 'close-business-day': true });
    const map = view.permissionsOf(S_ALL);
    for (const p of PERMISSIONS) expect(map[p], p).toEqual(view.resolve(S_ALL, p));
    expect(view.version).toBe(7);
    expect(view.get(S_ALL)).toEqual(dir.get(S_ALL));
    expect(view.list()).toEqual(dir.list());
    expect(view.ttlFor(S_ALL)).toBe(600_000);
    expect(view.roleNames(S_ALL)).toEqual(['All']);
  });

  it('[05a §3.3a] the view reads the profile at each resolve (an edit applies to an open view)', () => {
    let current: DeviceProfile | undefined = LISTED_DEV;
    const view = dir.forSession({ staff_id: S_ALL, device_id: 'D_X' }, () => current);
    expect(view.resolve(S_ALL, 'manage-devices').grant).toBe('allowed');
    current = EVERYONE;
    expect(view.resolve(S_ALL, 'manage-devices')).toEqual({ grant: 'not_granted', masked: 'listed_only' });
  });
});

describe('[05a RF-1] a staff device with no profile masks like `everyone` (v1.0.1 R-1)', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function hub(): Promise<TestHub> {
    const h = await createTestHub();
    cleanups.push(() => h.close());
    await seedDirectory(h, await directoryWith());
    return h;
  }

  it('[05a RF-1] tablet, cashier_kiosk and phone with no profile: every listed-only entry not_granted / listed_only, every money entry downgraded; no statement', async () => {
    const h = await hub();
    const raw = currentDirectory(h.app);
    const devices = [
      pairDevice(h, { type: 'tablet' }).deviceId,
      pairDevice(h, { type: 'cashier_kiosk' }).deviceId,
      pairDevice(h, { type: 'phone', ownerStaffId: ALI }).deviceId,
    ];
    const counter = statementCounter(h.deps.db);
    for (const deviceId of devices) {
      expect(deviceProfile(deviceId)).toBeUndefined();
      const view = raw.forSession({ staff_id: ALI, device_id: deviceId }, deviceProfile);
      for (const p of LISTED_ONLY_PERMISSIONS) {
        if (raw.resolve(ALI, p).grant !== 'allowed') continue; // Manager lacks manage-roles
        expect(view.resolve(ALI, p), `${deviceId} ${p}`).toEqual({ grant: 'not_granted', masked: 'listed_only' });
      }
      for (const p of MONEY_PERMISSIONS) {
        expect(view.resolve(ALI, p), `${deviceId} ${p}`).toEqual({ grant: 'requires_approval', approver_role_ids: [], scope: 'branch', masked: 'downgraded' });
      }
      for (const p of OTHER) expect(view.resolve(ALI, p), p).toEqual(raw.resolve(ALI, p));
    }
    expect(counter.count).toBe(0);
  });
});
