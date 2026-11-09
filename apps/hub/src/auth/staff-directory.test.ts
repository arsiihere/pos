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
    expect(directory.resolve('S_DENY', 'manage-devices')).toEqual({ grant: 'allowed', scope: 'branch' });
    expect(directory.resolve('S_DENY', 'apply-discount')).toEqual({ grant: 'not_granted' });
    expect(directory.resolve('S_MULTI', 'apply-discount')).toEqual({
      grant: 'requires_approval',
      approver_role_ids: ['R_CASH', 'R_MGR'],
      scope: 'branch',
    });
    expect(directory.resolve('S_MULTI', 'void-item')).toEqual({
      grant: 'requires_approval',
      approver_role_ids: ['R_OWNER'],
      scope: 'branch',
    });
    expect(directory.resolve('S_MULTI', 'reprint-ticket')).toEqual({ grant: 'not_granted' });
    expect(directory.resolve('S_WIN', 'manage-devices')).toEqual({ grant: 'allowed', scope: 'branch' });
    expect(directory.resolve('S_NONE', 'reprint-ticket')).toEqual({ grant: 'not_granted' });
    expect(directory.resolve('S_DENY_APPROVAL', 'apply-discount')).toEqual({ grant: 'denied' });
    expect(directory.hasAdmin('S_WIN')).toBe(false);
    expect(directory.permissionsOf('S_DENY')['reprint-ticket']).toEqual({ grant: 'denied' });
    expect(Object.keys(directory.permissionsOf('S_DENY'))).toEqual([...PERMISSIONS]);
  });

  it('[02p U-4] my_zones ranks with my_floors in SCOPE_RANK', () => {
    const directory = StaffDirectory.fromInput({
      directory_version: 1,
      roles: [
        { role_id: 'R_Z', name: 'Z', session_idle_ttl_ms: 1_000, permissions: [allowed('manage-zone-stock', 'my_zones')] },
        { role_id: 'R_B', name: 'B', session_idle_ttl_ms: 1_000, permissions: [allowed('manage-zone-stock', 'branch')] },
        { role_id: 'R_O', name: 'O', session_idle_ttl_ms: 1_000, permissions: [allowed('manage-zone-stock', 'own_tables')] },
      ],
      staff: [
        staff('S_ZB', 'ZB', 'h1', ['R_Z', 'R_B']),
        staff('S_OZ', 'OZ', 'h3', ['R_O', 'R_Z']),
      ],
      responsibilities: [],
    });
    expect(directory.resolve('S_ZB', 'manage-zone-stock')).toEqual({ grant: 'allowed', scope: 'branch' });
    // my_zones (rank 1) beats own_tables (rank 0).
    expect(directory.resolve('S_OZ', 'manage-zone-stock')).toEqual({ grant: 'allowed', scope: 'my_zones' });
  });

  it('[02p U-4] my_zones resolves with my_floors rank', () => {
    const directory = StaffDirectory.fromInput({
      directory_version: 1,
      roles: [
        { role_id: 'R_F', name: 'F', session_idle_ttl_ms: 1_000, permissions: [allowed('manage-zone-stock', 'my_floors')] },
        { role_id: 'R_Z', name: 'Z', session_idle_ttl_ms: 1_000, permissions: [allowed('manage-zone-stock', 'my_zones')] },
        { role_id: 'R_O', name: 'O', session_idle_ttl_ms: 1_000, permissions: [allowed('manage-zone-stock', 'own_tables')] },
      ],
      staff: [staff('S_FZ', 'FZ', 'h1', ['R_F', 'R_Z']), staff('S_FO', 'FO', 'h2', ['R_F', 'R_O']), staff('S_ZO', 'ZO', 'h3', ['R_Z', 'R_O'])],
      responsibilities: [],
    });
    // Equal rank: neither widens the other, so the result is one of the two (never own_tables).
    expect(['my_floors', 'my_zones']).toContain((directory.resolve('S_FZ', 'manage-zone-stock') as { scope: string }).scope);
    expect(directory.resolve('S_FO', 'manage-zone-stock')).toEqual({ grant: 'allowed', scope: 'my_floors' });
    expect(directory.resolve('S_ZO', 'manage-zone-stock')).toEqual({ grant: 'allowed', scope: 'my_zones' });
  });

  describe('zonesOf (01b v1.7 B-3)', () => {
    const withZones = (rows: Array<[string, string | null, string[]?]>, zonesDropped: string[] = []) =>
      StaffDirectory.fromInput({
        directory_version: 1,
        roles: [],
        staff: rows.map(([id, lead, zones]) => ({
          ...staff(id, id, `h-${id}`, []),
          lead_staff_id: lead,
          assigned_zone_ids: (zones ?? []).filter((z) => !zonesDropped.includes(z)),
        })),
        responsibilities: [],
      });

    it('[02p U-4] zonesOf: own zones', () => {
      const d = withZones([['S_A', null, ['Z2', 'Z1']]]);
      expect(d.zonesOf('S_A')).toEqual(['Z1', 'Z2']);
    });

    it('[02p U-4] zonesOf: lead\'s zones', () => {
      const d = withZones([
        ['S_LEAD', null, ['Z9', 'Z1']],
        ['S_A', 'S_LEAD', ['Z1', 'Z2']],
        ['S_B', 'S_LEAD'],
      ]);
      expect(d.zonesOf('S_B')).toEqual(['Z1', 'Z9']);
      // union, sorted, no duplicate (Z1 is held by both)
      expect(d.zonesOf('S_A')).toEqual(['Z1', 'Z2', 'Z9']);
      // the lead's report's zones are not the lead's
      expect(d.zonesOf('S_LEAD')).toEqual(['Z1', 'Z9']);
    });

    it('[02p U-4] zonesOf: no assignment → []', () => {
      const d = withZones([['S_A', null], ['S_B', 'S_A']]);
      expect(d.zonesOf('S_A')).toEqual([]);
      expect(d.zonesOf('S_B')).toEqual([]);
      expect(d.zonesOf('S_UNKNOWN')).toEqual([]);
    });

    it('[02p U-4] zonesOf: leaver → []', () => {
      // A leaver is not in the directory (01b AD-29): they hold nothing, and as a lead they add nothing.
      const d = withZones([['S_A', 'S_GONE', ['Z1']]]);
      expect(d.zonesOf('S_GONE')).toEqual([]);
      expect(d.zonesOf('S_A')).toEqual(['Z1']);
    });

    it('[01b B-3] an archived assigned zone drops out of zonesOf', () => {
      // The cloud leaves an archived zone out of the directory (01a AD-28); the next apply replaces the hub's memory.
      const before = withZones([['S_LEAD', null, ['Z1', 'Z2']], ['S_A', 'S_LEAD', ['Z3']]]);
      expect(before.zonesOf('S_A')).toEqual(['Z1', 'Z2', 'Z3']);
      const after = withZones([['S_LEAD', null, ['Z1', 'Z2']], ['S_A', 'S_LEAD', ['Z3']]], ['Z2', 'Z3']);
      expect(after.zonesOf('S_A')).toEqual(['Z1']);
    });

    it('[02p U-4] zonesOf reads the zones the database holds after load', async () => {
      const handle = freshDb();
      cleanups.push(handle.cleanup);
      await runMigrations(handle.db, { dir: migrations, clock: fixedClock(T) });
      handle.db.exec(`INSERT INTO staff (staff_id, branch_id, display_name, pin_hash, lead_staff_id) VALUES
          ('S_L','b1','L','h',NULL), ('S_A','b1','A','h','S_L');
        INSERT INTO staff_assignments (staff_id, subject_kind, subject_id) VALUES ('S_L','zone','Z1'), ('S_A','zone','Z2'), ('S_A','table','T1');`);
      const d = StaffDirectory.load(handle.db);
      expect(d.zonesOf('S_A')).toEqual(['Z1', 'Z2']);
    });
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
      scope: 'branch',
    });
    expect(fixture.resolve('S_CASH', 'reprint-ticket')).toEqual({ grant: 'allowed', scope: 'branch' });
    expect(fixture.resolve('S_MGR', 'manage-roles')).toEqual({ grant: 'not_granted' });
    expect(fixture.resolve('S_MGR', 'manage-devices')).toEqual({ grant: 'allowed', scope: 'branch' });
    expect(fixture.hasAdmin('S_OWNER')).toBe(true);
    expect(fixture.hasAdmin('S_WAIT')).toBe(false);
    expect(fixture.version).toBe(1);
  });

  it('[01b #12] resolve: allowed beats a wider requires_approval; widest scope among allowing roles; denial wins', () => {
    const directory = StaffDirectory.fromInput(scopeTable());
    expect(directory.resolve('S_AB', 'take-order-anywhere')).toEqual({ grant: 'allowed', scope: 'my_floors' });
    expect(directory.resolve('S_AC', 'take-order-anywhere')).toEqual({ grant: 'allowed', scope: 'branch' });
    expect(directory.resolve('S_AC_DENIED', 'take-order-anywhere')).toEqual({ grant: 'denied' });
    expect(directory.resolve('S_B', 'take-order-anywhere')).toEqual({
      grant: 'requires_approval',
      approver_role_ids: ['R_MGR'],
      scope: 'branch',
    });
    expect(directory.resolve('S_AB', 'reprint-ticket')).toEqual({ grant: 'not_granted' });
  });

  it('[01b #13] approver union across roles is sorted and de-duplicated', () => {
    const directory = StaffDirectory.fromInput({
      directory_version: 1,
      roles: [
        { role_id: 'R_X', name: 'X', session_idle_ttl_ms: 1_000, permissions: [approvals('void-item', ['R_Z', 'R_MGR'], 'my_team')] },
        { role_id: 'R_Y', name: 'Y', session_idle_ttl_ms: 1_000, permissions: [approvals('void-item', ['R_MGR', 'R_A'], 'branch')] },
      ],
      staff: [staff('S_XY', 'XY', 'hash-xy', ['R_Y', 'R_X'])],
      responsibilities: [],
    });
    expect(directory.resolve('S_XY', 'void-item')).toEqual({
      grant: 'requires_approval',
      approver_role_ids: ['R_A', 'R_MGR', 'R_Z'],
      scope: 'branch',
    });
  });

  it('[01b B-3] teamOf includes no_pin_staff only with includeNoPin; noPinStaff and isNoPin; no-PIN people are not on the roster', () => {
    const ali = { ...staff('S_ALI', 'Ali', 'hash-ali', ['R_A']), lead_staff_id: null };
    const bilal = { ...staff('S_BILAL', 'Bilal', 'hash-bilal', ['R_A']), lead_staff_id: 'S_ALI' };
    const directory = StaffDirectory.fromInput({
      ...truthTable(),
      staff: [ali, bilal],
      no_pin_staff: [
        { staff_id: 'S_SANA', display_name: 'Sana', lead_staff_id: 'S_ALI' },
        { staff_id: 'S_ADIL', display_name: 'Adil', lead_staff_id: 'S_ALI' },
        { staff_id: 'S_ZAIN', display_name: 'Zain', lead_staff_id: null },
      ],
    });
    expect(directory.teamOf('S_ALI')).toEqual(['S_BILAL']);
    expect(directory.teamOf('S_ALI', { includeNoPin: false })).toEqual(['S_BILAL']);
    expect(directory.teamOf('S_ALI', { includeNoPin: true })).toEqual(['S_ADIL', 'S_BILAL', 'S_SANA']);
    expect(directory.noPinStaff()).toEqual([
      { staff_id: 'S_ADIL', display_name: 'Adil', lead_staff_id: 'S_ALI' },
      { staff_id: 'S_SANA', display_name: 'Sana', lead_staff_id: 'S_ALI' },
      { staff_id: 'S_ZAIN', display_name: 'Zain', lead_staff_id: null },
    ]);
    expect(directory.isNoPin('S_SANA')).toBe(true);
    expect(directory.isNoPin('S_ALI')).toBe(false);
    expect(directory.isNoPin('S_MISSING')).toBe(false);
    expect(directory.list().map((row) => row.staff_id)).toEqual(['S_ALI', 'S_BILAL']);
    expect(directory.get('S_SANA')).toBeUndefined();
    expect(directory.resolve('S_SANA', 'reprint-ticket')).toEqual({ grant: 'not_granted' });
    expect(StaffDirectory.fromInput(truthTable()).noPinStaff()).toEqual([]);
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
        permissions: [allowed('reprint-ticket'), allowed('manage-devices')],
      },
      {
        role_id: 'R_B',
        name: 'B',
        session_idle_ttl_ms: 5_000,
        permissions: [approval('apply-discount', 'R_MGR'), approval('void-item', 'R_OWNER'), approval('manage-devices', 'R_CASH')],
      },
      {
        role_id: 'R_C',
        name: 'C',
        session_idle_ttl_ms: 9_000,
        permissions: [approval('apply-discount', 'R_CASH')],
      },
    ],
    staff: [
      staff('S_DENY', 'Denied', 'hash-deny', ['R_A'], ['reprint-ticket']),
      staff('S_MULTI', 'Multi', 'hash-multi', ['R_B', 'R_C']),
      staff('S_WIN', 'Win', 'hash-win', ['R_A', 'R_B']),
      staff('S_NONE', 'None', 'hash-none', []),
      staff('S_DENY_APPROVAL', 'Deny approval', 'hash-deny-approval', ['R_B'], ['apply-discount']),
    ],
    responsibilities: [],
  };
}

