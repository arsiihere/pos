import type { DefaultKey } from '@pos/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DirectorySchemaV1 } from '../../../../packages/events/test/fixtures/v1-schemas';
import { loadDirectoryV14 } from '../fixtures/v14-load-directory';
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
  name: string;
  is_default: boolean;
  idle_minutes: number;
  grants: Grant[];
  version: string;
}

describe('role PATCH (01b §6.7)', () => {
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
  const patch = (id: string, payload: object) =>
    cloud.app.inject({
      method: 'PATCH',
      url: `/v1/admin/roles/${id}`,
      headers: { authorization: `Bearer ${f.token}` },
      payload,
    });
  const listed = async (id: string) =>
    (
      (await cloud.app.inject({ method: 'GET', url: '/v1/admin/roles', headers: { authorization: `Bearer ${f.token}` } })).json().data
        .roles as Role[]
    ).find((row) => row.role_id === id);
  const storedApprover = async (id: string, permission: string) =>
    (
      await cloud.pool.query(`SELECT approver_role_id FROM role_permissions WHERE tenant_id = $1 AND role_id = $2 AND permission = $3`, [
        f.tenantId,
        id,
        permission,
      ])
    ).rows[0]?.approver_role_id as string | null | undefined;
  const directoryVersion = async () =>
    Number(
      (await cloud.pool.query(`SELECT directory_version FROM tenants WHERE tenant_id = $1`, [f.tenantId])).rows[0].directory_version,
    );
  const roleAudits = async (id: string) =>
    (
      await cloud.pool.query(`SELECT action, before, after FROM config_audit WHERE tenant_id = $1 AND entity = 'role' AND entity_id = $2 ORDER BY at, audit_id`, [
        f.tenantId,
        id,
      ])
    ).rows;
  const v14Directory = async (branchId: string) => {
    const client = await cloud.pool.connect();
    try {
      return DirectorySchemaV1.parse(await loadDirectoryV14(client, f.tenantId, branchId));
    } finally {
      client.release();
    }
  };

  it('[01b #79] the approver is dual-written: [B, A] → A; updated to [C] → C; allowed → null; v1.4 loadDirectory still parses with the single approver', async () => {
    const approvers = [await createRole('Approver 1'), await createRole('Approver 2'), await createRole('Approver 3')];
    const [a, b, c] = approvers.map((role) => role.role_id).sort() as [string, string, string];
    const role = await createRole('Shift lead', [
      { permission: 'apply-discount', grant_type: 'requires_approval', approver_role_ids: [b, a] },
    ]);
    expect(await storedApprover(role.role_id, 'apply-discount')).toBe(a);

    // A holder with a PIN at branch A, so v1.4's SQL (pin_hash unfiltered) sees a valid row.
    const hired = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/staff',
      ...owner(f),
      payload: { display_name: 'Bilal', role_ids: [role.role_id], branch_ids: [f.branches[0]] },
    });
    expect(hired.statusCode, hired.body).toBe(200);
    const pin = await cloud.app.inject({
      method: 'PUT',
      url: `/v1/admin/staff/${hired.json().data.staff.staff_id}/pin`,
      headers: { authorization: `Bearer ${f.token}` },
      payload: { pin: '4321' },
    });
    expect(pin.statusCode, pin.body).toBe(200);

    const toC = await patch(role.role_id, {
      expected_version: role.version,
      grants: [{ permission: 'apply-discount', grant_type: 'requires_approval', approver_role_ids: [c] }],
    });
    expect(toC.statusCode, toC.body).toBe(200);
    const afterC = toC.json().data.role as Role;
    expect(afterC.grants).toEqual([{ permission: 'apply-discount', grant_type: 'requires_approval', approver_role_ids: [c], scope: 'branch' }]);
    expect(await storedApprover(role.role_id, 'apply-discount')).toBe(c);
    const approverRows = await cloud.pool.query(
      `SELECT approver_role_id FROM role_permission_approvers WHERE tenant_id = $1 AND role_id = $2`,
      [f.tenantId, role.role_id],
    );
    expect(approverRows.rows).toEqual([{ approver_role_id: c }]);
    const v14 = await v14Directory(f.branches[0]);
    const grant = v14.roles.find((row) => row.role_id === role.role_id)!.permissions.find((p) => p.permission === 'apply-discount');
    expect(grant).toMatchObject({ grant_type: 'requires_approval', approver_role_id: c });
    expect(v14.roles.map((row) => row.role_id)).toContain(c);

    const toAllowed = await patch(role.role_id, {
      expected_version: afterC.version,
      grants: [{ permission: 'apply-discount', grant_type: 'allowed', approver_role_ids: [] }],
    });
    expect(toAllowed.statusCode, toAllowed.body).toBe(200);
    expect(await storedApprover(role.role_id, 'apply-discount')).toBeNull();
    const v14Allowed = await v14Directory(f.branches[0]);
    expect(v14Allowed.roles.find((row) => row.role_id === role.role_id)!.permissions).toEqual([
      { permission: 'apply-discount', grant_type: 'allowed', approver_role_id: null },
    ]);
  });

  it('[01b §6.7] renaming a default role keeps its default_key; name and idle edits are saved and bump once', async () => {
    const waiterId = await roleId('waiter');
    const waiter = (await listed(waiterId))!;
    const v = await directoryVersion();
    const response = await patch(waiterId, { expected_version: waiter.version, name: 'Bera', idle_minutes: 10 });
    expect(response.statusCode, response.body).toBe(200);
    const data = response.json().data;
    expect(data.role).toMatchObject({ role_id: waiterId, name: 'Bera', idle_minutes: 10, is_default: true });
    expect(data.role.version).not.toBe(waiter.version);
    expect(data.changed_versions).toEqual({ staff: [], roles: [], responsibilities: [] });
    expect(await directoryVersion()).toBe(v + 1);
    const stored = await cloud.pool.query(`SELECT name, default_key, session_idle_ttl_ms FROM roles WHERE tenant_id = $1 AND role_id = $2`, [
      f.tenantId,
      waiterId,
    ]);
    expect(stored.rows[0]).toMatchObject({ name: 'Bera', default_key: 'waiter' });
    expect(Number(stored.rows[0].session_idle_ttl_ms)).toBe(600_000);

    // A no-op bumps nothing and writes no audit row.
    const noop = await patch(waiterId, { expected_version: data.role.version, name: 'Bera' });
    expect(noop.statusCode, noop.body).toBe(200);
    expect(noop.json().data.role).toEqual(data.role);
    expect(await directoryVersion()).toBe(v + 1);
    expect(await roleAudits(waiterId)).toHaveLength(1);

    // Rules as §6.6: an active role's name, case-insensitive.
    const taken = await patch(waiterId, { expected_version: data.role.version, name: 'manager' });
    expect(taken.statusCode, taken.body).toBe(409);
    expect(taken.json().error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'role', name: 'manager' } });
  });

  it('[01b §6.7] a stale expected_version → 409 CONFIG_STALE { entity: role, id }, nothing written; unknown or other-tenant role → 404 ROLE_NOT_FOUND', async () => {
    const role = await createRole('Shift lead');
    const first = await patch(role.role_id, { expected_version: role.version, idle_minutes: 30 });
    expect(first.statusCode, first.body).toBe(200);
    const v = await directoryVersion();
    for (const payload of [{ expected_version: role.version, name: 'Lead' }, { expected_version: role.version }]) {
      const stale = await patch(role.role_id, payload);
      expect(stale.statusCode, stale.body).toBe(409);
      expect(stale.json().error).toMatchObject({ code: 'CONFIG_STALE', details: { entity: 'role', id: role.role_id } });
    }
    expect(await directoryVersion()).toBe(v);
    expect((await listed(role.role_id))!.name).toBe('Shift lead');

    const other = (
      await cloud.pool.query<{ role_id: string }>(`SELECT role_id FROM roles WHERE tenant_id = $1 LIMIT 1`, [f.other.tenantId])
    ).rows[0]!.role_id;
    for (const id of ['NO-SUCH-ROLE', other]) {
      const response = await patch(id, { expected_version: 'x' });
      expect(response.statusCode).toBe(404);
      expect(response.json().error).toMatchObject({ code: 'ROLE_NOT_FOUND', details: { role_id: id } });
    }
  });

  it('[01b §6.7] a grant edit writes one role / update audit row with the grants in before and after', async () => {
    const role = await createRole('Shift lead', [{ permission: 'reprint-ticket', grant_type: 'allowed', approver_role_ids: [] }]);
    const manager = await roleId('manager');
    const grants = [
      { permission: 'apply-discount', grant_type: 'requires_approval', approver_role_ids: [manager], scope: 'branch' },
      { permission: 'approve-void', grant_type: 'allowed', approver_role_ids: [], scope: 'my_team' },
    ];
    const response = await patch(role.role_id, { expected_version: role.version, grants });
    expect(response.statusCode, response.body).toBe(200);
    const audits = await roleAudits(role.role_id);
    expect(audits.map((row) => row.action)).toEqual(['create', 'update']);
    const update = audits[1]!;
    expect(update.before.grants).toEqual([{ permission: 'reprint-ticket', grant_type: 'allowed', approver_role_ids: [], scope: 'branch' }]);
    expect(update.after.grants).toEqual(grants);
    expect(update.after).not.toHaveProperty('version');
    expect(update.after).not.toHaveProperty('staff_count');

    // Rules as §6.6 on a PATCH: scope not allowed → 422, nothing written.
    const bad = await patch(role.role_id, {
      expected_version: response.json().data.role.version,
      grants: [{ permission: 'apply-refund', grant_type: 'allowed', approver_role_ids: [], scope: 'my_team' }],
    });
    expect(bad.statusCode, bad.body).toBe(422);
    expect(bad.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { reason: 'scope_not_allowed' } });
    expect(await roleAudits(role.role_id)).toHaveLength(2);
  });
});
