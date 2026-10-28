import { FloorListResponse, LoginResponse, type AdminFloorList } from '@pos/events';
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
  user: { user_id: 'U1', display_name: 'Owner', tenant_id: 'T1', allowed_branch_ids: ['B1', 'B2'], must_change_password: false },
  lockout_notice: null,
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

  it('[01a §8.1] concurrent calls behind one refused refresh call onLoggedOut once', async () => {
    sessionStorage.setItem('owner_access_token', 'OLD');
    sessionStorage.setItem('owner_refresh_token', 'R0');
    const onLoggedOut = vi.fn();
    let releaseRefresh: () => void = () => {};
    const refreshHeld = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const urls: string[] = [];
    const fetchFn = vi.fn(async (input: string) => {
      urls.push(input);
      if (input === '/v1/auth/refresh') {
        await refreshHeld;
        return apiError(401, 'REFRESH_TOKEN_INVALID');
      }
      return apiError(401, 'JWT_INVALID');
    });
    const api = createCloudAdmin({ fetch: fetchFn, onLoggedOut });

    const pending = [api.listFloors('B1'), api.listStations('B1'), api.listFloors('B2')];
    await vi.waitFor(() => expect(urls.filter((u) => u === '/v1/auth/refresh')).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseRefresh();
    const results = await Promise.all(pending);

    expect(results).toEqual([0, 1, 2].map(() => ({ ok: false, error: { kind: 'logged_out' } })));
    expect(urls.filter((u) => u === '/v1/auth/refresh')).toHaveLength(1);
    expect(onLoggedOut).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('owner_access_token')).toBeNull();
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

  it('[01a §7.7] a cloud reply parses with the shared @pos/events schema the client types come from', async () => {
    sessionStorage.setItem('owner_access_token', 'A1');
    // The shape the cloud's floors list sends (apps/cloud/test/restaurant/admin-schemas.int.test.ts parses the real one).
    const reply = {
      data: {
        floors: [
          {
            ...FLOOR,
            tables: [{ table_id: 'T1', name: 'T1', seats: 4, sort_order: 1, archived_at: null }],
          },
        ],
      },
    };
    expect(FloorListResponse.parse(reply)).toEqual(reply);
    expect(LoginResponse.parse({ data: TOKENS })).toEqual({ data: TOKENS });
    const { fetchFn } = fakeFetch([json(200, reply)]);
    const api = createCloudAdmin({ fetch: fetchFn, onLoggedOut: () => {} });

    const listed = await api.listFloors('B1');
    expect(listed).toEqual({ ok: true, data: reply.data });
    if (listed.ok) {
      const typed: AdminFloorList = listed.data;
      expect(typed.floors[0]?.tables[0]?.seats).toBe(4);
    }
  });

  it('[01a S53] a network failure marks the cloud down; a probe read on the backoff clears it, the save is not re-sent', async () => {
    vi.useFakeTimers();
    try {
      sessionStorage.setItem('owner_access_token', 'A1');
      sessionStorage.setItem('owner_refresh_token', 'R1');
      sessionStorage.setItem('owner_user', JSON.stringify(TOKENS.user));
      const calls: Call[] = [];
      const replies: (Response | 'fail')[] = [json(200, { data: { floors: [] } }), 'fail', 'fail', json(200, { data: { floors: [] } })];
      const fetchFn = vi.fn(async (input: string, init?: RequestInit) => {
        calls.push({ url: input, method: init?.method ?? 'GET', headers: {}, body: undefined });
        const next = replies.shift();
        if (next === undefined || next === 'fail') throw new TypeError('network');
        return next;
      });
      const api = createCloudAdmin({ fetch: fetchFn, onLoggedOut: () => {} });
      const seen: boolean[] = [];
      api.onCloudDown((down) => seen.push(down));

      await api.listFloors('B1');
      expect(api.cloudDown()).toBe(false);
      const result = await api.patchFloor('B1', 'F1', { name: 'Hall' });
      expect(result).toEqual({ ok: false, error: { kind: 'network' } });
      expect(api.cloudDown()).toBe(true);
      expect(seen).toEqual([true]);

      await vi.advanceTimersByTimeAsync(499);
      expect(calls).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
        'GET /v1/admin/branches/B1/floors',
        'PATCH /v1/admin/branches/B1/floors/F1',
        'GET /v1/admin/branches/B1/floors',
      ]);
      expect(api.cloudDown()).toBe(true);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(calls).toHaveLength(4);
      expect(calls[3]?.method).toBe('GET');
      expect(api.cloudDown()).toBe(false);
      expect(seen).toEqual([true, false]);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(calls).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('[01a S53] probe delays grow 0.5, 1, 2, 4, 5, 5 s', async () => {
    const { probeDelayMs } = await import('./cloud-admin');
    expect([0, 1, 2, 3, 4, 5].map(probeDelayMs)).toEqual([500, 1_000, 2_000, 4_000, 5_000, 5_000]);
  });

  it('[01a §10 #169 client part] logout sends the refresh token current after a refresh, then clears storage', async () => {
    sessionStorage.setItem('owner_access_token', 'A-old');
    sessionStorage.setItem('owner_refresh_token', 'R-old');
    sessionStorage.setItem('owner_user', JSON.stringify(TOKENS.user));
    const { calls, fetchFn } = fakeFetch([
      apiError(401, 'JWT_INVALID'),
      json(200, { data: { ...TOKENS, access_token: 'A-new', refresh_token: 'R-new' } }),
      json(200, { data: { revoked: true } }),
    ]);
    const api = createCloudAdmin({ fetch: fetchFn, onLoggedOut: () => {} });

    await api.logout();
    expect(calls.map((c) => c.url)).toEqual(['/v1/auth/logout', '/v1/auth/refresh', '/v1/auth/logout']);
    expect(calls[0]?.body).toEqual({ refresh_token: 'R-old' });
    expect(calls[2]?.body).toEqual({ refresh_token: 'R-new' });
    expect(calls[2]?.headers['Authorization']).toBe('Bearer A-new');
    expect(api.currentUser()).toBeNull();
    expect(sessionStorage.getItem('owner_refresh_token')).toBeNull();
  });

  it('[01a S50 a] a failed logout call still clears storage', async () => {
    sessionStorage.setItem('owner_access_token', 'A1');
    sessionStorage.setItem('owner_refresh_token', 'R1');
    sessionStorage.setItem('owner_user', JSON.stringify(TOKENS.user));
    const fetchFn = vi.fn(async () => {
      throw new TypeError('network');
    });
    const onLoggedOut = vi.fn();
    const api = createCloudAdmin({ fetch: fetchFn, onLoggedOut });
    await api.logout();
    expect(api.currentUser()).toBeNull();
    expect(onLoggedOut).not.toHaveBeenCalled();
    expect(api.cloudDown()).toBe(false);
  });

  it('[01b §8] each 01b call sends the §6 method, path and body, and returns data', async () => {
    sessionStorage.setItem('owner_access_token', 'A1');
    sessionStorage.setItem('owner_refresh_token', 'R1');
    const staffBody = { display_name: 'Ali', role_ids: ['RL1'], branch_ids: ['B1'] };
    const roleBody = { name: 'Runner', idle_minutes: 5, grants: [] };
    const cases: Array<{
      run: (api: ReturnType<typeof createCloudAdmin>) => Promise<unknown>;
      method: string;
      url: string;
      body?: unknown;
      key?: string;
    }> = [
      { run: (api) => api.listStaff({}), method: 'GET', url: '/v1/admin/staff' },
      { run: (api) => api.listStaff({ status: 'left', branch_id: 'B1' }), method: 'GET', url: '/v1/admin/staff?status=left&branch_id=B1' },
      { run: (api) => api.createStaff(staffBody, 'K1'), method: 'POST', url: '/v1/admin/staff', body: staffBody, key: 'K1' },
      {
        run: (api) => api.patchStaff('S1', { expected_version: 'v1', is_active: false }),
        method: 'PATCH',
        url: '/v1/admin/staff/S1',
        body: { expected_version: 'v1', is_active: false },
      },
      { run: (api) => api.setPin('S1', '0123'), method: 'PUT', url: '/v1/admin/staff/S1/pin', body: { pin: '0123' } },
      { run: (api) => api.listRoles(), method: 'GET', url: '/v1/admin/roles' },
      { run: (api) => api.listRoles({ archived: true }), method: 'GET', url: '/v1/admin/roles?archived=true' },
      { run: (api) => api.createRole(roleBody, 'K2'), method: 'POST', url: '/v1/admin/roles', body: roleBody, key: 'K2' },
      {
        run: (api) => api.patchRole('RL1', { expected_version: 'v2', name: 'Runner 2' }),
        method: 'PATCH',
        url: '/v1/admin/roles/RL1',
        body: { expected_version: 'v2', name: 'Runner 2' },
      },
      { run: (api) => api.getResponsibilities('B1'), method: 'GET', url: '/v1/admin/branches/B1/responsibilities' },
      {
        run: (api) => api.putResponsibilities('B1', { expected_version: 'v3', responsibilities: [] }),
        method: 'PUT',
        url: '/v1/admin/branches/B1/responsibilities',
        body: { expected_version: 'v3', responsibilities: [] },
      },
      { run: (api) => api.renameBranch('B1', { name: 'Gulberg' }), method: 'PATCH', url: '/v1/admin/branches/B1', body: { name: 'Gulberg' } },
      { run: (api) => api.getBranchSettings('B1'), method: 'GET', url: '/v1/admin/branches/B1/settings' },
      {
        run: (api) => api.patchBranchSettings('B1', { tax_enabled: true }),
        method: 'PATCH',
        url: '/v1/admin/branches/B1/settings',
        body: { tax_enabled: true },
      },
      { run: (api) => api.getTeamTree('B1'), method: 'GET', url: '/v1/admin/branches/B1/team-tree' },
    ];
    for (const c of cases) {
      const data = { marker: c.url };
      const { calls, fetchFn } = fakeFetch([json(200, { data })]);
      const api = createCloudAdmin({ fetch: fetchFn, onLoggedOut: () => {} });
      expect(await c.run(api), c.url).toEqual({ ok: true, data });
      expect(calls[0], c.url).toMatchObject({ method: c.method, url: c.url, body: c.body });
      expect(calls[0]?.headers['Idempotency-Key'], c.url).toBe(c.key);
    }
  });

  it('[01b §8] changePassword sends both passwords and keeps the new token pair; the user no longer must change', async () => {
    sessionStorage.setItem('owner_access_token', 'A1');
    sessionStorage.setItem('owner_refresh_token', 'R1');
    sessionStorage.setItem('owner_user', JSON.stringify({ ...TOKENS.user, must_change_password: true }));
    const pair = { access_token: 'A2', access_expires_at: 3, refresh_token: 'R2', refresh_expires_at: 4 };
    const { calls, fetchFn } = fakeFetch([json(200, { data: pair })]);
    const api = createCloudAdmin({ fetch: fetchFn, onLoggedOut: () => {} });
    const body = { current_password: 'old-password', new_password: 'a-new-password-1' };
    expect(await api.changePassword(body)).toEqual({ ok: true, data: pair });
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/v1/auth/change-password', body });
    expect(sessionStorage.getItem('owner_access_token')).toBe('A2');
    expect(sessionStorage.getItem('owner_refresh_token')).toBe('R2');
    expect(api.currentUser()?.must_change_password).toBe(false);
  });
});
