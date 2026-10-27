import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { seedTenant } from '../../src/cli/seed-tenant';
import { SystemContext } from '../../src/cli/system-context';
import { migrate } from '../../src/db/migrate';
import { fixedClock } from '../../src/lib/clock';
import { testIdGen } from '../../src/lib/ids';
import { dropScratchDatabases, scratchDatabaseAt } from '../helpers/scratch-db';

// 01b §5.1: each test gets its own scratch database migrated to 0004 and seeded with the v1.4
// seed-tenant; then the real migrations folder (with 0005) is applied.

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const T = 1_761_000_000_000;
const clock = fixedClock(T);

afterAll(async () => {
  await dropScratchDatabases();
});

async function seedV14(pool: pg.Pool, email: string): Promise<string> {
  const { tenant_id } = await seedTenant(
    new SystemContext(pool),
    { name: 'Pilot', currency: 'PKR', ownerEmail: email, ownerName: 'Ada', password: 'password-1', pin: '1234' },
    { clock, ids: testIdGen() },
  );
  return tenant_id;
}

async function addBranch(pool: pg.Pool, tenantId: string, branchId: string, name: string): Promise<void> {
  await pool.query(
    `INSERT INTO branches (tenant_id, branch_id, name, status, created_at) VALUES ($1, $2, $3, 'pending_hub', $4)`,
    [tenantId, branchId, name, T],
  );
}

async function applied(pool: pg.Pool): Promise<number[]> {
  const { rows } = await pool.query<{ version: number }>(`SELECT version FROM schema_migrations ORDER BY version`);
  return rows.map((row) => row.version);
}

const CONSTRAINTS = [
  'branches_day_gap',
  'branches_day_settings',
  'branches_day_stale',
  'branches_name_len',
  'owner_users_temp_password',
  'role_permissions_check',
  'roles_idle',
  'roles_name_len',
  'staff_left',
  'staff_name_len',
];
const INDEXES = ['branches_name', 'owner_users_staff_once', 'roles_active_name', 'roles_default_key'];

