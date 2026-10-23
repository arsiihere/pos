import { afterEach, describe, expect, it } from 'vitest';
import { activity } from '../../src/auth/session-store';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, endSessionNow, openSession, pairDevice, seedDirectory } from '../helpers/test-hub';

describe('auth route guards', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    activity.drain();
    activity.drainDevices();
  });

  it('[00 §10 #98] at TTL + 1 s before any sweep a command returns 401 SESSION_EXPIRED and the row is ended idle_timeout', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    await seedDirectory(hub);
    const device = pairDevice(hub, { type: 'tablet' });
    const session = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: device.deviceId });
    hub.app.post('/commands/noop', { config: { group: 'device-session' } }, async (request) => ({
      data: {
        device_id: request.device?.device_id,
        session_id: request.session?.session_id,
        auth_gen: request.authGen,
      },
    }));
    const ttl = hub.deps.db.prepare('SELECT idle_ttl_ms FROM staff_sessions WHERE session_id = ?').pluck().get(session.sessionId) as number;
    hub.clock.advance(ttl);
    const alive = await hub.app.inject({
      method: 'POST',
      url: '/commands/noop',
      headers: { authorization: `Bearer ${device.token}`, 'x-session-token': session.token },
    });
    expect(alive.statusCode).toBe(200);
    expect(alive.json().data).toEqual({
      device_id: device.deviceId,
      session_id: session.sessionId,
      auth_gen: hub.deps.authGeneration.current(),
    });
    expect(activity.get(session.sessionId)).toBeUndefined();
    expect(activity.deviceSeenAt(device.deviceId)).toBe(hub.clock.branchNow());
    expect(activity.drainDevices()).toEqual([[device.deviceId, hub.clock.branchNow()]]);
    expect(activity.deviceSeenAt(device.deviceId)).toBeUndefined();
    hub.clock.advance(1);
    const expired = await hub.app.inject({
      method: 'POST',
      url: '/commands/noop',
      headers: { authorization: `Bearer ${device.token}`, 'x-session-token': session.token },
    });
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error.code).toBe('SESSION_EXPIRED');
    const row = hub.deps.db.prepare('SELECT ended_at, end_reason FROM staff_sessions WHERE session_id = ?').get(session.sessionId) as {
      ended_at: number;
      end_reason: string;
    };
    expect(row).toEqual({ ended_at: hub.clock.branchNow(), end_reason: 'idle_timeout' });
    expect(activity.get(session.sessionId)).toBeUndefined();
    expect(sessionEndedReasons(hub, session.sessionId)).toEqual(['idle_timeout']);
    const quiet = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: device.deviceId });
    const eventsBefore = hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get() as number;
    hub.clock.advance(ttl + 1);
    const quietResponse = await hub.app.inject({
      method: 'GET',
      url: '/queries/test-quiet',
      headers: { authorization: `Bearer ${device.token}`, 'x-session-token': quiet.token },
    });
    expect(quietResponse.statusCode).toBe(401);
    expect(quietResponse.json().error.code).toBe('SESSION_EXPIRED');
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get()).toBe(eventsBefore + 1);
    expect(sessionEndedReasons(hub, quiet.sessionId)).toEqual(['idle_timeout']);
  });

  it('[00 §10 #106] access-hub-admin removed makes the next admin request 403', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    await seedDirectory(hub);
    const device = pairDevice(hub, { type: 'tablet' });
    const admin = openSession(hub, { kind: 'admin', staffId: 'S_MGR', deviceId: device.deviceId });
    hub.app.get('/admin/queries/devices', { config: { group: 'admin' } }, async () => ({ data: { ok: true } }));
    const before = await hub.app.inject({
      method: 'GET',
      url: '/admin/queries/devices',
      headers: { authorization: `Bearer ${device.token}`, 'x-admin-session': admin.token },
    });
    expect(before.statusCode).toBe(200);
    const next = await aDirectory({ directory_version: 2 });
    const manager = next.roles.find((role) => role.role_id === 'R_MGR');
    if (manager === undefined) throw new Error('fixture has no manager role');
    manager.permissions = manager.permissions.filter((permission) => permission.permission !== 'access-hub-admin');
    await seedDirectory(hub, next);
    const denied = await hub.app.inject({
      method: 'GET',
      url: '/admin/queries/devices',
      headers: { authorization: `Bearer ${device.token}`, 'x-admin-session': admin.token },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('PERMISSION_DENIED');
    expect(denied.json().error.details).toEqual({ permission: 'access-hub-admin' });
    expect(hub.deps.db.prepare('SELECT ended_at FROM staff_sessions WHERE session_id = ?').pluck().get(admin.sessionId)).toBeNull();
  });

  it('[00 §10 #115] ADMIN_SESSION_REQUIRED for missing, unknown, ended, staff-kind token and other device', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    await seedDirectory(hub);
    const device = pairDevice(hub, { type: 'tablet' });
    const other = pairDevice(hub, { type: 'cashier_kiosk' });
    const admin = openSession(hub, { kind: 'admin', staffId: 'S_MGR', deviceId: device.deviceId });
    const staff = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: device.deviceId });
    const ended = openSession(hub, { kind: 'admin', staffId: 'S_OWNER', deviceId: device.deviceId });
    endSessionNow(hub, ended.sessionId);
    hub.app.get('/admin/queries/devices', { config: { group: 'admin' } }, async () => ({ data: { ok: true } }));
    const cases: Array<{ name: string; headers: Record<string, string> }> = [
      { name: 'missing', headers: { authorization: `Bearer ${device.token}` } },
      { name: 'unknown', headers: { authorization: `Bearer ${device.token}`, 'x-admin-session': 'no-such-token' } },
      { name: 'ended', headers: { authorization: `Bearer ${device.token}`, 'x-admin-session': ended.token } },
      { name: 'staff', headers: { authorization: `Bearer ${device.token}`, 'x-admin-session': staff.token } },
      { name: 'other-device', headers: { authorization: `Bearer ${other.token}`, 'x-admin-session': admin.token } },
    ];
    for (const entry of cases) {
      const response = await hub.app.inject({ method: 'GET', url: '/admin/queries/devices', headers: entry.headers });
      expect(response.statusCode, entry.name).toBe(401);
      expect(response.json().error.code, entry.name).toBe('ADMIN_SESSION_REQUIRED');
    }
    const idle = openSession(hub, { kind: 'admin', staffId: 'S_MGR', deviceId: other.deviceId });
    const ttl = hub.deps.db.prepare('SELECT idle_ttl_ms FROM staff_sessions WHERE session_id = ?').pluck().get(idle.sessionId) as number;
    hub.clock.advance(ttl + 1);
    const idleResponse = await hub.app.inject({
      method: 'GET',
      url: '/admin/queries/devices',
      headers: { authorization: `Bearer ${other.token}`, 'x-admin-session': idle.token },
    });
    expect(idleResponse.statusCode).toBe(401);
    expect(idleResponse.json().error.code).toBe('ADMIN_SESSION_REQUIRED');
    expect(hub.deps.db.prepare('SELECT end_reason FROM staff_sessions WHERE session_id = ?').pluck().get(idle.sessionId)).toBe('idle_timeout');
    expect(sessionEndedReasons(hub, idle.sessionId)).toEqual(['idle_timeout']);
    const bootstrap = openSession(hub, { kind: 'admin', staffId: 'S_OWNER' });
    const opened = await hub.app.inject({
      method: 'GET',
      url: '/admin/queries/devices',
      headers: { 'x-admin-session': bootstrap.token },
    });
    expect(opened.statusCode).toBe(200);
    const bootstrapTtl = hub.deps.db.prepare('SELECT idle_ttl_ms FROM staff_sessions WHERE session_id = ?').pluck().get(bootstrap.sessionId) as number;
    hub.clock.advance(bootstrapTtl + 1);
    const idleBootstrap = await hub.app.inject({
      method: 'GET',
      url: '/admin/queries/devices',
      headers: { 'x-admin-session': bootstrap.token },
    });
    expect(idleBootstrap.statusCode).toBe(401);
    expect(idleBootstrap.json().error.code).toBe('ADMIN_SESSION_REQUIRED');
    const bootstrapEnd = (
      hub.deps.db.prepare(`SELECT device_id, payload FROM events WHERE event_type = 'SessionEnded'`).all() as Array<{
        device_id: string;
        payload: string;
      }>
    ).find((row) => (JSON.parse(row.payload) as { session_id?: string }).session_id === bootstrap.sessionId);
    expect(bootstrapEnd?.device_id).toBe('hub-admin');
    const endedBootstrap = await hub.app.inject({
      method: 'GET',
      url: '/admin/queries/devices',
      headers: { 'x-admin-session': bootstrap.token },
    });
    expect(endedBootstrap.statusCode).toBe(401);
    expect(endedBootstrap.json().error.code).toBe('ADMIN_SESSION_REQUIRED');
  });

  it('[00 §10 #116] DEVICE_TOKEN_INVALID and DEVICE_REVOKED on commands, queries, auth pin and admin auth', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const device = pairDevice(hub, { type: 'tablet' });
    const routes = [
      { method: 'POST' as const, url: '/commands/noop', group: 'device' as const },
      { method: 'GET' as const, url: '/queries/orders', group: 'device' as const },
      { method: 'POST' as const, url: '/auth/pin', group: 'device' as const },
      { method: 'POST' as const, url: '/admin/auth', group: 'admin-device-public' as const },
    ];
    for (const route of routes) {
      if (route.url === '/admin/auth') continue;
      hub.app.route({ method: route.method, url: route.url, config: { group: route.group }, handler: async () => ({ data: { ok: true } }) });
    }
    for (const route of routes) {
      const missing = await hub.app.inject({ method: route.method, url: route.url });
      expect(missing.statusCode, route.url).toBe(401);
      expect(missing.json().error.code, route.url).toBe('DEVICE_TOKEN_INVALID');
      const unknown = await hub.app.inject({
        method: route.method,
        url: route.url,
        headers: { authorization: 'Bearer not-a-device-token' },
      });
      expect(unknown.statusCode, route.url).toBe(401);
      expect(unknown.json().error.code, route.url).toBe('DEVICE_TOKEN_INVALID');
    }
    hub.deps.db.prepare('UPDATE devices SET revoked_at = ? WHERE device_id = ?').run(hub.clock.branchNow(), device.deviceId);
    for (const route of routes) {
      const revoked = await hub.app.inject({
        method: route.method,
        url: route.url,
        headers: { authorization: `Bearer ${device.token}` },
      });
      expect(revoked.statusCode, route.url).toBe(403);
      expect(revoked.json().error.code, route.url).toBe('DEVICE_REVOKED');
    }
  });

  it('[00 §10 #117] SESSION_INVALID for another device session; on queries ended is EXPIRED and unknown is INVALID', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    await seedDirectory(hub);
    const device = pairDevice(hub, { type: 'tablet' });
    const other = pairDevice(hub, { type: 'tablet' });
    const session = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: device.deviceId });
    hub.app.post('/auth/logout', { config: { group: 'device-session', allowEnded: true } }, async () => ({ data: { ok: true } }));
    hub.app.get('/queries/orders', { config: { group: 'device-session' } }, async () => ({ data: { ok: true } }));
    hub.app.get('/queries/station', { config: { group: 'device-session', allowStation: true } }, async () => ({ data: { ok: true } }));
    const wrongCommand = await hub.app.inject({
      method: 'POST',
      url: '/commands/test-noop',
      headers: { authorization: `Bearer ${other.token}`, 'x-session-token': session.token },
      payload: {
        command_id: 'cmd-117',
        tenant_id: 'tenant-a',
        branch_id: 'branch-1',
        command_type: 'TestNoop',
        payload: {},
        occurred_at: hub.clock.branchNow(),
        actor_id: 'S_CASH',
        device_id: other.deviceId,
      },
    });
    expect(wrongCommand.statusCode).toBe(401);
    expect(wrongCommand.json().error.code).toBe('SESSION_INVALID');
    const wrongLogout = await hub.app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { authorization: `Bearer ${other.token}`, 'x-session-token': session.token },
    });
    expect(wrongLogout.statusCode).toBe(401);
    expect(wrongLogout.json().error.code).toBe('SESSION_INVALID');
    endSessionNow(hub, session.sessionId);
    const ended = await hub.app.inject({
      method: 'GET',
      url: '/queries/test-quiet',
      headers: { authorization: `Bearer ${device.token}`, 'x-session-token': session.token },
    });
    expect(ended.statusCode).toBe(401);
    expect(ended.json().error.code).toBe('SESSION_EXPIRED');
    const logout = await hub.app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { authorization: `Bearer ${device.token}`, 'x-session-token': session.token },
    });
    expect(logout.statusCode).toBe(200);
    const unknown = await hub.app.inject({
      method: 'GET',
      url: '/queries/test-quiet',
      headers: { authorization: `Bearer ${device.token}`, 'x-session-token': 'no-such-token' },
    });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().error.code).toBe('SESSION_INVALID');
    const stationDevice = pairDevice(hub, { type: 'kds', stationId: 'ST1' });
    const station = openSession(hub, { kind: 'station', deviceId: stationDevice.deviceId, stationId: 'ST1' });
    const blockedStation = await hub.app.inject({
      method: 'GET',
      url: '/queries/orders',
      headers: { authorization: `Bearer ${stationDevice.token}`, 'x-session-token': station.token },
    });
    expect(blockedStation.statusCode).toBe(401);
    expect(blockedStation.json().error.code).toBe('SESSION_INVALID');
    const allowedStation = await hub.app.inject({
      method: 'GET',
      url: '/queries/station',
      headers: { authorization: `Bearer ${stationDevice.token}`, 'x-session-token': station.token },
    });
    expect(allowedStation.statusCode).toBe(200);
  });
});

function sessionEndedReasons(hub: Awaited<ReturnType<typeof createTestHub>>, sessionId: string): string[] {
  const rows = hub.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'SessionEnded'`).all() as Array<{
    payload: string;
  }>;
  return rows
    .map((row) => JSON.parse(row.payload) as { session_id?: string; reason?: string })
    .filter((payload) => payload.session_id === sessionId)
    .map((payload) => payload.reason ?? '');
}
