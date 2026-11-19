import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandCtx } from '../../src/commands/registry';
import { openDb } from '../../src/db/connection';
import { runMigrations } from '../../src/db/migrate';
import { boot } from '../../src/lib/boot';
import { fixedClock, T } from '../../src/lib/clock';
import { orderLines, readOrder } from '../../src/orders/exports';
import { freshDb } from '../helpers/db';
import { statementCounter } from '../helpers/statement-counter';
import { offlineCloud } from '../helpers/stub-cloud';
import { stubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { append, appendOrder, FX, openDay } from '../kds/fixtures';

// 02b v1.0.16 §5 / §4.2 (05 row Q-1, with rows Q-5, Q-6; ⚠️ Changed by 05 (R-7, R-17)), 05 test #82, 05-plan §2B.4
// P0.12: hub migration 0021_orders_billing adds order_lines.tax_profile_id (= ItemAdded.tax_class_id) and
// order_lines.unit_price_minor (= round_half_up(line_total_minor ÷ units), floor((2t + u) ÷ (2u)); NULL while a weight
// is pending; set again by LineWeightSet), orders.carried_over and orders.bill_key (+ index orders_bill_key), replaces
// the unique orders_token by the non-unique orders_token_day, and deletes the `orders` checkpoint (refold, no UPDATE).

const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const MIGRATION = '0021_orders_billing.sql';

type Col = { cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number };
const colsOf = (db: Database.Database, table: string) => db.pragma(`table_info(${table})`) as Col[];
const indexSql = (db: Database.Database, name: string) => db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?").pluck().get(name) as string | undefined;
const checkpoint = (db: Database.Database, projection: string) => db.prepare('SELECT last_seq FROM projection_checkpoints WHERE projection = ?').pluck().get(projection) as number | undefined;
const rowsOf = (db: Database.Database) => db.prepare('SELECT * FROM order_lines ORDER BY order_item_id').all() as Array<Record<string, unknown>>;
const ordersOf = (db: Database.Database) => db.prepare('SELECT * FROM orders ORDER BY order_id').all() as Array<Record<string, unknown>>;
const billing = (db: Database.Database) =>
  Object.fromEntries(
    (db.prepare('SELECT order_item_id, tax_profile_id, unit_price_minor FROM order_lines ORDER BY order_item_id').all() as Array<{ order_item_id: string; tax_profile_id: string | null; unit_price_minor: number | null }>).map(
      (r) => [r.order_item_id, [r.tax_profile_id, r.unit_price_minor]],
    ),
  );

/** Back to a pre-0021 hub: 0021's columns and indexes gone, orders_token back, 0021 not applied; checkpoints as they were. */
function toPre0021(db: Database.Database): void {
  db.exec('DROP INDEX orders_bill_key; DROP INDEX orders_token_day');
  db.exec('CREATE UNIQUE INDEX orders_token ON orders (business_date, token) WHERE token IS NOT NULL');
  db.exec('ALTER TABLE orders DROP COLUMN bill_key; ALTER TABLE orders DROP COLUMN carried_over');
  db.exec('ALTER TABLE order_lines DROP COLUMN unit_price_minor; ALTER TABLE order_lines DROP COLUMN tax_profile_id');
  db.prepare('DELETE FROM migration_checksums WHERE version >= 21').run();
  db.pragma('user_version = 20');
}

/**
 * One order with every line kind (02b v1.0.16 §5 R-7 / R-17): K item × 3 with an odd total (10 001 → 3 334) and a
 * tax profile; R its option child × 2 (own total 5 → half up 3); N an untaxed naan; W a weighed fish (pending → NULL);
 * D a deal × 2 (240 001 → 120 001) with its parts (line_total 0 → 0, the deal's profile).
 */
function someOrders(hub: TestHub): { order_id: string } {
  openDay(hub, { stock: { [FX.stock]: 100_000 } });
  return appendOrder(hub, {
    order_type: 'takeaway',
    lines: [
      { order_item_id: 'K', item_id: FX.piece, quantity: 3, item: { tax_class_id: 'TP_GST', line_total_minor: 10_001 } },
      { order_item_id: 'R', option_id: FX.option, parent_order_item_id: 'K', quantity: 2, item: { quantity: 2, line_total_minor: 5, tax_class_id: 'TP_SIDE' } },
      { order_item_id: 'N', item_id: FX.naan, quantity: 2 },
      { order_item_id: 'W', item_id: FX.gram, item: { tax_class_id: 'TP_GST' } },
      { order_item_id: 'D', deal_id: FX.deal, quantity: 2, item: { tax_class_id: 'TP_DEAL', line_total_minor: 240_001 } },
      { order_item_id: 'P1', deal_part_id: FX.dealParts[0], parent_order_item_id: 'D', item: { tax_class_id: 'TP_DEAL' } },
      { order_item_id: 'P2', deal_part_id: FX.dealParts[1], parent_order_item_id: 'D', item: { tax_class_id: 'TP_DEAL' } },
    ],
  });
}

const EXPECTED_PENDING = {
  K: ['TP_GST', 3_334], // floor((2 × 10 001 + 3) ÷ 6) = 3 334 (10 001 / 3 = 3 333.67)
  R: ['TP_SIDE', 3], // option_child: its own total 5 ÷ 2 units = 2.5 → half up 3
  N: [null, 3_000], // untaxed item: NULL profile; 6 000 ÷ 2
  W: ['TP_GST', null], // weight pending: no total, no unit price
  D: ['TP_DEAL', 120_001], // deal: 240 001 ÷ 2 = 120 000.5 → 120 001
  P1: ['TP_DEAL', 0], // deal_part: line_total 0 → 0, the deal's profile (never used, base 0)
  P2: ['TP_DEAL', 0],
};

describe('[05 #82] hub migration 0021_orders_billing (02b v1.0.16 §5; 05 rows Q-1, Q-5, Q-6; R-7, R-17)', () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('[05 #82] a 0020 database migrates to 0021: the four columns, orders_token gone, orders_token_day + orders_bill_key; only the orders checkpoint deleted; no data UPDATE', async () => {
    const handle = freshDb();
    cleanups.push(handle.cleanup);
    const { db, dir } = handle;
    await runMigrations(db, { dir: copyUpTo(dir, '0020'), clock: fixedClock(T) });
    db.prepare(
      "INSERT INTO order_lines (order_item_id, order_id, line_kind, name, sale_unit, units, line_total_minor, added_at, is_food) VALUES ('L1', 'O1', 'item', 'Naan', 'piece', 2, 6000, 1, 1)",
    ).run();
    const placeOrder = db.prepare(
      `INSERT INTO orders (order_id, order_type, table_key, business_date, token, placed_by, placed_at, follow_up)
       VALUES (?, 'takeaway', ?, '2026-11-19', 56, 'S_WAIT', 1, 0)`,
    );
    placeOrder.run('O1', 'takeaway:O1');
    expect(() => placeOrder.run('O2', 'takeaway:O2'), 'before 0021 a (date, 56) token is unique').toThrow(/UNIQUE/);
    const cp = db.prepare('INSERT INTO projection_checkpoints (branch_id, projection, last_seq) VALUES (?, ?, ?)');
    for (const projection of ['orders', 'tables', 'kitchen_tickets', 'audit']) cp.run('branch-1', projection, 42);
    const others = db.prepare("SELECT * FROM projection_checkpoints WHERE projection <> 'orders' ORDER BY projection").all();

    const result = await runMigrations(db, { dir: copyUpTo(dir, '0021'), clock: fixedClock(T) });
    expect(result).toEqual({ from: 20, to: 21, applied: [MIGRATION] });
    expect(db.pragma('user_version', { simple: true })).toBe(21);

    const lineCols = colsOf(db, 'order_lines');
    expect(lineCols.slice(-2)).toEqual([
      { cid: lineCols.length - 2, name: 'tax_profile_id', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
      { cid: lineCols.length - 1, name: 'unit_price_minor', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 0 },
    ]);
    const orderCols = colsOf(db, 'orders');
    expect(orderCols.slice(-2)).toEqual([
      { cid: orderCols.length - 2, name: 'bill_key', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
      { cid: orderCols.length - 1, name: 'carried_over', type: 'INTEGER', notnull: 1, dflt_value: '0', pk: 0 },
    ]);
    expect(() => db.prepare("UPDATE orders SET carried_over = 2 WHERE order_id = 'O1'").run(), 'carried_over CHECK (0,1)').toThrow(/CHECK/);

    expect(indexSql(db, 'orders_token'), 'the unique orders_token is gone').toBeUndefined();
    expect(indexSql(db, 'orders_token_day')).toBe('CREATE INDEX orders_token_day ON orders (business_date, token) WHERE token IS NOT NULL');
    expect(indexSql(db, 'orders_bill_key')).toBe('CREATE INDEX orders_bill_key ON orders (bill_key)');
    const unique = db.prepare("SELECT name, \"unique\", partial FROM pragma_index_list('orders') WHERE name = 'orders_token_day'").get();
    expect(unique).toEqual({ name: 'orders_token_day', unique: 0, partial: 1 });
    placeOrder.run('O2', 'takeaway:O2');
    expect(db.prepare("SELECT COUNT(*) FROM orders WHERE business_date = '2026-11-19' AND token = 56").pluck().get(), 'two (date, 56) tokens accepted').toBe(2);

    expect(db.prepare("SELECT tax_profile_id, unit_price_minor FROM order_lines WHERE order_item_id = 'L1'").get(), 'no backfill UPDATE').toEqual({ tax_profile_id: null, unit_price_minor: null });
    expect(db.prepare("SELECT bill_key, carried_over FROM orders WHERE order_id = 'O1'").get()).toEqual({ bill_key: null, carried_over: 0 });
    expect(checkpoint(db, 'orders'), 'orders checkpoint deleted → refold from 0').toBeUndefined();
    expect(db.prepare("SELECT * FROM projection_checkpoints WHERE projection <> 'orders' ORDER BY projection").all()).toEqual(others);
    expect(await runMigrations(db, { dir: copyUpTo(dir, '0021b'), clock: fixedClock(T + 1) })).toEqual({ from: 21, to: 21, applied: [] });
  });

  it('[05 #82] [05 P0.G G-14] the fold writes tax_profile_id and unit_price_minor per line kind (item, option_child, weighed pending → LineWeightSet, deal, deal_part); LineView and ReadOrderLine carry both in the same statements', async () => {
    const hub = await createTestHub({ provisioned: true });
    cleanups.push(() => hub.close());
    const o = someOrders(hub);
    expect(billing(hub.deps.db)).toEqual(EXPECTED_PENDING);

    // §3.4 Weights: the weighed line has 1 unit, so its unit price is its whole weighed total (odd on purpose).
    append(hub, [{ stream_type: 'order', stream_id: o.order_id, event_type: 'LineWeightSet', payload: { order_item_id: 'W', quantity: 450, line_total_minor: 180_001 } }]);
    const expected = { ...EXPECTED_PENDING, W: ['TP_GST', 180_001] };
    expect(billing(hub.deps.db)).toEqual(expected);

    const counter = statementCounter(hub.deps.db);
    counter.reset();
    const views = orderLines(hub.deps.db, [o.order_id]).get(o.order_id)!;
    expect(counter.count, 'orderLines: still 1 statement').toBe(1);
    expect(Object.fromEntries(views.map((l) => [l.order_item_id, [l.tax_profile_id, l.unit_price_minor]]))).toEqual(expected);

    const read = hub.deps.writer.run((tx) => {
      counter.reset();
      const r = readOrder({ tx } as unknown as CommandCtx, o.order_id);
      return { r, statements: counter.count };
    }).result;
    expect(read.statements, 'readOrder: still 1 statement').toBe(1);
    expect(Object.fromEntries(read.r.lines.map((l) => [l.order_item_id, [l.tax_profile_id, l.unit_price_minor]]))).toEqual(expected);
  });

  it('[05 #82] [05 P0.G G-14] a real boot() over a pre-0021 database (forced boot-time ClockAlarm) refolds orders from seq 0: every line and order equals the live fold (rebuild = live)', async () => {
    const hub = await createTestHub({ provisioned: true });
    cleanups.push(() => hub.close());
    const o = someOrders(hub);
    append(hub, [{ stream_type: 'order', stream_id: o.order_id, event_type: 'LineWeightSet', payload: { order_item_id: 'W', quantity: 450, line_total_minor: 180_001 } }]);
    const liveLines = rowsOf(hub.deps.db);
    const liveOrders = ordersOf(hub.deps.db);
    expect(billing(hub.deps.db)).toEqual({ ...EXPECTED_PENDING, W: ['TP_GST', 180_001] });
    const lastRecordedAt = hub.deps.db.prepare('SELECT MAX(recorded_at) FROM events').pluck().get() as number;
    const maxSeq = hub.deps.db.prepare('SELECT MAX(seq) FROM events').pluck().get() as number;

    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    const file = join(cfg.dataDir, 'hub.sqlite');
    hub.deps.db.prepare('VACUUM INTO ?').run(file);
    const copy = openDb(file);
    toPre0021(copy);
    expect(checkpoint(copy, 'orders')).toBe(maxSeq);
    expect(checkpoint(copy, 'kitchen_tickets')).toBe(maxSeq);
    expect((await runMigrations(copy, { dir: migrations, clock: fixedClock(T) })).applied).toEqual([MIGRATION]);
    expect(checkpoint(copy, 'orders')).toBeUndefined();
    expect(checkpoint(copy, 'kitchen_tickets'), '0021 keeps the kitchen_tickets checkpoint row').toBe(maxSeq);
    expect(copy.prepare("SELECT COUNT(*) FROM order_lines WHERE tax_profile_id IS NOT NULL OR unit_price_minor IS NOT NULL").pluck().get(), 'no UPDATE: the refold fills them').toBe(0);
    copy.close();

    const wall = lastRecordedAt - 60_000; // the wall clock behind the last event: boot step 3a writes ClockAlarm
    const booted = await boot({ configPath: cfg.path, wallNow: () => wall, monoNow: () => 0, configClient: stubConfigCloud(), cloudClient: offlineCloud(), logStream: quiet() });
    cleanups.push(() => booted.stop());
    const db = booted.deps.db;
    expect(db.pragma('user_version', { simple: true })).toBe(21);
    expect(db.prepare('SELECT event_type FROM events WHERE seq > ? ORDER BY seq').pluck().all(maxSeq)[0], 'boot wrote ClockAlarm before its catch-up').toBe('ClockAlarm');
    expect(rowsOf(db), 'every old line has tax_profile_id and unit_price_minor; rows equal the live fold').toEqual(liveLines);
    expect(ordersOf(db), 'orders rows equal the live fold').toEqual(liveOrders);
    expect(checkpoint(db, 'orders')).toBeGreaterThanOrEqual(maxSeq);
  });
});

const quiet = (): Writable => new Writable({ write: (_chunk, _enc, done) => done() });

function copyUpTo(parent: string, last: string): string {
  const target = join(parent, `migrations-${last}`);
  mkdirSync(target);
  for (const name of readdirSync(migrations)) {
    if (name.endsWith('.sql') && name.slice(0, 4) <= last.slice(0, 4)) copyFileSync(join(migrations, name), join(target, name));
  }
  return target;
}

/** A provisioned hub config for the test hub's tenant / branch (as test/boot/boot.int.test.ts). */
function writeConfig(): { path: string; dataDir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pos-0021-'));
  const dataDir = join(dir, 'data');
  const backupDir = join(dir, 'backup');
  mkdirSync(dataDir);
  mkdirSync(backupDir);
  const path = join(dir, 'config.json');
  writeFileSync(
    path,
    JSON.stringify({
      cloud_base_url: 'https://cloud.example',
      http_port: 3000,
      data_dir: dataDir,
      backup_dir: backupDir,
      min_client_version: '1.0.0',
      backup_encryption_key: Buffer.alloc(32, 7).toString('base64'),
      advertised_host: '192.168.10.2',
      provisioned: { tenant_id: 'tenant-a', branch_id: 'branch-1', branch_name: 'Main', branch_api_key: 'test-branch-api-key' },
    }),
  );
  return { path, dataDir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
