import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate';
import { fixedClock, T } from '../../src/lib/clock';
import { freshDb } from '../helpers/db';

// 04 P0.6: hub migrations 0017_staff_names (00 v1.10 §5 / 04 §4.5 H-1; gap G-1, G-2) and 0018_audit (04 §5).

const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

function copyUpTo(parent: string, last: string): string {
  const target = join(parent, `migrations-${last}`);
  mkdirSync(target);
  for (const name of readdirSync(migrations)) {
    if (name.endsWith('.sql') && name.slice(0, 4) <= last) copyFileSync(join(migrations, name), join(target, name));
  }
  return target;
}

function event(db: Database.Database, seq: number, recorded_at: number): void {
  db.prepare(
    `INSERT INTO events (event_id, tenant_id, branch_id, stream_type, stream_id, event_type, schema_version, payload,
                         occurred_at, recorded_at, actor_id, device_id, seq)
     VALUES (?, 't1', 'b1', 'day', 'd1', 'TestNooped', 1, '{}', ?, ?, NULL, 'dev1', ?)`,
  ).run(`E${seq}`, recorded_at, recorded_at, seq);
}

function directory(db: Database.Database): void {
  const staff = db.prepare(`INSERT INTO staff (staff_id, branch_id, display_name, pin_hash) VALUES (?, 'b1', ?, 'h')`);
  staff.run('S1', 'Ali');
  staff.run('S2', 'Bilal');
  const noPin = db.prepare(`INSERT INTO no_pin_staff (staff_id, display_name) VALUES (?, ?)`);
  noPin.run('N1', 'Chotu');
  // An id in both lists keeps the first: staff before no-pin (G-2 spirit, as the cache).
  noPin.run('S2', 'Bilal (no pin)');
}

type Column = { name: string; type: string; notnull: number; pk: number };
const columns = (db: Database.Database, table: string) =>
  (db.prepare(`SELECT name, type, "notnull", pk FROM pragma_table_info(?) ORDER BY cid`).all(table) as Column[]).map(
    (c) => `${c.name} ${c.type}${c.notnull === 1 ? ' NOT NULL' : ''}${c.pk > 0 ? ' PK' : ''}`,
  );

describe('[00 v1.10 §5 / 04 §4.5 H-1] hub migration 0017_staff_names.sql', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  });

  async function at0016(): Promise<{ db: Database.Database; dir: string }> {
    const handle = freshDb();
    cleanups.push(handle.cleanup);
    await runMigrations(handle.db, { dir: copyUpTo(handle.dir, '0016'), clock: fixedClock(T) });
    return { db: handle.db, dir: handle.dir };
  }

  it('[04 #51b] [00 #160] staff_names holds every staff and no_pin_staff row right after the migration, updated_at = MAX(events.recorded_at) (G-1); an id in both lists keeps the staff name', async () => {
    const { db, dir } = await at0016();
    directory(db);
    event(db, 1, 1_000);
    event(db, 2, 5_000);
    event(db, 3, 3_000);

    const result = await runMigrations(db, { dir: copyUpTo(dir, '0017'), clock: fixedClock(T) });
    expect(result.applied).toEqual(['0017_staff_names.sql']);

    expect(db.prepare('SELECT staff_id, display_name, updated_at FROM staff_names ORDER BY staff_id').all()).toEqual([
      { staff_id: 'N1', display_name: 'Chotu', updated_at: 5_000 },
      { staff_id: 'S1', display_name: 'Ali', updated_at: 5_000 },
      { staff_id: 'S2', display_name: 'Bilal', updated_at: 5_000 },
    ]);
  });

  it('[00 #160] on an empty event log the seed time is 0 (G-1)', async () => {
    const { db, dir } = await at0016();
    directory(db);
    await runMigrations(db, { dir: copyUpTo(dir, '0017'), clock: fixedClock(T) });
    expect(db.prepare('SELECT DISTINCT updated_at FROM staff_names').pluck().all()).toEqual([0]);
    expect(db.prepare('SELECT COUNT(*) FROM staff_names').pluck().get()).toBe(3);
  });

  it('[00 v1.10 §5] staff_names(staff_id TEXT PK, display_name TEXT NOT NULL, updated_at INTEGER NOT NULL)', async () => {
    const { db, dir } = await at0016();
    await runMigrations(db, { dir: copyUpTo(dir, '0017'), clock: fixedClock(T) });
    expect(columns(db, 'staff_names')).toEqual([
      'staff_id TEXT PK',
      'display_name TEXT NOT NULL',
      'updated_at INTEGER NOT NULL',
    ]);
  });
});

