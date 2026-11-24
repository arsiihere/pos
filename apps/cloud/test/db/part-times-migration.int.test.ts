import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate';
import { fixedClock } from '../../src/lib/clock';
import { dropScratchDatabases, scratchDatabaseAt } from '../helpers/scratch-db';

// 01a v2.7.3 §5.2a rows PT-1 (STAB-5; 05 v1.0.33 §3.16): a scratch database migrated to 0015 with two branches, then
// the real folder (with 0016_part_times.sql).

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const T = 1_761_000_000_000;
const TN = 't1';

let pool: pg.Pool;
let preVersions: Record<string, number> = {};
const q = (sql: string, params: unknown[] = []) => pool.query(sql, params);

beforeAll(async () => {
  ({ pool } = await scratchDatabaseAt(15));
  await q(`INSERT INTO tenants (tenant_id, name, currency_code, created_at) VALUES ($1, 'Pilot', 'PKR', $2)`, [TN, T]);
  for (const b of ['b1', 'b2']) {
    await q(`INSERT INTO branches (tenant_id, branch_id, name, status, created_at) VALUES ($1, $2, $2, 'pending_hub', $3)`, [TN, b, T]);
  }
  await q(
    `INSERT INTO branch_engine_settings (tenant_id, branch_id, created_at, updated_at)
     SELECT tenant_id, branch_id, $2, $2 FROM branches WHERE tenant_id = $1 ON CONFLICT DO NOTHING`,
    [TN, T],
  );
  // a branch without an engine-settings row: 0016 leaves its config_version alone
  await q(`INSERT INTO branches (tenant_id, branch_id, name, status, created_at) VALUES ($1, 'b0', 'b0', 'pending_hub', $2)`, [TN, T]);
  preVersions = Object.fromEntries((await q(`SELECT branch_id, config_version FROM branches ORDER BY branch_id`)).rows.map((r) => [r.branch_id, Number(r.config_version)]));
  await migrate(pool, migrationsDir, fixedClock(T));
}, 40_000);

afterAll(async () => {
  await dropScratchDatabases();
}, 40_000);

describe('[01a v2.7.3 §5.2a, #201] cloud migration 0016_part_times.sql (STAB-5)', () => {
  it('[01a #201] existing rows get show_part_times_to_customers = true; no audit row', async () => {
    const { rows } = await q(`SELECT branch_id, show_part_times_to_customers FROM branch_engine_settings ORDER BY branch_id`);
    expect(rows).toEqual([
      { branch_id: 'b1', show_part_times_to_customers: true },
      { branch_id: 'b2', show_part_times_to_customers: true },
    ]);
    expect((await q(`SELECT count(*)::int AS n FROM config_audit`)).rows[0]).toEqual({ n: 0 });
  });

  it('[01a #201; AD-9] 0016 bumps config_version for every branch with an engine-settings row, only those', async () => {
    const { rows } = await q(`SELECT branch_id, config_version FROM branches WHERE branch_id IN ('b0', 'b1', 'b2') ORDER BY branch_id`);
    expect(rows.map((r) => [r.branch_id, Number(r.config_version)])).toEqual([
      // ⚠️ 01a v2.7.5 MD-3 (STAB-7): the whole folder runs, so 0017_max_delay.sql bumps every branch once more
      // 0019 (08b A-6) and 0021 (01a v2.11 MG-1) each bump every branch.
      ['b0', preVersions.b0! + 3],
      ['b1', preVersions.b1! + 4],
      ['b2', preVersions.b2! + 4],
    ]);
  });
});
