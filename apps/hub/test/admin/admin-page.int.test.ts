import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EN } from '../../src/lib/strings';
import { jsonResponse, runPage, textOf, type PageSandbox, type StubElement } from '../helpers/page-sandbox';
import { createTestHub, seedDirectory, type TestHub } from '../helpers/test-hub';

// 00 v1.3 M86: the hub admin page (00-S16 … S20, D01 … D03).
// 00 v1.9.2 (Q-43): GET /admin links the 03b / 03c admin entries only when their build exists. Each test starts
// with no such build (whatever the client has built), and #165 points the dirs at a stand-in build.
const dist = vi.hoisted(() => ({ kitchen: '/nonexistent/admin-kitchen-screens/', printers: '/nonexistent/admin-printers/' }));
vi.mock('../../src/lib/client-dist', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/lib/client-dist')>();
  return {
    ...real,
    get ADMIN_KITCHEN_SCREENS_DIST_DIR() {
      return dist.kitchen;
    },
    get ADMIN_PRINTERS_DIST_DIR() {
      return dist.printers;
    },
  };
});
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
  queried: string[];
}

function fakeHub(): Hub & { fetch: (url: string, init?: unknown) => Promise<unknown> } {
  const hub: Hub = { sent: [], down: false, answers: {}, queried: [] };
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
        hub.queried.push(url);
        const answer = hub.answers[url];
        if (answer) return Promise.resolve(answer());
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
    // 00 v1.9.2 (Q-43): plus 03b's kds-config and 03c's print-queue for the two home tiles, and the two pages' links
    expect([...urls].sort()).toEqual(['/admin/approve', '/admin/auth', '/admin/auth/logout', '/admin/commands/', '/admin/kitchen-screens/', '/admin/login-roster', '/admin/printers/', '/admin/queries/devices', '/admin/queries/kds-config', '/admin/queries/lockouts', '/admin/queries/print-queue', '/admin/queries/sessions', '/admin/queries/staff', '/admin/queries/stations', '/admin/stock/'].sort());
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
    // Pulse 00-S20: one big number per tile, no Other-jobs tile grid, "Branch hub · {host}" in the side-nav foot.
    const nums = page.findAll((el) => el.className === 'pos-tile__num').map((el) => el.textContent);
    expect(nums).toEqual(['3', '2', '3']);
    expect(text).not.toContain(EN['admin.tile_stock']);
    const foot = page.findAll((el) => el.className === 'pos-sidenav__foot')[0]!;
    expect(textOf(foot)).toContain(EN['admin.branch_line'].split('{host}')[0]!.trim());
    expect(textOf(foot)).toContain('Imran');
    expect(page.findAll((el) => el.className === 'pos-sidenav__foot').length).toBe(1);

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
    // Pulse 00-S16: 4 columns; paired details and Remove moved into the row's ⋯ menu.
    expect(text).not.toContain(EN['devices.col_paired']);
    expect(byText(page, EN['devices.remove'], page.screen)).toBeUndefined();
    const row = page.find('device_D3')!;
    const more = page.find('more_D3', row)!;
    expect(more.getAttribute('aria-label')).toBe(EN['devices.more'].replace('{name}', "Bilal's phone"));
    await page.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const [pairedHead, pairedTail] = EN['devices.menu_paired'].split('{date}');
    expect(textOf(row)).toContain(pairedHead! + EN['devices.today'].split('{time}')[0]);
    expect(textOf(row)).toContain(pairedTail!.replace('{name}', 'Imran'));
    expect(textOf(row)).toContain(EN['devices.source_token']);
    await page.click(page.find('remove_D3', row)!);
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(page.findAll((el) => el.className.split(' ').includes('pos-menu'), row)).toHaveLength(0);
    expect(textOf(page.body)).toContain(EN['devices.remove_title'].replace('{name}', "Bilal's phone"));
    page.find('remove_reason', page.body)!.value = ' Lost ';
    await page.click(page.find('dialog_confirm', page.body)!);
    expect(hub.sent[0]).toMatchObject({ url: '/admin/commands/revoke-device', body: { command_type: 'RevokeDevice', tenant_id: 'tenant-a', branch_id: 'branch-1', actor_id: 'S_MGR', device_id: 'D1', payload: { device_id: 'D3', reason: 'Lost' } } });
    expect(page.findAll((el) => el.className === 'pos-scrim', page.body)).toHaveLength(0);
    expect(textOf(page.screen)).toContain(EN['devices.removed'].replace('{name}', "Bilal's phone"));

    const viewer = await runPage(source, { store: STORE, session: { ...SESSION, admin_permissions: JSON.stringify({ 'manage-devices': false, 'manage-staff': true }) }, fetch: fakeHub().fetch, hash: '#devices' });
    expect(textOf(viewer.screen)).toContain(EN['devices.read_only']);
    expect(byText(viewer, EN['devices.remove'], viewer.screen)).toBeUndefined();
    expect(viewer.findAll((el) => el.className === 'pos-more')).toHaveLength(0);
  });

  it('[00 §8.2 M86] screens and phones: the row menu closes on Escape with focus back on ⋯, arrow keys move between items; offline keeps the menu but Remove is off', async () => {
    const source = await html();
    const hub = fakeHub();
    const page = await runPage(source, { store: STORE, session: SESSION, fetch: hub.fetch, hash: '#devices' });
    const row = page.find('device_D2')!;
    const more = page.find('more_D2', row)!;
    await page.click(more);
    const menu = page.findAll((el) => el.className.split(' ').includes('pos-menu'), row)[0]!;
    expect(menu.getAttribute('role')).toBe('menu');
    const remove = page.find('remove_D2', menu)!;
    expect(remove.getAttribute('role')).toBe('menuitem');
    expect(textOf(remove)).toBe(EN['devices.menu_remove'].replace('{name}', 'Degh'));
    expect(page.active).toBe(remove);
    menu.listeners.keydown!({ key: 'ArrowDown', preventDefault() {} });
    expect(page.active).toBe(remove);
    menu.listeners.keydown!({ key: 'Escape', preventDefault() {} });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(page.active).toBe(more);
    expect(page.findAll((el) => el.className.split(' ').includes('pos-menu'), row)).toHaveLength(0);

    hub.down = true;
    await page.click(page.find('tab_removed')!);
    await page.click(page.find('tab_in_use')!);
    expect(all(page)).toContain(EN['admin.offline']);
    const offlineMore = page.find('more_D2')!;
    await page.click(offlineMore);
    const off = page.find('remove_D2')!;
    expect(off.disabled).toBe(true);
    await page.click(off);
    expect(textOf(page.body)).not.toContain(EN['devices.remove_title'].replace('{name}', 'Degh'));
  });

  it('[00 §8.2 M86] screens and phones: In use / Removed filter replaces the switch; Removed refetches with include_revoked and lists only removed rows with their reason', async () => {
    const source = await html();
    const urls: string[] = [];
    const hub = fakeHub();
    const removed = { ...DEVICES.devices[0]!, device_id: 'D7', device_name: 'Tablet 3', device_type: 'tablet', revoked_at: NOW - 86_400_000 * 3, revoked_by_name: 'Imran', revoked_reason: 'Lost on the family hall floor', active_session: null };
    const fetch = (url: string, init?: unknown): Promise<unknown> => {
      urls.push(url);
      if (url === '/admin/queries/devices?include_revoked=true') return Promise.resolve(jsonResponse(200, { data: { devices: [...DEVICES.devices, removed] } }));
      return hub.fetch(url, init);
    };
    const page = await runPage(source, { store: STORE, session: SESSION, fetch, hash: '#devices' });
    expect(textOf(page.screen)).not.toContain(EN['devices.show_removed']);
    const inUse = page.find('tab_in_use')!;
    expect(inUse.getAttribute('aria-pressed')).toBe('true');
    expect(textOf(inUse)).toBe(`${EN['devices.tab_in_use']}   3`);
    await page.click(page.find('tab_removed')!);
    expect(urls).toContain('/admin/queries/devices?include_revoked=true');
    expect(page.find('tab_removed')!.getAttribute('aria-pressed')).toBe('true');
    expect(textOf(page.find('tab_removed'))).toContain('1');
    const text = textOf(page.screen);
    expect(text).toContain('Tablet 3');
    expect(text).toContain('Lost on the family hall floor');
    expect(page.find('device_D1')).toBeUndefined();
    expect(page.find('more_D7')).toBeUndefined();
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
    // Pulse 00-S17: pair_url (RARE) only after Show link.
    expect(text).not.toContain('http://192.168.0.107:3000/pair?t=abc');
    await page.click(page.find('show_link')!);
    expect(textOf(page.screen)).toContain('http://192.168.0.107:3000/pair?t=abc');
    expect(page.find('show_link')).toBeUndefined();
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
    // Pulse 00-S18: the sub-line is the kind only; the idle rule and "since" left the row, the warn stays.
    expect(text).not.toContain(EN['sessions.idle_rule_h'].replace('{n}', '1'));
    expect(text).not.toContain(EN['sessions.stays_on']);
    expect(text).not.toContain('since');
    expect(textOf(page.find('session_SS1'))).toContain(EN['sessions.kind_staff']);
    expect(textOf(page.find('session_SS2'))).toContain(EN['sessions.kind_station']);
    expect(text).toContain(EN['sessions.idle_soon'].replace('{n}', '1'));
    expect(text).toContain(EN['sessions.you']);
    const logOut = byText(page, EN['sessions.log_out'], page.find('session_SS1'))!;
    expect(logOut.className.split(' ')).toContain('pos-btn--danger');
    expect(byText(page, EN['sessions.log_out'], page.find('session_SA'))).toBeUndefined();
    await page.click(byText(page, EN['sessions.log_out'], page.find('session_SS2'))!);
    expect(textOf(page.body)).toContain(EN['sessions.end_kds_title'].replace('{station}', 'Degh'));
    expect(page.find('dialog_confirm', page.body)!.className.split(' ')).toContain('pos-btn--danger');
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
    expect(text.replace(/\s+/g, ' ')).toContain(EN['staff.locked_min'].replace('{min}', '14'));
    // Pulse 00-S19: people first; screens and addresses behind one disclosure row with their count.
    expect(text).not.toContain('Counter 2');
    const more = page.find('lockouts_more')!;
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(textOf(more).replace(/\s+/g, ' ')).toContain(EN['lockouts.more_toggle'].replace('{n}', '1'));
    await page.click(more);
    expect(page.find('lockouts_more')).toBeUndefined();
    expect(textOf(page.screen)).toContain('Counter 2');
    expect(textOf(page.screen)).toContain(EN['lockouts.none_ip']);
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

  it('[00 §8.4 F05] hub busy after a command: one silent retry after retry_after_ms (same command_id), then "Hub busy, try again." whose Try again waits retry_after_ms and repeats the same command_id', async () => {
    const source = await html();
    const hub = fakeHub();
    let busy = true;
    hub.answers['/admin/commands/clear-pin-lockout'] = () =>
      busy ? jsonResponse(503, { error: { code: 'SERVICE_UNAVAILABLE', details: { retry_after_ms: 1500 } } }) : jsonResponse(200, { data: { result: { cleared: true } } });
    const page = await runPage(source, { store: STORE, session: SESSION, fetch: hub.fetch, hash: '#lockouts' });
    await page.click(byText(page, EN['lockouts.unlock'], page.find('lockout_staff_S_WAIT'))!);
    await page.click(page.find('dialog_confirm', page.body)!);
    // First 503: no banner yet, the retry waits retry_after_ms.
    expect(hub.sent).toHaveLength(1);
    expect(textOf(page.screen)).not.toContain(EN['global.busy']);
    expect(page.delays).toContain(1500);
    await page.advance();
    expect(hub.sent).toHaveLength(2);
    expect(hub.sent[1]!.body.command_id).toBe(hub.sent[0]!.body.command_id);
    // Second 503: the F05 banner.
    expect(textOf(page.screen)).toContain(EN['global.busy']);
    expect(textOf(page.screen)).toContain(EN['global.busy_small']);
    const again = byText(page, EN['global.try_again'], page.screen)!;
    expect(again.disabled).toBe(true);
    while (again.disabled && (await page.advance()));
    expect(again.disabled).toBe(false);
    busy = false;
    await page.click(again);
    expect(hub.sent).toHaveLength(3);
    expect(hub.sent[2]!.body.command_id).toBe(hub.sent[0]!.body.command_id);
    expect(textOf(page.screen)).not.toContain(EN['global.busy']);
    expect(textOf(page.screen)).toContain(EN['lockouts.unlocked'].replace('{name}', 'Bilal'));
  });

  it('[00 §8.4 F01] nothing loaded and the hub does not answer: the full hub-down state in the content region', async () => {
    const source = await html();
    const hub = fakeHub();
    hub.down = true;
    const page = await runPage(source, { store: STORE, session: SESSION, fetch: hub.fetch, hash: '#devices' });
    expect(textOf(page.screen)).toContain(EN['global.hub_down_title']);
    expect(textOf(page.screen)).toContain(EN['global.hub_down_body']);
    hub.down = false;
    for (let i = 0; i < 5 && textOf(page.screen).includes(EN['global.hub_down_title']); i += 1) await page.advance();
    expect(textOf(page.screen)).toContain(EN['devices.group_cashier']);
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

// ------------------------------------------------------------------------------------------- 00 v1.9.2 §8.2 (HK5)

describe('hub admin page: kitchen screens and printers entries (00 v1.9.2 §8.2, M86; Q-43)', () => {
  const builds: string[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    for (const dir of builds.splice(0)) rmSync(dir, { recursive: true, force: true });
    dist.kitchen = '/nonexistent/admin-kitchen-screens/';
    dist.printers = '/nonexistent/admin-printers/';
  });
  function build(): string {
    const dir = mkdtempSync(join(tmpdir(), 'admin-entry-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html>');
    builds.push(dir);
    return dir;
  }
  const KDS_CONFIG = {
    stations: [
      { station_id: 'TN', name: 'Tandoor', screens: [{ device_id: 'K1', name: 'Tandoor 1', lane_label: null, state: 'connected' }, { device_id: 'K2', name: 'Tandoor 2', lane_label: null, state: 'offline' }] },
      { station_id: 'DG', name: 'Degh', screens: [{ device_id: 'K3', name: 'Degh', lane_label: null, state: 'connected' }] },
    ],
    pass_tablets: [{ device_id: 'T1', name: 'Pass', point_id: 'P1', state: 'connected' }, { device_id: 'T2', name: 'Pass 2', point_id: 'P1', state: 'offline' }],
    warnings: [{ station_id: 'TN', kind: 'dark' }],
  };
  const PRINT_QUEUE = {
    printers: [
      { printer_id: 'PR1', name: 'Degh printer', status: 'clean', waiting: 2, suspect: 0, head_error: null, last_ack_at: null },
      { printer_id: 'PR2', name: 'Tandoor printer', status: 'paper_out', waiting: 7, suspect: 0, head_error: null, last_ack_at: null },
    ],
    jobs: [],
    no_printer: 0,
  };
  const TABLET = { device_id: 'D4', device_name: 'Pass tablet', device_type: 'tablet', station_id: null, owner_staff_id: null, owner_name: null, pairing_source: 'request', paired_at: NOW, paired_by_name: 'Arif', last_seen_at: NOW, revoked_at: null, revoked_by_name: null, revoked_reason: null, active_session: null };
  const sideNav = (page: PageSandbox) => page.findAll((el) => el.className === 'pos-sidenav')[0]!;
  const tileOf = (page: PageSandbox, href: string) => page.findAll((el) => el.className === 'pos-tile' && el.href === href)[0];

  it('[00 §10 #165] with manage-devices the side-nav and home show Kitchen screens and Printers, each tile reads its query once on open; 404 / 403 → no status line; without manage-devices nothing', async () => {
    dist.kitchen = build();
    dist.printers = build();
    const source = await html();
    const hub = fakeHub();
    hub.answers['/admin/queries/kds-config'] = () => jsonResponse(200, { data: KDS_CONFIG });
    hub.answers['/admin/queries/print-queue'] = () => jsonResponse(200, { data: PRINT_QUEUE });
    const page = await runPage(source, { store: STORE, session: SESSION, fetch: hub.fetch });
    const nav = sideNav(page);
    const navLinks = page.findAll((el) => el.tagName === 'a' && el.className === 'pos-sidenav__item', nav).map((el) => [el.href, textOf(el)]);
    expect(navLinks).toContainEqual(['/admin/kitchen-screens/', EN['admin.nav_kitchen_screens']]);
    expect(navLinks).toContainEqual(['/admin/printers/', EN['admin.nav_printers']]);
    expect(textOf(nav)).toContain(EN['admin.nav_other']);
    expect(hub.queried.filter((u) => u === '/admin/queries/kds-config')).toHaveLength(1);
    expect(hub.queried.filter((u) => u === '/admin/queries/print-queue')).toHaveLength(1);
    const kitchen = tileOf(page, '/admin/kitchen-screens/')!;
    expect(textOf(kitchen)).toContain(EN['admin.nav_kitchen_screens']);
    expect(page.findAll((el) => el.className === 'pos-tile__num', kitchen).map((el) => el.textContent)).toEqual(['3']);
    expect(textOf(kitchen)).toContain(EN['admin.tile_kitchen'].replace('{pass}', '2'));
    expect(textOf(kitchen)).toContain(EN['admin.kitchen_offline_one']);
    const printers = tileOf(page, '/admin/printers/')!;
    expect(page.findAll((el) => el.className === 'pos-tile__num', printers).map((el) => el.textContent)).toEqual(['2']);
    expect(textOf(printers)).toContain(EN['admin.tile_printers'].replace('{waiting}', '9'));
    expect(textOf(printers)).toContain(EN['admin.printer_problem'].replace('{name}', 'Tandoor printer').replace('{problem}', EN['admin.printer_paper_out']));
    // the M86 tiles are unchanged
    expect(page.findAll((el) => el.className === 'pos-tile__num').map((el) => el.textContent)).toEqual(['3', '2', '3', '3', '2']);

    // no lines: kds-config 404 (not on this hub yet), print-queue 403 (no sign-in prompt for a tile)
    const bare = fakeHub();
    bare.answers['/admin/queries/kds-config'] = () => jsonResponse(404, { error: { code: 'ROUTE_NOT_FOUND', details: {} } });
    bare.answers['/admin/queries/print-queue'] = () => jsonResponse(403, { error: { code: 'PERMISSION_DENIED', details: { permission: 'manage-devices' } } });
    const lineless = await runPage(source, { store: STORE, session: SESSION, fetch: bare.fetch });
    for (const href of ['/admin/kitchen-screens/', '/admin/printers/']) {
      const tile = tileOf(lineless, href)!;
      expect(tile, href).toBeDefined();
      expect(lineless.findAll((el) => el.className === 'pos-tile__num' || el.tagName === 'small' || el.className === 'pos-tile__foot', tile), href).toHaveLength(0);
    }
    expect(bare.queried.filter((u) => u === '/admin/queries/kds-config')).toHaveLength(1);
    expect(bare.queried.filter((u) => u === '/admin/queries/print-queue')).toHaveLength(1);
    expect(textOf(lineless.screen)).toContain(EN['admin.tile_devices'].replace('{n}', '3'));
    expect(bare.sent).toHaveLength(0);

    // a malformed 200 (fields missing) → the tile without a status line; the rest of home still renders
    const odd = fakeHub();
    odd.answers['/admin/queries/kds-config'] = () => jsonResponse(200, { data: { stations: [{ station_id: 'TN' }] } });
    odd.answers['/admin/queries/print-queue'] = () => jsonResponse(200, { data: {} });
    const malformed = await runPage(source, { store: STORE, session: SESSION, fetch: odd.fetch });
    for (const href of ['/admin/kitchen-screens/', '/admin/printers/']) {
      const tile = tileOf(malformed, href)!;
      expect(tile, href).toBeDefined();
      expect(malformed.findAll((el) => el.className === 'pos-tile__num' || el.tagName === 'small' || el.className === 'pos-tile__foot', tile), href).toHaveLength(0);
    }
    expect(textOf(malformed.screen)).toContain(EN['admin.tile_devices'].replace('{n}', '3'));

    // without manage-devices: no items, no tiles, no reads
    const viewerHub = fakeHub();
    const viewer = await runPage(source, { store: STORE, session: { ...SESSION, admin_permissions: JSON.stringify({ 'manage-devices': false, 'manage-staff': true }) }, fetch: viewerHub.fetch });
    expect(textOf(viewer.screen)).not.toContain(EN['admin.nav_kitchen_screens']);
    expect(textOf(viewer.screen)).not.toContain(EN['admin.nav_printers']);
    expect(viewerHub.queried.filter((u) => u.includes('kds-config') || u.includes('print-queue'))).toEqual([]);
    // the stock link still decides "Other jobs" alone
    expect(textOf(sideNav(viewer)).includes(EN['admin.nav_other'])).toBe(textOf(sideNav(viewer)).includes(EN['admin.nav_stock']));

    // no builds → no items, no tiles, no reads, even with manage-devices
    dist.kitchen = '/nonexistent/admin-kitchen-screens/';
    dist.printers = '/nonexistent/admin-printers/';
    const plain = await html();
    const plainHub = fakeHub();
    const none = await runPage(plain, { store: STORE, session: SESSION, fetch: plainHub.fetch });
    expect(textOf(none.screen)).not.toContain(EN['admin.nav_kitchen_screens']);
    expect(textOf(none.screen)).not.toContain(EN['admin.nav_printers']);
    expect(plainHub.queried.filter((u) => u.includes('kds-config') || u.includes('print-queue'))).toEqual([]);
  });

  it('[00 §10 #165] a tablet Devices row links /admin/kitchen-screens/#bind=<device_id>; a kds / phone row does not', async () => {
    dist.kitchen = build();
    const source = await html();
    const hub = fakeHub();
    hub.answers['/admin/queries/devices'] = () => jsonResponse(200, { data: { devices: [...DEVICES.devices, TABLET] } });
    const page = await runPage(source, { store: STORE, session: SESSION, fetch: hub.fetch, hash: '#devices' });
    const bindLinks = (root: StubElement) => page.findAll((el) => el.tagName === 'a' && String(el.href).startsWith('/admin/kitchen-screens/'), root);
    const tablet = bindLinks(page.find('device_D4')!);
    expect(tablet.map((el) => el.href)).toEqual(['/admin/kitchen-screens/#bind=D4']);
    expect(textOf(tablet[0]!)).toBe(EN['devices.use_as_pass']);
    for (const id of ['D1', 'D2', 'D3']) expect(bindLinks(page.find(`device_${id}`)!), id).toHaveLength(0);

    // read-only admins and a hub without the build get no link
    const viewer = await runPage(source, { store: STORE, session: { ...SESSION, admin_permissions: JSON.stringify({ 'manage-devices': false, 'manage-staff': true }) }, fetch: hub.fetch, hash: '#devices' });
    expect(bindLinks(viewer.find('device_D4')!)).toHaveLength(0);
    dist.kitchen = '/nonexistent/admin-kitchen-screens/';
    const plain = await runPage(await html(), { store: STORE, session: SESSION, fetch: hub.fetch, hash: '#devices' });
    expect(bindLinks(plain.find('device_D4')!)).toHaveLength(0);
  });
});
