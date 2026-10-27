import type { DefaultKey } from '@pos/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { qualifyingAdmins } from '../../src/modules/staff-roles/guards';
import { TenantLevelRepository } from '../../src/db/tenant-level-repository';
import { owner, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';
import { pgCounter } from '../helpers/pg-counter';

const T = 1_761_000_000_000;

interface Staff {
  staff_id: string;
  version: string;
}

describe('admin guards on staff writes (01b B7, §3.4)', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let ownerStaffId: string;

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
    ownerStaffId = (
      await cloud.pool.query<{ staff_id: string }>(`SELECT staff_id FROM owner_users WHERE tenant_id = $1 AND user_id = $2`, [
        f.tenantId,
        f.userId,
      ])
    ).rows[0]!.staff_id;
  });

  const roleId = async (key: DefaultKey) =>
    (
      await cloud.pool.query<{ role_id: string }>(`SELECT role_id FROM roles WHERE tenant_id = $1 AND default_key = $2`, [
        f.tenantId,
        key,
      ])
    ).rows[0]!.role_id;
  const person = async (name: string, roleIds: string[], branchIds: string[]): Promise<Staff> => {
    const created = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/staff',
      ...owner(f),
      payload: { display_name: name, role_ids: roleIds, branch_ids: branchIds },
    });
    expect(created.statusCode, created.body).toBe(200);
    const pin = await cloud.app.inject({
      method: 'PUT',
      url: `/v1/admin/staff/${created.json().data.staff.staff_id}/pin`,
      headers: { authorization: `Bearer ${f.token}` },
      payload: { pin: '4321' },
    });
    expect(pin.statusCode, pin.body).toBe(200);
    return pin.json().data.staff as Staff;
  };
  const patch = (staffId: string, payload: object) =>
    cloud.app.inject({
      method: 'PATCH',
      url: `/v1/admin/staff/${staffId}`,
      headers: { authorization: `Bearer ${f.token}` },
      payload,
    });
  const versionOf = async (staffId: string) =>
    (
      (await cloud.app.inject({ method: 'GET', url: '/v1/admin/staff', headers: { authorization: `Bearer ${f.token}` } })).json().data
        .staff as Staff[]
    ).find((row) => row.staff_id === staffId)!.version;
  const directoryVersion = async () =>
    Number(
      (await cloud.pool.query(`SELECT directory_version FROM tenants WHERE tenant_id = $1`, [f.tenantId])).rows[0].directory_version,
    );
  const auditCount = async () =>
    Number((await cloud.pool.query(`SELECT count(*) AS n FROM config_audit WHERE tenant_id = $1`, [f.tenantId])).rows[0].n);
  const expectRefused = async (staffId: string, payload: object, error: object) => {
    const [v, n] = [await directoryVersion(), await auditCount()];
    const version = await versionOf(staffId);
    const response = await patch(staffId, { expected_version: version, ...payload });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error).toMatchObject(error);
    expect(await directoryVersion()).toBe(v);
    expect(await auditCount()).toBe(n);
    expect(await versionOf(staffId)).toBe(version);
  };
  // Branch C without the owner's row, so the owner's own guard does not hide the last-admin guard there.
  const ownerOffBranchC = () =>
    cloud.pool.query(`DELETE FROM staff_branches WHERE tenant_id = $1 AND staff_id = $2 AND branch_id = $3`, [
      f.tenantId,
      ownerStaffId,
      f.branches[2],
    ]);

  it('[01b #69] owner with no linked row: removing Manager from another qualifying admin → 409 owner_not_linked; a rename or floor change → 200; once linked, the normal guard applies', async () => {
    const manager = await person('Imran', [await roleId('manager')], [f.branches[0]]);
    await cloud.pool.query(`UPDATE owner_users SET staff_id = NULL WHERE tenant_id = $1 AND user_id = $2`, [f.tenantId, f.userId]);
    await expectRefused(manager.staff_id, { role_ids: [await roleId('waiter')] }, {
      code: 'OWN_ADMIN_ACCESS',
      details: { reason: 'owner_not_linked', branch_ids: [f.branches[0]] },
    });

    const renamed = await patch(manager.staff_id, { expected_version: await versionOf(manager.staff_id), display_name: 'Imran R.' });
    expect(renamed.statusCode, renamed.body).toBe(200);
    await cloud.pool.query(
      `INSERT INTO floors (tenant_id, branch_id, floor_id, name, archived_at, created_at, updated_at) VALUES ($1, $2, 'F_A', 'F_A', NULL, $3, $3)`,
      [f.tenantId, f.branches[0], T],
    );
    const floors = await patch(manager.staff_id, {
      expected_version: await versionOf(manager.staff_id),
      floors: [{ branch_id: f.branches[0], floor_ids: ['F_A'] }],
    });
    expect(floors.statusCode, floors.body).toBe(200);

    await cloud.pool.query(`UPDATE owner_users SET staff_id = $3 WHERE tenant_id = $1 AND user_id = $2`, [
      f.tenantId,
      f.userId,
      ownerStaffId,
    ]);
    const demoted = await patch(manager.staff_id, {
      expected_version: await versionOf(manager.staff_id),
      role_ids: [await roleId('waiter')],
    });
    expect(demoted.statusCode, demoted.body).toBe(200);
  });

  it('[01b §3.4] the own-admin guard runs before the last-admin guard', async () => {
    // The owner's row is the only qualifying admin at every branch: both guards would fail; OWN_ADMIN_ACCESS wins.
    await expectRefused(ownerStaffId, { role_ids: [await roleId('waiter')] }, {
      code: 'OWN_ADMIN_ACCESS',
      details: { branch_ids: [...f.branches].sort() },
    });
    await expectRefused(ownerStaffId, { is_active: false }, { code: 'OWN_ADMIN_ACCESS' });
  });

  it('[01b §3.4] a stock counter with access-hub-admin only is not a qualifying admin', async () => {
    await ownerOffBranchC();
    const counterRole = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/roles',
      ...owner(f),
      payload: {
        name: 'Stock counter',
        idle_minutes: 15,
        grants: [
          { permission: 'access-hub-admin', grant_type: 'allowed', approver_role_ids: [] },
          { permission: 'manage-stock', grant_type: 'allowed', approver_role_ids: [] },
        ],
      },
    });
    expect(counterRole.statusCode, counterRole.body).toBe(200);
    const counter = await person('Usman', [counterRole.json().data.role.role_id], [f.branches[2]]);
    const manager = await person('Imran', [await roleId('manager')], [f.branches[2]]);

    const statements = pgCounter(cloud.pool);
    statements.reset();
    const admins = await qualifyingAdmins(new TenantLevelRepository(Object.freeze({ tenantId: f.tenantId, branchIds: Object.freeze([...f.branches]) }), cloud.pool));
    expect(statements.count).toBe(1);
    expect(admins.get(f.branches[2])).toEqual(new Set([manager.staff_id]));
    expect(admins.get(f.branches[0])).toEqual(new Set([ownerStaffId]));
    expect(admins.get(f.branches[0])?.has(counter.staff_id)).toBe(false);

    await expectRefused(manager.staff_id, { denied_permissions: ['manage-devices'] }, {
      code: 'LAST_ADMIN_REQUIRED',
      details: { branch_ids: [f.branches[2]] },
    });
  });

  it('[01b §3.4] removing the last qualifying admin\'s branch, denying manage-devices, or marking them as left → 409 LAST_ADMIN_REQUIRED; with a second admin → 200', async () => {
    await ownerOffBranchC();
    const manager = await person('Imran', [await roleId('manager')], [f.branches[0], f.branches[2]]);
    const error = { code: 'LAST_ADMIN_REQUIRED', details: { branch_ids: [f.branches[2]] } };
    await expectRefused(manager.staff_id, { branch_ids: [f.branches[0]] }, error);
    await expectRefused(manager.staff_id, { denied_permissions: ['manage-devices'] }, error);
    await expectRefused(manager.staff_id, { denied_permissions: ['access-hub-admin'] }, error);
    await expectRefused(manager.staff_id, { is_active: false }, error);
    await expectRefused(manager.staff_id, { role_ids: [await roleId('cashier')] }, error);

    await person('Hamza', [await roleId('manager')], [f.branches[2]]);
    const left = await patch(manager.staff_id, { expected_version: await versionOf(manager.staff_id), is_active: false });
    expect(left.statusCode, left.body).toBe(200);
  });
});
