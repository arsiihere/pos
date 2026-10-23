import { afterEach, describe, expect, it } from 'vitest';
import { createTestCloud } from './helpers/test-cloud';

const ALLOWLIST = ['POST /v1/auth/login', 'POST /v1/auth/refresh', 'GET /v1/health'];

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
    cloud.app.post('/v1/auth/login', { config: { tenantScope: 'none' } }, async () => ({ data: {} }));
    cloud.app.post('/v1/auth/refresh', { config: { tenantScope: 'none' } }, async () => ({ data: {} }));
    cloud.app.get('/v1/health', { config: { tenantScope: 'none' } }, async () => ({ data: {} }));
    cloud.app.get(
      '/v1/owner/staff',
      { config: { tenantScope: 'jwt', tenantLevel: true } },
      async () => ({ data: {} }),
    );
    cloud.app.get('/v1/sync/pull', { config: { tenantScope: 'branch-key' } }, async () => ({ data: {} }));
    cloud.app.post('/v1/sample/register', { config: { tenantScope: 'registration-code' } }, async () => ({ data: {} }));
    await cloud.app.ready();

    const declared = seen.filter((route) => route.method !== 'HEAD');
    expect(declared.map((route) => route.tenantScope)).toEqual([
      'none',
      'none',
      'none',
      'jwt',
      'branch-key',
      'registration-code',
    ]);
    expect(declared.filter((route) => route.tenantScope === 'none').map((route) => `${route.method} ${route.url}`)).toEqual(
      ALLOWLIST,
    );
    expect(declared.some((route) => route.tenantLevel === true && route.tenantScope === 'jwt')).toBe(true);
    expect(typeof cloud.app.ownerCredentials.byEmail).toBe('function');
    expect(await cloud.app.ownerCredentials.byEmail('missing@example.com')).toBeNull();
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

    const token = cloud.app.jwt.sign({
      sub: 'u1',
      tenant_id: 't1',
      allowed_branch_ids: ['b1'],
    });
    const ok = await cloud.app.inject({
      method: 'GET',
      url: '/v1/owner/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ data: { tenant_id: 't1' } });
  });
});
