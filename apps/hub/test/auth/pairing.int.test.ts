import { afterEach, describe, expect, it } from 'vitest';
import { encodeCrockford128 } from '../../src/auth/pair-page';
import { HUB_VERSION } from '../../src/lib/health';
import { sha256hex } from '../../src/lib/hash';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

const cleanups: Array<() => Promise<void>> = [];

describe('device pairing', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #29] happy path; expired token → 401; used token by another request → 401; device_type mismatch → 403', async () => {
    const hub = await open();
    const token = await pairingToken(hub, { device_type: 'tablet' });
    const requestId = hub.deps.ids.next();
    const paired = await pair(hub, { pairing_token: token.pairing_token, pair_request_id: requestId, device_name: 'Till', device_type: 'tablet' });
    expect(paired.statusCode).toBe(200);
    const data = paired.json().data;
    expect(data.device_type).toBe('tablet');
    expect(data.owner_staff_id).toBeNull();
    expect(data.branch_id).toBe('branch-1');
    expect(data.branch_name).toBe('');
    expect(data.hub_version).toBe(HUB_VERSION);
    const row = hub.deps.db
      .prepare('SELECT token_hash, device_name, paired_by FROM devices WHERE device_id = ?')
      .get(data.device_id) as { token_hash: string; device_name: string; paired_by: string };
    expect(row).toEqual({ token_hash: sha256hex(data.device_token), device_name: 'Till', paired_by: 'S_OWNER' });
    const event = hub.deps.db.prepare(`SELECT stream_id, payload FROM events WHERE event_type = 'DevicePaired'`).get() as {
      stream_id: string;
      payload: string;
    };
    expect(event.stream_id).toBe(data.device_id);
    expect(JSON.parse(event.payload)).toMatchObject({
      device_id: data.device_id,
      pairing_token_id: token.pairing_token_id,
      pairing_request_id: null,
      owner_staff_id: null,
    });

    const expiredToken = await pairingToken(hub, { device_type: 'tablet' }, 'cmd-expired');
    hub.clock.advance(600_000);
    const expired = await pair(hub, {
      pairing_token: expiredToken.pairing_token,
      pair_request_id: hub.deps.ids.next(),
      device_name: 'Late',
      device_type: 'tablet',
    });
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error.code).toBe('PAIRING_TOKEN_INVALID');

    const used = await pairingToken(hub, { device_type: 'tablet' }, 'cmd-used');
    const firstId = hub.deps.ids.next();
    expect((await pair(hub, { pairing_token: used.pairing_token, pair_request_id: firstId, device_name: 'A', device_type: 'tablet' })).statusCode).toBe(200);
    const other = await pair(hub, {
      pairing_token: used.pairing_token,
      pair_request_id: hub.deps.ids.next(),
      device_name: 'B',
      device_type: 'tablet',
    });
    expect(other.statusCode).toBe(401);
    expect(other.json().error.code).toBe('PAIRING_TOKEN_INVALID');

    const mismatchToken = await pairingToken(hub, { device_type: 'tablet' }, 'cmd-mismatch');
    const mismatch = await pair(hub, {
      pairing_token: mismatchToken.pairing_token,
      pair_request_id: hub.deps.ids.next(),
      device_name: 'Phone',
      device_type: 'phone',
    });
    expect(mismatch.statusCode).toBe(403);
    expect(mismatch.json().error.code).toBe('DEVICE_TYPE_NOT_ALLOWED');
    expect(mismatch.json().error.details).toEqual({ device_type: 'phone', allowed: ['tablet'] });
  });

  it('[00 §10 #30] Retry with same pair_request_id → new token works, old token → 401, one DevicePaired, one DeviceTokenRotated', async () => {
    const hub = await open();
    const token = await pairingToken(hub, { device_type: 'tablet' });
    const requestId = hub.deps.ids.next();
    const first = await pair(hub, { pairing_token: token.pairing_token, pair_request_id: requestId, device_name: 'Till', device_type: 'tablet' });
    const second = await pair(hub, { pairing_token: token.pairing_token, pair_request_id: requestId, device_name: 'Till', device_type: 'tablet' });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.device_token).not.toBe(first.json().data.device_token);
    expect(second.json().data.device_id).toBe(first.json().data.device_id);
    const oldRoster = await hub.app.inject({
      method: 'GET',
      url: '/admin/login-roster',
      headers: { authorization: `Bearer ${first.json().data.device_token}` },
    });
    expect(oldRoster.statusCode).toBe(401);
    const newRoster = await hub.app.inject({
      method: 'GET',
      url: '/admin/login-roster',
      headers: { authorization: `Bearer ${second.json().data.device_token}` },
    });
    expect(newRoster.statusCode).toBe(200);
    expect(hub.deps.db.prepare(`SELECT COUNT(*) FROM events WHERE event_type = 'DevicePaired'`).pluck().get()).toBe(1);
    expect(hub.deps.db.prepare(`SELECT COUNT(*) FROM events WHERE event_type = 'DeviceTokenRotated'`).pluck().get()).toBe(1);
    const rotated = JSON.parse(
      (hub.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'DeviceTokenRotated'`).pluck().get() as string),
    ) as { device_id: string; pair_request_id: string };
    expect(rotated).toEqual({ device_id: first.json().data.device_id, pair_request_id: requestId });
  });

  it('[00 §10 #84] Pairing a phone whose owner was removed after the token was generated → 401 PAIRING_TOKEN_INVALID', async () => {
    const hub = await open();
    const token = await pairingToken(hub, { device_type: 'phone', owner_staff_id: 'S_OWNER' });
    const next = await aDirectory({ directory_version: 2 });
    next.staff = next.staff.filter((staff) => staff.staff_id !== 'S_OWNER');
    await seedDirectory(hub, next);
    const paired = await pair(hub, {
      pairing_token: token.pairing_token,
      pair_request_id: hub.deps.ids.next(),
      device_name: 'Phone',
      device_type: 'phone',
    });
    expect(paired.statusCode).toBe(401);
    expect(paired.json().error.code).toBe('PAIRING_TOKEN_INVALID');
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM devices').pluck().get()).toBe(1);
  });

  it('[00 §6.8] a phone pair stores owner_staff_id', async () => {
    const hub = await open();
    const token = await pairingToken(hub, { device_type: 'phone', owner_staff_id: 'S_OWNER' }, 'cmd-phone');
    const paired = await pair(hub, {
      pairing_token: token.pairing_token,
      pair_request_id: hub.deps.ids.next(),
      device_name: 'Phone',
      device_type: 'phone',
    });
    expect(paired.statusCode).toBe(200);
    expect(paired.json().data.owner_staff_id).toBe('S_OWNER');
    const row = hub.deps.db.prepare('SELECT owner_staff_id FROM devices WHERE device_id = ?').get(paired.json().data.device_id);
    expect(row).toEqual({ owner_staff_id: 'S_OWNER' });
  });

  it('[00 §10 #118] /devices/pair: old client → 426; guest IP → 403; rotation 10 min + 1 s after consumption → 401; rotation for a revoked device → 401', async () => {
    const hub = await open();
    const token = await pairingToken(hub, { device_type: 'tablet' });
    const requestId = hub.deps.ids.next();
    const body = { pairing_token: token.pairing_token, pair_request_id: requestId, device_name: 'Till', device_type: 'tablet' };
    const old = await pair(hub, body, { 'x-client-version': '0.9.0' });
    expect(old.statusCode).toBe(426);
    expect(old.json().error.code).toBe('CLIENT_UPGRADE_REQUIRED');
    const guest = await pair(hub, body, {}, '192.168.20.7');
    expect(guest.statusCode).toBe(403);
    expect(guest.json().error.code).toBe('GUEST_NETWORK_FORBIDDEN');

    const paired = await pair(hub, body);
    expect(paired.statusCode).toBe(200);
    hub.clock.advance(600_001);
    const late = await pair(hub, body);
    expect(late.statusCode).toBe(401);
    expect(late.json().error.code).toBe('PAIRING_TOKEN_INVALID');

    const fresh = await pairingToken(hub, { device_type: 'tablet' }, 'cmd-revoke');
    const revokeId = hub.deps.ids.next();
    const revokeBody = { pairing_token: fresh.pairing_token, pair_request_id: revokeId, device_name: 'Till', device_type: 'tablet' };
    const created = await pair(hub, revokeBody);
    expect(created.statusCode).toBe(200);
    hub.deps.db.prepare('UPDATE devices SET revoked_at = ? WHERE device_id = ?').run(hub.clock.branchNow(), created.json().data.device_id);
    const revoked = await pair(hub, revokeBody);
    expect(revoked.statusCode).toBe(401);
    expect(revoked.json().error.code).toBe('PAIRING_TOKEN_INVALID');
  });

  it('[00 §10 #94] the served page logs out an admin session and clears sessionStorage before pairing, and uses neither randomUUID nor serviceWorker; after the logout call the admin token → 401', async () => {
    const hub = await open();
    const page = await hub.app.inject({ method: 'GET', url: '/pair' });
    expect(page.statusCode).toBe(200);
    const html = page.body;
    expect(html.indexOf('/admin/auth/logout')).toBeGreaterThan(-1);
    expect(html.indexOf('/admin/auth/logout')).toBeLessThan(html.indexOf('/devices/pair'));
    expect(html).toContain('sessionStorage.removeItem');
    expect(html).toContain('crypto.getRandomValues');
    expect(html).toContain('indexedDB');
    expect(html).toContain('onupgradeneeded');
    expect(html).toContain('encodeCrockford128');
    expect(html).toContain("get('pair_request_id')");
    const logoutAt = html.indexOf('/admin/auth/logout');
    expect(html.slice(logoutAt, logoutAt + 400)).toContain('authorization');
    const screenBlock = html.match(/if \(!pairingToken\) \{[\s\S]*?start\(\);\s*return;\s*\}/)?.[0] ?? '';
    expect(screenBlock.indexOf('if (deviceToken)')).toBeGreaterThan(-1);
    expect(screenBlock.indexOf('if (deviceToken)')).toBeLessThan(screenBlock.indexOf("fetch('/pair/requests'"));
    expect(screenBlock).toContain('/auth/station');
    expect(screenBlock).toContain('res.status !== 200');
    const stationAt = html.indexOf('/auth/station');
    expect(html.slice(stationAt, stationAt + 400)).toContain('authorization');
    expect(html).toContain('status === 404');
    expect(html).toContain('Ask a manager');
    expect(html).toContain('pairing.ios_add_to_home');
    expect(html).toContain('pairing.token_expired');
    expect(html).not.toContain('randomUUID');
    expect(html).not.toContain('serviceWorker');
    expect(encodeCrockford128(new Uint8Array(16))).toBe('0'.repeat(26));
    expect(encodeCrockford128(Uint8Array.from({ length: 16 }, () => 0xff))).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    const session = openSession(hub, { kind: 'admin', staffId: 'S_OWNER' });
    const logout = await hub.app.inject({
      method: 'POST',
      url: '/admin/auth/logout',
      headers: { 'x-admin-session': session.token },
    });
    expect(logout.statusCode).toBe(200);
    const after = await hub.app.inject({
      method: 'POST',
      url: '/admin/commands/generate-device-pairing-token',
      headers: { 'x-admin-session': session.token },
      payload: {
        command_id: 'cmd-after-logout',
        tenant_id: 'tenant-a',
        branch_id: 'branch-1',
        command_type: 'GenerateDevicePairingToken',
        payload: { device_type: 'tablet' },
        occurred_at: hub.clock.branchNow(),
        actor_id: 'S_OWNER',
        device_id: 'hub-admin',
      },
    });
    expect(after.statusCode).toBe(401);
  });
});

async function open(): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  await seedDirectory(hub);
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'admin', staffId: 'S_OWNER', deviceId: device.deviceId });
  return Object.assign(hub, { adminDevice: device, adminSession: session });
}

async function pairingToken(
  hub: TestHub & { adminDevice?: { deviceId: string; token: string }; adminSession?: { token: string } },
  payload: Record<string, unknown>,
  commandId = 'cmd-generate-device-pairing-token',
): Promise<{ pairing_token: string; pairing_token_id: string }> {
  const device = hub.adminDevice;
  const session = hub.adminSession;
  if (device === undefined || session === undefined) throw new Error('admin missing');
  const response = await hub.app.inject({
    method: 'POST',
    url: '/admin/commands/generate-device-pairing-token',
    headers: { authorization: `Bearer ${device.token}`, 'x-admin-session': session.token },
    payload: {
      command_id: commandId,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'GenerateDevicePairingToken',
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: 'S_OWNER',
      device_id: device.deviceId,
    },
  });
  expect(response.statusCode).toBe(200);
  return response.json().data.result as { pairing_token: string; pairing_token_id: string };
}

function pair(hub: TestHub, payload: Record<string, unknown>, headers: Record<string, string> = {}, remoteAddress?: string) {
  return hub.app.inject({ method: 'POST', url: '/devices/pair', headers, payload, remoteAddress });
}
