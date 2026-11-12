import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
import { append, appendOrder, FX, openDay, openSeating, removeLine } from '../kds/fixtures';

// 02b v1.0.7 §5 (owner 2026-11-11, B3-2) with v1.0.9 (B3-5), task P0.16: hub migration 0016_order_line_options adds
// order_lines.options_json and backfills it in SQL from the events' ItemAdded payloads — exactly what the live fold
// writes — with no projection rebuild (the `orders` checkpoint stays), so a boot that writes ClockAlarm before its
// catch-up still ends with every line filled.

const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const MIGRATION = '0016_order_line_options.sql';

const plain = (name: string, quantity: number) => ({ option_id: `O_${quantity}_${name}`, modifier_group_id: 'G_PLAIN', name, price_minor: 0, quantity, charge_minor: 0 });
// Names that JSON escapes or keeps as UTF-8, to prove SQLite's json_object and the fold's JSON.stringify agree.
const TRICKY = ['No onion', 'Kam "mirch"', 'Back\\slash', 'Dahi — ü / ç'];

/** Real orders through the 02b fixtures: plain options on items and a deal part, a repeated ItemAdded, none. */
function ordersWithOptions(hub: TestHub): void {
  openDay(hub);
  openSeating(hub, { table_id: FX.table, seating_id: 'SE1' });
  const o = appendOrder(hub, {
    order_type: 'dine_in',
    seating_id: 'SE1',
    lines: [
      { order_item_id: 'K1', item_id: FX.piece, quantity: 2, item: { options: [plain(TRICKY[0]!, 2), plain(TRICKY[1]!, 1), plain(TRICKY[2]!, 3)] } },
      { order_item_id: 'K2', item_id: FX.piece, item: { options: [plain(TRICKY[3]!, 1)] } },
      { order_item_id: 'N1', item_id: FX.naan, quantity: 3 },
      { order_item_id: 'D', deal_id: FX.deal },
      { order_item_id: 'Da', deal_part_id: FX.dealParts[0], parent_order_item_id: 'D', item: { options: [plain('Mild', 1)] } },
      { order_item_id: 'Db', deal_part_id: FX.dealParts[1], parent_order_item_id: 'D' },
    ],
  });
  removeLine(hub, o.order_id, 'N1', 1);
  // A second ItemAdded of a known id with other options: the fold keeps the first copy, so must the backfill.
  const k2 = hub.deps.db.prepare("SELECT payload FROM events WHERE event_type = 'ItemAdded' AND json_extract(payload, '$.order_item_id') = 'K2'").pluck().get() as string;
  append(hub, [{ stream_type: 'order', stream_id: o.order_id, event_type: 'ItemAdded', payload: { ...(JSON.parse(k2) as object), options: [plain('Changed', 5)] } }]);
}

const linesOf = (db: Database.Database) => db.prepare('SELECT order_item_id, options_json FROM order_lines ORDER BY order_item_id').all() as Array<{ order_item_id: string; options_json: string | null }>;

/** Back to a pre-0016 hub: the column gone, 0016 (and the later 04 0017 / 0018, 02b v1.0.12 0019) not applied; every
 *  projection (and checkpoint) as it was. */
const LATER = ['0017_staff_names.sql', '0018_audit.sql', '0019_order_line_station.sql'];
function toPre0016(db: Database.Database): void {
  db.exec('ALTER TABLE order_lines DROP COLUMN station_id'); // 0019 (02b v1.0.12, 04 Q-14) re-adds it
  db.exec('ALTER TABLE order_lines DROP COLUMN options_json');
  db.exec('DROP TABLE staff_names; DROP TABLE audit_entries; DROP TABLE audit_requests; DROP TABLE audit_orders');
  db.prepare('DELETE FROM migration_checksums WHERE version >= 16').run();
  db.pragma('user_version = 15');
}

