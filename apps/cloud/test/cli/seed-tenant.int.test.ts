import { verify } from '@node-rs/argon2';
import { PERMISSIONS } from '@pos/domain';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemContext } from '../../src/cli/system-context';
import { seedTenant } from '../../src/cli/seed-tenant';
import { createPool, migrate } from '../../src/db/migrate';
import { fixedClock } from '../../src/lib/clock';
import { testIdGen } from '../../src/lib/ids';
import { toRoleWire } from '../../src/modules/staff-roles/versions';
import { createTestCloud, truncateAll } from '../helpers/test-cloud';

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://pos:pos@127.0.0.1:5433/pos_test';
const T = 1_761_000_000_000;

describe('seed-tenant', () => {
  const pool = createPool(databaseUrl);

  beforeAll(async () => {
    await migrate(pool, migrationsDir, fixedClock(T));
    await truncateAll(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('[00 §10 #56, 03b #60] seed creates the roles; password and PIN hashes verify; the owner staff holds access-hub-admin and manage-devices; duplicate email refused', async () => {
    const created = await seedTenant(
      new SystemContext(pool),
      {
        name: 'Pilot',
        currency: 'PKR',
        ownerEmail: 'Owner@Example.com',
        ownerName: 'Ada',
        password: 'password-1',
        pin: '1234',
      },
      { clock: fixedClock(T), ids: testIdGen() },
    );

    expect(created).toEqual({
      tenant_id: expect.any(String),
      user_id: expect.any(String),
      staff_id: expect.any(String),
    });

    const roles = await pool.query<{ name: string; session_idle_ttl_ms: number }>(
      `SELECT name, session_idle_ttl_ms FROM roles WHERE tenant_id = $1 ORDER BY name`,
      [created.tenant_id],
    );
    // 01b §6.15 (00 v1.5 M29): six default roles
    expect(roles.rows).toEqual([
      { name: 'Cashier', session_idle_ttl_ms: 900_000 },
      { name: 'Cook', session_idle_ttl_ms: 300_000 },
      { name: 'Manager', session_idle_ttl_ms: 3_600_000 },
      { name: 'Order taker', session_idle_ttl_ms: 900_000 },
      { name: 'Owner', session_idle_ttl_ms: 3_600_000 },
      { name: 'Waiter', session_idle_ttl_ms: 300_000 },
    ]);

    const grants = await pool.query<{
      role: string;
      permission: string | null;
      grant_type: string | null;
      approver: string | null;
    }>(
      `SELECT r.name AS role, rp.permission, rp.grant_type, approver.name AS approver
         FROM roles r
         LEFT JOIN role_permissions rp ON rp.tenant_id = r.tenant_id AND rp.role_id = r.role_id
         LEFT JOIN roles approver ON approver.tenant_id = rp.tenant_id AND approver.role_id = rp.approver_role_id
        WHERE r.tenant_id = $1`,
      [created.tenant_id],
    );
    const byRole = new Map<string, Array<{ permission: string; grant_type: string; approver: string | null }>>();
    for (const row of grants.rows) {
      const list = byRole.get(row.role) ?? [];
      if (row.permission !== null && row.grant_type !== null) {
        list.push({ permission: row.permission, grant_type: row.grant_type, approver: row.approver });
      }
      byRole.set(row.role, list);
    }
    const ownerGrants = byRole.get('Owner') ?? [];
    expect(ownerGrants.map((grant) => grant.permission).sort()).toEqual([...PERMISSIONS].sort());
    expect(ownerGrants.every((grant) => grant.grant_type === 'allowed' && grant.approver === null)).toBe(true);
    expect(ownerGrants.some((grant) => grant.permission === 'access-hub-admin')).toBe(true);
    expect(ownerGrants.some((grant) => grant.permission === 'manage-devices')).toBe(true);
    const managerGrants = byRole.get('Manager') ?? [];
    expect(managerGrants.map((grant) => grant.permission).sort()).toEqual(
      PERMISSIONS.filter((permission) => permission !== 'manage-roles').sort(),
    );
    expect(managerGrants.every((grant) => grant.grant_type === 'allowed')).toBe(true);
    expect((byRole.get('Cashier') ?? []).slice().sort((a, b) => a.permission.localeCompare(b.permission))).toEqual([
      { permission: 'apply-comp', grant_type: 'requires_approval', approver: 'Manager' },
      { permission: 'apply-discount', grant_type: 'requires_approval', approver: 'Manager' },
      { permission: 'clean-table', grant_type: 'allowed', approver: null },
      { permission: 'move-item-to-stock', grant_type: 'allowed', approver: null }, // 04 B-1 (01b v1.9)
      { permission: 'reprint-ticket', grant_type: 'allowed', approver: null },
      { permission: 'set-line-weight', grant_type: 'allowed', approver: null },
      { permission: 'take-order', grant_type: 'allowed', approver: null },
      { permission: 'view-customer-contact', grant_type: 'allowed', approver: null },
      { permission: 'void-item', grant_type: 'requires_approval', approver: 'Manager' }, // 04 B-1 (01b v1.9)
    ]);
    expect((byRole.get('Order taker') ?? []).map((grant) => grant.permission).sort()).toEqual([
      'apply-comp', 'boost-order', 'clean-table', 'mark-item-returned', 'mark-served', 'move-item-to-stock', 'take-order', 'view-customer-contact',
      'void-item', // 04 B-1 (01b v1.9)
    ]);
    expect((byRole.get('Waiter') ?? []).map((grant) => grant.permission).sort()).toEqual(['clean-table', 'mark-served']);
    // 03b B-1 (01b v1.8), #60: Cook gets run-pass and reprint-ticket (was: no permissions, M29 / B17).
    expect((byRole.get('Cook') ?? []).slice().sort((a, b) => a.permission.localeCompare(b.permission))).toEqual([
      { permission: 'reprint-ticket', grant_type: 'allowed', approver: null },
      { permission: 'run-pass', grant_type: 'allowed', approver: null },
    ]);
    expect(ownerGrants.some((grant) => grant.permission === 'run-pass')).toBe(true);
    expect(managerGrants.some((grant) => grant.permission === 'run-pass')).toBe(true);

    const owner = await pool.query<{ password_hash: string; allowed_branch_ids: string[] }>(
      `SELECT password_hash, allowed_branch_ids FROM owner_users WHERE tenant_id = $1 AND user_id = $2`,
      [created.tenant_id, created.user_id],
    );
    expect(await verify(owner.rows[0]!.password_hash, 'password-1')).toBe(true);
    expect(await verify(owner.rows[0]!.password_hash, 'password-2')).toBe(false);
    expect(owner.rows[0]!.allowed_branch_ids).toEqual([]);

    const staff = await pool.query<{ pin_hash: string; display_name: string }>(
      `SELECT s.pin_hash, s.display_name
         FROM staff s
         JOIN staff_roles sr ON sr.tenant_id = s.tenant_id AND sr.staff_id = s.staff_id
         JOIN roles r ON r.tenant_id = sr.tenant_id AND r.role_id = sr.role_id
        WHERE s.tenant_id = $1 AND s.staff_id = $2 AND r.name = 'Owner'`,
      [created.tenant_id, created.staff_id],
    );
    expect(staff.rows).toHaveLength(1);
    expect(staff.rows[0]!.display_name).toBe('Ada');
    expect(await verify(staff.rows[0]!.pin_hash, '1234')).toBe(true);
    expect(await verify(staff.rows[0]!.pin_hash, '123')).toBe(false);

    const cloud = await createTestCloud();
    const httpLogin = await cloud.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'Owner@Example.com', password: 'password-1' },
    });
    expect(httpLogin.statusCode).toBe(200);
    expect(httpLogin.json().data.user).toEqual({
      user_id: created.user_id,
      display_name: 'Ada',
      tenant_id: created.tenant_id,
      allowed_branch_ids: [],
      must_change_password: false, // 01b §6.13
    });
    await cloud.close();

    await expect(
      seedTenant(
        new SystemContext(pool),
        {
          name: 'Other',
          currency: 'PKR',
          ownerEmail: 'owner@example.com',
          ownerName: 'Bea',
          password: 'password-1',
          pin: '1234',
        },
        { clock: fixedClock(T), ids: testIdGen() },
      ),
    ).rejects.toThrow(/email/);
  });

  it('[01b #20] six default roles by default_key; distinct Order taker and Waiter; one staff row can hold both;owner staff linked; a rename keeps the key', async () => {
    await truncateAll(pool);
    const created = await seedTenant(
      new SystemContext(pool),
      { name: 'Pilot', currency: 'PKR', ownerEmail: 'ada@example.com', ownerName: 'Ada', password: 'password-1', pin: '1234' },
      { clock: fixedClock(T), ids: testIdGen() },
    );
    const roles = await pool.query<{
      role_id: string;
      default_key: string;
      session_idle_ttl_ms: number;
      archived_at: string | null;
      name: string;
    }>(`SELECT role_id, default_key, session_idle_ttl_ms, archived_at, name FROM roles WHERE tenant_id = $1`, [created.tenant_id]);
    const byKey = new Map(roles.rows.map((row) => [row.default_key, row]));
    expect([...byKey.keys()].sort()).toEqual(['cashier', 'cook', 'manager', 'order_taker', 'owner', 'waiter']);
    expect(Object.fromEntries([...byKey].map(([key, row]) => [key, row.session_idle_ttl_ms / 60_000]))).toEqual({
      owner: 60,
      manager: 60,
      cashier: 15,
      order_taker: 15,
      waiter: 5,
      cook: 5,
    });
    const roleId = (key: string) => byKey.get(key)!.role_id;
    expect(roleId('order_taker')).not.toBe(roleId('waiter'));
    // all is_default on the wire
    for (const row of roles.rows) {
      expect(
        toRoleWire({ ...row, archived_at: null, staff_count: 0, grants: [] }).is_default,
        row.default_key,
      ).toBe(true);
    }

    const grants = await pool.query<{ role_id: string; permission: string; grant_type: string; scope: string; approver_role_id: string | null }>(
      `SELECT role_id, permission, grant_type, scope, approver_role_id FROM role_permissions WHERE tenant_id = $1`,
      [created.tenant_id],
    );
    const of = (key: string) => grants.rows.filter((row) => row.role_id === roleId(key));
    expect(of('owner').map((row) => row.permission).sort()).toEqual([...PERMISSIONS].sort());
    expect(of('owner').every((row) => row.grant_type === 'allowed' && row.scope === 'branch')).toBe(true);
    expect(of('manager').map((row) => row.permission).sort()).toEqual(PERMISSIONS.filter((p) => p !== 'manage-roles').sort());
    expect(of('cashier').map(({ permission, grant_type, approver_role_id }) => ({ permission, grant_type, approver_role_id })).sort((a, b) => a.permission.localeCompare(b.permission))).toEqual([
      { permission: 'apply-comp', grant_type: 'requires_approval', approver_role_id: roleId('manager') },
      { permission: 'apply-discount', grant_type: 'requires_approval', approver_role_id: roleId('manager') },
      { permission: 'clean-table', grant_type: 'allowed', approver_role_id: null },
      { permission: 'move-item-to-stock', grant_type: 'allowed', approver_role_id: null }, // 04 B-1 (01b v1.9)
      { permission: 'reprint-ticket', grant_type: 'allowed', approver_role_id: null },
      { permission: 'set-line-weight', grant_type: 'allowed', approver_role_id: null },
      { permission: 'take-order', grant_type: 'allowed', approver_role_id: null },
      { permission: 'view-customer-contact', grant_type: 'allowed', approver_role_id: null },
      { permission: 'void-item', grant_type: 'requires_approval', approver_role_id: roleId('manager') }, // 04 B-1 (01b v1.9)
    ]);
    // 01b v1.5/v1.7 §6.15: the seeded grants; scope `branch` except the Order taker's view-customer-contact (`own_tables`).
    const seeded = (key: string) => of(key).map(({ permission, grant_type, scope }) => ({ permission, grant_type, scope })).sort((a, b) => a.permission.localeCompare(b.permission));
    expect(seeded('order_taker')).toEqual([
      { permission: 'apply-comp', grant_type: 'requires_approval', scope: 'branch' },
      { permission: 'boost-order', grant_type: 'allowed', scope: 'branch' },
      { permission: 'clean-table', grant_type: 'allowed', scope: 'branch' },
      { permission: 'mark-item-returned', grant_type: 'allowed', scope: 'branch' },
      { permission: 'mark-served', grant_type: 'allowed', scope: 'branch' },
      { permission: 'move-item-to-stock', grant_type: 'allowed', scope: 'branch' }, // 04 B-1 (01b v1.9)
      { permission: 'take-order', grant_type: 'allowed', scope: 'branch' },
      { permission: 'view-customer-contact', grant_type: 'allowed', scope: 'own_tables' },
      { permission: 'void-item', grant_type: 'requires_approval', scope: 'branch' }, // 04 B-1 (01b v1.9)
    ]);
    expect(seeded('waiter')).toEqual([
      { permission: 'clean-table', grant_type: 'allowed', scope: 'branch' },
      { permission: 'mark-served', grant_type: 'allowed', scope: 'branch' },
    ]);
    // 03b B-1 (01b v1.8), #60: Cook seeded with run-pass and reprint-ticket by default_key.
    expect(of('cook').map(({ permission, grant_type, scope }) => ({ permission, grant_type, scope })).sort((a, b) => a.permission.localeCompare(b.permission))).toEqual([
      { permission: 'reprint-ticket', grant_type: 'allowed', scope: 'branch' },
      { permission: 'run-pass', grant_type: 'allowed', scope: 'branch' },
    ]);
    const approvers = await pool.query(
      `SELECT role_id, permission, approver_role_id FROM role_permission_approvers WHERE tenant_id = $1`,
      [created.tenant_id],
    );
    const approverKey = (row: { role_id: string; permission: string }) => `${row.role_id}/${row.permission}`;
    expect([...approvers.rows].sort((a, b) => approverKey(a).localeCompare(approverKey(b)))).toEqual(
      [
        { role_id: roleId('cashier'), permission: 'apply-comp', approver_role_id: roleId('manager') },
        { role_id: roleId('cashier'), permission: 'apply-discount', approver_role_id: roleId('manager') },
        { role_id: roleId('order_taker'), permission: 'apply-comp', approver_role_id: roleId('manager') },
        // 04 B-1 (01b v1.9)
        { role_id: roleId('cashier'), permission: 'void-item', approver_role_id: roleId('manager') },
        { role_id: roleId('order_taker'), permission: 'void-item', approver_role_id: roleId('manager') },
      ].sort((a, b) => approverKey(a).localeCompare(approverKey(b))),
    );

    const owner = await pool.query<{ staff_id: string }>(`SELECT staff_id FROM owner_users WHERE tenant_id = $1 AND user_id = $2`, [
      created.tenant_id,
      created.user_id,
    ]);
    expect(owner.rows[0]!.staff_id).toBe(created.staff_id);
    const ownerRoles = await pool.query(`SELECT role_id FROM staff_roles WHERE tenant_id = $1 AND staff_id = $2`, [
      created.tenant_id,
      created.staff_id,
    ]);
    expect(ownerRoles.rows).toEqual([{ role_id: roleId('owner') }]);

    // the seeded Order taker and Waiter roles can both be held by one staff row; the union itself is proved by
    // [01b #20 cloud half] (load-directory) and [01b #20 hub half] (apply-directory)
    await pool.query(
      `INSERT INTO staff (tenant_id, staff_id, display_name, pin_hash, pin_set_at, created_at, updated_at)
       VALUES ($1, 'S_BOTH', 'Usman', 'h', $2, $2, $2)`,
      [created.tenant_id, T],
    );
    await pool.query(`INSERT INTO staff_roles (tenant_id, staff_id, role_id) VALUES ($1, 'S_BOTH', $2), ($1, 'S_BOTH', $3)`, [
      created.tenant_id,
      roleId('order_taker'),
      roleId('waiter'),
    ]);
    const both = await pool.query(`SELECT role_id FROM staff_roles WHERE tenant_id = $1 AND staff_id = 'S_BOTH' ORDER BY role_id`, [
      created.tenant_id,
    ]);
    expect(both.rows.map((row) => row.role_id)).toEqual([roleId('order_taker'), roleId('waiter')].sort());

    await pool.query(`UPDATE roles SET name = 'Bera' WHERE tenant_id = $1 AND role_id = $2`, [created.tenant_id, roleId('waiter')]);
    const renamed = await pool.query(`SELECT default_key FROM roles WHERE tenant_id = $1 AND role_id = $2`, [
      created.tenant_id,
      roleId('waiter'),
    ]);
    expect(renamed.rows[0]).toEqual({ default_key: 'waiter' });
  });

  it('[04 #32 seed half, 01b #108] seed-tenant: Cashier and Order taker get void-item requires_approval by Manager (approver row) and move-item-to-stock allowed, scope branch', async () => {
    await truncateAll(pool);
    const created = await seedTenant(
      new SystemContext(pool),
      { name: 'Pilot', currency: 'PKR', ownerEmail: 'ada@example.com', ownerName: 'Ada', password: 'password-1', pin: '1234' },
      { clock: fixedClock(T), ids: testIdGen() },
    );
    const rows = await pool.query<{ role: string; permission: string; grant_type: string; scope: string; approver: string | null; approvers: string[] }>(
      `SELECT r.default_key AS role, rp.permission, rp.grant_type, rp.scope, dual.default_key AS approver,
              COALESCE(array_agg(a.default_key ORDER BY a.default_key) FILTER (WHERE a.default_key IS NOT NULL), '{}') AS approvers
         FROM role_permissions rp
         JOIN roles r ON r.tenant_id = rp.tenant_id AND r.role_id = rp.role_id
         LEFT JOIN roles dual ON dual.tenant_id = rp.tenant_id AND dual.role_id = rp.approver_role_id
         LEFT JOIN role_permission_approvers rpa
                ON rpa.tenant_id = rp.tenant_id AND rpa.role_id = rp.role_id AND rpa.permission = rp.permission
         LEFT JOIN roles a ON a.tenant_id = rpa.tenant_id AND a.role_id = rpa.approver_role_id
        WHERE rp.tenant_id = $1 AND rp.permission IN ('void-item', 'move-item-to-stock')
        GROUP BY r.default_key, rp.permission, rp.grant_type, rp.scope, dual.default_key
        ORDER BY r.default_key, rp.permission`,
      [created.tenant_id],
    );
    const pick = (role: string) => rows.rows.filter((row) => row.role === role).map(({ permission, grant_type, scope, approver, approvers }) => ({ permission, grant_type, scope, approver, approvers }));
    for (const role of ['cashier', 'order_taker']) {
      expect(pick(role), role).toEqual([
        { permission: 'move-item-to-stock', grant_type: 'allowed', scope: 'branch', approver: null, approvers: [] },
        { permission: 'void-item', grant_type: 'requires_approval', scope: 'branch', approver: 'manager', approvers: ['manager'] },
      ]);
    }
    // Owner and Manager unchanged: both allowed, no approvers; Waiter and Cook hold neither.
    for (const role of ['manager', 'owner']) {
      expect(pick(role), role).toEqual([
        { permission: 'move-item-to-stock', grant_type: 'allowed', scope: 'branch', approver: null, approvers: [] },
        { permission: 'void-item', grant_type: 'allowed', scope: 'branch', approver: null, approvers: [] },
      ]);
    }
    expect(pick('waiter')).toEqual([]);
    expect(pick('cook')).toEqual([]);
  });

  it('[01b §6.15] seed-tenant.ts contains no default role name; it looks roles up by default_key', () => {
    const source = readFileSync(fileURLToPath(new URL('../../src/cli/seed-tenant.ts', import.meta.url)), 'utf8');
    for (const name of ['Owner', 'Manager', 'Cashier', 'Order taker', 'Waiter', 'Cook']) {
      expect(source, name).not.toMatch(new RegExp(`['"]${name}['"]`));
    }
    expect(source).toMatch(/default_key/);
  });
});
