import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate';
import { fixedClock } from '../../src/lib/clock';
import { dropScratchDatabases, scratchDatabaseAt } from '../helpers/scratch-db';

// 01a v2.7.5 §5.2a rows MD-1–MD-3 (STAB-7; 03a v1.2.10 §3.5.7 PR-1): a scratch database migrated to 0016 with two
// branches (settings rows) and items, plus a branch without a settings row, then the real folder (with
// 0017_max_delay.sql).

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const T = 1_761_000_000_000;
const TN = 't1';

let pool: pg.Pool;
let preVersions: Record<string, number> = {};
const q = (sql: string, params: unknown[] = []) => pool.query(sql, params);

beforeAll(async () => {
  ({ pool } = await scratchDatabaseAt(16));
  await q(`INSERT INTO tenants (tenant_id, name, currency_code, created_at) VALUES ($1, 'Pilot', 'PKR', $2)`, [TN, T]);
  for (const b of ['b1', 'b2']) {
    await q(`INSERT INTO branches (tenant_id, branch_id, name, status, created_at) VALUES ($1, $2, $2, 'pending_hub', $3)`, [TN, b, T]);
  }
  await q(
    `INSERT INTO branch_engine_settings (tenant_id, branch_id, created_at, updated_at)
     SELECT tenant_id, branch_id, $2, $2 FROM branches WHERE tenant_id = $1 ON CONFLICT DO NOTHING`,
    [TN, T],
  );
  // a branch without an engine-settings row: the item columns are tenant-wide, so 0017 bumps it too (MD-3)
  await q(`INSERT INTO branches (tenant_id, branch_id, name, status, created_at) VALUES ($1, 'b0', 'b0', 'pending_hub', $2)`, [TN, T]);
  await q(`INSERT INTO categories (tenant_id, category_id, name, created_at, updated_at) VALUES ($1, 'c1', 'Mains', $2, $2)`, [TN, T]);
  for (const [id, name] of [['i1', 'Karahi'], ['i2', 'Naan']]) {
    await q(
      `INSERT INTO menu_items (tenant_id, item_id, category_id, name, price_minor, serve_mode, cook_time_ms, created_at, updated_at)
       VALUES ($1, $2, 'c1', $3, 500, 'immediate', 600000, $4, $4)`,
      [TN, id, name, T],
    );
  }
  preVersions = Object.fromEntries((await q(`SELECT branch_id, config_version FROM branches ORDER BY branch_id`)).rows.map((r) => [r.branch_id, Number(r.config_version)]));
  await migrate(pool, migrationsDir, fixedClock(T));
}, 40_000);

afterAll(async () => {
  await dropScratchDatabases();
}, 40_000);

async function refused(sql: string, params: unknown[] = []): Promise<void> {
  await expect(q(sql, params)).rejects.toMatchObject({ code: '23514' });
}

describe('[01a v2.7.5 §5.2a, #202] cloud migration 0017_max_delay.sql (STAB-7)', () => {
  it('[01a #202 MD-1, MD-2] existing items get max_delay_ms null / max_delay_unlimited false; settings rows 300 000; no audit row', async () => {
    const items = await q(`SELECT item_id, max_delay_ms, max_delay_unlimited FROM menu_items ORDER BY item_id`);
    expect(items.rows).toEqual([
      { item_id: 'i1', max_delay_ms: null, max_delay_unlimited: false },
      { item_id: 'i2', max_delay_ms: null, max_delay_unlimited: false },
    ]);
    const settings = await q(`SELECT branch_id, max_delay_default_ms FROM branch_engine_settings ORDER BY branch_id`);
    expect(settings.rows).toEqual([
      { branch_id: 'b1', max_delay_default_ms: 300_000 },
      { branch_id: 'b2', max_delay_default_ms: 300_000 },
    ]);
    expect((await q(`SELECT count(*)::int AS n FROM config_audit`)).rows[0]).toEqual({ n: 0 });
  });

  it('[01a #202 MD-3; AD-9] 0017 bumps config_version of every branch, the one without a settings row included', async () => {
    const { rows } = await q(`SELECT branch_id, config_version FROM branches ORDER BY branch_id`);
    expect(rows.map((r) => [r.branch_id, Number(r.config_version)])).toEqual([
      // 0019 (08b A-6) and 0021 (01a v2.11 MG-1) each bump every branch.
      ['b0', preVersions.b0! + 3],
      ['b1', preVersions.b1! + 3],
      ['b2', preVersions.b2! + 3],
    ]);
  });

  it('[01a #202 MD-1; re-review F-1] the item CHECKs: 60 000 and 1 800 000 accepted; 0, 59 999, 1 800 001 and unlimited with a number refused', async () => {
    for (const value of [60_000, 1_800_000]) {
      await q(`UPDATE menu_items SET max_delay_ms = $2 WHERE tenant_id = $1 AND item_id = 'i1'`, [TN, value]);
      expect((await q(`SELECT max_delay_ms FROM menu_items WHERE item_id = 'i1'`)).rows[0]).toEqual({ max_delay_ms: value });
    }
    for (const value of [0, 59_999, 1_800_001]) {
      await refused(`UPDATE menu_items SET max_delay_ms = $2 WHERE tenant_id = $1 AND item_id = 'i2'`, [TN, value]);
    }
    await refused(`UPDATE menu_items SET max_delay_ms = 60000, max_delay_unlimited = true WHERE tenant_id = $1 AND item_id = 'i2'`, [TN]);
    await q(`UPDATE menu_items SET max_delay_ms = NULL, max_delay_unlimited = true WHERE tenant_id = $1 AND item_id = 'i2'`, [TN]);
    expect((await q(`SELECT max_delay_ms, max_delay_unlimited FROM menu_items WHERE item_id = 'i2'`)).rows[0]).toEqual({ max_delay_ms: null, max_delay_unlimited: true });
  });

  it('[01a #202 MD-2; re-review F-1] the settings CHECK: null, 60 000 and 1 800 000 accepted; 0, 59 999 and 1 800 001 refused', async () => {
    for (const value of [null, 60_000, 1_800_000]) {
      await q(`UPDATE branch_engine_settings SET max_delay_default_ms = $2 WHERE tenant_id = $1 AND branch_id = 'b1'`, [TN, value]);
      expect((await q(`SELECT max_delay_default_ms FROM branch_engine_settings WHERE branch_id = 'b1'`)).rows[0]).toEqual({ max_delay_default_ms: value });
    }
    for (const value of [0, 59_999, 1_800_001]) {
      await refused(`UPDATE branch_engine_settings SET max_delay_default_ms = $2 WHERE tenant_id = $1 AND branch_id = 'b2'`, [TN, value]);
    }
  });
});
