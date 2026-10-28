import type { DefaultKey } from '@pos/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { owner, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const T = 1_761_000_000_000;

interface Staff {
  staff_id: string;
  display_name: string;
  role_ids: string[];
  branch_ids: string[];
  reports_to: { branch_id: string; lead_staff_id: string }[];
  floors: { branch_id: string; floor_ids: string[] }[];
  version: string;
}

describe('staff PATCH (01b §6.4)', () => {
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
  const create = async (payload: object): Promise<Staff> => {
    const response = await cloud.app.inject({ method: 'POST', url: '/v1/admin/staff', ...owner(f), payload });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data.staff as Staff;
  };
  const waiter = async (name: string, branchIds: string[], extra: object = {}) =>
    create({ display_name: name, role_ids: [await roleId('waiter')], branch_ids: branchIds, ...extra });
  const patch = (staffId: string, payload: object, token = f.token) =>
    cloud.app.inject({
      method: 'PATCH',
      url: `/v1/admin/staff/${staffId}`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
  const list = (query = '') =>
    cloud.app.inject({ method: 'GET', url: `/v1/admin/staff${query}`, headers: { authorization: `Bearer ${f.token}` } });
  const directoryVersion = async () =>
    Number(
      (await cloud.pool.query(`SELECT directory_version FROM tenants WHERE tenant_id = $1`, [f.tenantId])).rows[0].directory_version,
    );
  const auditCount = async (staffId: string) =>
    Number(
      (await cloud.pool.query(`SELECT count(*) AS n FROM config_audit WHERE tenant_id = $1 AND entity_id = $2`, [f.tenantId, staffId]))
        .rows[0].n,
    );
  const addFloor = (floorId: string, branchId: string) =>
    cloud.pool.query(
      `INSERT INTO floors (tenant_id, branch_id, floor_id, name, archived_at, created_at, updated_at) VALUES ($1, $2, $3, $3, NULL, $4, $4)`,
      [f.tenantId, branchId, floorId, T],
    );

  it('[01b #2] create and edit with branch assignment bump directory_version by exactly 1 per write; a no-op PATCH bumps nothing', async () => {
    const v0 = await directoryVersion();
    const person = await waiter('Bilal', [f.branches[0]]);
    expect(await directoryVersion()).toBe(v0 + 1);

    const edited = await patch(person.staff_id, { expected_version: person.version, branch_ids: [f.branches[0], f.branches[1]] });
    expect(edited.statusCode, edited.body).toBe(200);
    const body = edited.json().data;
    expect(body.staff.branch_ids).toEqual([f.branches[0], f.branches[1]].sort());
    expect(body.staff.version).not.toBe(person.version);
    expect(body.moved_reports).toEqual([]);
    expect(body.changed_versions).toEqual({ staff: [], roles: [], responsibilities: [] });
    expect(await directoryVersion()).toBe(v0 + 2);
    expect(await auditCount(person.staff_id)).toBe(2);

    const audit = await cloud.pool.query(
      `SELECT action, before, after FROM config_audit WHERE tenant_id = $1 AND entity_id = $2 AND action = 'update'`,
      [f.tenantId, person.staff_id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].before.branch_ids).toEqual([f.branches[0]]);
    expect(audit.rows[0].after.branch_ids).toEqual([f.branches[0], f.branches[1]].sort());
    expect(audit.rows[0].after).not.toHaveProperty('version');

    // No-op: a version-only body, and a body that repeats the stored values.
    for (const payload of [
      { expected_version: body.staff.version },
      { expected_version: body.staff.version, display_name: 'Bilal', branch_ids: [f.branches[1], f.branches[0]] },
    ]) {
      const noop = await patch(person.staff_id, payload);
      expect(noop.statusCode, noop.body).toBe(200);
      expect(noop.json().data.staff).toEqual(body.staff);
      expect(await directoryVersion()).toBe(v0 + 2);
      expect(await auditCount(person.staff_id)).toBe(2);
    }
  });

  it('[01b #8] the owner edits a person at two branches; ?branch_id lists only that branch; an owner row missing a branch → every write 403, reads 200', async () => {
    const both = await waiter('Bilal', [f.branches[0], f.branches[1]]);
    const onlyA = await waiter('Usman', [f.branches[0]]);
    const edited = await patch(both.staff_id, {
      expected_version: both.version,
      display_name: 'Bilal R.',
      role_ids: [await roleId('cashier'), await roleId('waiter')],
      denied_permissions: ['apply-refund'],
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json().data.staff).toMatchObject({
      display_name: 'Bilal R.',
      role_ids: [await roleId('cashier'), await roleId('waiter')].sort(),
      denied_permissions: ['apply-refund'],
      branch_ids: [f.branches[0], f.branches[1]].sort(),
    });
    const atB = (await list(`?branch_id=${f.branches[1]}`)).json().data.staff as Staff[];
    expect(atB.map((row) => row.staff_id)).toContain(both.staff_id);
    expect(atB.map((row) => row.staff_id)).not.toContain(onlyA.staff_id);

    await cloud.pool.query(`UPDATE owner_users SET allowed_branch_ids = $3 WHERE tenant_id = $1 AND user_id = $2`, [
      f.tenantId,
      f.userId,
      [f.branches[0], f.branches[1]],
    ]);
    const v = await directoryVersion();
    const current = edited.json().data.staff as Staff;
    const writes = [
      await patch(current.staff_id, { expected_version: current.version, display_name: 'Changed' }),
      await cloud.app.inject({
        method: 'POST',
        url: '/v1/admin/staff',
        ...owner(f),
        payload: { display_name: 'New', role_ids: [await roleId('waiter')], branch_ids: [f.branches[0]] },
      }),
      await cloud.app.inject({
        method: 'PUT',
        url: `/v1/admin/staff/${onlyA.staff_id}/pin`,
        headers: { authorization: `Bearer ${f.token}` },
        payload: { pin: '1234' },
      }),
    ];
    for (const response of writes) {
      expect(response.statusCode, response.body).toBe(403);
      expect(response.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'tenant_wide_write' } });
    }
    expect(await directoryVersion()).toBe(v);
    expect((await list()).statusCode).toBe(200);
    expect((await list(`?branch_id=${f.branches[1]}`)).statusCode).toBe(200);
  });

  it('[01b #87] branch_ids diff keeps the lead and floors at the kept branch and leaves its staff_branches row untouched', async () => {
    await addFloor('F_A', f.branches[0]);
    await addFloor('F_B', f.branches[1]);
    const leadA = await waiter('Hamza', [f.branches[0], f.branches[1]]);
    const person = await waiter('Bilal', [f.branches[0], f.branches[1]], {
      reports_to: [
        { branch_id: f.branches[0], lead_staff_id: leadA.staff_id },
        { branch_id: f.branches[1], lead_staff_id: leadA.staff_id },
      ],
      floors: [
        { branch_id: f.branches[0], floor_ids: ['F_A'] },
        { branch_id: f.branches[1], floor_ids: ['F_B'] },
      ],
    });
    const ctid = async (branchId: string) =>
      (
        await cloud.pool.query<{ ctid: string }>(
          `SELECT ctid::text FROM staff_branches WHERE tenant_id = $1 AND staff_id = $2 AND branch_id = $3`,
          [f.tenantId, person.staff_id, branchId],
        )
      ).rows[0]?.ctid;
    const before = await ctid(f.branches[0]);
    expect(before).toBeDefined();

    const response = await patch(person.staff_id, { expected_version: person.version, branch_ids: [f.branches[0]] });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data.staff).toMatchObject({
      branch_ids: [f.branches[0]],
      reports_to: [{ branch_id: f.branches[0], lead_staff_id: leadA.staff_id }],
      floors: [{ branch_id: f.branches[0], floor_ids: ['F_A'] }],
    });
    expect(await ctid(f.branches[0])).toBe(before);
    expect(await ctid(f.branches[1])).toBeUndefined();
    const leftovers = await cloud.pool.query(
      `SELECT 'lead' AS kind FROM staff_leads WHERE tenant_id = $1 AND staff_id = $2 AND branch_id = $3
       UNION ALL SELECT 'floor' FROM staff_floors WHERE tenant_id = $1 AND staff_id = $2 AND branch_id = $3`,
      [f.tenantId, person.staff_id, f.branches[1]],
    );
    expect(leftovers.rows).toEqual([]);
  });

  it('[01b B23] a stale expected_version → 409 CONFIG_STALE { entity: staff, id }, nothing written (also for a stale no-op)', async () => {
    const person = await waiter('Bilal', [f.branches[0]]);
    const first = await patch(person.staff_id, { expected_version: person.version, display_name: 'Bilal R.' });
    expect(first.statusCode).toBe(200);
    const v = await directoryVersion();
    for (const payload of [
      { expected_version: person.version, denied_permissions: ['apply-refund'] },
      { expected_version: person.version },
    ]) {
      const stale = await patch(person.staff_id, payload);
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error).toMatchObject({ code: 'CONFIG_STALE', details: { entity: 'staff', id: person.staff_id } });
    }
    expect(await directoryVersion()).toBe(v);
    expect(await auditCount(person.staff_id)).toBe(2);
    const [row] = ((await list()).json().data.staff as Array<Staff & { denied_permissions: string[] }>).filter(
      (s) => s.staff_id === person.staff_id,
    );
    expect(row!.denied_permissions).toEqual([]);
  });

  it('[01b §3.2 rule 1] a merged row with no active role → 422 role_archived on role_ids, nothing written; sending an active role → 200', async () => {
    const shiftLead = await roleId('cashier');
    const person = await create({ display_name: 'Bilal', role_ids: [shiftLead], branch_ids: [f.branches[0]] });
    await cloud.pool.query(`UPDATE roles SET archived_at = $3 WHERE tenant_id = $1 AND role_id = $2`, [f.tenantId, shiftLead, T]);
    const v = await directoryVersion();
    const refused = await patch(person.staff_id, { expected_version: person.version, display_name: 'Bilal R.' });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json().error).toMatchObject({
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'role_ids', reason: 'role_archived' },
    });
    expect(await directoryVersion()).toBe(v);
    const fixed = await patch(person.staff_id, { expected_version: person.version, role_ids: [await roleId('waiter')] });
    expect(fixed.statusCode, fixed.body).toBe(200);
  });

  it('[01b §6.4] unknown or other-tenant person → 404 STAFF_NOT_FOUND; merged-row rules: unknown branch 404, archived role 422, reports_to on a removed branch 422, name taken 409', async () => {
    const other = (
      await cloud.pool.query<{ staff_id: string }>(`SELECT staff_id FROM staff WHERE tenant_id = $1 LIMIT 1`, [f.other.tenantId])
    ).rows[0]!.staff_id;
    for (const id of ['NO-SUCH-STAFF', other]) {
      const response = await patch(id, { expected_version: 'x' });
      expect(response.statusCode).toBe(404);
      expect(response.json().error).toMatchObject({ code: 'STAFF_NOT_FOUND', details: { staff_id: id } });
    }
    const lead = await waiter('Hamza', [f.branches[0], f.branches[1]]);
    const person = await waiter('Bilal', [f.branches[0], f.branches[1]]);
    await waiter('Ali', [f.branches[2]]);
    const v = person.version;
    const expectError = async (payload: object, status: number, error: object) => {
      const response = await patch(person.staff_id, { expected_version: v, ...payload });
      expect(response.statusCode, response.body).toBe(status);
      expect(response.json().error).toMatchObject(error);
    };
    await expectError({ branch_ids: [f.branches[0], f.other.branchId] }, 404, { code: 'BRANCH_NOT_FOUND' });
    await cloud.pool.query(`UPDATE roles SET archived_at = $3 WHERE tenant_id = $1 AND role_id = $2`, [
      f.tenantId,
      await roleId('cook'),
      T,
    ]);
    await expectError({ role_ids: [await roleId('cook')] }, 422, {
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'role_ids.0', reason: 'role_archived' },
    });
    await expectError(
      { branch_ids: [f.branches[0]], reports_to: [{ branch_id: f.branches[1], lead_staff_id: lead.staff_id }] },
      422,
      { code: 'CONFIG_REFERENCE_INVALID', details: { field: 'reports_to.0.branch_id', reason: 'wrong_branch' } },
    );
    await expectError({ display_name: 'hamza ' }, 409, { code: 'STAFF_NAME_TAKEN', details: { branch_id: [f.branches[0], f.branches[1]].sort()[0] } });
    await expectError({ branch_ids: [f.branches[0], f.branches[1], f.branches[2]], display_name: 'ALI' }, 409, {
      code: 'STAFF_NAME_TAKEN',
    });
    expect(await auditCount(person.staff_id)).toBe(1);
  });
});
