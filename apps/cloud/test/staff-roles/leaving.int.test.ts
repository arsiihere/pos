import type { DefaultKey } from '@pos/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadDirectory } from '../../src/modules/hub-registration/repository';
import { owner, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const T = 1_761_000_000_000;

interface Staff {
  staff_id: string;
  display_name: string;
  branch_ids: string[];
  is_active: boolean;
  left_at: number | null;
  has_pin: boolean;
  reports_to: { branch_id: string; lead_staff_id: string }[];
  floors: { branch_id: string; floor_ids: string[] }[];
  version: string;
}

describe('leaving, returning and team moves (01b §6.4, B15, §3.5)', () => {
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
  const waiter = async (name: string, branchIds: string[], extra: object = {}): Promise<Staff> => {
    const response = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/staff',
      ...owner(f),
      payload: { display_name: name, role_ids: [await roleId('waiter')], branch_ids: branchIds, ...extra },
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data.staff as Staff;
  };
  const lead = (branchId: string, person: Staff) => ({ reports_to: [{ branch_id: branchId, lead_staff_id: person.staff_id }] });
  const patch = (staffId: string, payload: object) =>
    cloud.app.inject({
      method: 'PATCH',
      url: `/v1/admin/staff/${staffId}`,
      headers: { authorization: `Bearer ${f.token}` },
      payload,
    });
  const setPin = async (staffId: string) => {
    const response = await cloud.app.inject({
      method: 'PUT',
      url: `/v1/admin/staff/${staffId}/pin`,
      headers: { authorization: `Bearer ${f.token}` },
      payload: { pin: '4321' },
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data.staff as Staff;
  };
  const listed = async (staffId: string, status: 'active' | 'left') =>
    (
      (
        await cloud.app.inject({ method: 'GET', url: `/v1/admin/staff?status=${status}`, headers: { authorization: `Bearer ${f.token}` } })
      ).json().data.staff as Staff[]
    ).find((row) => row.staff_id === staffId);
  const leadOf = async (staffId: string) =>
    (
      await cloud.pool.query(`SELECT branch_id, lead_staff_id FROM staff_leads WHERE tenant_id = $1 AND staff_id = $2 ORDER BY branch_id`, [
        f.tenantId,
        staffId,
      ])
    ).rows;
  const audits = async (staffId: string, action: string) =>
    (
      await cloud.pool.query(`SELECT before, after FROM config_audit WHERE tenant_id = $1 AND entity_id = $2 AND action = $3`, [
        f.tenantId,
        staffId,
        action,
      ])
    ).rows;
  const directoryOf = async (branchId: string) => {
    const client = await cloud.pool.connect();
    try {
      return (await loadDirectory(client, f.tenantId, branchId)).directory;
    } finally {
      client.release();
    }
  };
  const addStation = (stationId: string, branchId: string) =>
    cloud.pool.query(
      `INSERT INTO stations (tenant_id, branch_id, station_id, point_id, name, station_type, capacity, created_at, updated_at)
       VALUES ($1, $2, $3, (SELECT point_id FROM points WHERE tenant_id = $1 AND branch_id = $2 AND name = 'Pass'), $3, 'slot', 1, $4, $4)`,
      [f.tenantId, branchId, stationId, T],
    );
  const addCounter = (branchId: string, stationId: string, staffId: string) =>
    cloud.pool.query(
      `INSERT INTO responsibilities (tenant_id, branch_id, responsibility, station_id, subject_kind, subject_id)
       VALUES ($1, $2, 'count_stock', $3, 'staff', $4)`,
      [f.tenantId, branchId, stationId, staffId],
    );
  const responsibilitiesOf = async (staffId: string) =>
    (
      await cloud.pool.query(`SELECT branch_id, station_id FROM responsibilities WHERE tenant_id = $1 AND subject_id = $2`, [
        f.tenantId,
        staffId,
      ])
    ).rows;

  const ownerStaffId = async () =>
    (
      await cloud.pool.query<{ staff_id: string }>(`SELECT staff_id FROM owner_users WHERE tenant_id = $1 AND user_id = $2`, [
        f.tenantId,
        f.userId,
      ])
    ).rows[0]!.staff_id;
  const directoryVersion = async () =>
    Number((await cloud.pool.query(`SELECT directory_version FROM tenants WHERE tenant_id = $1`, [f.tenantId])).rows[0].directory_version);
  const auditCount = async () =>
    Number((await cloud.pool.query(`SELECT count(*) AS n FROM config_audit WHERE tenant_id = $1`, [f.tenantId])).rows[0].n);

  it('[01b #9] mark as left: left_at set, out of the directory of each branch, one audit row `left`', async () => {
    const person = await setPin((await waiter('Bilal', [f.branches[0], f.branches[1]])).staff_id);
    for (const b of [f.branches[0], f.branches[1]]) {
      expect((await directoryOf(b)).staff.map((row) => row.staff_id)).toContain(person.staff_id);
    }
    const versionBefore = await directoryVersion();

    cloud.clock.set(T + 5_000);
    const response = await patch(person.staff_id, { expected_version: person.version, is_active: false });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data.staff).toMatchObject({ is_active: false, left_at: T + 5_000 });
    const stored = await cloud.pool.query(`SELECT is_active, left_at FROM staff WHERE tenant_id = $1 AND staff_id = $2`, [
      f.tenantId,
      person.staff_id,
    ]);
    expect(stored.rows[0]).toEqual({ is_active: false, left_at: String(T + 5_000) });
    for (const b of [f.branches[0], f.branches[1]]) {
      const directory = await directoryOf(b);
      expect(directory.staff.map((row) => row.staff_id)).not.toContain(person.staff_id);
      expect(directory.directory_version).toBe(versionBefore + 1);
    }
    const rows = await audits(person.staff_id, 'left');
    expect(rows).toHaveLength(1);
    expect(rows[0].before).toMatchObject({ is_active: true, left_at: null });
    expect(rows[0].after).toMatchObject({ is_active: false, left_at: T + 5_000 });
  });

  it('[01b #101] the owner\'s linked row cannot be marked as left → 409 STAFF_LINKED_TO_OWNER, nothing written; any other person → 200', async () => {
    const linked = await ownerStaffId();
    const linkedRow = await listed(linked, 'active');
    const [versionBefore, auditsBefore] = [await directoryVersion(), await auditCount()];

    const refused = await patch(linked, { expected_version: linkedRow!.version, is_active: false });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().error).toMatchObject({ code: 'STAFF_LINKED_TO_OWNER', details: { staff_id: linked } });
    expect(await listed(linked, 'active')).toMatchObject({ version: linkedRow!.version });
    expect([await directoryVersion(), await auditCount()]).toEqual([versionBefore, auditsBefore]);

    // Linked by hand to a row that is not a qualifying admin (no PIN): still refused, before the guards.
    const plain = await waiter('Bilal', [f.branches[0]]);
    await cloud.pool.query(`UPDATE owner_users SET staff_id = $3 WHERE tenant_id = $1 AND user_id = $2`, [f.tenantId, f.userId, plain.staff_id]);
    const refusedPlain = await patch(plain.staff_id, { expected_version: plain.version, is_active: false });
    expect(refusedPlain.statusCode, refusedPlain.body).toBe(409);
    expect(refusedPlain.json().error).toMatchObject({ code: 'STAFF_LINKED_TO_OWNER', details: { staff_id: plain.staff_id } });
    expect(await audits(plain.staff_id, 'left')).toEqual([]);

    const other = await waiter('Usman', [f.branches[0]]);
    const allowed = await patch(other.staff_id, { expected_version: other.version, is_active: false });
    expect(allowed.statusCode, allowed.body).toBe(200);
  });

  it('[01b #10] bring back: left_at cleared, PIN kept, back in the directory with the same hash', async () => {
    const person = await setPin((await waiter('Bilal', [f.branches[0]])).staff_id);
    const hashBefore = (await directoryOf(f.branches[0])).staff.find((row) => row.staff_id === person.staff_id)!.pin_hash;

    cloud.clock.set(T + 1_000);
    const left = await patch(person.staff_id, { expected_version: person.version, is_active: false });
    expect(left.statusCode, left.body).toBe(200);
    const leaver = left.json().data.staff as Staff;
    expect(leaver).toMatchObject({ is_active: false, left_at: T + 1_000, has_pin: true });
    expect(await listed(person.staff_id, 'active')).toBeUndefined();
    expect(await listed(person.staff_id, 'left')).toMatchObject({ is_active: false });
    expect((await directoryOf(f.branches[0])).staff.map((row) => row.staff_id)).not.toContain(person.staff_id);
    expect(await audits(person.staff_id, 'left')).toHaveLength(1);

    const back = await patch(person.staff_id, { expected_version: leaver.version, is_active: true });
    expect(back.statusCode, back.body).toBe(200);
    expect(back.json().data.staff).toMatchObject({ is_active: true, left_at: null, has_pin: true, branch_ids: [f.branches[0]] });
    const row = (await directoryOf(f.branches[0])).staff.find((s) => s.staff_id === person.staff_id);
    expect(row?.pin_hash).toBe(hashBefore);
    expect(await audits(person.staff_id, 'returned')).toHaveLength(1);
  });

  it('[01b §6.4] returning re-checks B12: an active person took the name meanwhile → 409 STAFF_NAME_TAKEN, nothing written', async () => {
    const person = await waiter('Bilal', [f.branches[0]]);
    const left = (await patch(person.staff_id, { expected_version: person.version, is_active: false })).json().data.staff as Staff;
    await waiter('bilal', [f.branches[0]]);
    const back = await patch(person.staff_id, { expected_version: left.version, is_active: true });
    expect(back.statusCode, back.body).toBe(409);
    expect(back.json().error).toMatchObject({ code: 'STAFF_NAME_TAKEN', details: { branch_id: f.branches[0] } });
    expect(await listed(person.staff_id, 'left')).toMatchObject({ version: left.version });
  });

  it('[01b #28] a leaver with 2 reports and a lead: the reports move to the leaver\'s lead, listed in moved_reports, one reports_to_reassigned audit row each', async () => {
    const b = f.branches[0];
    const top = await waiter('Hamza', [b]);
    const leaver = await waiter('Imran', [b], lead(b, top));
    const r1 = await waiter('Bilal', [b], lead(b, leaver));
    const r2 = await waiter('Usman', [b], lead(b, leaver));
    await addStation('ST_1', b);
    await addCounter(b, 'ST_1', leaver.staff_id);

    const response = await patch(leaver.staff_id, { expected_version: leaver.version, is_active: false });
    expect(response.statusCode, response.body).toBe(200);
    const data = response.json().data;
    expect(data.staff.reports_to).toEqual([]);
    expect(data.moved_reports).toEqual(
      [r1, r2]
        .map((r) => ({ staff_id: r.staff_id, branch_id: b, lead_staff_id: top.staff_id }))
        .sort((x, y) => (x.staff_id < y.staff_id ? -1 : 1)),
    );
    for (const r of [r1, r2]) {
      expect(await leadOf(r.staff_id)).toEqual([{ branch_id: b, lead_staff_id: top.staff_id }]);
      const rows = await audits(r.staff_id, 'reports_to_reassigned');
      expect(rows).toEqual([
        { before: { branch_id: b, lead_staff_id: leaver.staff_id }, after: { branch_id: b, lead_staff_id: top.staff_id } },
      ]);
      const now = await listed(r.staff_id, 'active');
      expect(now!.version).not.toBe(r.version);
    }
    expect(data.changed_versions.staff).toEqual(
      (await Promise.all([r1, r2].map(async (r) => ({ staff_id: r.staff_id, version: (await listed(r.staff_id, 'active'))!.version })))).sort(
        (x, y) => (x.staff_id < y.staff_id ? -1 : 1),
      ),
    );
    expect(await leadOf(leaver.staff_id)).toEqual([]);
    expect(await responsibilitiesOf(leaver.staff_id)).toEqual([]);
    expect(data.changed_versions.responsibilities.map((row: { branch_id: string }) => row.branch_id)).toEqual([b]);
    // R-1 (§6 "one row per changed entity"): the branch's responsibility set gets its own row.
    expect(await audits(b, 'update')).toEqual([
      {
        before: [{ responsibility: 'count_stock', station_id: 'ST_1', staff_ids: [leaver.staff_id], role_ids: [] }],
        after: [],
      },
    ]);
  });

  it('[01b #29] a leaver with no lead: their reports end with no lead', async () => {
    const b = f.branches[0];
    const leaver = await waiter('Imran', [b]);
    const r1 = await waiter('Bilal', [b], lead(b, leaver));
    const response = await patch(leaver.staff_id, { expected_version: leaver.version, is_active: false });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data.moved_reports).toEqual([{ staff_id: r1.staff_id, branch_id: b, lead_staff_id: null }]);
    expect(await leadOf(r1.staff_id)).toEqual([]);
    expect(await audits(r1.staff_id, 'reports_to_reassigned')).toEqual([
      { before: { branch_id: b, lead_staff_id: leaver.staff_id }, after: { branch_id: b, lead_staff_id: null } },
    ]);
  });

  it('[01b #30] removing a person from a branch moves their reports there and deletes their floors, lead and responsibilities there', async () => {
    const [a, b] = [f.branches[0], f.branches[1]];
    await cloud.pool.query(
      `INSERT INTO floors (tenant_id, branch_id, floor_id, name, archived_at, created_at, updated_at) VALUES ($1, $2, 'F_B', 'F_B', NULL, $3, $3)`,
      [f.tenantId, b, T],
    );
    const topB = await waiter('Hamza', [a, b]);
    const person = await waiter('Imran', [a, b], {
      reports_to: [{ branch_id: b, lead_staff_id: topB.staff_id }],
      floors: [{ branch_id: b, floor_ids: ['F_B'] }],
    });
    const atA = await waiter('Ali', [a], lead(a, person));
    const atB = await waiter('Bilal', [b], lead(b, person));
    await addStation('ST_A', a);
    await addStation('ST_B', b);
    await addCounter(a, 'ST_A', person.staff_id);
    await addCounter(b, 'ST_B', person.staff_id);

    const response = await patch(person.staff_id, { expected_version: person.version, branch_ids: [a] });
    expect(response.statusCode, response.body).toBe(200);
    const data = response.json().data;
    expect(data.staff).toMatchObject({ branch_ids: [a], reports_to: [], floors: [] });
    expect(data.moved_reports).toEqual([{ staff_id: atB.staff_id, branch_id: b, lead_staff_id: topB.staff_id }]);
    expect(await leadOf(atB.staff_id)).toEqual([{ branch_id: b, lead_staff_id: topB.staff_id }]);
    expect(await leadOf(atA.staff_id)).toEqual([{ branch_id: a, lead_staff_id: person.staff_id }]);
    expect(await responsibilitiesOf(person.staff_id)).toEqual([{ branch_id: a, station_id: 'ST_A' }]);
    expect(data.changed_versions.staff.map((row: { staff_id: string }) => row.staff_id)).toEqual([atB.staff_id]);
    expect(data.changed_versions.responsibilities.map((row: { branch_id: string }) => row.branch_id)).toEqual([b]);
    expect(await audits(atB.staff_id, 'reports_to_reassigned')).toHaveLength(1);
    expect(await audits(person.staff_id, 'update')).toHaveLength(1);
  });
  const getSet = async (branchId: string) =>
    (
      await cloud.app.inject({
        method: 'GET',
        url: `/v1/admin/branches/${branchId}/responsibilities`,
        headers: { authorization: `Bearer ${f.token}` },
      })
    ).json().data as { responsibilities: unknown[]; version: string };

  it('[01b §6, D-17] a leaver whose only rows are at an archived station: the branch is listed in changed_versions with its unchanged set version, no responsibility audit row', async () => {
    const b = f.branches[0];
    const leaver = await waiter('Imran', [b]);
    await addStation('ST_OLD', b);
    await addCounter(b, 'ST_OLD', leaver.staff_id);
    await cloud.pool.query(`UPDATE stations SET archived_at = $3 WHERE tenant_id = $1 AND station_id = $2`, [f.tenantId, 'ST_OLD', T]);
    const before = await getSet(b);

    const response = await patch(leaver.staff_id, { expected_version: leaver.version, is_active: false });
    expect(response.statusCode, response.body).toBe(200);
    expect(await responsibilitiesOf(leaver.staff_id)).toEqual([]);
    const after = await getSet(b);
    expect(after).toEqual(before);
    expect(response.json().data.changed_versions.responsibilities).toEqual([{ branch_id: b, version: before.version }]);
    expect(await audits(b, 'update')).toEqual([]);
  });

  it('[01b §6.4, AD-15] a reports_to sent on the PATCH that marks the person as left is ignored: no lead row, no rule check', async () => {
    const [a, b] = [f.branches[0], f.branches[1]];
    const top = await waiter('Hamza', [a]);
    const leaver = await waiter('Imran', [a], lead(a, top));
    // A branch the person does not work at would be `wrong_branch` if it were checked.
    const response = await patch(leaver.staff_id, {
      expected_version: leaver.version,
      is_active: false,
      reports_to: [{ branch_id: b, lead_staff_id: top.staff_id }],
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data.staff).toMatchObject({ is_active: false, reports_to: [] });
    expect(await leadOf(leaver.staff_id)).toEqual([]);
  });

  it('[01b §6.4, AD-15] leaving and a rename in one PATCH write one audit row for the person, action `left`', async () => {
    const person = await waiter('Imran', [f.branches[0]]);
    const response = await patch(person.staff_id, { expected_version: person.version, is_active: false, display_name: 'Imran K' });
    expect(response.statusCode, response.body).toBe(200);
    const rows = (
      await cloud.pool.query(`SELECT action, after FROM config_audit WHERE tenant_id = $1 AND entity_id = $2`, [f.tenantId, person.staff_id])
    ).rows.filter((row) => row.action !== 'create');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'left', after: { display_name: 'Imran K', is_active: false } });
  });
});
