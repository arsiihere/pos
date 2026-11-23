import { copyFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate';
import { fixedClock, T } from '../../src/lib/clock';
import { freshDb } from '../helpers/db';

const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const MIGRATION = '0027_device_profiles.sql';

type Col = { name: string; type: string; notnull: number; dflt_value: unknown; pk: number };

const DEVICE_ROWS = [
  {
    device_id: 'dev-kds', branch_id: 'branch-1', token_hash: 'tok-kds', device_name: 'Grill KDS', device_type: 'kds',
    station_id: 'st-1', owner_staff_id: null, paired_at: T, paired_by: 'admin', last_seen_at: T + 5,
    revoked_at: null, revoked_by: null, point_id: null, lane_label: 'Lane A',
  },
  {
    device_id: 'dev-phone', branch_id: 'branch-1', token_hash: 'tok-phone', device_name: 'Ali phone', device_type: 'phone',
    station_id: null, owner_staff_id: 'S-ali', paired_at: T + 1, paired_by: 'S-mgr', last_seen_at: null,
    revoked_at: T + 9, revoked_by: 'S-mgr', point_id: null, lane_label: null,
  },
  {
    device_id: 'dev-tab', branch_id: 'branch-1', token_hash: 'tok-tab', device_name: 'Pass tablet', device_type: 'tablet',
    station_id: null, owner_staff_id: null, paired_at: T + 2, paired_by: 'S-mgr', last_seen_at: T + 7,
    revoked_at: null, revoked_by: null, point_id: 'pt-1', lane_label: null,
  },
];

describe('hub migration 0027_device_profiles', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('[05a §5.1] the first line is the FK-off header and 0027 applies to a 0026 database', async () => {
    expect(readFileSync(join(migrations, MIGRATION), 'utf8').split('\n', 1)[0]).toBe('-- migrate:foreign-keys-off');
    const { db, result } = await from0026();
    expect(result).toEqual({ from: 26, to: 27, applied: [MIGRATION] });
    expect(db.pragma('user_version', { simple: true })).toBe(27);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('[05a §5.1] devices keeps every 0002 + 0008 column in order', async () => {
    const { db } = await from0026();
    const cols = db.pragma('table_info(devices)') as Col[];
    expect(cols.map((c) => [c.name, c.type, c.notnull, c.pk])).toEqual([
      ['device_id', 'TEXT', 0, 1],
      ['branch_id', 'TEXT', 1, 0],
      ['token_hash', 'TEXT', 1, 0],
      ['device_name', 'TEXT', 1, 0],
      ['device_type', 'TEXT', 1, 0],
      ['station_id', 'TEXT', 0, 0],
      ['owner_staff_id', 'TEXT', 0, 0],
      ['paired_at', 'INTEGER', 1, 0],
      ['paired_by', 'TEXT', 1, 0],
      ['last_seen_at', 'INTEGER', 0, 0],
      ['revoked_at', 'INTEGER', 0, 0],
      ['revoked_by', 'TEXT', 0, 0],
      ['point_id', 'TEXT', 0, 0],
      ['lane_label', 'TEXT', 0, 0],
    ]);
    // token_hash stays UNIQUE; no other index or trigger on devices
    const indexes = db.prepare(`SELECT name, sql FROM sqlite_master WHERE tbl_name = 'devices' AND type IN ('index','trigger')`).all() as Array<{ name: string; sql: string | null }>;
    expect(indexes).toEqual([{ name: 'sqlite_autoindex_devices_1', sql: null }, { name: 'sqlite_autoindex_devices_2', sql: null }]);
    expect(db.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE name = 'devices_v2'`).get()).toEqual({ n: 0 });
  });

  it('[05a §5.1] device rows survive with the same values', async () => {
    const { db } = await from0026();
    expect(db.prepare('SELECT * FROM devices ORDER BY device_id').all()).toEqual(DEVICE_ROWS);
    expect(db.prepare('SELECT request_id, device_name, hardware_hint FROM pair_requests').all()).toEqual([
      { request_id: 'req-1', device_name: 'Front tablet', hardware_hint: null },
    ]);
  });

  it('[05a §5.1] the phone/owner CHECK is gone: a phone row with a null owner inserts', async () => {
    const { db } = await from0026();
    insertDevice(db, 'dev-p2', 'phone', null);
    expect(db.prepare(`SELECT device_type, owner_staff_id FROM devices WHERE device_id = 'dev-p2'`).get()).toEqual({ device_type: 'phone', owner_staff_id: null });
  });

  it('[05a §5.1] the kds/station CHECK and the device_type IN check are kept; token_hash stays UNIQUE', async () => {
    const { db } = await from0026();
    expect(() => insertDevice(db, 'dev-k2', 'kds', null)).toThrow(/CHECK constraint failed/);
    expect(() => insertDevice(db, 'dev-t2', 'tablet', 'st-1')).toThrow(/CHECK constraint failed/);
    expect(() => insertDevice(db, 'dev-x', 'watch', null)).toThrow(/CHECK constraint failed/);
    expect(() =>
      db.prepare(`INSERT INTO devices (device_id, branch_id, token_hash, device_name, device_type, paired_at, paired_by) VALUES ('dev-dup', 'branch-1', 'tok-tab', 'D', 'tablet', 1, 'a')`).run(),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it('[05a §5.1] device_profiles: columns, access CHECK, needs_review CHECK, FK to devices', async () => {
    const { db } = await from0026();
    const cols = db.pragma('table_info(device_profiles)') as Col[];
    expect(cols.map((c) => [c.name, c.type, c.notnull, c.pk])).toEqual([
      ['device_id', 'TEXT', 0, 1],
      ['access', 'TEXT', 1, 0],
      ['screens', 'TEXT', 1, 0],
      ['profile_version', 'INTEGER', 1, 0],
      ['needs_review', 'INTEGER', 1, 0],
    ]);
    expect(db.pragma('foreign_key_list(device_profiles)')).toMatchObject([{ table: 'devices', from: 'device_id', to: 'device_id' }]);
    const ins = db.prepare('INSERT INTO device_profiles (device_id, access, screens, profile_version, needs_review) VALUES (?, ?, ?, ?, ?)');
    ins.run('dev-tab', 'everyone', '["pass","dine_in"]', 1, 1);
    expect(() => ins.run('dev-phone', 'anyone', '["dine_in"]', 1, 0)).toThrow(/CHECK constraint failed/);
    expect(() => ins.run('dev-phone', 'listed', '["dine_in"]', 1, 2)).toThrow(/CHECK constraint failed/);
    expect(() => ins.run('dev-ghost', 'listed', '["dine_in"]', 1, 0)).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('[05a §5.1] device_people: composite key, FK to devices, index device_people_staff', async () => {
    const { db } = await from0026();
    const cols = db.pragma('table_info(device_people)') as Col[];
    expect(cols.map((c) => [c.name, c.type, c.notnull, c.pk])).toEqual([
      ['device_id', 'TEXT', 1, 1],
      ['staff_id', 'TEXT', 1, 2],
    ]);
    expect(db.pragma('foreign_key_list(device_people)')).toMatchObject([{ table: 'devices', from: 'device_id', to: 'device_id' }]);
    expect(db.pragma('index_info(device_people_staff)')).toMatchObject([{ seqno: 0, name: 'staff_id' }]);
    const ins = db.prepare('INSERT INTO device_people (device_id, staff_id) VALUES (?, ?)');
    ins.run('dev-phone', 'S-ali');
    expect(() => ins.run('dev-phone', 'S-ali')).toThrow(/UNIQUE constraint failed/);
    expect(() => ins.run('dev-ghost', 'S-ali')).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('[05a §5.1] pair_requests.hardware_hint is nullable and limited to the four device types', async () => {
    const { db } = await from0026();
    const cols = db.pragma('table_info(pair_requests)') as Col[];
    expect(cols.at(-1)).toMatchObject({ name: 'hardware_hint', type: 'TEXT', notnull: 0, dflt_value: null });
    const ins = db.prepare(
      `INSERT INTO pair_requests (request_id, branch_id, poll_secret_hash, display_code, device_name, requester_ip, created_at, expires_at, hardware_hint)
       VALUES (?, 'branch-1', 'h', 'ABC123', 'D', '10.0.0.2', 1, 2, ?)`,
    );
    for (const hint of ['tablet', 'cashier_kiosk', 'kds', 'phone', null]) ins.run(`req-${hint}`, hint);
    expect(() => ins.run('req-bad', 'watch')).toThrow(/CHECK constraint failed/);
  });

  async function from0026(): Promise<{ db: Database.Database; result: Awaited<ReturnType<typeof runMigrations>> }> {
    const handle = freshDb();
    cleanups.push(handle.cleanup);
    const { db, dir } = handle;
    await runMigrations(db, { dir: copyUpTo(dir, '0026'), clock: fixedClock(T) });
    expect(db.pragma('user_version', { simple: true })).toBe(26);
    const ins = db.prepare(
      `INSERT INTO devices (device_id, branch_id, token_hash, device_name, device_type, station_id, owner_staff_id, paired_at, paired_by, last_seen_at, revoked_at, revoked_by, point_id, lane_label)
       VALUES (@device_id, @branch_id, @token_hash, @device_name, @device_type, @station_id, @owner_staff_id, @paired_at, @paired_by, @last_seen_at, @revoked_at, @revoked_by, @point_id, @lane_label)`,
    );
    for (const row of DEVICE_ROWS) ins.run(row);
    db.prepare(
      `INSERT INTO pair_requests (request_id, branch_id, poll_secret_hash, display_code, device_name, requester_ip, created_at, expires_at)
       VALUES ('req-1', 'branch-1', 'h', 'ABC123', 'Front tablet', '10.0.0.2', ?, ?)`,
    ).run(T, T + 600_000);
    const result = await runMigrations(db, { dir: copyUpTo(dir, '0027'), clock: fixedClock(T) });
    return { db, result };
  }
});

function insertDevice(db: Database.Database, id: string, type: string, station: string | null): void {
  db.prepare(
    `INSERT INTO devices (device_id, branch_id, token_hash, device_name, device_type, station_id, paired_at, paired_by)
     VALUES (?, 'branch-1', ?, 'D', ?, ?, ?, 'admin')`,
  ).run(id, `tok-${id}`, type, station, T);
}

function copyUpTo(parent: string, last: string): string {
  const target = join(parent, `migrations-${last}`);
  mkdirSync(target);
  for (const name of readdirSync(migrations)) {
    if (name.endsWith('.sql') && name.slice(0, 4) <= last) copyFileSync(join(migrations, name), join(target, name));
  }
  return target;
}
