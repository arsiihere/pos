import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate';
import { fixedClock } from '../../src/lib/clock';
import { dropScratchDatabases, scratchDatabaseAt } from '../helpers/scratch-db';

// 01b v1.7 B-3, §5.1: a scratch database migrated to 0010, seeded with grants, then the real folder (with 0011).

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const T = 1_761_000_000_000;
const TN = 't1';

let pool: pg.Pool;

const grant = (permission: string, scope: string, role = 'r1') =>
  pool.query(
    `INSERT INTO role_permissions (tenant_id, role_id, permission, grant_type, scope) VALUES ($1, $2, $3, 'allowed', $4)`,
    [TN, role, permission, scope],
  );

beforeAll(async () => {
  ({ pool } = await scratchDatabaseAt(10));
  await pool.query(`INSERT INTO tenants (tenant_id, name, currency_code, created_at) VALUES ($1, 'Pilot', 'PKR', $2)`, [TN, T]);
  await pool.query(`INSERT INTO roles (tenant_id, role_id, name, session_idle_ttl_ms) VALUES ($1, 'r1', 'Lead', 600000)`, [TN]);
  await grant('manage-stock', 'my_stations');
  await grant('take-order-anywhere', 'my_floors');
  await expect(grant('manage-zone-stock', 'my_zones')).rejects.toMatchObject({ code: '23514' });
  await migrate(pool, migrationsDir, fixedClock(T));
}, 40_000);

afterAll(async () => {
  await dropScratchDatabases();
}, 40_000);

describe('[01b B-3] cloud migration 0011_scope_my_zones.sql', () => {
  it('[02p U-4] a role_permissions row with scope my_zones inserts after the expand migration', async () => {
    await grant('manage-zone-stock', 'my_zones');
    const { rows } = await pool.query(`SELECT scope FROM role_permissions WHERE tenant_id = $1 AND permission = 'manage-zone-stock'`, [TN]);
    expect(rows).toEqual([{ scope: 'my_zones' }]);
  });

  it('[02p U-4] existing grants are kept and any other scope is still refused', async () => {
    const { rows } = await pool.query(
      `SELECT permission, scope FROM role_permissions WHERE tenant_id = $1 AND permission <> 'manage-zone-stock' ORDER BY permission`,
      [TN],
    );
    expect(rows).toEqual([
      { permission: 'manage-stock', scope: 'my_stations' },
      { permission: 'take-order-anywhere', scope: 'my_floors' },
    ]);
    await expect(grant('void-item', 'my_tables')).rejects.toMatchObject({ code: '23514' });
  });

  it('[02p U-4] the scope constraint keeps its name and the grant_type constraint is untouched', async () => {
    const { rows } = await pool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'role_permissions'::regclass AND contype = 'c' ORDER BY conname`,
    );
    expect(rows.map((r) => r.conname)).toContain('role_permissions_scope_check');
    await expect(
      pool.query(`INSERT INTO role_permissions (tenant_id, role_id, permission, grant_type, scope) VALUES ($1, 'r1', 'x', 'maybe', 'branch')`, [TN]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
