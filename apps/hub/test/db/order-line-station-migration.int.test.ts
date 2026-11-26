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
import { auditProjection } from '../../src/audit/projection';
import { ORDERS_EVENT_TYPES } from '../../src/orders/projection';
import { fixedClock, T } from '../../src/lib/clock';
import { freshDb } from '../helpers/db';
import { dropBilling0023 } from './billing-0023';
import { offlineCloud } from '../helpers/stub-cloud';
import { stubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { appendOrder, FX, openDay, openSeating, removeLine } from '../kds/fixtures';
import { PASS_EVENT_TYPES } from '../../src/kds/pass-projection';

// 02b v1.0.12 §5 (04 §4.5 Q-14, owner 2026-11-12 20:21), task u10, test 51 (migration half): hub migration
// 0019_order_line_station adds order_lines.station_id and deletes the `orders` checkpoint, so the next boot resets
// `orders` and refolds it from seq 0 — safe by 00 v1.10 H-2 (applyAll never inserts a checkpoint row, so a boot-time
// ClockAlarm written before catch-up does not recreate it). No data UPDATE in the migration.

const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const MIGRATION = '0019_order_line_station.sql';

/** Real orders through the 02b fixtures: a zone-routed dine-in order (item, option child, deal), a takeaway, a removal. */
function someOrders(hub: TestHub): void {
  openDay(hub, { stock: { [FX.stock]: 100_000 } });
  openSeating(hub, { table_id: FX.zoneTable, seating_id: 'SZ' });
  appendOrder(hub, {
    order_type: 'dine_in',
    seating_id: 'SZ',
    lines: [
      { order_item_id: 'K', item_id: FX.piece },
      { order_item_id: 'R', option_id: FX.option, parent_order_item_id: 'K' },
      { order_item_id: 'N', item_id: FX.naan, quantity: 3 },
      { order_item_id: 'D', deal_id: FX.deal },
      { order_item_id: 'P1', deal_part_id: FX.dealParts[0], parent_order_item_id: 'D' },
      { order_item_id: 'P2', deal_part_id: FX.dealParts[1], parent_order_item_id: 'D' },
    ],
  });
  const t = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'TN', item_id: FX.naan, quantity: 2 }, { order_item_id: 'TW', item_id: FX.ready }] });
  removeLine(hub, t.order_id, 'TN', 1);
}

const rowsOf = (db: Database.Database) => db.prepare('SELECT * FROM order_lines ORDER BY order_item_id').all() as Array<Record<string, unknown>>;
const stations = (db: Database.Database) =>
  Object.fromEntries((db.prepare('SELECT order_item_id, station_id FROM order_lines ORDER BY order_item_id').all() as Array<{ order_item_id: string; station_id: string | null }>).map((r) => [r.order_item_id, r.station_id]));
const checkpoint = (db: Database.Database, projection: string) => db.prepare('SELECT last_seq FROM projection_checkpoints WHERE projection = ?').pluck().get(projection) as number | undefined;

