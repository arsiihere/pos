import type { DefaultKey } from '@pos/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { owner, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const T = 1_761_000_000_000;

// ⚠️ Changed by 05 (row B-1), 01b v1.10 §3.3, §6.6, test 114: the seven new allowed-only permissions refuse
// `requires_approval` (grants.N.grant_type, checked first); a role granting close-shift-for-others without
// manage-own-shift → grants.N.permission; take-payment accepts branch, my_floors, own_tables.
const SEVEN = [
  'take-payment',
  'manage-own-shift',
  'close-shift-for-others',
  'skip-blind-count',
  'close-business-day',
  'open-cash-drawer',
  'manage-fiscal-settings',
] as const;

describe('[01b #114, 05 row B-1] billing allowed-only permissions and the close-shift-for-others pairing', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;

  beforeAll(async () => {
    cloud = await createTestCloud();
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    cloud.clock.set(T);
    f = await restaurantFixture(cloud);
  });

  const roleId = async (key: DefaultKey) =>
    (await cloud.pool.query<{ role_id: string }>(`SELECT role_id FROM roles WHERE tenant_id = $1 AND default_key = $2`, [f.tenantId, key]))
      .rows[0]!.role_id;
  const create = (payload: object) => cloud.app.inject({ method: 'POST', url: '/v1/admin/roles', ...owner(f), payload });
  const patch = (id: string, payload: object) =>
    cloud.app.inject({ method: 'PATCH', url: `/v1/admin/roles/${id}`, headers: { authorization: `Bearer ${f.token}` }, payload });
  const state = async () =>
    (
      await cloud.pool.query(
        `SELECT (SELECT count(*) FROM roles WHERE tenant_id = $1)::int AS roles,
                (SELECT count(*) FROM role_permissions WHERE tenant_id = $1)::int AS grants,
                (SELECT count(*) FROM role_permission_approvers WHERE tenant_id = $1)::int AS approvers,
                (SELECT directory_version FROM tenants WHERE tenant_id = $1)::text AS directory_version`,
        [f.tenantId],
      )
    ).rows[0];
  const expect422 = (response: { statusCode: number; body: string; json: () => { error: unknown } }, field: string) => {
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field } });
  };
  const allowed = (permission: string, scope?: string) => ({ permission, grant_type: 'allowed', approver_role_ids: [], ...(scope ? { scope } : {}) });
  // close-shift-for-others needs manage-own-shift beside it (the pairing rule); added so only grant_type is tested
  const pairFor = (permission: string) => (permission === 'close-shift-for-others' ? [allowed('manage-own-shift')] : []);

  it('[01b #114] POST /roles: each of the seven requires_approval → 422 grants.N.grant_type (with approvers and with none), nothing written; allowed → 200', async () => {
    const manager = await roleId('manager');
    const before = await state();
    for (const permission of SEVEN) {
      for (const approver_role_ids of [[manager], []]) {
        const response = await create({
          name: 'Runner',
          idle_minutes: 15,
          grants: [allowed('reprint-ticket'), { permission, grant_type: 'requires_approval', approver_role_ids }, ...pairFor(permission)],
        });
        expect422(response, 'grants.1.grant_type');
      }
    }
    expect(await state()).toEqual(before);
    const ok = await create({ name: 'Till', idle_minutes: 15, grants: SEVEN.map((permission) => allowed(permission)) });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('[01b #114] PATCH /roles/:id: each of the seven requires_approval → 422 grants.N.grant_type, nothing written; allowed → 200', async () => {
    const manager = await roleId('manager');
    const created = await create({ name: 'Runner', idle_minutes: 15, grants: [] });
    expect(created.statusCode, created.body).toBe(200);
    const role = created.json().data.role as { role_id: string; version: string };
    const before = await state();
    for (const permission of SEVEN) {
      const response = await patch(role.role_id, {
        expected_version: role.version,
        grants: [{ permission, grant_type: 'requires_approval', approver_role_ids: [manager] }, ...pairFor(permission)],
      });
      expect422(response, 'grants.0.grant_type');
    }
    expect(await state()).toEqual(before);
    const ok = await patch(role.role_id, { expected_version: role.version, grants: [allowed('open-cash-drawer')] });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('[01b #114] a role granting close-shift-for-others without manage-own-shift → 422 grants.N.permission on POST and PATCH; with it → 200', async () => {
    const before = await state();
    expect422(await create({ name: 'Closer', idle_minutes: 15, grants: [allowed('reprint-ticket'), allowed('close-shift-for-others')] }), 'grants.1.permission');
    expect(await state()).toEqual(before);
    const created = await create({ name: 'Closer', idle_minutes: 15, grants: [allowed('close-shift-for-others'), allowed('manage-own-shift')] });
    expect(created.statusCode, created.body).toBe(200);
    const role = created.json().data.role as { role_id: string; version: string };
    const mid = await state();
    expect422(await patch(role.role_id, { expected_version: role.version, grants: [allowed('close-shift-for-others')] }), 'grants.0.permission');
    expect(await state()).toEqual(mid);
    // manage-own-shift alone is fine (the rule only runs one way)
    const own = await patch(role.role_id, { expected_version: role.version, grants: [allowed('manage-own-shift')] });
    expect(own.statusCode, own.body).toBe(200);
  });

  it('[01b #114] take-payment accepts branch, my_floors, own_tables; another scope → scope_not_allowed', async () => {
    for (const scope of ['branch', 'my_floors', 'own_tables']) {
      const response = await create({ name: `Pay ${scope}`, idle_minutes: 15, grants: [allowed('take-payment', scope)] });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().data.role.grants).toEqual([{ permission: 'take-payment', grant_type: 'allowed', approver_role_ids: [], scope }]);
    }
    const bad = await create({ name: 'Pay team', idle_minutes: 15, grants: [allowed('take-payment', 'my_team')] });
    expect(bad.statusCode, bad.body).toBe(422);
    expect(bad.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'grants.0.scope', reason: 'scope_not_allowed' } });
    const other = await create({ name: 'Drawer floors', idle_minutes: 15, grants: [allowed('open-cash-drawer', 'my_floors')] });
    expect(other.statusCode, other.body).toBe(422);
  });

  it('[01b #114] the approvable bills permissions accept requires_approval with an approver', async () => {
    const manager = await roleId('manager');
    const grants = ['apply-discount', 'remove-service-charge', 'reopen-bill', 'remove-comp', 'close-without-buyer-id', 'record-petty-cash'].map(
      (permission) => ({ permission, grant_type: 'requires_approval', approver_role_ids: [manager] }),
    );
    const response = await create({ name: 'Approvals', idle_minutes: 15, grants });
    expect(response.statusCode, response.body).toBe(200);
  });
});
