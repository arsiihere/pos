import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate';
import { fixedClock } from '../../src/lib/clock';
import { dropScratchDatabases, scratchDatabaseAt } from '../helpers/scratch-db';

// 01a v2.2 / v2.3 §5.2 (02a A-1, 02b A-1): a scratch database migrated to 0008, seeded, then the real folder (with 0009).

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const T = 1_761_000_000_000;
const clock = fixedClock(T);
const TN = 't1';

let pool: pg.Pool;
const q = (sql: string, params: unknown[] = []) => pool.query(sql, params);

async function seedAt0008(p: pg.Pool): Promise<void> {
  await p.query(`INSERT INTO tenants (tenant_id, name, currency_code, created_at) VALUES ($1, 'Pilot', 'PKR', $2)`, [TN, T]);
  for (const b of ['b1', 'b2']) {
    await p.query(`INSERT INTO branches (tenant_id, branch_id, name, status, created_at) VALUES ($1, $2, $2, 'pending_hub', $3)`, [TN, b, T]);
  }
  await p.query(`INSERT INTO floors (tenant_id, branch_id, floor_id, name, created_at, updated_at) VALUES ($1, 'b1', 'f1', 'Ground', $2, $2)`, [TN, T]);
  await p.query(
    `INSERT INTO dining_tables (tenant_id, branch_id, table_id, floor_id, name, created_at, updated_at) VALUES ($1, 'b1', 't1', 'f1', 'T1', $2, $2)`,
    [TN, T],
  );
  await p.query(`INSERT INTO categories (tenant_id, category_id, name, created_at, updated_at) VALUES ($1, 'c1', 'Mains', $2, $2)`, [TN, T]);
  await p.query(
    `INSERT INTO menu_items (tenant_id, item_id, category_id, name, price_minor, serve_mode, cook_time_ms, created_at, updated_at)
     VALUES ($1, 'i1', 'c1', 'Karahi', 500, 'immediate', 600000, $2, $2)`,
    [TN, T],
  );
  // 0007 seeds a settings row per branch that has a point; a branch of an older install would not have one,
  // so the two branches here are both seeded by hand if missing.
  await p.query(
    `INSERT INTO branch_engine_settings (tenant_id, branch_id, created_at, updated_at)
     SELECT tenant_id, branch_id, $2, $2 FROM branches WHERE tenant_id = $1
     ON CONFLICT DO NOTHING`,
    [TN, T],
  );
}

const reject = (sql: string, params: unknown[], code: string, constraint?: string) =>
  expect(q(sql, params)).rejects.toMatchObject({ code, ...(constraint !== undefined ? { constraint } : {}) });
