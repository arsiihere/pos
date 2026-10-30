import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate';
import { fixedClock } from '../../src/lib/clock';
import { dropScratchDatabases, scratchDatabaseAt } from '../helpers/scratch-db';

// 01b B22, 00 §5.2: roll-forward only. A database that has a migration this build does not have
// is refused before anything is applied, and the cloud process exits before listening.

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const cloudDir = fileURLToPath(new URL('../..', import.meta.url));
const T = 1_761_000_000_000;
const clock = fixedClock(T);

afterAll(async () => {
  await dropScratchDatabases();
}, 40_000);

async function addFuture(pool: pg.Pool): Promise<void> {
  await pool.query(
    `INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (7, '0007_future.sql', 'f', $1)`,
    [T],
  );
}

async function applied(pool: pg.Pool): Promise<number[]> {
  const { rows } = await pool.query<{ version: number }>(`SELECT version FROM schema_migrations ORDER BY version`);
  return rows.map((row) => row.version);
}

async function hasLeftAt(pool: pg.Pool): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'staff' AND column_name = 'left_at'`,
  );
  return rows.length > 0;
}

describe('[01b B22] migrations runner and a database ahead of the build', () => {
  it('[01b #105] migrate() refuses a database with an unknown migration, applies nothing, and the process exits 1; without the row it applies 0005 and 0006', async () => {
    const { url, pool } = await scratchDatabaseAt(4);
    await addFuture(pool);

    const refused = migrate(pool, migrationsDir, clock);
    await expect(refused).rejects.toMatchObject({ name: 'MigrationUnknownVersionError' });
    await expect(refused).rejects.toThrow(
      'database has migration 0007 (0007_future.sql) that this build does not have: this build is older than the database; deploy the current build',
    );
    expect(await applied(pool)).toEqual([1, 2, 3, 4, 7]);
    expect(await hasLeftAt(pool)).toBe(false);

    // The cloud process (01b §4.3 row 20) exits 1 before listening, with nothing applied.
    const result = spawnSync('node_modules/.bin/tsx', ['src/main.ts'], {
      cwd: cloudDir,
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: url,
        JWT_SECRET: 'j'.repeat(32),
        REFRESH_TOKEN_SECRET: 'r'.repeat(32),
        PORT: '3001',
        HUB_MIN_VERSION: '1.0.0',
      },
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('0007_future.sql');
    expect(await applied(pool)).toEqual([1, 2, 3, 4, 7]);
    expect(await hasLeftAt(pool)).toBe(false);

    await pool.query(`DELETE FROM schema_migrations WHERE version = 7`);
    expect(await migrate(pool, migrationsDir, clock)).toEqual({ applied: ['0005_staff_roles.sql', '0006_menu_variants.sql'] });
    expect(await applied(pool)).toEqual([1, 2, 3, 4, 5, 6]);
  }, 40_000);
});
