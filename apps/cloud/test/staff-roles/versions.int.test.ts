import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
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
type Compare = { entity: 'staff' | 'role' | 'responsibility'; id: string; version: string };

describe('changed_versions and one version builder (01b B23, §5.3, §6)', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  const compares: Compare[] = [];

  beforeAll(async () => {
    cloud = await createTestCloud({
      testHooks: {
        onVersionCompare(entity, id, version) {
          compares.push({ entity, id, version });
        },
      },
    });
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    cloud.clock.set(T);
    f = await restaurantFixture(cloud);
    compares.length = 0;
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
  const person = async (name: string, roleIds: string[], branchIds = [f.branches[0]]): Promise<Staff> => {
    const created = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/staff',
      ...owner(f),
      payload: { display_name: name, role_ids: roleIds, branch_ids: branchIds },
    });
    expect(created.statusCode, created.body).toBe(200);
    return created.json().data.staff as Staff;
  };
  const createRole = async (name: string): Promise<Role> => {
    const response = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/roles',
      ...owner(f),
      payload: { name, idle_minutes: 15, grants: [{ permission: 'reprint-ticket', grant_type: 'allowed', approver_role_ids: [] }] },
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data.role as Role;
  };
  const patchRole = (id: string, payload: object) =>
    cloud.app.inject({ method: 'PATCH', url: `/v1/admin/roles/${id}`, headers: auth(), payload });
  const patchStaff = (id: string, payload: object) =>
    cloud.app.inject({ method: 'PATCH', url: `/v1/admin/staff/${id}`, headers: auth(), payload });
  const responsibilitiesUrl = () => `/v1/admin/branches/${f.branches[0]}/responsibilities`;
  const getResponsibilities = async () =>
    (await cloud.app.inject({ method: 'GET', url: responsibilitiesUrl(), headers: auth() })).json().data as {
      responsibilities: unknown[];
      version: string;
    };
  const putResponsibilities = (payload: object) =>
    cloud.app.inject({ method: 'PUT', url: responsibilitiesUrl(), headers: auth(), payload });
  const addStation = (stationId: string) =>
    cloud.pool.query(
      `INSERT INTO stations (tenant_id, branch_id, station_id, name, station_type, capacity, created_at, updated_at)
       VALUES ($1, $2, $3, $3, 'slot', 1, $4, $4)`,
      [f.tenantId, f.branches[0], stationId, T],
    );
  const auditCount = async () =>
    Number((await cloud.pool.query(`SELECT count(*) AS n FROM config_audit WHERE tenant_id = $1`, [f.tenantId])).rows[0].n);
  const expectStale = async (send: () => Promise<{ statusCode: number; body: string; json(): any }>, error: object) => {
    const n = await auditCount();
    const response = await send();
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error).toMatchObject({ code: 'CONFIG_STALE', details: error });
    expect(await auditCount()).toBe(n);
  };
  const lead = (staffId: string, leadId: string) =>
    staffOf(staffId).then((row) => patchStaff(staffId, { expected_version: row.version, reports_to: [{ branch_id: f.branches[0], lead_staff_id: leadId }] }));

  it('[01b #80] stale writes: role grants, staff denials and a responsibilities PUT from an old form → 409 CONFIG_STALE, no audit row; a B15 move makes a form stale; a stale no-op → 409', async () => {
    // Role: two tabs load the Cashier role (with apply-refund added first).
    const cashierId = await roleId('cashier');
    const seeded = await roleOf(cashierId);
    const withRefund = [...seeded.grants, { permission: 'apply-refund', grant_type: 'allowed', approver_role_ids: [], scope: 'branch' }];
    expect((await patchRole(cashierId, { expected_version: seeded.version, grants: withRefund })).statusCode).toBe(200);
    const tab = await roleOf(cashierId);
    const tab1 = await patchRole(cashierId, { expected_version: tab.version, grants: tab.grants.filter((g) => g.permission !== 'apply-refund') });
    expect(tab1.statusCode, tab1.body).toBe(200);
    await expectStale(() => patchRole(cashierId, { expected_version: tab.version, grants: tab.grants }), { entity: 'role', id: cashierId });
    expect((await roleOf(cashierId)).grants.map((g) => g.permission)).not.toContain('apply-refund');

    // Staff denied_permissions.
    const ali = await person('Ali', [cashierId]);
    const first = await patchStaff(ali.staff_id, { expected_version: ali.version, denied_permissions: ['reprint-ticket'] });
    expect(first.statusCode, first.body).toBe(200);
    await expectStale(() => patchStaff(ali.staff_id, { expected_version: ali.version, denied_permissions: [] }), {
      entity: 'staff',
      id: ali.staff_id,
    });

    // Responsibilities PUT.
    await addStation('ST1');
    const set = await getResponsibilities();
    const entry = { responsibility: 'count_stock', station_id: 'ST1', staff_ids: [ali.staff_id], role_ids: [] };
    expect((await putResponsibilities({ expected_version: set.version, responsibilities: [entry] })).statusCode).toBe(200);
    await expectStale(() => putResponsibilities({ expected_version: set.version, responsibilities: [] }), {
      entity: 'responsibility',
      id: f.branches[0],
    });

    // B15: Bilal reports to Hamza; Hamza leaves; a form of Bilal opened before the move is stale.
    const hamza = await person('Hamza', [cashierId]);
    const bilal = await person('Bilal', [cashierId]);
    expect((await lead(bilal.staff_id, hamza.staff_id)).statusCode).toBe(200);
    const bilalForm = await staffOf(bilal.staff_id);
    const left = await patchStaff(hamza.staff_id, { expected_version: (await staffOf(hamza.staff_id)).version, is_active: false });
    expect(left.statusCode, left.body).toBe(200);
    await expectStale(() => patchStaff(bilal.staff_id, { expected_version: bilalForm.version, display_name: 'Bilal K' }), {
      entity: 'staff',
      id: bilal.staff_id,
    });

    // A stale no-op body (the stored values, old version) → 409, not 200.
    const current = await staffOf(bilal.staff_id);
    await expectStale(() => patchStaff(bilal.staff_id, { expected_version: bilalForm.version, display_name: 'Bilal' }), {
      entity: 'staff',
      id: bilal.staff_id,
    });
    expect((await staffOf(bilal.staff_id)).version).toBe(current.version);
  });

  it('[01b #102] no false CONFIG_STALE after the owner\'s own action: PIN set keeps the version; a role archive lists both holders; a leaver lists both moved reports', async () => {
    const cashierId = await roleId('cashier');
    const waiterId = await roleId('waiter');

    // PIN set: the response's version equals the GET's; a role change with the GET's version → 200.
    const usman = await person('Usman', [cashierId]);
    const opened = await staffOf(usman.staff_id);
    const pin = await cloud.app.inject({ method: 'PUT', url: `/v1/admin/staff/${usman.staff_id}/pin`, headers: auth(), payload: { pin: '4321' } });
    expect(pin.statusCode, pin.body).toBe(200);
    expect(pin.json().data.staff.version).toBe(opened.version);
    const saved = await patchStaff(usman.staff_id, { expected_version: opened.version, role_ids: [waiterId] });
    expect(saved.statusCode, saved.body).toBe(200);

    // Archive a role held by two people (each also holds Cashier).
    const shiftLead = await createRole('Shift lead');
    const a = await person('Ahmed', [cashierId, shiftLead.role_id]);
    const b = await person('Bashir', [cashierId, shiftLead.role_id]);
    const archived = await patchRole(shiftLead.role_id, { expected_version: (await roleOf(shiftLead.role_id)).version, archived: true });
    expect(archived.statusCode, archived.body).toBe(200);
    const changed = archived.json().data.changed_versions;
    expect(changed.staff.map((row: { staff_id: string }) => row.staff_id)).toEqual([a.staff_id, b.staff_id].sort());
    expect(changed.roles).toEqual([]);
    for (const row of changed.staff as Array<{ staff_id: string; version: string }>) {
      expect(row.version).toBe((await staffOf(row.staff_id)).version);
    }
    const listed = (changed.staff as Array<{ staff_id: string; version: string }>).find((row) => row.staff_id === a.staff_id)!;
    expect((await patchStaff(a.staff_id, { expected_version: listed.version, display_name: 'Ahmed R.' })).statusCode).toBe(200);
    await expectStale(() => patchStaff(b.staff_id, { expected_version: b.version, display_name: 'Bashir R.' }), {
      entity: 'staff',
      id: b.staff_id,
    });

    // A leaver with two reports: both moved reports' new versions are listed and work.
    const lead1 = await person('Hamza', [cashierId]);
    const r1 = await person('Bilal', [cashierId]);
    const r2 = await person('Ali', [cashierId]);
    expect((await lead(r1.staff_id, lead1.staff_id)).statusCode).toBe(200);
    expect((await lead(r2.staff_id, lead1.staff_id)).statusCode).toBe(200);
    const left = await patchStaff(lead1.staff_id, { expected_version: (await staffOf(lead1.staff_id)).version, is_active: false });
    expect(left.statusCode, left.body).toBe(200);
    const moved = left.json().data.changed_versions.staff as Array<{ staff_id: string; version: string }>;
    expect(moved.map((row) => row.staff_id)).toEqual([r1.staff_id, r2.staff_id].sort());
    for (const row of moved) {
      const response = await patchStaff(row.staff_id, { expected_version: row.version, display_name: `${row.staff_id} R.` });
      expect(response.statusCode, response.body).toBe(200);
    }
  });

  it('[01b #104] one builder, one hash: list GET, in-transaction compare and write response give byte-identical versions; no other sha256hex(canonicalJson( for these entities', async () => {
    // Staff.
    const ali = await person('Ali', [await roleId('cashier')]);
    const listed = await staffOf(ali.staff_id);
    const staffWrite = await patchStaff(ali.staff_id, { expected_version: listed.version, display_name: 'Ali R.' });
    expect(staffWrite.statusCode, staffWrite.body).toBe(200);
    expect(compares.find((c) => c.entity === 'staff' && c.id === ali.staff_id)!.version).toBe(listed.version);
    expect(staffWrite.json().data.staff.version).toBe((await staffOf(ali.staff_id)).version);

    // Role.
    const cashierId = await roleId('cashier');
    const role = await roleOf(cashierId);
    const roleWrite = await patchRole(cashierId, { expected_version: role.version, idle_minutes: 20 });
    expect(roleWrite.statusCode, roleWrite.body).toBe(200);
    expect(compares.find((c) => c.entity === 'role' && c.id === cashierId)!.version).toBe(role.version);
    expect(roleWrite.json().data.role.version).toBe((await roleOf(cashierId)).version);

    // Responsibility set.
    await addStation('ST1');
    const set = await getResponsibilities();
    const put = await putResponsibilities({
      expected_version: set.version,
      responsibilities: [{ responsibility: 'count_stock', station_id: 'ST1', staff_ids: [ali.staff_id], role_ids: [] }],
    });
    expect(put.statusCode, put.body).toBe(200);
    expect(compares.find((c) => c.entity === 'responsibility' && c.id === f.branches[0])!.version).toBe(set.version);
    expect(put.json().data.version).toBe((await getResponsibilities()).version);

    // Source check: the only hashing of these entities is in versions.ts (config-sync hashes the menu snapshot).
    const src = join(__dirname, '../../src');
    const hits = walk(src)
      .filter((file) => !file.endsWith('.test.ts') && readFileSync(file, 'utf8').includes('sha256hex(canonicalJson('))
      .map((file) => relative(src, file));
    expect(hits.sort()).toEqual(['modules/config-sync/service.ts', 'modules/staff-roles/versions.ts']);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
  });
}
