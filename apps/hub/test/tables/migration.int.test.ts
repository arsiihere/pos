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
  seatings_open: "CREATE INDEX seatings_open ON seatings (state) WHERE state <> 'CLOSED'",
  seating_tables_seating: 'CREATE INDEX seating_tables_seating ON seating_tables (seating_id)',
  seating_orders_seating: 'CREATE INDEX seating_orders_seating ON seating_orders (seating_id)',
  table_locks_seating: 'CREATE INDEX table_locks_seating ON table_locks (seating_id)',
};

type Col = [name: string, type: string, notNull: number, dflt: string | null, pk: number];
const COLUMNS: Record<string, Col[]> = {
  seatings: [
    ['seating_id', 'TEXT', 0, null, 1],
    ['primary_table_id', 'TEXT', 1, null, 0],
    ['state', 'TEXT', 1, null, 0],
    ['holder_staff_id', 'TEXT', 1, null, 0],
    ['party_size', 'INTEGER', 0, null, 0],
    ['opened_at', 'INTEGER', 1, null, 0],
    ['bill_requested_at', 'INTEGER', 0, null, 0],
    ['bill_closed', 'INTEGER', 1, '0', 0],
    ['closed_at', 'INTEGER', 0, null, 0],
    ['close_reason', 'TEXT', 0, null, 0],
  ],
  seating_tables: [
    ['table_id', 'TEXT', 0, null, 1],
    ['seating_id', 'TEXT', 1, null, 0],
    ['joined_at', 'INTEGER', 1, null, 0],
  ],
  seating_orders: [
    ['order_id', 'TEXT', 0, null, 1],
    ['seating_id', 'TEXT', 1, null, 0],
    ['served_any', 'INTEGER', 1, '0', 0],
    ['has_food', 'INTEGER', 1, '1', 0],
    ['cancelled', 'INTEGER', 1, '0', 0],
  ],
  table_locks: [
    ['table_id', 'TEXT', 0, null, 1],
    ['seating_id', 'TEXT', 1, null, 0],
    ['staff_id', 'TEXT', 1, null, 0],
    ['device_id', 'TEXT', 1, null, 0],
    ['locked_at', 'INTEGER', 1, null, 0],
    ['last_activity_at', 'INTEGER', 1, null, 0],
    ['last_touch_at', 'INTEGER', 0, null, 0],
  ],
};

const SEATING = 'INSERT INTO seatings (seating_id, primary_table_id, state, holder_staff_id, opened_at';

