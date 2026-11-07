import { canonicalJson, sha256hex } from '@pos/domain/hash';
import { BRANCH_ENGINE_SETTING_KEYS, type BranchEngineSettings, type BranchWire, type GrantWire, type ResponsibilityWire, type RoleWire, type StaffWire } from '@pos/events';

// 01b B23, §5.3: the only place that builds a staff, role or responsibility wire and its version. Arrays
// are sorted by JavaScript string order (never database order); every key is present, nullable values are
// null; numbers go through Number() so a pg BIGINT string hashes like the number.

export interface StaffRow {
  staff_id: string;
  display_name: string;
  role_ids: string[];
  branch_ids: string[];
  denied_permissions: StaffWire['denied_permissions'];
  has_pin: boolean;
  pin_set_at: number | null;
  is_active: boolean;
  left_at: number | null;
  reports_to: { branch_id: string; lead_staff_id: string }[];
  floors: { branch_id: string; floor_ids: string[] }[];
}

export interface RoleRow {
  role_id: string;
  name: string;
  default_key: string | null;
  archived_at: number | null;
  session_idle_ttl_ms: number;
  staff_count: number;
  grants: GrantWire[];
}

export interface ResponsibilityRow {
  responsibility: 'count_stock';
  station_id: string;
  subject_kind: 'staff' | 'role';
  subject_id: string;
  station_archived_at: number | null;
}

// 01b v1.5 B-6: what the settings PATCH replaces, so its version input and its audit shape (not name, status
// or the hub times: a rename must not make a settings form stale, B23).
export type BranchSettings = Pick<BranchWire, 'tax_enabled' | 'day_stale_after_hours' | 'day_min_gap_hours'> & BranchEngineSettings;
export type BranchRow = Omit<BranchWire, 'version'>;

type Unversioned<T> = Omit<T, 'version'>;

export function toStaffWire(row: StaffRow): Unversioned<StaffWire> {
  return {
    staff_id: row.staff_id,
    display_name: row.display_name,
    role_ids: sorted(row.role_ids),
    branch_ids: sorted(row.branch_ids),
    denied_permissions: sorted(row.denied_permissions),
    has_pin: row.has_pin,
    pin_set_at: numberOrNull(row.pin_set_at),
    is_active: row.is_active,
    left_at: numberOrNull(row.left_at),
    reports_to: sortedReportsTo(row.reports_to),
    floors: sortedFloors(row.floors),
  };
}

export function toRoleWire(row: RoleRow): Unversioned<RoleWire> {
  return {
    role_id: row.role_id,
    name: row.name,
    is_default: row.default_key !== null,
    archived_at: numberOrNull(row.archived_at),
    idle_minutes: Number(row.session_idle_ttl_ms) / 60_000,
    staff_count: Number(row.staff_count),
    grants: sortedGrants(row.grants),
  };
}

// Active stations only (§3.6): an archived station keeps its rows but is left out.
export function toResponsibilitySet(_branchId: string, rows: ResponsibilityRow[]): ResponsibilityWire[] {
  const sets = new Map<string, ResponsibilityWire>();
  for (const row of rows) {
    if (row.station_archived_at !== null) continue;
    const key = JSON.stringify([row.station_id, row.responsibility]);
    let set = sets.get(key);
    if (set === undefined) {
      set = { responsibility: row.responsibility, station_id: row.station_id, staff_ids: [], role_ids: [] };
      sets.set(key, set);
    }
    (row.subject_kind === 'staff' ? set.staff_ids : set.role_ids).push(row.subject_id);
  }
  return sortedResponsibilities([...sets.values()]);
}

export function staffVersion(wire: Unversioned<StaffWire>): string {
  return hash({
    staff_id: wire.staff_id,
    display_name: wire.display_name,
    role_ids: sorted(wire.role_ids),
    branch_ids: sorted(wire.branch_ids),
    denied_permissions: sorted(wire.denied_permissions),
    reports_to: sortedReportsTo(wire.reports_to),
    floors: sortedFloors(wire.floors),
    is_active: wire.is_active,
  });
}

export function roleVersion(wire: Unversioned<RoleWire>): string {
  if (wire.archived_at === undefined) throw new Error('roleVersion: archived_at is undefined');
  return hash({
    role_id: wire.role_id,
    name: wire.name,
    idle_minutes: Number(wire.idle_minutes),
    archived: wire.archived_at !== null,
    grants: sortedGrants(wire.grants),
  });
}

export function responsibilitySetVersion(branchId: string, set: ResponsibilityWire[]): string {
  return hash({ branch_id: branchId, responsibilities: sortedResponsibilities(set) });
}

export function toBranchSettings(row: BranchSettings): BranchSettings {
  const engine = Object.fromEntries(BRANCH_ENGINE_SETTING_KEYS.map((key) => [key, row[key]])) as BranchEngineSettings;
  return { tax_enabled: row.tax_enabled, day_stale_after_hours: row.day_stale_after_hours, day_min_gap_hours: row.day_min_gap_hours, ...engine };
}

export function branchSettingsVersion(branchId: string, settings: BranchSettings): string {
  return hash({ branch_id: branchId, ...toBranchSettings(settings) });
}

export function toBranchWire(row: BranchRow): BranchWire {
  return { ...row, version: branchSettingsVersion(row.branch_id, row) };
}

export function withVersion<T>(wire: T, version: string): T & { version: string } {
  return { ...wire, version };
}

function hash(input: unknown): string {
  return sha256hex(canonicalJson(input));
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sorted<T extends string>(values: readonly T[]): T[] {
  return values.slice().sort(compare);
}

function numberOrNull(value: number | null): number | null {
  return value === null ? null : Number(value);
}

function sortedReportsTo(rows: StaffRow['reports_to']): StaffRow['reports_to'] {
  return rows
    .map((row) => ({ branch_id: row.branch_id, lead_staff_id: row.lead_staff_id }))
    .sort((a, b) => compare(a.branch_id, b.branch_id));
}

function sortedFloors(rows: StaffRow['floors']): StaffRow['floors'] {
  return rows
    .map((row) => ({ branch_id: row.branch_id, floor_ids: sorted(row.floor_ids) }))
    .sort((a, b) => compare(a.branch_id, b.branch_id));
}

function sortedGrants(grants: readonly GrantWire[]): GrantWire[] {
  return grants
    .map((grant) => ({
      permission: grant.permission,
      grant_type: grant.grant_type,
      approver_role_ids: sorted(grant.approver_role_ids),
      scope: grant.scope,
    }))
    .sort((a, b) => compare(a.permission, b.permission));
}

function sortedResponsibilities(set: readonly ResponsibilityWire[]): ResponsibilityWire[] {
  return set
    .map((entry) => ({
      responsibility: entry.responsibility,
      station_id: entry.station_id,
      staff_ids: sorted(entry.staff_ids),
      role_ids: sorted(entry.role_ids),
    }))
    .sort((a, b) => compare(a.station_id, b.station_id) || compare(a.responsibility, b.responsibility));
}
