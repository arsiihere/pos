import { afterEach, describe, expect, it } from 'vitest';
import { registerStationValidator } from '../../src/auth/station-validator';
import { sha256hex } from '../../src/lib/hash';
import { aDirectory } from '../helpers/fixtures';
import { EN } from '../../src/lib/strings';
import { jsonResponse, runPage, textOf } from '../helpers/page-sandbox';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

const cleanups: Array<() => Promise<void>> = [];

describe('ApprovePairingRequest', () => {
  afterEach(async () => {
    registerStationValidator(() => false);
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #96] kds with station → device with station_id, DevicePaired { pairing_request_id }; wrong display code → 404; approved twice → 404; unknown station → 404; no manage-devices → 403; result never contains the token', async () => {
    const hub = await open();
    registerStationValidator((_tx, id) => id === 'STATION-1');
    const admin = adminOf(hub);
    const created = await hub.app.inject({
      method: 'POST',
      url: '/pair/requests',
      remoteAddress: '10.8.0.1',
      payload: { device_name: 'Kitchen' },
    });
    const request = created.json().data as { request_id: string; display_code: string; poll_secret: string };
    const approved = await approve(hub, admin, {
      request_id: request.request_id,
      display_code: request.display_code,
      device_type: 'kds',
      station_id: 'STATION-1',
    });
    expect(approved.statusCode).toBe(200);
    const result = approved.json().data.result as Record<string, unknown>;
    expect(result).toEqual({ device_id: result.device_id, device_type: 'kds', station_id: 'STATION-1' });
    expect(JSON.stringify(result)).not.toContain('device_token');
    const device = hub.deps.db
      .prepare('SELECT device_type, station_id, device_name, paired_by, token_hash FROM devices WHERE device_id = ?')
      .get(result.device_id) as {
      device_type: string;
      station_id: string | null;
      device_name: string;
      paired_by: string;
      token_hash: string;
    };
    expect(device).toMatchObject({ device_type: 'kds', station_id: 'STATION-1', device_name: 'Kitchen', paired_by: 'S_OWNER' });
    const stored = hub.deps.db
      .prepare('SELECT delivery_token, approved_by FROM pair_requests WHERE request_id = ?')
      .get(request.request_id) as { delivery_token: string; approved_by: string };
    expect(stored.approved_by).toBe('S_OWNER');
    expect(sha256hex(stored.delivery_token)).toBe(device.token_hash);
    expect(JSON.stringify(result)).not.toContain(stored.delivery_token);
    const event = JSON.parse(
      hub.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'DevicePaired'`).pluck().get() as string,
    ) as { pairing_request_id: string | null; pairing_token_id: string | null; station_id: string | null };
    expect(event).toMatchObject({
      pairing_request_id: request.request_id,
      pairing_token_id: null,
      station_id: 'STATION-1',
    });

    const other = await hub.app.inject({
      method: 'POST',
      url: '/pair/requests',
      remoteAddress: '10.8.0.2',
      payload: { device_name: 'Bar' },
    });
    const second = other.json().data as { request_id: string; display_code: string };
    const wrong = await approve(
      hub,
      admin,
      {
        request_id: second.request_id,
        display_code: 'ZZZZZZ',
        device_type: 'kds',
        station_id: 'STATION-1',
      },
      'cmd-wrong-code',
    );
    expect(wrong.statusCode).toBe(404);
    expect(wrong.json().error.code).toBe('PAIRING_REQUEST_NOT_FOUND');
    const stillPending = hub.deps.db
      .prepare('SELECT approved_at FROM pair_requests WHERE request_id = ?')
      .get(second.request_id) as { approved_at: number | null };
    expect(stillPending.approved_at).toBeNull();

    const wrongStation = await approve(
      hub,
      admin,
      {
        request_id: second.request_id,
        display_code: 'YYYYYY',
        device_type: 'kds',
        station_id: 'missing',
      },
      'cmd-wrong-code-station',
    );
    expect(wrongStation.statusCode).toBe(404);
    expect(wrongStation.json().error.code).toBe('PAIRING_REQUEST_NOT_FOUND');

    const twice = await approve(hub, admin, {
      request_id: request.request_id,
      display_code: request.display_code,
      device_type: 'kds',
      station_id: 'STATION-1',
    }, 'cmd-twice');
    expect(twice.statusCode).toBe(404);
    expect(twice.json().error.code).toBe('PAIRING_REQUEST_NOT_FOUND');

    const third = await hub.app.inject({
      method: 'POST',
      url: '/pair/requests',
      remoteAddress: '10.8.0.4',
      payload: { device_name: 'Pass' },
    });
    const thirdBody = third.json().data as { request_id: string; display_code: string };
    const unknown = await approve(
      hub,
      admin,
      {
        request_id: thirdBody.request_id,
        display_code: thirdBody.display_code,
        device_type: 'kds',
        station_id: 'missing',
      },
      'cmd-unknown-station',
    );
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe('STATION_NOT_FOUND');
    expect(unknown.json().error.details).toEqual({ station_id: 'missing' });

    const deniedDir = await aDirectory();
    const owner = deniedDir.staff.find((staff) => staff.staff_id === 'S_OWNER');
    if (owner === undefined) throw new Error('owner missing');
    owner.denied_permissions = ['manage-devices'];
    const deniedHub = await open(deniedDir);
    const deniedAdmin = adminOf(deniedHub);
    const pending = await deniedHub.app.inject({
      method: 'POST',
      url: '/pair/requests',
      remoteAddress: '10.8.0.3',
      payload: { device_name: 'Denied' },
    });
    const pendingBody = pending.json().data as { request_id: string; display_code: string };
    const denied = await approve(deniedHub, deniedAdmin, {
      request_id: pendingBody.request_id,
      display_code: pendingBody.display_code,
      device_type: 'cashier_kiosk',
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('PERMISSION_DENIED');

  });

  it('[00 §6.32] retransmit of a display-code-only approval → same body, Idempotent-Replay: true, one DevicePaired (D32)', async () => {
    const hub = await open();
    const admin = adminOf(hub);
    const created = await hub.app.inject({
      method: 'POST',
      url: '/pair/requests',
      remoteAddress: '10.8.0.1',
      payload: { device_name: 'Till' },
    });
    const { display_code } = created.json().data as { display_code: string };
    const payload = { display_code, device_type: 'cashier_kiosk' };
    const first = await approve(hub, admin, payload, 'cmd-code-retransmit');
    expect(first.statusCode).toBe(200);
    expect(first.headers['idempotent-replay']).toBeUndefined();
    const again = await approve(hub, admin, payload, 'cmd-code-retransmit');
    expect(again.statusCode).toBe(200);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.json()).toEqual(first.json());
    expect(hub.deps.db.prepare(`SELECT COUNT(*) FROM events WHERE event_type = 'DevicePaired'`).pluck().get()).toBe(1);
  });

  it('[00 §8.4] the approve page signs in on the PIN pad: wrong PIN, tries left when ≤ 2, person lockout locks the tile, screen lockout with the minutes; success stores the session and permissions', async () => {
    const hub = await open();
    const html = (await hub.app.inject({ method: 'GET', url: '/admin/approve' })).body;
    const answers = [
      jsonResponse(401, { error: { code: 'PIN_INVALID', details: { attempts_remaining: 4 } } }),
      jsonResponse(401, { error: { code: 'PIN_INVALID', details: { attempts_remaining: 2 } } }),
      jsonResponse(429, { error: { code: 'PIN_LOCKED_OUT', details: { retry_after_ms: 600_000 } } }),
      jsonResponse(429, { error: { code: 'DEVICE_LOCKED_OUT', details: { retry_after_ms: 61_000 } } }),
      jsonResponse(200, { data: { admin_session_token: 'adm', session_id: 's', staff_id: 'S_MGR', display_name: 'Imran', idle_ttl_ms: 1, permissions: { 'manage-devices': true, 'manage-staff': true } } }),
    ];
    const page = await runPage(html, {
      store: { token: 'tablet-token', device_id: 'tablet-1' },
      fetch: (url) => {
        if (url === '/admin/login-roster') {
          return Promise.resolve(jsonResponse(200, { data: { staff: [{ staff_id: 'S_OWNER', display_name: 'Owner', locked_until: null }, { staff_id: 'S_MGR', display_name: 'Imran', locked_until: null }] } }));
        }
        if (url === '/admin/auth') return Promise.resolve(answers.shift());
        if (url === '/admin/queries/stations') return Promise.resolve(jsonResponse(200, { data: { stations: [] } }));
        throw new Error(`unexpected ${url}`);
      },
    });
    expect(textOf(page.byId('approve_end'))).toContain(EN['approve.signin_chip']);
    const tiles = page.findAll((el) => el.className === 'pos-staff__tile' || el.className.startsWith('pos-staff__tile '));
    const key = (label: string) => page.findAll((el) => el.className.includes('pos-pin__key') && el.textContent === label)[0]!;
    const signIn = async () => {
      for (const digit of '0000') await page.click(key(digit));
      await page.click(key(EN['pin.submit']));
    };
    const message = () => textOf(page.find('auth_error'));
    const pin = page.find('pin')!;
    expect(pin.type).toBe('password');
    expect(pin.inputMode).toBe('numeric');
    await page.click(tiles[0]!);
    await signIn();
    expect(message()).toBe(EN['pin.wrong']);
    await signIn();
    expect(message()).toBe(EN['pin.tries_left'].replace('{n}', '2'));
    await signIn();
    expect(message()).toBe(`${EN['pin.locked_title']} ${EN['pin.locked_person'].replace('{name}', 'Owner').replace('{min}', '10')}`);
    expect(tiles[0]!.classList.contains('is-locked')).toBe(true);
    await page.click(tiles[1]!);
    await signIn();
    expect(message()).toBe(`${EN['pin.locked_device'].replace('{min}', '2')} ${EN['pin.locked_device_body']}`);
    await page.advance();
    await signIn();
    expect(page.session.get('admin_session_token')).toBe('adm');
    expect(JSON.parse(page.session.get('admin_permissions')!)).toEqual({ 'manage-devices': true, 'manage-staff': true });
    // The avatar initial, then the name (frame ApproveForm app bar).
    expect(textOf(page.byId('approve_end'))).toBe('I Imran');
    expect(textOf(page.screen)).not.toMatch(/errors\.|pin\.|attempts_remaining/);
  });

  it('[00 §8.2] approve form: code, type and station tiles with the preview; client checks; PAIRING_REQUEST_NOT_FOUND marks the code; success says which screen opens; Approve another clears; read-only without manage-devices', async () => {
    const hub = await open();
    const html = (await hub.app.inject({ method: 'GET', url: '/admin/approve' })).body;
    const sent: Array<Record<string, unknown>> = [];
    const answers = [
      jsonResponse(404, { error: { code: 'PAIRING_REQUEST_NOT_FOUND', details: {} } }),
      jsonResponse(200, { data: { command_id: 'c', event_ids: ['e'], result: { device_id: 'K1', device_type: 'kds', station_id: 'T' } } }),
    ];
    const stations = { data: { stations: [{ station_id: 'T', name: 'Tandoor', location_label: null, category_names: ['Naan', 'Roti'] }] } };
    const fetch = (url: string, init?: unknown) => {
      const request = init as { headers: Record<string, string>; body: string };
      expect(request.headers['x-admin-session']).toBe('admin-tok');
      expect(request.headers.authorization).toBeUndefined();
      if (url === '/admin/queries/stations') return Promise.resolve(jsonResponse(200, stations));
      if (url !== '/admin/commands/approve-pairing-request') throw new Error(`unexpected ${url}`);
      sent.push(JSON.parse(request.body));
      return Promise.resolve(answers.shift());
    };
    const session = { admin_session_token: 'admin-tok', admin_staff_id: 'S_OWNER', admin_bootstrap: '1', admin_name: 'Owner' };
    const page = await runPage(html, { session, fetch });
    const form = () => page.findAll((el) => el.tagName === 'form')[0]!;
    const opts = () => page.find('device_type')!.children;
    expect(textOf(page.byId('approve_end'))).toBe('O Owner');
    // Pulse: one outcome line under Approve replaces the aside; hidden until a kind is picked (CHANGES §2).
    const outcome = () => page.findAll((el) => el.className === 'pos-outcome', form())[0]!;
    expect(outcome().hidden).toBe(true);
    expect(textOf(page.screen)).not.toContain(EN['approve.preview_title']);
    expect(textOf(page.screen)).not.toContain(EN['approve.audit_note']);
    page.find('display_code')!.value = 'ab s-12 3';
    await page.submit(form());
    expect(sent).toHaveLength(0);
    expect(textOf(form())).toContain(EN['approve.err_kind']);
    await page.click(opts()[0]!);
    expect(textOf(page.screen)).toContain(EN['approve.preview_cashier']);
    expect(outcome().hidden).toBe(false);
    expect(textOf(outcome()).replace(/\s+/g, ' ').replace(/ \./g, '.')).toBe(`The new screen will open as ${EN['approve.kind_cashier']}. ${EN['approve.preview_cashier']}`);
    await page.submit(form());
    expect(sent[0]).toMatchObject({
      command_type: 'ApprovePairingRequest',
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      actor_id: 'S_OWNER',
      device_id: 'hub-admin',
      payload: { display_code: 'ABS123', device_type: 'cashier_kiosk' },
    });
    expect((sent[0]!.payload as Record<string, unknown>).station_id).toBeUndefined();
    expect(textOf(form())).toContain(EN['errors.PAIRING_REQUEST_NOT_FOUND']);

    page.find('display_code')!.value = 'ABCI24';
    await page.submit(form());
    expect(textOf(form())).toContain(EN['approve.err_code_format']);
    expect(sent).toHaveLength(1);
    page.find('display_code')!.value = 'ABC124';
    await page.click(opts()[1]!);
    await page.submit(form());
    expect(textOf(form())).toContain(EN['approve.err_station']);
    const tandoor = page.find('station_id')!.children[0]!;
    expect(textOf(tandoor)).toBe('Tandoor Naan, Roti');
    await page.click(tandoor);
    expect(textOf(page.screen)).toContain(EN['approve.preview_kds_name'].replace('{station}', 'Tandoor'));
    expect(page.findAll((el) => el.tagName === 'b', outcome())[0]!.textContent).toBe(EN['approve.preview_kds_name'].replace('{station}', 'Tandoor'));
    await page.submit(form());
    expect(sent[1]).toMatchObject({ payload: { display_code: 'ABC124', device_type: 'kds', station_id: 'T' } });
    expect(textOf(page.screen)).toContain(EN['approve.done_title']);
    expect(textOf(page.screen)).toContain(EN['approve.done_body_kds'].replace('{station}', 'Tandoor'));
    // The audit note moved from the form to the result screen (CHANGES §2).
    expect(textOf(page.screen)).toContain(EN['approve.audit_note']);
    const again = page.findAll((el) => el.tagName === 'button' && textOf(el) === EN['approve.another']);
    expect(again).toHaveLength(1);
    await page.click(again[0]!);
    expect(page.find('display_code')?.value).toBe('');

    const readOnly = await runPage(html, { session: { ...session, admin_permissions: JSON.stringify({ 'manage-devices': false, 'manage-staff': false }) }, fetch });
    expect(textOf(readOnly.screen)).toContain(EN['errors.PERMISSION_DENIED_devices']);
    expect(readOnly.findAll((el) => el.className.includes('pos-btn--primary'))[0]!.disabled).toBe(true);
  });

  it('[00 §10 #133] admin pages load with no credentials and embed no token; a guest IP is 403; approval by display code alone takes the single pending match, else 404; the approve page logs in from storage', async () => {
    const hub = await open();
    const admin = adminOf(hub);

    const page = await hub.app.inject({ method: 'GET', url: '/admin/approve?r=req-1' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('tenant-a');
    expect(page.body).toContain('branch-1');
    expect(page.body).not.toContain(admin.device.token);
    expect(page.body).not.toContain(admin.session.token);
    for (const part of [
      'indexedDB',
      'sessionStorage',
      'admin_session_token',
      'admin_staff_id',
      'admin_bootstrap',
      '/admin/login-roster',
      '/admin/auth',
      'pairing.approve_needs_admin_device',
      'hub-admin',
      'approve-pairing-request',
    ]) {
      expect(page.body).toContain(part);
    }
    const bootstrapPage = await hub.app.inject({ method: 'GET', url: '/admin/bootstrap' });
    expect(bootstrapPage.statusCode).toBe(200);
    expect(bootstrapPage.body).toContain('admin_staff_id');
    expect(bootstrapPage.body).toContain('admin_bootstrap');
    const guest = await hub.app.inject({ method: 'GET', url: '/admin/approve', remoteAddress: '192.168.20.7' });
    expect(guest.statusCode).toBe(403);
    expect(guest.json().error.code).toBe('GUEST_NETWORK_FORBIDDEN');

    const created = await hub.app.inject({
      method: 'POST',
      url: '/pair/requests',
      remoteAddress: '10.8.0.1',
      payload: { device_name: 'Till' },
    });
    const request = created.json().data as { request_id: string; display_code: string };
    const none = await approve(hub, admin, { display_code: 'ZZZZZZ', device_type: 'cashier_kiosk' }, 'cmd-code-none');
    expect(none.statusCode).toBe(404);
    expect(none.json().error.code).toBe('PAIRING_REQUEST_NOT_FOUND');
    const byCode = await approve(hub, admin, { display_code: request.display_code, device_type: 'cashier_kiosk' }, 'cmd-code');
    expect(byCode.statusCode).toBe(200);
    const approvedRow = hub.deps.db
      .prepare('SELECT device_id FROM pair_requests WHERE request_id = ?')
      .get(request.request_id) as { device_id: string | null };
    expect(approvedRow.device_id).toBe(byCode.json().data.result.device_id);

    const a = await hub.app.inject({ method: 'POST', url: '/pair/requests', remoteAddress: '10.8.0.2', payload: { device_name: 'A' } });
    const b = await hub.app.inject({ method: 'POST', url: '/pair/requests', remoteAddress: '10.8.0.3', payload: { device_name: 'B' } });
    const code = (a.json().data as { display_code: string }).display_code;
    hub.deps.db
      .prepare('UPDATE pair_requests SET display_code = ? WHERE request_id = ?')
      .run(code, (b.json().data as { request_id: string }).request_id);
    const ambiguous = await approve(hub, admin, { display_code: code, device_type: 'cashier_kiosk' }, 'cmd-code-two');
    expect(ambiguous.statusCode).toBe(404);
    expect(ambiguous.json().error.code).toBe('PAIRING_REQUEST_NOT_FOUND');
  });
});

async function open(directory?: Awaited<ReturnType<typeof aDirectory>>): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  await seedDirectory(hub, directory);
  return hub;
}

function adminOf(hub: TestHub): { device: { deviceId: string; token: string }; session: { token: string } } {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'admin', staffId: 'S_OWNER', deviceId: device.deviceId });
  return { device, session };
}

function approve(
  hub: TestHub,
  admin: { device: { deviceId: string; token: string }; session: { token: string } },
  payload: Record<string, unknown>,
  commandId = 'cmd-approve-pairing-request',
) {
  return hub.app.inject({
    method: 'POST',
    url: '/admin/commands/approve-pairing-request',
    headers: { authorization: `Bearer ${admin.device.token}`, 'x-admin-session': admin.session.token },
    payload: {
      command_id: commandId,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'ApprovePairingRequest',
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: 'S_OWNER',
      device_id: admin.device.deviceId,
    },
  });
}
