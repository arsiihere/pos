import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate';
import { fixedClock } from '../../src/lib/clock';
import { dropScratchDatabases, scratchDatabaseAt } from '../helpers/scratch-db';

// 01a v2.11 §5.2a PT-1, PT-5, test 219: a scratch database migrated to 0022 with two branches and three points, then
// the real folder (with 0023_point_order_types.sql).

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const now = 1_761_000_000_000;
let pool: pg.Pool;

beforeAll(async () => {
  ({ pool } = await scratchDatabaseAt(22));
  await pool.query("INSERT INTO tenants (tenant_id, name, currency_code, created_at) VALUES ('t', 'Pilot', 'PKR', $1)", [now]);
  await pool.query(
    `INSERT INTO branches (tenant_id, branch_id, name, status, config_version, created_at)
     VALUES ('t', 'b1', 'b1', 'pending_hub', 7, $1), ('t', 'b2', 'b2', 'pending_hub', 12, $1)`, [now],
  );
  await pool.query(
    `INSERT INTO points (tenant_id, branch_id, point_id, name, sort_order, created_at, updated_at)
     VALUES ('t', 'b1', 'p1', 'Pass', 0, $1, $1), ('t', 'b1', 'p2', 'Takeaway Pass', 1, $1, $1), ('t', 'b2', 'p3', 'Pass', 0, $1, $1)`, [now],
  );
  await migrate(pool, migrationsDir, fixedClock(now));
}, 40_000);

afterAll(dropScratchDatabases, 40_000);

describe('[01a v2.11 §5.2a PT-1, PT-5, #219] point order types migration', () => {
  it('every existing point reads order_types NULL (= all); no branch config_version changes; no config_audit row', async () => {
    expect((await pool.query('SELECT point_id, order_types FROM points ORDER BY point_id')).rows).toEqual([
      { point_id: 'p1', order_types: null }, { point_id: 'p2', order_types: null }, { point_id: 'p3', order_types: null },
    ]);
    expect((await pool.query('SELECT branch_id, config_version::int FROM branches ORDER BY branch_id')).rows).toEqual([
      { branch_id: 'b1', config_version: 7 }, { branch_id: 'b2', config_version: 12 },
    ]);
    expect((await pool.query('SELECT * FROM config_audit')).rows).toEqual([]);
  });

  it("the CHECK refuses '{}' and '{pickup}' and accepts '{takeaway,parking}'", async () => {
    for (const value of ['{}', '{pickup}', '{takeaway,pickup}']) {
      await expect(pool.query("UPDATE points SET order_types = $1 WHERE point_id = 'p2'", [value])).rejects.toMatchObject({ code: '23514' });
    }
    await pool.query("UPDATE points SET order_types = '{takeaway,parking}' WHERE point_id = 'p2'");
    expect((await pool.query("SELECT order_types FROM points WHERE point_id = 'p2'")).rows).toEqual([{ order_types: ['takeaway', 'parking'] }]);
    await pool.query("UPDATE points SET order_types = NULL WHERE point_id = 'p2'");
  });

  it('[R3-M-1, D6] cloud migration versions are unique and contiguous from 1, ending at 0023_point_order_types.sql', () => {
    const files = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
    expect(files.map((name) => Number(name.slice(0, 4)))).toEqual(files.map((_, i) => i + 1));
    expect(files.at(-1)).toBe('0023_point_order_types.sql');
  });
});