/** Back to a pre-0019 hub: the column gone, 0019 not applied; every projection and checkpoint as it was. */
function toPre0019(db: Database.Database): void {
  // 0021 (02b v1.0.16, 05 Q-1 / Q-5 / Q-6, R-7 / R-17) re-adds these and orders_token_day / orders_bill_key
  dropBilling0023(db); // 0023 (05 v1.0.7 §5) runs after 0022
  db.exec('DROP TABLE bill_routes'); // 0022 (03c v1.0.13, 05 row P-1)
  db.exec('DROP INDEX orders_bill_key; DROP INDEX orders_token_day');
  db.exec('CREATE UNIQUE INDEX orders_token ON orders (business_date, token) WHERE token IS NOT NULL');
  db.exec('ALTER TABLE orders DROP COLUMN bill_key; ALTER TABLE orders DROP COLUMN carried_over');
  db.exec('ALTER TABLE order_lines DROP COLUMN unit_price_minor; ALTER TABLE order_lines DROP COLUMN tax_profile_id');
  db.exec('ALTER TABLE order_lines DROP COLUMN option_quantity'); // 0020 (02b v1.0.13, 04 Q-19) re-adds it
  db.exec('ALTER TABLE order_lines DROP COLUMN station_id');
  db.exec('DROP TABLE device_people; DROP TABLE device_profiles; ALTER TABLE pair_requests DROP COLUMN hardware_hint'); // 0027 (05a §5.1) runs after it; its devices rebuild needs no undo
  db.exec('DROP TABLE pass_bag_ready; ALTER TABLE pass_orders DROP COLUMN ready_explicit'); // 0028 (03b v1.0.16 §5, R3-M-9) runs after it
  db.exec('DROP INDEX orders_open_takeaway_paid; DROP INDEX orders_phone; DROP INDEX orders_placed'); // 0029 (02b v1.0.25 §5) runs after it
  db.exec('ALTER TABLE orders DROP COLUMN pickup_at_ms');
  db.exec('ALTER TABLE orders DROP COLUMN pickup_boosted');
  db.exec('ALTER TABLE orders DROP COLUMN phone_key');
  db.exec('ALTER TABLE orders DROP COLUMN unpaid_handover_approved_at');
  db.exec('ALTER TABLE orders DROP COLUMN unpaid_handover_approved_due_minor');
  db.exec('ALTER TABLE orders DROP COLUMN tracking_close_cutoff_ms');
  db.exec('ALTER TABLE order_lines DROP COLUMN option_id');
  db.exec('ALTER TABLE order_lines DROP COLUMN deal_part_id');
  db.exec('ALTER TABLE order_lines DROP COLUMN option_refs_json');
  db.exec('ALTER TABLE order_lines DROP COLUMN part_of'); // 0026 (02b v1.0.20, STAB-5) runs after it
  db.prepare('DELETE FROM migration_checksums WHERE version >= 19').run();
  db.pragma('user_version = 18');
}

