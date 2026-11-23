import { afterEach, describe, expect, it } from 'vitest';
import { registerStationValidator } from '../../src/auth/station-validator';
import { pairByRequest } from './pair-by-request';
import { createTestHub, seedDirectory, type TestHub } from './test-hub';

const cleanups: Array<() => Promise<void>> = [];

describe('pairByRequest fixture', () => {
  afterEach(async () => {
    registerStationValidator(() => false);
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  // TASK-15-EDIT: the profile count of 1 stays right only once the fixture stops double-writing; update with the fixture.
  it('[05a #13 fixture] a cashier_kiosk paired by request has a working token, a device row paired by the approver and an optional profile', async () => {
    const hub: TestHub = await createTestHub();
    cleanups.push(() => hub.close());
    await seedDirectory(hub);
    const kiosk = await pairByRequest(hub, {
      device_type: 'cashier_kiosk',
      hardware_hint: 'tablet', // a hint that differs from the approved type: the fixture never relies on it (05a §6.1)
      profile: { access: 'everyone', screens: ['cashier'] },
    });
    const row = hub.deps.db.prepare('SELECT device_type, paired_by FROM devices WHERE device_id = ?').get(kiosk.deviceId);
    expect(row).toEqual({ device_type: 'cashier_kiosk', paired_by: 'S_OWNER' });
    expect(kiosk.poll).toMatchObject({ status: 'approved', device_type: 'cashier_kiosk', device_token: kiosk.token });
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM device_profiles WHERE device_id = ?').pluck().get(kiosk.deviceId)).toBe(1);
    const other = await pairByRequest(hub, { device_type: 'cashier_kiosk' });
    expect(other.deviceId).not.toBe(kiosk.deviceId);
  });

  it('[05a #13 fixture] a kds needs its station; tablet and phone are refused until task 15', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    await seedDirectory(hub);
    registerStationValidator((_tx, id) => id === 'STATION-1');
    const kds = await pairByRequest(hub, { device_type: 'kds', station_id: 'STATION-1' });
    expect(kds.poll).toMatchObject({ device_type: 'kds', station_id: 'STATION-1' });
    await expect(pairByRequest(hub, { device_type: 'tablet' })).rejects.toThrow(/task 15/);
  });
});
