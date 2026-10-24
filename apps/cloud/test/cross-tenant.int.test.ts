import { afterEach, describe, expect, it } from 'vitest';
import { issueRegistrationCode } from '../src/cli/issue-registration-code';
import { seedTenant } from '../src/cli/seed-tenant';
import { SystemContext } from '../src/cli/system-context';
import { testIdGen } from '../src/lib/ids';
import { testSecrets } from '../src/lib/secrets';
import { listTenantScopes } from '../src/plugins/tenant-scope';
import { createTestCloud, truncateAll } from './helpers/test-cloud';

const PASSWORD = 'password-1';

describe('cross-tenant', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("[00 §10 #77] every scoped route with tenant A's credentials returns no tenant B id", async () => {
    const cloud = await createTestCloud();
    cleanups.push(() => cloud.close());
    await truncateAll(cloud.pool);
    const ids = testIdGen();
    const secrets = testSecrets();
    const sys = new SystemContext(cloud.pool);
    const deps = { clock: cloud.clock, ids, secrets };

    const seededA = await seedTenant(
      sys,
      { name: 'Tenant A', currency: 'PKR', ownerEmail: 'a@example.com', ownerName: 'Ada', password: PASSWORD, pin: '1234' },
      deps,
    );
    const issuedA = await issueRegistrationCode(sys, { tenantId: seededA.tenant_id, branchName: 'Branch A' }, deps);
    const seededB = await seedTenant(
      sys,
      { name: 'Tenant B', currency: 'PKR', ownerEmail: 'b@example.com', ownerName: 'Bea', password: PASSWORD, pin: '1234' },
      deps,
    );
    const issuedB = await issueRegistrationCode(sys, { tenantId: seededB.tenant_id, branchName: 'Branch B' }, deps);

    const roles = await cloud.pool.query<{ role_id: string }>(`SELECT role_id FROM roles WHERE tenant_id = $1`, [
      seededB.tenant_id,
    ]);
    const bIds = [
      seededB.tenant_id,
      seededB.user_id,
      seededB.staff_id,
      issuedB.branch_id,
      ...roles.rows.map((row) => row.role_id),
    ];

    const loginA = await cloud.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'a@example.com', password: PASSWORD },
    });
    const loginB = await cloud.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'b@example.com', password: PASSWORD },
    });
    expect(loginA.statusCode).toBe(200);
    expect(loginB.statusCode).toBe(200);
    const tokenA = loginA.json().data.access_token as string;
    const refreshB = loginB.json().data.refresh_token as string;

    const registeredA = await cloud.app.inject({
      method: 'POST',
      url: '/v1/hubs/register',
      headers: { 'idempotency-key': ids.next() },
      payload: { registration_code: issuedA.code, hub_version: '1.0.0', accepted_kinds: ['new_branch'] },
    });
    expect(registeredA.statusCode).toBe(200);
    const keyA = registeredA.json().data.branch_api_key as string;

    const routes = listTenantScopes(cloud.app).filter(
      (route) => (route.tenantScope === 'jwt' || route.tenantScope === 'branch-key') && route.method !== 'HEAD',
    );
    expect(routes.map((route) => `${route.method} ${route.url}`).sort()).toEqual([
      'POST /v1/auth/logout',
      'POST /v1/hubs/confirm',
    ]);

    for (const route of routes) {
      const credential = route.tenantScope === 'jwt' ? tokenA : keyA;
      const payload = route.url === '/v1/auth/logout' ? { refresh_token: refreshB } : { hub_version: '1.0.0' };
      const response = await cloud.app.inject({
        method: route.method as 'POST',
        url: route.url,
        headers: { authorization: `Bearer ${credential}` },
        payload,
      });
      expect(response.statusCode).toBeLessThan(500);
      const returned = stringsIn(response.json());
      for (const id of bIds) expect(returned).not.toContain(id);
      if (route.url === '/v1/hubs/confirm') {
        expect(response.statusCode).toBe(200);
        expect(response.json().data.branch_id).toBe(issuedA.branch_id);
      }
    }
  });
});

function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => stringsIn(item));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => (key === 'request_id' ? [] : stringsIn(child)));
  }
  return [];
}
