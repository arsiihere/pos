import type { DefaultKey } from '@pos/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { owner, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const T = 1_761_000_000_000;

interface Grant {
  permission: string;
  grant_type: string;
  approver_role_ids: string[];
  scope: string;
}
interface Role {
  role_id: string;
  grants: Grant[];
  version: string;
}
interface Staff {
  staff_id: string;
  role_ids: string[];
  version: string;
}

describe('admin guards on role writes; returning with no role (01b B7, §3.2, B14)', () => {
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

  const auth = () => ({ authorization: `Bearer ${f.token}` });
  const roleId = async (key: DefaultKey) =>
    (
      await cloud.pool.query<{ role_id: string }>(`SELECT role_id FROM roles WHERE tenant_id = $1 AND default_key = $2`, [
        f.tenantId,
        key,
      ])
    ).rows[0]!.role_id;
  const roleOf = async (id: string) =>
    ((await cloud.app.inject({ method: 'GET', url: '/v1/admin/roles', headers: auth() })).json().data.roles as Role[]).find(
      (row) => row.role_id === id,
    )!;
  const staffOf = async (id: string, status: 'active' | 'left' = 'active') =>
    (
      (await cloud.app.inject({ method: 'GET', url: `/v1/admin/staff?status=${status}`, headers: auth() })).json().data
        .staff as Staff[]
    ).find((row) => row.staff_id === id)!;
  const createRole = async (name: string, grants: object[]): Promise<Role> => {
    const response = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/roles',
      ...owner(f),
      payload: { name, idle_minutes: 15, grants },
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data.role as Role;
  };
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
      headers: auth(),
      payload: { pin: '4321' },
    });
    expect(pin.statusCode, pin.body).toBe(200);
    return pin.json().data.staff as Staff;
  };
  const patchRole = (id: string, payload: object) =>
    cloud.app.inject({ method: 'PATCH', url: `/v1/admin/roles/${id}`, headers: auth(), payload });
  const patchStaff = (id: string, payload: object) =>
    cloud.app.inject({ method: 'PATCH', url: `/v1/admin/staff/${id}`, headers: auth(), payload });
  const withoutGrant = async (id: string, permission: string) => {
    const role = await roleOf(id);
    return { expected_version: role.version, grants: role.grants.filter((grant) => grant.permission !== permission) };
  };
  const directoryVersion = async () =>
    Number((await cloud.pool.query(`SELECT directory_version FROM tenants WHERE tenant_id = $1`, [f.tenantId])).rows[0].directory_version);
  const auditCount = async () =>
    Number((await cloud.pool.query(`SELECT count(*) AS n FROM config_audit WHERE tenant_id = $1`, [f.tenantId])).rows[0].n);
  const expectRefused = async (send: () => Promise<{ statusCode: number; body: string; json(): any }>, status: number, error: object) => {
    const [v, n] = [await directoryVersion(), await auditCount()];
    const response = await send();
    expect(response.statusCode, response.body).toBe(status);
    expect(response.json().error).toMatchObject(error);
    expect(await directoryVersion()).toBe(v);
    expect(await auditCount()).toBe(n);
  };
  // Keep the owner's linked row at the given branches only.
  const ownerOnlyAt = (branchIds: string[]) =>
    cloud.pool.query(`DELETE FROM staff_branches WHERE tenant_id = $1 AND staff_id = $2 AND NOT (branch_id = ANY($3))`, [
      f.tenantId,
      ownerStaffId,
      branchIds,
    ]);
  const stockCounter = () =>
    createRole('Stock counter', [
      { permission: 'access-hub-admin', grant_type: 'allowed', approver_role_ids: [] },
      { permission: 'manage-stock', grant_type: 'allowed', approver_role_ids: [] },
    ]);

  it('[01b #63] own admin role: removing Owner from the linked row → 409 OWN_ADMIN_ACCESS; the same on another person → 200; a role PATCH removing access-hub-admin from the owner\'s only admin role → 409; leaving the linked row → 409 STAFF_LINKED_TO_OWNER (AD-20)', async () => {
    const ownerRole = await roleOf(await roleId('owner'));
    await person('Imran', [await roleId('manager')], [...f.branches]);
    const deputy = await person('Hamza', [ownerRole.role_id], [...f.branches]);

    // Another qualifying admin (Imran) exists at every branch: still refused for the owner's own row.
    const cashier = await roleId('cashier');
    const self = await staffOf(ownerStaffId);
    await expectRefused(() => patchStaff(ownerStaffId, { expected_version: self.version, role_ids: [cashier] }), 409, {
      code: 'OWN_ADMIN_ACCESS',
      details: { branch_ids: [...f.branches].sort() },
    });
    const other = await patchStaff(deputy.staff_id, { expected_version: deputy.version, role_ids: [cashier] });
    expect(other.statusCode, other.body).toBe(200);

    // Owner is the only role giving access-hub-admin to the owner's row.
    const body = await withoutGrant(ownerRole.role_id, 'access-hub-admin');
    await expectRefused(() => patchRole(ownerRole.role_id, body), 409, {
      code: 'OWN_ADMIN_ACCESS',
      details: { branch_ids: [...f.branches].sort() },
    });
    expect((await roleOf(ownerRole.role_id)).version).toBe(ownerRole.version);

    // Review 2 N3 / J-6 (test #101) supersede #63's "marking themselves as left → OWN_ADMIN_ACCESS" (AD-20).
    await expectRefused(() => patchStaff(ownerStaffId, { expected_version: self.version, is_active: false }), 409, {
      code: 'STAFF_LINKED_TO_OWNER',
      details: { staff_id: ownerStaffId },
    });
  });

  it('[01b #76] qualifying admin needs manage-devices too: own guard at A, owner_not_linked, last admin at C despite a stock counter, then 200 with a second manager', async () => {
    const [A, , C] = f.branches;
    const counterRole = await stockCounter();
    const ownerRoleId = await roleId('owner');

    // (a) Branch A: the owner's linked row and a stock counter.
    await ownerOnlyAt([A]);
    await person('Counter', [counterRole.role_id], [A, C]);
    const body = await withoutGrant(ownerRoleId, 'manage-devices');
    await expectRefused(() => patchRole(ownerRoleId, body), 409, { code: 'OWN_ADMIN_ACCESS', details: { branch_ids: [A] } });

    // (b) The same with owner_users.staff_id null.
    await cloud.pool.query(`UPDATE owner_users SET staff_id = NULL WHERE tenant_id = $1 AND user_id = $2`, [f.tenantId, f.userId]);
    await expectRefused(() => patchRole(ownerRoleId, body), 409, {
      code: 'OWN_ADMIN_ACCESS',
      details: { reason: 'owner_not_linked', branch_ids: [A] },
    });
    await cloud.pool.query(`UPDATE owner_users SET staff_id = $3 WHERE tenant_id = $1 AND user_id = $2`, [
      f.tenantId,
      f.userId,
      ownerStaffId,
    ]);

    // (c) Branch C, where the owner's row does not work: one manager and the stock counter.
    const manager = await person('Imran', [await roleId('manager')], [C]);
    await expectRefused(
      () => patchStaff(manager.staff_id, { expected_version: manager.version, denied_permissions: ['manage-devices'] }),
      409,
      { code: 'LAST_ADMIN_REQUIRED', details: { branch_ids: [C] } },
    );

    // (d) A second manager at C first, then the same denial → 200.
    await person('Bilal', [await roleId('manager')], [C]);
    const denied = await patchStaff(manager.staff_id, { expected_version: manager.version, denied_permissions: ['manage-devices'] });
    expect(denied.statusCode, denied.body).toBe(200);
  });

  it('[01b #82] returning with no role: the only role was archived while away → 422 role_archived on role_ids, nothing written; with role_ids [cashier] → 200', async () => {
    const shiftLead = await createRole('Shift lead', [{ permission: 'reprint-ticket', grant_type: 'allowed', approver_role_ids: [] }]);
    const leaver = await person('Usman', [shiftLead.role_id], [f.branches[0]]);
    const left = await patchStaff(leaver.staff_id, { expected_version: leaver.version, is_active: false });
    expect(left.statusCode, left.body).toBe(200);

    const archived = await patchRole(shiftLead.role_id, { expected_version: (await roleOf(shiftLead.role_id)).version, archived: true });
    expect(archived.statusCode, archived.body).toBe(200);

    const away = await staffOf(leaver.staff_id, 'left');
    await expectRefused(() => patchStaff(leaver.staff_id, { expected_version: away.version, is_active: true }), 422, {
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'role_ids', reason: 'role_archived' },
    });
    expect((await staffOf(leaver.staff_id, 'left')).version).toBe(away.version);

    const back = await patchStaff(leaver.staff_id, { expected_version: away.version, is_active: true, role_ids: [await roleId('cashier')] });
    expect(back.statusCode, back.body).toBe(200);
    expect(back.json().data.staff).toMatchObject({ is_active: true, role_ids: [await roleId('cashier')] });
  });
});
