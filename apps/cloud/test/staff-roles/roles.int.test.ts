import type { DefaultKey } from '@pos/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pgCounter } from '../helpers/pg-counter';
import { owner, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const T = 1_761_000_000_000;

interface Role {
  role_id: string;
  name: string;
  is_default: boolean;
  archived_at: number | null;
  idle_minutes: number;
  staff_count: number;
  grants: { permission: string; grant_type: string; approver_role_ids: string[]; scope: string }[];
  version: string;
}

describe('roles list and create (01b §6.5, §6.6)', () => {
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
  const create = (payload: object, o: { headers?: Record<string, string> } = owner(f)) =>
    cloud.app.inject({ method: 'POST', url: '/v1/admin/roles', ...o, payload });
  const list = (query = '') =>
    cloud.app.inject({ method: 'GET', url: `/v1/admin/roles${query}`, headers: { authorization: `Bearer ${f.token}` } });
  const roleCount = async () =>
    Number((await cloud.pool.query(`SELECT count(*) AS n FROM roles WHERE tenant_id = $1`, [f.tenantId])).rows[0].n);
  const directoryVersion = async () =>
    Number(
      (await cloud.pool.query(`SELECT directory_version FROM tenants WHERE tenant_id = $1`, [f.tenantId])).rows[0].directory_version,
    );
  const expect422 = async (payload: object, details: object) => {
    const before = await roleCount();
    const response = await create(payload);
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details });
    expect(await roleCount()).toBe(before);
  };

  it('[01b §6.6] create stores the dual-written approver and one approver row each; bumps directory_version once; audit role / create', async () => {
    const [manager, ownerRole] = [await roleId('manager'), await roleId('owner')];
    const v0 = await directoryVersion();
    const response = await create({
      name: '  Shift lead ',
      idle_minutes: 30,
      grants: [
        { permission: 'reprint-ticket', grant_type: 'allowed', approver_role_ids: [] },
        { permission: 'apply-discount', grant_type: 'requires_approval', approver_role_ids: [ownerRole, manager] },
        { permission: 'take-order-anywhere', grant_type: 'allowed', approver_role_ids: [], scope: 'my_floors' },
      ],
    });
    expect(response.statusCode, response.body).toBe(200);
    const { role, changed_versions } = response.json().data as { role: Role; changed_versions: unknown };
    expect(changed_versions).toEqual({ staff: [], roles: [], responsibilities: [] });
    expect(role).toMatchObject({ name: 'Shift lead', is_default: false, archived_at: null, idle_minutes: 30, staff_count: 0 });
    expect(role.grants).toEqual([
      { permission: 'apply-discount', grant_type: 'requires_approval', approver_role_ids: [manager, ownerRole].sort(), scope: 'branch' },
      { permission: 'reprint-ticket', grant_type: 'allowed', approver_role_ids: [], scope: 'branch' },
      { permission: 'take-order-anywhere', grant_type: 'allowed', approver_role_ids: [], scope: 'my_floors' },
    ]);
    expect(await directoryVersion()).toBe(v0 + 1);

    const stored = await cloud.pool.query(
      `SELECT r.default_key, r.session_idle_ttl_ms, p.permission, p.approver_role_id
         FROM roles r JOIN role_permissions p ON p.tenant_id = r.tenant_id AND p.role_id = r.role_id
        WHERE r.tenant_id = $1 AND r.role_id = $2 ORDER BY p.permission`,
      [f.tenantId, role.role_id],
    );
    expect(stored.rows[0]).toMatchObject({ default_key: null, session_idle_ttl_ms: 1_800_000, permission: 'apply-discount' });
    expect(stored.rows[0].approver_role_id).toBe([manager, ownerRole].sort()[0]);
    expect(stored.rows[1].approver_role_id).toBeNull();
    const approvers = await cloud.pool.query(
      `SELECT approver_role_id FROM role_permission_approvers WHERE tenant_id = $1 AND role_id = $2 ORDER BY approver_role_id`,
      [f.tenantId, role.role_id],
    );
    expect(approvers.rows.map((row) => row.approver_role_id)).toEqual([manager, ownerRole].sort());

    const audit = await cloud.pool.query(
      `SELECT entity, action, actor_kind, before, after FROM config_audit WHERE tenant_id = $1 AND entity_id = $2`,
      [f.tenantId, role.role_id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ entity: 'role', action: 'create', actor_kind: 'owner', before: null });
    expect(audit.rows[0].after).toMatchObject({ role_id: role.role_id, name: 'Shift lead', grants: role.grants });
    expect(audit.rows[0].after).not.toHaveProperty('version');
    expect(audit.rows[0].after).not.toHaveProperty('staff_count');

    const listed = (await list()).json().data.roles as Role[];
    expect(listed.find((row) => row.role_id === role.role_id)).toEqual(role);
  });

  it('[01b #13 cloud half] an allowed grant with approvers, or requires_approval with none → 422, nothing written', async () => {
    const manager = await roleId('manager');
    await expect422(
      { name: 'X', idle_minutes: 5, grants: [{ permission: 'apply-discount', grant_type: 'allowed', approver_role_ids: [manager] }] },
      { field: 'grants.0.approver_role_ids' },
    );
    await expect422(
      { name: 'X', idle_minutes: 5, grants: [{ permission: 'apply-discount', grant_type: 'requires_approval', approver_role_ids: [] }] },
      { field: 'grants.0.approver_role_ids' },
    );
  });

  it('[01b #14] a scope not in the permission\'s row → 422 scope_not_allowed', async () => {
    await expect422(
      {
        name: 'X',
        idle_minutes: 5,
        grants: [
          { permission: 'manage-stock', grant_type: 'allowed', approver_role_ids: [], scope: 'my_stations' },
          { permission: 'apply-discount', grant_type: 'allowed', approver_role_ids: [], scope: 'my_floors' },
        ],
      },
      { field: 'grants.1.scope', reason: 'scope_not_allowed' },
    );
  });

  it('[01b §6.6] approvers must be active roles of the tenant; one grant per permission', async () => {
    const otherRole = (
      await cloud.pool.query<{ role_id: string }>(`SELECT role_id FROM roles WHERE tenant_id = $1 LIMIT 1`, [f.other.tenantId])
    ).rows[0]!.role_id;
    const grant = (approvers: string[]) => ({
      name: 'X',
      idle_minutes: 5,
      grants: [{ permission: 'apply-discount', grant_type: 'requires_approval', approver_role_ids: approvers }],
    });
    await expect422(grant([await roleId('manager'), otherRole]), { field: 'grants.0.approver_role_ids.1', reason: 'not_found' });
    await cloud.pool.query(`UPDATE roles SET archived_at = $3 WHERE tenant_id = $1 AND role_id = $2`, [
      f.tenantId,
      await roleId('cook'),
      T,
    ]);
    await expect422(grant([await roleId('cook')]), { field: 'grants.0.approver_role_ids.0', reason: 'role_archived' });
    await expect422(
      {
        name: 'X',
        idle_minutes: 5,
        grants: [
          { permission: 'reprint-ticket', grant_type: 'allowed', approver_role_ids: [] },
          { permission: 'reprint-ticket', grant_type: 'allowed', approver_role_ids: [] },
        ],
      },
      { field: 'grants.1.permission' },
    );
  });

  it('[01b #15] name unique among active roles, case-insensitive → 409 CONFIG_NAME_TAKEN { entity: role }; an archived role\'s name is free', async () => {
    const taken = await create({ name: 'manager ', idle_minutes: 5, grants: [] });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'role', name: 'manager' } });
    await cloud.pool.query(`UPDATE roles SET archived_at = $3 WHERE tenant_id = $1 AND role_id = $2`, [
      f.tenantId,
      await roleId('cook'),
      T,
    ]);
    const free = await create({ name: 'COOK', idle_minutes: 5, grants: [] });
    expect(free.statusCode, free.body).toBe(200);
    expect(free.json().data.role.name).toBe('COOK');
  });

  it('[01b #60] replay with the same key and body → same body, Idempotent-Replay, one role, one audit row; another body → 422', async () => {
    const headers = owner(f);
    const payload = { name: 'Shift lead', idle_minutes: 30, grants: [] };
    const first = await create(payload, headers);
    expect(first.statusCode).toBe(200);
    const before = await roleCount();
    const replay = await create(payload, headers);
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(first.json());
    expect(await roleCount()).toBe(before);
    const audit = await cloud.pool.query(`SELECT count(*) AS n FROM config_audit WHERE tenant_id = $1 AND entity = 'role'`, [
      f.tenantId,
    ]);
    expect(Number(audit.rows[0].n)).toBe(1);
    const mismatch = await create({ ...payload, idle_minutes: 31 }, headers);
    expect(mismatch.statusCode).toBe(422);
    expect(mismatch.json().error.code).toBe('IDEMPOTENCY_KEY_MISMATCH');
  });

  it('[01b §6.5] list: 4 statements, staff_count of active holders, ?archived filter, grants and versions', async () => {
    const waiter = await roleId('waiter');
    const cashierId = await roleId('cashier');
    const hire = async (name: string) =>
      cloud.app.inject({
        method: 'POST',
        url: '/v1/admin/staff',
        ...owner(f),
        payload: { display_name: name, role_ids: [waiter], branch_ids: [f.branches[0]] },
      });
    const left = (await hire('Bilal')).json().data.staff.staff_id as string;
    await hire('Usman');
    await cloud.pool.query(`UPDATE staff SET is_active = false, left_at = $3 WHERE tenant_id = $1 AND staff_id = $2`, [
      f.tenantId,
      left,
      T,
    ]);
    await cloud.pool.query(`UPDATE roles SET archived_at = $3 WHERE tenant_id = $1 AND role_id = $2`, [
      f.tenantId,
      await roleId('cook'),
      T,
    ]);

    const active = await list();
    expect(active.statusCode).toBe(200);
    expect(counter.count).toBe(4);
    const roles = active.json().data.roles as Role[];
    expect(roles.map((row) => row.role_id)).not.toContain(await roleId('cook'));
    expect(roles.find((row) => row.role_id === waiter)).toMatchObject({ staff_count: 1, is_default: true, idle_minutes: 5 });
    const cashier = roles.find((row) => row.role_id === cashierId)!;
    expect(cashier.version).toMatch(/^[0-9a-f]{64}$/);
    expect(cashier.grants.find((grant) => grant.grant_type === 'requires_approval')?.approver_role_ids).toEqual([
      await roleId('manager'),
    ]);
    expect(roles.map((row) => row.name)).toEqual([...roles.map((row) => row.name)].sort((a, b) => a.localeCompare(b)));
    expect(active.json().data).not.toHaveProperty('can_edit_roles');

    const archived = await list('?archived=true');
    expect(counter.count).toBe(4);
    expect((archived.json().data.roles as Role[]).map((row) => row.role_id)).toEqual([await roleId('cook')]);
  });

  it('[01b #17] an owner row missing one branch: POST /roles and PATCH /roles/:id → 403 tenant_wide_write, nothing written; GET /roles → 200 with no can_edit_roles', async () => {
    const waiterId = await roleId('waiter');
    const waiter = ((await list()).json().data.roles as Role[]).find((row) => row.role_id === waiterId)!;
    await cloud.pool.query(`UPDATE owner_users SET allowed_branch_ids = $3 WHERE tenant_id = $1 AND user_id = $2`, [
      f.tenantId,
      f.userId,
      [f.branches[0], f.branches[1]],
    ]);
    const [roles, v] = [await roleCount(), await directoryVersion()];
    const refused = [
      await create({ name: 'Shift lead', idle_minutes: 30, grants: [] }),
      await cloud.app.inject({
        method: 'PATCH',
        url: `/v1/admin/roles/${waiterId}`,
        headers: { authorization: `Bearer ${f.token}` },
        payload: { expected_version: waiter.version, name: 'Bera', idle_minutes: 10 },
      }),
    ];
    for (const response of refused) {
      expect(response.statusCode, response.body).toBe(403);
      expect(response.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'tenant_wide_write' } });
    }
    expect(await roleCount()).toBe(roles);
    expect(await directoryVersion()).toBe(v);
    const audits = await cloud.pool.query(`SELECT 1 FROM config_audit WHERE tenant_id = $1 AND entity = 'role'`, [f.tenantId]);
    expect(audits.rows).toEqual([]);

    const listed = await list();
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data).not.toHaveProperty('can_edit_roles');
    expect((listed.json().data.roles as Role[]).length).toBe(roles);
    expect((listed.json().data.roles as Role[]).find((row) => row.role_id === waiterId)).toEqual(waiter);
  });

  it('[01b #18] idle_minutes 0 or 241 → 400 VALIDATION_FAILED; 1 and 240 are saved', async () => {
    const before = await roleCount();
    for (const idle_minutes of [0, 241, 1.5]) {
      const response = await create({ name: `Idle ${idle_minutes}`, idle_minutes, grants: [] });
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_FAILED');
    }
    expect(await roleCount()).toBe(before);
    for (const idle_minutes of [1, 240]) {
      const response = await create({ name: `Idle ${idle_minutes}`, idle_minutes, grants: [] });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().data.role.idle_minutes).toBe(idle_minutes);
    }
    const stored = await cloud.pool.query(`SELECT session_idle_ttl_ms FROM roles WHERE tenant_id = $1 AND name = 'Idle 240'`, [
      f.tenantId,
    ]);
    expect(Number(stored.rows[0].session_idle_ttl_ms)).toBe(14_400_000);
  });
});
