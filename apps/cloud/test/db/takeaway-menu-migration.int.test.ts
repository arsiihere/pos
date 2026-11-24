import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate';
import { fixedClock } from '../../src/lib/clock';
import { dropScratchDatabases, scratchDatabaseAt } from '../helpers/scratch-db';

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const now = 1_761_000_000_000;
let pool: pg.Pool;

beforeAll(async () => {
  ({ pool } = await scratchDatabaseAt(20));
  await pool.query("INSERT INTO tenants (tenant_id, name, currency_code, created_at) VALUES ('t', 'Pilot', 'PKR', $1)", [now]);
  await pool.query(
    `INSERT INTO branches (tenant_id, branch_id, name, status, config_version, created_at)
     VALUES ('t', 'b1', 'b1', 'pending_hub', 7, $1), ('t', 'b2', 'b2', 'pending_hub', 12, $1)`, [now],
  );
  await pool.query("INSERT INTO branch_engine_settings (tenant_id, branch_id, created_at, updated_at) VALUES ('t', 'b1', $1, $1)", [now]);
  await pool.query("INSERT INTO categories (tenant_id, category_id, name, created_at, updated_at) VALUES ('t', 'c', 'Mains', $1, $1)", [now]);
  await pool.query(
    `INSERT INTO menu_items (tenant_id, item_id, category_id, name, price_minor, serve_mode, cook_time_ms, created_at, updated_at)
     VALUES ('t', 'i1', 'c', 'Karahi', 500, 'immediate', 600000, $1, $1),
            ('t', 'i2', 'c', 'Naan', 500, 'immediate', 600000, $1, $1)`, [now],
  );
  await migrate(pool, migrationsDir, fixedClock(now));
}, 40_000);

afterAll(dropScratchDatabases, 40_000);

describe('[01a v2.11 §5.2c #206] takeaway menu migration', () => {
  it('sets defaults and bumps every branch once without auditing', async () => {
    expect((await pool.query('SELECT item_id, short_code FROM menu_items ORDER BY item_id')).rows).toEqual([
      { item_id: 'i1', short_code: null }, { item_id: 'i2', short_code: null },
    ]);
    expect((await pool.query('SELECT * FROM menu_item_companions')).rows).toEqual([]);
    expect((await pool.query('SELECT branch_id, config_version::int, business_day_end_local_ms FROM branches ORDER BY branch_id')).rows).toEqual([
      { branch_id: 'b1', config_version: 8, business_day_end_local_ms: 14_400_000 },
      { branch_id: 'b2', config_version: 13, business_day_end_local_ms: 14_400_000 },
    ]);
    await pool.query("INSERT INTO branch_engine_settings (tenant_id, branch_id, created_at, updated_at) VALUES ('t', 'b2', $1, $1)", [now]);
    expect((await pool.query('SELECT branch_id, rush_open_orders, takeaway_slip_on_send FROM branch_engine_settings ORDER BY branch_id')).rows).toEqual([
      { branch_id: 'b1', rush_open_orders: 15, takeaway_slip_on_send: true },
      { branch_id: 'b2', rush_open_orders: 15, takeaway_slip_on_send: true },
    ]);
    expect((await pool.query('SELECT * FROM config_audit')).rows).toEqual([]);
  });

  it('enforces the short-code format and active-only uniqueness', async () => {
    for (const code of ['HK', '4n', 'abcdefg']) {
      await expect(pool.query("UPDATE menu_items SET short_code = $1 WHERE item_id = 'i1'", [code]))
        .rejects.toMatchObject({ code: '23514' });
    }
    await pool.query("UPDATE menu_items SET short_code = 'hk' WHERE item_id = 'i1'");
    const setSecond = "UPDATE menu_items SET short_code = 'hk' WHERE item_id = 'i2'";
    await expect(pool.query(setSecond)).rejects.toMatchObject({ code: '23505', constraint: 'menu_items_active_short_code' });
    await pool.query("UPDATE menu_items SET archived_at = $1 WHERE item_id = 'i1'", [now]);
    await pool.query(setSecond);
  });

  it('enforces the companion row bounds and per-source uniqueness without a target FK', async () => {
    const add = (source: string, target: string, quantity: number, sortOrder: number) => pool.query(
      "INSERT INTO menu_item_companions VALUES ('t', $1, $2, $3, $4)", [source, target, quantity, sortOrder],
    );
    for (const [target, quantity, sortOrder] of [['i2', 0, 0], ['i2', 21, 0], ['i2', 1, 4], ['i2', 1, -1], ['i1', 1, 0]] as const) {
      await expect(add('i1', target, quantity, sortOrder)).rejects.toMatchObject({ code: '23514' });
    }
    await add('i1', 'i2', 20, 0);
    await expect(add('i1', 'i2', 1, 1)).rejects.toMatchObject({ code: '23505' });
    await expect(add('i1', 'another', 1, 0)).rejects.toMatchObject({ code: '23505' });
    await expect(add('missing-source', 'i2', 1, 0)).rejects.toMatchObject({ code: '23503' });
    await add('i1', 'missing-target', 1, 3);
  });

  it('enforces the branch setting bounds and whole minutes', async () => {
    for (const rush of [4, 101]) {
      await expect(pool.query("UPDATE branch_engine_settings SET rush_open_orders = $1 WHERE branch_id = 'b1'", [rush]))
        .rejects.toMatchObject({ code: '23514' });
    }
    for (const end of [-1, 12_600_001, 86_400_000]) {
      await expect(pool.query("UPDATE branches SET business_day_end_local_ms = $1 WHERE branch_id = 'b1'", [end]))
        .rejects.toMatchObject({ code: '23514' });
    }
    await pool.query("UPDATE branches SET business_day_end_local_ms = 86340000 WHERE branch_id = 'b1'");
  });
});
