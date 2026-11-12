import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate';
import { fixedClock } from '../../src/lib/clock';
import { dropScratchDatabases, scratchDatabaseAt } from '../helpers/scratch-db';

// 01a v2.1 §5.2a: a scratch database migrated to 0006, seeded, then the real folder (with 0007).

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const T = 1_761_000_000_000;
const clock = fixedClock(T);
const TN = 't1';
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const NEW_TABLES = ['points', 'station_alternates', 'carry_times', 'branch_engine_settings', 'goes_with_links'];

let pool: pg.Pool;

async function seedAt0006(p: pg.Pool): Promise<void> {
  const q = (sql: string, params: unknown[] = []) => p.query(sql, params);
  await q(`INSERT INTO tenants (tenant_id, name, currency_code, created_at) VALUES ($1, 'Pilot', 'PKR', $2)`, [TN, T]);
  // b3 has no stations: it still gets a point and a settings row.
  for (const b of ['b1', 'b2', 'b3']) {
    await q(`INSERT INTO branches (tenant_id, branch_id, name, status, created_at) VALUES ($1, $2, $2, 'pending_hub', $3)`, [TN, b, T]);
  }
  const station = (b: string, id: string, name: string, type: 'slot' | 'batch', archived: number | null) =>
    q(
      `INSERT INTO stations (tenant_id, branch_id, station_id, name, station_type, capacity, freshness_window_ms, archived_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 2, $6, $7, $8, $8)`,
      [TN, b, id, name, type, type === 'batch' ? 600_000 : null, archived, T],
    );
  await station('b1', 'grill-b1', 'Grill', 'slot', null);
  await station('b1', 'tandoor-b1', 'Tandoor', 'slot', null);
  await station('b1', 'fryer-b1', 'Fryer', 'batch', null);
  await station('b1', 'old-b1', 'Old', 'slot', T);
  await station('b2', 'grill-b2', 'Grill', 'slot', null);
  await q(`INSERT INTO categories (tenant_id, category_id, name, created_at, updated_at) VALUES ($1, 'c1', 'Mains', $2, $2)`, [TN, T]);
  await q(
    `INSERT INTO menu_items (tenant_id, item_id, category_id, name, price_minor, serve_mode, cook_time_ms, created_at, updated_at)
     VALUES ($1, 'i1', 'c1', 'Karahi', 500, 'immediate', 600000, $2, $2)`,
    [TN, T],
  );
}

async function passOf(branchId: string): Promise<string> {
  const { rows } = await pool.query<{ point_id: string }>(
    `SELECT point_id FROM points WHERE tenant_id = $1 AND branch_id = $2 AND name = 'Pass' AND archived_at IS NULL`,
    [TN, branchId],
  );
  return rows[0]!.point_id;
}

// One UPDATE per value, so a range end that passes never hides the one that must fail.
type RangeCase = { column: string; ok: (number | null)[]; bad: number[] };

async function expectRange(table: string, where: string, cases: RangeCase[]): Promise<void> {
  for (const { column, ok, bad } of cases) {
    for (const value of ok) await pool.query(`UPDATE ${table} SET ${column} = $1 WHERE ${where}`, [value]);
    for (const value of bad) {
      await expect(pool.query(`UPDATE ${table} SET ${column} = $1 WHERE ${where}`, [value]), `${column} = ${value}`).rejects.toMatchObject({
        code: '23514',
      });
    }
  }
}

beforeAll(async () => {
  ({ pool } = await scratchDatabaseAt(6));
  await seedAt0006(pool);
  await migrate(pool, migrationsDir, clock);
}, 40_000);

afterAll(async () => {
  await dropScratchDatabases();
}, 40_000);

