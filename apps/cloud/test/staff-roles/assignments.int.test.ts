import type { DefaultKey } from '@pos/domain';
import { DirectorySchema } from '@pos/events';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DomainError } from '@pos/domain';
import { TenantLevelRepository } from '../../src/db/tenant-level-repository';
import { loadDirectory } from '../../src/modules/hub-registration/repository';
import { assignmentBackstop, replaceAssignments } from '../../src/modules/staff-roles/repository';
import { owner, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const T = 1_761_000_000_000;

interface Assignment {
  branch_id: string;
  zone_ids: string[];
  table_ids: string[];
}

interface Staff {
  staff_id: string;
  branch_ids: string[];
  assignments: Assignment[];
  version: string;
}

// 01b v1.6 B-2, §3.2 rule 7 with the as-built rulings AD-21–AD-27 (02p §11 #7, U-3).
describe('staff assignments (01b §3.2 rule 7)', () => {
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

  const A = () => f.branches[0];
  const B = () => f.branches[1];

  const roleId = async (key: DefaultKey) =>
    (
      await cloud.pool.query<{ role_id: string }>(`SELECT role_id FROM roles WHERE tenant_id = $1 AND default_key = $2`, [
        f.tenantId,
        key,
      ])
    ).rows[0]!.role_id;
  const post = async (payload: object) =>
    cloud.app.inject({ method: 'POST', url: '/v1/admin/staff', ...owner(f), payload });
  const create = async (name: string, branchIds: string[], extra: object = {}, key: DefaultKey = 'order_taker'): Promise<Staff> => {
    const response = await post({ display_name: name, role_ids: [await roleId(key)], branch_ids: branchIds, ...extra });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data.staff as Staff;
  };
  const patch = (staffId: string, payload: object) =>
    cloud.app.inject({ method: 'PATCH', url: `/v1/admin/staff/${staffId}`, ...owner(f), payload });
  const patched = async (staffId: string, payload: object): Promise<Staff> => {
    const response = await patch(staffId, payload);
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data.staff as Staff;
  };
  const listOne = async (staffId: string, status = 'active'): Promise<Staff> => {
    const response = await cloud.app.inject({ method: 'GET', url: `/v1/admin/staff?status=${status}`, ...owner(f) });
    expect(response.statusCode, response.body).toBe(200);
    return (response.json().data.staff as Staff[]).find((row) => row.staff_id === staffId)!;
  };
  const directoryVersion = async () =>
    Number((await cloud.pool.query(`SELECT directory_version FROM tenants WHERE tenant_id = $1`, [f.tenantId])).rows[0].directory_version);
  const stored = async () =>
    (
      await cloud.pool.query<{ staff_id: string; branch_id: string; subject_kind: string; subject_id: string }>(
        `SELECT staff_id, branch_id, subject_kind, subject_id FROM staff_assignments WHERE tenant_id = $1
          ORDER BY staff_id, branch_id, subject_kind, subject_id`,
        [f.tenantId],
      )
    ).rows;

  async function floor(floorId: string, branchId: string): Promise<void> {
    await cloud.pool.query(
      `INSERT INTO floors (tenant_id, branch_id, floor_id, name, created_at, updated_at) VALUES ($1, $2, $3, $3, $4, $4)`,
      [f.tenantId, branchId, floorId, T],
    );
  }
  async function zone(zoneId: string, branchId: string, floorId: string, archived = false): Promise<void> {
    await cloud.pool.query(
      `INSERT INTO zones (tenant_id, branch_id, zone_id, floor_id, name, archived_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $3, $5, $6, $6)`,
      [f.tenantId, branchId, zoneId, floorId, archived ? T : null, T],
    );
  }
  async function table(tableId: string, branchId: string, floorId: string, o: { zoneId?: string; archived?: boolean } = {}): Promise<void> {
    await cloud.pool.query(
      `INSERT INTO dining_tables (tenant_id, branch_id, table_id, floor_id, name, zone_id, archived_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $3, $5, $6, $7, $7)`,
      [f.tenantId, branchId, tableId, floorId, o.zoneId ?? null, o.archived === true ? T : null, T],
    );
  }
  // Branch A: floor FA with zones ZA1, ZA2 (active) and ZAX (archived); tables TA1 (in ZA1), TA2, TAX (archived).
  // Branch B: floor FB with zone ZB1 and table TB1.
  async function layout(): Promise<void> {
    await floor('FA', A());
    await zone('ZA1', A(), 'FA');
    await zone('ZA2', A(), 'FA');
    await zone('ZAX', A(), 'FA', true);
    await table('TA1', A(), 'FA', { zoneId: 'ZA1' });
    await table('TA2', A(), 'FA');
    await table('TAX', A(), 'FA', { archived: true });
    await floor('FB', B());
    await zone('ZB1', B(), 'FB');
    await table('TB1', B(), 'FB');
  }
  const reference = (response: { statusCode: number; json(): { error: { code: string; details: unknown } } }) => {
    expect(response.statusCode).toBe(422);
    return response.json().error;
  };
  async function directoryOf(branchId: string) {
    const client = await cloud.pool.connect();
    try {
      return DirectorySchema.parse((await loadDirectory(client, f.tenantId, branchId)).directory);
    } finally {
      client.release();
    }
  }
  const setPin = async (staffId: string) => {
    const response = await cloud.app.inject({ method: 'PUT', url: `/v1/admin/staff/${staffId}/pin`, ...owner(f), payload: { pin: '4826' } });
    expect(response.statusCode, response.body).toBe(200);
  };

  it('[01b AD-21] create stores assignments and the StaffWire carries them as { branch_id, zone_ids, table_ids }, sorted; repeated ids are dropped', async () => {
    await layout();
    const v0 = await directoryVersion();
    const sara = await create('Sara', [A(), B()], {
      assignments: [
        { branch_id: B(), zone_ids: ['ZB1'], table_ids: [] },
        { branch_id: A(), zone_ids: ['ZA2', 'ZA1', 'ZA2'], table_ids: ['TA2'] },
      ],
    });
    expect(await directoryVersion()).toBe(v0 + 1);
    expect(sara.assignments).toEqual([
      { branch_id: A(), zone_ids: ['ZA1', 'ZA2'], table_ids: ['TA2'] },
      { branch_id: B(), zone_ids: ['ZB1'], table_ids: [] },
    ].sort((x, y) => (x.branch_id < y.branch_id ? -1 : 1)));
    expect((await listOne(sara.staff_id)).assignments).toEqual(sara.assignments);
    expect(await stored()).toHaveLength(4);
    const plain = await create('Imran', [A()]);
    expect(plain.assignments).toEqual([]);
  });

  it('[02p U-3] one person per zone and per table → 422 CONFIG_REFERENCE_INVALID { field: \'assignments\', reason: \'already_assigned\', staff_id }', async () => {
    await layout();
    const sara = await create('Sara', [A()], { assignments: [{ branch_id: A(), zone_ids: ['ZA1'], table_ids: ['TA2'] }] });
    const v = await directoryVersion();
    // a zone held by Sara
    expect(reference(await post({ display_name: 'Bilal', role_ids: [await roleId('order_taker')], branch_ids: [A()], assignments: [{ branch_id: A(), zone_ids: ['ZA1'], table_ids: [] }] }))).toMatchObject({
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'assignments', reason: 'already_assigned', staff_id: sara.staff_id },
    });
    // a table held by Sara, through PATCH
    const bilal = await create('Bilal', [A()]);
    const error = reference(await patch(bilal.staff_id, { expected_version: bilal.version, assignments: [{ branch_id: A(), zone_ids: [], table_ids: ['TA2'] }] }));
    expect(error.details).toEqual({ field: 'assignments', reason: 'already_assigned', staff_id: sara.staff_id });
    expect(await directoryVersion()).toBe(v + 1); // only Bilal's create
    // AD-24: a table inside Sara's zone may go to another person (the table wins on the hub)
    const withTable = await patched(bilal.staff_id, { expected_version: bilal.version, assignments: [{ branch_id: A(), zone_ids: ['ZA2'], table_ids: ['TA1'] }] });
    expect(withTable.assignments).toEqual([{ branch_id: A(), zone_ids: ['ZA2'], table_ids: ['TA1'] }]);
    // Sara re-sending her own zone is not a clash
    const again = await patched(sara.staff_id, { expected_version: sara.version, assignments: [{ branch_id: A(), zone_ids: ['ZA1'], table_ids: [] }] });
    expect(again.assignments).toEqual([{ branch_id: A(), zone_ids: ['ZA1'], table_ids: [] }]);
    // the index backs the rule
    await expect(
      cloud.pool.query(
        `INSERT INTO staff_assignments (tenant_id, branch_id, staff_id, subject_kind, subject_id) VALUES ($1, $2, $3, 'zone', 'ZA1')`,
        [f.tenantId, A(), bilal.staff_id],
      ),
    ).rejects.toThrow(/staff_assignments_one_person/);
  });

  it('[02p U-3] two concurrent writes for one zone: one is stored, the other → already_assigned (the tenant lock)', async () => {
    await layout();
    for (let run = 0; run < 10; run++) {
      await cloud.pool.query(`DELETE FROM staff_assignments WHERE tenant_id = $1`, [f.tenantId]);
      const one = await create(`One ${run}`, [A()]);
      const two = await create(`Two ${run}`, [A()]);
      const body = { assignments: [{ branch_id: A(), zone_ids: ['ZA1'], table_ids: [] }] };
      const results = await Promise.all([
        patch(one.staff_id, { expected_version: one.version, ...body }),
        patch(two.staff_id, { expected_version: two.version, ...body }),
      ]);
      const codes = results.map((r) => r.statusCode).sort();
      expect(codes).toEqual([200, 422]);
      const loser = results.find((r) => r.statusCode === 422)!;
      const winner = results.find((r) => r.statusCode === 200)!.json().data.staff as Staff;
      expect(loser.json().error.details).toEqual({ field: 'assignments', reason: 'already_assigned', staff_id: winner.staff_id });
      expect((await stored()).filter((row) => row.subject_id === 'ZA1').map((row) => row.staff_id)).toEqual([winner.staff_id]);
    }
  });

  it('[02p U-3] another branch\'s zone → reason \'wrong_branch\'; [01b AD-26] unknown id → not_found, a branch outside branch_ids → wrong_branch', async () => {
    await layout();
    const ot = await roleId('order_taker');
    const send = (assignments: Assignment[], branchIds = [A()]) =>
      post({ display_name: 'Bilal', role_ids: [ot], branch_ids: branchIds, assignments });
    const v = await directoryVersion();
    expect(reference(await send([{ branch_id: A(), zone_ids: ['ZB1'], table_ids: [] }])).details).toEqual({ field: 'assignments', reason: 'wrong_branch' });
    expect(reference(await send([{ branch_id: A(), zone_ids: [], table_ids: ['TB1'] }])).details).toEqual({ field: 'assignments', reason: 'wrong_branch' });
    expect(reference(await send([{ branch_id: B(), zone_ids: ['ZB1'], table_ids: [] }])).details).toEqual({ field: 'assignments', reason: 'wrong_branch' });
    expect(reference(await send([{ branch_id: A(), zone_ids: ['NOPE'], table_ids: [] }])).details).toEqual({ field: 'assignments', reason: 'not_found' });
    expect(reference(await send([{ branch_id: A(), zone_ids: [], table_ids: ['NOPE'] }])).details).toEqual({ field: 'assignments', reason: 'not_found' });
    // another tenant's zone reads as unknown
    await cloud.pool.query(
      `INSERT INTO floors (tenant_id, branch_id, floor_id, name, created_at, updated_at) VALUES ($1, $2, 'FO', 'FO', $3, $3)`,
      [f.other.tenantId, f.other.branchId, T],
    );
    await cloud.pool.query(
      `INSERT INTO zones (tenant_id, branch_id, zone_id, floor_id, name, created_at, updated_at) VALUES ($1, $2, 'ZO', 'FO', 'ZO', $3, $3)`,
      [f.other.tenantId, f.other.branchId, T],
    );
    expect(reference(await send([{ branch_id: A(), zone_ids: ['ZO'], table_ids: [] }])).details).toEqual({ field: 'assignments', reason: 'not_found' });
    expect(await directoryVersion()).toBe(v);
    expect(await stored()).toEqual([]);
  });

  it('[02p U-3] an archived zone → reason \'archived\' (and an archived table)', async () => {
    await layout();
    const person = await create('Bilal', [A()]);
    expect(reference(await patch(person.staff_id, { expected_version: person.version, assignments: [{ branch_id: A(), zone_ids: ['ZAX'], table_ids: [] }] })).details).toEqual({
      field: 'assignments',
      reason: 'archived',
    });
    expect(reference(await patch(person.staff_id, { expected_version: person.version, assignments: [{ branch_id: A(), zone_ids: [], table_ids: ['TAX'] }] })).details).toEqual({
      field: 'assignments',
      reason: 'archived',
    });
    expect(await stored()).toEqual([]);
  });

  it('[01b AD-23] PATCH: a sent entry replaces that branch, unsent branches keep theirs, [] clears; two entries for one branch → 400 VALIDATION_FAILED', async () => {
    await layout();
    let sara = await create('Sara', [A(), B()], {
      assignments: [
        { branch_id: A(), zone_ids: ['ZA1'], table_ids: ['TA2'] },
        { branch_id: B(), zone_ids: ['ZB1'], table_ids: ['TB1'] },
      ],
    });
    sara = await patched(sara.staff_id, { expected_version: sara.version, assignments: [{ branch_id: A(), zone_ids: ['ZA2'], table_ids: [] }] });
    expect(sara.assignments).toEqual(
      [
        { branch_id: A(), zone_ids: ['ZA2'], table_ids: [] },
        { branch_id: B(), zone_ids: ['ZB1'], table_ids: ['TB1'] },
      ].sort((x, y) => (x.branch_id < y.branch_id ? -1 : 1)),
    );
    sara = await patched(sara.staff_id, { expected_version: sara.version, assignments: [{ branch_id: B(), zone_ids: [], table_ids: [] }] });
    expect(sara.assignments).toEqual([{ branch_id: A(), zone_ids: ['ZA2'], table_ids: [] }]);
    // a PATCH without assignments keeps them
    sara = await patched(sara.staff_id, { expected_version: sara.version, display_name: 'Sara K' });
    expect(sara.assignments).toEqual([{ branch_id: A(), zone_ids: ['ZA2'], table_ids: [] }]);
    // the same assignments again is the no-op (nothing bumped)
    const v = await directoryVersion();
    const same = await patched(sara.staff_id, { expected_version: sara.version, assignments: [{ branch_id: A(), zone_ids: ['ZA2'], table_ids: [] }] });
    expect(same.version).toBe(sara.version);
    expect(await directoryVersion()).toBe(v);
    // two entries for one branch
    const twice = await patch(sara.staff_id, {
      expected_version: sara.version,
      assignments: [
        { branch_id: A(), zone_ids: ['ZA1'], table_ids: [] },
        { branch_id: A(), zone_ids: [], table_ids: ['TA2'] },
      ],
    });
    expect(twice.statusCode, twice.body).toBe(400);
    expect(twice.json().error.code).toBe('VALIDATION_FAILED');
    // a branch removed from the person takes its assignments with it (staff_branches cascade)
    sara = await patched(sara.staff_id, { expected_version: sara.version, assignments: [{ branch_id: B(), zone_ids: ['ZB1'], table_ids: [] }] });
    sara = await patched(sara.staff_id, { expected_version: sara.version, branch_ids: [B()] });
    expect(sara.assignments).toEqual([{ branch_id: B(), zone_ids: ['ZB1'], table_ids: [] }]);
    expect((await stored()).map((row) => row.subject_id)).toEqual(['ZB1']);
  });

  it('[01b AD-22] assignments are in the staff version input: an edit changes the version, a save from the old copy → 409 CONFIG_STALE', async () => {
    await layout();
    const sara = await create('Sara', [A()]);
    const edited = await patched(sara.staff_id, { expected_version: sara.version, assignments: [{ branch_id: A(), zone_ids: ['ZA1'], table_ids: [] }] });
    expect(edited.version).not.toBe(sara.version);
    const stale = await patch(sara.staff_id, { expected_version: sara.version, assignments: [{ branch_id: A(), zone_ids: ['ZA2'], table_ids: [] }] });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json().error).toMatchObject({ code: 'CONFIG_STALE', details: { entity: 'staff', id: sara.staff_id } });
    expect((await stored()).map((row) => row.subject_id)).toEqual(['ZA1']);
  });

  it('[02p U-3] a leaver frees their assignments', async () => {
    await layout();
    const sara = await create('Sara', [A()], { assignments: [{ branch_id: A(), zone_ids: ['ZA1'], table_ids: ['TA2'] }] });
    const left = await patched(sara.staff_id, { expected_version: sara.version, is_active: false });
    expect(left.assignments).toEqual([]);
    expect(await stored()).toEqual([]);
    // the zone and table are free for another person
    const bilal = await create('Bilal', [A()], { assignments: [{ branch_id: A(), zone_ids: ['ZA1'], table_ids: ['TA2'] }] });
    expect(bilal.assignments).toEqual([{ branch_id: A(), zone_ids: ['ZA1'], table_ids: ['TA2'] }]);
    // returning does not bring them back
    const back = await patched(sara.staff_id, { expected_version: left.version, is_active: true });
    expect(back.assignments).toEqual([]);
  });

  it('[02p U-3] an assignee without take-order is stored (cloud half; the hub ignores them, 02a §3.6)', async () => {
    await layout();
    const waiter = await create('Wasim', [A()], { assignments: [{ branch_id: A(), zone_ids: ['ZA1'], table_ids: [] }] }, 'waiter');
    expect(waiter.assignments).toEqual([{ branch_id: A(), zone_ids: ['ZA1'], table_ids: [] }]);
    expect(await stored()).toEqual([{ staff_id: waiter.staff_id, branch_id: A(), subject_kind: 'zone', subject_id: 'ZA1' }]);
  });

  it('[02p U-3] an archived zone drops out of the directory; [01b AD-24] an archived table too, and a restore brings it back', async () => {
    await layout();
    const sara = await create('Sara', [A(), B()], {
      assignments: [
        { branch_id: A(), zone_ids: ['ZA1', 'ZA2'], table_ids: ['TA1', 'TA2'] },
        { branch_id: B(), zone_ids: ['ZB1'], table_ids: [] },
      ],
    });
    await setPin(sara.staff_id);
    const entry = async (branchId: string) => (await directoryOf(branchId)).staff.find((row) => row.staff_id === sara.staff_id)!;
    expect(await entry(A())).toMatchObject({ assigned_zone_ids: ['ZA1', 'ZA2'], assigned_table_ids: ['TA1', 'TA2'] });
    expect(await entry(B())).toMatchObject({ assigned_zone_ids: ['ZB1'], assigned_table_ids: [] });
    // archive zone ZA2 through the 01a route; archive table TA2 directly
    const archived = await cloud.app.inject({ method: 'PATCH', url: `/v1/admin/branches/${A()}/zones/ZA2`, ...owner(f), payload: { archived: true } });
    expect(archived.statusCode, archived.body).toBe(200);
    await cloud.pool.query(`UPDATE dining_tables SET archived_at = $3 WHERE tenant_id = $1 AND table_id = $2`, [f.tenantId, 'TA2', T]);
    expect(await entry(A())).toMatchObject({ assigned_zone_ids: ['ZA1'], assigned_table_ids: ['TA1'] });
    // the rows are kept (the admin wire still shows them)
    expect((await listOne(sara.staff_id)).assignments.find((row) => row.branch_id === A())).toEqual({
      branch_id: A(),
      zone_ids: ['ZA1', 'ZA2'],
      table_ids: ['TA1', 'TA2'],
    });
    await cloud.pool.query(`UPDATE dining_tables SET archived_at = NULL WHERE tenant_id = $1 AND table_id = $2`, [f.tenantId, 'TA2']);
    expect(await entry(A())).toMatchObject({ assigned_zone_ids: ['ZA1'], assigned_table_ids: ['TA1', 'TA2'] });
  });

  it('[01b AD-29] a left person PATCHed with assignments stores none; another person can then take the zone', async () => {
    await layout();
    const sara = await create('Sara', [A()]);
    const left = await patched(sara.staff_id, { expected_version: sara.version, is_active: false });
    const again = await patch(left.staff_id, { expected_version: left.version, assignments: [{ branch_id: A(), zone_ids: ['ZA1'], table_ids: ['TA2'] }] });
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json().data.staff.assignments).toEqual([]);
    expect(await stored()).toEqual([]);
    const bilal = await create('Bilal', [A()], { assignments: [{ branch_id: A(), zone_ids: ['ZA1'], table_ids: ['TA2'] }] });
    expect(bilal.assignments).toEqual([{ branch_id: A(), zone_ids: ['ZA1'], table_ids: ['TA2'] }]);
    // returning in the same PATCH may take assignments
    const back = await patched(left.staff_id, { expected_version: left.version, is_active: true, assignments: [{ branch_id: A(), zone_ids: [], table_ids: ['TA1'] }] });
    expect(back.assignments).toEqual([{ branch_id: A(), zone_ids: [], table_ids: ['TA1'] }]);
  });

  it('[01b AD-31] a zone or table the person already holds may be re-sent after it is archived and is kept; a newly added archived id → archived', async () => {
    await layout();
    let sara = await create('Sara', [A()], { assignments: [{ branch_id: A(), zone_ids: ['ZA1'], table_ids: ['TA1'] }] });
    await cloud.pool.query(`UPDATE zones SET archived_at = $3 WHERE tenant_id = $1 AND zone_id = $2`, [f.tenantId, 'ZA1', T]);
    await cloud.pool.query(`UPDATE dining_tables SET archived_at = $3 WHERE tenant_id = $1 AND table_id = $2`, [f.tenantId, 'TA1', T]);
    sara = await patched(sara.staff_id, { expected_version: sara.version, assignments: [{ branch_id: A(), zone_ids: ['ZA1', 'ZA2'], table_ids: ['TA1'] }] });
    expect(sara.assignments).toEqual([{ branch_id: A(), zone_ids: ['ZA1', 'ZA2'], table_ids: ['TA1'] }]);
    for (const assignments of [
      [{ branch_id: A(), zone_ids: ['ZA1', 'ZA2', 'ZAX'], table_ids: ['TA1'] }],
      [{ branch_id: A(), zone_ids: ['ZA1', 'ZA2'], table_ids: ['TA1', 'TAX'] }],
    ]) {
      expect(reference(await patch(sara.staff_id, { expected_version: sara.version, assignments })).details).toEqual({ field: 'assignments', reason: 'archived' });
    }
    // another person may not take Sara's archived zone either way (it is held, and archived for them)
    const bilal = await create('Bilal', [A()]);
    expect(reference(await patch(bilal.staff_id, { expected_version: bilal.version, assignments: [{ branch_id: A(), zone_ids: ['ZA1'], table_ids: [] }] })).details).toEqual({
      field: 'assignments',
      reason: 'archived',
    });
  });

  it('[01b §3.2 rule 7 (l)] a unique-index conflict on staff_assignments_one_person answers 422 already_assigned with the holder, never 500', async () => {
    await layout();
    const sara = await create('Sara', [A()], { assignments: [{ branch_id: A(), zone_ids: ['ZA1'], table_ids: [] }] });
    const bilal = await create('Bilal', [A()]);
    // a writer that skipped the rule (the backstop path): the insert meets the index
    const client = await cloud.pool.connect();
    try {
      await client.query('BEGIN');
      const repo = new TenantLevelRepository(Object.freeze({ tenantId: f.tenantId, branchIds: Object.freeze([...f.branches]) }), client);
      const rows = [{ branch_id: A(), subject_kind: 'zone' as const, subject_id: 'ZA1' }];
      const error = await assignmentBackstop(client, repo, bilal.staff_id, rows, () => replaceAssignments(repo, bilal.staff_id, [A()], rows)).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(DomainError);
      expect(error).toMatchObject({
        code: 'CONFIG_REFERENCE_INVALID',
        details: { field: 'assignments', reason: 'already_assigned', staff_id: sara.staff_id },
      });
      // the transaction is still usable (rolled back to the savepoint)
      expect((await client.query('SELECT 1 AS one')).rows).toEqual([{ one: 1 }]);
      // any other error passes through
      const other = await assignmentBackstop(client, repo, bilal.staff_id, rows, () => Promise.reject(new Error('boom'))).catch((e: unknown) => e);
      expect(other).toMatchObject({ message: 'boom' });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
