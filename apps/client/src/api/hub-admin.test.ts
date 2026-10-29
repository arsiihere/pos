import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHubAdmin } from './hub-admin';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function apiError(status: number, code: string, details: Record<string, unknown> = {}): Response {
  return json(status, { error: { code, message: code, details, request_id: 'R1' } });
}

function fakeFetch(replies: Response[]) {
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (input: string, init?: RequestInit) => {
    calls.push({
      url: input,
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string>) },
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    const next = replies.shift();
    if (next === undefined) throw new Error('no reply left');
    return next;
  });
  return { calls, fetchFn };
}

const LOGIN = {
  admin_session_token: 'AS1',
  session_id: 'SES1',
  staff_id: 'S_MGR',
  display_name: 'Manager',
  idle_ttl_ms: 900_000,
};

const STATUS = {
  tenant_id: 'T1',
  branch_id: 'B1',
  config_version: 3,
  snapshot_schema_version: 1,
  applied_at: 10,
  directory_version: 2,
  last_poll: { outcome: 'applied', at: 20 },
  last_problem: null,
};

const OPENED = { business_date: '2026-10-26', opened_at: 30, changed: true, reason: 'opened' };

function client(replies: Response[], onSignedOut = () => {}) {
  const { calls, fetchFn } = fakeFetch(replies);
  const api = createHubAdmin({
    fetch: fetchFn,
    readDeviceToken: async () => 'DT1',
    readDeviceId: async () => 'D1',
    onSignedOut,
  });
  return { api, calls };
}

