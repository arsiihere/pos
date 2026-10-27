import { isPermission } from '@pos/domain';
import type { DirectoryInput } from '@pos/events';
import type Database from 'better-sqlite3';
import type { WriterTx } from '../engine-host/writer.js';
import { activeSessionsOf, endSession, revokeDevice } from './session-store.js';
import { StaffDirectory, type DirectoryCore } from './staff-directory.js';

const PIN_HASH_RE = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/;

interface Skip {
  kind: 'staff' | 'role_assignment' | 'permission' | 'approver';
  id: string;
  reason: string;
}

interface StoredStaff {
  staff_id: string;
  display_name: string;
  pin_hash: string;
  role_ids: string[];
  denied_permissions: string[];
}

type StoredRole = DirectoryCore['roles'][number];

export function applyStaffDirectory(
  tx: WriterTx,
  d: DirectoryInput,
  setDirectory: (dir: StaffDirectory) => void,
): { applied: boolean } {
  const current = currentVersion(tx.db);
  if (d.directory_version <= current) {
    console.warn(JSON.stringify({ msg: 'staff directory ignored', directory_version: d.directory_version, current }));
    return { applied: false };
  }
  const previous = readCache(tx.db);
  const skipped: Skip[] = [];
  const roleIds = new Set(d.roles.map((role) => role.role_id));
  const roles: StoredRole[] = [];
  const seenRoleIds = new Set<string>();
  for (const role of d.roles) {
    if (seenRoleIds.has(role.role_id)) {
      warnSkip(skipped, { kind: 'role_assignment', id: role.role_id, reason: 'duplicate role' });
      continue;
    }
    seenRoleIds.add(role.role_id);
    const permissions: StoredRole['permissions'] = [];
    const seenPermissions = new Set<string>();
    for (const permission of role.permissions) {
      if (!keepGrant(role.role_id, permission, roleIds, skipped)) continue;
      if (seenPermissions.has(permission.permission)) {
        warnSkip(skipped, { kind: 'permission', id: `${role.role_id}:${permission.permission}`, reason: 'duplicate permission' });
        continue;
      }
      seenPermissions.add(permission.permission);
      permissions.push(permission);
    }
    roles.push({ ...role, permissions });
  }
  const staff: StoredStaff[] = [];
  const seenStaff = new Set<string>();
  for (const row of d.staff) {
    if (seenStaff.has(row.staff_id)) {
      warnSkip(skipped, { kind: 'staff', id: row.staff_id, reason: 'duplicate staff' });
      continue;
    }
    seenStaff.add(row.staff_id);
    const problem = hashProblem(row.pin_hash);
    const kept = previous.staff.get(row.staff_id);
    if (problem !== null) {
      warnSkip(skipped, { kind: 'staff', id: row.staff_id, reason: problem });
      if (kept !== undefined) staff.push(kept);
      continue;
    }
    const role_ids: string[] = [];
    const seenAssignments = new Set<string>();
    for (const roleId of row.role_ids) {
      if (!roleIds.has(roleId)) {
        warnSkip(skipped, { kind: 'role_assignment', id: `${row.staff_id}:${roleId}`, reason: 'unknown role' });
        continue;
      }
      if (seenAssignments.has(roleId)) {
        warnSkip(skipped, { kind: 'role_assignment', id: `${row.staff_id}:${roleId}`, reason: 'duplicate role' });
        continue;
      }
      seenAssignments.add(roleId);
      role_ids.push(roleId);
    }
    const denied_permissions: string[] = [];
    const seenDenials = new Set<string>();
    for (const permission of row.denied_permissions) {
      if (!isPermission(permission)) {
        warnSkip(skipped, { kind: 'permission', id: `${row.staff_id}:${permission}`, reason: 'unknown permission' });
        continue;
      }
      if (seenDenials.has(permission)) {
        warnSkip(skipped, { kind: 'permission', id: `${row.staff_id}:${permission}`, reason: 'duplicate permission' });
        continue;
      }
      seenDenials.add(permission);
      denied_permissions.push(permission);
    }
    staff.push({
      staff_id: row.staff_id,
      display_name: row.display_name,
      pin_hash: row.pin_hash,
      role_ids,
      denied_permissions,
    });
  }
  const retainRole = (roleId: string): void => {
    if (roles.some((role) => role.role_id === roleId)) return;
    const old = previous.roles.get(roleId);
    if (old === undefined) return;
    roles.push(old);
    for (const permission of old.permissions) {
      if (permission.approver_role_id !== null) retainRole(permission.approver_role_id);
    }
  };
  for (const row of staff) {
    for (const roleId of row.role_ids) retainRole(roleId);
  }
  const present = new Set(staff.map((row) => row.staff_id));
  const removed = [...previous.staff.keys()].filter((id) => !present.has(id)).sort();
  const changed = staff
    .filter((row) => {
      const old = previous.staff.get(row.staff_id);
      return old !== undefined && old.pin_hash !== row.pin_hash;
    })
    .map((row) => row.staff_id)
    .sort();
  replaceCache(tx, { directory_version: d.directory_version, roles, staff });
  for (const staffId of removed) endStaff(tx, staffId, 'staff_removed');
  for (const staffId of removed) revokePhones(tx, staffId);
  for (const staffId of changed) endStaff(tx, staffId, 'credentials_changed');
  tx.append([
    {
      stream_type: 'hub',
      stream_id: tx.branchId,
      event_type: 'StaffDirectoryApplied',
      schema_version: 1,
      payload: {
        directory_version: d.directory_version,
        staff_count: staff.length,
        role_count: roles.length,
        removed_staff_ids: removed,
        credentials_changed_staff_ids: changed,
        skipped,
      },
      occurred_at: tx.clock.branchNow(),
      actor_id: null,
      device_id: 'hub',
    },
  ]);
  tx.onCommit(() =>
    setDirectory(StaffDirectory.fromInput({ directory_version: d.directory_version, roles, staff })),
  );
  return { applied: true };
}

