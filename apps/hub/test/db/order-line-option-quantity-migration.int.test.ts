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
import { freshDb } from '../helpers/db';
import { offlineCloud } from '../helpers/stub-cloud';
import { stubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { appendOrder, FX, openDay } from '../kds/fixtures';

// 02b v1.0.13 §5 (owner 2026-11-12 21:03 PKT, 04 Q-19 (b); 01c §3.4.8 Q4), task u11, test 39 (column half): hub
// migration 0020_order_line_option_quantity adds order_lines.option_quantity (= ItemAdded.option_quantity) and deletes
// the `orders` checkpoint, so the next boot refolds `orders` from seq 0 (00 v1.10 H-2), as 0019. No data UPDATE.

const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const MIGRATION = '0020_order_line_option_quantity.sql';

/** A karahi ×2 with a placed raita (option_quantity 1), a later raita (null, synthetic as 04 #42), a deal, a naan. */
function someOrders(hub: TestHub): void {
  openDay(hub, { stock: { [FX.stock]: 100_000 } });
  appendOrder(hub, {
    order_type: 'takeaway',
    lines: [
      { order_item_id: 'K', item_id: FX.piece, quantity: 2 },
      { order_item_id: 'R', option_id: FX.option, parent_order_item_id: 'K', quantity: 1 },
      { order_item_id: 'RN', option_id: FX.option, parent_order_item_id: 'K', quantity: 1, item: { option_quantity: null, quantity: 1, line_total_minor: 10_000 } },
      { order_item_id: 'N', item_id: FX.naan, quantity: 3 },
      { order_item_id: 'D', deal_id: FX.deal },
      { order_item_id: 'P1', deal_part_id: FX.dealParts[0], parent_order_item_id: 'D' },
      { order_item_id: 'P2', deal_part_id: FX.dealParts[1], parent_order_item_id: 'D' },
    ],
  });
}

const rowsOf = (db: Database.Database) => db.prepare('SELECT * FROM order_lines ORDER BY order_item_id').all() as Array<Record<string, unknown>>;
const quantities = (db: Database.Database) =>
  Object.fromEntries(
    (db.prepare('SELECT order_item_id, option_quantity FROM order_lines ORDER BY order_item_id').all() as Array<{ order_item_id: string; option_quantity: number | null }>).map((r) => [r.order_item_id, r.option_quantity]),
  );
const checkpoint = (db: Database.Database, projection: string) => db.prepare('SELECT last_seq FROM projection_checkpoints WHERE projection = ?').pluck().get(projection) as number | undefined;

/** Back to a pre-0020 hub: the column gone, 0020 not applied; every projection and checkpoint as it was. */
function toPre0020(db: Database.Database): void {
  db.exec('ALTER TABLE order_lines DROP COLUMN option_quantity');
  db.prepare('DELETE FROM migration_checksums WHERE version >= 20').run();
  db.pragma('user_version = 19');
}

describe('[02b #39] hub migration 0020_order_line_option_quantity (02b v1.0.13 §5; 04 Q-19)', () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('[02b #39] a 0019 database migrates to 0020: option_quantity INTEGER NULL; only the orders checkpoint is deleted; no data UPDATE', async () => {
    const handle = freshDb();
    cleanups.push(handle.cleanup);
    const { db, dir } = handle;
    await runMigrations(db, { dir: copyUpTo(dir, '0019'), clock: fixedClock(T) });
    db.prepare(
      "INSERT INTO order_lines (order_item_id, order_id, line_kind, name, sale_unit, units, added_at, is_food) VALUES ('L1', 'O1', 'option_child', 'Raita', 'piece', 2, 1, 0)",
    ).run();
    const cp = db.prepare('INSERT INTO projection_checkpoints (branch_id, projection, last_seq) VALUES (?, ?, ?)');
    for (const projection of ['orders', 'tables', 'kitchen_tickets', 'audit']) cp.run('branch-1', projection, 42);
    const others = db.prepare("SELECT * FROM projection_checkpoints WHERE projection <> 'orders' ORDER BY projection").all();

    const result = await runMigrations(db, { dir: copyUpTo(dir, '0020'), clock: fixedClock(T) });
    expect(result).toEqual({ from: 19, to: 20, applied: [MIGRATION] });
    const cols = db.pragma('table_info(order_lines)') as Array<{ cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>;
    expect(cols.at(-1)).toEqual({ cid: cols.length - 1, name: 'option_quantity', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 0 });
    expect(db.prepare("SELECT option_quantity FROM order_lines WHERE order_item_id = 'L1'").pluck().get(), 'no backfill UPDATE').toBeNull();
    expect(checkpoint(db, 'orders'), 'orders checkpoint deleted → refold from 0').toBeUndefined();
    expect(db.prepare("SELECT * FROM projection_checkpoints WHERE projection <> 'orders' ORDER BY projection").all()).toEqual(others);
    expect(await runMigrations(db, { dir: copyUpTo(dir, '0020b'), clock: fixedClock(T + 1) })).toEqual({ from: 20, to: 20, applied: [] });
  });

  it('[02b #39] the fold writes ItemAdded.option_quantity; a real boot() over a pre-0020 database (forced boot-time ClockAlarm) refolds orders from seq 0 and every old line has it', async () => {
    const hub = await createTestHub({ provisioned: true });
    cleanups.push(() => hub.close());
    someOrders(hub);
    expect(quantities(hub.deps.db)).toEqual({ K: null, R: 1, RN: null, N: null, D: null, P1: null, P2: null });
    const live = rowsOf(hub.deps.db);
    const lastRecordedAt = hub.deps.db.prepare('SELECT MAX(recorded_at) FROM events').pluck().get() as number;
    const maxSeq = hub.deps.db.prepare('SELECT MAX(seq) FROM events').pluck().get() as number;

    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    const file = join(cfg.dataDir, 'hub.sqlite');
    hub.deps.db.prepare('VACUUM INTO ?').run(file);
    const copy = openDb(file);
    toPre0020(copy);
    expect(checkpoint(copy, 'orders')).toBe(maxSeq);
    copy.close();

    const wall = lastRecordedAt - 60_000; // the wall clock behind the last event: boot step 3a writes ClockAlarm
    const booted = await boot({ configPath: cfg.path, wallNow: () => wall, monoNow: () => 0, configClient: stubConfigCloud(), cloudClient: offlineCloud(), logStream: quiet() });
    cleanups.push(() => booted.stop());
    const db = booted.deps.db;
    expect(db.pragma('user_version', { simple: true })).toBe(20);
    expect(db.prepare('SELECT event_type FROM events WHERE seq > ? ORDER BY seq').pluck().all(maxSeq)[0], 'boot wrote ClockAlarm before its catch-up').toBe('ClockAlarm');
    expect(rowsOf(db), 'every old line has its option_quantity; rows equal the fresh fold').toEqual(live);
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
  const dir = mkdtempSync(join(tmpdir(), 'pos-0020-'));
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