describe('hub-admin client', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it('[01a §8.2] hub-admin sends the device token and admin session headers', async () => {
    const { api, calls } = client([
      json(200, { data: { staff: [{ staff_id: 'S_MGR', display_name: 'Manager', locked_until: null }] } }),
      json(200, { data: LOGIN }),
      json(200, { data: STATUS }),
      json(200, { data: { command_id: 'C1', event_ids: ['E1'], result: OPENED } }),
      json(200, { data: { unchanged: true } }),
    ]);

    expect(api.hasSession()).toBe(false);
    expect(await api.roster()).toEqual({
      ok: true,
      data: { staff: [{ staff_id: 'S_MGR', display_name: 'Manager', locked_until: null }] },
    });
    expect(calls[0]).toMatchObject({ url: '/admin/login-roster', method: 'GET', headers: { Authorization: 'Bearer DT1' } });
    expect(calls[0]?.headers).not.toHaveProperty('X-Admin-Session');

    expect(await api.login('S_MGR', '0123')).toEqual({ ok: true, data: LOGIN });
    expect(calls[1]).toMatchObject({
      url: '/admin/auth',
      method: 'POST',
      headers: { Authorization: 'Bearer DT1', 'Content-Type': 'application/json' },
      body: { staff_id: 'S_MGR', pin: '0123' },
    });
    expect(sessionStorage.getItem('admin_session_token')).toBe('AS1');
    expect(sessionStorage.getItem('admin_staff_id')).toBe('S_MGR');
    expect(api.hasSession()).toBe(true);

    // D7: the provisioned ids come from config-status and go into every command envelope.
    expect(await api.configStatus()).toEqual({ ok: true, data: STATUS });
    expect(calls[2]).toMatchObject({
      url: '/admin/queries/config-status',
      headers: { Authorization: 'Bearer DT1', 'X-Admin-Session': 'AS1' },
    });

    expect(await api.openBusinessDay('C1')).toEqual({ ok: true, data: OPENED });
    const sent = calls[3];
    expect(sent).toMatchObject({
      url: '/admin/commands/open-business-day',
      method: 'POST',
      headers: { Authorization: 'Bearer DT1', 'X-Admin-Session': 'AS1', 'Content-Type': 'application/json' },
      body: {
        command_id: 'C1',
        tenant_id: 'T1',
        branch_id: 'B1',
        command_type: 'OpenBusinessDay',
        payload: {},
        actor_id: 'S_MGR',
        device_id: 'D1',
      },
    });
    expect(typeof (sent?.body as { occurred_at: unknown }).occurred_at).toBe('number');

    await api.stock({ meta_version: '3.30', stock_version: 7 });
    expect(calls[4]).toMatchObject({
      url: '/admin/queries/stock?meta_version=3.30&stock_version=7',
      headers: { Authorization: 'Bearer DT1', 'X-Admin-Session': 'AS1' },
    });
  });

  it('[01a §8.2, D7] a command before any config-status read fetches the ids first; each command keeps its command_id', async () => {
    sessionStorage.setItem('admin_session_token', 'AS1');
    sessionStorage.setItem('admin_staff_id', 'S_MGR');
    const result = { stock_items: [{ stock_item_id: 'I1', on_hand: 4, reserved: 0, unit: 'piece', available: 4, level: 'ok', set_at: 1 }] };
    const { api, calls } = client([
      json(200, { data: STATUS }),
      json(200, { data: { command_id: 'C2', event_ids: ['E2'], result } }),
    ]);

    expect(await api.setPrecookedStock({ entries: [{ stock_item_id: 'I1', on_hand: 4 }] }, 'C2')).toEqual({ ok: true, data: result });
    expect(calls.map((c) => c.url)).toEqual(['/admin/queries/config-status', '/admin/commands/set-precooked-stock']);
    expect(calls[1]?.body).toMatchObject({
      command_id: 'C2',
      tenant_id: 'T1',
      branch_id: 'B1',
      command_type: 'SetPrecookedStock',
      payload: { entries: [{ stock_item_id: 'I1', on_hand: 4 }] },
    });
  });

  it('[01a §8.2] ADMIN_SESSION_REQUIRED clears the admin session and calls onSignedOut; a network failure keeps it', async () => {
    sessionStorage.setItem('admin_session_token', 'AS1');
    sessionStorage.setItem('admin_staff_id', 'S_MGR');
    const onSignedOut = vi.fn();
    const { api } = client([apiError(401, 'ADMIN_SESSION_REQUIRED')], onSignedOut);

    expect(await api.configStatus()).toEqual({ ok: false, error: { kind: 'signed_out' } });
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(api.hasSession()).toBe(false);
    expect(sessionStorage.getItem('admin_staff_id')).toBeNull();

    sessionStorage.setItem('admin_session_token', 'AS2');
    expect(await api.configStatus()).toEqual({ ok: false, error: { kind: 'network' } });
    expect(api.hasSession()).toBe(true);
  });

  it('[01a §8.2] a refused PIN is a typed error and stores no session', async () => {
    const { api } = client([apiError(401, 'PIN_INVALID', { attempts_remaining: 2 })]);
    expect(await api.login('S_MGR', '9999')).toEqual({
      ok: false,
      error: { kind: 'api', status: 401, code: 'PIN_INVALID', details: { attempts_remaining: 2 } },
    });
    expect(api.hasSession()).toBe(false);
  });

  it('[01a §10 #172 client part] sign-in writes 00\'s admin keys; logout and a signed-out answer clear all five', async () => {
    const { api, calls } = client([
      json(200, { data: { ...LOGIN, display_name: 'Imran', permissions: { 'manage-devices': true, 'manage-staff': false } } }),
      json(200, { data: { session_id: 'SES1', ended_at: 5, already_ended: false } }),
    ]);
    expect((await api.login('S_MGR', '1234')).ok).toBe(true);
    expect(sessionStorage.getItem('admin_name')).toBe('Imran');
    expect(JSON.parse(sessionStorage.getItem('admin_permissions') ?? '{}')).toEqual({ 'manage-devices': true, 'manage-staff': false });
    expect(api.adminName()).toBe('Imran');
    sessionStorage.setItem('admin_bootstrap', '1');

    await api.logout();
    expect(calls.at(-1)?.url).toBe('/admin/auth/logout');
    for (const key of ['admin_session_token', 'admin_staff_id', 'admin_name', 'admin_permissions', 'admin_bootstrap']) {
      expect(sessionStorage.getItem(key), key).toBeNull();
    }

    for (const key of ['admin_session_token', 'admin_staff_id', 'admin_name', 'admin_permissions', 'admin_bootstrap']) {
      sessionStorage.setItem(key, 'x');
    }
    const signedOut = client([apiError(401, 'ADMIN_SESSION_REQUIRED')]);
    await signedOut.api.configStatus();
    for (const key of ['admin_session_token', 'admin_staff_id', 'admin_name', 'admin_permissions', 'admin_bootstrap']) {
      expect(sessionStorage.getItem(key), key).toBeNull();
    }
  });

  it('[01a S54 g] a failed logout call still clears the keys', async () => {
    sessionStorage.setItem('admin_session_token', 'AS1');
    sessionStorage.setItem('admin_name', 'Imran');
    const fetchFn = vi.fn(async () => {
      throw new TypeError('network');
    });
    const api = createHubAdmin({ fetch: fetchFn, readDeviceToken: async () => 'DT1', readDeviceId: async () => 'D1', onSignedOut: () => {} });
    await api.logout();
    expect(sessionStorage.getItem('admin_session_token')).toBeNull();
    expect(sessionStorage.getItem('admin_name')).toBeNull();
  });
});
