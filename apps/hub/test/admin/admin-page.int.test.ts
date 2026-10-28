import { afterEach, describe, expect, it } from 'vitest';
import { EN } from '../../src/lib/strings';
import { jsonResponse, runPage, textOf, type PageSandbox, type StubElement } from '../helpers/page-sandbox';
import { createTestHub, seedDirectory, type TestHub } from '../helpers/test-hub';

// 00 v1.3 M86: the hub admin page (00-S16 … S20, D01 … D03).
const cleanups: Array<() => Promise<void>> = [];
const NOW = Date.now();

async function open(): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  await seedDirectory(hub);
  return hub;
}

async function html(): Promise<string> {
  const hub = await open();
  return (await hub.app.inject({ method: 'GET', url: '/admin' })).body;
}

const DEVICES = {
  devices: [
    { device_id: 'D1', device_name: 'Counter 1', device_type: 'cashier_kiosk', station_id: null, owner_staff_id: null, owner_name: null, pairing_source: 'request', paired_at: NOW - 86_400_000, paired_by_name: 'Arif', last_seen_at: NOW, revoked_at: null, revoked_by_name: null, revoked_reason: null, active_session: { session_id: 'SS1', kind: 'staff', staff_id: 'S_CASH', display_name: 'Cashier' } },
    { device_id: 'D2', device_name: 'Degh', device_type: 'kds', station_id: 'DG', owner_staff_id: null, owner_name: null, pairing_source: 'request', paired_at: NOW - 86_400_000, paired_by_name: 'Arif', last_seen_at: NOW - 360_000, revoked_at: null, revoked_by_name: null, revoked_reason: null, active_session: { session_id: 'SS2', kind: 'station', staff_id: null, display_name: null } },
    { device_id: 'D3', device_name: "Bilal's phone", device_type: 'phone', station_id: null, owner_staff_id: 'S_WAIT', owner_name: 'Bilal', pairing_source: 'token', paired_at: NOW, paired_by_name: 'Imran', last_seen_at: NOW - 10_800_000, revoked_at: null, revoked_by_name: null, revoked_reason: null, active_session: null },
  ],
};
const SESSIONS = {
  sessions: [
    { session_id: 'SA', kind: 'admin', staff_id: 'S_MGR', display_name: 'Imran', station_id: null, device_id: 'D1', device_name: 'Counter 1', started_at: NOW - 3_600_000, last_activity_at: NOW, idle_ttl_ms: 3_600_000 },
    { session_id: 'SS1', kind: 'staff', staff_id: 'S_CASH', display_name: 'Cashier', station_id: null, device_id: 'D1', device_name: 'Counter 1', started_at: NOW - 600_000, last_activity_at: NOW - 240_000, idle_ttl_ms: 300_000 },
    { session_id: 'SS2', kind: 'station', staff_id: null, display_name: null, station_id: 'DG', device_id: 'D2', device_name: 'Degh', started_at: NOW - 600_000, last_activity_at: NOW, idle_ttl_ms: null },
  ],
};
const LOCKOUTS = {
  staff: [{ staff_id: 'S_WAIT', display_name: 'Bilal', locked_until: NOW + 840_000 }],
  devices: [{ device_id: 'D9', device_name: 'Counter 2', locked_until: NOW + 540_000 }],
  ips: [],
};
const STAFF = { staff: [{ staff_id: 'S_WAIT', display_name: 'Bilal', role_names: ['Waiter'], phone_count: 1 }, { staff_id: 'S_ALI', display_name: 'Ali', role_names: ['Waiter'], phone_count: 0 }] };
const STATIONS = { stations: [{ station_id: 'DG', name: 'Degh', location_label: null, category_names: [] }] };

interface Hub {
  sent: Array<{ url: string; body: Record<string, unknown> }>;
  down: boolean;
  answers: Record<string, () => unknown>;
}

