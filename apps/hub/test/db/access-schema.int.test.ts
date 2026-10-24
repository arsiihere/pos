import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate';
import { fixedClock, T } from '../../src/lib/clock';
import { freshDb } from '../helpers/db';

const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

describe('access schema', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('[00 §5.1] a second active staff or station session on one device is rejected; an ended session is not; an admin session does not occupy the slot', async () => {
    const { db } = await open();
    insertDevice(db, { device_id: 'dev-1', token_hash: 'tok-1', device_type: 'tablet' });
    insertSession(db, { session_id: 's-staff', token_hash: 'h-staff', kind: 'staff', staff_id: 'S1', device_id: 'dev-1', idle_ttl_ms: 1000 });
    expect(() =>
      insertSession(db, { session_id: 's-staff-2', token_hash: 'h-staff-2', kind: 'staff', staff_id: 'S2', device_id: 'dev-1', idle_ttl_ms: 1000 }),
    ).toThrow(/UNIQUE constraint failed/);
    expect(() =>
      insertSession(db, {
        session_id: 's-station',
        token_hash: 'h-station',
        kind: 'station',
        station_id: 'ST1',
        device_id: 'dev-1',
        idle_ttl_ms: null,
      }),
    ).toThrow(/UNIQUE constraint failed/);
    insertDevice(db, { device_id: 'dev-2', token_hash: 'tok-2', device_type: 'tablet' });
    insertSession(db, {
      session_id: 's-ended',
      token_hash: 'h-ended',
      kind: 'staff',
      staff_id: 'S3',
      device_id: 'dev-2',
      idle_ttl_ms: 1000,
      ended_at: T,
    });
    insertSession(db, { session_id: 's-after-end', token_hash: 'h-after', kind: 'staff', staff_id: 'S3', device_id: 'dev-2', idle_ttl_ms: 1000 });
    insertSession(db, {
      session_id: 's-admin',
      token_hash: 'h-admin',
      kind: 'admin',
      staff_id: 'S1',
      device_id: 'dev-1',
      idle_ttl_ms: 1000,
    });
    expect(db.prepare("SELECT COUNT(*) FROM staff_sessions WHERE device_id = 'dev-1' AND ended_at IS NULL").pluck().get()).toBe(2);
  });

  it('[00 §5.1] kds without a station and a phone without an owner are rejected', async () => {
    const { db } = await open();
    expect(() => insertDevice(db, { device_id: 'kds-1', token_hash: 'tok-kds', device_type: 'kds' })).toThrow(/CHECK constraint failed/);
    expect(() => insertDevice(db, { device_id: 'phone-1', token_hash: 'tok-phone', device_type: 'phone' })).toThrow(/CHECK constraint failed/);
    insertDevice(db, { device_id: 'kds-ok', token_hash: 'tok-kds-ok', device_type: 'kds', station_id: 'ST1' });
    insertDevice(db, { device_id: 'phone-ok', token_hash: 'tok-phone-ok', device_type: 'phone', owner_staff_id: 'S1' });
  });

  it('[00 §5.1] station sessions reject staff_id and idle_ttl; staff requires a device; admin may omit the device', async () => {
    const { db } = await open();
    insertDevice(db, { device_id: 'dev-1', token_hash: 'tok-1', device_type: 'kds', station_id: 'ST1' });
    expect(() =>
      insertSession(db, {
        session_id: 's-bad-staff',
        token_hash: 'h1',
        kind: 'station',
        staff_id: 'S1',
        station_id: 'ST1',
        device_id: 'dev-1',
        idle_ttl_ms: null,
      }),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      insertSession(db, {
        session_id: 's-bad-ttl',
        token_hash: 'h2',
        kind: 'station',
        station_id: 'ST1',
        device_id: 'dev-1',
        idle_ttl_ms: 1000,
      }),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      insertSession(db, { session_id: 's-no-device', token_hash: 'h3', kind: 'staff', staff_id: 'S1', idle_ttl_ms: 1000 }),
    ).toThrow(/CHECK constraint failed/);
    insertSession(db, { session_id: 's-admin', token_hash: 'h4', kind: 'admin', staff_id: 'S1', idle_ttl_ms: 1000 });
    expect(db.prepare("SELECT device_id FROM staff_sessions WHERE session_id = 's-admin'").pluck().get()).toBeNull();
  });

  it("[00 §5.1] pairing_tokens rejects device_type 'kds'", async () => {
    const { db } = await open();
    expect(() =>
      db
        .prepare(
          `INSERT INTO pairing_tokens (
            pairing_token_id, branch_id, token_hash, device_type, created_by, created_at, expires_at
          ) VALUES ('pt-1', 'branch-1', 'hash-1', 'kds', 'admin', ?, ?)`,
        )
        .run(T, T + 1),
    ).toThrow(/CHECK constraint failed/);
    db.prepare(
      `INSERT INTO pairing_tokens (
        pairing_token_id, branch_id, token_hash, device_type, created_by, created_at, expires_at
      ) VALUES ('pt-2', 'branch-1', 'hash-2', 'tablet', 'admin', ?, ?)`,
    ).run(T, T + 1);
  });

  it('[00 §5.1] roles require a positive idle TTL; grant_type and approver_role_id stay paired; phone pairing tokens need an owner', async () => {
    const { db } = await open();
    expect(() =>
      db.prepare(`INSERT INTO roles (role_id, branch_id, name, session_idle_ttl_ms) VALUES ('r0', 'branch-1', 'Bad', 0)`).run(),
    ).toThrow(/CHECK constraint failed/);
    db.prepare(`INSERT INTO roles (role_id, branch_id, name, session_idle_ttl_ms) VALUES ('r1', 'branch-1', 'Ok', 1000)`).run();
    db.prepare(`INSERT INTO roles (role_id, branch_id, name, session_idle_ttl_ms) VALUES ('r2', 'branch-1', 'Approver', 1000)`).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO role_permissions (role_id, permission, grant_type, approver_role_id)
           VALUES ('r1', 'manage-staff', 'allowed', 'r2')`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      db
        .prepare(
          `INSERT INTO role_permissions (role_id, permission, grant_type, approver_role_id)
           VALUES ('r1', 'manage-staff', 'requires_approval', NULL)`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);
    db.prepare(
      `INSERT INTO role_permissions (role_id, permission, grant_type, approver_role_id)
       VALUES ('r1', 'manage-staff', 'requires_approval', 'r2')`,
    ).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO pairing_tokens (
            pairing_token_id, branch_id, token_hash, device_type, created_by, created_at, expires_at
          ) VALUES ('pt-phone', 'branch-1', 'hash-phone', 'phone', 'admin', ?, ?)`,
        )
        .run(T, T + 1),
    ).toThrow(/CHECK constraint failed/);
    db.prepare(
      `INSERT INTO pairing_tokens (
        pairing_token_id, branch_id, token_hash, device_type, owner_staff_id, created_by, created_at, expires_at
      ) VALUES ('pt-phone-ok', 'branch-1', 'hash-phone-ok', 'phone', 'S1', 'admin', ?, ?)`,
    ).run(T, T + 1);
  });

  async function open() {
    const fx = freshDb();
    cleanups.push(fx.cleanup);
    await runMigrations(fx.db, { dir: migrations, clock: fixedClock(T) });
    return fx;
  }
});

