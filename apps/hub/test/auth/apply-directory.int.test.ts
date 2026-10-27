import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { statementCounter } from '../helpers/statement-counter';
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
    const late: { db?: Database.Database } = {};
    const seen: Array<{ version: unknown; revoked: unknown }> = [];
    const opened = await open({
      beforeCommit() {
        const db = late.db;
        if (db === undefined) return;
        seen.push({
          version: db.prepare('SELECT directory_version FROM staff_directory_meta').pluck().get(),
          revoked: db.prepare("SELECT revoked_at FROM devices WHERE device_id = 'phone-owner'").pluck().get(),
        });
      },
    });
    late.db = opened.db;
    const { db, writer } = opened;
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
            allowedGrant('reprint-ticket'),
            allowedGrant('not-a-permission'),
            approvalGrant('apply-discount', ['R_MISSING']),
          ],
        },
      ],
      staff: [staffRow('S_KEEP', hash, ['R1', 'R_UNKNOWN']), staffRow('S_WEAK', weak, ['R1'])],
      responsibilities: [],
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
            allowedGrant('reprint-ticket', ['R1']),
            allowedGrant('reprint-ticket'),
            allowedGrant('manage-devices'),
            approvalGrant('manage-devices', ['R1']),
          ],
        },
        {
          role_id: 'R1',
          name: 'R1-again',
          session_idle_ttl_ms: 2_000,
          permissions: [allowedGrant('void-item')],
        },
      ],
      staff: [
        staffRow('S_KEEP', hash, ['R1', 'R1', 'R_UNKNOWN'], {
          denied_permissions: ['not-a-permission', 'apply-discount', 'apply-discount'],
        }),
        staffRow('S_KEEP', hash, ['R1'], { display_name: 'Other' }),
      ],
      responsibilities: [],
    };
    writer.run((tx) => applyStaffDirectory(tx, next, () => undefined));
    expect(db.prepare('SELECT staff_id, display_name FROM staff').all()).toEqual([{ staff_id: 'S_KEEP', display_name: 'S_KEEP' }]);
    expect(db.prepare('SELECT name, session_idle_ttl_ms FROM roles').all()).toEqual([{ name: 'R1', session_idle_ttl_ms: 1_000 }]);
    expect(db.prepare('SELECT permission, grant_type FROM role_permissions ORDER BY permission').all()).toEqual([
      { permission: 'manage-devices', grant_type: 'allowed' },
      { permission: 'reprint-ticket', grant_type: 'allowed' },
    ]);
    expect(db.prepare('SELECT COUNT(*) FROM role_permission_approvers').pluck().get()).toBe(0);
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
            staffRow('S_OLD', malformed, ['R2'], { display_name: 'Renamed' }),
            staffRow('S_NEW', malformed, ['R2']),
          ],
          responsibilities: [],
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
          permissions: [approvalGrant('apply-discount', ['R_MGR'])],
        },
        { role_id: 'R_MGR', name: 'Manager', session_idle_ttl_ms: 1_000, permissions: [] },
      ],
      staff: [
        staffRow('S_OLD', hash, ['R_CASH'], { display_name: 'Old', denied_permissions: ['reprint-ticket'] }),
        staffRow('S_GONE', hash, ['R_MGR'], { display_name: 'Gone' }),
      ],
      responsibilities: [],
    };
    writer.run((tx) => applyStaffDirectory(tx, first, () => undefined));
    writer.run((tx) =>
      applyStaffDirectory(
        tx,
        {
          directory_version: 2,
          roles: [{ role_id: 'R_NEW', name: 'New', session_idle_ttl_ms: 1_000, permissions: [] }],
          staff: [staffRow('S_OLD', 'not-a-hash', ['R_NEW'], { display_name: 'Changed' })],
          responsibilities: [],
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

  it('[01b #22] approver_role_ids and scope round-trip through StaffDirectory.load in 9 statements', async () => {
    const { db, writer } = await open();
    const hash = await pinHash('1234');
    const input: DirectoryInput = {
      directory_version: 1,
      roles: [
        {
          role_id: 'R_WAIT',
          name: 'Waiter',
          session_idle_ttl_ms: 300_000,
          permissions: [
            { permission: 'take-order-anywhere', grant_type: 'allowed', approver_role_id: null, approver_role_ids: [], scope: 'my_floors' },
            {
              permission: 'apply-discount',
              grant_type: 'requires_approval',
              approver_role_id: 'R_MGR',
              approver_role_ids: ['R_MGR', 'R_OWNER'],
              scope: 'branch',
            },
          ],
        },
        { role_id: 'R_MGR', name: 'Manager', session_idle_ttl_ms: 3_600_000, permissions: [] },
        { role_id: 'R_OWNER', name: 'Owner', session_idle_ttl_ms: 3_600_000, permissions: [] },
      ],
      staff: [
        { staff_id: 'S_HAMZA', display_name: 'Hamza', pin_hash: hash, role_ids: ['R_MGR'], denied_permissions: [], lead_staff_id: null, floor_ids: [] },
        {
          staff_id: 'S_BILAL',
          display_name: 'Bilal',
          pin_hash: hash,
          role_ids: ['R_WAIT'],
          denied_permissions: ['void-item'],
          lead_staff_id: 'S_HAMZA',
          floor_ids: ['F_ROOF', 'F_GROUND'],
        },
      ],
      responsibilities: [{ responsibility: 'count_stock', station_id: 'ST_GRILL', staff_ids: ['S_BILAL'], role_ids: ['R_MGR'] }],
    };
    let applied: StaffDirectory | undefined;
    writer.run((tx) => applyStaffDirectory(tx, input, (next) => (applied = next)));
    expect(db.prepare('SELECT permission, scope FROM role_permissions WHERE role_id = ? ORDER BY permission').all('R_WAIT')).toEqual([
      { permission: 'apply-discount', scope: 'branch' },
      { permission: 'take-order-anywhere', scope: 'my_floors' },
    ]);
    expect(db.prepare('SELECT approver_role_id FROM role_permission_approvers ORDER BY approver_role_id').pluck().all()).toEqual([
      'R_MGR',
      'R_OWNER',
    ]);
    expect(db.prepare('SELECT lead_staff_id FROM staff WHERE staff_id = ?').pluck().get('S_BILAL')).toBe('S_HAMZA');
    expect(db.prepare('SELECT floor_id FROM staff_floors ORDER BY floor_id').pluck().all()).toEqual(['F_GROUND', 'F_ROOF']);
    expect(db.prepare('SELECT subject_kind, subject_id FROM responsibilities ORDER BY subject_kind').all()).toEqual([
      { subject_kind: 'role', subject_id: 'R_MGR' },
      { subject_kind: 'staff', subject_id: 'S_BILAL' },
    ]);
    const event = events(db).filter((row) => row.event_type === 'StaffDirectoryApplied').at(-1);
    expect(event?.payload.skipped).toEqual([]);
    expect(db.prepare("SELECT schema_version FROM events WHERE event_type = 'StaffDirectoryApplied'").pluck().get()).toBe(2);

    // restart: the cache read back equals what the apply handed over
    const counter = statementCounter(db);
    const loaded = Directory.load(db);
    expect(counter.count).toBe(9);
    expect(loaded).toEqual(applied);
    expect(loaded.resolve('S_BILAL', 'apply-discount')).toEqual({ grant: 'requires_approval', approver_role_ids: ['R_MGR', 'R_OWNER'] });
  });

  it('[01b #22] a hub database at 0004 with a grant migrates through 0005 and keeps it', async () => {
    const fx = freshDb();
    cleanups.push(fx.cleanup);
    const clock = fixedClock(T);
    const upTo4 = mkdtempSync(join(tmpdir(), 'pos-hub-mig-'));
    cleanups.push(() => rmSync(upTo4, { recursive: true, force: true }));
    for (const name of readdirSync(migrations).filter((file) => /^000[1-4]_.+\.sql$/.test(file))) {
      copyFileSync(join(migrations, name), join(upTo4, name));
    }
    await runMigrations(fx.db, { dir: upTo4, clock });
    fx.db.exec(`
      INSERT INTO roles (role_id, branch_id, name, session_idle_ttl_ms) VALUES ('R_CASH', 'b', 'Cashier', 1000), ('R_MGR', 'b', 'Manager', 1000);
      INSERT INTO role_permissions (role_id, permission, grant_type, approver_role_id)
        VALUES ('R_CASH', 'apply-discount', 'requires_approval', 'R_MGR'), ('R_CASH', 'reprint-ticket', 'allowed', NULL);
      INSERT INTO staff (staff_id, branch_id, display_name, pin_hash) VALUES ('S_CASH', 'b', 'Cashier', 'h');
      INSERT INTO staff_roles (staff_id, role_id) VALUES ('S_CASH', 'R_CASH');
      INSERT INTO staff_directory_meta (branch_id, directory_version, applied_at) VALUES ('b', 3, 1);
    `);
    const result = await runMigrations(fx.db, { dir: migrations, clock });
    expect(result.applied).toContain('0005_directory_v2.sql');
    expect(fx.db.prepare('SELECT role_id, permission, grant_type, scope FROM role_permissions ORDER BY permission').all()).toEqual([
      { role_id: 'R_CASH', permission: 'apply-discount', grant_type: 'requires_approval', scope: 'branch' },
      { role_id: 'R_CASH', permission: 'reprint-ticket', grant_type: 'allowed', scope: 'branch' },
    ]);
    expect(fx.db.prepare('SELECT role_id, permission, approver_role_id FROM role_permission_approvers').all()).toEqual([
      { role_id: 'R_CASH', permission: 'apply-discount', approver_role_id: 'R_MGR' },
    ]);
    const directory = Directory.load(fx.db);
    expect(directory.version).toBe(3);
    expect(directory.resolve('S_CASH', 'apply-discount')).toEqual({ grant: 'requires_approval', approver_role_ids: ['R_MGR'] });
    expect(directory.resolve('S_CASH', 'reprint-ticket')).toEqual({ grant: 'allowed' });
  });

  it('[01b #23] a lead or responsibility naming someone absent is skipped and listed; the rest applies', async () => {
    const { db, writer } = await open();
    const hash = await pinHash('1234');
    const input = dir(1, hash, ['reprint-ticket'], ['S_A', 'S_B']);
    input.staff[0]!.lead_staff_id = 'S_B';
    input.staff[1]!.lead_staff_id = 'S_NO_PIN';
    input.responsibilities = [
      { responsibility: 'count_stock', station_id: 'ST_GRILL', staff_ids: ['S_A', 'S_NO_PIN'], role_ids: ['R1'] },
    ];
    writer.run((tx) => applyStaffDirectory(tx, input, () => undefined));
    expect(db.prepare('SELECT staff_id, lead_staff_id FROM staff ORDER BY staff_id').all()).toEqual([
      { staff_id: 'S_A', lead_staff_id: 'S_B' },
      { staff_id: 'S_B', lead_staff_id: null },
    ]);
    expect(db.prepare('SELECT subject_kind, subject_id FROM responsibilities ORDER BY subject_kind').all()).toEqual([
      { subject_kind: 'role', subject_id: 'R1' },
      { subject_kind: 'staff', subject_id: 'S_A' },
    ]);
    const applied = events(db).filter((event) => event.event_type === 'StaffDirectoryApplied').at(-1);
    expect(applied?.payload.skipped).toEqual([
      { kind: 'lead', id: 'S_B:S_NO_PIN', reason: 'unknown staff' },
      { kind: 'responsibility', id: 'count_stock:ST_GRILL:S_NO_PIN', reason: 'unknown staff' },
    ]);
    expect(db.prepare('SELECT permission FROM role_permissions').pluck().all()).toEqual(['reprint-ticket']);
  });

  it('[01b #84] unknown approvers are dropped; a grant left with none is skipped; the rest applies', async () => {
    const { db, writer } = await open();
    const hash = await pinHash('1234');
    const input = dir(1, hash, ['reprint-ticket'], ['S_A']);
    input.roles.push({ role_id: 'R_MGR', name: 'Manager', session_idle_ttl_ms: 1_000, permissions: [] });
    input.roles[0]!.permissions.push(
      { permission: 'apply-discount', grant_type: 'requires_approval', approver_role_id: 'R_GONE', approver_role_ids: ['R_GONE', 'R_MGR'], scope: 'branch' },
      { permission: 'void-item', grant_type: 'requires_approval', approver_role_id: 'R_GONE', approver_role_ids: ['R_GONE'], scope: 'branch' },
      { permission: 'apply-refund', grant_type: 'requires_approval', approver_role_id: null, approver_role_ids: [], scope: 'branch' },
    );
    let applied: StaffDirectory | undefined;
    writer.run((tx) => applyStaffDirectory(tx, input, (next) => (applied = next)));
    expect(db.prepare('SELECT permission FROM role_permissions ORDER BY permission').pluck().all()).toEqual([
      'apply-discount',
      'reprint-ticket',
    ]);
    expect(db.prepare('SELECT approver_role_id FROM role_permission_approvers').pluck().all()).toEqual(['R_MGR']);
    expect(applied?.resolve('S_A', 'apply-discount')).toEqual({ grant: 'requires_approval', approver_role_ids: ['R_MGR'] });
    expect(applied?.resolve('S_A', 'void-item')).toEqual({ grant: 'not_granted' });
    const event = events(db).filter((row) => row.event_type === 'StaffDirectoryApplied').at(-1);
    expect(event?.payload.skipped).toEqual([
      { kind: 'approver', id: 'R1:apply-discount:R_GONE', reason: 'unknown approver' },
      { kind: 'approver', id: 'R1:void-item', reason: 'unknown approver' },
      { kind: 'approver', id: 'R1:apply-refund', reason: 'no approver' },
    ]);
    expect(db.prepare('SELECT staff_id FROM staff').pluck().all()).toEqual(['S_A']);
  });

  it('[01b #83 hub half] an approver role nobody at the branch holds keeps the cashier grant; nothing skipped', async () => {
    const { db, writer } = await open();
    const hash = await pinHash('1234');
    const input: DirectoryInput = {
      directory_version: 1,
      roles: [
        { role_id: 'R_CASH', name: 'Cashier', session_idle_ttl_ms: 900_000, permissions: [approvalGrant('apply-discount', ['R_MGR'])] },
        { role_id: 'R_MGR', name: 'Manager', session_idle_ttl_ms: 3_600_000, permissions: [] },
      ],
      staff: [staffRow('S_CASH_1', hash, ['R_CASH']), staffRow('S_CASH_2', hash, ['R_CASH'])],
      responsibilities: [],
    };
    let applied: StaffDirectory | undefined;
    writer.run((tx) => applyStaffDirectory(tx, input, (next) => (applied = next)));
    expect(applied?.resolve('S_CASH_1', 'apply-discount')).toEqual({ grant: 'requires_approval', approver_role_ids: ['R_MGR'] });
    expect(Directory.load(db).resolve('S_CASH_2', 'apply-discount')).toEqual({ grant: 'requires_approval', approver_role_ids: ['R_MGR'] });
    const event = events(db).filter((row) => row.event_type === 'StaffDirectoryApplied').at(-1);
    expect(event?.payload.skipped).toEqual([]);
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
        permissions: permissions.map((permission) => allowedGrant(permission)),
      },
    ],
    staff: staffIds.map((staff_id) => staffRow(staff_id, hash, ['R1'])),
    responsibilities: [],
  };
}

function allowedGrant(permission: string, approverRoleIds: string[] = []): DirectoryInput['roles'][number]['permissions'][number] {
  return { permission, grant_type: 'allowed', approver_role_id: approverRoleIds[0] ?? null, approver_role_ids: approverRoleIds, scope: 'branch' };
}

function approvalGrant(permission: string, approverRoleIds: string[]): DirectoryInput['roles'][number]['permissions'][number] {
  return {
    permission,
    grant_type: 'requires_approval',
    approver_role_id: approverRoleIds[0] ?? null,
    approver_role_ids: approverRoleIds,
    scope: 'branch',
  };
}

function staffRow(
  staff_id: string,
  pin_hash: string,
  role_ids: string[],
  o: { display_name?: string; denied_permissions?: string[] } = {},
): DirectoryInput['staff'][number] {
  return {
    staff_id,
    display_name: o.display_name ?? staff_id,
    pin_hash,
    role_ids,
    denied_permissions: o.denied_permissions ?? [],
    lead_staff_id: null,
    floor_ids: [],
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
