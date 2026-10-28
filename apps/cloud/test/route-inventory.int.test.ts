import { DomainError } from '@pos/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { listTenantScopes } from '../src/plugins/tenant-scope';
import { restaurantFixture } from './helpers/restaurant';
import { ROUTE_CASES } from './helpers/route-cases';
import { createTestCloud, type TestCloud } from './helpers/test-cloud';

// 01b §6.13: the JWT guard reads the owner row, so a valid token names a real owner.
async function ownerToken(cloud: TestCloud): Promise<{ token: string; tenantId: string }> {
  const f = await restaurantFixture(cloud);
  return { token: f.token, tenantId: f.tenantId };
}

const ALLOWLIST = ['POST /v1/auth/login', 'POST /v1/auth/refresh', 'GET /v1/health', 'GET /owner/', 'GET /owner/*'];

async function readyMessage(app: { ready(): Promise<unknown> }): Promise<string> {
  try {
    await app.ready();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return '';
}

describe('tenant scope', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #76] every cloud route has a tenant scope, tenant-level routes included; none only for the allowlist', async () => {
    const open = await createTestCloud();
    cleanups.push(() => open.close());
    open.app.get('/v1/open', async () => ({ data: {} }));
    expect(await readyMessage(open.app)).toMatch(/tenantScope/);

    const illegal = await createTestCloud();
    cleanups.push(() => illegal.close());
    illegal.app.get('/v1/secret', { config: { tenantScope: 'none' } }, async () => ({ data: {} }));
    expect(await readyMessage(illegal.app)).toMatch(/allowlist/);

    const cloud = await createTestCloud();
    cleanups.push(() => cloud.close());
    const seen: Array<{ method: string; url: string; tenantScope?: string; tenantLevel?: boolean }> = [];
    cloud.app.addHook('onRoute', (opts) => {
      const methods = Array.isArray(opts.method) ? opts.method : [opts.method];
      for (const method of methods) {
        seen.push({
          method: String(method),
          url: opts.url,
          tenantScope: opts.config?.tenantScope,
          tenantLevel: opts.config?.tenantLevel === true,
        });
      }
    });
    cloud.app.get(
      '/v1/owner/staff',
      { config: { tenantScope: 'jwt', tenantLevel: true } },
      async () => ({ data: {} }),
    );
    cloud.app.get('/v1/sync/pull', { config: { tenantScope: 'branch-key' } }, async () => ({ data: {} }));
    cloud.app.post('/v1/sample/register', { config: { tenantScope: 'registration-code' } }, async () => ({ data: {} }));
    await cloud.app.ready();

    const declared = seen.filter((route) => route.method !== 'HEAD');
    expect(declared.map((route) => route.tenantScope)).toEqual(['jwt', 'branch-key', 'registration-code']);
    expect(
      listTenantScopes(cloud.app)
        .filter((route) => route.tenantScope === 'none' && route.method !== 'HEAD')
        .map((route) => `${route.method} ${route.url}`),
    ).toEqual(ALLOWLIST);
    expect(declared.some((route) => route.tenantLevel === true && route.tenantScope === 'jwt')).toBe(true);
    expect(listTenantScopes(cloud.app)).toEqual(
      expect.arrayContaining([
        { method: 'POST', url: '/v1/hubs/register', tenantScope: 'registration-code' },
        { method: 'POST', url: '/v1/hubs/confirm', tenantScope: 'branch-key' },
        { method: 'POST', url: '/v1/auth/login', tenantScope: 'none' },
        { method: 'POST', url: '/v1/auth/refresh', tenantScope: 'none' },
        { method: 'POST', url: '/v1/auth/logout', tenantScope: 'jwt' },
        { method: 'POST', url: '/v1/auth/change-password', tenantScope: 'jwt' }, // 01b §6.11
      ]),
    );
    expect(typeof cloud.app.ownerCredentials.byEmail).toBe('function');
    expect(await cloud.app.ownerCredentials.byEmail('missing@example.com')).toBeNull();
  });

  it('[01b §12.2, D54] the 14 new 01b routes are registered behind the JWT guard (cross-tenant cases in route-cases.ts)', async () => {
    const cloud = await createTestCloud();
    cleanups.push(() => cloud.close());
    await cloud.app.ready();
    const routes = [
      'GET /v1/admin/staff',
      'POST /v1/admin/staff',
      'PUT /v1/admin/staff/:staff_id/pin',
      'PATCH /v1/admin/staff/:staff_id',
      'GET /v1/admin/roles',
      'POST /v1/admin/roles',
      'PATCH /v1/admin/roles/:role_id',
      'GET /v1/admin/branches/:branch_id/responsibilities',
      'PUT /v1/admin/branches/:branch_id/responsibilities',
      'PATCH /v1/admin/branches/:branch_id',
      'GET /v1/admin/branches/:branch_id/settings',
      'PATCH /v1/admin/branches/:branch_id/settings',
      'POST /v1/auth/change-password',
      'GET /v1/admin/branches/:branch_id/team-tree',
    ];
    const scopes = new Map(listTenantScopes(cloud.app).map((route) => [`${route.method} ${route.url}`, route.tenantScope]));
    expect(routes).toHaveLength(14);
    expect(routes.map((route) => [route, scopes.get(route)])).toEqual(routes.map((route) => [route, 'jwt']));
    expect(Object.keys(ROUTE_CASES)).toEqual(expect.arrayContaining(routes));
  });

  it('[F §3.4] bad JWT → 401 JWT_INVALID', async () => {
    const cloud = await createTestCloud();
    cleanups.push(() => cloud.close());
    cloud.app.get('/v1/owner/me', { config: { tenantScope: 'jwt', tenantLevel: true } }, async (request) => ({
      data: { tenant_id: request.tenant?.tenantId ?? null },
    }));
    await cloud.app.ready();

    const missing = await cloud.app.inject({ method: 'GET', url: '/v1/owner/me' });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error.code).toBe('JWT_INVALID');

    const garbage = await cloud.app.inject({
      method: 'GET',
      url: '/v1/owner/me',
      headers: { authorization: 'Bearer not-a-jwt' },
    });
    expect(garbage.statusCode).toBe(401);
    expect(garbage.json().error.code).toBe('JWT_INVALID');

    const { token, tenantId } = await ownerToken(cloud);
    const ok = await cloud.app.inject({
      method: 'GET',
      url: '/v1/owner/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ data: { tenant_id: tenantId } });
  });

  it('[00 §7.1] a 429 carries Retry-After rounded up from retry_after_ms', async () => {
    const cloud = await createTestCloud();
    cleanups.push(() => cloud.close());
    cloud.app.get('/v1/limited', { config: { tenantScope: 'jwt' } }, () => {
      throw new DomainError('IP_LOCKED_OUT', { retry_after_ms: 1000 });
    });
    cloud.app.get('/v1/bad', { config: { tenantScope: 'jwt' } }, () => {
      throw new DomainError('VALIDATION_FAILED', { retry_after_ms: 1000 });
    });
    await cloud.app.ready();
    const { token } = await ownerToken(cloud);
    const limited = await cloud.app.inject({
      method: 'GET',
      url: '/v1/limited',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('1');
    const bad = await cloud.app.inject({
      method: 'GET',
      url: '/v1/bad',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.headers['retry-after']).toBeUndefined();
  });
});
