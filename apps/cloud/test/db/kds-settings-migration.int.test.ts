import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate';
import { assertTenantContext } from '../../src/db/tenant-scoped-repository';
import { fixedClock } from '../../src/lib/clock';
import { syncConfig } from '../../src/modules/config-sync/service';
import { dropScratchDatabases, scratchDatabaseAt } from '../helpers/scratch-db';

// 03b §4.5 A-1 (01a v2.4): a scratch database migrated to 0011 with two branches, then the real folder (with 0012).

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const T = 1_761_000_000_000;
const TN = 't1';

let pool: pg.Pool;
let preVersions: Record<string, number> = {};
const q = (sql: string, params: unknown[] = []) => pool.query(sql, params);
const reject = (sql: string, params: unknown[] = []) => expect(q(sql, params)).rejects.toMatchObject({ code: '23514' });

beforeAll(async () => {
  ({ pool } = await scratchDatabaseAt(11));
  await q(`INSERT INTO tenants (tenant_id, name, currency_code, created_at) VALUES ($1, 'Pilot', 'PKR', $2)`, [TN, T]);
  for (const b of ['b1', 'b2']) {
    await q(`INSERT INTO branches (tenant_id, branch_id, name, status, created_at) VALUES ($1, $2, $2, 'pending_hub', $3)`, [TN, b, T]);
  }
  await q(
    `INSERT INTO branch_engine_settings (tenant_id, branch_id, created_at, updated_at)
     SELECT tenant_id, branch_id, $2, $2 FROM branches WHERE tenant_id = $1 ON CONFLICT DO NOTHING`,
    [TN, T],
  );
  // A branch without an engine-settings row: 0012 leaves its config_version alone.
  await q(`INSERT INTO branches (tenant_id, branch_id, name, status, created_at) VALUES ($1, 'b0', 'b0', 'pending_hub', $2)`, [TN, T]);
  preVersions = Object.fromEntries(
    (await q(`SELECT branch_id, config_version FROM branches ORDER BY branch_id`)).rows.map((r) => [r.branch_id, Number(r.config_version)]),
  );
  await migrate(pool, migrationsDir, fixedClock(T));
}, 40_000);

afterAll(async () => {
  await dropScratchDatabases();
}, 40_000);

describe('[03b §4.5 A-1] cloud migration 0012_kds_settings.sql', () => {
  it('[03b §4.5 A-1] existing rows: served_estimate_ms = 180 000, ready_window_ms = 60 000, kds_offline_ms = 30 000; no audit row', async () => {
    const { rows } = await q(`SELECT branch_id, served_estimate_ms, ready_window_ms, kds_offline_ms FROM branch_engine_settings ORDER BY branch_id`);
    expect(rows).toEqual([
      { branch_id: 'b1', served_estimate_ms: 180_000, ready_window_ms: 60_000, kds_offline_ms: 30_000 },
      { branch_id: 'b2', served_estimate_ms: 180_000, ready_window_ms: 60_000, kds_offline_ms: 30_000 },
    ]);
    expect((await q(`SELECT count(*)::int AS n FROM config_audit`)).rows[0]).toEqual({ n: 0 });
  });

  it('[03b §4.5 A-1; AD-9 owner 2026-11-11] 0012 bumps branches.config_version for every branch with an engine-settings row, only those', async () => {
    const { rows } = await q(`SELECT branch_id, config_version FROM branches WHERE branch_id IN ('b0', 'b1', 'b2') ORDER BY branch_id`);
    expect(rows.map((r) => [r.branch_id, Number(r.config_version)])).toEqual([
      ['b0', preVersions.b0],
      ['b1', preVersions.b1! + 1],
      ['b2', preVersions.b2! + 1],
    ]);
  });

  it('[03b §4.5 A-1; AD-9 owner 2026-11-11] a hub still on the pre-migration config_version gets a new snapshot with the three keys', async () => {
    const directory = Number((await q(`SELECT directory_version FROM tenants WHERE tenant_id = $1`, [TN])).rows[0].directory_version);
    const result = await syncConfig(pool, fixedClock(T), assertTenantContext(Object.freeze({ tenantId: TN, branchIds: Object.freeze(['b1']) })), {
      config_version: preVersions.b1!,
      directory_version: directory,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const snapshot = result.data.config!.snapshot as { config_version: number; engine_settings: Record<string, unknown> };
    expect(snapshot.config_version).toBe(preVersions.b1! + 1);
    expect(snapshot.engine_settings).toMatchObject({ served_estimate_ms: 180_000, ready_window_ms: 60_000, kds_offline_ms: 30_000 });
  });

  it('[03b §4.5 A-1] a row written after the migration takes the column defaults: served_estimate_ms null (off)', async () => {
    await q(`INSERT INTO branches (tenant_id, branch_id, name, status, created_at) VALUES ($1, 'b3', 'b3', 'pending_hub', $2)`, [TN, T]);
    await q(`INSERT INTO branch_engine_settings (tenant_id, branch_id, created_at, updated_at) VALUES ($1, 'b3', $2, $2)`, [TN, T]);
    const { rows } = await q(`SELECT served_estimate_ms, ready_window_ms, kds_offline_ms FROM branch_engine_settings WHERE branch_id = 'b3'`);
    expect(rows).toEqual([{ served_estimate_ms: null, ready_window_ms: 60_000, kds_offline_ms: 30_000 }]);
  });

  it.each([
    ['ready_window_ms', 15_000, 300_000],
    ['kds_offline_ms', 10_000, 300_000],
    ['served_estimate_ms', 60_000, 1_800_000],
  ])('[03b §4.5 A-1] %s CHECK: both ends stored, one past either end refused', async (column, min, max) => {
    for (const value of [min, max]) {
      await q(`UPDATE branch_engine_settings SET ${column} = $1 WHERE branch_id = 'b1'`, [value]);
      expect((await q(`SELECT ${column} AS v FROM branch_engine_settings WHERE branch_id = 'b1'`)).rows[0]).toEqual({ v: value });
    }
    await reject(`UPDATE branch_engine_settings SET ${column} = $1 WHERE branch_id = 'b1'`, [min - 1]);
    await reject(`UPDATE branch_engine_settings SET ${column} = $1 WHERE branch_id = 'b1'`, [max + 1]);
  });

  it('[03b §4.5 A-1] served_estimate_ms null stays allowed (off); the other two are NOT NULL', async () => {
    await q(`UPDATE branch_engine_settings SET served_estimate_ms = NULL WHERE branch_id = 'b1'`);
    await expect(q(`UPDATE branch_engine_settings SET ready_window_ms = NULL WHERE branch_id = 'b1'`)).rejects.toMatchObject({ code: '23502' });
    await expect(q(`UPDATE branch_engine_settings SET kds_offline_ms = NULL WHERE branch_id = 'b1'`)).rejects.toMatchObject({ code: '23502' });
  });
});
