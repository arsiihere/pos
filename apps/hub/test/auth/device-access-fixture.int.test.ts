import { afterEach, describe, expect, it } from 'vitest';
import { deviceProfile } from '../../src/auth/device-profile';
import { currentDirectory } from '../../src/auth/guards';
import { ALI, BILAL, directoryWith, signInOn, withProfile } from '../helpers/device-access';
import { createTestHub, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

// 05a §10 fixture self-test (plan task 8): profiles through the writer, a sign-in on a device, the directory.

describe('[05a §10] device-access fixture', () => {
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

  it('[05a §10] directoryWith: roles Manager, Cashier, Waiter, Floor manager; Ali (Manager) and Bilal (Cashier)', async () => {
    const h = await hub();
    const dir = currentDirectory(h.app);
    expect(dir.get(ALI)?.display_name).toBe('Ali');
    expect(dir.get(BILAL)?.display_name).toBe('Bilal');
    expect(dir.roleNames(ALI)).toEqual(['Manager']);
    expect(dir.roleNames(BILAL)).toEqual(['Cashier']);
    expect(dir.resolve(ALI, 'manage-devices').grant).toBe('allowed');
    expect(dir.resolve(BILAL, 'manage-devices').grant).toBe('not_granted');
    const input = await directoryWith({ Ali: ['Floor manager', 'Waiter'] });
    expect(input.roles.map((r) => r.name)).toEqual(expect.arrayContaining(['Manager', 'Cashier', 'Waiter', 'Floor manager']));
    expect(input.staff.find((s) => s.staff_id === ALI)?.role_ids).toEqual(['R_FLOOR', 'R_WAIT']);
    expect(input.staff.some((s) => s.staff_id === BILAL)).toBe(false);
  });

  it('[05a §10] pairDevice({ profile }) appends DeviceProfileSet v1 through the writer: projection and map see it', async () => {
    const h = await hub();
    const { deviceId } = pairDevice(h, { type: 'tablet', name: 'Pass 1', profile: { access: 'listed', staff_ids: [ALI], screens: ['pass', 'dine_in'], point_id: 'pt-1' } });
    const event = h.published.flat().find((e) => e.event_type === 'DeviceProfileSet');
    expect(event).toMatchObject({
      stream_type: 'hub',
      stream_id: deviceId,
      schema_version: 1,
      payload: { device_id: deviceId, device_name: 'Pass 1', access: 'listed', staff_ids: [ALI], screens: ['pass', 'dine_in'], point_id: 'pt-1', profile_version: 1, cause: 'approved', needs_review: false },
    });
    expect(deviceProfile(deviceId)).toEqual({ access: 'listed', staff_ids: new Set([ALI]), screens: ['pass', 'dine_in'], point_id: 'pt-1', needs_review: false });
    expect(h.deps.db.prepare('SELECT point_id FROM devices WHERE device_id = ?').get(deviceId)).toEqual({ point_id: 'pt-1' });
  });

  it('[05a §10] pairDevice without profile leaves the device with none (the RF-1 case)', async () => {
    const h = await hub();
    const { deviceId } = pairDevice(h, { type: 'tablet' });
    expect(deviceProfile(deviceId)).toBeUndefined();
  });

  it('[05a §4.2 N-4] withProfile bumps profile_version and replaces the whole profile', async () => {
    const h = await hub();
    const { deviceId } = pairDevice(h, { type: 'cashier_kiosk', profile: { access: 'everyone', screens: ['takeaway', 'cashier'] } });
    withProfile(h, deviceId, { access: 'listed', staff_ids: [ALI, BILAL], screens: ['cashier'] });
    expect(h.deps.db.prepare('SELECT profile_version FROM device_profiles WHERE device_id = ?').get(deviceId)).toEqual({ profile_version: 2 });
    const last = h.published.flat().filter((e) => e.event_type === 'DeviceProfileSet').at(-1);
    expect(last?.payload).toMatchObject({ device_name: 'cashier_kiosk', cause: 'edited', profile_version: 2, staff_ids: [ALI, BILAL], point_id: null });
    expect(deviceProfile(deviceId)?.staff_ids).toEqual(new Set([ALI, BILAL]));
  });

  it('[05a §10] signInOn opens a staff session on the device for the person', async () => {
    const h = await hub();
    const { deviceId } = pairDevice(h, { type: 'phone', ownerStaffId: ALI, profile: { access: 'listed', staff_ids: [ALI], screens: ['dine_in'] } });
    const { sessionId, token } = signInOn(h, deviceId, ALI);
    expect(token).toEqual(expect.any(String));
    expect(h.deps.db.prepare('SELECT kind, staff_id, device_id, ended_at FROM staff_sessions WHERE session_id = ?').get(sessionId)).toEqual({ kind: 'staff', staff_id: ALI, device_id: deviceId, ended_at: null });
  });
});
