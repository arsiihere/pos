import { issueRegistrationCode } from '../../src/cli/issue-registration-code';
import { seedTenant } from '../../src/cli/seed-tenant';
import { SystemContext } from '../../src/cli/system-context';
import { testIdGen } from '../../src/lib/ids';
import { testSecrets } from '../../src/lib/secrets';
import { truncateAll, type TestCloud } from './test-cloud';

export const OWNER_PASSWORD = 'password-1';

export interface RestaurantFixture {
  tenantId: string;
  userId: string;
  branches: [string, string, string];
  token: string;
  tokenFor(branchIds: string[]): string;
  branchKey: string;
  other: { tenantId: string; userId: string; branchId: string; token: string };
}

const idempotencyKeys = testIdGen();

// Tenant A: one owner, branches A, B, C, branch A registered (branchKey). Tenant B: one owner, one branch.
export async function restaurantFixture(cloud: TestCloud): Promise<RestaurantFixture> {
  await truncateAll(cloud.pool);
  const sys = new SystemContext(cloud.pool);
  const deps = { clock: cloud.clock, ids: testIdGen(), secrets: testSecrets() };
  const a = await seedTenant(
    sys,
    { name: 'Tenant A', currency: 'PKR', ownerEmail: 'a@example.com', ownerName: 'Ada', password: OWNER_PASSWORD, pin: '1234' },
    deps,
  );
  const issued = [];
  for (const branchName of ['Branch A', 'Branch B', 'Branch C']) {
    issued.push(await issueRegistrationCode(sys, { tenantId: a.tenant_id, branchName }, deps));
  }
  const b = await seedTenant(
    sys,
    { name: 'Tenant B', currency: 'PKR', ownerEmail: 'b@example.com', ownerName: 'Bea', password: OWNER_PASSWORD, pin: '1234' },
    deps,
  );
  const issuedB = await issueRegistrationCode(sys, { tenantId: b.tenant_id, branchName: 'Branch X' }, deps);

  const registered = await cloud.app.inject({
    method: 'POST',
    url: '/v1/hubs/register',
    headers: { 'idempotency-key': idempotencyKeys.next() },
    payload: { registration_code: issued[0]!.code, hub_version: '1.0.0', accepted_kinds: ['new_branch'] },
  });
  if (registered.statusCode !== 200) throw new Error(`hub register failed: ${registered.body}`);

  const branches = issued.map((row) => row.branch_id) as [string, string, string];
  const tokenFor = (branchIds: string[]) =>
    cloud.app.jwt.sign({ sub: a.user_id, tenant_id: a.tenant_id, allowed_branch_ids: branchIds });
  return {
    tenantId: a.tenant_id,
    userId: a.user_id,
    branches,
    token: tokenFor([...branches]),
    tokenFor,
    branchKey: registered.json().data.branch_api_key as string,
    other: {
      tenantId: b.tenant_id,
      userId: b.user_id,
      branchId: issuedB.branch_id,
      token: cloud.app.jwt.sign({ sub: b.user_id, tenant_id: b.tenant_id, allowed_branch_ids: [issuedB.branch_id] }),
    },
  };
}

export function owner(f: RestaurantFixture, token?: string): { headers: Record<string, string> } {
  return {
    headers: { authorization: `Bearer ${token ?? f.token}`, 'idempotency-key': idempotencyKeys.next() },
  };
}
