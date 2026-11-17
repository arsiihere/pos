import { isPermission } from '@pos/domain';
import type { DirectoryInput } from '@pos/events';
import type Database from 'better-sqlite3';
import type { WriterTx } from '../engine-host/writer.js';
import { activeSessionsOf, endSession, revokeDevice } from './session-store.js';
import { StaffDirectory, type DirectoryCore, type NoPinStaff } from './staff-directory.js';

const PIN_HASH_RE = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/;

interface Skip {
  kind: 'staff' | 'role_assignment' | 'permission' | 'approver' | 'lead' | 'responsibility';
  id: string;
  reason: string;
}

type StoredStaff = DirectoryCore['staff'][number];
type StoredRole = DirectoryCore['roles'][number];
type StoredGrant = StoredRole['permissions'][number];
type StoredResponsibility = DirectoryCore['responsibilities'][number];

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
  upsertStaffNames(tx, d);
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
    const permissions: StoredGrant[] = [];
    const seenPermissions = new Set<string>();
    for (const permission of role.permissions) {
      const grant = keepGrant(role.role_id, permission, roleIds, skipped);
      if (grant === null) continue;
      if (seenPermissions.has(grant.permission)) {
        warnSkip(skipped, { kind: 'permission', id: `${role.role_id}:${grant.permission}`, reason: 'duplicate permission' });
        continue;
      }
      seenPermissions.add(grant.permission);
      permissions.push(grant);
    }
    roles.push({ role_id: role.role_id, name: role.name, session_idle_ttl_ms: role.session_idle_ttl_ms, permissions });
  }
  const staff: StoredStaff[] = [];
  const seenStaff = new Set<string>();
  // 01b v1.6 B-2: one person per zone and per table (the hub key). The cloud never sends one twice (its unique
  // index); if it did, the first holder is kept and the repeat skipped, so the rest still applies (B18).
  const assignedTo = new Map<string, string>();
  const keptRows: { row: StoredStaff; zones: string[]; tables: string[] }[] = [];
  const keepAssigned = (staffId: string, kind: 'zone' | 'table', ids: readonly string[] | undefined): string[] => {
    const kept: string[] = [];
    for (const id of ids ?? []) {
      const key = JSON.stringify([kind, id]);
      const holder = assignedTo.get(key);
      if (holder === staffId) continue; // a repeated id in the person's own list (a set, C1)
      if (holder !== undefined) {
        warnSkip(skipped, { kind: 'staff', id: `${staffId}:${kind}:${id}`, reason: 'duplicate assignment' });
        continue;
      }
      assignedTo.set(key, staffId);
      kept.push(id);
    }
    return kept;
  };
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
      if (kept !== undefined) {
        // Its stale assignments are taken after every fresh row, so they never beat the cloud's current holder.
        const row = { ...kept, assigned_zone_ids: [], assigned_table_ids: [] };
        staff.push(row);
        keptRows.push({ row, zones: kept.assigned_zone_ids ?? [], tables: kept.assigned_table_ids ?? [] });
      }
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
      lead_staff_id: row.lead_staff_id,
      floor_ids: [...new Set(row.floor_ids)],
      assigned_zone_ids: keepAssigned(row.staff_id, 'zone', row.assigned_zone_ids),
      assigned_table_ids: keepAssigned(row.staff_id, 'table', row.assigned_table_ids),
    });
  }
  for (const { row, zones, tables } of keptRows) {
    row.assigned_zone_ids = keepAssigned(row.staff_id, 'zone', zones);
    row.assigned_table_ids = keepAssigned(row.staff_id, 'table', tables);
  }
  const retainRole = (roleId: string): void => {
    if (roles.some((role) => role.role_id === roleId)) return;
    const old = previous.roles.get(roleId);
    if (old === undefined) return;
    roles.push(old);
    for (const permission of old.permissions) {
      for (const approver of permission.approver_role_ids) retainRole(approver);
    }
  };
  for (const row of staff) {
    for (const roleId of row.role_ids) retainRole(roleId);
  }
  const present = new Set(staff.map((row) => row.staff_id));
  // 01b v1.4 B-1: a staff_id is in exactly one list; a no_pin_staff entry repeating one already kept is skipped.
  const noPin: NoPinStaff[] = [];
  const seenNoPin = new Set<string>();
  for (const row of d.no_pin_staff ?? []) {
    if (present.has(row.staff_id) || seenNoPin.has(row.staff_id)) {
      warnSkip(skipped, { kind: 'staff', id: row.staff_id, reason: 'duplicate staff' });
      continue;
    }
    seenNoPin.add(row.staff_id);
    noPin.push({ staff_id: row.staff_id, display_name: row.display_name, lead_staff_id: row.lead_staff_id });
  }
  // 01b B18 b: a lead or responsibility naming someone not stored here reads as none. v1.4 B-6: a lead
  // (of either list) naming a no_pin_staff person is kept.
  for (const row of [...staff, ...noPin]) {
    if (row.lead_staff_id !== null && !present.has(row.lead_staff_id) && !seenNoPin.has(row.lead_staff_id)) {
      warnSkip(skipped, { kind: 'lead', id: `${row.staff_id}:${row.lead_staff_id}`, reason: 'unknown staff' });
      row.lead_staff_id = null;
    }
  }
  const responsibilities: StoredResponsibility[] = d.responsibilities.map((entry) => ({
    responsibility: entry.responsibility,
    station_id: entry.station_id,
    staff_ids: [...new Set(entry.staff_ids)].filter((staffId) => {
      if (present.has(staffId)) return true;
      warnSkip(skipped, {
        kind: 'responsibility',
        id: `${entry.responsibility}:${entry.station_id}:${staffId}`,
        reason: 'unknown staff',
      });
      return false;
    }),
    role_ids: [...new Set(entry.role_ids)],
  }));
  const removed = [...previous.staff.keys()].filter((id) => !present.has(id)).sort();
  const changed = staff
    .filter((row) => {
      const old = previous.staff.get(row.staff_id);
      return old !== undefined && old.pin_hash !== row.pin_hash;
    })
    .map((row) => row.staff_id)
    .sort();
  const stored: DirectoryCore = { directory_version: d.directory_version, roles, staff, responsibilities, no_pin_staff: noPin };
  replaceCache(tx, stored);
  for (const staffId of removed) endStaff(tx, staffId, 'staff_removed');
  for (const staffId of removed) revokePhones(tx, staffId);
  for (const staffId of changed) endStaff(tx, staffId, 'credentials_changed');
  tx.append([
    {
      stream_type: 'hub',
      stream_id: tx.branchId,
      event_type: 'StaffDirectoryApplied',
      schema_version: 2,
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
  tx.onCommit(() => setDirectory(StaffDirectory.fromInput(stored)));
  return { applied: true };
}

// 00 v1.10 §5 / 04 §4.5 H-1 (G-2): every person in the **input** lists is named before any row skip (so a staff
// row skipped for a bad pin_hash still has a name), staff first, then no_pin_staff; a repeated id keeps the first,
// as the cache does. Rows are never deleted (a leaver keeps the last known name). Hub clock, same transaction.
function upsertStaffNames(tx: WriterTx, d: DirectoryInput): void {
  const upsert = tx.db.prepare(
    `INSERT INTO staff_names (staff_id, display_name, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (staff_id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`,
  );
  const now = tx.clock.branchNow();
  const seen = new Set<string>();
  for (const row of [...d.staff, ...(d.no_pin_staff ?? [])]) {
    if (seen.has(row.staff_id)) continue;
    seen.add(row.staff_id);
    upsert.run(row.staff_id, row.display_name, now);
  }
}

function warnSkip(skipped: Skip[], skip: Skip): void {
  skipped.push(skip);
  console.warn(JSON.stringify({ msg: 'staff directory skip', ...skip }));
}

// 00 M52 with 01b m4: unknown approver ids are dropped from the list; a requires_approval grant left with
// none is skipped. The kept approver_role_id is ignored (B18 a).
function keepGrant(
  roleId: string,
  permission: DirectoryInput['roles'][number]['permissions'][number],
  roleIds: Set<string>,
  skipped: Skip[],
): StoredGrant | null {
  const id = `${roleId}:${permission.permission}`;
  if (!isPermission(permission.permission)) {
    warnSkip(skipped, { kind: 'permission', id, reason: 'unknown permission' });
    return null;
  }
  const listed = [...new Set(permission.approver_role_ids)];
  if (permission.grant_type === 'allowed') {
    if (listed.length > 0) {
      warnSkip(skipped, { kind: 'permission', id, reason: 'approver set on an allowed grant' });
      return null;
    }
    return { permission: permission.permission, grant_type: 'allowed', approver_role_ids: [], scope: permission.scope };
  }
  const known = listed.filter((approver) => roleIds.has(approver));
  if (known.length === 0) {
    warnSkip(skipped, { kind: 'approver', id, reason: listed.length === 0 ? 'no approver' : 'unknown approver' });
    return null;
  }
  for (const approver of listed) {
    if (!roleIds.has(approver)) warnSkip(skipped, { kind: 'approver', id: `${id}:${approver}`, reason: 'unknown approver' });
  }
  return { permission: permission.permission, grant_type: 'requires_approval', approver_role_ids: known, scope: permission.scope };
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
  const staffRows = db.prepare('SELECT staff_id, display_name, pin_hash, lead_staff_id FROM staff').all() as Array<{
    staff_id: string;
    display_name: string;
    pin_hash: string;
    lead_staff_id: string | null;
  }>;
  const roleRows = db.prepare('SELECT role_id, name, session_idle_ttl_ms FROM roles').all() as Array<{
    role_id: string;
    name: string;
    session_idle_ttl_ms: number;
  }>;
  const permissions = db.prepare('SELECT role_id, permission, grant_type, scope FROM role_permissions').all() as Array<{
    role_id: string;
    permission: string;
    grant_type: 'allowed' | 'requires_approval';
    scope: StoredGrant['scope'];
  }>;
  const approvers = db.prepare('SELECT role_id, permission, approver_role_id FROM role_permission_approvers').all() as Array<{
    role_id: string;
    permission: string;
    approver_role_id: string;
  }>;
  const assignments = db.prepare('SELECT staff_id, role_id FROM staff_roles').all() as Array<{
    staff_id: string;
    role_id: string;
  }>;
  const denials = db.prepare('SELECT staff_id, permission FROM staff_permission_denials').all() as Array<{
    staff_id: string;
    permission: string;
  }>;
  const floors = db.prepare('SELECT staff_id, floor_id FROM staff_floors').all() as Array<{
    staff_id: string;
    floor_id: string;
  }>;
  const assigned = db.prepare('SELECT staff_id, subject_kind, subject_id FROM staff_assignments').all() as Array<{
    staff_id: string;
    subject_kind: 'zone' | 'table';
    subject_id: string;
  }>;
  const roles = new Map<string, StoredRole>();
  for (const role of roleRows) {
    roles.set(role.role_id, { role_id: role.role_id, name: role.name, session_idle_ttl_ms: role.session_idle_ttl_ms, permissions: [] });
  }
  for (const permission of permissions) {
    roles.get(permission.role_id)?.permissions.push({
      permission: permission.permission,
      grant_type: permission.grant_type,
      approver_role_ids: approvers
        .filter((row) => row.role_id === permission.role_id && row.permission === permission.permission)
        .map((row) => row.approver_role_id),
      scope: permission.scope,
    });
  }
  const staff = new Map<string, StoredStaff>();
  for (const row of staffRows) {
    staff.set(row.staff_id, { ...row, role_ids: [], denied_permissions: [], floor_ids: [], assigned_zone_ids: [], assigned_table_ids: [] });
  }
  for (const row of assignments) staff.get(row.staff_id)?.role_ids.push(row.role_id);
  for (const row of denials) staff.get(row.staff_id)?.denied_permissions.push(row.permission);
  for (const row of floors) staff.get(row.staff_id)?.floor_ids.push(row.floor_id);
  for (const row of assigned) {
    const entry = staff.get(row.staff_id);
    (row.subject_kind === 'zone' ? entry?.assigned_zone_ids : entry?.assigned_table_ids)?.push(row.subject_id);
  }
  return { staff, roles };
}

function replaceCache(tx: WriterTx, d: DirectoryCore): void {
  tx.db.exec(`
    DELETE FROM role_permission_approvers;
    DELETE FROM staff_assignments;
    DELETE FROM staff_floors;
    DELETE FROM responsibilities;
    DELETE FROM staff_permission_denials;
    DELETE FROM staff_roles;
    DELETE FROM role_permissions;
    DELETE FROM staff;
    DELETE FROM roles;
    DELETE FROM staff_directory_meta;
    DELETE FROM no_pin_staff;
  `);
  const insertRole = tx.db.prepare('INSERT INTO roles (role_id, branch_id, name, session_idle_ttl_ms) VALUES (?, ?, ?, ?)');
  const insertPerm = tx.db.prepare('INSERT INTO role_permissions (role_id, permission, grant_type, scope) VALUES (?, ?, ?, ?)');
  const insertApprover = tx.db.prepare(
    'INSERT INTO role_permission_approvers (role_id, permission, approver_role_id) VALUES (?, ?, ?)',
  );
  const insertStaff = tx.db.prepare(
    'INSERT INTO staff (staff_id, branch_id, display_name, pin_hash, lead_staff_id) VALUES (?, ?, ?, ?, ?)',
  );
  const insertAssignment = tx.db.prepare('INSERT INTO staff_roles (staff_id, role_id) VALUES (?, ?)');
  const insertDenial = tx.db.prepare('INSERT INTO staff_permission_denials (staff_id, permission) VALUES (?, ?)');
  const insertFloor = tx.db.prepare('INSERT INTO staff_floors (staff_id, floor_id) VALUES (?, ?)');
  const insertAssigned = tx.db.prepare('INSERT INTO staff_assignments (staff_id, subject_kind, subject_id) VALUES (?, ?, ?)');
  const insertResponsibility = tx.db.prepare(
    'INSERT INTO responsibilities (responsibility, station_id, subject_kind, subject_id) VALUES (?, ?, ?, ?)',
  );
  for (const role of d.roles) {
    insertRole.run(role.role_id, tx.branchId, role.name, role.session_idle_ttl_ms);
  }
  for (const role of d.roles) {
    for (const permission of role.permissions) {
      insertPerm.run(role.role_id, permission.permission, permission.grant_type, permission.scope);
      for (const approver of permission.approver_role_ids) insertApprover.run(role.role_id, permission.permission, approver);
    }
  }
  for (const row of d.staff) {
    insertStaff.run(row.staff_id, tx.branchId, row.display_name, row.pin_hash, row.lead_staff_id);
    for (const roleId of row.role_ids) insertAssignment.run(row.staff_id, roleId);
    for (const permission of row.denied_permissions) insertDenial.run(row.staff_id, permission);
    for (const floorId of row.floor_ids) insertFloor.run(row.staff_id, floorId);
    for (const zoneId of row.assigned_zone_ids ?? []) insertAssigned.run(row.staff_id, 'zone', zoneId);
    for (const tableId of row.assigned_table_ids ?? []) insertAssigned.run(row.staff_id, 'table', tableId);
  }
  const insertNoPin = tx.db.prepare('INSERT INTO no_pin_staff (staff_id, display_name, lead_staff_id) VALUES (?, ?, ?)');
  for (const row of d.no_pin_staff ?? []) insertNoPin.run(row.staff_id, row.display_name, row.lead_staff_id);
  const seen = new Set<string>();
  for (const entry of d.responsibilities) {
    for (const [kind, ids] of [['staff', entry.staff_ids], ['role', entry.role_ids]] as const) {
      for (const id of ids) {
        const key = JSON.stringify([entry.responsibility, entry.station_id, kind, id]);
        if (seen.has(key)) continue;
        seen.add(key);
        insertResponsibility.run(entry.responsibility, entry.station_id, kind, id);
      }
    }
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
