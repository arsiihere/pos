import type { DefaultKey } from '@pos/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadDirectory } from '../../src/modules/hub-registration/repository';
import { pgCounter } from '../helpers/pg-counter';
import { owner, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const T = 1_761_000_000_000;

describe('staff list and create (01b §6.1, §6.2)', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let counter: ReturnType<typeof pgCounter>;

  beforeAll(async () => {
    cloud = await createTestCloud({ testHooks: { handlerStart: () => counter.reset() } });
    counter = pgCounter(cloud.pool);
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    f = await restaurantFixture(cloud);
  });

  const roleId = async (key: DefaultKey) =>
    (
      await cloud.pool.query<{ role_id: string }>(`SELECT role_id FROM roles WHERE tenant_id = $1 AND default_key = $2`, [
        f.tenantId,
        key,
      ])
    ).rows[0]!.role_id;
  const create = (payload: object, o: { headers?: Record<string, string> } = owner(f)) =>
    cloud.app.inject({ method: 'POST', url: '/v1/admin/staff', ...o, payload });
  const list = (query = '') =>
    cloud.app.inject({ method: 'GET', url: `/v1/admin/staff${query}`, headers: { authorization: `Bearer ${f.token}` } });
  const directoryVersion = async () =>
    Number(
      (await cloud.pool.query(`SELECT directory_version FROM tenants WHERE tenant_id = $1`, [f.tenantId])).rows[0].directory_version,
    );
  const staffCount = async () =>
    Number((await cloud.pool.query(`SELECT count(*) AS n FROM staff WHERE tenant_id = $1`, [f.tenantId])).rows[0].n);
  const waiter = async (name: string, branchIds: string[]) => {
    const response = await create({ display_name: name, role_ids: [await roleId('waiter')], branch_ids: branchIds });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data.staff as { staff_id: string; version: string };
  };
  const leave = (staffId: string) =>
    cloud.pool.query(`UPDATE staff SET is_active = false, left_at = $3 WHERE tenant_id = $1 AND staff_id = $2`, [
      f.tenantId,
      staffId,
      T,
    ]);
  const addFloor = (floorId: string, branchId: string, archived = false) =>
    cloud.pool.query(
      `INSERT INTO floors (tenant_id, branch_id, floor_id, name, archived_at, created_at, updated_at) VALUES ($1, $2, $3, $3, $4, $5, $5)`,
      [f.tenantId, branchId, floorId, archived ? T : null, T],
    );

  it('[01b §6.2] create bumps directory_version by exactly 1 and writes one staff / create audit row without version', async () => {
    const v0 = await directoryVersion();
    const created = await waiter('Bilal', [f.branches[0]]);
    expect(await directoryVersion()).toBe(v0 + 1);
    const audit = await cloud.pool.query(
      `SELECT entity, action, actor_kind, before, after FROM config_audit WHERE tenant_id = $1 AND entity_id = $2`,
      [f.tenantId, created.staff_id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ entity: 'staff', action: 'create', actor_kind: 'owner', before: null });
    expect(audit.rows[0].after).toMatchObject({ staff_id: created.staff_id, display_name: 'Bilal', has_pin: false });
    expect(audit.rows[0].after).not.toHaveProperty('version');
    expect(audit.rows[0].after).not.toHaveProperty('pin_hash');
  });

  it('[01b #6] create without a PIN: has_pin false; not in loadDirectory for its branches', async () => {
    const response = await create({
      display_name: 'Bilal',
      role_ids: [await roleId('waiter'), await roleId('cashier')],
      branch_ids: [f.branches[1], f.branches[0]],
    });
    expect(response.statusCode).toBe(200);
    const { staff, changed_versions } = response.json().data;
    expect(staff).toMatchObject({
      display_name: 'Bilal',
      branch_ids: [f.branches[0], f.branches[1]].sort(),
      denied_permissions: [],
      has_pin: false,
      pin_set_at: null,
      is_active: true,
      left_at: null,
      reports_to: [],
      floors: [],
    });
    expect(staff.role_ids).toEqual([await roleId('waiter'), await roleId('cashier')].sort());
    expect(staff.version).toMatch(/^[0-9a-f]{64}$/);
    expect(changed_versions).toEqual({ staff: [], roles: [], responsibilities: [] });
    for (const branchId of [f.branches[0], f.branches[1]]) {
      const client = await cloud.pool.connect();
      try {
        const { directory } = await loadDirectory(client, f.tenantId, branchId);
        expect(directory.staff.map((row) => row.staff_id)).not.toContain(staff.staff_id);
      } finally {
        client.release();
      }
    }
    const listed = (await list()).json().data.staff.find((row: { staff_id: string }) => row.staff_id === staff.staff_id);
    expect(listed).toEqual(staff);
  });

  it('[01b #7] name taken by an active person at a shared branch → 409 STAFF_NAME_TAKEN { branch_id }; another branch only → 200; a leaver does not block', async () => {
    const first = await waiter('Bilal', [f.branches[1]]);
    const before = await staffCount();
    const clash = await create({
      display_name: 'Bilal',
      role_ids: [await roleId('waiter')],
      branch_ids: [f.branches[2], f.branches[1]],
    });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error).toMatchObject({ code: 'STAFF_NAME_TAKEN', details: { display_name: 'Bilal', branch_id: f.branches[1] } });
    expect(await staffCount()).toBe(before);

    await waiter('Bilal', [f.branches[2]]);
    await leave(first.staff_id);
    await waiter('Bilal', [f.branches[1]]);
  });

  it('[01b B12] "Ali " then "ali" at one branch → 409 STAFF_NAME_TAKEN; the name is stored trimmed', async () => {
    const ali = await waiter('Ali ', [f.branches[0]]);
    expect((ali as unknown as { display_name: string }).display_name).toBe('Ali');
    const clash = await create({ display_name: 'ali', role_ids: [await roleId('waiter')], branch_ids: [f.branches[0]] });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error.code).toBe('STAFF_NAME_TAKEN');
  });

  it('[01b §6.2] a 40-character Urdu name is saved; 41 characters → 400 at Zod', async () => {
    const name40 = 'علی'.repeat(13) + 'ع';
    expect([...name40]).toHaveLength(40);
    const saved = await waiter(name40, [f.branches[0]]);
    expect((saved as unknown as { display_name: string }).display_name).toBe(name40);
    const before = await staffCount();
    const tooLong = await create({ display_name: name40 + 'ی', role_ids: [await roleId('waiter')], branch_ids: [f.branches[0]] });
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json().error.code).toBe('VALIDATION_FAILED');
    expect(await staffCount()).toBe(before);
  });

  it('[01b #56] replayed with the same Idempotency-Key → the same body, Idempotent-Replay: true, one person', async () => {
    const headers = owner(f);
    const payload = { display_name: 'Bilal', role_ids: [await roleId('waiter')], branch_ids: [f.branches[0]] };
    const before = await staffCount();
    const first = await create(payload, headers);
    const again = await create(payload, headers);
    expect(first.statusCode).toBe(200);
    expect(again.statusCode).toBe(200);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.json()).toEqual(first.json());
    expect(await staffCount()).toBe(before + 1);
    const mismatch = await create({ ...payload, display_name: 'Other' }, headers);
    expect(mismatch.statusCode).toBe(422);
    expect(mismatch.json().error.code).toBe('IDEMPOTENCY_KEY_MISMATCH');
  });

  it('[01b §6.1, AD-27] GET runs 7 statements (6 + the assignments read) for 3 and 30 staff; ?branch_id and ?status filter; ordered by name', async () => {
    for (const name of ['Zara', 'bilal']) await waiter(name, [f.branches[1]]);
    const left = await waiter('Lee', [f.branches[1]]);
    await leave(left.staff_id);
    counter.reset();
    const small = await list();
    expect(small.statusCode).toBe(200);
    expect(counter.count).toBe(7);
    const names = small.json().data.staff.map((row: { display_name: string }) => row.display_name);
    expect(names).toEqual(['Ada', 'bilal', 'Zara']);

    const atB = (await list(`?branch_id=${f.branches[1]}`)).json().data.staff.map((row: { display_name: string }) => row.display_name);
    expect(atB).toEqual(['Ada', 'bilal', 'Zara']);
    const leavers = (await list('?status=left')).json().data.staff;
    expect(leavers.map((row: { staff_id: string }) => row.staff_id)).toEqual([left.staff_id]);
    expect(leavers[0]).toMatchObject({ is_active: false, left_at: T });

    for (let i = 0; i < 27; i += 1) await waiter(`Person ${String(i).padStart(2, '0')}`, [f.branches[2]]);
    const atC = await list(`?branch_id=${f.branches[2]}`);
    expect(counter.count).toBe(7);
    expect(atC.json().data.staff).toHaveLength(28); // the owner + 27
    await list();
    expect(counter.count).toBe(7);
  });

  it('[01b §6.1, AD-11 superseded] ?branch_id outside the owner’s branches → 404 BRANCH_NOT_FOUND, no statement run', async () => {
    counter.reset();
    const foreign = await list(`?branch_id=${f.other.branchId}`);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error).toMatchObject({ code: 'BRANCH_NOT_FOUND', details: { branch_id: f.other.branchId } });
    const unknown = await list('?branch_id=no-such-branch');
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error).toMatchObject({ code: 'BRANCH_NOT_FOUND', details: { branch_id: 'no-such-branch' } });
    expect(counter.count).toBe(0);
  });

  it('[01b §6.2 rule 1, §3.2 rule 2] a foreign branch → 404 BRANCH_NOT_FOUND; unknown or foreign role → 422 not_found; archived role → 422 role_archived; nothing written', async () => {
    const before = await staffCount();
    const foreignBranch = await create({ display_name: 'X', role_ids: [await roleId('waiter')], branch_ids: [f.branches[0], f.other.branchId] });
    expect(foreignBranch.statusCode).toBe(404);
    expect(foreignBranch.json().error).toMatchObject({ code: 'BRANCH_NOT_FOUND', details: { branch_id: f.other.branchId } });

    const unknown = await create({ display_name: 'X', role_ids: [await roleId('waiter'), 'no-such-role'], branch_ids: [f.branches[0]] });
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'role_ids.1', reason: 'not_found' } });

    await cloud.pool.query(`INSERT INTO roles (tenant_id, role_id, name, session_idle_ttl_ms, archived_at) VALUES ($1, 'r-old', 'Old', 300000, $2)`, [
      f.tenantId,
      T,
    ]);
    const archived = await create({ display_name: 'X', role_ids: ['r-old'], branch_ids: [f.branches[0]] });
    expect(archived.statusCode).toBe(422);
    expect(archived.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'role_ids.0', reason: 'role_archived' } });
    expect(await staffCount()).toBe(before);
  });

  it('[01b §3.2 rules 5–6] create checks reports_to and floors; valid ones are stored and listed', async () => {
    const lead = await waiter('Hamza', [f.branches[0]]);
    const atB = await waiter('Sana', [f.branches[1]]);
    await addFloor('F_A', f.branches[0]);
    await addFloor('F_B', f.branches[1]);
    await addFloor('F_OLD', f.branches[0], true);
    const base = { display_name: 'Bilal', role_ids: [await roleId('waiter')], branch_ids: [f.branches[0]] };
    const cases: Array<[object, string, string]> = [
      [
        { reports_to: [{ branch_id: f.branches[0], lead_staff_id: lead.staff_id }, { branch_id: f.branches[0], lead_staff_id: atB.staff_id }] },
        'reports_to',
        'one_lead_per_branch',
      ],
      [{ reports_to: [{ branch_id: f.branches[1], lead_staff_id: atB.staff_id }] }, 'reports_to.0.branch_id', 'wrong_branch'],
      [{ reports_to: [{ branch_id: f.branches[0], lead_staff_id: atB.staff_id }] }, 'reports_to.0.lead_staff_id', 'not_at_branch'],
      [{ floors: [{ branch_id: f.branches[0], floor_ids: ['F_B'] }] }, 'floors.0.floor_ids.0', 'wrong_branch'],
      [{ floors: [{ branch_id: f.branches[0], floor_ids: ['F_A', 'F_OLD'] }] }, 'floors.0.floor_ids.1', 'archived'],
      [{ floors: [{ branch_id: f.branches[1], floor_ids: ['F_B'] }] }, 'floors.0.branch_id', 'wrong_branch'],
    ];
    const before = await staffCount();
    for (const [extra, field, reason] of cases) {
      const refused = await create({ ...base, ...extra });
      expect(refused.statusCode, field).toBe(422);
      expect(refused.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field, reason } });
    }
    await leave(lead.staff_id);
    const leftLead = await create({ ...base, reports_to: [{ branch_id: f.branches[0], lead_staff_id: lead.staff_id }] });
    expect(leftLead.json().error).toMatchObject({ details: { field: 'reports_to.0.lead_staff_id', reason: 'not_at_branch' } });
    expect(await staffCount()).toBe(before);

    const lead2 = await waiter('Omar', [f.branches[0]]);
    const ok = await create({
      ...base,
      reports_to: [{ branch_id: f.branches[0], lead_staff_id: lead2.staff_id }],
      floors: [{ branch_id: f.branches[0], floor_ids: ['F_A'] }],
      denied_permissions: ['void-item'],
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().data.staff).toMatchObject({
      reports_to: [{ branch_id: f.branches[0], lead_staff_id: lead2.staff_id }],
      floors: [{ branch_id: f.branches[0], floor_ids: ['F_A'] }],
      denied_permissions: ['void-item'],
    });
  });

  it('[01b §6.2, AD-11] repeated role_ids, branch_ids, denied_permissions and a branch twice in floors → 200, each stored once', async () => {
    await addFloor('F_A', f.branches[0]);
    await addFloor('F_A2', f.branches[0]);
    const waiterRole = await roleId('waiter');
    const response = await create({
      display_name: 'Bilal',
      role_ids: [waiterRole, waiterRole],
      branch_ids: [f.branches[0], f.branches[0]],
      denied_permissions: ['void-item', 'void-item'],
      floors: [
        { branch_id: f.branches[0], floor_ids: ['F_A', 'F_A'] },
        { branch_id: f.branches[0], floor_ids: ['F_A', 'F_A2'] },
      ],
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data.staff).toMatchObject({
      role_ids: [waiterRole],
      branch_ids: [f.branches[0]],
      denied_permissions: ['void-item'],
      floors: [{ branch_id: f.branches[0], floor_ids: ['F_A', 'F_A2'] }],
    });
  });

  it('[01b B8] an owner_users row missing a branch → create 403 tenant_wide_write, nothing written; GET still 200', async () => {
    await cloud.pool.query(`UPDATE owner_users SET allowed_branch_ids = $3 WHERE tenant_id = $1 AND user_id = $2`, [
      f.tenantId,
      f.userId,
      [f.branches[0], f.branches[1]],
    ]);
    const before = await staffCount();
    const v0 = await directoryVersion();
    const refused = await create({ display_name: 'Bilal', role_ids: [await roleId('waiter')], branch_ids: [f.branches[0]] });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'tenant_wide_write' } });
    expect(await staffCount()).toBe(before);
    expect(await directoryVersion()).toBe(v0);
    expect((await list()).statusCode).toBe(200);
  });
});
