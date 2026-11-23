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

  it('[05a #13 fixture] a cashier_kiosk paired by request has a working token, a device row paired by the approver and its profile from the approve payload (one DeviceProfileSet)', async () => {
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
    expect(hub.deps.db.prepare('SELECT access, screens FROM device_profiles WHERE device_id = ?').all(kiosk.deviceId)).toEqual([{ access: 'everyone', screens: '["cashier"]' }]);
    expect(hub.deps.db.prepare(`SELECT COUNT(*) FROM events WHERE event_type = 'DeviceProfileSet' AND stream_id = ?`).pluck().get(kiosk.deviceId)).toBe(1);
    const other = await pairByRequest(hub, { device_type: 'cashier_kiosk' });
    expect(other.deviceId).not.toBe(kiosk.deviceId);
  });

  it('[05a #13 fixture] a kds needs its station and has no profile; tablet and phone pair with the §6.3 form defaults (task 15)', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    await seedDirectory(hub);
    registerStationValidator((_tx, id) => id === 'STATION-1');
    const kds = await pairByRequest(hub, { device_type: 'kds', station_id: 'STATION-1' });
    expect(kds.poll).toMatchObject({ device_type: 'kds', station_id: 'STATION-1' });
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM device_profiles WHERE device_id = ?').pluck().get(kds.deviceId)).toBe(0);
    const tablet = await pairByRequest(hub, { device_type: 'tablet' });
    const phone = await pairByRequest(hub, { device_type: 'phone' });
    const profile = (id: string) => hub.deps.db.prepare('SELECT access, screens FROM device_profiles WHERE device_id = ?').get(id);
    expect(profile(tablet.deviceId)).toEqual({ access: 'everyone', screens: '["dine_in","manager"]' });
    expect(profile(phone.deviceId)).toEqual({ access: 'listed', screens: '["dine_in"]' });
    expect(hub.deps.db.prepare('SELECT staff_id FROM device_people WHERE device_id = ?').pluck().all(phone.deviceId)).toEqual(['S_OWNER']);
  });
});
