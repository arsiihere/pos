import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/connection';
import { runMigrations } from '../../src/db/migrate';
import { boot } from '../../src/lib/boot';
import { fixedClock, T } from '../../src/lib/clock';
import { ORDERS_EVENT_TYPES } from '../../src/orders/projection';
import { freshDb } from '../helpers/db';
import { offlineCloud } from '../helpers/stub-cloud';
import { stubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { append, appendOrder, FX, openDay, openSeating } from '../kds/fixtures';

// 02b v1.0.25 §5 (R1, R3, R4, R9; run 2 R2-M-6; run 3 R3-M-1, R3-M-8; verify V-04; plan B1-2), test 65: hub migration
// 0029_orders_takeaway adds the eight takeaway / approval columns, the group tracking cutoff and three indexes, and
// deletes the `orders` checkpoint, so the next boot refolds from seq 0 (00 v1.10 H-2). Folds: OrderPlaced →
// pickup_at_ms; OrderBoosted → pickup_boosted for a pickup order (the time kept); OrderContactSet → phone_key;
// ItemAdded → option_id, deal_part_id, option_refs_json. (UnpaidHandoverApproved / OpenOrderBillChanged fill and clear
// the approval columns: plan U-1.)

const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const MIGRATION = '0029_orders_takeaway.sql';
const NEW_ORDER_COLUMNS = ['pickup_at_ms', 'pickup_boosted', 'phone_key', 'unpaid_handover_approved_at', 'unpaid_handover_approved_due_minor', 'tracking_close_cutoff_ms'];
const NEW_LINE_COLUMNS = ['option_id', 'deal_part_id', 'option_refs_json'];
const NEW_INDEXES = ['orders_open_takeaway_paid', 'orders_phone', 'orders_placed'];

const checkpoint = (db: Database.Database, projection: string) => db.prepare('SELECT last_seq FROM projection_checkpoints WHERE projection = ?').pluck().get(projection) as number | undefined;
const columns = (db: Database.Database, table: string) => (db.pragma(`table_info(${table})`) as Array<{ name: string; type: string; notnull: number; dflt_value: string | null }>);
const orderRows = (db: Database.Database) => db.prepare('SELECT * FROM orders ORDER BY order_id').all() as Array<Record<string, unknown>>;
const lineRows = (db: Database.Database) => db.prepare('SELECT * FROM order_lines ORDER BY order_item_id').all() as Array<Record<string, unknown>>;

/** A pickup takeaway with a contact and a Boost, a plain takeaway, and a dine-in order with an option child and a deal. */
function someOrders(hub: TestHub): { pickup: string; plain: string; pickupAt: number } {
  openDay(hub, { stock: { [FX.stock]: 100_000 } });
  const pickupAt = hub.clock.branchNow() + 3_600_000;
  const pickup = appendOrder(hub, { order_type: 'takeaway', pickup_at_ms: pickupAt, lines: [{ order_item_id: 'TP', item_id: FX.naan }] }).order_id;
  append(hub, [{ stream_type: 'order', stream_id: pickup, event_type: 'OrderContactSet', payload: { order_id: pickup, customer_name: 'Ali', phone: '03001234567' } }]);
  append(hub, [{ stream_type: 'order', stream_id: pickup, event_type: 'OrderBoosted', payload: { order_id: pickup } }]);
  const plain = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'TN', item_id: FX.naan }] }).order_id;
  append(hub, [{ stream_type: 'order', stream_id: plain, event_type: 'OrderBoosted', payload: { order_id: plain } }]); // no pickup: not a pickup boost
  append(hub, [{ stream_type: 'order', stream_id: plain, event_type: 'OrderContactSet', payload: { order_id: plain, customer_name: 'Sara', phone: null } }]); // #64: no phone → no key
  openSeating(hub, { table_id: FX.zoneTable, seating_id: 'SZ' });
  appendOrder(hub, {
    order_type: 'dine_in',
    seating_id: 'SZ',
    lines: [
      { order_item_id: 'K', item_id: FX.piece },
      { order_item_id: 'R', option_id: FX.option, parent_order_item_id: 'K' },
      { order_item_id: 'D', deal_id: FX.deal },
      { order_item_id: 'P1', deal_part_id: FX.dealParts[0], parent_order_item_id: 'D' },
    ],
  });
  return { pickup, plain, pickupAt };
}

