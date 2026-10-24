import { fileURLToPath } from 'node:url';
import { PERMISSIONS } from '@pos/domain';
import type { DirectoryInput } from '@pos/events';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate';
import { fixedClock, T } from '../lib/clock';
import { StaffDirectory } from './staff-directory';
import { freshDb } from '../../test/helpers/db';
import { aDirectory } from '../../test/helpers/fixtures';

const migrations = fileURLToPath(new URL('../db/migrations', import.meta.url));

describe('StaffDirectory', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('[00 §10 #78] resolve truth table', () => {
    const directory = StaffDirectory.fromInput(truthTable());
    expect(directory.resolve('S_DENY', 'reprint-ticket')).toEqual({ grant: 'denied' });
    expect(directory.resolve('S_DENY', 'manage-devices')).toEqual({ grant: 'allowed' });
    expect(directory.resolve('S_DENY', 'apply-discount')).toEqual({ grant: 'not_granted' });
    expect(directory.resolve('S_MULTI', 'apply-discount')).toEqual({
      grant: 'requires_approval',
      approver_role_ids: ['R_CASH', 'R_MGR'],
    });
    expect(directory.resolve('S_MULTI', 'void-item')).toEqual({
      grant: 'requires_approval',
      approver_role_ids: ['R_OWNER'],
    });
    expect(directory.resolve('S_MULTI', 'reprint-ticket')).toEqual({ grant: 'not_granted' });
    expect(directory.resolve('S_WIN', 'manage-devices')).toEqual({ grant: 'allowed' });
    expect(directory.resolve('S_NONE', 'reprint-ticket')).toEqual({ grant: 'not_granted' });
    expect(directory.resolve('S_DENY_APPROVAL', 'apply-discount')).toEqual({ grant: 'denied' });
    expect(directory.hasAdmin('S_WIN')).toBe(false);
    expect(directory.permissionsOf('S_DENY')['reprint-ticket']).toEqual({ grant: 'denied' });
    expect(Object.keys(directory.permissionsOf('S_DENY'))).toEqual([...PERMISSIONS]);
  });

  it('[00 §3.1 M11] ttlFor is the max across roles', async () => {
    const directory = StaffDirectory.fromInput(truthTable());
    expect(directory.ttlFor('S_WIN')).toBe(5_000);
    expect(directory.ttlFor('S_DENY')).toBe(1_000);
    expect(directory.ttlFor('S_MISSING')).toBe(0);
    const fixture = StaffDirectory.fromInput(await aDirectory());
    expect(fixture.ttlFor('S_OWNER')).toBe(3_600_000);
    expect(fixture.ttlFor('S_MGR')).toBe(3_600_000);
    expect(fixture.ttlFor('S_CASH')).toBe(1_800_000);
    expect(fixture.ttlFor('S_WAIT')).toBe(300_000);
    expect(fixture.resolve('S_CASH', 'apply-discount')).toEqual({
      grant: 'requires_approval',
      approver_role_ids: ['R_MGR'],
    });
    expect(fixture.resolve('S_CASH', 'reprint-ticket')).toEqual({ grant: 'allowed' });
    expect(fixture.resolve('S_MGR', 'manage-roles')).toEqual({ grant: 'not_granted' });
    expect(fixture.resolve('S_MGR', 'manage-devices')).toEqual({ grant: 'allowed' });
    expect(fixture.hasAdmin('S_OWNER')).toBe(true);
    expect(fixture.hasAdmin('S_WAIT')).toBe(false);
    expect(fixture.version).toBe(1);
  });

  it('[00 §5.1] load() round trip through the cache tables', async () => {
    const input = await aDirectory({ directory_version: 4 });
    const fx = freshDb();
    cleanups.push(fx.cleanup);
    await runMigrations(fx.db, { dir: migrations, clock: fixedClock(T) });
    writeDirectory(fx.db, input);
    const loaded = StaffDirectory.load(fx.db);
    const built = StaffDirectory.fromInput(input);
    expect(loaded.version).toBe(4);
    expect(loaded.list()).toEqual(built.list());
    for (const staff of built.list()) {
      expect(loaded.get(staff.staff_id)).toEqual(built.get(staff.staff_id));
      expect(loaded.ttlFor(staff.staff_id)).toBe(built.ttlFor(staff.staff_id));
      expect(loaded.permissionsOf(staff.staff_id)).toEqual(built.permissionsOf(staff.staff_id));
    }
  });
});

