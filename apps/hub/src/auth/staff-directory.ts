import { PERMISSIONS, type Permission, type Scope } from '@pos/domain';
import type Database from 'better-sqlite3';

// 01b §3.6 (v1.5 B-4): the responsibility kinds a station is assigned.
export type Responsibility = 'count_stock' | 'run_station';

// What the hub stores (01b §5.2): the v2 directory without the kept `approver_role_id`, which v2 hubs
// ignore (B18 a). A DirectoryInput (01b §4.3.1) is assignable to it.
export interface DirectoryCore {
  directory_version: number;
  staff: {
    staff_id: string;
    display_name: string;
    pin_hash: string;
    role_ids: string[];
    denied_permissions: string[];
    lead_staff_id: string | null;
    floor_ids: string[];
  }[];
  roles: {
    role_id: string;
    name: string;
    session_idle_ttl_ms: number;
    permissions: { permission: string; grant_type: 'allowed' | 'requires_approval'; approver_role_ids: string[]; scope: Scope }[];
  }[];
  responsibilities: { responsibility: Responsibility; station_id: string; staff_ids: string[]; role_ids: string[] }[];
  // 01b v1.4 B-1: people without a PIN, for targeting only; absent from an older cloud's directory.
  no_pin_staff?: NoPinStaff[];
}

export interface NoPinStaff {
  staff_id: string;
  display_name: string;
  lead_staff_id: string | null;
}

// 01b §3.3: `scope` only on a granting result.
export type Resolution =
  | { grant: 'allowed'; scope: Scope }
  | { grant: 'requires_approval'; approver_role_ids: string[]; scope: Scope }
  | { grant: 'not_granted' }
  | { grant: 'denied' };

// 01b §3.3: branch > my_floors = my_team = my_stations > own_tables.
const SCOPE_RANK: Record<Scope, number> = { branch: 2, my_floors: 1, my_team: 1, my_stations: 1, own_tables: 0 };

function wider(a: Scope | undefined, b: Scope): Scope {
  return a === undefined || SCOPE_RANK[b] > SCOPE_RANK[a] ? b : a;
}

export interface StaffView {
  staff_id: string;
  display_name: string;
  pin_hash: string;
  role_ids: string[];
  denied_permissions: string[];
}

interface RoleRecord {
  name: string;
  session_idle_ttl_ms: number;
  permissions: Map<string, { grant_type: 'allowed' | 'requires_approval'; approver_role_ids: string[]; scope: Scope }>;
}

interface StaffRecord {
  staff_id: string;
  display_name: string;
  pin_hash: string;
  role_ids: string[];
  denied: Set<string>;
  lead_staff_id: string | null;
  floor_ids: string[];
}

type ResponsibilityRecord = DirectoryCore['responsibilities'][number];

export class StaffDirectory {
  private constructor(
    private readonly directoryVersion: number,
    private readonly staffById: Map<string, StaffRecord>,
    private readonly roles: Map<string, RoleRecord>,
    private readonly responsibilities: ResponsibilityRecord[],
    private readonly noPinById: Map<string, NoPinStaff>,
  ) {}

  static fromInput(d: DirectoryCore): StaffDirectory {
    const roles = new Map<string, RoleRecord>();
    for (const role of d.roles) {
      const permissions: RoleRecord['permissions'] = new Map();
      for (const permission of role.permissions) {
        permissions.set(permission.permission, {
          grant_type: permission.grant_type,
          approver_role_ids: sorted(permission.approver_role_ids),
          scope: permission.scope,
        });
      }
      roles.set(role.role_id, { name: role.name, session_idle_ttl_ms: role.session_idle_ttl_ms, permissions });
    }
    const staffById = new Map<string, StaffRecord>();
    for (const staff of d.staff) {
      staffById.set(staff.staff_id, {
        staff_id: staff.staff_id,
        display_name: staff.display_name,
        pin_hash: staff.pin_hash,
        role_ids: sorted(staff.role_ids),
        denied: new Set(staff.denied_permissions),
        lead_staff_id: staff.lead_staff_id,
        floor_ids: sorted(staff.floor_ids),
      });
    }
    const responsibilities = d.responsibilities
      .map((entry) => ({ ...entry, staff_ids: sorted(entry.staff_ids), role_ids: sorted(entry.role_ids) }))
      .sort((a, b) => compare(a.station_id, b.station_id) || compare(a.responsibility, b.responsibility));
    const noPinById = new Map<string, NoPinStaff>();
    for (const row of d.no_pin_staff ?? []) {
      noPinById.set(row.staff_id, { staff_id: row.staff_id, display_name: row.display_name, lead_staff_id: row.lead_staff_id });
    }
    return new StaffDirectory(d.directory_version, staffById, roles, responsibilities, noPinById);
  }