const zone = (id: string, floor: string, name: string, archived: number | null = null, branch = 'b1') =>
  q(
    `INSERT INTO zones (tenant_id, branch_id, zone_id, floor_id, name, archived_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
    [TN, branch, id, floor, name, archived, T],
  );

beforeAll(async () => {
  ({ pool } = await scratchDatabaseAt(8));
  await seedAt0008(pool);
  await migrate(pool, migrationsDir, clock);
}, 40_000);

afterAll(async () => {
  await dropScratchDatabases();
}, 40_000);

describe('[01a §5.2] cloud migration 0009_zones.sql', () => {
  it('[01a A-1] existing rows take the defaults: tables have no zone, items are not ready items, settings get the 02b values', async () => {
    expect((await q(`SELECT zone_id FROM dining_tables`)).rows).toEqual([{ zone_id: null }]);
    expect((await q(`SELECT is_ready_item FROM menu_items`)).rows).toEqual([{ is_ready_item: false }]);
    const { rows } = await q(
      `SELECT queue_auto_send_max_ms, zone_undo_ms, slow_item_threshold_ms, served_estimate_ms, comp_reason_chips FROM branch_engine_settings`,
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toEqual({
        queue_auto_send_max_ms: 14_400_000,
        zone_undo_ms: 300_000,
        slow_item_threshold_ms: 900_000,
        served_estimate_ms: null,
        comp_reason_chips: ['Late', 'Wrong item', 'Quality', 'Guest', 'Other'],
      });
    }
    // a migration is not an owner write
    expect((await q(`SELECT count(*)::int AS n FROM config_audit`)).rows[0]).toEqual({ n: 0 });
    expect((await q(`SELECT DISTINCT config_version::int AS v FROM branches`)).rows).toEqual([{ v: 1 }]);
  });

  it('[01a A-1] zones: name 1–40 characters, a same-branch floor, unique active name per floor (case-insensitive)', async () => {
    await zone('z1', 'f1', 'Patio');
    await reject(`INSERT INTO zones (tenant_id, branch_id, zone_id, floor_id, name, created_at, updated_at) VALUES ($1, 'b1', 'zn', 'f1', '', 0, 0)`, [TN], '23514');
    await reject(`INSERT INTO zones (tenant_id, branch_id, zone_id, floor_id, name, created_at, updated_at) VALUES ($1, 'b1', 'zn', 'f1', $2, 0, 0)`, [TN, 'x'.repeat(41)], '23514');
    await zone('z-40', 'f1', 'x'.repeat(40));
    await expect(zone('z-dup', 'f1', 'PATIO')).rejects.toMatchObject({ code: '23505', constraint: 'zones_active_name' });
    await zone('z-old', 'f1', 'patio', T); // an archived zone may share the name
    await q(`INSERT INTO floors (tenant_id, branch_id, floor_id, name, created_at, updated_at) VALUES ($1, 'b1', 'f2', 'Upper', 0, 0)`, [TN]);
    await zone('z-up', 'f2', 'Patio'); // another floor
    await expect(zone('z-b2', 'f1', 'Elsewhere', null, 'b2')).rejects.toMatchObject({ code: '23503' }); // f1 is b1's floor
    const { rows } = await q(`SELECT indexdef FROM pg_indexes WHERE indexname IN ('zones_active_name', 'zones_floor') ORDER BY indexname`);
    expect(rows[0].indexdef).toContain('(tenant_id, branch_id, floor_id, lower(name)) WHERE (archived_at IS NULL)');
    expect(rows[1].indexdef).toContain('(tenant_id, branch_id, floor_id) WHERE (archived_at IS NULL)');
  });

  it('[01a A-1] dining_tables.zone_id: nullable, a same-branch zone, partial index for the zone archive', async () => {
    await q(`UPDATE dining_tables SET zone_id = 'z1' WHERE table_id = 't1'`);
    await q(`UPDATE dining_tables SET zone_id = NULL WHERE table_id = 't1'`);
    await reject(`UPDATE dining_tables SET zone_id = 'no-such' WHERE table_id = 't1'`, [], '23503');
    const { rows } = await q(`SELECT indexdef FROM pg_indexes WHERE indexname = 'dining_tables_zone'`);
    expect(rows[0].indexdef).toContain('(tenant_id, branch_id, zone_id) WHERE ((archived_at IS NULL) AND (zone_id IS NOT NULL))');
  });

  it('[01a A-1] zone_item_routes and zone_stock_items: keyed per zone and item, FKs to the zone and the item, threshold 0–5000', async () => {
    await q(`INSERT INTO zone_item_routes (tenant_id, branch_id, zone_id, item_id, station_id) VALUES ($1, 'b1', 'z1', 'i1', 's1')`, [TN]);
    await reject(`INSERT INTO zone_item_routes (tenant_id, branch_id, zone_id, item_id, station_id) VALUES ($1, 'b1', 'z1', 'i1', 's2')`, [TN], '23505');
    await reject(`INSERT INTO zone_item_routes (tenant_id, branch_id, zone_id, item_id, station_id) VALUES ($1, 'b1', 'no-zone', 'i1', 's1')`, [TN], '23503');
    await reject(`INSERT INTO zone_item_routes (tenant_id, branch_id, zone_id, item_id, station_id) VALUES ($1, 'b1', 'z1', 'no-item', 's1')`, [TN], '23503');
    await reject(`INSERT INTO zone_item_routes (tenant_id, branch_id, zone_id, item_id, station_id) VALUES ($1, 'b2', 'z1', 'i1', 's1')`, [TN], '23503');

    await q(`INSERT INTO zone_stock_items (tenant_id, branch_id, zone_id, item_id) VALUES ($1, 'b1', 'z1', 'i1')`, [TN]);
    expect((await q(`SELECT threshold FROM zone_stock_items`)).rows).toEqual([{ threshold: 0 }]);
    for (const threshold of [0, 5000]) await q(`UPDATE zone_stock_items SET threshold = $1`, [threshold]);
    for (const threshold of [-1, 5001]) await reject(`UPDATE zone_stock_items SET threshold = $1`, [threshold], '23514');
    await reject(`INSERT INTO zone_stock_items (tenant_id, branch_id, zone_id, item_id) VALUES ($1, 'b1', 'z1', 'i1')`, [TN], '23505');
    await reject(`INSERT INTO zone_stock_items (tenant_id, branch_id, zone_id, item_id) VALUES ($1, 'b1', 'z1', 'no-item')`, [TN], '23503');
  });

  it('[01a A-1] the new branch_engine_settings columns hold their ranges', async () => {
    const ranges: Array<[string, number[], number[]]> = [
      ['queue_auto_send_max_ms', [3_600_000, 86_400_000], [3_599_999, 86_400_001]],
      ['zone_undo_ms', [0, 1_800_000], [-1, 1_800_001]],
      ['slow_item_threshold_ms', [60_000, 7_200_000], [59_999, 7_200_001]],
    ];
    for (const [column, ok, bad] of ranges) {
      for (const value of ok) await q(`UPDATE branch_engine_settings SET ${column} = $1`, [value]);
      for (const value of bad) await reject(`UPDATE branch_engine_settings SET ${column} = $1`, [value], '23514');
    }
    await q(`UPDATE branch_engine_settings SET served_estimate_ms = 600000`);
    await q(`UPDATE branch_engine_settings SET served_estimate_ms = NULL`);
  });

  it('[01a A-1] comp_reason_chips: 1–10 labels of 1–30 characters, no NULL label', async () => {
    const set = (chips: Array<string | null>) => q(`UPDATE branch_engine_settings SET comp_reason_chips = $1`, [chips]);
    await set(['Late']);
    await set(Array.from({ length: 10 }, (_, i) => `Reason ${i}`));
    await set(['x'.repeat(30)]);
    for (const bad of [[], Array.from({ length: 11 }, (_, i) => `Reason ${i}`), [''], ['x'.repeat(31)], ['Late', null]]) {
      await expect(set(bad as string[]), JSON.stringify(bad)).rejects.toMatchObject({ code: '23514' });
    }
    await expect(q(`UPDATE branch_engine_settings SET comp_reason_chips = NULL`)).rejects.toMatchObject({ code: '23502' });
  });

  it('[01a A-1] config_audit accepts entity zone and still refuses an unknown entity', async () => {
    const audit = (entity: string) =>
      q(
        `INSERT INTO config_audit (tenant_id, audit_id, actor_kind, actor_owner_user_id, branch_id, entity, entity_id, action, after, at)
         VALUES ($1, $2, 'cli', NULL, 'b1', $3, 'z1', 'create', '{}', $4)`,
        [TN, `a-${entity}`, entity, T],
      );
    await audit('zone');
    await expect(audit('nonsense')).rejects.toMatchObject({ code: '23514' });
    await audit('point'); // the earlier entities stay
  });
});
