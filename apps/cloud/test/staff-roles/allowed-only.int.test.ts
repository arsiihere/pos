import type { DefaultKey } from '@pos/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { owner, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const T = 1_761_000_000_000;

// 04 §4.5 B-2 (01b v1.9 §6.6, G-19): move-item-to-stock is allowed-only; requires_approval → 422
// { field: 'grants.N.grant_type' }, checked before the approver rule so the field never changes.
describe('[04 #32, 01b #110] allowed-only move-item-to-stock (B-2, G-19)', () => {
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
  const expectGrantType422 = (response: { statusCode: number; body: string; json: () => { error: unknown } }, index: number) => {
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: `grants.${index}.grant_type` } });
  };

  it('[04 #32, 01b #110] POST /roles: move-item-to-stock requires_approval → 422 grants.N.grant_type, with approvers and with none; nothing written', async () => {
    const manager = await roleId('manager');
    const before = await state();
    for (const approver_role_ids of [[manager], []]) {
      const response = await create({
        name: 'Runner',
        idle_minutes: 15,
        grants: [
          { permission: 'reprint-ticket', grant_type: 'allowed', approver_role_ids: [] },
          { permission: 'move-item-to-stock', grant_type: 'requires_approval', approver_role_ids },
        ],
      });
      expectGrantType422(response, 1);
    }
    expect(await state()).toEqual(before);
  });

  it('[04 #32, 01b #110] PATCH /roles/:id: move-item-to-stock requires_approval → 422 grants.N.grant_type, nothing written; allowed → 200', async () => {
    const manager = await roleId('manager');
    const created = await create({ name: 'Runner', idle_minutes: 15, grants: [] });
    expect(created.statusCode, created.body).toBe(200);
    const role = created.json().data.role as { role_id: string; version: string };
    const before = await state();
    for (const approver_role_ids of [[manager], []]) {
      const response = await patch(role.role_id, {
        expected_version: role.version,
        grants: [{ permission: 'move-item-to-stock', grant_type: 'requires_approval', approver_role_ids }],
      });
      expectGrantType422(response, 0);
    }
    expect(await state()).toEqual(before);

    const allowed = await patch(role.role_id, {
      expected_version: role.version,
      grants: [{ permission: 'move-item-to-stock', grant_type: 'allowed', approver_role_ids: [] }],
    });
    expect(allowed.statusCode, allowed.body).toBe(200);
    expect(allowed.json().data.role.grants).toEqual([
      { permission: 'move-item-to-stock', grant_type: 'allowed', approver_role_ids: [], scope: 'branch' },
    ]);
  });

  it('[01b #110] a requires_approval grant of another permission still follows the approver rule', async () => {
    const response = await create({
      name: 'Runner',
      idle_minutes: 15,
      grants: [{ permission: 'void-item', grant_type: 'requires_approval', approver_role_ids: [] }],
    });
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'grants.0.approver_role_ids' } });
  });
});