/** Back to a pre-0029 hub: the columns and indexes gone, 0029 not applied. */
function toPre0029(db: Database.Database): void {
  db.exec(NEW_INDEXES.map((i) => `DROP INDEX ${i};`).join(' '));
  for (const c of NEW_ORDER_COLUMNS) db.exec(`ALTER TABLE orders DROP COLUMN ${c}`);
  for (const c of NEW_LINE_COLUMNS) db.exec(`ALTER TABLE order_lines DROP COLUMN ${c}`);
  db.prepare('DELETE FROM migration_checksums WHERE version >= 29').run();
  db.pragma('user_version = 28');
}

describe('[02b v1.0.25 §5, #65] hub migration 0029_orders_takeaway', () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('a 0028 database migrates to 0029: the nine columns (defaults), three indexes; only the orders checkpoint is deleted; no data UPDATE; re-run is a no-op', async () => {
    const { db, dir, cleanup } = freshDb();
    cleanups.push(cleanup);
    await runMigrations(db, { dir: copyUpTo(dir, '0028'), clock: fixedClock(T) });
    db.prepare("INSERT INTO orders (order_id, order_type, table_key, business_date, placed_by, placed_at, follow_up) VALUES ('O1', 'takeaway', 'takeaway:O1', '2026-11-26', 'S_WAIT', 1, 0)").run();
    const cp = db.prepare('INSERT INTO projection_checkpoints (branch_id, projection, last_seq) VALUES (?, ?, ?)');
    for (const projection of ['orders', 'kitchen_tickets', 'pass', 'audit']) cp.run('branch-1', projection, 42);
    const others = db.prepare("SELECT * FROM projection_checkpoints WHERE projection <> 'orders' ORDER BY projection").all();

    expect(await runMigrations(db, { dir: copyUpTo(dir, '0029'), clock: fixedClock(T) })).toEqual({ from: 28, to: 29, applied: [MIGRATION] });
    const orderCols = new Map(columns(db, 'orders').map((c) => [c.name, c]));
    for (const c of NEW_ORDER_COLUMNS) expect(orderCols.has(c), c).toBe(true);
    expect(orderCols.get('pickup_boosted')).toMatchObject({ type: 'INTEGER', notnull: 1, dflt_value: '0' });
    expect(orderCols.get('phone_key')).toMatchObject({ type: 'TEXT', notnull: 0 });
    for (const c of ['pickup_at_ms', 'unpaid_handover_approved_at', 'unpaid_handover_approved_due_minor', 'tracking_close_cutoff_ms']) expect(orderCols.get(c), c).toMatchObject({ type: 'INTEGER', notnull: 0, dflt_value: null });
    const lineCols = new Map(columns(db, 'order_lines').map((c) => [c.name, c]));
    for (const c of NEW_LINE_COLUMNS) expect(lineCols.get(c), c).toMatchObject({ type: 'TEXT', notnull: 0, dflt_value: null });
    const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'orders'").pluck().all() as string[]);
    expect(indexes).toEqual(expect.arrayContaining(NEW_INDEXES));
    // the old row takes the defaults
    expect(db.prepare("SELECT pickup_at_ms, pickup_boosted, phone_key, unpaid_handover_approved_at, unpaid_handover_approved_due_minor, tracking_close_cutoff_ms FROM orders WHERE order_id = 'O1'").get()).toEqual({
      pickup_at_ms: null, pickup_boosted: 0, phone_key: null, unpaid_handover_approved_at: null, unpaid_handover_approved_due_minor: null, tracking_close_cutoff_ms: null,
    });
    expect(checkpoint(db, 'orders')).toBeUndefined();
    expect(db.prepare("SELECT * FROM projection_checkpoints WHERE projection <> 'orders' ORDER BY projection").all()).toEqual(others);
    expect(await runMigrations(db, { dir: copyUpTo(dir, '0029b'), clock: fixedClock(T + 1) })).toEqual({ from: 29, to: 29, applied: [] });
  });

  it('EXPLAIN QUERY PLAN: customer-orders uses orders_phone, top-items orders_placed, open-orders orders_open and orders_open_takeaway_paid', async () => {
    const { db, cleanup } = freshDb();
    cleanups.push(cleanup);
    await runMigrations(db, { dir: migrations, clock: fixedClock(T) });
    const plan = (sql: string): string => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>).map((r) => r.detail).join(' | ');
    expect(plan("SELECT order_id FROM orders WHERE phone_key = '923001234567' AND cancelled_at IS NULL ORDER BY placed_at DESC")).toContain('orders_phone');
    expect(plan('SELECT order_id FROM orders WHERE placed_at >= 1 AND placed_at < 2')).toContain('orders_placed');
    expect(plan("SELECT order_id FROM orders WHERE order_type = 'takeaway' AND billed_at IS NULL AND cancelled_at IS NULL AND day_closed_at IS NULL ORDER BY placed_at")).toContain('orders_open');
    expect(plan("SELECT order_id FROM orders WHERE order_type = 'takeaway' AND billed_at IS NOT NULL AND cancelled_at IS NULL AND day_closed_at IS NULL ORDER BY placed_at")).toContain('orders_open_takeaway_paid');
  });

  it('a real boot() over a pre-0029 database (forced boot-time ClockAlarm) refolds orders from seq 0: rows equal the fresh fold; phone_key, pickup_at_ms, the Boost and the line refs filled; other checkpoints kept', async () => {
    const hub = await createTestHub({ provisioned: true });
    cleanups.push(() => hub.close());
    const { pickup, plain, pickupAt } = someOrders(hub);
    const liveOrders = orderRows(hub.deps.db);
    const liveLines = lineRows(hub.deps.db);
    const byId = new Map(liveOrders.map((r) => [r.order_id, r]));
    expect(byId.get(pickup)).toMatchObject({ pickup_at_ms: pickupAt, pickup_boosted: 1, phone: '03001234567', phone_key: '923001234567', unpaid_handover_approved_at: null, unpaid_handover_approved_due_minor: null });
    expect(byId.get(plain)).toMatchObject({ pickup_at_ms: null, pickup_boosted: 0, customer_name: 'Sara', phone: null, phone_key: null });
    const lines = new Map(liveLines.map((r) => [r.order_item_id, r]));
    expect(lines.get('R')).toMatchObject({ option_id: FX.option, deal_part_id: null, option_refs_json: null });
    expect(lines.get('P1')).toMatchObject({ deal_part_id: FX.dealParts[0], option_id: null });
    expect(lines.get('K')!.option_refs_json, 'the parent lists its plain options only').toBeNull();
    const maxSeq = hub.deps.db.prepare('SELECT MAX(seq) FROM events').pluck().get() as number;
    const lastRecordedAt = hub.deps.db.prepare('SELECT MAX(recorded_at) FROM events').pluck().get() as number;

    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    const file = join(cfg.dataDir, 'hub.sqlite');
    hub.deps.db.prepare('VACUUM INTO ?').run(file);
    const copy = openDb(file);
    toPre0029(copy);
    expect((await runMigrations(copy, { dir: migrations, clock: fixedClock(T) })).applied).toEqual([MIGRATION]);
    expect(checkpoint(copy, 'orders')).toBeUndefined();
    expect(checkpoint(copy, 'kitchen_tickets'), 'forward-only checkpoints kept').toBe(maxSeq);
    copy.close();

    const booted = await boot({ configPath: cfg.path, wallNow: () => lastRecordedAt - 60_000, monoNow: () => 0, configClient: stubConfigCloud(), cloudClient: offlineCloud(), logStream: quiet() });
    cleanups.push(() => booted.stop());
    const db = booted.deps.db;
    expect(db.prepare('SELECT event_type FROM events WHERE seq > ? ORDER BY seq').pluck().all(maxSeq)[0], 'boot wrote ClockAlarm before its catch-up').toBe('ClockAlarm');
    expect(orderRows(db)).toEqual(liveOrders);
    expect(lineRows(db)).toEqual(liveLines);
    const countOf = (types: readonly string[]) => db.prepare('SELECT COUNT(*) FROM events WHERE event_type IN (SELECT value FROM json_each(?))').pluck().get(JSON.stringify(types)) as number;
    const started = db.prepare("SELECT payload FROM events WHERE event_type = 'HubStarted' ORDER BY seq DESC LIMIT 1").pluck().get() as string;
    expect((JSON.parse(started) as { events_replayed: number }).events_replayed, 'only orders replays').toBe(countOf(ORDERS_EVENT_TYPES));
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

function writeConfig(): { path: string; dataDir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pos-0029-'));
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
