import { copyFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate';
import { fixedClock, T } from '../../src/lib/clock';
import { sha256hex } from '../../src/lib/hash';
import { freshDb } from '../helpers/db';

const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

// The merged files 0001–0005 are never edited (CLAUDE.md; 01d plan): these are their hashes at 01d's start.
const MERGED: Record<string, string> = {
  '0001_event_store.sql': 'a8face54fd8a508f9599574be5c784d9cf1d93d4799516d7e35d026f174fc5a8',
  '0002_devices_sessions.sql': '9548a780c0621c7c4431c71e13617700f82109f06ae7139a212fde6665685ee9',
  '0003_staff_directory.sql': '21cf7d507fdee5c0b70cb337af38d2f17f08727146e8909df756623bbbe94257',
  '0004_restaurant_config.sql': 'c4503f8a9793409b229eac8b6bfdb83065c66fb72185eb2506ebd873a6e2e61a',
  '0005_directory_v2.sql': '1cd4aacddb34e8dbedcd07863c4ad9a47961876068bf16df2d41552272d4a07d',
};

const TABLES = [
  'alerts',
  'alert_recipients',
  'alert_inbox',
  'alert_receipts',
  'request_seen',
  'device_bindings',
  'alert_flags',
  'no_pin_staff',
  'presence_today',
  'app_releases',
];

// §5.1 index statements, verbatim (sqlite_master keeps the CREATE text as written).
const INDEXES: Record<string, string> = {
  alerts_open_dedupe: "CREATE UNIQUE INDEX alerts_open_dedupe ON alerts (kind, dedupe_key) WHERE state = 'open'",
  alerts_open_kind: "CREATE INDEX alerts_open_kind ON alerts (kind, raised_at) WHERE state = 'open'",
  alerts_due: "CREATE INDEX alerts_due ON alerts (next_due_at) WHERE state = 'open' AND next_due_at IS NOT NULL",
  alerts_requester: 'CREATE INDEX alerts_requester ON alerts (requester_staff_id, state) WHERE request_json IS NOT NULL',
  alerts_open_requests:
    "CREATE INDEX alerts_open_requests ON alerts (raised_at) WHERE state = 'open' AND request_json IS NOT NULL",
  alert_recipients_staff:
    'CREATE INDEX alert_recipients_staff  ON alert_recipients (staff_id, alert_id)  WHERE staff_id IS NOT NULL',
  alert_recipients_device:
    'CREATE INDEX alert_recipients_device ON alert_recipients (device_id, alert_id) WHERE device_id IS NOT NULL',
  alert_recipients_alert: 'CREATE INDEX alert_recipients_alert  ON alert_recipients (alert_id)',
  // AD-161 (developer ruling): added to the unreleased 0006 for the ON DELETE CASCADE from alerts (retention
  // step 2); §5.1 gains it at the as-built review.
  alert_inbox_alert: 'CREATE INDEX alert_inbox_alert ON alert_inbox (alert_id)',
  device_bindings_staff: 'CREATE INDEX device_bindings_staff   ON device_bindings (staff_id)',
  device_bindings_session:
    'CREATE INDEX device_bindings_session ON device_bindings (session_id) WHERE session_id IS NOT NULL',
  no_pin_staff_lead: 'CREATE INDEX no_pin_staff_lead ON no_pin_staff (lead_staff_id)',
  staff_sessions_staff_activity: 'CREATE INDEX staff_sessions_staff_activity ON staff_sessions (staff_id, last_activity_at)',
};

describe('hub migration 0006_alerts', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('[01d §5.1] migrates a 0005 database with staff and sessions to 0006, keeping its rows', async () => {
    const { db, result } = await from0005();
    expect(result).toEqual({ from: 5, to: 6, applied: ['0006_alerts.sql'] });
    expect(db.pragma('user_version', { simple: true })).toBe(6);
    expect(db.prepare('SELECT COUNT(*) FROM staff').pluck().get()).toBe(2);
    expect(db.prepare('SELECT COUNT(*) FROM staff_sessions').pluck().get()).toBe(3);
  });

  it('[01d §5.1] every §5.1 table and index exists with its §5.1 name and text', async () => {
    const { db } = await from0005();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all() as string[];
    for (const table of TABLES) expect(tables).toContain(table);
    const rows = db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL")
      .all() as Array<{ name: string; sql: string }>;
    const byName = new Map(rows.map((row) => [row.name, row.sql]));
    for (const [name, sql] of Object.entries(INDEXES)) expect(byName.get(name)).toBe(sql);
  });

  it('[01d §5.1; AD-161] the cascade lookup of alert_inbox by alert_id uses alert_inbox_alert', async () => {
    const { db } = await from0005();
    const plan = db.prepare('EXPLAIN QUERY PLAN SELECT 1 FROM alert_inbox WHERE alert_id = ?').all('a-1') as Array<{
      detail: string;
    }>;
    expect(plan.map((row) => row.detail).join('\n')).toContain('alert_inbox_alert');
  });

  it('[01d §5.1] alert_flags starts as [(no_approver, 1)]', async () => {
    const { db } = await from0005();
    expect(db.prepare('SELECT name, dirty FROM alert_flags').all()).toEqual([{ name: 'no_approver', dirty: 1 }]);
  });

  it('[01d §5.1] alerts CHECK (state = closed) = (close_reason IS NOT NULL) refuses an open row with a reason and a closed row without', async () => {
    const { db } = await from0005();
    expect(() => insertAlert(db, { alert_id: 'a-1', state: 'open', close_reason: 'done' })).toThrow(/CHECK constraint failed/);
    expect(() => insertAlert(db, { alert_id: 'a-2', state: 'closed', close_reason: null })).toThrow(/CHECK constraint failed/);
    insertAlert(db, { alert_id: 'a-3', state: 'open', close_reason: null });
    insertAlert(db, { alert_id: 'a-4', state: 'closed', close_reason: 'done' });
  });

  it('[01d §5.1] alert_recipients CHECK refuses both ids null and both ids set', async () => {
    const { db } = await from0005();
    insertAlert(db, { alert_id: 'a-1', state: 'open', close_reason: null });
    expect(() => insertRecipient(db, 'a-1', null, null)).toThrow(/CHECK constraint failed/);
    expect(() => insertRecipient(db, 'a-1', 'S1', 'dev-1')).toThrow(/CHECK constraint failed/);
    insertRecipient(db, 'a-1', 'S1', null);
    insertRecipient(db, 'a-1', null, 'dev-1');
  });

  it('[01d §5.1] with foreign_keys = ON, deleting an alerts row cascades its alert_recipients and alert_inbox rows', async () => {
    const { db } = await from0005();
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    insertAlert(db, { alert_id: 'a-1', state: 'closed', close_reason: 'done' });
    insertAlert(db, { alert_id: 'a-2', state: 'open', close_reason: null });
    for (const id of ['a-1', 'a-2']) {
      insertRecipient(db, id, 'S1', null);
      insertRecipient(db, id, null, 'dev-1');
      db.prepare('INSERT INTO alert_inbox (staff_id, alert_id, first_at) VALUES (?, ?, ?)').run('S1', id, T);
    }
    db.prepare("DELETE FROM alerts WHERE alert_id = 'a-1'").run();
    expect(db.prepare('SELECT DISTINCT alert_id FROM alert_recipients').pluck().all()).toEqual(['a-2']);
    expect(db.prepare('SELECT alert_id FROM alert_inbox').pluck().all()).toEqual(['a-2']);
  });

  it('[01d §5.1] alerts_open_dedupe refuses a second open (kind, dedupe_key) and allows it once the first is closed', async () => {
    const { db } = await from0005();
    insertAlert(db, { alert_id: 'a-1', state: 'open', close_reason: null });
    expect(() => insertAlert(db, { alert_id: 'a-2', state: 'open', close_reason: null })).toThrow(/UNIQUE constraint failed/);
    db.prepare("UPDATE alerts SET state = 'closed', close_reason = 'done', closed_at = ? WHERE alert_id = 'a-1'").run(T);
    insertAlert(db, { alert_id: 'a-2', state: 'open', close_reason: null });
    expect(db.prepare("SELECT COUNT(*) FROM alerts WHERE state = 'open'").pluck().get()).toBe(1);
  });

  it('[00 H-12] app_releases is created with its 00 §5.1 columns', async () => {
    const { db } = await from0005();
    const cols = db.prepare('PRAGMA table_info(app_releases)').all() as Array<{ name: string; notnull: number; pk: number }>;
    expect(cols.map((c) => [c.name, c.notnull, c.pk])).toEqual([
      ['version_code', 0, 1],
      ['version_name', 1, 0],
      ['sha256', 1, 0],
      ['staged_device_id', 0, 0],
      ['added_at', 1, 0],
    ]);
    db.prepare('INSERT INTO app_releases (version_code, version_name, sha256, added_at) VALUES (?, ?, ?, ?)').run(1, '1.0', 'ab', T);
    expect(() =>
      db.prepare('INSERT INTO app_releases (version_code, version_name, sha256, added_at) VALUES (?, ?, ?, ?)').run(1, '1.0', 'cd', T),
    ).toThrow(/UNIQUE constraint failed|PRIMARY KEY/);
  });

  it('[00 H-14] EXPLAIN QUERY PLAN of the §3.4.3 (c) last-activity read uses staff_sessions_staff_activity', async () => {
    const { db } = await from0005();
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT staff_id, MAX(last_activity_at) FROM staff_sessions
         WHERE branch_id = ? AND kind = 'staff' AND staff_id IN (?, ?) GROUP BY staff_id`,
      )
      .all('branch-1', 'S1', 'S2') as Array<{ detail: string }>;
    expect(plan.map((row) => row.detail).join('\n')).toContain('staff_sessions_staff_activity');
    const rows = db
      .prepare(
        `SELECT staff_id, MAX(last_activity_at) AS last FROM staff_sessions
         WHERE branch_id = ? AND kind = 'staff' AND staff_id IN (?, ?) GROUP BY staff_id ORDER BY staff_id`,
      )
      .all('branch-1', 'S1', 'S2');
    expect(rows).toEqual([
      { staff_id: 'S1', last: T + 20 },
      { staff_id: 'S2', last: T + 5 },
    ]);
  });

  it('[01d §5.1] merged migrations 0001–0005 are unchanged and 0006 follows them', () => {
    const files = readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort();
    expect(files.slice(0, 6)).toEqual([...Object.keys(MERGED), '0006_alerts.sql']);
    for (const [name, hash] of Object.entries(MERGED)) expect(sha256hex(readFileSync(join(migrations, name)))).toBe(hash);
  });

  it('[00 H-5, H-6] [01b B-4, v1.6 B-2] the hub migrations are exactly 0001–0012 in order', () => {
    const files = readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort();
    expect(files).toEqual([
      ...Object.keys(MERGED),
      '0006_alerts.sql',
      '0007_engine.sql',
      '0008_device_point_lane.sql',
      '0009_run_station.sql',
      '0010_assignments.sql',
      '0011_scope_my_zones.sql',
      '0012_tables.sql',
    ]);
  });

  async function from0005(): Promise<{ db: Database.Database; result: Awaited<ReturnType<typeof runMigrations>> }> {
    const handle = freshDb();
    cleanups.push(handle.cleanup);
    const { db, dir } = handle;
    const upTo5 = join(dir, 'migrations-0005');
    mkdirSync(upTo5);
    for (const name of Object.keys(MERGED)) copyFileSync(join(migrations, name), join(upTo5, name));
    await runMigrations(db, { dir: upTo5, clock: fixedClock(T) });
    expect(db.pragma('user_version', { simple: true })).toBe(5);
    seed0005(db);
    // Stops at 0006 (later migrations are not this test's subject): the runner re-checks the 0001–0005 checksums.
    const upTo6 = join(dir, 'migrations-0006');
    mkdirSync(upTo6);
    for (const name of [...Object.keys(MERGED), '0006_alerts.sql']) copyFileSync(join(migrations, name), join(upTo6, name));
    const result = await runMigrations(db, { dir: upTo6, clock: fixedClock(T) });
    return { db, result };
  }
});

function seed0005(db: Database.Database): void {
  const staff = db.prepare("INSERT INTO staff (staff_id, branch_id, display_name, pin_hash) VALUES (?, 'branch-1', ?, 'h')");
  staff.run('S1', 'Ali');
  staff.run('S2', 'Bilal');
  const device = db.prepare(
    `INSERT INTO devices (device_id, branch_id, token_hash, device_name, device_type, paired_at, paired_by)
     VALUES (?, 'branch-1', ?, ?, 'tablet', ?, 'admin')`,
  );
  device.run('dev-1', 'tok-1', 'dev-1', T);
  device.run('dev-2', 'tok-2', 'dev-2', T);
  const session = db.prepare(
    `INSERT INTO staff_sessions (
      session_id, branch_id, token_hash, kind, staff_id, device_id, idle_ttl_ms, started_at, last_activity_at, ended_at
    ) VALUES (?, 'branch-1', ?, 'staff', ?, ?, 1000, ?, ?, ?)`,
  );
  session.run('s-1', 'h-1', 'S1', 'dev-1', T, T + 10, T + 11);
  session.run('s-2', 'h-2', 'S1', 'dev-1', T, T + 20, null);
  session.run('s-3', 'h-3', 'S2', 'dev-2', T, T + 5, null);
}

function insertAlert(
  db: Database.Database,
  row: { alert_id: string; state: 'open' | 'closed'; close_reason: string | null },
): void {
  db.prepare(
    `INSERT INTO alerts (
      alert_id, kind, family, subject_stream_type, subject_stream_id, dedupe_key, raised_device_id, raised_seq,
      target_json, values_json, display_json, state, close_reason, raised_at
    ) VALUES (?, 'waiter_call', 'action', 'table', 't-1', 'k-1', 'hub', 1, '{}', '{}', '{}', ?, ?, ?)`,
  ).run(row.alert_id, row.state, row.close_reason, T);
}

function insertRecipient(db: Database.Database, alertId: string, staffId: string | null, deviceId: string | null): void {
  db.prepare(
    "INSERT INTO alert_recipients (alert_id, staff_id, device_id, recipient_set, step) VALUES (?, ?, ?, 'recipient', 0)",
  ).run(alertId, staffId, deviceId);
}