  // 01b §5.2: 10 fixed statements (v1.4 B-1 adds no_pin_staff), read whole at boot and after an apply.
  static load(db: Database.Database): StaffDirectory {
    const staff = db.prepare('SELECT staff_id, display_name, pin_hash, lead_staff_id FROM staff').all() as Array<{
      staff_id: string;
      display_name: string;
      pin_hash: string;
      lead_staff_id: string | null;
    }>;
    const roles = db.prepare('SELECT role_id, name, session_idle_ttl_ms FROM roles').all() as Array<{
      role_id: string;
      name: string;
      session_idle_ttl_ms: number;
    }>;
    const permissions = db.prepare('SELECT role_id, permission, grant_type, scope FROM role_permissions').all() as Array<{
      role_id: string;
      permission: string;
      grant_type: 'allowed' | 'requires_approval';
      scope: Scope;
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
    const responsibilities = db
      .prepare('SELECT responsibility, station_id, subject_kind, subject_id FROM responsibilities')
      .all() as Array<{ responsibility: Responsibility; station_id: string; subject_kind: 'staff' | 'role'; subject_id: string }>;
    const noPin = db.prepare('SELECT staff_id, display_name, lead_staff_id FROM no_pin_staff').all() as NoPinStaff[];
    const meta = db.prepare('SELECT directory_version FROM staff_directory_meta').get() as
      | { directory_version: number }
      | undefined;
    const approversByGrant = new Map<string, string[]>();
    for (const row of approvers) push(approversByGrant, pairKey(row.role_id, row.permission), row.approver_role_id);
    const permissionsByRole = new Map<string, DirectoryCore['roles'][number]['permissions']>();
    for (const row of permissions) {
      const list = permissionsByRole.get(row.role_id) ?? [];
      list.push({
        permission: row.permission,
        grant_type: row.grant_type,
        approver_role_ids: approversByGrant.get(pairKey(row.role_id, row.permission)) ?? [],
        scope: row.scope,
      });
      permissionsByRole.set(row.role_id, list);
    }
    const rolesByStaff = new Map<string, string[]>();
    for (const row of assignments) push(rolesByStaff, row.staff_id, row.role_id);
    const denialsByStaff = new Map<string, string[]>();
    for (const row of denials) push(denialsByStaff, row.staff_id, row.permission);
    const floorsByStaff = new Map<string, string[]>();
    for (const row of floors) push(floorsByStaff, row.staff_id, row.floor_id);
    const sets = new Map<string, ResponsibilityRecord>();
    for (const row of responsibilities) {
      const key = pairKey(row.station_id, row.responsibility);
      let set = sets.get(key);
      if (set === undefined) {
        set = { responsibility: row.responsibility, station_id: row.station_id, staff_ids: [], role_ids: [] };
        sets.set(key, set);
      }
      (row.subject_kind === 'staff' ? set.staff_ids : set.role_ids).push(row.subject_id);
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
        lead_staff_id: row.lead_staff_id,
        floor_ids: floorsByStaff.get(row.staff_id) ?? [],
      })),
      responsibilities: [...sets.values()],
      no_pin_staff: noPin,
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
    let allowedScope: Scope | undefined;
    let approvalScope: Scope | undefined;
    const approvers = new Set<string>();
    for (const roleId of staff.role_ids) {
      const grant = this.roles.get(roleId)?.permissions.get(permission);
      if (grant === undefined) continue;
      if (grant.grant_type === 'allowed') allowedScope = wider(allowedScope, grant.scope);
      else {
        approvalScope = wider(approvalScope, grant.scope);
        for (const approver of grant.approver_role_ids) approvers.add(approver);
      }
    }
    if (allowedScope !== undefined) return { grant: 'allowed', scope: allowedScope };
    if (approvalScope !== undefined && approvers.size > 0) {
      return { grant: 'requires_approval', approver_role_ids: sorted([...approvers]), scope: approvalScope };
    }
    return { grant: 'not_granted' };
  }

  // 01b §3.2 rule 6: the person's floors at this branch (scope `my_floors`).
  floorsOf(staffId: string): string[] {
    return this.staffById.get(staffId)?.floor_ids.slice() ?? [];
  }

  // 01b §3.5: the person's lead at this branch, or null.
  leadOf(staffId: string): string | null {
    return this.staffById.get(staffId)?.lead_staff_id ?? null;
  }

  // 01b §3.5: direct reports at this branch (people with a PIN, B3); v1.4 B-3: with `includeNoPin`, also
  // the people in `no_pin_staff` whose lead this is (01d team targets).
  teamOf(staffId: string, o: { includeNoPin?: boolean } = {}): string[] {
    const team: string[] = [];
    for (const staff of this.staffById.values()) if (staff.lead_staff_id === staffId) team.push(staff.staff_id);
    if (o.includeNoPin === true) {
      for (const row of this.noPinById.values()) if (row.lead_staff_id === staffId) team.push(row.staff_id);
    }
    return sorted(team);
  }

  // 01b v1.4 B-3: the `no_pin_staff` list, sorted by staff_id; never part of the roster (`list`).
  noPinStaff(): NoPinStaff[] {
    return [...this.noPinById.values()].sort((a, b) => compare(a.staff_id, b.staff_id)).map((row) => ({ ...row }));
  }

  isNoPin(staffId: string): boolean {
    return this.noPinById.has(staffId);
  }

  // 01b §3.6: stations where the person is listed, or one of their roles is.
  stationsOf(staffId: string, responsibility: Responsibility): string[] {
    const staff = this.staffById.get(staffId);
    if (staff === undefined) return [];
    return this.responsibilities
      .filter((entry) => entry.responsibility === responsibility && holds(entry, staff))
      .map((entry) => entry.station_id);
  }

  // 01b §3.6: everyone in the directory who holds the responsibility at the station.
  responsibilityHolders(stationId: string, responsibility: Responsibility): string[] {
    const entry = this.responsibilities.find((e) => e.station_id === stationId && e.responsibility === responsibility);
    if (entry === undefined) return [];
    const holders: string[] = [];
    for (const staff of this.staffById.values()) if (holds(entry, staff)) holders.push(staff.staff_id);
    return sorted(holders);
  }

  // 01b §4.3 row 9: the roster's `responsibilities` for a person.
  responsibilitiesOf(staffId: string): string[] {
    const staff = this.staffById.get(staffId);
    if (staff === undefined) return [];
    const kinds = new Set<string>();
    for (const entry of this.responsibilities) if (holds(entry, staff)) kinds.add(entry.responsibility);
    return sorted([...kinds]);
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

  // §6.18c: role names for the admin staff list.
  roleNames(staffId: string): string[] {
    return (this.staffById.get(staffId)?.role_ids ?? []).flatMap((roleId) => {
      const role = this.roles.get(roleId);
      return role === undefined ? [] : [role.name];
    });
  }

  // M89: what the admin pages may show; the command pipeline stays the authority.
  adminPermissions(staffId: string): { 'manage-devices': boolean; 'manage-staff': boolean } {
    return {
      'manage-devices': this.resolve(staffId, 'manage-devices').grant === 'allowed',
      'manage-staff': this.resolve(staffId, 'manage-staff').grant === 'allowed',
    };
  }

  hasAdmin(staffId: string): boolean {
    return this.resolve(staffId, 'access-hub-admin').grant === 'allowed';
  }
}

function holds(entry: ResponsibilityRecord, staff: StaffRecord): boolean {
  return entry.staff_ids.includes(staff.staff_id) || staff.role_ids.some((roleId) => entry.role_ids.includes(roleId));
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

function pairKey(a: string, b: string): string {
  return JSON.stringify([a, b]);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sorted(values: readonly string[]): string[] {
  return values.slice().sort(compare);
}