// 01b #12: A allows with my_floors, B requires approval with branch, C allows with branch.
function scopeTable(): DirectoryInput {
  return {
    directory_version: 1,
    roles: [
      { role_id: 'R_A', name: 'A', session_idle_ttl_ms: 1_000, permissions: [allowed('take-order-anywhere', 'my_floors')] },
      { role_id: 'R_B', name: 'B', session_idle_ttl_ms: 1_000, permissions: [approval('take-order-anywhere', 'R_MGR')] },
      { role_id: 'R_C', name: 'C', session_idle_ttl_ms: 1_000, permissions: [allowed('take-order-anywhere', 'branch')] },
    ],
    staff: [
      staff('S_AB', 'AB', 'hash-ab', ['R_A', 'R_B']),
      staff('S_AC', 'AC', 'hash-ac', ['R_A', 'R_C']),
      staff('S_AC_DENIED', 'AC denied', 'hash-acd', ['R_A', 'R_C'], ['take-order-anywhere']),
      staff('S_B', 'B', 'hash-b', ['R_B']),
    ],
    responsibilities: [],
  };
}

type Grant = DirectoryInput['roles'][number]['permissions'][number];

function allowed(permission: string, scope: Grant['scope'] = 'branch'): Grant {
  return { permission, grant_type: 'allowed', approver_role_id: null, approver_role_ids: [], scope };
}