function fakeHub(): Hub & { fetch: (url: string, init?: unknown) => Promise<unknown> } {
  const hub: Hub = { sent: [], down: false, answers: {} };
  const data: Record<string, unknown> = {
    '/admin/queries/devices': DEVICES,
    '/admin/queries/devices?include_revoked=true': DEVICES,
    '/admin/queries/sessions': SESSIONS,
    '/admin/queries/lockouts': LOCKOUTS,
    '/admin/queries/staff': STAFF,
    '/admin/queries/stations': STATIONS,
  };
  return Object.assign(hub, {
    fetch: (url: string, init?: unknown) => {
      if (hub.down) return Promise.reject(new TypeError('down'));
      const request = init as { method?: string; body?: string; headers?: Record<string, string> } | undefined;
      if (url === '/health') return Promise.resolve(jsonResponse(200, {}));
      if (url.startsWith('/admin/queries/')) {
        expect(request?.headers?.['x-admin-session']).toBe('adm');
        return Promise.resolve(jsonResponse(200, { data: data[url] }));
      }
      if (url.startsWith('/admin/commands/')) {
        const body = JSON.parse(request!.body!) as Record<string, unknown>;
        hub.sent.push({ url, body });
        const answer = hub.answers[url];
        return Promise.resolve(answer ? answer() : jsonResponse(200, { data: { result: {} } }));
      }
      throw new Error(`unexpected ${url}`);
    },
  });
}

const SESSION = { admin_session_token: 'adm', admin_staff_id: 'S_MGR', admin_name: 'Imran', admin_permissions: JSON.stringify({ 'manage-devices': true, 'manage-staff': true }) };
const STORE = { token: 'tablet-token', device_id: 'D1' };

function byText(page: PageSandbox, text: string, root?: StubElement): StubElement | undefined {
  return page.findAll((el) => el.textContent === text || (el.tagName !== '#text' && el.children.some((c) => c.tagName === '#text' && c.textContent === text)), root ?? page.body)[0];
}

function all(page: PageSandbox): string {
  return `${textOf(page.screen)} ${textOf(page.body)}`;
}

