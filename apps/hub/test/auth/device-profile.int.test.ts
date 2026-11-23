import type { DeviceProfileSetPayload, EventDraft } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { deviceProfile, listedAdminDeviceCount, loadDeviceProfiles } from '../../src/auth/device-profile';
import { StaffDirectory } from '../../src/auth/staff-directory';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, pairDevice, type TestHub } from '../helpers/test-hub';

// 05a §4.2 `deviceProfile(device_id)` (memory, refreshed after DeviceProfileSet / DevicePaired / DeviceRevoked
// commits) and M-8's count of unrevoked `listed` devices listing someone whose unmasked manage-devices is allowed.

function draft(h: TestHub, event_type: string, stream_id: string, payload: unknown): EventDraft {
  return { stream_type: 'hub', stream_id, event_type, schema_version: 1, payload, occurred_at: h.clock.branchNow(), actor_id: 'S_MGR', device_id: 'hub-admin' } as EventDraft;
}

function setProfile(h: TestHub, p: Partial<DeviceProfileSetPayload> & { device_id: string }): void {
  const payload: DeviceProfileSetPayload = {
    device_name: 'D', access: 'everyone', staff_ids: [], screens: ['dine_in'], point_id: null, profile_version: 1, cause: 'edited', needs_review: false, ...p,
  };
  h.deps.writer.run((tx) => tx.append([draft(h, 'DeviceProfileSet', p.device_id, payload)]));
}

function revoke(h: TestHub, deviceId: string): void {
  h.deps.writer.run((tx) => {
    tx.db.prepare('UPDATE devices SET revoked_at = ?, revoked_by = ? WHERE device_id = ?').run(h.clock.branchNow(), 'S_MGR', deviceId);
    tx.append([draft(h, 'DeviceRevoked', deviceId, { device_id: deviceId, reason: null, cause: 'manual' })]);
  });
}

