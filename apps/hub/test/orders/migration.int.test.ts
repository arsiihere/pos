import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate';
import { fixedClock, T } from '../../src/lib/clock';
import { freshDb } from '../helpers/db';

const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

// §5 index statements, verbatim (sqlite_master keeps the CREATE text as written).
const INDEXES: Record<string, string> = {
  orders_token: 'CREATE UNIQUE INDEX orders_token ON orders (business_date, token) WHERE token IS NOT NULL',
  orders_open:
    'CREATE INDEX orders_open ON orders (order_type, placed_at)\n  WHERE billed_at IS NULL AND cancelled_at IS NULL AND day_closed_at IS NULL',
  order_lines_order: 'CREATE INDEX order_lines_order ON order_lines (order_id)',
};

type Col = [name: string, type: string, notNull: number, dflt: string | null, pk: number];
const COLUMNS: Record<string, Col[]> = {
  orders: [
    ['order_id', 'TEXT', 0, null, 1],
    ['order_type', 'TEXT', 1, null, 0],
    ['table_key', 'TEXT', 1, null, 0],
    ['business_date', 'TEXT', 1, null, 0],
    ['token', 'INTEGER', 0, null, 0],
    ['car_number', 'TEXT', 0, null, 0],
    ['car_type', 'TEXT', 0, null, 0],
    ['customer_name', 'TEXT', 0, null, 0],
    ['phone', 'TEXT', 0, null, 0],
    ['order_note', 'TEXT', 0, null, 0],
    ['placed_by', 'TEXT', 1, null, 0],
    ['placed_at', 'INTEGER', 1, null, 0],
    ['follow_up', 'INTEGER', 1, null, 0],
    ['cancelled_at', 'INTEGER', 0, null, 0],
    ['billed_at', 'INTEGER', 0, null, 0],
    ['day_closed_at', 'INTEGER', 0, null, 0],
    ['sent_after_reconnect', 'INTEGER', 1, '0', 0],
  ],
  order_lines: [
    ['order_item_id', 'TEXT', 0, null, 1],
    ['order_id', 'TEXT', 1, null, 0],
    ['parent_order_item_id', 'TEXT', 0, null, 0],
    ['line_kind', 'TEXT', 1, null, 0],
    ['item_id', 'TEXT', 0, null, 0],
    ['deal_id', 'TEXT', 0, null, 0],
    ['name', 'TEXT', 1, null, 0],
    ['sale_unit', 'TEXT', 1, null, 0],
    ['quantity', 'INTEGER', 0, null, 0],
    ['units', 'INTEGER', 1, null, 0],
    ['line_total_minor', 'INTEGER', 0, null, 0],
    ['refundable_minor', 'INTEGER', 1, '0', 0],
    ['removed_units', 'INTEGER', 1, '0', 0],
    ['removed_minor', 'INTEGER', 1, '0', 0],
    ['voided_units', 'INTEGER', 1, '0', 0],
    ['refund_minor', 'INTEGER', 1, '0', 0],
    ['comped_units', 'INTEGER', 1, '0', 0],
    ['comp_minor', 'INTEGER', 1, '0', 0],
    ['comp_voided_minor', 'INTEGER', 1, '0', 0],
    ['returned_units', 'INTEGER', 1, '0', 0],
    ['return_of', 'TEXT', 0, null, 0],
    ['served_from_zone_id', 'TEXT', 0, null, 0],
    ['added_at', 'INTEGER', 1, null, 0],
    ['served_at', 'INTEGER', 0, null, 0],
    ['served_source', 'TEXT', 0, null, 0],
    ['is_food', 'INTEGER', 1, null, 0],
    ['kitchen_note', 'TEXT', 0, null, 0],
  ],
  zone_stock: [
    ['zone_id', 'TEXT', 1, null, 1],
    ['item_id', 'TEXT', 1, null, 2],
    ['on_hand', 'INTEGER', 1, null, 0],
  ],
};

const ORDER =
  'INSERT INTO orders (order_id, order_type, table_key, business_date, placed_by, placed_at, follow_up';
const LINE =
  'INSERT INTO order_lines (order_item_id, order_id, line_kind, name, sale_unit, units, added_at, is_food';

