import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool, migrate } from '../../src/db/migrate';
import { fixedClock } from '../../src/lib/clock';
import { truncateAll } from '../helpers/test-cloud';

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://pos:pos@127.0.0.1:5433/pos_test';
const T = 1_761_000_000_000;

const NEW_TABLES = [
  'config_audit',
  'idempotency_keys',
  'floors',
  'dining_tables',
  'stations',
  'batch_programs',
  'tax_classes',
  'categories',
  'menu_items',
  'availability_windows',
  'item_routes',
];

describe('cloud restaurant setup schema', () => {
  const pool = createPool(databaseUrl);

  beforeAll(async () => {
    await migrate(pool, migrationsDir, fixedClock(T));
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await truncateAll(pool);
    await pool.query(
      `INSERT INTO tenants (tenant_id, name, currency_code, created_at) VALUES ('t1', 'T', 'PKR', $1)`,
      [T],
    );
    await pool.query(
      `INSERT INTO branches (tenant_id, branch_id, name, status, created_at) VALUES ('t1', 'b1', 'B', 'pending_hub', $1)`,
      [T],
    );
    await pool.query(
      `INSERT INTO categories (tenant_id, category_id, name, created_at, updated_at) VALUES ('t1', 'c1', 'Mains', $1, $1)`,
      [T],
    );
  });

  async function insertItem(columns: Record<string, unknown>): Promise<void> {
    const row: Record<string, unknown> = {
      tenant_id: 't1',
      item_id: 'i1',
      category_id: 'c1',
      name: 'Karahi',
      price_minor: 120_000,
      serve_mode: 'immediate',
      cook_time_ms: 600_000,
      created_at: T,
      updated_at: T,
      ...columns,
    };
    const keys = Object.keys(row);
    await pool.query(
      `INSERT INTO menu_items (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
      keys.map((key) => row[key]),
    );
  }

  it('[01a §10 #84] config_audit is insert-only and every new key and index leads with tenant_id', async () => {
    await pool.query(
      `INSERT INTO config_audit (tenant_id, audit_id, actor_kind, branch_id, entity, entity_id, action, after, at)
       VALUES ('t1', 'a1', 'cli', 'b1', 'branch_settings', 'b1', 'update', '{"tax_enabled":true}', $1)`,
      [T],
    );
    await expect(pool.query(`UPDATE config_audit SET at = at + 1 WHERE audit_id = 'a1'`)).rejects.toThrow(
      'config_audit is insert-only',
    );
    await expect(pool.query(`DELETE FROM config_audit WHERE audit_id = 'a1'`)).rejects.toThrow(
      'config_audit is insert-only',
    );

    const indexes = await pool.query<{ table_name: string; index_name: string; first_column: string }>(
      `SELECT t.relname AS table_name, i.relname AS index_name, a.attname AS first_column
         FROM pg_index x
         JOIN pg_class t ON t.oid = x.indrelid
         JOIN pg_class i ON i.oid = x.indexrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.indkey[0]
        WHERE n.nspname = 'public' AND t.relname = ANY($1)`,
      [NEW_TABLES],
    );
    expect(new Set(indexes.rows.map((row) => row.table_name))).toEqual(new Set(NEW_TABLES));
    for (const row of indexes.rows) {
      expect({ index: row.index_name, first: row.first_column }).toEqual({ index: row.index_name, first: 'tenant_id' });
    }
  });

  it('[01a §5.2] tax_class_id NULL accepted; stock_time_ms > cook_time_ms rejected; a slot station with freshness 0 rejected', async () => {
    await insertItem({ tax_class_id: null });
    await expect(
      insertItem({ item_id: 'i2', name: 'Naan', cook_time_ms: 60_000, stock_time_ms: 60_001 }),
    ).rejects.toMatchObject({ code: '23514' });
    await pool.query(
      `INSERT INTO points (tenant_id, branch_id, point_id, name, created_at, updated_at) VALUES ('t1', 'b1', 'p1', 'Pass', $1, $1)`,
      [T],
    );
    await expect(
      pool.query(
        `INSERT INTO stations (tenant_id, branch_id, station_id, point_id, name, station_type, capacity, freshness_window_ms, created_at, updated_at)
         VALUES ('t1', 'b1', 's1', 'p1', 'Karahi', 'slot', 4, 0, $1, $1)`,
        [T],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it("[01a §5.2, S44] stock 'piece' / sale 'g' rejected; equal units with stock_per_sale_unit 2 rejected", async () => {
    await expect(insertItem({ stock_unit: 'piece', sale_unit: 'g' })).rejects.toMatchObject({ code: '23514' });
    await expect(insertItem({ stock_unit: 'g', sale_unit: 'g', stock_per_sale_unit: 2 })).rejects.toMatchObject({
      code: '23514',
    });
    await insertItem({ stock_unit: 'g', sale_unit: 'piece', stock_per_sale_unit: 250 });
  });

  it('[01a §5.2, S47] a window with item_id and category_id both set, or start = end, rejected', async () => {
    await insertItem({});
    await expect(
      pool.query(
        `INSERT INTO availability_windows (tenant_id, window_id, item_id, category_id, start_ms, end_ms)
         VALUES ('t1', 'w1', 'i1', 'c1', 0, 60000)`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(
        `INSERT INTO availability_windows (tenant_id, window_id, item_id, start_ms, end_ms)
         VALUES ('t1', 'w2', 'i1', 60000, 60000)`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await pool.query(
      `INSERT INTO availability_windows (tenant_id, window_id, item_id, start_ms, end_ms)
       VALUES ('t1', 'w3', 'i1', 79200000, 7200000)`,
    );
  });

  it('[01a §5.2, S33] branches defaults 16 / 4; stale 4 with gap 4 rejected; no business_day_start_ms column', async () => {
    const row = await pool.query<{ day_stale_after_hours: number; day_min_gap_hours: number; config_version: string; tax_enabled: boolean }>(
      `SELECT day_stale_after_hours, day_min_gap_hours, config_version, tax_enabled FROM branches WHERE branch_id = 'b1'`,
    );
    expect(row.rows[0]).toEqual({ day_stale_after_hours: 16, day_min_gap_hours: 4, config_version: '1', tax_enabled: false });
    await expect(
      pool.query(`UPDATE branches SET day_stale_after_hours = 4, day_min_gap_hours = 4 WHERE branch_id = 'b1'`),
    ).rejects.toMatchObject({ code: '23514' });
    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'branches'`,
    );
    const names = columns.rows.map((c) => c.column_name);
    expect(names).not.toContain('business_day_start_ms');
    expect(names).not.toContain('config_epoch');
  });
});
