import { fileURLToPath } from 'node:url';
import type { DirectoryInput } from '@pos/events';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { applyStaffDirectory } from '../../src/auth/apply-directory';
import type { StaffDirectory } from '../../src/auth/staff-directory';
import { StaffDirectory as Directory } from '../../src/auth/staff-directory';
import { activity, createSession, findSessionByToken, isIdleExpired } from '../../src/auth/session-store';
import { runMigrations } from '../../src/db/migrate';
import { createAuthGeneration } from '../../src/engine-host/auth-generation';
import { createStateHolder } from '../../src/engine-host/state-holder';
import { createWriter, type Writer } from '../../src/engine-host/writer';
import { fixedClock, T } from '../../src/lib/clock';
import { testIdGen } from '../../src/lib/ids';
import { pinHash } from '../helpers/fixtures';
import { freshDb } from '../helpers/db';
import { createProjectionRegistry } from '../../src/projections/registry';

const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const BRANCH = 'branch-1';

describe('applyStaffDirectory', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    activity.drain();
    activity.drainDevices();
  });

  it('[00 §3.1 M46] isIdleExpired is strict and an activity touch counts', () => {
    const row = {
      session_id: 's-idle',
      kind: 'staff' as const,
      staff_id: 'S1',
      station_id: null,
      device_id: 'dev-1',
      idle_ttl_ms: 1_000,
      last_activity_at: 5_000,
      ended_at: null,
      token_hash: 'hash',
    };
    expect(isIdleExpired(row, 6_000)).toBe(false);
    expect(isIdleExpired(row, 6_001)).toBe(true);
    activity.touch(row.session_id, 6_000);
    expect(isIdleExpired(row, 7_000)).toBe(false);
    expect(isIdleExpired(row, 7_001)).toBe(true);
    expect(isIdleExpired({ ...row, idle_ttl_ms: null }, 99_999)).toBe(false);
    activity.forget(row.session_id);
  });

  it('[00 §10 #70] removed staff sessions end staff_removed and a permission change applies on the next read', async () => {
    let current: StaffDirectory | undefined;
    const during: Array<string | undefined> = [];
    const { db, writer } = await open({
      beforeCommit() {
        during.push(current?.resolve('S_KEEP', 'reprint-ticket').grant);
      },
    });
    const hash = await pinHash('1234');
    writer.run((tx) => {
      applyStaffDirectory(tx, dir(1, hash, ['reprint-ticket'], ['S_KEEP', 'S_GONE']), (next) => {
        current = next;
      });
    });
    insertDevice(db, { device_id: 'dev-gone', token_hash: 'tok-gone', device_type: 'tablet' });
    const session = writer.run((tx) =>
      createSession(tx, {
        kind: 'staff',
        staffId: 'S_GONE',
        stationId: null,
        deviceId: 'dev-gone',
        idleTtlMs: 60_000,
        eventDeviceId: 'dev-gone',
      }),
    ).result;
    const admin = writer.run((tx) =>
      createSession(tx, {
        kind: 'admin',
        staffId: 'S_GONE',
        stationId: null,
        deviceId: 'dev-gone',
        idleTtlMs: 60_000,
        eventDeviceId: 'dev-gone',
      }),
    ).result;
    writer.run((tx) => {
      applyStaffDirectory(tx, dir(2, hash, [], ['S_KEEP']), (next) => {
        current = next;
      });
    });
    expect(during.at(-1)).toBe('allowed');
    expect(current?.resolve('S_KEEP', 'reprint-ticket')).toEqual({ grant: 'not_granted' });
    expect(Directory.load(db).resolve('S_KEEP', 'reprint-ticket')).toEqual({ grant: 'not_granted' });
    expect(findSessionByToken(db, session.token)?.ended_at).toBe(T);
    for (const id of [session.sessionId, admin.sessionId]) {
      expect(db.prepare('SELECT end_reason FROM staff_sessions WHERE session_id = ?').pluck().get(id)).toBe('staff_removed');
    }
    const ended = events(db).filter((event) => event.event_type === 'SessionEnded');
    expect(ended).toHaveLength(2);
    expect(ended).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actor_id: null,
          device_id: 'hub',
          payload: expect.objectContaining({ session_id: session.sessionId, reason: 'staff_removed', ended_by: null }),
        }),
        expect.objectContaining({
          actor_id: null,
          device_id: 'hub',
          payload: expect.objectContaining({ session_id: admin.sessionId, reason: 'staff_removed', ended_by: null }),
        }),
      ]),
    );
  });

  it('[00 §10 #83] removing the owner revokes their phones and leaves other devices', async () => {
    let db!: Database.Database;
    const seen: Array<{ version: unknown; revoked: unknown }> = [];
    const opened = await open({
      beforeCommit() {
        seen.push({
          version: db.prepare('SELECT directory_version FROM staff_directory_meta').pluck().get(),
          revoked: db.prepare("SELECT revoked_at FROM devices WHERE device_id = 'phone-owner'").pluck().get(),
        });
      },
    });
    db = opened.db;
    const { writer } = opened;
    const hash = await pinHash('1234');
    writer.run((tx) => applyStaffDirectory(tx, dir(1, hash, [], ['S_OWNER', 'S_OTHER']), () => undefined));
    insertDevice(db, { device_id: 'phone-owner', token_hash: 'tok-phone', device_type: 'phone', owner_staff_id: 'S_OWNER' });
    insertDevice(db, { device_id: 'tablet-owner', token_hash: 'tok-tablet', device_type: 'tablet' });
    insertDevice(db, { device_id: 'phone-other', token_hash: 'tok-other', device_type: 'phone', owner_staff_id: 'S_OTHER' });
    const phoneSession = writer.run((tx) =>
      createSession(tx, {
        kind: 'staff',
        staffId: 'S_OWNER',
        stationId: null,
        deviceId: 'phone-owner',
        idleTtlMs: 60_000,
        eventDeviceId: 'phone-owner',
      }),
    ).result;
    writer.run((tx) => applyStaffDirectory(tx, dir(2, hash, [], ['S_OTHER']), () => undefined));
    expect(db.prepare('SELECT revoked_at, revoked_by FROM devices WHERE device_id = ?').get('phone-owner')).toEqual({
      revoked_at: T,
      revoked_by: null,
    });
    expect(db.prepare('SELECT revoked_at FROM devices WHERE device_id = ?').pluck().get('tablet-owner')).toBeNull();
    expect(db.prepare('SELECT revoked_at FROM devices WHERE device_id = ?').pluck().get('phone-other')).toBeNull();
    expect(seen.at(-1)).toEqual({ version: 2, revoked: T });
    expect(db.prepare('SELECT end_reason FROM staff_sessions WHERE session_id = ?').pluck().get(phoneSession.sessionId)).toBe(
      'staff_removed',
    );
    const ended = events(db).filter((event) => event.event_type === 'SessionEnded');
    expect(ended).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ session_id: phoneSession.sessionId, reason: 'staff_removed', ended_by: null }),
      }),
    ]);
    const revoked = events(db).filter((event) => event.event_type === 'DeviceRevoked');
    expect(revoked).toEqual([
      expect.objectContaining({
        actor_id: null,
        device_id: 'hub',
        payload: { device_id: 'phone-owner', reason: null, cause: 'owner_removed' },
      }),
    ]);
  });

  it('[00 §10 #101] a changed pin_hash ends staff and admin sessions credentials_changed', async () => {
    const { db, writer } = await open();
    const before = await pinHash('1234');
    const after = await pinHash('999999');
    writer.run((tx) => applyStaffDirectory(tx, dir(1, before, [], ['S_CHANGED', 'S_SAME']), () => undefined));
    insertDevice(db, { device_id: 'dev-1', token_hash: 'tok-1', device_type: 'tablet' });
    insertDevice(db, { device_id: 'dev-2', token_hash: 'tok-2', device_type: 'tablet' });
    const staff = writer.run((tx) =>
      createSession(tx, {
        kind: 'staff',
        staffId: 'S_CHANGED',
        stationId: null,
        deviceId: 'dev-1',
        idleTtlMs: 60_000,
        eventDeviceId: 'dev-1',
      }),
    ).result;
    const admin = writer.run((tx) =>
      createSession(tx, {
        kind: 'admin',
        staffId: 'S_CHANGED',
        stationId: null,
        deviceId: 'dev-1',
        idleTtlMs: 60_000,
        eventDeviceId: 'dev-1',
      }),
    ).result;
    const other = writer.run((tx) =>
      createSession(tx, {
        kind: 'staff',
        staffId: 'S_SAME',
        stationId: null,
        deviceId: 'dev-2',
        idleTtlMs: 60_000,
        eventDeviceId: 'dev-2',
      }),
    ).result;
    const next = dir(2, before, [], ['S_CHANGED', 'S_SAME']);
    next.staff[0]!.pin_hash = after;
    writer.run((tx) => applyStaffDirectory(tx, next, () => undefined));
    expect(db.prepare('SELECT end_reason FROM staff_sessions WHERE session_id = ?').pluck().get(staff.sessionId)).toBe(
      'credentials_changed',
    );
    expect(db.prepare('SELECT end_reason FROM staff_sessions WHERE session_id = ?').pluck().get(admin.sessionId)).toBe(
      'credentials_changed',
    );
    expect(db.prepare('SELECT ended_at FROM staff_sessions WHERE session_id = ?').pluck().get(other.sessionId)).toBeNull();
    expect(findSessionByToken(db, staff.token)?.ended_at).toBe(T);
    const ended = events(db).filter((event) => event.event_type === 'SessionEnded');
    expect(ended).toHaveLength(2);
    expect(ended).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({ session_id: staff.sessionId, reason: 'credentials_changed' }),
        }),
        expect.objectContaining({
          payload: expect.objectContaining({ session_id: admin.sessionId, reason: 'credentials_changed' }),
        }),
      ]),
    );
  });

  it('[00 §10 #102] equal or older directory versions are a no-op and a newer version applies', async () => {
    const { db, writer } = await open();
    const hash = await pinHash('1234');
    expect(writer.run((tx) => applyStaffDirectory(tx, dir(2, hash, [], ['S1']), () => undefined)).result).toEqual({
      applied: true,
    });
    const replay = dir(2, hash, [], ['S1']);
    replay.staff[0]!.display_name = 'Changed';
    replay.staff.push({ staff_id: 'S_EXTRA', display_name: 'Extra', pin_hash: hash, role_ids: ['R1'], denied_permissions: [] });
    expect(writer.run((tx) => applyStaffDirectory(tx, replay, () => undefined)).result).toEqual({ applied: false });
    const older = dir(1, hash, [], ['S_OTHER']);
    older.staff[0]!.display_name = 'Older';
    expect(writer.run((tx) => applyStaffDirectory(tx, older, () => undefined)).result).toEqual({ applied: false });
    expect(db.prepare('SELECT staff_id, display_name FROM staff').all()).toEqual([{ staff_id: 'S1', display_name: 'S1' }]);
    expect(events(db).filter((event) => event.event_type === 'StaffDirectoryApplied')).toHaveLength(1);
    expect(db.prepare('SELECT directory_version FROM staff_directory_meta').pluck().get()).toBe(2);
    writer.run((tx) => applyStaffDirectory(tx, dir(3, hash, [], ['S1']), () => undefined));
    expect(db.prepare('SELECT directory_version FROM staff_directory_meta').pluck().get()).toBe(3);
    expect(events(db).filter((event) => event.event_type === 'StaffDirectoryApplied')).toHaveLength(2);
  });

  it('[00 §10 #103] bad rows are skipped and listed and another staff member is still removed', async () => {
    const { db, writer } = await open();
    const hash = await pinHash('1234');
    writer.run((tx) => applyStaffDirectory(tx, dir(1, hash, ['reprint-ticket'], ['S_KEEP', 'S_GONE']), () => undefined));
    insertDevice(db, { device_id: 'dev-gone', token_hash: 'tok-gone', device_type: 'tablet' });
    writer.run((tx) =>
      createSession(tx, {
        kind: 'staff',
        staffId: 'S_GONE',
        stationId: null,
        deviceId: 'dev-gone',
        idleTtlMs: 60_000,
        eventDeviceId: 'dev-gone',
      }),
    );
    const weak = '$argon2id$v=19$m=1024,t=2,p=1$c2FsdA$aGFzaA';
    const next: DirectoryInput = {
      directory_version: 2,
      roles: [
        {
          role_id: 'R1',
          name: 'R1',
          session_idle_ttl_ms: 1_000,
          permissions: [
            { permission: 'reprint-ticket', grant_type: 'allowed', approver_role_id: null },
            { permission: 'not-a-permission', grant_type: 'allowed', approver_role_id: null },
            { permission: 'apply-discount', grant_type: 'requires_approval', approver_role_id: 'R_MISSING' },
          ],
        },
      ],
      staff: [
        { staff_id: 'S_KEEP', display_name: 'S_KEEP', pin_hash: hash, role_ids: ['R1', 'R_UNKNOWN'], denied_permissions: [] },
        { staff_id: 'S_WEAK', display_name: 'S_WEAK', pin_hash: weak, role_ids: ['R1'], denied_permissions: [] },
      ],
    };
    writer.run((tx) => applyStaffDirectory(tx, next, () => undefined));
    const applied = events(db).filter((event) => event.event_type === 'StaffDirectoryApplied').at(-1);
    expect(applied?.payload.skipped).toEqual(
      expect.arrayContaining([
        { kind: 'staff', id: 'S_WEAK', reason: 'weak pin_hash' },
        { kind: 'role_assignment', id: 'S_KEEP:R_UNKNOWN', reason: 'unknown role' },
        { kind: 'permission', id: 'R1:not-a-permission', reason: 'unknown permission' },
        { kind: 'approver', id: 'R1:apply-discount', reason: 'unknown approver' },
      ]),
    );
    expect(db.prepare('SELECT staff_id FROM staff ORDER BY staff_id').pluck().all()).toEqual(['S_KEEP']);
    expect(db.prepare('SELECT permission FROM role_permissions ORDER BY permission').pluck().all()).toEqual(['reprint-ticket']);
    expect(db.prepare('SELECT role_id FROM staff_roles WHERE staff_id = ?').pluck().all('S_KEEP')).toEqual(['R1']);
    expect(db.prepare("SELECT end_reason FROM staff_sessions WHERE staff_id = 'S_GONE'").pluck().get()).toBe('staff_removed');
  });

  it('[00 §3.1 M52] a grant or reference the cache cannot store is skipped and the rest applies', async () => {
    const { db, writer } = await open();
    const hash = await pinHash('1234');
    writer.run((tx) => applyStaffDirectory(tx, dir(1, hash, ['reprint-ticket'], ['S_KEEP', 'S_GONE']), () => undefined));
    insertDevice(db, { device_id: 'dev-gone', token_hash: 'tok-gone', device_type: 'tablet' });
    writer.run((tx) =>
      createSession(tx, {
        kind: 'staff',
        staffId: 'S_GONE',
        stationId: null,
        deviceId: 'dev-gone',
        idleTtlMs: 60_000,
        eventDeviceId: 'dev-gone',
      }),
    );
    const next: DirectoryInput = {
      directory_version: 2,
      roles: [
        {
          role_id: 'R1',
          name: 'R1',
          session_idle_ttl_ms: 1_000,
          permissions: [
            { permission: 'reprint-ticket', grant_type: 'allowed', approver_role_id: 'R1' },
            { permission: 'reprint-ticket', grant_type: 'allowed', approver_role_id: null },
            { permission: 'manage-devices', grant_type: 'allowed', approver_role_id: null },
            { permission: 'manage-devices', grant_type: 'requires_approval', approver_role_id: 'R1' },
          ],
        },
        {
          role_id: 'R1',
          name: 'R1-again',
          session_idle_ttl_ms: 2_000,
          permissions: [{ permission: 'void-item', grant_type: 'allowed', approver_role_id: null }],
        },
      ],
      staff: [
        {
          staff_id: 'S_KEEP',
          display_name: 'S_KEEP',
          pin_hash: hash,
          role_ids: ['R1', 'R1', 'R_UNKNOWN'],
          denied_permissions: ['not-a-permission', 'apply-discount', 'apply-discount'],
        },
        {
          staff_id: 'S_KEEP',
          display_name: 'Other',
          pin_hash: hash,
          role_ids: ['R1'],
          denied_permissions: [],
        },
      ],
    };
    writer.run((tx) => applyStaffDirectory(tx, next, () => undefined));
    expect(db.prepare('SELECT staff_id, display_name FROM staff').all()).toEqual([{ staff_id: 'S_KEEP', display_name: 'S_KEEP' }]);
    expect(db.prepare('SELECT name, session_idle_ttl_ms FROM roles').all()).toEqual([{ name: 'R1', session_idle_ttl_ms: 1_000 }]);
    expect(db.prepare('SELECT permission, grant_type, approver_role_id FROM role_permissions ORDER BY permission').all()).toEqual([
      { permission: 'manage-devices', grant_type: 'allowed', approver_role_id: null },
      { permission: 'reprint-ticket', grant_type: 'allowed', approver_role_id: null },
    ]);
    expect(db.prepare('SELECT role_id FROM staff_roles').all()).toEqual([{ role_id: 'R1' }]);
    expect(db.prepare('SELECT permission FROM staff_permission_denials').pluck().all()).toEqual(['apply-discount']);
    expect(db.prepare("SELECT end_reason FROM staff_sessions WHERE staff_id = 'S_GONE'").pluck().get()).toBe('staff_removed');
    const applied = events(db).filter((event) => event.event_type === 'StaffDirectoryApplied').at(-1);
    expect(applied?.payload.skipped).toEqual(
      expect.arrayContaining([
        { kind: 'permission', id: 'R1:reprint-ticket', reason: 'approver set on an allowed grant' },
        { kind: 'permission', id: 'R1:manage-devices', reason: 'duplicate permission' },
        { kind: 'role_assignment', id: 'R1', reason: 'duplicate role' },
        { kind: 'role_assignment', id: 'S_KEEP:R1', reason: 'duplicate role' },
        { kind: 'role_assignment', id: 'S_KEEP:R_UNKNOWN', reason: 'unknown role' },
        { kind: 'permission', id: 'S_KEEP:not-a-permission', reason: 'unknown permission' },
        { kind: 'permission', id: 'S_KEEP:apply-discount', reason: 'duplicate permission' },
        { kind: 'staff', id: 'S_KEEP', reason: 'duplicate staff' },
      ]),
    );
  });

  it('[00 §10 #129] a malformed hash keeps an existing staff row and drops a new one', async () => {
    const { db, writer } = await open();
    const hash = await pinHash('1234');
    const first = dir(1, hash, ['reprint-ticket'], ['S_OLD']);
    first.staff[0]!.denied_permissions = ['reprint-ticket'];
    writer.run((tx) => applyStaffDirectory(tx, first, () => undefined));
    insertDevice(db, { device_id: 'phone-old', token_hash: 'tok-phone', device_type: 'phone', owner_staff_id: 'S_OLD' });
    insertDevice(db, { device_id: 'dev-old', token_hash: 'tok-old', device_type: 'tablet' });
    const session = writer.run((tx) =>
      createSession(tx, {
        kind: 'staff',
        staffId: 'S_OLD',
        stationId: null,
        deviceId: 'dev-old',
        idleTtlMs: 60_000,
        eventDeviceId: 'dev-old',
      }),
    ).result;
    const malformed = 'not-a-hash';
    writer.run((tx) =>
      applyStaffDirectory(
        tx,
        {
          directory_version: 2,
          roles: [{ role_id: 'R2', name: 'R2', session_idle_ttl_ms: 1_000, permissions: [] }],
          staff: [
            { staff_id: 'S_OLD', display_name: 'Renamed', pin_hash: malformed, role_ids: ['R2'], denied_permissions: [] },
            { staff_id: 'S_NEW', display_name: 'S_NEW', pin_hash: malformed, role_ids: ['R2'], denied_permissions: [] },
          ],
        },
        () => undefined,
      ),
    );
    expect(db.prepare('SELECT pin_hash, display_name FROM staff WHERE staff_id = ?').get('S_OLD')).toEqual({
      pin_hash: hash,
      display_name: 'S_OLD',
    });
    expect(db.prepare('SELECT role_id FROM staff_roles WHERE staff_id = ?').pluck().all('S_OLD')).toEqual(['R1']);
    expect(db.prepare('SELECT permission FROM staff_permission_denials WHERE staff_id = ?').pluck().all('S_OLD')).toEqual([
      'reprint-ticket',
    ]);
    expect(db.prepare("SELECT staff_id FROM staff WHERE staff_id = 'S_NEW'").get()).toBeUndefined();
    expect(db.prepare('SELECT ended_at FROM staff_sessions WHERE session_id = ?').pluck().get(session.sessionId)).toBeNull();
    expect(db.prepare('SELECT revoked_at FROM devices WHERE device_id = ?').pluck().get('phone-old')).toBeNull();
    const applied = events(db).filter((event) => event.event_type === 'StaffDirectoryApplied').at(-1);
    expect(applied?.payload.skipped).toEqual(
      expect.arrayContaining([
        { kind: 'staff', id: 'S_OLD', reason: 'malformed pin_hash' },
        { kind: 'staff', id: 'S_NEW', reason: 'malformed pin_hash' },
      ]),
    );
    expect(applied?.payload.removed_staff_ids).toEqual([]);
    expect(applied?.payload.credentials_changed_staff_ids).toEqual([]);
  });

  it('[00 §3.1 M75] a kept role retains its approver when the new directory omits both', async () => {
    const { db, writer } = await open();
    const hash = await pinHash('1234');
    const first: DirectoryInput = {
      directory_version: 1,
      roles: [
        {
          role_id: 'R_CASH',
          name: 'Cashier',
          session_idle_ttl_ms: 1_000,
          permissions: [{ permission: 'apply-discount', grant_type: 'requires_approval', approver_role_id: 'R_MGR' }],
        },
        { role_id: 'R_MGR', name: 'Manager', session_idle_ttl_ms: 1_000, permissions: [] },
      ],
      staff: [
        {
          staff_id: 'S_OLD',
          display_name: 'Old',
          pin_hash: hash,
          role_ids: ['R_CASH'],
          denied_permissions: ['reprint-ticket'],
        },
        { staff_id: 'S_GONE', display_name: 'Gone', pin_hash: hash, role_ids: ['R_MGR'], denied_permissions: [] },
      ],
    };
    writer.run((tx) => applyStaffDirectory(tx, first, () => undefined));
    writer.run((tx) =>
      applyStaffDirectory(
        tx,
        {
          directory_version: 2,
          roles: [{ role_id: 'R_NEW', name: 'New', session_idle_ttl_ms: 1_000, permissions: [] }],
          staff: [
            { staff_id: 'S_OLD', display_name: 'Changed', pin_hash: 'not-a-hash', role_ids: ['R_NEW'], denied_permissions: [] },
          ],
        },
        () => undefined,
      ),
    );
    expect(db.prepare('SELECT directory_version FROM staff_directory_meta').pluck().get()).toBe(2);
    expect(db.prepare('SELECT pin_hash, display_name FROM staff WHERE staff_id = ?').get('S_OLD')).toEqual({
      pin_hash: hash,
      display_name: 'Old',
    });
    expect(db.prepare('SELECT role_id FROM staff_roles WHERE staff_id = ?').pluck().all('S_OLD')).toEqual(['R_CASH']);
    expect(db.prepare('SELECT permission FROM staff_permission_denials WHERE staff_id = ?').pluck().all('S_OLD')).toEqual([
      'reprint-ticket',
    ]);
    expect(db.prepare('SELECT role_id FROM roles ORDER BY role_id').pluck().all()).toEqual(['R_CASH', 'R_MGR', 'R_NEW']);
    expect(db.prepare("SELECT staff_id FROM staff WHERE staff_id = 'S_GONE'").get()).toBeUndefined();
  });

  async function open(hooks?: { beforeCommit?: () => void }): Promise<{ db: Database.Database; writer: Writer }> {
    const fx = freshDb();
    cleanups.push(fx.cleanup);
    const clock = fixedClock(T);
    await runMigrations(fx.db, { dir: migrations, clock });
    const state = createStateHolder<unknown>({});
    state.setReducer((current) => current);
    const writer = createWriter({
      db: fx.db,
      clock,
      ids: testIdGen(),
      tenantId: 'tenant-a',
      branchId: BRANCH,
      projections: createProjectionRegistry(),
      state,
      authGeneration: createAuthGeneration(),
      publish: () => undefined,
      testHooks: hooks,
    });
    return { db: fx.db, writer };
  }
});