describe('[01b §5.1] cloud migration 0005_staff_roles.sql', () => {
  it('[01b #70] commits on a v1.4-seeded database with rows at the old limits; every new constraint holds', async () => {
    const { pool } = await scratchDatabaseAt(4);
    const tenant = await seedV14(pool, 'a@example.com');
    await addBranch(pool, tenant, 'b1', 'B'.repeat(60));
    await pool.query(`UPDATE branches SET day_stale_after_hours = 72, day_min_gap_hours = 24`);
    await pool.query(`UPDATE staff SET display_name = $1 WHERE tenant_id = $2`, ['S'.repeat(40), tenant]);
    await pool.query(
      `INSERT INTO roles (tenant_id, role_id, name, session_idle_ttl_ms) VALUES ($1, 'r-forty', $2, 3600000)`,
      [tenant, 'R'.repeat(40)],
    );

    await migrate(pool, migrationsDir, clock);

    expect(await applied(pool)).toEqual([1, 2, 3, 4, 5]);
    const { rows: constraints } = await pool.query<{ conname: string; convalidated: boolean }>(
      `SELECT conname, convalidated FROM pg_constraint WHERE conname = ANY($1::text[]) ORDER BY conname`,
      [CONSTRAINTS],
    );
    expect(constraints).toEqual(CONSTRAINTS.map((conname) => ({ conname, convalidated: true })));
    const { rows: indexes } = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE indexname = ANY($1::text[]) ORDER BY indexname`,
      [INDEXES],
    );
    expect(indexes.map((row) => row.indexname)).toEqual(INDEXES);
    // The kept requires_approval ⇔ approver CHECK still refuses a grant with no approver (B22).
    const { rows: roleRows } = await pool.query<{ role_id: string }>(
      `SELECT role_id FROM roles WHERE tenant_id = $1 ORDER BY role_id LIMIT 1`,
      [tenant],
    );
    await expect(
      pool.query(
        `INSERT INTO role_permissions (tenant_id, role_id, permission, grant_type) VALUES ($1, $2, 'void-item', 'requires_approval')`,
        [tenant, roleRows[0]!.role_id],
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'role_permissions_check' });
    // The approver list is backfilled from the single approver column: Cashier's apply-discount → Manager.
    const { rows: approvers } = await pool.query<{ role: string; permission: string; approver: string }>(
      `SELECT r.name AS role, a.permission, ar.name AS approver
         FROM role_permission_approvers a
         JOIN roles r ON r.tenant_id = a.tenant_id AND r.role_id = a.role_id
         JOIN roles ar ON ar.tenant_id = a.tenant_id AND ar.role_id = a.approver_role_id
        WHERE a.tenant_id = $1 ORDER BY r.name, a.permission`,
      [tenant],
    );
    expect(approvers).toContainEqual({ role: 'Cashier', permission: 'apply-discount', approver: 'Manager' });
  });

  it('[01b #77] backfills default_key for the v1.4 default roles by name, creates no role and changes no grant', async () => {
    const { pool } = await scratchDatabaseAt(4);
    const tenant = await seedV14(pool, 'a@example.com');

    // Two active roles named "Manager" also violate roles_active_name, which the same migration creates
    // (the whole migration aborts, §5.1). So the duplicate case runs the migration only up to the backfill
    // and its check, in a transaction that is rolled back (AD-1).
    const sql = readFileSync(join(migrationsDir, '0005_staff_roles.sql'), 'utf8');
    const cut = sql.indexOf('ALTER TABLE roles ADD COLUMN archived_at');
    expect(cut).toBeGreaterThan(0);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // A second role the owner named "Manager", created later (larger ULID): it must not get the key.
      await client.query(
        `INSERT INTO roles (tenant_id, role_id, name, session_idle_ttl_ms) VALUES ($1, 'ZZZZZZZZZZZZZZZZZZZZZZZZZZ', 'Manager', 3600000)`,
        [tenant],
      );
      await client.query(sql.slice(0, cut));
      const { rows } = await client.query<{ name: string; role_id: string; default_key: string | null }>(
        `SELECT name, role_id, default_key FROM roles WHERE tenant_id = $1 ORDER BY name, role_id`,
        [tenant],
      );
      expect(rows.map((row) => `${row.name}:${row.default_key ?? '-'}`)).toEqual([
        'Cashier:cashier',
        'Manager:manager',
        'Manager:-',
        'Order taker:order_taker',
        'Owner:owner',
      ]);
      expect(rows.find((row) => row.default_key === null)!.role_id).toBe('ZZZZZZZZZZZZZZZZZZZZZZZZZZ');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }

    const grantsBefore = await pool.query(
      `SELECT tenant_id, role_id, permission, grant_type, approver_role_id FROM role_permissions ORDER BY role_id, permission`,
    );
    const rolesBefore = await pool.query(`SELECT count(*)::int AS n FROM roles`);

    await migrate(pool, migrationsDir, clock);

    const { rows } = await pool.query<{ name: string; default_key: string | null }>(
      `SELECT name, default_key FROM roles WHERE tenant_id = $1 ORDER BY name`,
      [tenant],
    );
    expect(rows.map((row) => `${row.name}:${row.default_key ?? '-'}`)).toEqual([
      'Cashier:cashier',
      'Manager:manager',
      'Order taker:order_taker',
      'Owner:owner',
    ]);
    expect((await pool.query(`SELECT count(*)::int AS n FROM roles`)).rows).toEqual(rolesBefore.rows);
    const grantsAfter = await pool.query(
      `SELECT tenant_id, role_id, permission, grant_type, approver_role_id FROM role_permissions ORDER BY role_id, permission`,
    );
    expect(grantsAfter.rows).toEqual(grantsBefore.rows);
    await expect(
      pool.query(
        `INSERT INTO roles (tenant_id, role_id, name, session_idle_ttl_ms, default_key) VALUES ($1, 'r-dup', 'Boss', 3600000, 'owner')`,
        [tenant],
      ),
    ).rejects.toMatchObject({ code: '23505', constraint: 'roles_default_key' });
  });
});
