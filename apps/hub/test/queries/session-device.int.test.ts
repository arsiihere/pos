import { LISTED_ONLY_PERMISSIONS, MONEY_PERMISSIONS, PERMISSIONS } from '@pos/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { currentDirectory } from '../../src/auth/guards';
import { ALI, directoryWith, signInOn, withProfile } from '../helpers/device-access';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

// 05a §6.7 (00 §6.20): `GET /queries/session` adds `device: { device_id, screens, access, point_id }`, and each
// `permissions[p]` is the session view's resolution (§3.3a) with `masked` when masked. Query count 0 (memory).

describe('[05a §6.7] GET /queries/session — device block and masked permissions', () => {
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

  const get = (h: TestHub, deviceToken: string, sessionToken: string) =>
    h.app.inject({ method: 'GET', url: '/queries/session', headers: { authorization: `Bearer ${deviceToken}`, 'x-session-token': sessionToken } });

  it('[05a #4g] `everyone` device: listed-only grants `not_granted / listed_only`, money grants `requires_approval / downgraded`, the rest as the directory; device block; query count 0', async () => {
    const h = await hub();
    const device = pairDevice(h, { type: 'tablet', profile: { access: 'everyone', screens: ['dine_in', 'manager'] } });
    const session = signInOn(h, device.deviceId, ALI);
    const counter = statementCounter(h.deps.readDb);
    const res = await get(h, device.token, session.token);
    expect(counter.count).toBe(0);
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.device).toEqual({ device_id: device.deviceId, screens: ['dine_in', 'manager'], access: 'everyone', point_id: null });
    const raw = currentDirectory(h.app);
    const listedOnly = new Set<string>(LISTED_ONLY_PERMISSIONS);
    const money = new Set<string>(MONEY_PERMISSIONS);
    let masked = 0;
    for (const p of PERMISSIONS) {
      const r = raw.resolve(ALI, p);
      if (r.grant === 'allowed' && listedOnly.has(p)) {
        expect(data.permissions[p], p).toEqual({ grant: 'not_granted', masked: 'listed_only' });
        masked += 1;
      } else if (r.grant === 'allowed' && money.has(p)) {
        expect(data.permissions[p], p).toEqual({ grant: 'requires_approval', approver_role_ids: [], scope: r.scope, masked: 'downgraded' });
        masked += 1;
      } else {
        expect(data.permissions[p], p).toEqual(r);
      }
    }
    // The Manager holds both kinds, so both branches above ran.
    expect(data.permissions['manage-devices'].masked).toBe('listed_only');
    expect(data.permissions['void-item'].masked).toBe('downgraded');
    expect(masked).toBeGreaterThan(2);
  });

  it('[05a #4g] listed device: nothing masked (no `masked` key anywhere); device block with its point', async () => {
    const h = await hub();
    const device = pairDevice(h, { type: 'phone', ownerStaffId: ALI, profile: { access: 'listed', staff_ids: [ALI], screens: ['pass', 'dine_in'], point_id: 'pt-1' } });
    const session = signInOn(h, device.deviceId, ALI);
    const data = (await get(h, device.token, session.token)).json().data;
    expect(data.device).toEqual({ device_id: device.deviceId, screens: ['pass', 'dine_in'], access: 'listed', point_id: 'pt-1' });
    expect(data.permissions).toEqual(currentDirectory(h.app).permissionsOf(ALI));
    expect(Object.values(data.permissions).some((r) => Object.hasOwn(r as object, 'masked'))).toBe(false);
  });

  it('[05a RF-5] a device offline during an edit: on reconnect GET /queries/session returns the current screens, access and masks (no `device_profile` push needed)', async () => {
    const h = await hub();
    const device = pairDevice(h, { type: 'tablet', profile: { access: 'listed', staff_ids: [ALI], screens: ['dine_in', 'takeaway'] } });
    const session = signInOn(h, device.deviceId, ALI);
    expect((await get(h, device.token, session.token)).json().data.device.screens).toEqual(['dine_in', 'takeaway']);
    // The edit while the device is away: no socket, so the push is missed; the session is not ended.
    withProfile(h, device.deviceId, { access: 'everyone', screens: ['cashier', 'manager'] });
    const data = (await get(h, device.token, session.token)).json().data;
    expect(data.device).toEqual({ device_id: device.deviceId, screens: ['cashier', 'manager'], access: 'everyone', point_id: null });
    expect(data.permissions['manage-devices']).toEqual({ grant: 'not_granted', masked: 'listed_only' });
  });

  it('[05a §6.7, R-1] a staff device with no profile: device block `everyone` with no screens, and masked permissions', async () => {
    const h = await hub();
    const device = pairDevice(h, { type: 'cashier_kiosk' });
    const session = signInOn(h, device.deviceId, ALI);
    const data = (await get(h, device.token, session.token)).json().data;
    expect(data.device).toEqual({ device_id: device.deviceId, screens: [], access: 'everyone', point_id: null });
    expect(data.permissions['manage-devices']).toEqual({ grant: 'not_granted', masked: 'listed_only' });
  });
});
