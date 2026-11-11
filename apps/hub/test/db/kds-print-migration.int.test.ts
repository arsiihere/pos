import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate';
import { fixedClock, T } from '../../src/lib/clock';
import { freshDb } from '../helpers/db';

const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

// 03b §5 (0014) and 03c §5 (0015): every table, every index (name, unique, partial), the CHECKs.
const TABLES_0014 = ['kds_station_settings', 'station_lanes', 'pass_orders', 'pass_ready_lines', 'handovers', 'handover_lines'];
const TABLES_0015 = ['printers', 'station_outputs', 'printer_runtime', 'print_fold_skips', 'tickets', 'ticket_lines', 'print_jobs'];
// [table, index, unique, partial]
const INDEXES: Array<[string, string, number, number]> = [
  ['pass_orders', 'pass_orders_open', 0, 1],
  ['pass_ready_lines', 'pass_ready_lines_item', 0, 1],
  ['handovers', 'handovers_unsettled', 0, 1],
  ['handovers', 'handovers_card_open', 0, 1],
  ['handover_lines', 'handover_lines_handover', 0, 0],
  ['printers', 'printers_name_active', 1, 1],
  ['station_outputs', 'station_outputs_printer', 0, 0],
  ['tickets', 'tickets_order', 0, 0],
  ['tickets', 'tickets_station_fired', 0, 0],
  ['tickets', 'tickets_fired', 0, 0],
  ['ticket_lines', 'ticket_lines_ticket', 0, 0],
  ['print_jobs', 'print_jobs_pending', 0, 1],
  ['print_jobs', 'print_jobs_ticket', 0, 1],
  ['print_jobs', 'print_jobs_one_live_kitchen', 1, 1],
  ['print_jobs', 'print_jobs_suspect', 0, 1],
  ['print_jobs', 'print_jobs_acked_by_printer', 0, 1],
];

const CHECK = /CHECK constraint failed/;
const UNIQUE = /UNIQUE constraint failed/;

