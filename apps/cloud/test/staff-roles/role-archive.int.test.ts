import type { DefaultKey } from '@pos/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { owner, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const T = 1_761_000_000_000;

interface Role {
  role_id: string;
  name: string;
  archived_at: number | null;
  staff_count: number;
  version: string;
}
interface Staff {
  staff_id: string;
  role_ids: string[];
  version: string;
}

const ADMIN_GRANTS = [
  { permission: 'access-hub-admin', grant_type: 'allowed', approver_role_ids: [] },
  { permission: 'manage-devices', grant_type: 'allowed', approver_role_ids: [] },
];

describe('role archive and restore (01b B14, §6.7)', () => {
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
    (
      await cloud.pool.query<{ role_id: string }>(`SELECT role_id FROM roles WHERE tenant_id = $1 AND default_key = $2`, [
        f.tenantId,
        key,
      ])
    ).rows[0]!.role_id;
  const createRole = async (name: string, grants: object[] = []): Promise<Role> => {
    const response = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/roles',
      ...owner(f),
      payload: { name, idle_minutes: 15, grants },
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data.role as Role;
  };
  const person = async (name: string, roleIds: string[], branchIds: string[], o: { pin?: boolean } = {}): Promise<Staff> => {
    const created = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/staff',
      ...owner(f),
      payload: { display_name: name, role_ids: roleIds, branch_ids: branchIds },
    });
    expect(created.statusCode, created.body).toBe(200);
    if (o.pin !== true) return created.json().data.staff as Staff;
    const pin = await cloud.app.inject({
      method: 'PUT',
      url: `/v1/admin/staff/${created.json().data.staff.staff_id}/pin`,
      headers: { authorization: `Bearer ${f.token}` },
      payload: { pin: '4321' },
    });
    expect(pin.statusCode, pin.body).toBe(200);
    return pin.json().data.staff as Staff;
  };
  const patchRole = (id: string, payload: object) =>
    cloud.app.inject({ method: 'PATCH', url: `/v1/admin/roles/${id}`, headers: { authorization: `Bearer ${f.token}` }, payload });
  const patchStaff = (id: string, payload: object) =>
    cloud.app.inject({ method: 'PATCH', url: `/v1/admin/staff/${id}`, headers: { authorization: `Bearer ${f.token}` }, payload });
  const roleOf = async (id: string, archived = false) =>
    (
      (
        await cloud.app.inject({ method: 'GET', url: `/v1/admin/roles?archived=${archived}`, headers: { authorization: `Bearer ${f.token}` } })
      ).json().data.roles as Role[]
    ).find((row) => row.role_id === id);
  const staffOf = async (id: string, status: 'active' | 'left' = 'active') =>
    (
      (
        await cloud.app.inject({ method: 'GET', url: `/v1/admin/staff?status=${status}`, headers: { authorization: `Bearer ${f.token}` } })
      ).json().data.staff as Staff[]
    ).find((row) => row.staff_id === id);
  const directoryVersion = async () =>
    Number((await cloud.pool.query(`SELECT directory_version FROM tenants WHERE tenant_id = $1`, [f.tenantId])).rows[0].directory_version);
  const auditRows = async () =>
    (
      await cloud.pool.query<{ entity: string; entity_id: string; action: string; actor_kind: string; actor_owner_user_id: string; before: unknown; after: unknown }>(
        `SELECT entity, entity_id, action, actor_kind, actor_owner_user_id, before, after FROM config_audit WHERE tenant_id = $1 ORDER BY at, audit_id`,
        [f.tenantId],
      )
    ).rows;
  // Branch C without the owner's row, so the owner's own guard does not hide the last-admin guard there.
  const ownerOffBranchC = () =>
    cloud.pool.query(
      `DELETE FROM staff_branches s USING owner_users o
        WHERE s.tenant_id = $1 AND s.branch_id = $2 AND o.tenant_id = s.tenant_id AND o.staff_id = s.staff_id`,
      [f.tenantId, f.branches[2]],
    );
  const addStation = (stationId: string, branchId: string) =>
    cloud.pool.query(
      `INSERT INTO stations (tenant_id, branch_id, station_id, name, station_type, capacity, created_at, updated_at)
       VALUES ($1, $2, $3, $3, 'slot', 1, $4, $4)`,
      [f.tenantId, branchId, stationId, T],
    );
  const addRoleCounter = (branchId: string, stationId: string, id: string) =>
    cloud.pool.query(
      `INSERT INTO responsibilities (tenant_id, branch_id, responsibility, station_id, subject_kind, subject_id)
       VALUES ($1, $2, 'count_stock', $3, 'role', $4)`,
      [f.tenantId, branchId, stationId, id],
    );
  const expectNothingWritten = async (run: () => Promise<void>) => {
    const [v, audits] = [await directoryVersion(), (await auditRows()).length];
    await run();
    expect(await directoryVersion()).toBe(v);
    expect((await auditRows()).length).toBe(audits);
  };

  it('[01b #1] create, edit and archive a role; editing or archiving the last role that gives a branch its admin → 409 LAST_ADMIN_REQUIRED, nothing written', async () => {
    const role = await createRole('Shift lead', [{ permission: 'reprint-ticket', grant_type: 'allowed', approver_role_ids: [] }]);
    const edited = await patchRole(role.role_id, { expected_version: role.version, name: 'Senior shift lead', idle_minutes: 30 });
    expect(edited.statusCode, edited.body).toBe(200);
    cloud.clock.set(T + 1_000);
    const archived = await patchRole(role.role_id, { expected_version: edited.json().data.role.version, archived: true });
    expect(archived.statusCode, archived.body).toBe(200);
    expect(archived.json().data.role).toMatchObject({ archived_at: T + 1_000, name: 'Senior shift lead' });
    expect(await roleOf(role.role_id)).toBeUndefined();
    expect(await roleOf(role.role_id, true)).toMatchObject({ archived_at: T + 1_000 });

    await ownerOffBranchC();
    const admin = await createRole('Floor admin', ADMIN_GRANTS);
    const p = await person('Imran', [admin.role_id, await roleId('waiter')], [f.branches[2]], { pin: true });
    const error = { code: 'LAST_ADMIN_REQUIRED', details: { branch_ids: [f.branches[2]] } };
    await expectNothingWritten(async () => {
      const response = await patchRole(admin.role_id, { expected_version: admin.version, grants: [ADMIN_GRANTS[0]] });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error).toMatchObject(error);
    });
    await expectNothingWritten(async () => {
      const response = await patchRole(admin.role_id, { expected_version: admin.version, archived: true });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error).toMatchObject(error);
    });
    expect(await roleOf(admin.role_id)).toMatchObject({ version: admin.version, archived_at: null });
    expect((await staffOf(p.staff_id))!.role_ids).toContain(admin.role_id);
  });

  it('[01b #16] archive: removed from a holder with another role (200); the only role of an active person or an approver elsewhere → 409 CONFIG_IN_USE', async () => {
    const b = f.branches[0];
    const extra = await createRole('Grill cook');
    const holder = await person('Bilal', [extra.role_id, await roleId('waiter')], [b]);
    await addStation('ST_G', b);
    await addRoleCounter(b, 'ST_G', extra.role_id);
    const archived = await patchRole(extra.role_id, { expected_version: extra.version, archived: true });
    expect(archived.statusCode, archived.body).toBe(200);
    const after = await staffOf(holder.staff_id);
    expect(after!.role_ids).toEqual([await roleId('waiter')]);
    const data = archived.json().data;
    expect(data.changed_versions.staff).toEqual([{ staff_id: holder.staff_id, version: after!.version }]);
    expect(data.changed_versions.responsibilities.map((row: { branch_id: string }) => row.branch_id)).toEqual([b]);
    expect(data.changed_versions.roles).toEqual([]);
    const counters = await cloud.pool.query(`SELECT 1 FROM responsibilities WHERE tenant_id = $1 AND subject_id = $2`, [
      f.tenantId,
      extra.role_id,
    ]);
    expect(counters.rows).toEqual([]);

    const sole = await createRole('Runner');
    const only = await person('Usman', [sole.role_id], [b]);
    await expectNothingWritten(async () => {
      const response = await patchRole(sole.role_id, { expected_version: sole.version, archived: true });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error).toMatchObject({
        code: 'CONFIG_IN_USE',
        details: { entity: 'role', id: sole.role_id, used_by: { entity: 'staff', ids: [only.staff_id] } },
      });
    });

    const approver = await createRole('Supervisor');
    const approved = await createRole('Trainee', [
      { permission: 'apply-discount', grant_type: 'requires_approval', approver_role_ids: [approver.role_id] },
    ]);
    await expectNothingWritten(async () => {
      const response = await patchRole(approver.role_id, { expected_version: approver.version, archived: true });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error).toMatchObject({
        code: 'CONFIG_IN_USE',
        details: { entity: 'role', id: approver.role_id, used_by: { entity: 'role', ids: [approved.role_id] } },
      });
    });
    // A role that approves its own grant can still be archived.
    const self = await createRole('Self approver');
    const selfGrant = await patchRole(self.role_id, {
      expected_version: self.version,
      grants: [{ permission: 'apply-discount', grant_type: 'requires_approval', approver_role_ids: [self.role_id] }],
    });
    expect(selfGrant.statusCode, selfGrant.body).toBe(200);
    const selfArchived = await patchRole(self.role_id, { expected_version: selfGrant.json().data.role.version, archived: true });
    expect(selfArchived.statusCode, selfArchived.body).toBe(200);
  });

  it('[01b §6.7] restore re-checks the stored grants as §6.6: an approver archived meanwhile → 422 CONFIG_REFERENCE_INVALID role_archived, nothing written', async () => {
    const approver = await createRole('Supervisor');
    const role = await createRole('Trainee', [
      { permission: 'apply-discount', grant_type: 'requires_approval', approver_role_ids: [approver.role_id] },
    ]);
    const archived = await patchRole(role.role_id, { expected_version: role.version, archived: true });
    expect(archived.statusCode, archived.body).toBe(200);
    const approverGone = await patchRole(approver.role_id, { expected_version: approver.version, archived: true });
    expect(approverGone.statusCode, approverGone.body).toBe(200);
    await expectNothingWritten(async () => {
      const response = await patchRole(role.role_id, { expected_version: archived.json().data.role.version, archived: false });
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json().error).toMatchObject({
        code: 'CONFIG_REFERENCE_INVALID',
        details: { field: 'grants.0.approver_role_ids.0', reason: 'role_archived' },
      });
    });

    // A role that approves its own grant restores with itself as approver.
    const self = await createRole('Self approver');
    const selfGrant = await patchRole(self.role_id, {
      expected_version: self.version,
      grants: [{ permission: 'apply-discount', grant_type: 'requires_approval', approver_role_ids: [self.role_id] }],
    });
    const selfArchived = await patchRole(self.role_id, { expected_version: selfGrant.json().data.role.version, archived: true });
    expect(selfArchived.statusCode, selfArchived.body).toBe(200);
    const selfRestored = await patchRole(self.role_id, { expected_version: selfArchived.json().data.role.version, archived: false });
    expect(selfRestored.statusCode, selfRestored.body).toBe(200);
  });

  it('[01b §6.7] a person who left may be left with no role; restore clears archived_at and re-checks the name', async () => {
    const b = f.branches[0];
    const role = await createRole('Shift lead');
    const p = await person('Bilal', [role.role_id], [b]);
    const left = await patchStaff(p.staff_id, { expected_version: p.version, is_active: false });
    expect(left.statusCode, left.body).toBe(200);
    const archived = await patchRole(role.role_id, { expected_version: role.version, archived: true });
    expect(archived.statusCode, archived.body).toBe(200);
    expect((await staffOf(p.staff_id, 'left'))!.role_ids).toEqual([]);

    const restored = await patchRole(role.role_id, { expected_version: archived.json().data.role.version, archived: false });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json().data.role).toMatchObject({ archived_at: null, staff_count: 0 });

    const again = await patchRole(role.role_id, { expected_version: restored.json().data.role.version, archived: true });
    expect(again.statusCode, again.body).toBe(200);
    await createRole('shift lead');
    await expectNothingWritten(async () => {
      const response = await patchRole(role.role_id, { expected_version: again.json().data.role.version, archived: false });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'role', name: 'Shift lead' } });
    });
  });

  it('[01b #5] role create, edit, grant change, archive, restore and role assignment each write exactly one audit row with actor, before and after; a rolled-back write writes none', async () => {
    const b = f.branches[0];
    const auditedAll = async (count: number, run: () => Promise<{ statusCode: number; body: string }>) => {
      const before = (await auditRows()).length;
      const response = await run();
      expect(response.statusCode, response.body).toBe(200);
      const rows = (await auditRows()).slice(before);
      expect(rows).toHaveLength(count);
      rows.forEach((row) => expect(row).toMatchObject({ actor_kind: 'owner', actor_owner_user_id: f.userId }));
      return rows;
    };
    const audited = async (run: () => Promise<{ statusCode: number; body: string }>) => (await auditedAll(1, run))[0]!;

    let version = '';
    let id = '';
    const created = await audited(async () => {
      const response = await cloud.app.inject({
        method: 'POST',
        url: '/v1/admin/roles',
        ...owner(f),
        payload: { name: 'Shift lead', idle_minutes: 15, grants: [] },
      });
      ({ role_id: id, version } = response.json().data.role);
      return response;
    });
    expect(created).toMatchObject({ entity: 'role', action: 'create', before: null, after: { name: 'Shift lead', grants: [] } });

    const edited = await audited(async () => {
      const response = await patchRole(id, { expected_version: version, idle_minutes: 30 });
      version = response.json().data.role.version;
      return response;
    });
    expect(edited).toMatchObject({ entity: 'role', entity_id: id, action: 'update', before: { idle_minutes: 15 }, after: { idle_minutes: 30 } });

    const grant = { permission: 'reprint-ticket', grant_type: 'allowed', approver_role_ids: [], scope: 'branch' };
    const granted = await audited(async () => {
      const response = await patchRole(id, { expected_version: version, grants: [grant] });
      version = response.json().data.role.version;
      return response;
    });
    expect(granted).toMatchObject({ action: 'update', before: { grants: [] }, after: { grants: [grant] } });

    const waiterId = await roleId('waiter');
    const p = await person('Bilal', [waiterId], [b]);
    const assigned = await audited(() => patchStaff(p.staff_id, { expected_version: p.version, role_ids: [waiterId, id] }));
    expect(assigned).toMatchObject({ entity: 'staff', entity_id: p.staff_id, action: 'update' });
    expect((assigned.after as Staff).role_ids).toContain(id);

    // §6 "one row per changed entity": the archive takes the role off its holder p, so p gets its own row.
    const [archived, holder] = await auditedAll(2, async () => {
      const response = await patchRole(id, { expected_version: version, archived: true });
      version = response.json().data.role.version;
      return response;
    });
    expect(holder).toMatchObject({ entity: 'staff', entity_id: p.staff_id, action: 'update' });
    expect((holder!.before as Staff).role_ids).toEqual(expect.arrayContaining([waiterId, id]));
    expect((holder!.after as Staff).role_ids).toEqual([waiterId]);
    expect(holder!.after).not.toHaveProperty('pin_hash');
    expect(holder!.after).not.toHaveProperty('version');
    expect(archived).toMatchObject({ entity: 'role', entity_id: id, action: 'archive', before: { archived_at: null }, after: { grants: [grant] } });
    expect((archived!.after as Role).archived_at).not.toBeNull();
    expect(archived!.after).not.toHaveProperty('staff_count');
    expect(archived!.after).not.toHaveProperty('version');

    const restored = await audited(() => patchRole(id, { expected_version: version, archived: false }));
    expect(restored).toMatchObject({ action: 'restore', after: { archived_at: null } });

    // Rolled back: the last-admin guard refuses after the write; no audit row survives.
    await ownerOffBranchC();
    const admin = await createRole('Floor admin', ADMIN_GRANTS);
    await person('Imran', [admin.role_id, await roleId('waiter')], [f.branches[2]], { pin: true });
    await expectNothingWritten(async () => {
      const response = await patchRole(admin.role_id, { expected_version: admin.version, archived: true });
      expect(response.statusCode, response.body).toBe(409);
    });
  });
});