function dir(version: number, hash: string, permissions: string[], staffIds: string[]): DirectoryInput {
  return {
    directory_version: version,
    roles: [
      {
        role_id: 'R1',
        name: 'R1',
        session_idle_ttl_ms: 1_000,
        permissions: permissions.map((permission) => ({ permission, grant_type: 'allowed' as const, approver_role_id: null })),
      },
    ],
    staff: staffIds.map((staff_id) => ({
      staff_id,
      display_name: staff_id,
      pin_hash: hash,
      role_ids: ['R1'],
      denied_permissions: [],
    })),
  };
}

function insertDevice(
  db: Database.Database,
  row: { device_id: string; token_hash: string; device_type: string; owner_staff_id?: string },
): void {
  db.prepare(
    `INSERT INTO devices (
      device_id, branch_id, token_hash, device_name, device_type, station_id, owner_staff_id, paired_at, paired_by
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'admin')`,
  ).run(row.device_id, BRANCH, row.token_hash, row.device_id, row.device_type, row.owner_staff_id ?? null, T);
}

function events(db: Database.Database): Array<{
  event_type: string;
  payload: Record<string, unknown>;
  actor_id: string | null;
  device_id: string;
}> {
  const rows = db.prepare('SELECT event_type, payload, actor_id, device_id FROM events ORDER BY seq').all() as Array<{
    event_type: string;
    payload: string;
    actor_id: string | null;
    device_id: string;
  }>;
  return rows.map((row) => ({ ...row, payload: JSON.parse(row.payload) as Record<string, unknown> }));
}