function insertDevice(
  db: Database.Database,
  row: { device_id: string; token_hash: string; device_type: string; station_id?: string; owner_staff_id?: string },
): void {
  db.prepare(
    `INSERT INTO devices (
      device_id, branch_id, token_hash, device_name, device_type, station_id, owner_staff_id, paired_at, paired_by
    ) VALUES (?, 'branch-1', ?, ?, ?, ?, ?, ?, 'admin')`,
  ).run(row.device_id, row.token_hash, row.device_id, row.device_type, row.station_id ?? null, row.owner_staff_id ?? null, T);
}

function insertSession(
  db: Database.Database,
  row: {
    session_id: string;
    token_hash: string;
    kind: string;
    staff_id?: string;
    station_id?: string;
    device_id?: string;
    idle_ttl_ms: number | null;
    ended_at?: number;
  },
): void {
  db.prepare(
    `INSERT INTO staff_sessions (
      session_id, branch_id, token_hash, kind, staff_id, station_id, device_id, idle_ttl_ms, started_at, last_activity_at, ended_at
    ) VALUES (?, 'branch-1', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.session_id,
    row.token_hash,
    row.kind,
    row.staff_id ?? null,
    row.station_id ?? null,
    row.device_id ?? null,
    row.idle_ttl_ms,
    T,
    T,
    row.ended_at ?? null,
  );
}