function truthTable(): DirectoryInput {
  return {
    directory_version: 1,
    roles: [
      {
        role_id: 'R_A',
        name: 'A',
        session_idle_ttl_ms: 1_000,
        permissions: [
          { permission: 'reprint-ticket', grant_type: 'allowed', approver_role_id: null },
          { permission: 'manage-devices', grant_type: 'allowed', approver_role_id: null },
        ],
      },
      {
        role_id: 'R_B',
        name: 'B',
        session_idle_ttl_ms: 5_000,
        permissions: [
          { permission: 'apply-discount', grant_type: 'requires_approval', approver_role_id: 'R_MGR' },
          { permission: 'void-item', grant_type: 'requires_approval', approver_role_id: 'R_OWNER' },
          { permission: 'manage-devices', grant_type: 'requires_approval', approver_role_id: 'R_CASH' },
        ],
      },
      {
        role_id: 'R_C',
        name: 'C',
        session_idle_ttl_ms: 9_000,
        permissions: [{ permission: 'apply-discount', grant_type: 'requires_approval', approver_role_id: 'R_CASH' }],
      },
    ],
    staff: [
      {
        staff_id: 'S_DENY',
        display_name: 'Denied',
        pin_hash: 'hash-deny',
        role_ids: ['R_A'],
        denied_permissions: ['reprint-ticket'],
      },
      {
        staff_id: 'S_MULTI',
        display_name: 'Multi',
        pin_hash: 'hash-multi',
        role_ids: ['R_B', 'R_C'],
        denied_permissions: [],
      },
      {
        staff_id: 'S_WIN',
        display_name: 'Win',
        pin_hash: 'hash-win',
        role_ids: ['R_A', 'R_B'],
        denied_permissions: [],
      },
      {
        staff_id: 'S_NONE',
        display_name: 'None',
        pin_hash: 'hash-none',
        role_ids: [],
        denied_permissions: [],
      },
      {
        staff_id: 'S_DENY_APPROVAL',
        display_name: 'Deny approval',
        pin_hash: 'hash-deny-approval',
        role_ids: ['R_B'],
        denied_permissions: ['apply-discount'],
      },
    ],
  };
}

function writeDirectory(db: Database.Database, input: DirectoryInput): void {
  const insertRole = db.prepare(
    'INSERT INTO roles (role_id, branch_id, name, session_idle_ttl_ms) VALUES (?, ?, ?, ?)',
  );
  const insertPerm = db.prepare(
    'INSERT INTO role_permissions (role_id, permission, grant_type, approver_role_id) VALUES (?, ?, ?, ?)',
  );
  const insertStaff = db.prepare('INSERT INTO staff (staff_id, branch_id, display_name, pin_hash) VALUES (?, ?, ?, ?)');
  const insertAssignment = db.prepare('INSERT INTO staff_roles (staff_id, role_id) VALUES (?, ?)');
  const insertDenial = db.prepare('INSERT INTO staff_permission_denials (staff_id, permission) VALUES (?, ?)');
  for (const role of input.roles) {
    insertRole.run(role.role_id, 'branch-1', role.name, role.session_idle_ttl_ms);
    for (const permission of role.permissions) {
      insertPerm.run(role.role_id, permission.permission, permission.grant_type, permission.approver_role_id);
    }
  }
  for (const staff of input.staff) {
    insertStaff.run(staff.staff_id, 'branch-1', staff.display_name, staff.pin_hash);
    for (const roleId of staff.role_ids) insertAssignment.run(staff.staff_id, roleId);
    for (const permission of staff.denied_permissions) insertDenial.run(staff.staff_id, permission);
  }
  db.prepare('INSERT INTO staff_directory_meta (branch_id, directory_version, applied_at) VALUES (?, ?, ?)').run(
    'branch-1',
    input.directory_version,
    T,
  );
}
