import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, migrate } from '../src/db/migrate';
import { fixedClock } from '../src/lib/clock';
import { truncateAll } from './helpers/test-cloud';

const migrationsDir = fileURLToPath(new URL('../src/db/migrations', import.meta.url));
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://pos:pos@127.0.0.1:5433/pos_test';
const T = 1_761_000_000_000;

describe('cloud schema', () => {
  const pool = createPool(databaseUrl);
  const dirs: string[] = [];
  beforeAll(async () => {
    await migrate(pool, migrationsDir, fixedClock(T));
  });
  afterAll(async () => {
    await pool.end();
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it('[00 §5.2] all tables exist and idempotency_keys does not', async () => {
    const rows = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const names = rows.rows.map((row) => row.table_name);
    expect(names).toEqual([
      'branch_api_keys',
      'branches',
      'owner_refresh_tokens',
      'owner_users',
      'registration_codes',
      'role_permissions',
      'roles',
      'schema_migrations',
      'staff',
      'staff_branches',
      'staff_permission_denials',
      'staff_roles',
      'tenants',
    ]);
    expect(names).not.toContain('idempotency_keys');
  });

  it('[00 §5.2] one live key per branch', async () => {
    await truncateAll(pool);
    await pool.query(
      `INSERT INTO tenants (tenant_id, name, currency_code, created_at) VALUES ('t1', 'T', 'PKR', $1)`,
      [T],
    );
    await pool.query(
      `INSERT INTO branches (tenant_id, branch_id, name, status, created_at) VALUES ('t1', 'b1', 'B', 'pending_hub', $1)`,
      [T],
    );
    await pool.query(
      `INSERT INTO branch_api_keys (tenant_id, branch_id, key_id, key_hash, created_at) VALUES ('t1', 'b1', 'k1', 'hash-1', $1)`,
      [T],
    );
    await expect(
      pool.query(
        `INSERT INTO branch_api_keys (tenant_id, branch_id, key_id, key_hash, created_at) VALUES ('t1', 'b1', 'k2', 'hash-2', $1)`,
        [T],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await pool.query(`UPDATE branch_api_keys SET revoked_at = $1 WHERE key_id = 'k1'`, [T]);
    await pool.query(
      `INSERT INTO branch_api_keys (tenant_id, branch_id, key_id, key_hash, created_at) VALUES ('t1', 'b1', 'k2', 'hash-2', $1)`,
      [T],
    );
  });

  it('[00 §5.2] requires_approval needs an approver', async () => {
    await truncateAll(pool);
    await pool.query(
      `INSERT INTO tenants (tenant_id, name, currency_code, created_at) VALUES ('t1', 'T', 'PKR', $1)`,
      [T],
    );
    await pool.query(
      `INSERT INTO roles (tenant_id, role_id, name, session_idle_ttl_ms) VALUES ('t1', 'r1', 'Manager', 3600000)`,
    );
    await expect(
      pool.query(
        `INSERT INTO role_permissions (tenant_id, role_id, permission, grant_type) VALUES ('t1', 'r1', 'manage-devices', 'requires_approval')`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await pool.query(
      `INSERT INTO role_permissions (tenant_id, role_id, permission, grant_type, approver_role_id) VALUES ('t1', 'r1', 'manage-devices', 'requires_approval', 'r1')`,
    );
  });

  it("[00 §5.2] status 'active' requires hub_confirmed_at", async () => {
    await truncateAll(pool);
    await pool.query(
      `INSERT INTO tenants (tenant_id, name, currency_code, created_at) VALUES ('t1', 'T', 'PKR', $1)`,
      [T],
    );
    await expect(
      pool.query(
        `INSERT INTO branches (tenant_id, branch_id, name, status, created_at) VALUES ('t1', 'b1', 'B', 'active', $1)`,
        [T],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await pool.query(
      `INSERT INTO branches (tenant_id, branch_id, name, status, hub_confirmed_at, created_at) VALUES ('t1', 'b1', 'B', 'active', $1, $1)`,
      [T],
    );
  });

  it('[00 §5.2] roles has no is_admin_role', async () => {
    const rows = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'roles'`,
    );
    expect(rows.rows.map((row) => row.column_name)).not.toContain('is_admin_role');
  });

  it('[00 §5.2] checksum change → migrate throws', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pos-cloud-mig-'));
    dirs.push(dir);
    cpSync(migrationsDir, dir, { recursive: true });
    const fresh = createPool(databaseUrl);
    await migrate(fresh, dir, fixedClock(T));
    writeFileSync(join(dir, '0001_platform.sql'), '-- changed\n');
    await expect(migrate(fresh, dir, fixedClock(T))).rejects.toThrow(/checksum/);
    await fresh.end();
  });
});