describe('[01a §5.2a] cloud migration 0007_engine_config.sql', () => {
  it('[01a §5.2a A-1] each branch has exactly one active "Pass" point with a ULID id', async () => {
    const { rows } = await pool.query(
      `SELECT branch_id, point_id, name, sort_order, archived_at, version FROM points WHERE tenant_id = $1 ORDER BY branch_id`,
      [TN],
    );
    expect(rows.map((row) => [row.branch_id, row.name, row.sort_order, row.archived_at, Number(row.version)])).toEqual([
      ['b1', 'Pass', 0, null, 1],
      ['b2', 'Pass', 0, null, 1],
      ['b3', 'Pass', 0, null, 1],
    ]);
    for (const row of rows) expect(row.point_id).toMatch(ULID);
    expect(new Set(rows.map((row) => row.point_id)).size).toBe(3);
  });

  it('[01a §5.2a A-2] every station, archived too, names its own branch\'s Pass; then NOT NULL and a same-branch FK', async () => {
    const { rows } = await pool.query<{ branch_id: string; station_id: string; point_id: string }>(
      `SELECT branch_id, station_id, point_id FROM stations WHERE tenant_id = $1`,
      [TN],
    );
    expect(rows).toHaveLength(5);
    for (const row of rows) expect(row.point_id, row.station_id).toBe(await passOf(row.branch_id));

    const { rows: columns } = await pool.query(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'stations' AND column_name = 'point_id'`,
    );
    expect(columns).toEqual([{ is_nullable: 'NO' }]);
    await expect(
      pool.query(`UPDATE stations SET point_id = NULL WHERE tenant_id = $1 AND station_id = 'grill-b1'`, [TN]),
    ).rejects.toMatchObject({ code: '23502' });
    await expect(
      pool.query(`UPDATE stations SET point_id = $2 WHERE tenant_id = $1 AND station_id = 'grill-b1'`, [TN, await passOf('b2')]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('[01a §5.2a] a migration is not an owner write: no audit rows, config_version and updated_at untouched', async () => {
    expect((await pool.query(`SELECT count(*)::int AS n FROM config_audit`)).rows[0]).toEqual({ n: 0 });
    const { rows } = await pool.query(`SELECT DISTINCT config_version::int AS v FROM branches WHERE tenant_id = $1`, [TN]);
    // 0007 bumps nothing; the whole folder runs, and 0012 (03b A-1, AD-9 owner 2026-11-11) bumps once → 2.
    expect(rows).toEqual([{ v: 2 }]);
    const { rows: stations } = await pool.query(
      `SELECT DISTINCT updated_at::text AS u FROM stations WHERE tenant_id = $1 AND station_id = 'fryer-b1'`,
      [TN],
    );
    expect(stations).toEqual([{ u: String(T) }]);
  });

  it('[01a §5.2a A-1] points_branch_name_active refuses a second active "Pass", allows an archived one and another branch\'s', async () => {
    const insert = (id: string, branch: string, name: string, archived: number | null) =>
      pool.query(
        `INSERT INTO points (tenant_id, branch_id, point_id, name, archived_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [TN, branch, id, name, archived, T],
      );
    await expect(insert('dup', 'b1', 'Pass', null)).rejects.toMatchObject({ code: '23505', constraint: 'points_branch_name_active' });
    await insert('arch', 'b1', 'Pass', T);
    await pool.query(`DELETE FROM points WHERE tenant_id = $1 AND point_id = 'arch'`, [TN]);
    const { rows } = await pool.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'points_branch_name_active'`);
    expect(rows[0].indexdef).toContain('(tenant_id, branch_id, name) WHERE (archived_at IS NULL)');
  });

  it('[01a §5.2a A-1] name is 1–40 characters; sort_order defaults to 0', async () => {
    const insert = (id: string, name: string) =>
      pool.query(
        `INSERT INTO points (tenant_id, branch_id, point_id, name, created_at, updated_at) VALUES ($1, 'b3', $2, $3, $4, $4)
         RETURNING sort_order`,
        [TN, id, name, T],
      );
    await expect(insert('n0', '')).rejects.toMatchObject({ code: '23514' });
    await expect(insert('n41', 'x'.repeat(41))).rejects.toMatchObject({ code: '23514' });
    expect((await insert('n40', 'x'.repeat(40))).rows[0]).toEqual({ sort_order: 0 });
    await insert('n1', 'y');
    await pool.query(`DELETE FROM points WHERE tenant_id = $1 AND point_id IN ('n40', 'n1')`, [TN]);
  });

  it('[01a §5.2a A-3–A-8] a seeded station carries the config defaults', async () => {
    const { rows } = await pool.query(
      `SELECT policy, freeze_ms, min_slack_keep_ms, promise_padding_ms, pressure_window_ms, pressure_amber_bp, pressure_red_bp,
              pressure_alert_ms, pause_enabled, lane_units, reserve_units, completion_mode
         FROM stations WHERE tenant_id = $1 AND station_id = 'tandoor-b1'`,
      [TN],
    );
    expect(rows).toEqual([
      {
        policy: 'waada_guard',
        freeze_ms: 120_000,
        min_slack_keep_ms: 60_000,
        promise_padding_ms: null,
        pressure_window_ms: 900_000,
        pressure_amber_bp: 8_000,
        pressure_red_bp: 10_000,
        pressure_alert_ms: 300_000,
        pause_enabled: false,
        lane_units: null,
        reserve_units: 0,
        completion_mode: 'two_tap',
      },
    ]);
  });

  it('[01a §5.2a A-3–A-8] station range CHECKs hold at both ends and one past', async () => {
    const where = `tenant_id = '${TN}' AND station_id = 'grill-b2'`; // capacity 2
    await expectRange('stations', where, [
      { column: 'freeze_ms', ok: [0, 900_000], bad: [-1, 900_001] },
      { column: 'min_slack_keep_ms', ok: [0, 600_000], bad: [-1, 600_001] },
      { column: 'promise_padding_ms', ok: [null, 0, 1_800_000], bad: [-1, 1_800_001] },
      { column: 'pressure_window_ms', ok: [300_000, 3_600_000], bad: [299_999, 3_600_001] },
      { column: 'pressure_alert_ms', ok: [60_000, 3_600_000], bad: [59_999, 3_600_001] },
      { column: 'lane_units', ok: [null, 1, 2], bad: [0, 3] },
      { column: 'reserve_units', ok: [0, 2], bad: [-1, 3] },
    ]);
    const policy = (value: string) => pool.query(`UPDATE stations SET policy = $1 WHERE ${where}`, [value]);
    for (const value of ['edf', 'fifo', 'waada_guard']) await policy(value);
    await expect(policy('lifo')).rejects.toMatchObject({ code: '23514' });

    const pressure = (amber: number, red: number) =>
      pool.query(`UPDATE stations SET pressure_amber_bp = $1, pressure_red_bp = $2 WHERE ${where}`, [amber, red]);
    await pressure(1, 2);
    await pressure(19_999, 20_000);
    await expect(pressure(0, 2)).rejects.toMatchObject({ code: '23514' });
    await expect(pressure(19_999, 20_001)).rejects.toMatchObject({ code: '23514' });
    await expect(pressure(5_000, 5_000)).rejects.toMatchObject({ code: '23514' });
    await expect(pressure(6_000, 5_000)).rejects.toMatchObject({ code: '23514' });
  });

  it('[01a §5.2a A-9] station_alternates: order_types non-empty and known, home ⊆ order_types, distinct, same branch', async () => {
    const insert = (from: string, to: string, types: string[], home: string[], branch = 'b1') =>
      pool.query(
        `INSERT INTO station_alternates (tenant_id, branch_id, station_id, alternate_station_id, order_types, home_for_order_types, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
        [TN, branch, from, to, types, home, T],
      );
    await expect(insert('grill-b1', 'tandoor-b1', ['dine_in'], ['takeaway'])).rejects.toMatchObject({ code: '23514' });
    await expect(insert('grill-b1', 'tandoor-b1', [], [])).rejects.toMatchObject({ code: '23514' });
    await expect(insert('grill-b1', 'tandoor-b1', ['drive_thru'], [])).rejects.toMatchObject({ code: '23514' });
    await expect(insert('grill-b1', 'grill-b1', ['dine_in'], [])).rejects.toMatchObject({ code: '23514' });
    await expect(insert('grill-b1', 'grill-b2', ['dine_in'], [])).rejects.toMatchObject({ code: '23503' });

    await insert('grill-b1', 'tandoor-b1', ['dine_in', 'takeaway', 'delivery', 'parking'], ['dine_in', 'parking']);
    await expect(insert('grill-b1', 'tandoor-b1', ['dine_in'], [])).rejects.toMatchObject({ code: '23505' });
    await insert('tandoor-b1', 'grill-b1', ['takeaway'], []);
    const { rows } = await pool.query(
      `SELECT version::int AS version FROM station_alternates WHERE tenant_id = $1 AND station_id = 'tandoor-b1'`,
      [TN],
    );
    expect(rows).toEqual([{ version: 1 }]);
  });

  it('[01a §5.2a A-10] carry_times: 0–600 000, one row per station and point, station and point of one branch', async () => {
    const insert = (station: string, point: string, ms: number, branch = 'b1') =>
      pool.query(
        `INSERT INTO carry_times (tenant_id, branch_id, station_id, point_id, carry_ms, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [TN, branch, station, point, ms, T],
      );
    const pass = await passOf('b1');
    await expect(insert('grill-b1', pass, -1)).rejects.toMatchObject({ code: '23514' });
    await expect(insert('grill-b1', pass, 600_001)).rejects.toMatchObject({ code: '23514' });
    await expect(insert('grill-b1', await passOf('b2'), 0)).rejects.toMatchObject({ code: '23503' });
    await insert('grill-b1', pass, 0);
    await insert('tandoor-b1', pass, 600_000);
    await expect(insert('grill-b1', pass, 1)).rejects.toMatchObject({ code: '23505' });
  });

  it('[01a §5.2a A-11] menu items get the knob defaults and range CHECKs', async () => {
    const { rows } = await pool.query(
      `SELECT weight_pct, max_early_ms, max_carry_ms, max_late_ms, adjust_time_ms FROM menu_items WHERE tenant_id = $1 AND item_id = 'i1'`,
      [TN],
    );
    expect(rows).toEqual([{ weight_pct: 100, max_early_ms: 60_000, max_carry_ms: null, max_late_ms: null, adjust_time_ms: 180_000 }]);
    await expectRange('menu_items', `tenant_id = '${TN}' AND item_id = 'i1'`, [
      { column: 'weight_pct', ok: [10, 1000], bad: [9, 1001] },
      { column: 'max_early_ms', ok: [0, 3_600_000], bad: [-1, 3_600_001] },
      { column: 'max_carry_ms', ok: [null, 0, 600_000], bad: [-1, 600_001] },
      { column: 'max_late_ms', ok: [null, 0, 7_200_000], bad: [-1, 7_200_001] },
      { column: 'adjust_time_ms', ok: [0, 3_600_000], bad: [-1, 3_600_001] },
    ]);
  });

  it('[01a §5.2a A-12] every branch has one settings row, at the Global Constraints defaults', async () => {
    const { rows } = await pool.query(
      `SELECT branch_id, weight_dine_in_pct, weight_takeaway_pct, weight_delivery_pct, weight_parking_pct, weight_follow_up_pct,
              promise_padding_dine_in_ms, promise_padding_takeaway_ms, promise_padding_delivery_ms, promise_padding_parking_ms,
              slip_threshold_ms, slip_escalate_ms, cascade_step_ms, min_gain_ms, table_lock_ttl_ms, returns_boost, order_abandon_ms
         FROM branch_engine_settings WHERE tenant_id = $1 ORDER BY branch_id`,
      [TN],
    );
    const defaults = {
      weight_dine_in_pct: 100,
      weight_takeaway_pct: 200,
      weight_delivery_pct: 200,
      weight_parking_pct: 200,
      weight_follow_up_pct: 300,
      promise_padding_dine_in_ms: 180_000,
      promise_padding_takeaway_ms: 180_000,
      promise_padding_delivery_ms: 180_000,
      promise_padding_parking_ms: 180_000,
      slip_threshold_ms: 120_000,
      slip_escalate_ms: 120_000,
      cascade_step_ms: 60_000,
      min_gain_ms: 60_000,
      table_lock_ttl_ms: 600_000,
      returns_boost: true,
      order_abandon_ms: 14_400_000,
    };
    expect(rows).toEqual(['b1', 'b2', 'b3'].map((branch_id) => ({ branch_id, ...defaults })));
    await expect(
      pool.query(`INSERT INTO branch_engine_settings (tenant_id, branch_id, created_at, updated_at) VALUES ($1, 'b1', $2, $2)`, [TN, T]),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      pool.query(`INSERT INTO branch_engine_settings (tenant_id, branch_id, created_at, updated_at) VALUES ($1, 'nope', $2, $2)`, [TN, T]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('[01a §5.2a A-12] branch settings range CHECKs hold at both ends and one past', async () => {
    const weight = { ok: [10, 1000], bad: [9, 1001] };
    const padding = { ok: [0, 1_800_000], bad: [-1, 1_800_001] };
    await expectRange('branch_engine_settings', `tenant_id = '${TN}' AND branch_id = 'b3'`, [
      { column: 'weight_dine_in_pct', ...weight },
      { column: 'weight_takeaway_pct', ...weight },
      { column: 'weight_delivery_pct', ...weight },
      { column: 'weight_parking_pct', ...weight },
      { column: 'weight_follow_up_pct', ...weight },
      { column: 'promise_padding_dine_in_ms', ...padding },
      { column: 'promise_padding_takeaway_ms', ...padding },
      { column: 'promise_padding_delivery_ms', ...padding },
      { column: 'promise_padding_parking_ms', ...padding },
      { column: 'slip_threshold_ms', ok: [60_000, 1_800_000], bad: [59_999, 1_800_001] },
      { column: 'slip_escalate_ms', ok: [30_000, 1_800_000], bad: [29_999, 1_800_001] },
      { column: 'cascade_step_ms', ok: [15_000, 300_000], bad: [14_999, 300_001] },
      { column: 'min_gain_ms', ok: [0, 600_000], bad: [-1, 600_001] },
      { column: 'table_lock_ttl_ms', ok: [60_000, 3_600_000], bad: [59_999, 3_600_001] },
      { column: 'order_abandon_ms', ok: [3_600_000, 86_400_000], bad: [3_599_999, 86_400_001] },
    ]);
  });

  it('[01a §5.2a A-13] goes_with_links starts empty; kinds are category or item; the five-column key is unique', async () => {
    expect((await pool.query(`SELECT count(*)::int AS n FROM goes_with_links`)).rows[0]).toEqual({ n: 0 });
    const insert = (id: string, sourceKind: string, targetKind: string, target = 'i1') =>
      pool.query(
        `INSERT INTO goes_with_links (tenant_id, link_id, source_kind, source_id, target_kind, target_id, created_at, updated_at)
         VALUES ($1, $2, $3, 'c1', $4, $5, $6, $6) RETURNING excluded`,
        [TN, id, sourceKind, targetKind, target, T],
      );
    await expect(insert('l0', 'station', 'item')).rejects.toMatchObject({ code: '23514' });
    await expect(insert('l0', 'item', 'station')).rejects.toMatchObject({ code: '23514' });
    expect((await insert('l1', 'category', 'item')).rows[0]).toEqual({ excluded: false });
    await expect(insert('l2', 'category', 'item')).rejects.toMatchObject({ code: '23505' });
    await insert('l3', 'category', 'category', 'c1');
  });

  it('[01a §5.2a] every new table has tenant_id, version, created_at, updated_at, and every index starts at tenant_id', async () => {
    const { rows } = await pool.query<{ table_name: string; column_name: string; is_nullable: string; data_type: string }>(
      `SELECT table_name, column_name, is_nullable, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1) AND column_name IN ('tenant_id', 'version', 'created_at', 'updated_at')`,
      [NEW_TABLES],
    );
    for (const table of NEW_TABLES) {
      const found = rows.filter((row) => row.table_name === table);
      expect(found.map((row) => row.column_name).sort(), table).toEqual(['created_at', 'tenant_id', 'updated_at', 'version']);
      for (const row of found) {
        expect(row.is_nullable, `${table}.${row.column_name}`).toBe('NO');
        expect(row.data_type, `${table}.${row.column_name}`).toBe(row.column_name === 'tenant_id' ? 'text' : 'bigint');
      }
    }
    const { rows: indexes } = await pool.query<{ index_name: string; first_column: string }>(
      `SELECT i.relname AS index_name, a.attname AS first_column
         FROM pg_index x
         JOIN pg_class t ON t.oid = x.indrelid
         JOIN pg_class i ON i.oid = x.indexrelid
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.indkey[0]
        WHERE t.relname = ANY($1)`,
      [NEW_TABLES],
    );
    expect(indexes.length).toBeGreaterThanOrEqual(NEW_TABLES.length);
    for (const index of indexes) expect(index.first_column, index.index_name).toBe('tenant_id');
  });

  it('[01a §6.9a] config_audit accepts entity point, keeps every earlier entity, and still refuses an unknown one', async () => {
    const insert = (id: string, entity: string) =>
      pool.query(
        `INSERT INTO config_audit (tenant_id, audit_id, actor_kind, branch_id, entity, entity_id, action, after, at)
         VALUES ($1, $2, 'cli', 'b1', $3, 'x', 'create', '{}', $4)`,
        [TN, id, entity, T],
      );
    await insert('a-point', 'point');
    const earlier = [
      'floor', 'table', 'station', 'batch_program', 'tax_class', 'category', 'menu_item', 'item_route', 'branch_settings',
      'staff', 'role', 'responsibility', 'branch', 'owner_user',
      'variant_group', 'stock_item', 'stock_item_branch', 'modifier_group', 'deal', 'deal_branch',
    ];
    for (const entity of earlier) await insert(`a-${entity}`, entity);
    await expect(insert('a-unknown', 'carry_time')).rejects.toMatchObject({ code: '23514', constraint: 'config_audit_entity_check' });
  });

  it('[01a §12.3 Q-v2.1-2] an index serves "active stations naming this point"', async () => {
    const { rows } = await pool.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'stations_point'`);
    expect(rows[0].indexdef).toContain('(tenant_id, branch_id, point_id) WHERE (archived_at IS NULL)');
  });
});