function approval(permission: string, approver: string): Grant {
  return approvals(permission, [approver], 'branch');
}

function approvals(permission: string, approvers: string[], scope: Grant['scope']): Grant {
  return {
    permission,
    grant_type: 'requires_approval',
    approver_role_id: approvers.slice().sort()[0] ?? null,
    approver_role_ids: approvers,
    scope,
  };
}

function staff(
  staff_id: string,
  display_name: string,
  pin_hash: string,
  role_ids: string[],
  denied_permissions: string[] = [],
): DirectoryInput['staff'][number] {
  return { staff_id, display_name, pin_hash, role_ids, denied_permissions, lead_staff_id: null, floor_ids: [] };
}

function writeDirectory(db: Database.Database, input: DirectoryInput): void {
  const insertRole = db.prepare(
    'INSERT INTO roles (role_id, branch_id, name, session_idle_ttl_ms) VALUES (?, ?, ?, ?)',
  );
  const insertPerm = db.prepare('INSERT INTO role_permissions (role_id, permission, grant_type, scope) VALUES (?, ?, ?, ?)');
  const insertApprover = db.prepare(
    'INSERT INTO role_permission_approvers (role_id, permission, approver_role_id) VALUES (?, ?, ?)',
  );
  const insertStaff = db.prepare('INSERT INTO staff (staff_id, branch_id, display_name, pin_hash) VALUES (?, ?, ?, ?)');
  const insertAssignment = db.prepare('INSERT INTO staff_roles (staff_id, role_id) VALUES (?, ?)');
  const insertDenial = db.prepare('INSERT INTO staff_permission_denials (staff_id, permission) VALUES (?, ?)');
  for (const role of input.roles) {
    insertRole.run(role.role_id, 'branch-1', role.name, role.session_idle_ttl_ms);
  }
  for (const role of input.roles) {
    for (const permission of role.permissions) {
      insertPerm.run(role.role_id, permission.permission, permission.grant_type, permission.scope);
      for (const approver of permission.approver_role_ids) insertApprover.run(role.role_id, permission.permission, approver);
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