describe('[02b #51] hub migration 0019_order_line_station (02b v1.0.12 §5; 04 Q-14)', () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('[02b #51] a 0018 database migrates to 0019: station_id TEXT NULL; only the orders checkpoint is deleted; no data UPDATE', async () => {
    const handle = freshDb();
    cleanups.push(handle.cleanup);
    const { db, dir } = handle;
    await runMigrations(db, { dir: copyUpTo(dir, '0018'), clock: fixedClock(T) });
    db.prepare(
      "INSERT INTO order_lines (order_item_id, order_id, line_kind, name, sale_unit, units, added_at, is_food) VALUES ('L1', 'O1', 'item', 'Naan', 'piece', 2, 1, 1)",
    ).run();
    const cp = db.prepare('INSERT INTO projection_checkpoints (branch_id, projection, last_seq) VALUES (?, ?, ?)');
    for (const projection of ['orders', 'tables', 'kitchen_tickets', 'audit']) cp.run('branch-1', projection, 42);
    const others = db.prepare("SELECT * FROM projection_checkpoints WHERE projection <> 'orders' ORDER BY projection").all();

    const result = await runMigrations(db, { dir: copyUpTo(dir, '0019'), clock: fixedClock(T) });
    expect(result).toEqual({ from: 18, to: 19, applied: [MIGRATION] });
    expect(db.pragma('user_version', { simple: true })).toBe(19);
    const cols = db.pragma('table_info(order_lines)') as Array<{ cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>;
    expect(cols.at(-1)).toEqual({ cid: cols.length - 1, name: 'station_id', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 });
    expect(db.prepare("SELECT station_id FROM order_lines WHERE order_item_id = 'L1'").pluck().get(), 'no backfill UPDATE').toBeNull();
    expect(checkpoint(db, 'orders'), 'orders checkpoint deleted → refold from 0').toBeUndefined();
    expect(db.prepare("SELECT * FROM projection_checkpoints WHERE projection <> 'orders' ORDER BY projection").all()).toEqual(others);
    expect(await runMigrations(db, { dir: copyUpTo(dir, '0019b'), clock: fixedClock(T + 1) })).toEqual({ from: 19, to: 19, applied: [] });
  });

  it('[02b #51] a real boot() over a pre-0019 database with a forced boot-time ClockAlarm → orders refolds from seq 0; rows equal a fresh fold; kitchen_tickets checkpoint kept and not replayed', async () => {
    const hub = await createTestHub({ provisioned: true });
    cleanups.push(() => hub.close());
    someOrders(hub);
    const live = rowsOf(hub.deps.db); // the fresh fold of this log (test 28's identity)
    expect(stations(hub.deps.db)).toEqual({ K: FX.station, R: FX.station, N: FX.zoneStation, D: null, P1: FX.station, P2: FX.zoneStation, TN: FX.station, TW: FX.station });
    const lastRecordedAt = hub.deps.db.prepare('SELECT MAX(recorded_at) FROM events').pluck().get() as number;
    const maxSeq = hub.deps.db.prepare('SELECT MAX(seq) FROM events').pluck().get() as number;

    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    const file = join(cfg.dataDir, 'hub.sqlite');
    hub.deps.db.prepare('VACUUM INTO ?').run(file);
    const copy = openDb(file);
    toPre0019(copy);
    expect(checkpoint(copy, 'orders')).toBe(maxSeq);
    expect(checkpoint(copy, 'kitchen_tickets')).toBe(maxSeq);
    // 0019 applied on the copy before boot: the orders row is gone, the forward-only kitchen_tickets row is still there.
    // (02b v1.0.13: 0020 runs after it, and deletes the orders row too; 02b v1.0.16: so do 0021 and 0022; 05 0023 deletes the audit row)
    expect((await runMigrations(copy, { dir: migrations, clock: fixedClock(T) })).applied).toEqual([MIGRATION, '0020_order_line_option_quantity.sql', '0021_orders_billing.sql', '0022_bill_routes.sql', '0023_billing.sql', '0024_billing_payments_shift.sql', '0025_billing_z_reports_key.sql', '0026_order_line_part_of.sql', '0027_device_profiles.sql', '0028_pass_bag_ready.sql', '0029_orders_takeaway.sql']); // +0025: 05 hub migration 0025_billing_z_reports_key (05 task 25, R-85)
    expect(checkpoint(copy, 'orders')).toBeUndefined();
    expect(checkpoint(copy, 'kitchen_tickets'), '0019 keeps the kitchen_tickets checkpoint row').toBe(maxSeq);
    copy.close();

    const wall = lastRecordedAt - 60_000; // the wall clock behind the last event: boot step 3a writes ClockAlarm
    const booted = await boot({ configPath: cfg.path, wallNow: () => wall, monoNow: () => 0, configClient: stubConfigCloud(), cloudClient: offlineCloud(), logStream: quiet() });
    cleanups.push(() => booted.stop());
    const db = booted.deps.db;
    expect(db.pragma('user_version', { simple: true })).toBe(29); // +0029: 02b v1.0.25 0029_orders_takeaway; // +0028: 03b v1.0.16 0028_pass_bag_ready; // +0027: 05a §5.1 0027_device_profiles // +0026: 02b v1.0.20 migration 0026_order_line_part_of (STAB-5) // +0025: 05 hub migration 0025_billing_z_reports_key (05 task 25, R-85)
    const after = db.prepare('SELECT event_type FROM events WHERE seq > ? ORDER BY seq').pluck().all(maxSeq);
    expect(after[0], 'boot wrote ClockAlarm before its catch-up').toBe('ClockAlarm');
    expect(rowsOf(db), 'every old line has its station_id; rows equal the fresh fold').toEqual(live);
    expect(checkpoint(db, 'orders')).toBeGreaterThanOrEqual(maxSeq);
    // Only `orders` (0019–0021) and `audit` (05 0023, V-3) replay: HubStarted.events_replayed (Σ over every projection's
    // catch-up) = the log's orders events + its audit events, so kitchen_tickets (no reset; a missing row would replay it
    // from 0) and every other projection replayed 0.
    const countOf = (types: readonly string[]) =>
      db.prepare('SELECT COUNT(*) FROM events WHERE event_type IN (SELECT value FROM json_each(?))').pluck().get(JSON.stringify(types)) as number;
    const ordersEvents = countOf(ORDERS_EVENT_TYPES);
    expect(ordersEvents).toBeGreaterThan(0);
    const auditEvents = countOf(auditProjection().eventTypes); // boot already sealed the registry; this only reads it
    const started = db.prepare("SELECT payload FROM events WHERE event_type = 'HubStarted' ORDER BY seq DESC LIMIT 1").pluck().get() as string;
    // ⚠️ + `pass` (03b v1.0.16 0028_pass_bag_ready deletes its checkpoint: ReadyToServe refolds with ready_explicit)
    const passEvents = countOf(PASS_EVENT_TYPES);
    expect((JSON.parse(started) as { events_replayed: number }).events_replayed, 'replayed = orders + audit + pass only; kitchen_tickets 0').toBe(ordersEvents + auditEvents + passEvents);
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
  const dir = mkdtempSync(join(tmpdir(), 'pos-0019-'));
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