describe('[03b §5, 03c §5] hub migrations 0014_kds_pass, 0015_print', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('[03b §5, 03c §5] a 0013 database migrates to 0015; a re-run is a no-op', async () => {
    const handle = freshDb();
    cleanups.push(handle.cleanup);
    await runMigrations(handle.db, { dir: copyUpTo(handle.dir, '0013'), clock: fixedClock(T) });
    const result = await runMigrations(handle.db, { dir: copyUpTo(handle.dir, '0015'), clock: fixedClock(T) });
    expect(result).toEqual({ from: 13, to: 15, applied: ['0014_kds_pass.sql', '0015_print.sql'] });
    expect(handle.db.pragma('user_version', { simple: true })).toBe(15);
    expect(await runMigrations(handle.db, { dir: copyUpTo(handle.dir, '0015b'), clock: fixedClock(T + 1) })).toEqual({ from: 15, to: 15, applied: [] });
  });

  it('[03b §5, 03c §5] every table and every index exists (unique / partial as specced)', async () => {
    const db = await fresh();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all() as string[];
    for (const table of [...TABLES_0014, ...TABLES_0015]) expect(tables, table).toContain(table);
    for (const [table, index, unique, partial] of INDEXES) {
      const list = db.pragma(`index_list(${table})`) as Array<{ name: string; unique: number; partial: number }>;
      expect(list.find((i) => i.name === index), `${table}.${index}`).toMatchObject({ unique, partial });
    }
    const named = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL AND tbl_name IN (${[...TABLES_0014, ...TABLES_0015].map(() => '?').join(', ')})`)
      .pluck()
      .all(...TABLES_0014, ...TABLES_0015) as string[];
    expect(named.sort()).toEqual(INDEXES.map(([, index]) => index).sort());
  });

  it('[03b §5] CHECKs: sound_volume 0–100, open_lines >= 0', async () => {
    const db = await fresh();
    db.prepare("INSERT INTO kds_station_settings (station_id, sound_volume) VALUES ('S1', 0), ('S2', 100)").run();
    expect(() => db.prepare("INSERT INTO kds_station_settings (station_id, sound_volume) VALUES ('S3', 101)").run()).toThrow(CHECK);
    expect(() => db.prepare("INSERT INTO kds_station_settings (station_id, sound_volume) VALUES ('S3', -1)").run()).toThrow(CHECK);
    db.prepare("INSERT INTO station_lanes (station_id, lanes_on, lane_count) VALUES ('S1', NULL, 2)").run(); // NULL = custom
    const handover = db.prepare(
      'INSERT INTO handovers (handover_id, order_id, point_id, receiver_staff_id, handed_at, open_lines) VALUES (?, ?, ?, ?, ?, ?)',
    );
    handover.run('H1', 'O1', 'P1', 'S_WAIT', T, 1);
    expect(() => handover.run('H2', 'O1', 'P1', 'S_WAIT', T, -1)).toThrow(CHECK);
    db.prepare("UPDATE handovers SET open_lines = open_lines - 1 WHERE handover_id = 'H1'").run();
    expect(() => db.prepare("UPDATE handovers SET open_lines = open_lines - 1 WHERE handover_id = 'H1'").run()).toThrow(CHECK);
  });

  it('[03c §5] CHECKs and unique rules: one live kitchen job per ticket, connection, paper, mode needs a printer, a job names a printer or a station', async () => {
    const db = await fresh();
    const printer = db.prepare(
      'INSERT INTO printers (printer_id, name, connection, address, paper_width_mm, archived_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    printer.run('PR1', 'Kitchen', 'lan', '192.168.1.50:9100', 80, null, T);
    expect(() => printer.run('PR2', 'Kitchen', 'usb', '/dev/usb/lp0', 58, null, T)).toThrow(UNIQUE); // name among active
    printer.run('PR3', 'Kitchen', 'usb', '/dev/usb/lp0', 58, T, T); // an archived one may share the name
    expect(() => printer.run('PR4', 'Other', 'bluetooth', 'x', 80, null, T)).toThrow(CHECK);
    expect(() => printer.run('PR5', 'Other', 'lan', 'x', 72, null, T)).toThrow(CHECK);

    const output = db.prepare('INSERT INTO station_outputs (station_id, mode, printer_id) VALUES (?, ?, ?)');
    output.run('S1', 'screen', null);
    output.run('S2', 'both', 'PR1');
    expect(() => output.run('S3', 'printer', null)).toThrow(CHECK);
    expect(() => output.run('S4', 'paper', 'PR1')).toThrow(CHECK);
    expect(db.prepare("SELECT show_taker, show_order_id FROM station_outputs WHERE station_id = 'S1'").get()).toEqual({ show_taker: 1, show_order_id: 1 });

    const ticket = db.prepare('INSERT INTO tickets (ticket_id, station_id, order_id, fire_event_id, fired_at, reason) VALUES (?, ?, ?, ?, ?, ?)');
    ticket.run('K1', 'S2', 'O1', 'E1', T, 'scheduled');
    expect(() => ticket.run('K2', 'S2', 'O1', 'E2', T, 'manual')).toThrow(CHECK);

    const job = db.prepare('INSERT INTO print_jobs (job_id, kind, printer_id, station_id, ticket_id, payload, created_at, cancelled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    job.run('J1', 'kitchen', null, 'S2', 'K1', '{}', T, null);
    expect(() => job.run('J2', 'kitchen', null, 'S2', 'K1', '{}', T, null)).toThrow(UNIQUE); // at-fire vs fallback never double
    db.prepare("UPDATE print_jobs SET cancelled_at = ? WHERE job_id = 'J1'").run(T);
    job.run('J3', 'kitchen', null, 'S2', 'K1', '{}', T, null); // the cancelled one no longer counts
    job.run('J4', 'reprint', null, 'S2', 'K1', '{}', T, null); // other kinds are not limited
    expect(() => job.run('J5', 'receipt', 'PR1', null, null, '{}', T, null)).toThrow(CHECK);
    expect(() => job.run('J6', 'document', null, null, null, '{}', T, null)).toThrow(CHECK);
    expect(() => db.prepare("UPDATE print_jobs SET is_reprint = 2 WHERE job_id = 'J4'").run()).toThrow(CHECK);
    expect(db.prepare("SELECT attempts, is_reprint FROM print_jobs WHERE job_id = 'J4'").get()).toEqual({ attempts: 0, is_reprint: 0 });
    expect(() => db.prepare("INSERT INTO printer_runtime (printer_id, supports_status) VALUES ('PR1', 2)").run()).toThrow(CHECK);
  });

  async function fresh(): Promise<Database.Database> {
    const handle = freshDb();
    cleanups.push(handle.cleanup);
    await runMigrations(handle.db, { dir: copyUpTo(handle.dir, '0015'), clock: fixedClock(T) });
    expect(handle.db.pragma('user_version', { simple: true })).toBe(15);
    return handle.db;
  }
});

function copyUpTo(parent: string, last: string): string {
  const target = join(parent, `migrations-${last}`);
  mkdirSync(target);
  for (const name of readdirSync(migrations)) {
    if (name.endsWith('.sql') && name.slice(0, 4) <= last.slice(0, 4)) copyFileSync(join(migrations, name), join(target, name));
  }
  return target;
}