describe('hub migration 0013_orders', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('[02b §5] 0013 creates orders, order_lines, zone_stock with the §5 columns, CHECKs and three indexes', async () => {
    const db = await fresh();
    for (const [table, columns] of Object.entries(COLUMNS)) {
      const rows = db.pragma(`table_info(${table})`) as Array<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>;
      expect(rows.map((r) => [r.name, r.type, r.notnull, r.dflt_value, r.pk]), table).toEqual(columns);
    }
    const indexes = db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('orders','order_lines','zone_stock') AND sql IS NOT NULL ORDER BY name")
      .all() as Array<{ name: string; sql: string }>;
    expect(Object.fromEntries(indexes.map((i) => [i.name, i.sql]))).toEqual(INDEXES);
    const partial = Object.fromEntries(
      (db.pragma('index_list(orders)') as Array<{ name: string; unique: number; partial: number }>).map((i) => [i.name, [i.unique, i.partial]]),
    );
    expect(partial.orders_token).toEqual([1, 1]);
    expect(partial.orders_open).toEqual([0, 1]);

    // orders: order_type, car_type, follow_up, sent_after_reconnect CHECKs.
    ['dine_in', 'takeaway', 'parking'].forEach((type, i) => db.prepare(`${ORDER}) VALUES (?, ?, 'K', '2026-11-10', 'W1', 1, 0)`).run(`O${i}`, type));
    expect(db.prepare("SELECT sent_after_reconnect FROM orders WHERE order_id = 'O0'").pluck().get()).toBe(0);
    for (const type of ['delivery', 'DINE_IN', '']) {
      expect(() => db.prepare(`${ORDER}) VALUES ('OX', ?, 'K', '2026-11-10', 'W1', 1, 0)`).run(type), type).toThrow(/CHECK constraint failed/);
    }
    ['sedan', 'mini', 'large'].forEach((car, i) => db.prepare(`${ORDER}, car_type) VALUES (?, 'parking', 'K', '2026-11-10', 'W1', 1, 0, ?)`).run(`P${i}`, car));
    for (const car of ['suv', 'SEDAN', '']) {
      expect(() => db.prepare(`${ORDER}, car_type) VALUES ('PX', 'parking', 'K', '2026-11-10', 'W1', 1, 0, ?)`).run(car), car).toThrow(/CHECK constraint failed/);
    }
    expect(() => db.prepare(`${ORDER}) VALUES ('OF', 'takeaway', 'K', '2026-11-10', 'W1', 1, 2)`).run()).toThrow(/CHECK constraint failed/);
    expect(() => db.prepare(`${ORDER}, sent_after_reconnect) VALUES ('OS', 'takeaway', 'K', '2026-11-10', 'W1', 1, 0, 2)`).run()).toThrow(/CHECK constraint failed/);

    // orders_token: one token per business day; NULL tokens never collide.
    db.prepare(`${ORDER}, token) VALUES ('T1', 'takeaway', 'K', '2026-11-10', 'W1', 1, 0, 1)`).run();
    db.prepare(`${ORDER}, token) VALUES ('T2', 'takeaway', 'K', '2026-11-11', 'W1', 1, 0, 1)`).run();
    expect(() => db.prepare(`${ORDER}, token) VALUES ('T3', 'takeaway', 'K', '2026-11-10', 'W1', 1, 0, 1)`).run()).toThrow(/UNIQUE constraint failed/);

    // order_lines: line_kind, served_source, is_food CHECKs; ledger defaults are 0.
    ['item', 'option_child', 'deal', 'deal_part'].forEach((kind, i) => db.prepare(`${LINE}) VALUES (?, 'O0', ?, 'N', 'plate', 1, 1, 1)`).run(`L${i}`, kind));
    expect(
      db.prepare("SELECT refundable_minor, removed_units, removed_minor, voided_units, refund_minor, comped_units, comp_minor, comp_voided_minor, returned_units FROM order_lines WHERE order_item_id = 'L0'").get(),
    ).toEqual({ refundable_minor: 0, removed_units: 0, removed_minor: 0, voided_units: 0, refund_minor: 0, comped_units: 0, comp_minor: 0, comp_voided_minor: 0, returned_units: 0 });
    for (const kind of ['option', 'ITEM', '']) {
      expect(() => db.prepare(`${LINE}) VALUES ('LX', 'O0', ?, 'N', 'plate', 1, 1, 1)`).run(kind), kind).toThrow(/CHECK constraint failed/);
    }
    ['tap', 'estimated', 'zone'].forEach((src, i) => db.prepare(`${LINE}, served_at, served_source) VALUES (?, 'O0', 'item', 'N', 'plate', 1, 1, 1, 2, ?)`).run(`S${i}`, src));
    for (const src of ['manual', 'TAP', '']) {
      expect(() => db.prepare(`${LINE}, served_source) VALUES ('SX', 'O0', 'item', 'N', 'plate', 1, 1, 1, ?)`).run(src), src).toThrow(/CHECK constraint failed/);
    }
    expect(() => db.prepare(`${LINE}) VALUES ('LF', 'O0', 'item', 'N', 'plate', 1, 1, 2)`).run()).toThrow(/CHECK constraint failed/);
    expect(() => db.prepare(`${LINE}) VALUES ('LN', 'O0', 'item', 'N', 'plate', NULL, 1, 1)`).run()).toThrow(/NOT NULL constraint failed/);

    // zone_stock: one row per (zone, item).
    db.prepare("INSERT INTO zone_stock (zone_id, item_id, on_hand) VALUES ('Z1', 'I1', 0)").run();
    expect(() => db.prepare("INSERT INTO zone_stock (zone_id, item_id, on_hand) VALUES ('Z1', 'I1', 3)").run()).toThrow(/UNIQUE constraint failed/);
  });

  it('[02b §5] the ledger CHECKs refuse a bad row', async () => {
    const db = await fresh();
    const line = (id: string, cols: Record<string, number>): void => {
      const names = Object.keys(cols);
      db.prepare(`${LINE}${names.map((n) => `, ${n}`).join('')}) VALUES (?, 'O1', 'item', 'N', 'plate', 4, 1, 1${names.map(() => ', ?').join('')})`).run(id, ...Object.values(cols));
    };
    // removed_units + voided_units <= units (units = 4).
    line('A_ok', { removed_units: 2, voided_units: 2 });
    expect(() => line('A_bad', { removed_units: 3, voided_units: 2 })).toThrow(/CHECK constraint failed/);
    // comped_units <= units - removed_units - voided_units.
    line('B_ok', { removed_units: 1, voided_units: 1, comped_units: 2 });
    expect(() => line('B_bad', { removed_units: 1, voided_units: 1, comped_units: 3 })).toThrow(/CHECK constraint failed/);
    // comp_minor + comp_voided_minor + removed_minor + refund_minor <= refundable_minor.
    line('C_ok', { refundable_minor: 1000, comp_minor: 250, comp_voided_minor: 250, removed_minor: 250, refund_minor: 250 });
    expect(() => line('C_bad', { refundable_minor: 1000, comp_minor: 250, comp_voided_minor: 250, removed_minor: 250, refund_minor: 251 })).toThrow(/CHECK constraint failed/);
    expect(() => line('C_zero', { comp_minor: 1 })).toThrow(/CHECK constraint failed/); // refundable_minor defaults to 0
    // The ledger CHECKs hold on UPDATE too (every fold is an UPDATE).
    expect(() => db.prepare("UPDATE order_lines SET voided_units = voided_units + 1 WHERE order_item_id = 'A_ok'").run()).toThrow(/CHECK constraint failed/);
    expect(() => db.prepare("UPDATE order_lines SET refund_minor = refund_minor + 1 WHERE order_item_id = 'C_ok'").run()).toThrow(/CHECK constraint failed/);
    // zone_stock.on_hand >= 0.
    db.prepare("INSERT INTO zone_stock (zone_id, item_id, on_hand) VALUES ('Z1', 'I1', 0)").run();
    expect(() => db.prepare("INSERT INTO zone_stock (zone_id, item_id, on_hand) VALUES ('Z1', 'I2', -1)").run()).toThrow(/CHECK constraint failed/);
    expect(() => db.prepare("UPDATE zone_stock SET on_hand = on_hand - 1 WHERE zone_id = 'Z1' AND item_id = 'I1'").run()).toThrow(/CHECK constraint failed/);
  });

  it('[02b §5] a fresh DB migrates 0001→0013; re-run is a no-op', async () => {
    const handle = freshDb();
    cleanups.push(handle.cleanup);
    const { db, dir } = handle;
    const upTo = copyUpTo(dir, '0013');
    const first = await runMigrations(db, { dir: upTo, clock: fixedClock(T) });
    expect(first.from).toBe(0);
    expect(first.to).toBe(13);
    expect(first.applied).toHaveLength(13);
    expect(first.applied[12]).toBe('0013_orders.sql');
    expect(db.pragma('user_version', { simple: true })).toBe(13);
    const schema = (): unknown => db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all();
    const before = schema();
    const again = await runMigrations(db, { dir: upTo, clock: fixedClock(T + 1) });
    expect(again).toEqual({ from: 13, to: 13, applied: [] });
    expect(schema()).toEqual(before);
    expect(db.prepare('SELECT COUNT(*) FROM migration_checksums').pluck().get()).toBe(13);
  });

  async function fresh(): Promise<Database.Database> {
    const handle = freshDb();
    cleanups.push(handle.cleanup);
    await runMigrations(handle.db, { dir: copyUpTo(handle.dir, '0013'), clock: fixedClock(T) });
    expect(handle.db.pragma('user_version', { simple: true })).toBe(13);
    return handle.db;
  }
});

function copyUpTo(parent: string, last: string): string {
  const target = join(parent, `migrations-${last}`);
  mkdirSync(target);
  for (const name of readdirSync(migrations)) {
    if (name.endsWith('.sql') && name.slice(0, 4) <= last) copyFileSync(join(migrations, name), join(target, name));
  }
  return target;
}
