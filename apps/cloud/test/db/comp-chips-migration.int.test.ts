import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate';
import { fixedClock } from '../../src/lib/clock';
import { dropScratchDatabases, scratchDatabaseAt } from '../helpers/scratch-db';

// 01a v2.4.4 §5.2a (02b v1.0.11 §3.9; owner Q-19, Q-28): a scratch database migrated to 0012, branches holding
// "Other" in several forms, then the real folder (with 0014_comp_chips_no_other.sql).

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const T = 1_761_000_000_000;
const TN = 't1';
const NEW_DEFAULT = ['Late', 'Wrong item', 'Quality', 'Guest'];
// 0009_zones.sql as merged (sha256). A migration is never edited after merge.
const ZONES_0009_SHA256 = 'bf3ed144e64e94aeff750388ec6e3dab16064bfa30fdb521da9444cc273a39ad';

let pool: pg.Pool;
let preVersions: Record<string, number> = {};
const q = (sql: string, params: unknown[] = []) => pool.query(sql, params);

// branch → chips stored before the migration (null = the 0009 default, untouched by the test; absent = no settings row)
const SEEDED: Record<string, string[] | null> = {
  b1: null,
  b2: ['other', 'Late', 'OTHER', 'Quality'],
  b3: ['Other'],
  b4: ['Late', 'Other reason', 'Others'],
  b6: ['Guest', 'Late'],
};

beforeAll(async () => {
  ({ pool } = await scratchDatabaseAt(12));
  await q(`INSERT INTO tenants (tenant_id, name, currency_code, created_at) VALUES ($1, 'Pilot', 'PKR', $2)`, [TN, T]);
  for (const b of ['b1', 'b2', 'b3', 'b4', 'b5', 'b6']) {
    await q(`INSERT INTO branches (tenant_id, branch_id, name, status, created_at) VALUES ($1, $2, $2, 'pending_hub', $3)`, [TN, b, T]);
  }
  for (const [b, chips] of Object.entries(SEEDED)) {
    await q(`INSERT INTO branch_engine_settings (tenant_id, branch_id, created_at, updated_at) VALUES ($1, $2, $3, $3)`, [TN, b, T]);
    if (chips !== null) await q(`UPDATE branch_engine_settings SET comp_reason_chips = $3 WHERE tenant_id = $1 AND branch_id = $2`, [TN, b, chips]);
  }
  preVersions = Object.fromEntries(
    (await q(`SELECT branch_id, config_version FROM branches ORDER BY branch_id`)).rows.map((r) => [r.branch_id, Number(r.config_version)]),
  );
  await migrate(pool, migrationsDir, fixedClock(T));
}, 40_000);

afterAll(async () => {
  await dropScratchDatabases();
}, 40_000);

describe('[01a v2.4.4 §5.2a] cloud migration 0014_comp_chips_no_other.sql', () => {
  it('[01a v2.4.4] a new branch row gets Late, Wrong item, Quality, Guest', async () => {
    await q(`INSERT INTO branches (tenant_id, branch_id, name, status, created_at) VALUES ($1, 'b9', 'b9', 'pending_hub', $2)`, [TN, T]);
    await q(`INSERT INTO branch_engine_settings (tenant_id, branch_id, created_at, updated_at) VALUES ($1, 'b9', $2, $2)`, [TN, T]);
    const { rows } = await q(`SELECT comp_reason_chips FROM branch_engine_settings WHERE tenant_id = $1 AND branch_id = 'b9'`, [TN]);
    expect(rows).toEqual([{ comp_reason_chips: NEW_DEFAULT }]);
  });

  it('[01a v2.4.4 Q-28] existing rows lose every stored "Other" (any case), order kept; a row of only ["Other"] gets the new default', async () => {
    const { rows } = await q(
      `SELECT branch_id, comp_reason_chips FROM branch_engine_settings WHERE tenant_id = $1 AND branch_id <> 'b9' ORDER BY branch_id`,
      [TN],
    );
    expect(rows).toEqual([
      { branch_id: 'b1', comp_reason_chips: ['Late', 'Wrong item', 'Quality', 'Guest'] }, // the 0009 default, "Other" gone
      { branch_id: 'b2', comp_reason_chips: ['Late', 'Quality'] }, // 'other', 'OTHER' gone, order kept
      { branch_id: 'b3', comp_reason_chips: NEW_DEFAULT }, // emptied → the new default (CHECK needs 1–10)
      { branch_id: 'b4', comp_reason_chips: ['Late', 'Other reason', 'Others'] }, // only the exact text "Other" goes
      { branch_id: 'b6', comp_reason_chips: ['Guest', 'Late'] },
    ]);
  });

  it('[01a v2.4.4 Q-28] config_version +1 only for branches whose chips changed; no audit row', async () => {
    const { rows } = await q(`SELECT branch_id, config_version FROM branches WHERE tenant_id = $1 AND branch_id <> 'b9' ORDER BY branch_id`, [TN]);
    expect(rows.map((r) => [r.branch_id, Number(r.config_version)])).toEqual([
      ['b1', preVersions.b1! + 1],
      ['b2', preVersions.b2! + 1],
      ['b3', preVersions.b3! + 1],
      ['b4', preVersions.b4],
      ['b5', preVersions.b5], // no settings row
      ['b6', preVersions.b6],
    ]);
    expect((await q(`SELECT count(*)::int AS n FROM config_audit`)).rows[0]).toEqual({ n: 0 });
    // a migration is not an owner write: updated_at stays
    expect((await q(`SELECT DISTINCT updated_at::text AS u FROM branch_engine_settings WHERE branch_id <> 'b9'`)).rows).toEqual([{ u: String(T) }]);
  });

  it('[01a v2.4.4] 0009 is unchanged (file hash pinned)', async () => {
    const path = fileURLToPath(new URL('0009_zones.sql', `file://${migrationsDir}/`));
    expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(ZONES_0009_SHA256);
    const { rows } = await q(`SELECT version, name, checksum FROM schema_migrations WHERE version IN (9, 14) ORDER BY version`);
    expect(rows).toEqual([
      { version: 9, name: '0009_zones.sql', checksum: ZONES_0009_SHA256 },
      { version: 14, name: '0014_comp_chips_no_other.sql', checksum: expect.any(String) },
    ]);
  });
});