describe('hub migration 0012_tables', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('[02a §5] 0012 creates seatings, seating_tables, seating_orders, table_locks with the §5 columns, CHECKs and four indexes', async () => {
    const db = await fresh();
    for (const [table, columns] of Object.entries(COLUMNS)) {
      const rows = db.pragma(`table_info(${table})`) as Array<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>;
      expect(rows.map((r) => [r.name, r.type, r.notnull, r.dflt_value, r.pk]), table).toEqual(columns);
    }
    const indexes = db
      .prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('seatings','seating_tables','seating_orders','table_locks') AND sql IS NOT NULL ORDER BY name")
      .all() as Array<{ name: string; sql: string }>;
    expect(Object.fromEntries(indexes.map((i) => [i.name, i.sql]))).toEqual(INDEXES);
    const partial = (db.pragma('index_list(seatings)') as Array<{ name: string; partial: number }>).find((i) => i.name === 'seatings_open');
    expect(partial?.partial).toBe(1);
    // The 0/1 flag CHECKs.
    db.prepare(`${SEATING}) VALUES ('S1','T1','SEATED','W1',1)`).run();
    expect(db.prepare("SELECT bill_closed FROM seatings WHERE seating_id = 'S1'").pluck().get()).toBe(0);
    expect(() => db.prepare(`${SEATING}, bill_closed) VALUES ('S2','T2','SEATED','W1',1,2)`).run()).toThrow(/CHECK constraint failed/);
    db.prepare("INSERT INTO seating_orders (order_id, seating_id) VALUES ('O1','S1')").run();
    expect(db.prepare("SELECT served_any, has_food, cancelled FROM seating_orders WHERE order_id = 'O1'").get()).toEqual({
      served_any: 0,
      has_food: 1,
      cancelled: 0,
    });
    for (const col of ['served_any', 'has_food', 'cancelled']) {
      expect(() => db.prepare(`INSERT INTO seating_orders (order_id, seating_id, ${col}) VALUES ('O_${col}','S1',2)`).run(), col).toThrow(/CHECK constraint failed/);
    }
    // One open seating per table (T2), one lock per primary table.
    db.prepare("INSERT INTO seating_tables (table_id, seating_id, joined_at) VALUES ('T1','S1',1)").run();
    expect(() => db.prepare("INSERT INTO seating_tables (table_id, seating_id, joined_at) VALUES ('T1','S9',2)").run()).toThrow(/UNIQUE constraint failed/);
    db.prepare("INSERT INTO table_locks (table_id, seating_id, staff_id, device_id, locked_at, last_activity_at) VALUES ('T1','S1','W1','D1',1,1)").run();
    expect(db.prepare("SELECT last_touch_at FROM table_locks WHERE table_id = 'T1'").pluck().get()).toBeNull();
    expect(() => db.prepare("INSERT INTO table_locks (table_id, seating_id, staff_id, device_id, locked_at, last_activity_at) VALUES ('T1','S1','W2','D2',2,2)").run()).toThrow(/UNIQUE constraint failed/);
  });

  it('[02a §5] seatings.state CHECK refuses an unknown state; close_reason CHECK', async () => {
    const db = await fresh();
    const states = ['SEATED', 'ORDERED', 'FOOD_ON_TABLE', 'BILL_REQUESTED', 'NEEDS_CLEANING', 'CLOSED'];
    states.forEach((state, i) => db.prepare(`${SEATING}) VALUES (?, 'T', ?, 'W1', 1)`).run(`S${i}`, state));
    for (const state of ['OPEN', 'seated', 'AVAILABLE', 'LOCKED', '']) {
      expect(() => db.prepare(`${SEATING}) VALUES ('SX', 'T', ?, 'W1', 1)`).run(state), state).toThrow(/CHECK constraint failed/);
    }
    expect(() => db.prepare(`${SEATING}) VALUES ('SN', 'T', NULL, 'W1', 1)`).run()).toThrow(/NOT NULL constraint failed/);
    ['cleaned', 'left_without_order', 'merged'].forEach((reason, i) =>
      db.prepare(`${SEATING}, closed_at, close_reason) VALUES (?, 'T', 'CLOSED', 'W1', 1, 2, ?)`).run(`C${i}`, reason),
    );
    db.prepare(`${SEATING}, close_reason) VALUES ('CN', 'T', 'SEATED', 'W1', 1, NULL)`).run();
    for (const reason of ['split', 'archived', 'CLEANED', '']) {
      expect(() => db.prepare(`${SEATING}, close_reason) VALUES ('CX', 'T', 'CLOSED', 'W1', 1, ?)`).run(reason), reason).toThrow(/CHECK constraint failed/);
    }
  });

  it('[02a §5] a fresh DB migrates 0001→0012; re-run is a no-op', async () => {
    const handle = freshDb();
    cleanups.push(handle.cleanup);
    const { db, dir } = handle;
    const upTo = copyUpTo(dir, '0012');
    const first = await runMigrations(db, { dir: upTo, clock: fixedClock(T) });
    expect(first.from).toBe(0);
    expect(first.to).toBe(12);
    expect(first.applied).toHaveLength(12);
    expect(first.applied[11]).toBe('0012_tables.sql');
    expect(db.pragma('user_version', { simple: true })).toBe(12);
    const schema = (): unknown => db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all();
    const before = schema();
    const again = await runMigrations(db, { dir: upTo, clock: fixedClock(T + 1) });
    expect(again).toEqual({ from: 12, to: 12, applied: [] });
    expect(schema()).toEqual(before);
    expect(db.prepare('SELECT COUNT(*) FROM migration_checksums').pluck().get()).toBe(12);
  });

  async function fresh(): Promise<Database.Database> {
    const handle = freshDb();
    cleanups.push(handle.cleanup);
    await runMigrations(handle.db, { dir: copyUpTo(handle.dir, '0012'), clock: fixedClock(T) });
    expect(handle.db.pragma('user_version', { simple: true })).toBe(12);
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
