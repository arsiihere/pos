import { PERMISSIONS, type Permission } from '@pos/domain';
import type { DirectoryInput } from '@pos/events';
import type Database from 'better-sqlite3';

export type Resolution =
  | { grant: 'allowed' }
  | { grant: 'requires_approval'; approver_role_ids: string[] }
  | { grant: 'not_granted' }
  | { grant: 'denied' };

export interface StaffView {
  staff_id: string;
  display_name: string;
  pin_hash: string;
  role_ids: string[];
  denied_permissions: string[];
}

interface RoleRecord {
  session_idle_ttl_ms: number;
  permissions: Map<string, { grant_type: 'allowed' | 'requires_approval'; approver_role_id: string | null }>;
}

interface StaffRecord {
  staff_id: string;
  display_name: string;
  pin_hash: string;
  role_ids: string[];
  denied: Set<string>;
}

export class StaffDirectory {
  private constructor(
    private readonly directoryVersion: number,
    private readonly staffById: Map<string, StaffRecord>,
    private readonly roles: Map<string, RoleRecord>,
  ) {}

  static fromInput(d: DirectoryInput): StaffDirectory {
    const roles = new Map<string, RoleRecord>();
    for (const role of d.roles) {
      const permissions: RoleRecord['permissions'] = new Map();
      for (const permission of role.permissions) {
        permissions.set(permission.permission, {
          grant_type: permission.grant_type,
          approver_role_id: permission.approver_role_id,
        });
      }
      roles.set(role.role_id, { session_idle_ttl_ms: role.session_idle_ttl_ms, permissions });
    }
    const staffById = new Map<string, StaffRecord>();
    for (const staff of d.staff) {
      staffById.set(staff.staff_id, {
        staff_id: staff.staff_id,
        display_name: staff.display_name,
        pin_hash: staff.pin_hash,
        role_ids: [...staff.role_ids].sort(),
        denied: new Set(staff.denied_permissions),
      });
    }
    return new StaffDirectory(d.directory_version, staffById, roles);
  }

  static load(db: Database.Database): StaffDirectory {
    const staff = db.prepare('SELECT staff_id, display_name, pin_hash FROM staff').all() as Array<{
      staff_id: string;
      display_name: string;
      pin_hash: string;
    }>;
    const roles = db.prepare('SELECT role_id, name, session_idle_ttl_ms FROM roles').all() as Array<{
      role_id: string;
      name: string;
      session_idle_ttl_ms: number;
    }>;
    const permissions = db.prepare(
      'SELECT role_id, permission, grant_type, approver_role_id FROM role_permissions',
    ).all() as Array<{
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
    const meta = db.prepare('SELECT directory_version FROM staff_directory_meta').get() as
      | { directory_version: number }
      | undefined;
    const permissionsByRole = new Map<string, DirectoryInput['roles'][number]['permissions']>();
    for (const row of permissions) {
      const list = permissionsByRole.get(row.role_id) ?? [];
      list.push({
        permission: row.permission,
        grant_type: row.grant_type,
        approver_role_id: row.approver_role_id,
      });
      permissionsByRole.set(row.role_id, list);
    }
    const rolesByStaff = new Map<string, string[]>();
    for (const row of assignments) {
      const list = rolesByStaff.get(row.staff_id) ?? [];
      list.push(row.role_id);
      rolesByStaff.set(row.staff_id, list);
    }
    const denialsByStaff = new Map<string, string[]>();
    for (const row of denials) {
      const list = denialsByStaff.get(row.staff_id) ?? [];
      list.push(row.permission);
      denialsByStaff.set(row.staff_id, list);
    }
    return StaffDirectory.fromInput({
      directory_version: meta?.directory_version ?? 0,
      roles: roles.map((role) => ({
        role_id: role.role_id,
        name: role.name,
        session_idle_ttl_ms: role.session_idle_ttl_ms,
        permissions: permissionsByRole.get(role.role_id) ?? [],
      })),
      staff: staff.map((row) => ({
        staff_id: row.staff_id,
        display_name: row.display_name,
        pin_hash: row.pin_hash,
        role_ids: rolesByStaff.get(row.staff_id) ?? [],
        denied_permissions: denialsByStaff.get(row.staff_id) ?? [],
      })),
    });
  }

  get version(): number {
    return this.directoryVersion;
  }

  get(staffId: string): StaffView | undefined {
    const staff = this.staffById.get(staffId);
    if (staff === undefined) return undefined;
    return {
      staff_id: staff.staff_id,
      display_name: staff.display_name,
      pin_hash: staff.pin_hash,
      role_ids: staff.role_ids,
      denied_permissions: [...staff.denied].sort(),
    };
  }

  list(): StaffView[] {
    return [...this.staffById.keys()]
      .sort()
      .map((staffId) => this.get(staffId))
      .filter((staff): staff is StaffView => staff !== undefined);
  }

  resolve(staffId: string, permission: Permission): Resolution {
    const staff = this.staffById.get(staffId);
    if (staff === undefined) return { grant: 'not_granted' };
    if (staff.denied.has(permission)) return { grant: 'denied' };
    let allowed = false;
    const approvers = new Set<string>();
    for (const roleId of staff.role_ids) {
      const grant = this.roles.get(roleId)?.permissions.get(permission);
      if (grant === undefined) continue;
      if (grant.grant_type === 'allowed') allowed = true;
      else if (grant.approver_role_id !== null) approvers.add(grant.approver_role_id);
    }
    if (allowed) return { grant: 'allowed' };
    if (approvers.size > 0) return { grant: 'requires_approval', approver_role_ids: [...approvers].sort() };
    return { grant: 'not_granted' };
  }

  permissionsOf(staffId: string): Record<Permission, Resolution> {
    const out = {} as Record<Permission, Resolution>;
    for (const permission of PERMISSIONS) out[permission] = this.resolve(staffId, permission);
    return out;
  }

  ttlFor(staffId: string): number {
    const staff = this.staffById.get(staffId);
    if (staff === undefined) return 0;
    let max = 0;
    for (const roleId of staff.role_ids) {
      const ttl = this.roles.get(roleId)?.session_idle_ttl_ms ?? 0;
      if (ttl > max) max = ttl;
    }
    return max;
  }

  hasAdmin(staffId: string): boolean {
    return this.resolve(staffId, 'access-hub-admin').grant === 'allowed';
  }
}
