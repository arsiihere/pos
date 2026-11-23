import { afterEach, describe, expect, it } from 'vitest';
import { activity } from '../../src/auth/session-store';
import { createQueryRegistry, defineQuery } from '../../src/queries/registry';
import { ALI, BILAL, directoryWith, signInOn, withProfile } from '../helpers/device-access';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { z } from 'zod';

// 05a §6.8 (v1.0.2), H-6, M-8, plan task 20: the `devices` query on both routes, `RevokeDevice` on both routes.

const cleanups: Array<() => Promise<void>> = [];
let n = 0;

async function hub(people?: Parameters<typeof directoryWith>[0]): Promise<TestHub> {
  const h = await createTestHub();
  cleanups.push(() => h.close());
  await seedDirectory(h, await directoryWith(people));
  return h;
}

function listedSeat(h: TestHub, who = ALI, access: 'listed' | 'everyone' = 'listed') {
  const profile = access === 'listed' ? { access, staff_ids: [who], screens: ['manager' as const] } : { access, screens: ['manager' as const] };
  const device = pairDevice(h, { type: 'tablet', profile });
  const session = signInOn(h, device.deviceId, who);
  return { deviceId: device.deviceId, deviceToken: device.token, sessionToken: session.token };
}

const getDevices = (h: TestHub, s: { deviceToken: string; sessionToken: string }, query = '') =>
  h.app.inject({ method: 'GET', url: `/queries/devices${query}`, headers: { authorization: `Bearer ${s.deviceToken}`, 'x-session-token': s.sessionToken } });