describe('[04 §5] hub migration 0018_audit.sql', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  });

  async function migrated(): Promise<Database.Database> {
    const handle = freshDb();
    cleanups.push(handle.cleanup);
    const result = await runMigrations(handle.db, { dir: migrations, clock: fixedClock(T) });
    expect(result.applied).toContain('0018_audit.sql');
    return handle.db;
  }

  it('[04 §5] audit_entries, audit_requests, audit_orders have exactly the §5 columns, types, NOT NULLs and PKs', async () => {
    const db = await migrated();
    expect(columns(db, 'audit_entries')).toEqual([
      'seq INTEGER PK',
      'event_id TEXT NOT NULL',
      'recorded_at INTEGER NOT NULL',
      'action TEXT NOT NULL',
      'actor_staff_id TEXT',
      'approver_staff_id TEXT',
      'method TEXT',
      'device_id TEXT NOT NULL',
      'subject_type TEXT NOT NULL',
      'subject_id TEXT NOT NULL',
      'order_id TEXT',
      'table_code TEXT',
      'table_id TEXT',
      'reason TEXT',
      'outcome TEXT',
      'amount_minor INTEGER',
      'detail_json TEXT NOT NULL',
    ]);
    expect(columns(db, 'audit_requests')).toEqual([
      'alert_id TEXT PK',
      'kind TEXT NOT NULL',
      'requester_staff_id TEXT',
      'order_id TEXT',
      'table_code TEXT',
      'answerer_staff_id TEXT',
    ]);
    expect(columns(db, 'audit_orders')).toEqual(['order_id TEXT PK', 'table_id TEXT']);
  });

  it('[04 §5] the 4 audit_entries indexes: time, actor, approver (partial), action — each ordered recorded_at DESC, seq DESC; event_id UNIQUE', async () => {
    const db = await migrated();
    type Key = { name: string; desc: number; key: number };
    const keys = (index: string) =>
      (db.prepare('SELECT name, "desc", key FROM pragma_index_xinfo(?) WHERE key = 1 ORDER BY seqno').all(index) as Key[]).map(
        (k) => `${k.name}${k.desc === 1 ? ' DESC' : ''}`,
      );
    expect(keys('audit_entries_time')).toEqual(['recorded_at DESC', 'seq DESC']);
    expect(keys('audit_entries_actor')).toEqual(['actor_staff_id', 'recorded_at DESC', 'seq DESC']);
    expect(keys('audit_entries_appr')).toEqual(['approver_staff_id', 'recorded_at DESC', 'seq DESC']);
    expect(keys('audit_entries_action')).toEqual(['action', 'recorded_at DESC', 'seq DESC']);

    const list = db.prepare(`SELECT name, "unique", origin, partial FROM pragma_index_list('audit_entries') ORDER BY name`).all();
    expect(list).toEqual([
      { name: 'audit_entries_action', unique: 0, origin: 'c', partial: 0 },
      { name: 'audit_entries_actor', unique: 0, origin: 'c', partial: 0 },
      { name: 'audit_entries_appr', unique: 0, origin: 'c', partial: 1 },
      { name: 'audit_entries_time', unique: 0, origin: 'c', partial: 0 },
      expect.objectContaining({ unique: 1, origin: 'u', partial: 0 }),
    ]);
    const appr = db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'audit_entries_appr'`).pluck().get() as string;
    expect(appr).toMatch(/WHERE approver_staff_id IS NOT NULL$/);
  });

  it('[04 §5] method CHECK accepts session / pin / in_person / NULL and refuses anything else; event_id is unique', async () => {
    const db = await migrated();
    const insert = db.prepare(
      `INSERT INTO audit_entries (seq, event_id, recorded_at, action, method, device_id, subject_type, subject_id, detail_json)
       VALUES (?, ?, 1, 'item_voided', ?, 'dev1', 'order', 'O1', '{}')`,
    );
    insert.run(1, 'E1', 'session');
    insert.run(2, 'E2', 'pin');
    insert.run(3, 'E3', 'in_person');
    insert.run(4, 'E4', null);
    expect(() => insert.run(5, 'E5', 'phone')).toThrow(/CHECK constraint failed/);
    expect(() => insert.run(6, 'E1', 'pin')).toThrow(/UNIQUE constraint failed: audit_entries.event_id/);
    expect(db.prepare('SELECT COUNT(*) FROM audit_entries').pluck().get()).toBe(4);
  });

  it('[04 §5] 0018 adds no trigger on the audit tables', async () => {
    const db = await migrated();
    expect(db.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND tbl_name LIKE 'audit_%'").pluck().get()).toBe(0);
  });
});
