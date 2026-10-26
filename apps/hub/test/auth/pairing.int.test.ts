import { afterEach, describe, expect, it } from 'vitest';
import { encodeCrockford128 } from '../../src/auth/pair-page';
import { HUB_VERSION } from '../../src/lib/health';
import { sha256hex } from '../../src/lib/hash';
import { aDirectory } from '../helpers/fixtures';
import { EN } from '../../src/lib/strings';
import { jsonResponse, runPage, textOf } from '../helpers/page-sandbox';
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
    expect(data.branch_name).toBe('Main');
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

  it('[00 §8.4] hub unreachable at page load: the screen says so, retries with backoff capped at 5 s, and recovers once the hub is up', async () => {
    const hub = await open();
    const html = (await hub.app.inject({ method: 'GET', url: '/pair' })).body;
    const unreachable = () => Promise.reject(new TypeError('fetch failed'));

    let down = 6;
    const kds = await runPage(html, {
      store: { token: 'kds-token', device_id: 'kds-1', device_type: 'kds' },
      fetch: (url) => {
        if (url !== '/auth/station') throw new Error(`unexpected ${url}`);
        if (down > 0) {
          down -= 1;
          return unreachable();
        }
        return Promise.resolve(jsonResponse(200, { data: { session_token: 's', session_id: 'x', station_id: 'ST' } }));
      },
    });
    expect(textOf(kds.byId('pair_status'))).toContain(EN['pairing.hub_unreachable']);
    expect(kds.byId('pair_status').hidden).toBe(false);
    while (down > 0 || !textOf(kds.screen).includes(EN['pairing.approved_title'])) {
      if (!(await kds.advance())) break;
    }
    expect(textOf(kds.screen)).toContain(EN['pairing.approved_title']);
    expect(textOf(kds.screen)).toContain(EN['pairing.approved_body_kds']);
    expect(kds.store.get('token')).toBe('kds-token');
    expect(kds.delays.length).toBeGreaterThanOrEqual(6);
    expect(Math.max(...kds.delays)).toBe(5_000);
    expect(kds.delays.slice(0, 3)).toEqual([500, 1_000, 2_000]);
    expect(textOf(kds.byId('pair_status'))).not.toContain(EN['pairing.hub_unreachable']);
    expect(kds.byId('pair_status').hidden).toBe(true);

    let pollsDown = 2;
    const screen = await runPage(html, {
      fetch: (url) => {
        if (url === '/pair/requests') {
          return Promise.resolve(
            jsonResponse(200, { data: { request_id: 'R1', poll_secret: 'p', display_code: 'ABCDEF', approve_qr_svg: '<svg></svg>', expires_at: Date.now() + 581_000 } }),
          );
        }
        if (url === '/pair/requests/R1') {
          if (pollsDown > 0) {
            pollsDown -= 1;
            return unreachable();
          }
          return Promise.resolve(
            jsonResponse(200, { data: { status: 'approved', device_id: 'K1', device_token: 'tok', device_type: 'cashier_kiosk' } }),
          );
        }
        throw new Error(`unexpected ${url}`);
      },
    });
    expect(textOf(screen.screen)).toContain(EN['pairing.expires_in'].split('{time}')[0]!);
    expect(textOf(screen.screen)).toContain('9:41');
    expect(screen.findAll((el) => el.className.includes('display-code'))[0]!.textContent).toBe('ABCDEF');
    for (let i = 0; i < 40 && screen.store.get('token') === undefined; i += 1) await screen.advance();
    expect(screen.store.get('token')).toBe('tok');
    expect(screen.store.get('device_id')).toBe('K1');
    expect(textOf(screen.screen)).toContain(EN['pairing.approved_title']);
    expect(textOf(screen.screen)).toContain(EN['pairing.approved_body_cashier']);
    expect(textOf(screen.screen)).not.toMatch(/pairing\.|errors\./);
  });

  it('[00 §10 #139] phone pairing asks for the name in a field, never window.prompt; an empty name sends nothing; a name pairs; 401 shows the expired-QR screen', async () => {
    const hub = await open();
    const html = (await hub.app.inject({ method: 'GET', url: '/pair?t=tok' })).body;
    const sent: Array<Record<string, unknown>> = [];
    const answers = [jsonResponse(401, { error: { code: 'PAIRING_TOKEN_INVALID', details: {} } })];
    const expired = await runPage(html, {
      search: '?t=tok',
      fetch: (url, init) => {
        if (url !== '/devices/pair') throw new Error(`unexpected ${url}`);
        sent.push(JSON.parse((init as { body: string }).body));
        return Promise.resolve(answers.shift());
      },
    });
    expect(expired.prompts).toBe(0);
    const name = expired.find('device_name');
    if (name === undefined) throw new Error('device name field missing');
    const form = expired.findAll((child) => child.tagName === 'form')[0];
    if (form === undefined) throw new Error('name form missing');
    name.value = '   ';
    await expired.submit(form);
    expect(sent).toHaveLength(0);
    expect(expired.findAll((el) => el.classList.contains('pos-field--error'))).toHaveLength(1);
    name.value = ' Bilal phone ';
    await expired.submit(form);
    expect(sent[0]).toMatchObject({ pairing_token: 'tok', device_name: 'Bilal phone', device_type: 'phone' });
    expect(sent[0]!.pair_request_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(textOf(expired.screen)).toContain(EN['pairing.token_expired']);
    expect(textOf(expired.screen)).toContain(EN['pairing.token_expired_body']);
    expect(expired.store.get('pair_request_id')).toBeUndefined();

    const paired = await runPage(html, {
      search: '?t=tok',
      fetch: () =>
        Promise.resolve(
          jsonResponse(200, { data: { device_id: 'P1', device_token: 'phone-tok', device_type: 'phone', owner_staff_id: 'S_OWNER' } }),
        ),
    });
    paired.find('device_name')!.value = 'Bilal phone';
    await paired.submit(paired.findAll((child) => child.tagName === 'form')[0]!);
    expect(paired.store.get('token')).toBe('phone-tok');
    expect(textOf(paired.screen)).toContain(EN['pairing.paired_title']);
    expect(paired.prompts).toBe(0);
  });

  it('[00 §10 #94] the served page logs out an admin session and clears sessionStorage before pairing, and uses neither randomUUID nor serviceWorker; after the logout call the admin token → 401', async () => {
    const hub = await open();
    const page = await hub.app.inject({ method: 'GET', url: '/pair' });
    expect(page.statusCode).toBe(200);
    const html = page.body;
    // M43: at load, the admin session is ended before any pairing starts (screen or phone).
    const boot = html.slice(html.lastIndexOf('openDeviceDb().then('));
    expect(boot.indexOf('/admin/auth/logout')).toBeGreaterThan(-1);
    expect(boot.indexOf('/admin/auth/logout')).toBeLessThan(boot.indexOf('pairScreen(db)'));
    expect(boot.indexOf('/admin/auth/logout')).toBeLessThan(boot.indexOf('pairPhone(db, pairingToken)'));
    expect(html).toContain('sessionStorage.removeItem');
    expect(html).toContain('crypto.getRandomValues');
    expect(html).toContain('indexedDB');
    expect(html).toContain('onupgradeneeded');
    expect(html).toContain('encodeCrockford128');
    expect(html).toContain("readKey(db, 'pair_request_id')");
    const logoutAt = html.indexOf('/admin/auth/logout');
    expect(html.slice(logoutAt, logoutAt + 400)).toContain('authorization');
    const noToken = html.match(/if \(!pairingToken\) \{[\s\S]*?return pairScreen\(db\);\s*\}/)?.[0] ?? '';
    expect(noToken.indexOf('await resumePaired(db, deviceToken)')).toBeGreaterThan(-1);
    const screenBlock = html.match(/function pairScreen\(db\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(screenBlock).toContain("fetchRetry('/pair/requests'");
    expect(screenBlock).toContain('retry_after_ms');
    const resume = html.match(/async function resumePaired[\s\S]*?\n\}/)?.[0] ?? '';
    expect(resume).toMatch(/status === 401 \|\| \w+\.status === 403/);
    expect(resume).toContain('await wipe(db)');
    expect(html).toContain("for (const key of ['token', 'device_id', 'device_type']) await deleteKey(db, key);");
    expect(html.match(/writeKey\(db, 'device_id'/g)?.length).toBe(2);
    expect(screenBlock).toContain('/auth/station');
    expect(screenBlock).toContain('res.status !== 200');
    const stationAt = html.indexOf('/auth/station');
    expect(html.slice(stationAt, stationAt + 400)).toContain('authorization');
    expect(html).toContain('status === 404');
    expect(html).toContain('Ask a manager');
    expect(html).toContain('pairing.ios_title');
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
