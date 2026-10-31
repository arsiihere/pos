import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate';
import { fixedClock } from '../../src/lib/clock';
import { dropScratchDatabases, scratchDatabaseAt } from '../helpers/scratch-db';

// 01c §5.1: a scratch database migrated to 0005, seeded with 01a items, then the real folder (with 0006).

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const T = 1_761_000_000_000;
const clock = fixedClock(T);
const TN = 't1';

afterAll(async () => {
  await dropScratchDatabases();
}, 40_000);

async function seed01a(pool: pg.Pool): Promise<void> {
  const q = (sql: string, params: unknown[] = []) => pool.query(sql, params);
  await q(`INSERT INTO tenants (tenant_id, name, currency_code, created_at) VALUES ($1, 'Pilot', 'PKR', $2)`, [TN, T]);
  for (const b of ['b1', 'b2']) {
    await q(`INSERT INTO branches (tenant_id, branch_id, name, status, created_at) VALUES ($1, $2, $2, 'pending_hub', $3)`, [TN, b, T]);
    await q(
      `INSERT INTO stations (tenant_id, branch_id, station_id, name, station_type, capacity, created_at, updated_at)
       VALUES ($1, $2, $3, 'Grill', 'slot', 2, $4, $4)`,
      [TN, b, `slot-${b}`, T],
    );
  }
  await q(
    `INSERT INTO stations (tenant_id, branch_id, station_id, name, station_type, capacity, freshness_window_ms, created_at, updated_at)
     VALUES ($1, 'b1', 'batch-b1', 'Fryer', 'batch', 10, 600000, $2, $2)`,
    [TN, T],
  );
  await q(
    `INSERT INTO batch_programs (tenant_id, branch_id, station_id, program_id, name, cook_time_ms, created_at, updated_at)
     VALUES ($1, 'b1', 'batch-b1', 'prog1', 'Fry', 300000, $2, $2)`,
    [TN, T],
  );
  await q(`INSERT INTO categories (tenant_id, category_id, name, created_at, updated_at) VALUES ($1, 'c1', 'Mains', $2, $2)`, [TN, T]);
  const item = (id: string, extra: { stockTime: number | null; unit: string; per: number; thr: number | null; carry: boolean; archived: boolean }) =>
    q(
      `INSERT INTO menu_items (tenant_id, item_id, category_id, name, price_minor, serve_mode, cook_time_ms, stock_time_ms,
         stock_unit, stock_per_sale_unit, low_stock_threshold, carries_over, archived_at, created_at, updated_at)
       VALUES ($1, $2, 'c1', $2, 500, 'immediate', 600000, $3, $4, $5, $6, $7, $8, $9, $9)`,
      [TN, id, extra.stockTime, extra.unit, extra.per, extra.thr, extra.carry, extra.archived ? T : null, T],
    );
  await item('slotitem', { stockTime: 1000, unit: 'g', per: 250, thr: 1000, carry: true, archived: false });
  await item('batchitem', { stockTime: null, unit: 'piece', per: 1, thr: 5, carry: false, archived: false });
  await item('untracked', { stockTime: null, unit: 'piece', per: 1, thr: null, carry: false, archived: false });
  await item('archived', { stockTime: 1000, unit: 'piece', per: 1, thr: null, carry: false, archived: true });
  const route = (item_id: string, branch: string, station: string, prog: string | null, stockProg: string | null) =>
    q(
      `INSERT INTO item_routes (tenant_id, branch_id, item_id, station_id, program_id, stock_program_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [TN, branch, item_id, station, prog, stockProg, T],
    );
  await route('slotitem', 'b1', 'slot-b1', null, null);
  await route('slotitem', 'b2', 'slot-b2', null, null);
  await route('batchitem', 'b1', 'batch-b1', 'prog1', 'prog1');
  await route('untracked', 'b1', 'slot-b1', null, null);
  await route('archived', 'b1', 'slot-b1', null, null);
}

describe('[01c §5.1] cloud migration 0006_menu_variants.sql', () => {
  it('[01c #27] backfills stock items, branch rows and draws for active tracked items with the same ids', async () => {
    const { pool } = await scratchDatabaseAt(5);
    await seed01a(pool);
    await migrate(pool, migrationsDir, clock);

    const items = await pool.query(`SELECT stock_item_id, name, stock_unit, carries_over FROM stock_items ORDER BY stock_item_id`);
    expect(items.rows).toEqual([
      { stock_item_id: 'batchitem', name: 'batchitem', stock_unit: 'piece', carries_over: false },
      { stock_item_id: 'slotitem', name: 'slotitem', stock_unit: 'g', carries_over: true },
    ]);
    const branches = await pool.query(
      `SELECT branch_id, stock_item_id, station_id, low_stock_threshold FROM stock_item_branches ORDER BY branch_id, stock_item_id`,
    );
    expect(branches.rows).toEqual([
      { branch_id: 'b1', stock_item_id: 'batchitem', station_id: 'batch-b1', low_stock_threshold: 5 },
      { branch_id: 'b1', stock_item_id: 'slotitem', station_id: 'slot-b1', low_stock_threshold: 1000 },
      { branch_id: 'b2', stock_item_id: 'slotitem', station_id: 'slot-b2', low_stock_threshold: 1000 },
    ]);
    const draws = await pool.query(`SELECT item_id, stock_item_id, quantity_per_sale_unit FROM stock_draws ORDER BY item_id`);
    expect(draws.rows).toEqual([
      { item_id: 'batchitem', stock_item_id: 'batchitem', quantity_per_sale_unit: 1 },
      { item_id: 'slotitem', stock_item_id: 'slotitem', quantity_per_sale_unit: 250 },
    ]);
    expect((await pool.query(`SELECT count(*)::int AS n FROM config_audit`)).rows[0]).toEqual({ n: 0 });
  });

  it('[01c §5.1] constraints refuse the invalid shapes and accept the valid ones', async () => {
    const { pool } = await scratchDatabaseAt(5);
    await seed01a(pool);
    await migrate(pool, migrationsDir, clock);
    const bad = (sql: string, params: unknown[], constraint?: string) =>
      expect(pool.query(sql, params)).rejects.toMatchObject({ code: '23514', ...(constraint ? { constraint } : {}) });

    await bad(`UPDATE menu_items SET variant_group_id = 'g' WHERE item_id = 'untracked'`, [], 'menu_items_variant_pair');
    await bad(`UPDATE menu_items SET requires_weighing = true WHERE item_id = 'untracked'`, [], 'menu_items_weighing_unit');

    await pool.query(`INSERT INTO deals (tenant_id, deal_id, category_id, name, price_minor, created_at, updated_at) VALUES ($1, 'd1', 'c1', 'Combo', 100, $2, $2)`, [TN, T]);
    await bad(
      `INSERT INTO availability_windows (tenant_id, window_id, item_id, deal_id, start_ms, end_ms) VALUES ($1, 'w1', 'untracked', 'd1', 0, 60000)`,
      [TN],
      'availability_windows_one_target',
    );
    await pool.query(`INSERT INTO availability_windows (tenant_id, window_id, deal_id, start_ms, end_ms) VALUES ($1, 'w2', 'd1', 0, 60000)`, [TN]);

    await pool.query(`INSERT INTO modifier_groups (tenant_id, modifier_group_id, name, min_choices, max_choices, created_at, updated_at) VALUES ($1, 'mg', 'Sauce', 0, 2, $2, $2)`, [TN, T]);
    await pool.query(`INSERT INTO modifier_options (tenant_id, option_id, modifier_group_id, name, price_minor) VALUES ($1, 'o1', 'mg', 'Mayo', 10)`, [TN]);
    await bad(`INSERT INTO modifier_option_branches (tenant_id, branch_id, option_id, is_offered, updated_at) VALUES ($1, 'b1', 'o1', true, $2)`, [TN, T]);
    await bad(`INSERT INTO modifier_option_branches (tenant_id, branch_id, option_id, is_offered, price_minor_override, updated_at) VALUES ($1, 'b1', 'o1', false, 5, $2)`, [TN, T]);
    await pool.query(`INSERT INTO modifier_option_branches (tenant_id, branch_id, option_id, is_offered, price_minor_override, updated_at) VALUES ($1, 'b1', 'o1', true, 5, $2)`, [TN, T]);

    await bad(`INSERT INTO modifier_group_links (tenant_id, modifier_group_id, target_kind, target_id, mode) VALUES ($1, 'mg', 'category', 'c1', 'detach')`, [TN]);
    await pool.query(`INSERT INTO modifier_group_links (tenant_id, modifier_group_id, target_kind, target_id, mode) VALUES ($1, 'mg', 'item', 'untracked', 'detach')`, [TN]);

    for (const [entity, action] of [['deal_branch', 'branch_set'], ['stock_item_branch', 'branch_removed']] as const) {
      await pool.query(
        `INSERT INTO config_audit (tenant_id, audit_id, actor_kind, entity, entity_id, action, after, at) VALUES ($1, $2, 'cli', $3, 'x', $4, '{}', $5)`,
        [TN, `a-${entity}`, entity, action, T],
      );
    }
  });
});