describe('[05a §6.8] devices query', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    activity.drain();
    activity.drainDevices();
  });

  it('[05a #16] admin_warning is 0 with no listed admin device, 1 with one, null with two', async () => {
    const h = await hub();
    // An `everyone` device and a listed cashier (no manage-devices) do not count.
    listedSeat(h, ALI, 'everyone');
    withProfile(h, pairDevice(h, { type: 'tablet' }).deviceId, { access: 'listed', staff_ids: [BILAL], screens: ['manager'] });
    const adminGet = (token: string, deviceToken: string) =>
      h.app.inject({ method: 'GET', url: '/admin/queries/devices', headers: { authorization: `Bearer ${deviceToken}`, 'x-admin-session': token } });
    const bindAdmin = (staffId: string) => {
      const d = pairDevice(h, { type: 'tablet', profile: { access: 'listed', staff_ids: [staffId], screens: ['manager'] } });
      return { s: openSession(h, { kind: 'admin', staffId, deviceId: d.deviceId, legacyProfile: false }), d };
    };
    const one = bindAdmin(ALI);
    const r1 = await adminGet(one.s.token, one.d.token);
    expect(r1.statusCode).toBe(200);
    expect(r1.json().data.admin_warning).toBe(1);
    const two = bindAdmin('S_OWNER');
    const r2 = await adminGet(two.s.token, two.d.token);
    expect(r2.json().data.admin_warning).toBeNull();
    // 0: the listed admin devices are revoked (hub-admin session on no device still reads).
    for (const d of [one.d, two.d]) h.deps.db.prepare('UPDATE devices SET revoked_at = ? WHERE device_id = ?').run(h.clock.branchNow(), d.deviceId);
    const { loadDeviceProfiles } = await import('../../src/auth/device-profile');
    loadDeviceProfiles(h.deps.db);
    const bootstrap = openSession(h, { kind: 'admin', staffId: 'S_OWNER', deviceId: null });
    const r0 = await h.app.inject({ method: 'GET', url: '/admin/queries/devices', headers: { 'x-admin-session': bootstrap.token } });
    expect(r0.statusCode).toBe(200);
    expect(r0.json().data.admin_warning).toBe(0);
  });

  it('[05a §6.8] statement count = today (1; 2 with revoked) + 2, and staff adds none', async () => {
    const h = await hub();
    const s = listedSeat(h);
    const counter = statementCounter(h.deps.readDb);
    counter.reset();
    expect((await getDevices(h, s)).statusCode).toBe(200);
    expect(counter.count).toBe(3);
    h.deps.db.prepare('UPDATE devices SET revoked_at = ? WHERE device_id = ?').run(h.clock.branchNow(), pairDevice(h, { type: 'tablet' }).deviceId);
    counter.reset();
    expect((await getDevices(h, s, '?include_revoked=true')).statusCode).toBe(200);
    expect(counter.count).toBe(4);
  });

  it('[05a §6.8] rows add access, people, screens, point_id, profile_version, needs_review; pairing_source is gone', async () => {
    const h = await hub();
    const s = listedSeat(h);
    const row = ((await getDevices(h, s)).json().data.devices as Array<Record<string, unknown>>).find((d) => d.device_id === s.deviceId)!;
    expect(row).toMatchObject({
      access: 'listed',
      people: [{ staff_id: ALI, display_name: 'Ali' }],
      screens: ['manager'],
      point_id: null,
      profile_version: expect.any(Number),
      needs_review: false,
    });
    expect('pairing_source' in row).toBe(false);
  });

  it('[05a §6.8] pending_requests lists id, name, hint, created_at and never the display code', async () => {
    const h = await hub();
    const s = listedSeat(h);
    const now = h.clock.branchNow();
    h.deps.db
      .prepare(
        `INSERT INTO pair_requests (request_id, branch_id, poll_secret_hash, display_code, device_name, requester_ip, created_at, expires_at, hardware_hint)
         VALUES ('rq1', 'branch-1', 'h', 'CODE-4711', 'Back tablet', '10.0.0.9', ?, ?, 'tablet'),
                ('rq-old', 'branch-1', 'h', 'CODE-0001', 'Expired', '10.0.0.9', ?, ?, NULL)`,
      )
      .run(now, now + 60_000, now - 120_000, now - 60_000);
    const res = await getDevices(h, s);
    const body = res.json().data;
    expect(body.pending_requests).toEqual([{ request_id: 'rq1', device_name: 'Back tablet', hardware_hint: 'tablet', created_at: now }]);
    expect(res.body).not.toContain('CODE-4711');
    expect(res.body).not.toContain('display_code');
  });

  it('[05a §6.8 G-f] staff lists every directory person sorted by name', async () => {
    const h = await hub({ Zed: ['Cashier'], Ali: ['Manager'], Bilal: ['Cashier'] });
    const s = listedSeat(h, ALI);
    const body = (await getDevices(h, s)).json().data;
    const names = (body.staff as Array<{ display_name: string }>).map((p) => p.display_name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(body.staff).toEqual(expect.arrayContaining([{ staff_id: ALI, display_name: 'Ali' }, { staff_id: BILAL, display_name: 'Bilal' }, { staff_id: 'S_ZED', display_name: 'Zed' }]));
    expect(Object.keys(body.staff[0]).sort()).toEqual(['display_name', 'staff_id']);
  });

  it('[05a H-6] permission manage-devices through the session view: an `everyone` device → 403', async () => {
    const h = await hub();
    expect((await getDevices(h, listedSeat(h, ALI, 'everyone'))).statusCode).toBe(403);
    expect((await getDevices(h, listedSeat(h, BILAL))).statusCode).toBe(403);
    expect((await getDevices(h, listedSeat(h, ALI))).statusCode).toBe(200);
  });

  it('[05a H-6] a `both` query answers on both routes; a device or admin query is refused on the other route', async () => {
    const h = await hub();
    const s = listedSeat(h);
    const adminDevice = pairDevice(h, { type: 'tablet', profile: { access: 'listed', staff_ids: [ALI], screens: ['manager'] } });
    const admin = openSession(h, { kind: 'admin', staffId: ALI, deviceId: adminDevice.deviceId, legacyProfile: false });
    const onAdmin = await h.app.inject({ method: 'GET', url: '/admin/queries/devices', headers: { authorization: `Bearer ${adminDevice.token}`, 'x-admin-session': admin.token } });
    expect(onAdmin.statusCode).toBe(200);
    expect((await getDevices(h, s)).statusCode).toBe(200);
    // Wrong kind as today: a device-only query is not on the admin route; an admin-only one is not on /queries.
    const wrongAdmin = await h.app.inject({ method: 'GET', url: '/admin/queries/staff-roster', headers: { authorization: `Bearer ${adminDevice.token}`, 'x-admin-session': admin.token } });
    expect(wrongAdmin.statusCode).toBe(404);
    const wrongDevice = await h.app.inject({ method: 'GET', url: '/queries/sessions', headers: { authorization: `Bearer ${s.deviceToken}`, 'x-session-token': s.sessionToken } });
    expect(wrongDevice.statusCode).toBe(404);
    // The registry accepts the three kinds.
    const reg = createQueryRegistry();
    reg.register(defineQuery({ resource: 'x', sessionKind: 'both', session: 'none', querySchema: z.object({}), handle: () => ({ data: 1 }) }));
    expect(reg.byResource('x')?.sessionKind).toBe('both');
  });
});

describe('[05a §6.4] RevokeDevice on both routes (M-3)', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  const revoke = (h: TestHub, s: { deviceId: string; deviceToken: string; sessionToken: string }, target: string) =>
    h.app.inject({
      method: 'POST',
      url: '/commands/revoke-device',
      headers: { authorization: `Bearer ${s.deviceToken}`, 'x-session-token': s.sessionToken },
      payload: {
        command_id: `rv-${(n += 1)}`,
        tenant_id: 'tenant-a',
        branch_id: 'branch-1',
        command_type: 'RevokeDevice',
        payload: { device_id: target },
        occurred_at: h.clock.branchNow(),
        actor_id: ALI,
        device_id: s.deviceId,
      },
    });

  it('[05a M-3] from a listed device with manage-devices it works; from an `everyone` device → 403 listed_device_only', async () => {
    const h = await hub();
    const target = pairDevice(h, { type: 'tablet' });
    const denied = await revoke(h, listedSeat(h, ALI, 'everyone'), target.deviceId);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.details).toMatchObject({ permission: 'manage-devices', reason: 'listed_device_only' });
    const ok = await revoke(h, listedSeat(h), target.deviceId);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.result.already_revoked).toBe(false);
  });
});