function warnSkip(skipped: Skip[], skip: Skip): void {
  skipped.push(skip);
  console.warn(JSON.stringify({ msg: 'staff directory skip', ...skip }));
}

function keepGrant(
  roleId: string,
  permission: DirectoryCore['roles'][number]['permissions'][number],
  roleIds: Set<string>,
  skipped: Skip[],
): boolean {
  if (!isPermission(permission.permission)) {
    warnSkip(skipped, { kind: 'permission', id: `${roleId}:${permission.permission}`, reason: 'unknown permission' });
    return false;
  }
  if (permission.grant_type === 'allowed' && permission.approver_role_id !== null) {
    warnSkip(skipped, {
      kind: 'permission',
      id: `${roleId}:${permission.permission}`,
      reason: 'approver set on an allowed grant',
    });
    return false;
  }
  if (
    permission.grant_type === 'requires_approval' &&
    (permission.approver_role_id === null || !roleIds.has(permission.approver_role_id))
  ) {
    warnSkip(skipped, { kind: 'approver', id: `${roleId}:${permission.permission}`, reason: 'unknown approver' });
    return false;
  }
  return true;
}

function hashProblem(pinHash: string): 'malformed pin_hash' | 'weak pin_hash' | null {
  const match = PIN_HASH_RE.exec(pinHash);
  if (match === null) return 'malformed pin_hash';
  const memory = Number(match[1]);
  const time = Number(match[2]);
  const parallelism = Number(match[3]);
  if (memory < 19_456 || time < 2 || parallelism < 1) return 'weak pin_hash';
  return null;
}

function currentVersion(db: Database.Database): number {
  const row = db.prepare('SELECT directory_version FROM staff_directory_meta').get() as
    | { directory_version: number }
    | undefined;
  return row?.directory_version ?? 0;
}

