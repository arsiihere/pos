import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCloudAdmin } from './cloud-admin';

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

const TOKENS = {
  access_token: 'A1',
  access_expires_at: 1,
  refresh_token: 'R1',
  refresh_expires_at: 2,
  user: { user_id: 'U1', display_name: 'Owner', tenant_id: 'T1', allowed_branch_ids: ['B1', 'B2'] },
};

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

const FLOOR = { floor_id: 'F1', name: 'Ground', sort_order: 0, archived_at: null };

describe('cloud-admin client', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it('[01a §8.1] login stores the tokens and the user in sessionStorage', async () => {
    const { calls, fetchFn } = fakeFetch([json(200, { data: TOKENS })]);
    const api = createCloudAdmin({ fetch: fetchFn, onLoggedOut: () => {} });

    const result = await api.login('o@example.com', 'password1');
    expect(result).toEqual({ ok: true, data: TOKENS.user });
    expect(calls[0]).toMatchObject({ url: '/v1/auth/login', method: 'POST', body: { email: 'o@example.com', password: 'password1' } });
    expect(sessionStorage.getItem('owner_access_token')).toBe('A1');
    expect(sessionStorage.getItem('owner_refresh_token')).toBe('R1');
    expect(api.currentUser()).toEqual(TOKENS.user);
  });

  it('[01a §8.1] 401 → one refresh → same Idempotency-Key; second 401 → onLoggedOut', async () => {
    sessionStorage.setItem('owner_access_token', 'OLD');
    sessionStorage.setItem('owner_refresh_token', 'R0');
    const onLoggedOut = vi.fn();
    const { calls, fetchFn } = fakeFetch([
      apiError(401, 'JWT_INVALID'),
      json(200, { data: TOKENS }),
      json(201, { data: { floor: FLOOR } }),
    ]);
    const api = createCloudAdmin({ fetch: fetchFn, onLoggedOut });

    const created = await api.createFloor('B1', { name: 'Ground' }, 'KEY1');
    expect(created).toEqual({ ok: true, data: { floor: FLOOR } });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /v1/admin/branches/B1/floors',
      'POST /v1/auth/refresh',
      'POST /v1/admin/branches/B1/floors',
    ]);
    expect(calls[0]?.headers['Authorization']).toBe('Bearer OLD');
    expect(calls[1]?.body).toEqual({ refresh_token: 'R0' });
    expect(calls[2]?.headers['Authorization']).toBe('Bearer A1');
    expect(calls[0]?.headers['Idempotency-Key']).toBe('KEY1');
    expect(calls[2]?.headers['Idempotency-Key']).toBe('KEY1');
    expect(calls[2]?.body).toEqual({ name: 'Ground' });
    expect(onLoggedOut).not.toHaveBeenCalled();

    // The refreshed token is refused too: no second refresh, the tokens go, the app logs out.
    const second = fakeFetch([apiError(401, 'JWT_INVALID'), json(200, { data: TOKENS }), apiError(401, 'JWT_INVALID')]);
    const api2 = createCloudAdmin({ fetch: second.fetchFn, onLoggedOut });
    const refused = await api2.createFloor('B1', { name: 'Ground' }, 'KEY2');
    expect(refused).toEqual({ ok: false, error: { kind: 'logged_out' } });
    expect(second.calls.map((c) => c.url)).toEqual([
      '/v1/admin/branches/B1/floors',
      '/v1/auth/refresh',
      '/v1/admin/branches/B1/floors',
    ]);
    expect(second.calls[2]?.headers['Idempotency-Key']).toBe('KEY2');
    expect(onLoggedOut).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('owner_access_token')).toBeNull();
    expect(sessionStorage.getItem('owner_refresh_token')).toBeNull();
  });

  it('[01a §8.1] a refused refresh logs out without retrying the request', async () => {
    sessionStorage.setItem('owner_access_token', 'OLD');
    sessionStorage.setItem('owner_refresh_token', 'R0');
    const onLoggedOut = vi.fn();
    const { calls, fetchFn } = fakeFetch([apiError(401, 'JWT_INVALID'), apiError(401, 'REFRESH_TOKEN_INVALID')]);
    const api = createCloudAdmin({ fetch: fetchFn, onLoggedOut });

    expect(await api.listFloors('B1')).toEqual({ ok: false, error: { kind: 'logged_out' } });
    expect(calls).toHaveLength(2);
    expect(onLoggedOut).toHaveBeenCalledTimes(1);
  });

  it('[01a §8.1] a network failure is a network error; 403 PERMISSION_DENIED keeps its reason', async () => {
    sessionStorage.setItem('owner_access_token', 'A1');
    const onLoggedOut = vi.fn();
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(apiError(403, 'PERMISSION_DENIED', { reason: 'tenant_wide_write' }))
      .mockResolvedValueOnce(apiError(409, 'CONFIG_IN_USE', { entity: 'floor', id: 'F1' }));
    const api = createCloudAdmin({ fetch: fetchFn, onLoggedOut });

    expect(await api.patchFloor('B1', 'F1', { name: 'Roof' })).toEqual({ ok: false, error: { kind: 'network' } });
    expect(await api.patchMenuItem('I1', { price_minor: 100 })).toEqual({
      ok: false,
      error: { kind: 'permission_denied', reason: 'tenant_wide_write' },
    });
    expect(await api.patchFloor('B1', 'F1', { archived: true })).toEqual({
      ok: false,
      error: { kind: 'api', status: 409, code: 'CONFIG_IN_USE', details: { entity: 'floor', id: 'F1' } },
    });
    expect(onLoggedOut).not.toHaveBeenCalled();
  });

  it('[01a §6.11] getMenu sends q, category_id, status, cursor and limit', async () => {
    sessionStorage.setItem('owner_access_token', 'A1');
    const page = { can_edit_tenant: true, tax_classes: [], categories: [], items: [], next_cursor: null };
    const { calls, fetchFn } = fakeFetch([json(200, { data: page }), json(200, { data: page })]);
    const api = createCloudAdmin({ fetch: fetchFn, onLoggedOut: () => {} });

    expect(await api.getMenu({})).toEqual({ ok: true, data: page });
    await api.getMenu({ q: 'karahi & tikka', category_id: 'C1', status: 'archived', cursor: 'abc', limit: 20 });
    expect(calls[0]?.url).toBe('/v1/admin/menu');
    expect(calls[1]?.url).toBe('/v1/admin/menu?q=karahi+%26+tikka&category_id=C1&status=archived&cursor=abc&limit=20');
    expect(calls[1]?.headers['Idempotency-Key']).toBeUndefined();
  });
});