describe('[02b v1.0.7 / v1.0.9 §5] hub migration 0016_order_line_options', () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('[02b v1.0.9 §5] a 0015 database migrates to 0016: options_json TEXT NULL; a line with no ItemAdded stays NULL; every checkpoint row kept', async () => {
    const handle = freshDb();
    cleanups.push(handle.cleanup);
    const { db, dir } = handle;
    await runMigrations(db, { dir: copyUpTo(dir, '0015'), clock: fixedClock(T) });
    db.prepare(
      "INSERT INTO order_lines (order_item_id, order_id, line_kind, name, sale_unit, units, added_at, is_food) VALUES ('L1', 'O1', 'item', 'Naan', 'piece', 2, 1, 1)",
    ).run();
    const checkpoint = db.prepare('INSERT INTO projection_checkpoints (branch_id, projection, last_seq) VALUES (?, ?, ?)');
    for (const projection of ['orders', 'tables', 'pass']) checkpoint.run('branch-1', projection, 42);
    const before = db.prepare('SELECT * FROM projection_checkpoints ORDER BY projection').all();

    const result = await runMigrations(db, { dir: copyUpTo(dir, '0016'), clock: fixedClock(T) });
    expect(result).toEqual({ from: 15, to: 16, applied: [MIGRATION] });
    expect(db.pragma('user_version', { simple: true })).toBe(16);
    const cols = db.pragma('table_info(order_lines)') as Array<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>;
    expect(cols.at(-1)).toEqual({ cid: cols.length - 1, name: 'options_json', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 });
    expect(db.prepare("SELECT options_json FROM order_lines WHERE order_item_id = 'L1'").pluck().get()).toBeNull();
    expect(db.prepare('SELECT * FROM projection_checkpoints ORDER BY projection').all(), 'B3-5: no checkpoint is deleted').toEqual(before);
    expect(await runMigrations(db, { dir: copyUpTo(dir, '0016b'), clock: fixedClock(T + 1) })).toEqual({ from: 16, to: 16, applied: [] });
  });

  it('[02b v1.0.9 §5] the SQL backfill writes exactly what the live fold wrote for the same events (string-equal; first copy; none → NULL)', async () => {
    const hub = await createTestHub({ provisioned: true });
    cleanups.push(() => hub.close());
    ordersWithOptions(hub);
    const db = hub.deps.db;
    const live = linesOf(db);
    expect(Object.fromEntries(live.map((l) => [l.order_item_id, l.options_json]))).toEqual({
      K1: JSON.stringify(TRICKY.slice(0, 3).map((name, i) => ({ name, quantity: [2, 1, 3][i] }))),
      K2: JSON.stringify([{ name: TRICKY[3], quantity: 1 }]),
      N1: null,
      D: null,
      Da: '[{"name":"Mild","quantity":1}]',
      Db: null,
    });
    // station_id (0019) is filled by the boot-time refold, not by runMigrations; it is left out of this comparison.
    const allRows = () => (db.prepare('SELECT * FROM order_lines ORDER BY order_item_id').all() as Array<Record<string, unknown>>).map((r) => {
      delete r.station_id;
      return r;
    });
    const all = allRows();

    toPre0016(db);
    expect((await runMigrations(db, { dir: migrations, clock: fixedClock(T) })).applied).toEqual([MIGRATION, ...LATER]);
    expect(linesOf(db)).toEqual(live);
    expect(allRows(), 'nothing else on the rows changes').toEqual(all);
  });

  // Reading (u10, 02b v1.0.12): the boot now also applies 0019, whose orders refold rewrites options_json, so 0016's
  // SQL backfill is asserted on its own first (migrations up to 0018 on the copy, before boot), then through the boot.
  it('[02b v1.0.9 §5] a pre-0016 database: 0016–0018 alone (orders checkpoint kept) → options_json backfilled in SQL; then a real boot() with the wall clock behind the last event (ClockAlarm before catch-up, 0019 refold) → options_json still equal', async () => {
    const hub = await createTestHub({ provisioned: true });
    cleanups.push(() => hub.close());
    ordersWithOptions(hub);
    const live = linesOf(hub.deps.db);
    const lastRecordedAt = hub.deps.db.prepare('SELECT MAX(recorded_at) FROM events').pluck().get() as number;

    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    const file = join(cfg.dataDir, 'hub.sqlite');
    hub.deps.db.prepare('VACUUM INTO ?').run(file);
    const copy = openDb(file);
    toPre0016(copy);
    const checkpoints = copy.prepare('SELECT projection, last_seq FROM projection_checkpoints ORDER BY projection').all();
    expect(checkpoints.length).toBeGreaterThan(0);
    // 0016's SQL backfill on its own: migrate to 0018 (before 0019's refold), no projection runs
    expect((await runMigrations(copy, { dir: copyUpTo(dirname(cfg.path), '0018'), clock: fixedClock(T) })).applied).toEqual([MIGRATION, ...LATER.slice(0, 2)]);
    expect(linesOf(copy), 'B3-5 SQL backfill, before any refold').toEqual(live);
    expect(copy.prepare('SELECT projection, last_seq FROM projection_checkpoints ORDER BY projection').all(), 'B3-5: no checkpoint is deleted').toEqual(checkpoints);
    copy.close();

    const wall = lastRecordedAt - 60_000;
    const booted = await boot({ configPath: cfg.path, wallNow: () => wall, monoNow: () => 0, configClient: stubConfigCloud(), cloudClient: offlineCloud(), logStream: quiet() });
    cleanups.push(() => booted.stop());
    const db = booted.deps.db;
    expect(db.pragma('user_version', { simple: true })).toBe(19);
    const after = db.prepare('SELECT event_type FROM events WHERE seq > (SELECT MAX(seq) FROM events WHERE recorded_at <= ?) ORDER BY seq').pluck().all(lastRecordedAt);
    expect(after[0], 'boot wrote ClockAlarm before its catch-up').toBe('ClockAlarm');
    expect(linesOf(db)).toEqual(live);
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
  const dir = mkdtempSync(join(tmpdir(), 'pos-0016-'));
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