function readCache(db: Database.Database): { staff: Map<string, StoredStaff>; roles: Map<string, StoredRole> } {
  const staffRows = db.prepare('SELECT staff_id, display_name, pin_hash FROM staff').all() as Array<{
    staff_id: string;
    display_name: string;
    pin_hash: string;
  }>;
  const roleRows = db.prepare('SELECT role_id, name, session_idle_ttl_ms FROM roles').all() as Array<{
    role_id: string;
    name: string;
    session_idle_ttl_ms: number;
  }>;
  const permissions = db
    .prepare('SELECT role_id, permission, grant_type, approver_role_id FROM role_permissions')
    .all() as Array<{
    role_id: string;
    permission: string;
    grant_type: 'allowed' | 'requires_approval';
    approver_role_id: string | null;
  }>;
  const assignments = db.prepare('SELECT staff_id, role_id FROM staff_roles').all() as Array<{
    staff_id: string;
    role_id: string;
  }>;
  const denials = db.prepare('SELECT staff_id, permission FROM staff_permission_denials').all() as Array<{
    staff_id: string;
    permission: string;
  }>;
  const roles = new Map<string, StoredRole>();
  for (const role of roleRows) {
    roles.set(role.role_id, { role_id: role.role_id, name: role.name, session_idle_ttl_ms: role.session_idle_ttl_ms, permissions: [] });
  }
  for (const permission of permissions) {
    roles.get(permission.role_id)?.permissions.push({
      permission: permission.permission,
      grant_type: permission.grant_type,
      approver_role_id: permission.approver_role_id,
    });
  }
  const staff = new Map<string, StoredStaff>();
  for (const row of staffRows) staff.set(row.staff_id, { ...row, role_ids: [], denied_permissions: [] });
  for (const row of assignments) staff.get(row.staff_id)?.role_ids.push(row.role_id);
  for (const row of denials) staff.get(row.staff_id)?.denied_permissions.push(row.permission);
  return { staff, roles };
}

function replaceCache(tx: WriterTx, d: { directory_version: number; roles: StoredRole[]; staff: StoredStaff[] }): void {
  tx.db.exec(`
    DELETE FROM staff_permission_denials;
    DELETE FROM staff_roles;
    DELETE FROM role_permissions;
    DELETE FROM staff;
    DELETE FROM roles;
    DELETE FROM staff_directory_meta;
  `);
  const insertRole = tx.db.prepare('INSERT INTO roles (role_id, branch_id, name, session_idle_ttl_ms) VALUES (?, ?, ?, ?)');
  const insertPerm = tx.db.prepare(
    'INSERT INTO role_permissions (role_id, permission, grant_type, approver_role_id) VALUES (?, ?, ?, ?)',
  );
  const insertStaff = tx.db.prepare('INSERT INTO staff (staff_id, branch_id, display_name, pin_hash) VALUES (?, ?, ?, ?)');
  const insertAssignment = tx.db.prepare('INSERT INTO staff_roles (staff_id, role_id) VALUES (?, ?)');
  const insertDenial = tx.db.prepare('INSERT INTO staff_permission_denials (staff_id, permission) VALUES (?, ?)');
  for (const role of d.roles) {
    insertRole.run(role.role_id, tx.branchId, role.name, role.session_idle_ttl_ms);
  }
  for (const role of d.roles) {
    for (const permission of role.permissions) {
      insertPerm.run(role.role_id, permission.permission, permission.grant_type, permission.approver_role_id);
    }
  }
  for (const row of d.staff) {
    insertStaff.run(row.staff_id, tx.branchId, row.display_name, row.pin_hash);
    for (const roleId of row.role_ids) insertAssignment.run(row.staff_id, roleId);
    for (const permission of row.denied_permissions) insertDenial.run(row.staff_id, permission);
  }
  tx.db
    .prepare('INSERT INTO staff_directory_meta (branch_id, directory_version, applied_at) VALUES (?, ?, ?)')
    .run(tx.branchId, d.directory_version, tx.clock.branchNow());
}

function endStaff(tx: WriterTx, staffId: string, reason: 'staff_removed' | 'credentials_changed'): void {
  const sessions = activeSessionsOf(tx.db, { staffId }).filter((session) => session.kind === 'staff' || session.kind === 'admin');
  for (const session of sessions) endSession(tx, session, reason, null, null, 'hub');
}

function revokePhones(tx: WriterTx, staffId: string): void {
  const phones = tx.db
    .prepare("SELECT device_id FROM devices WHERE device_type = 'phone' AND owner_staff_id = ? AND revoked_at IS NULL")
    .all(staffId) as Array<{ device_id: string }>;
  for (const phone of phones) {
    revokeDevice(tx, phone.device_id, {
      reason: null,
      cause: 'owner_removed',
      actorId: null,
      eventDeviceId: 'hub',
      revokedBy: null,
    });
  }
}