describe('[05a §4.2] deviceProfile memory map', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function hub(): Promise<TestHub> {
    const h = await createTestHub();
    cleanups.push(() => h.close());
    return h;
  }

  it('[05a §4.2] loaded from the projection at server build (boot, after catch-up), in 1 statement', async () => {
    const h = await hub();
    const { deviceId } = pairDevice(h, { type: 'tablet' });
    // Rows the projection holds before this server was built (as after boot's catch-up).
    h.deps.db.prepare(`INSERT INTO device_profiles VALUES (?, 'listed', '["pass","dine_in"]', 3, 1)`).run(deviceId);
    h.deps.db.prepare(`INSERT INTO device_people VALUES (?, 'S_MGR'), (?, 'S_CASH')`).run(deviceId, deviceId);
    h.deps.db.prepare(`UPDATE devices SET point_id = 'pt-1' WHERE device_id = ?`).run(deviceId);
    expect(deviceProfile(deviceId)).toBeUndefined();
    const counter = statementCounter(h.deps.db);
    loadDeviceProfiles(h.deps.db);
    expect(counter.count).toBe(1);
    expect(deviceProfile(deviceId)).toEqual({ access: 'listed', staff_ids: new Set(['S_MGR', 'S_CASH']), screens: ['pass', 'dine_in'], point_id: 'pt-1', needs_review: true });
    // The server build (boot step 5, after the step-4 catch-up; the test hub likewise) reloads the map from its db:
    // a second hub on an empty db replaces it.
    await hub();
    expect(deviceProfile(deviceId)).toBeUndefined();
  });

  it('[05a §4.2] refreshed after a DeviceProfileSet commit; a read runs no statement', async () => {
    const h = await hub();
    const { deviceId } = pairDevice(h, { type: 'cashier_kiosk' });
    expect(deviceProfile(deviceId)).toBeUndefined();
    setProfile(h, { device_id: deviceId, access: 'listed', staff_ids: ['S_MGR'], screens: ['takeaway', 'cashier'], point_id: 'pt-2' });
    const counter = statementCounter(h.deps.db);
    expect(deviceProfile(deviceId)).toEqual({ access: 'listed', staff_ids: new Set(['S_MGR']), screens: ['takeaway', 'cashier'], point_id: 'pt-2', needs_review: false });
    expect(listedAdminDeviceCount(StaffDirectory.fromInput(await aDirectory()))).toBe(1);
    expect(counter.count).toBe(0);
    setProfile(h, { device_id: deviceId, access: 'everyone', staff_ids: [], screens: ['takeaway'], profile_version: 2, cause: 'directory', needs_review: true });
    expect(deviceProfile(deviceId)).toEqual({ access: 'everyone', staff_ids: new Set(), screens: ['takeaway'], point_id: null, needs_review: true });
  });

  it('[05a §4.2] refreshed after a DevicePaired commit', async () => {
    const h = await hub();
    const { deviceId } = pairDevice(h, { type: 'tablet' });
    h.deps.db.prepare(`INSERT INTO device_profiles VALUES (?, 'everyone', '["dine_in"]', 1, 0)`).run(deviceId);
    expect(deviceProfile(deviceId)).toBeUndefined();
    h.deps.writer.run((tx) =>
      tx.append([draft(h, 'DevicePaired', deviceId, { device_id: deviceId, device_name: 'tablet', device_type: 'tablet', station_id: null, owner_staff_id: null, pairing_token_id: null, pairing_request_id: 'req-1' })]),
    );
    expect(deviceProfile(deviceId)).toEqual({ access: 'everyone', staff_ids: new Set(), screens: ['dine_in'], point_id: null, needs_review: false });
  });

  it('[05a §4.2] a commit with none of the three events does not reload (0 statements by the map)', async () => {
    const h = await hub();
    const { deviceId } = pairDevice(h, { type: 'tablet' });
    h.deps.db.prepare(`INSERT INTO device_profiles VALUES (?, 'everyone', '["dine_in"]', 1, 0)`).run(deviceId);
    // 05a K-1 (board PC-2 re-check): a DeviceRoleSet point is no longer written to devices.point_id, so the profile
    // map cannot go stale on it
    h.deps.writer.run((tx) => tx.append([draft(h, 'DeviceRoleSet', deviceId, { device_id: deviceId, point_id: 'P9', lane_label: null })]));
    expect(deviceProfile(deviceId)).toBeUndefined();
    expect(h.deps.db.prepare('SELECT point_id FROM devices WHERE device_id = ?').get(deviceId)).toEqual({ point_id: null });
  });

  it('[05a RF-2] after DeviceRevoked, deviceProfile(id) is undefined and the M-8 count drops the device', async () => {
    const h = await hub();
    const dir = StaffDirectory.fromInput(await aDirectory());
    const a = pairDevice(h, { type: 'phone', ownerStaffId: 'S_MGR' }).deviceId;
    const b = pairDevice(h, { type: 'tablet' }).deviceId;
    setProfile(h, { device_id: a, access: 'listed', staff_ids: ['S_MGR'] });
    setProfile(h, { device_id: b, access: 'listed', staff_ids: ['S_OWNER'] });
    expect(listedAdminDeviceCount(dir)).toBe(2);
    revoke(h, a);
    expect(deviceProfile(a)).toBeUndefined();
    expect(deviceProfile(b)).toBeDefined();
    expect(listedAdminDeviceCount(dir)).toBe(1);
  });

  it('[05a M-8] listedAdminDeviceCount: 0 / 1 / 2 (everyone devices and listed devices with no manage-devices holder do not count); no statement', async () => {
    const h = await hub();
    const input = await aDirectory();
    const dir = StaffDirectory.fromInput(input);
    const kiosk = pairDevice(h, { type: 'cashier_kiosk' }).deviceId;
    const cashTab = pairDevice(h, { type: 'tablet' }).deviceId;
    const mgrPhone = pairDevice(h, { type: 'phone', ownerStaffId: 'S_MGR' }).deviceId;
    const mixed = pairDevice(h, { type: 'tablet' }).deviceId;
    setProfile(h, { device_id: kiosk, access: 'everyone' });
    setProfile(h, { device_id: cashTab, access: 'listed', staff_ids: ['S_CASH', 'S_WAIT'] });
    const counter = statementCounter(h.deps.db);
    expect(listedAdminDeviceCount(dir)).toBe(0);
    setProfile(h, { device_id: mgrPhone, access: 'listed', staff_ids: ['S_MGR'] });
    counter.reset();
    expect(listedAdminDeviceCount(dir)).toBe(1);
    setProfile(h, { device_id: mixed, access: 'listed', staff_ids: ['S_CASH', 'S_OWNER'] });
    counter.reset();
    expect(listedAdminDeviceCount(dir)).toBe(2);
    // a listed device naming two admins counts once
    const twoAdmins = pairDevice(h, { type: 'tablet' }).deviceId;
    setProfile(h, { device_id: twoAdmins, access: 'listed', staff_ids: ['S_MGR', 'S_OWNER'] });
    counter.reset();
    expect(listedAdminDeviceCount(dir)).toBe(3);
    expect(counter.count).toBe(0);
    // unmasked resolve: a person denied manage-devices does not count
    const denied = StaffDirectory.fromInput({
      ...input,
      staff: input.staff.map((s) => (s.staff_id === 'S_MGR' ? { ...s, denied_permissions: ['manage-devices'] } : s)),
    });
    expect(listedAdminDeviceCount(denied)).toBe(2);
  });
});