describe('hub admin page (M86)', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #142] GET /admin without credentials → 200 HTML with no token; a guest IP → 403; the script signs in via /admin/auth and calls only §6.7, §6.14–§6.18c', async () => {
    const hub = await open();
    const page = await hub.app.inject({ method: 'GET', url: '/admin' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).not.toMatch(/Bearer [A-Za-z0-9_-]{20,}/);
    expect(page.body).toContain("call('/admin/auth'");
    const guest = await hub.app.inject({ method: 'GET', url: '/admin', remoteAddress: '192.168.20.7' });
    expect(guest.statusCode).toBe(403);
    const script = page.body.slice(page.body.indexOf('<script>'));
    const urls = new Set([...script.matchAll(/'(\/(?:admin|auth|queries|commands)[a-z/_-]*)/g)].map((m) => m[1]));
    expect([...urls].sort()).toEqual(['/admin/approve', '/admin/auth', '/admin/auth/logout', '/admin/commands/', '/admin/login-roster', '/admin/queries/devices', '/admin/queries/lockouts', '/admin/queries/sessions', '/admin/queries/staff', '/admin/queries/stations', '/admin/stock/'].sort());
    expect([...script.matchAll(/command\('([a-z-]+)'/g)].map((m) => m[1]).sort()).toEqual(['clear-pin-lockout', 'force-logout-session', 'generate-device-pairing-token', 'revoke-device']);
  });

  it('[00 §8.2 M86] home: counts, kitchen screen not seen for 6 min, lockout chip; read-only admin gets no Approve and no Add a phone', async () => {
    const source = await html();
    const hub = fakeHub();
    const page = await runPage(source, { store: STORE, session: SESSION, fetch: hub.fetch });
    const text = textOf(page.screen);
    expect(text).toContain(EN['admin.tile_devices'].replace('{n}', '3'));
    expect(text).toContain(EN['admin.not_seen_chip'].replace('{name}', 'Degh').replace('{n}', '6'));
    expect(text).toContain(EN['admin.tile_sessions'].replace('{n}', '3'));
    expect(text).toContain(EN['admin.locked_many'].replace('{n}', '2'));
    expect(text).toContain(EN['devices.approve']);
    expect(text).toContain(EN['admin.tile_add_phone_title']);
    expect(text).toContain('Imran');

    const viewer = await runPage(source, { store: STORE, session: { ...SESSION, admin_permissions: JSON.stringify({ 'manage-devices': false, 'manage-staff': false }) }, fetch: fakeHub().fetch });
    expect(textOf(viewer.screen)).not.toContain(EN['devices.approve']);
    expect(textOf(viewer.screen)).not.toContain(EN['admin.tile_add_phone_title']);
  });

  it('[00 §8.2 M86] screens and phones: grouped list, this screen, not-seen chip, owner; Remove asks for a reason, sends RevokeDevice and shows the result; read-only hides Remove', async () => {
    const source = await html();
    const hub = fakeHub();
    hub.answers['/admin/commands/revoke-device'] = () => jsonResponse(200, { data: { result: { device_id: 'D3', revoked_at: NOW, already_revoked: false } } });
    const page = await runPage(source, { store: STORE, session: SESSION, fetch: hub.fetch, hash: '#devices' });
    const text = textOf(page.screen);
    for (const key of ['devices.group_cashier', 'devices.group_kitchen', 'devices.group_phone', 'devices.this_screen']) expect(text).toContain(EN[key as keyof typeof EN]);
    expect(text).toContain(EN['devices.not_seen'].replace('{n}', '6'));
    expect(text).toContain(EN['devices.type_kds'].replace('{station}', 'Degh'));
    expect(text).toContain(EN['devices.type_phone'].replace('{owner}', 'Bilal'));
    expect(text).toContain(EN['devices.seen_hour'].replace('{n}', '3'));
    const row = page.find('device_D3')!;
    await page.click(byText(page, EN['devices.remove'], row)!);
    expect(textOf(page.body)).toContain(EN['devices.remove_title'].replace('{name}', "Bilal's phone"));
    page.find('remove_reason', page.body)!.value = ' Lost ';
    await page.click(page.find('dialog_confirm', page.body)!);
    expect(hub.sent[0]).toMatchObject({ url: '/admin/commands/revoke-device', body: { command_type: 'RevokeDevice', tenant_id: 'tenant-a', branch_id: 'branch-1', actor_id: 'S_MGR', device_id: 'D1', payload: { device_id: 'D3', reason: 'Lost' } } });
    expect(page.findAll((el) => el.className === 'pos-scrim', page.body)).toHaveLength(0);
    expect(textOf(page.screen)).toContain(EN['devices.removed'].replace('{name}', "Bilal's phone"));

    const viewer = await runPage(source, { store: STORE, session: { ...SESSION, admin_permissions: JSON.stringify({ 'manage-devices': false, 'manage-staff': true }) }, fetch: fakeHub().fetch, hash: '#devices' });
    expect(textOf(viewer.screen)).toContain(EN['devices.read_only']);
    expect(byText(viewer, EN['devices.remove'], viewer.screen)).toBeUndefined();
  });

  it('[00 §8.2 M86] add a phone: pick a name, Make QR sends GenerateDevicePairingToken for that owner, shows the QR, link and countdown; Done goes back to the list', async () => {
    const source = await html();
    const hub = fakeHub();
    hub.answers['/admin/commands/generate-device-pairing-token'] = () => jsonResponse(200, { data: { result: { pair_url: 'http://192.168.0.107:3000/pair?t=abc', pair_qr_svg: '<svg id="q"></svg>', expires_at: Date.now() + 581_000 } } });
    const page = await runPage(source, { store: STORE, session: SESSION, fetch: hub.fetch, hash: '#add-phone' });
    expect(page.find('make_qr')!.disabled).toBe(true);
    expect(textOf(page.screen)).toContain(`Waiter · ${EN['addphone.no_phone']}`);
    await page.click(byText(page, 'Ali', page.screen)!);
    expect(page.find('make_qr')!.disabled).toBe(false);
    await page.click(page.find('make_qr')!);
    expect(hub.sent[0]!.body).toMatchObject({ command_type: 'GenerateDevicePairingToken', payload: { device_type: 'phone', owner_staff_id: 'S_ALI' } });
    const text = textOf(page.screen);
    expect(text).toContain(EN['addphone.scan_title'].replace('{name}', 'Ali'));
    expect(text).toContain('http://192.168.0.107:3000/pair?t=abc');
    expect(text).toContain('9:41');
    await page.click(byText(page, EN['addphone.done'], page.screen)!);
    expect(textOf(page.screen)).toContain(EN['devices.group_cashier']);
  });

  it('[00 §8.2 M86] signed in now: kinds, idle rules, warn when about to sign out, no Log out on own row; Log out confirms and sends ForceLogoutSession; already_ended says so', async () => {
    const source = await html();
    const hub = fakeHub();
    hub.answers['/admin/commands/force-logout-session'] = () => jsonResponse(200, { data: { result: { session_id: 'SS2', ended_at: NOW, already_ended: true } } });
    const page = await runPage(source, { store: STORE, session: SESSION, fetch: hub.fetch, hash: '#sessions' });
    const text = textOf(page.screen);
    expect(text).toContain(EN['sessions.idle_rule_h'].replace('{n}', '1'));
    expect(text).toContain(EN['sessions.idle_soon'].replace('{n}', '1'));
    expect(text).toContain(EN['sessions.stays_on']);
    expect(text).toContain(EN['sessions.you']);
    expect(byText(page, EN['sessions.log_out'], page.find('session_SA'))).toBeUndefined();
    await page.click(byText(page, EN['sessions.log_out'], page.find('session_SS2'))!);
    expect(textOf(page.body)).toContain(EN['sessions.end_kds_title'].replace('{station}', 'Degh'));
    await page.click(page.find('dialog_confirm', page.body)!);
    expect(hub.sent[0]!.body).toMatchObject({ command_type: 'ForceLogoutSession', payload: { session_id: 'SS2' } });
    expect(textOf(page.screen)).toContain(EN['sessions.already_ended']);
  });

  it('[00 §8.2 M86] locked out: people, screens, addresses (empty section says so); Unlock confirms and sends ClearPinLockout; offline keeps the list and disables Unlock', async () => {
    const source = await html();
    const hub = fakeHub();
    hub.answers['/admin/commands/clear-pin-lockout'] = () => jsonResponse(200, { data: { result: { subject_type: 'staff', subject_id: 'S_WAIT', cleared: true } } });
    const page = await runPage(source, { store: STORE, session: SESSION, fetch: hub.fetch, hash: '#lockouts' });
    const text = textOf(page.screen);
    expect(text).toContain('Bilal');
    expect(text).toContain('Counter 2');
    expect(text).toContain(EN['lockouts.none_ip']);
    expect(text).toContain(EN['staff.locked_min'].replace('{min}', '14'));
    await page.click(byText(page, EN['lockouts.unlock'], page.find('lockout_staff_S_WAIT'))!);
    expect(textOf(page.body)).toContain(EN['lockouts.confirm_title'].replace('{name}', 'Bilal'));
    await page.click(page.find('dialog_confirm', page.body)!);
    expect(hub.sent[0]!.body).toMatchObject({ command_type: 'ClearPinLockout', payload: { subject_type: 'staff', subject_id: 'S_WAIT' } });
    expect(textOf(page.screen)).toContain(EN['lockouts.unlocked'].replace('{name}', 'Bilal'));

    hub.down = true;
    await page.click(byText(page, EN['admin.refresh'], page.screen)!);
    expect(all(page)).toContain(EN['admin.offline']);
    expect(textOf(page.screen)).toContain('Bilal');
    expect(byText(page, EN['lockouts.unlock'], page.screen)).toBeUndefined();
    hub.down = false;
    for (let i = 0; i < 5 && textOf(page.screen).includes(EN['admin.offline']); i += 1) await page.advance();
    expect(textOf(page.screen)).not.toContain(EN['admin.offline']);
  });

  it('[00 §8.2 M86] no admin session → the shared sign-in; no device token and no bootstrap session → can\'t approve here', async () => {
    const source = await html();
    const roster = { data: { staff: [{ staff_id: 'S_MGR', display_name: 'Imran', locked_until: null }] } };
    const page = await runPage(source, { store: STORE, fetch: (url) => (url === '/admin/login-roster' ? Promise.resolve(jsonResponse(200, roster)) : Promise.reject(new Error(url))) });
    expect(textOf(page.screen)).toContain(EN['approve.who']);
    expect(page.findAll((el) => el.className.split(' ').includes('pos-pin__key'), page.screen).length).toBe(12);
    const stranger = await runPage(source, { fetch: () => Promise.reject(new Error('no request expected')) });
    expect(textOf(stranger.body)).toContain(EN['approve.needs_admin_title']);
  });
});
