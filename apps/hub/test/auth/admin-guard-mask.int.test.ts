import { afterEach, describe, expect, it } from 'vitest';
import { ALI, directoryWith, withProfile } from '../helpers/device-access';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

// 05a §3.3a (00 §3.6 row H-3): the admin guard (`requireAdmin` -> `hasAdmin`) and the direct routes that resolve for
// their session (`print/routes.ts` `requireManageDevices`) read the session's view. Their 403 details do not change
// (N-6: no `reason`). §10 #4b printer half, #4d 403 half.

interface Seat {
  deviceId: string;
  deviceToken: string;
  adminToken: string;
}

describe('[05a §3.3a] admin guard and direct routes through the session view', () => {
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

  // An admin session bound to the device, as `/admin/auth` writes it.
  function seat(h: TestHub, access: 'everyone' | 'listed'): Seat {
    const profile = access === 'listed' ? { access, staff_ids: [ALI], screens: ['manager' as const] } : { access, screens: ['manager' as const] };
    const device = pairDevice(h, { type: 'tablet', profile });
    const admin = openSession(h, { kind: 'admin', staffId: ALI, deviceId: device.deviceId, legacyProfile: false });
    return { deviceId: device.deviceId, deviceToken: device.token, adminToken: admin.token };
  }

  const headers = (s: Seat) => ({ authorization: `Bearer ${s.deviceToken}`, 'x-admin-session': s.adminToken });
  const devices = (h: TestHub, s: Seat) => h.app.inject({ method: 'GET', url: '/admin/queries/devices', headers: headers(s) });
  const printTest = (h: TestHub, s: Seat) =>
    h.app.inject({ method: 'POST', url: '/admin/print/test', headers: headers(s), payload: { printer_id: 'no-such-printer' } });
  const fiscal = (h: TestHub, s: Seat) => h.app.inject({ method: 'GET', url: '/admin/queries/fiscal-credentials', headers: headers(s) });

  it('[05a #4d] an admin session bound to a device switched to `everyone`: the next /admin/queries/devices → 403 (guard details unchanged)', async () => {
    const h = await hub();
    const s = seat(h, 'listed');
    expect((await devices(h, s)).statusCode).toBe(200);
    withProfile(h, s.deviceId, { access: 'everyone', screens: ['manager'] });
    const res = await devices(h, s);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toEqual(expect.objectContaining({ code: 'PERMISSION_DENIED', details: { permission: 'access-hub-admin' } }));
    withProfile(h, s.deviceId, { access: 'listed', staff_ids: [ALI], screens: ['manager'] });
    expect((await devices(h, s)).statusCode).toBe(200);
  });

  it('[05a #4d] an admin session on a device with no profile (R-1) → 403; the bootstrap admin session (no device) is not masked', async () => {
    const h = await hub();
    const bare = pairDevice(h, { type: 'cashier_kiosk' });
    const admin = openSession(h, { kind: 'admin', staffId: ALI, deviceId: bare.deviceId, legacyProfile: false });
    const res = await devices(h, { deviceId: bare.deviceId, deviceToken: bare.token, adminToken: admin.token });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.details).toEqual({ permission: 'access-hub-admin' });
    const bootstrap = openSession(h, { kind: 'admin', staffId: ALI });
    const boot = await h.app.inject({ method: 'GET', url: '/admin/queries/devices', headers: { 'x-admin-session': bootstrap.token } });
    expect(boot.statusCode).toBe(200);
  });

  it('[05a #4b] printer route on an `everyone` device → 403 with no `reason`; on a listed device the permission step passes', async () => {
    const h = await hub();
    const res = await printTest(h, seat(h, 'everyone'));
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PERMISSION_DENIED');
    expect(res.json().error.details).not.toHaveProperty('reason');
    expect((await printTest(h, seat(h, 'listed'))).json().error.code).toBe('PRINTER_NOT_FOUND');
  });

  it('[05a #4b] the in-handler checks read the view too: a device switched to `everyone` after the guard passed → the printer route and the fiscal query answer 403 with their own details', async () => {
    const h = await hub();
    const s = seat(h, 'listed');
    // The edit lands between the guard (onRequest) and the handler: only the handler's own check can refuse.
    let flip = false;
    h.app.addHook('preHandler', async () => {
      if (!flip) return;
      flip = false;
      withProfile(h, s.deviceId, { access: 'everyone', screens: ['manager'] });
    });
    const relist = () => withProfile(h, s.deviceId, { access: 'listed', staff_ids: [ALI], screens: ['manager'] });

    flip = true;
    const printer = await printTest(h, s);
    expect(printer.statusCode).toBe(403);
    expect(printer.json().error).toEqual(expect.objectContaining({ code: 'PERMISSION_DENIED', details: { permission: 'manage-devices', grant: 'not_granted' } }));

    relist();
    flip = true;
    const credentials = await fiscal(h, s);
    expect(credentials.statusCode).toBe(403);
    expect(credentials.json().error).toEqual(
      expect.objectContaining({ code: 'PERMISSION_DENIED', details: { permission: 'manage-fiscal-settings', grant: 'not_granted' } }),
    );
  });
});
