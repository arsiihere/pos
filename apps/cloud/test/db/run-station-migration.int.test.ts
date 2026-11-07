import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate';
import { fixedClock } from '../../src/lib/clock';
import { dropScratchDatabases, scratchDatabaseAt } from '../helpers/scratch-db';

// 01b v1.5 B-4, §5.1: a scratch database migrated to 0007, seeded with count_stock rows, then the real folder (with 0008).

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const T = 1_761_000_000_000;
const TN = 't1';

let pool: pg.Pool;

const SEEDED = [
  ['b1', 'count_stock', 'grill-b1', 'role', 'r-cook'],
  ['b1', 'count_stock', 'grill-b1', 'staff', 's-ali'],
  ['b1', 'count_stock', 'old-b1', 'staff', 's-ali'],
  ['b2', 'count_stock', 'grill-b2', 'staff', 's-bilal'],
];

async function rows(): Promise<string[][]> {
  const result = await pool.query<{ branch_id: string; responsibility: string; station_id: string; subject_kind: string; subject_id: string }>(
    `SELECT branch_id, responsibility, station_id, subject_kind, subject_id FROM responsibilities WHERE tenant_id = $1
      ORDER BY branch_id, responsibility, station_id, subject_kind, subject_id`,
    [TN],
  );
  return result.rows.map((row) => [row.branch_id, row.responsibility, row.station_id, row.subject_kind, row.subject_id]);
}

const insert = (responsibility: string, subjectId: string) =>
  pool.query(
    `INSERT INTO responsibilities (tenant_id, branch_id, responsibility, station_id, subject_kind, subject_id)
     VALUES ($1, 'b1', $2, 'grill-b1', 'staff', $3)`,
    [TN, responsibility, subjectId],
  );

beforeAll(async () => {
  ({ pool } = await scratchDatabaseAt(7));
  await pool.query(`INSERT INTO tenants (tenant_id, name, currency_code, created_at) VALUES ($1, 'Pilot', 'PKR', $2)`, [TN, T]);
  for (const [branch, responsibility, stationId, kind, subject] of SEEDED) {
    await pool.query(
      `INSERT INTO responsibilities (tenant_id, branch_id, responsibility, station_id, subject_kind, subject_id) VALUES ($1, $2, $3, $4, $5, $6)`,
      [TN, branch, responsibility, stationId, kind, subject],
    );
  }
  await expect(insert('run_station', 's-pre')).rejects.toMatchObject({ code: '23514' });
  await migrate(pool, migrationsDir, fixedClock(T));
}, 40_000);

afterAll(async () => {
  await dropScratchDatabases();
}, 40_000);

describe('[01b B-4] cloud migration 0008_run_station.sql', () => {
  it('[01b B-4] every existing responsibility row is kept unchanged', async () => {
    expect(await rows()).toEqual(SEEDED);
  });

  it('[01b B-4] the CHECK accepts run_station beside count_stock and still refuses any other kind', async () => {
    await insert('run_station', 's-ali');
    await insert('count_stock', 's-new');
    await expect(insert('cook', 's-ali')).rejects.toMatchObject({ code: '23514' });
    expect((await rows()).filter((row) => row[4] === 's-ali' && row[2] === 'grill-b1').map((row) => row[1])).toEqual([
      'count_stock',
      'run_station',
    ]);
  });

  it('[01b B-4] the responsibilities_subject index is kept', async () => {
    const { rows: indexes } = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'responsibilities' ORDER BY indexname`,
    );
    expect(indexes.map((row) => row.indexname)).toEqual(['responsibilities_pkey', 'responsibilities_subject']);
  });
});
