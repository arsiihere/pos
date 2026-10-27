import type { Permission } from '@pos/domain';
import type { TenantSql } from '../../lib/config-version.js';
import type { GrantWire } from '@pos/events';
import type { ResponsibilityRow, RoleRow, StaffRow } from './versions.js';

export type { ResponsibilityRow, RoleRow, StaffRow } from './versions.js';

// 01b §6.1: people by status (and branch), or by id. The five child reads are fixed, so the list is
// 6 statements whatever the staff count; INT / BIGINT go through Number() here (§5.3 rule 5).
export type StaffFilter = { status: 'active' | 'left'; branchId?: string } | { ids: string[] };

export async function selectStaff(db: TenantSql, filter: StaffFilter): Promise<StaffRow[]> {
  const people =
    'ids' in filter
      ? await db.query<PersonRow>(`${PERSON_SQL} WHERE s.tenant_id = $1 AND s.staff_id = ANY($2) ${PERSON_ORDER}`, [filter.ids])
      : filter.branchId === undefined
        ? await db.query<PersonRow>(`${PERSON_SQL} WHERE s.tenant_id = $1 AND s.is_active = $2 ${PERSON_ORDER}`, [
            filter.status === 'active',
          ])
        : await db.query<PersonRow>(
            `${PERSON_SQL} WHERE s.tenant_id = $1 AND s.is_active = $2
               AND EXISTS (SELECT 1 FROM staff_branches sb
                            WHERE sb.tenant_id = s.tenant_id AND sb.staff_id = s.staff_id AND sb.branch_id = $3)
             ${PERSON_ORDER}`,
            [filter.status === 'active', filter.branchId],
          );
  const ids = people.map((row) => row.staff_id);
  const branches = await db.query<{ staff_id: string; branch_id: string }>(
    `SELECT staff_id, branch_id FROM staff_branches WHERE tenant_id = $1 AND staff_id = ANY($2)`,
    [ids],
  );
  const roles = await db.query<{ staff_id: string; role_id: string }>(
    `SELECT staff_id, role_id FROM staff_roles WHERE tenant_id = $1 AND staff_id = ANY($2)`,
    [ids],
  );
  const denials = await db.query<{ staff_id: string; permission: Permission }>(
    `SELECT staff_id, permission FROM staff_permission_denials WHERE tenant_id = $1 AND staff_id = ANY($2)`,
    [ids],
  );
  const leads = await db.query<{ staff_id: string; branch_id: string; lead_staff_id: string }>(
    `SELECT staff_id, branch_id, lead_staff_id FROM staff_leads WHERE tenant_id = $1 AND staff_id = ANY($2)`,
    [ids],
  );
  const floors = await db.query<{ staff_id: string; branch_id: string; floor_id: string }>(
    `SELECT staff_id, branch_id, floor_id FROM staff_floors WHERE tenant_id = $1 AND staff_id = ANY($2)`,
    [ids],
  );
  const branchesOf = group(branches, (row) => row.branch_id);
  const rolesOf = group(roles, (row) => row.role_id);
  const denialsOf = group(denials, (row) => row.permission);
  const leadsOf = group(leads, (row) => ({ branch_id: row.branch_id, lead_staff_id: row.lead_staff_id }));
  const floorsOf = new Map<string, Map<string, string[]>>();
  for (const row of floors) {
    let byBranch = floorsOf.get(row.staff_id);
    if (byBranch === undefined) floorsOf.set(row.staff_id, (byBranch = new Map()));
    const list = byBranch.get(row.branch_id);
    if (list === undefined) byBranch.set(row.branch_id, [row.floor_id]);
    else list.push(row.floor_id);
  }
  return people.map((row) => ({
    staff_id: row.staff_id,
    display_name: row.display_name,
    role_ids: rolesOf.get(row.staff_id) ?? [],
    branch_ids: branchesOf.get(row.staff_id) ?? [],
    denied_permissions: denialsOf.get(row.staff_id) ?? [],
    has_pin: row.has_pin,
    pin_set_at: row.pin_set_at === null ? null : Number(row.pin_set_at),
    is_active: row.is_active,
    left_at: row.left_at === null ? null : Number(row.left_at),
    reports_to: leadsOf.get(row.staff_id) ?? [],
    floors: [...(floorsOf.get(row.staff_id) ?? new Map<string, string[]>()).entries()].map(([branch_id, floor_ids]) => ({
      branch_id,
      floor_ids,
    })),
  }));
}

interface PersonRow {
  staff_id: string;
  display_name: string;
  has_pin: boolean;
  pin_set_at: string | null;
  is_active: boolean;
  left_at: string | null;
}

const PERSON_SQL = `SELECT s.staff_id, s.display_name, s.pin_hash IS NOT NULL AS has_pin, s.pin_set_at, s.is_active, s.left_at
  FROM staff s`;
const PERSON_ORDER = 'ORDER BY lower(s.display_name), s.staff_id';

// 01b §6.5: roles by archived state, or by id; 4 statements whatever the role count (staff_count over active staff).
export type RoleFilter = { archived: boolean } | { ids: string[] };

export async function selectRoles(db: TenantSql, filter: RoleFilter): Promise<RoleRow[]> {
  const roles =
    'ids' in filter
      ? await db.query<RoleHead>(`${ROLE_SQL} AND role_id = ANY($2) ${ROLE_ORDER}`, [filter.ids])
      : await db.query<RoleHead>(`${ROLE_SQL} AND (archived_at IS NOT NULL) = $2 ${ROLE_ORDER}`, [filter.archived]);
  const ids = roles.map((row) => row.role_id);
  const grants = await db.query<{ role_id: string; permission: GrantWire['permission']; grant_type: GrantWire['grant_type']; scope: GrantWire['scope'] }>(
    `SELECT role_id, permission, grant_type, scope FROM role_permissions WHERE tenant_id = $1 AND role_id = ANY($2)`,
    [ids],
  );
  const approvers = await db.query<{ role_id: string; permission: string; approver_role_id: string }>(
    `SELECT role_id, permission, approver_role_id FROM role_permission_approvers WHERE tenant_id = $1 AND role_id = ANY($2)`,
    [ids],
  );
  const counts = await db.query<{ role_id: string; n: string }>(
    `SELECT sr.role_id, count(*) AS n
       FROM staff_roles sr JOIN staff s ON s.tenant_id = sr.tenant_id AND s.staff_id = sr.staff_id
      WHERE sr.tenant_id = $1 AND sr.role_id = ANY($2) AND s.is_active
      GROUP BY sr.role_id`,
    [ids],
  );
  const approversOf = new Map<string, string[]>();
  for (const row of approvers) {
    const key = pairKey(row.role_id, row.permission);
    approversOf.set(key, [...(approversOf.get(key) ?? []), row.approver_role_id]);
  }
  const grantsOf = new Map<string, GrantWire[]>();
  for (const row of grants) {
    const grant = {
      permission: row.permission,
      grant_type: row.grant_type,
      approver_role_ids: approversOf.get(pairKey(row.role_id, row.permission)) ?? [],
      scope: row.scope,
    };
    grantsOf.set(row.role_id, [...(grantsOf.get(row.role_id) ?? []), grant]);
  }
  const countOf = new Map(counts.map((row) => [row.role_id, Number(row.n)]));
  return roles.map((row) => ({
    role_id: row.role_id,
    name: row.name,
    default_key: row.default_key,
    archived_at: row.archived_at === null ? null : Number(row.archived_at),
    session_idle_ttl_ms: Number(row.session_idle_ttl_ms),
    staff_count: countOf.get(row.role_id) ?? 0,
    grants: grantsOf.get(row.role_id) ?? [],
  }));
}

interface RoleHead {
  role_id: string;
  name: string;
  default_key: string | null;
  archived_at: string | null;
  session_idle_ttl_ms: number;
}

const ROLE_SQL = `SELECT role_id, name, default_key, archived_at, session_idle_ttl_ms FROM roles WHERE tenant_id = $1`;
const ROLE_ORDER = 'ORDER BY lower(name), role_id';

// §6.6, B12-like: an active role with this name (case-insensitive), other than `exceptRoleId`.
export async function roleNameTaken(db: TenantSql, name: string, exceptRoleId: string | null): Promise<boolean> {
  const rows = await db.query(
    `SELECT 1 FROM roles WHERE tenant_id = $1 AND archived_at IS NULL AND lower(name) = lower($2)
        AND ($3::text IS NULL OR role_id <> $3) LIMIT 1`,
    [name, exceptRoleId],
  );
  return rows.length > 0;
}

// §6.6: default_key null (owner-made role).
export async function insertRole(db: TenantSql, r: { roleId: string; name: string; idleMs: number }): Promise<void> {
  await db.query(
    `INSERT INTO roles (tenant_id, role_id, name, session_idle_ttl_ms, default_key)
     SELECT tenant_id, $2, $3, $4, NULL FROM tenants WHERE tenant_id = $1`,
    [r.roleId, r.name, r.idleMs],
  );
}

// §5.1, B10 (M7): approver_role_id is dual-written with the first sorted approver; the list goes to its own table.
export async function insertGrants(db: TenantSql, roleId: string, grants: GrantWire[]): Promise<void> {
  if (grants.length === 0) return;
  await db.query(
    `INSERT INTO role_permissions (tenant_id, role_id, permission, grant_type, approver_role_id, scope)
     SELECT t.tenant_id, $2, x.p, x.g, x.a, x.s FROM tenants t, unnest($3::text[], $4::text[], $5::text[], $6::text[]) AS x(p, g, a, s)
      WHERE t.tenant_id = $1`,
    [
      roleId,
      grants.map((g) => g.permission),
      grants.map((g) => g.grant_type),
      grants.map((g) => [...g.approver_role_ids].sort()[0] ?? null),
      grants.map((g) => g.scope),
    ],
  );
  const pairs = grants.flatMap((g) => g.approver_role_ids.map((approver) => ({ permission: g.permission, approver })));
  if (pairs.length === 0) return;
  await db.query(
    `INSERT INTO role_permission_approvers (tenant_id, role_id, permission, approver_role_id)
     SELECT t.tenant_id, $2, x.p, x.a FROM tenants t, unnest($3::text[], $4::text[]) AS x(p, a) WHERE t.tenant_id = $1`,
    [roleId, pairs.map((row) => row.permission), pairs.map((row) => row.approver)],
  );
}

// §6.7: name and idle limit; default_key is never changed here (B17).
export async function updateRoleRow(db: TenantSql, roleId: string, r: { name: string; idleMs: number }): Promise<void> {
  await db.query(`UPDATE roles SET name = $3, session_idle_ttl_ms = $4 WHERE tenant_id = $1 AND role_id = $2`, [roleId, r.name, r.idleMs]);
}

// §6.7: grants are sent whole and replace the stored list (approver rows cascade from their grant).
export async function replaceGrants(db: TenantSql, roleId: string, grants: GrantWire[]): Promise<void> {
  await db.query(`DELETE FROM role_permissions WHERE tenant_id = $1 AND role_id = $2`, [roleId]);
  await insertGrants(db, roleId, grants);
}

// §6 script: target rows locked FOR UPDATE in id order, after the tenant row (B11).
export async function lockRoles(db: TenantSql, roleIds: string[]): Promise<Set<string>> {
  const rows = await db.query<{ role_id: string }>(
    `SELECT role_id FROM roles WHERE tenant_id = $1 AND role_id = ANY($2) ORDER BY role_id FOR UPDATE`,
    [roleIds],
  );
  return new Set(rows.map((row) => row.role_id));
}

// B11: the first lock of every directory write.
export async function lockTenant(db: TenantSql): Promise<void> {
  const rows = await db.query(`SELECT tenant_id FROM tenants WHERE tenant_id = $1 FOR NO KEY UPDATE`);
  if (rows.length !== 1) throw new Error('tenant row not found');
}

// B8, B7: the acting owner's row, read at write time (never the JWT claim), and whether it covers every branch.
export async function selectOwner(
  db: TenantSql,
  ownerUserId: string,
): Promise<{ staff_id: string | null; covers_every_branch: boolean } | undefined> {
  const rows = await db.query<{ staff_id: string | null; covers: boolean | null }>(
    `SELECT o.staff_id,
            (SELECT bool_and(b.branch_id = ANY(o.allowed_branch_ids)) FROM branches b WHERE b.tenant_id = o.tenant_id) AS covers
       FROM owner_users o
      WHERE o.tenant_id = $1 AND o.user_id = $2`,
    [ownerUserId],
  );
  const row = rows[0];
  return row === undefined ? undefined : { staff_id: row.staff_id, covers_every_branch: row.covers === true };
}

export async function bumpDirectoryVersion(db: TenantSql): Promise<void> {
  await db.query(`UPDATE tenants SET directory_version = directory_version + 1 WHERE tenant_id = $1`);
}

// References read without a lock (B11).
export async function selectBranchIds(db: TenantSql, branchIds: string[]): Promise<Set<string>> {
  const rows = await db.query<{ branch_id: string }>(`SELECT branch_id FROM branches WHERE tenant_id = $1 AND branch_id = ANY($2)`, [
    branchIds,
  ]);
  return new Set(rows.map((row) => row.branch_id));
}

export async function selectRoleStates(db: TenantSql, roleIds: string[]): Promise<Map<string, { archived: boolean }>> {
  const rows = await db.query<{ role_id: string; archived: boolean }>(
    `SELECT role_id, archived_at IS NOT NULL AS archived FROM roles WHERE tenant_id = $1 AND role_id = ANY($2)`,
    [roleIds],
  );
  return new Map(rows.map((row) => [row.role_id, { archived: row.archived }]));
}

export async function selectFloorStates(
  db: TenantSql,
  floorIds: string[],
): Promise<Map<string, { branch_id: string; archived: boolean }>> {
  const rows = await db.query<{ floor_id: string; branch_id: string; archived: boolean }>(
    `SELECT floor_id, branch_id, archived_at IS NOT NULL AS archived FROM floors WHERE tenant_id = $1 AND floor_id = ANY($2)`,
    [floorIds],
  );
  return new Map(rows.map((row) => [row.floor_id, { branch_id: row.branch_id, archived: row.archived }]));
}

// §3.5: (branch, lead) pairs where the lead is active and works at that branch.
export async function selectActiveAtBranch(db: TenantSql, staffIds: string[]): Promise<Set<string>> {
  const rows = await db.query<{ staff_id: string; branch_id: string }>(
    `SELECT sb.staff_id, sb.branch_id
       FROM staff_branches sb
       JOIN staff s ON s.tenant_id = sb.tenant_id AND s.staff_id = sb.staff_id
      WHERE sb.tenant_id = $1 AND sb.staff_id = ANY($2) AND s.is_active`,
    [staffIds],
  );
  return new Set(rows.map((row) => pairKey(row.branch_id, row.staff_id)));
}

// §3.5 loop check: walk from `leadStaffId` upward at the branch, at most as many hops as the branch has active
// staff (one statement); true when the walk reaches `staffId`.
export async function leadLineReaches(db: TenantSql, branchId: string, leadStaffId: string, staffId: string): Promise<boolean> {
  const rows = await db.query<{ reaches: boolean }>(
    `WITH RECURSIVE line (staff_id, hops) AS (
       SELECT $3::text, 1
       UNION ALL
       SELECT l.lead_staff_id, line.hops + 1
         FROM line JOIN staff_leads l ON l.tenant_id = $1 AND l.branch_id = $2 AND l.staff_id = line.staff_id
        WHERE line.staff_id <> $4
          AND line.hops < (SELECT count(*) FROM staff_branches sb
                             JOIN staff s ON s.tenant_id = sb.tenant_id AND s.staff_id = sb.staff_id
                            WHERE sb.tenant_id = $1 AND sb.branch_id = $2 AND s.is_active)
     )
     SELECT EXISTS (SELECT 1 FROM line WHERE staff_id = $4) AS reaches`,
    [branchId, leadStaffId, staffId],
  );
  return rows[0]?.reaches === true;
}

// B12: the first branch (by id) among `branchIds` where an active person other than `exceptStaffId` has the name.
export async function firstNameClash(
  db: TenantSql,
  displayName: string,
  branchIds: string[],
  exceptStaffId: string | null,
): Promise<string | undefined> {
  const rows = await db.query<{ branch_id: string }>(
    `SELECT sb.branch_id
       FROM staff s
       JOIN staff_branches sb ON sb.tenant_id = s.tenant_id AND sb.staff_id = s.staff_id
      WHERE s.tenant_id = $1 AND s.is_active AND lower(s.display_name) = lower($2)
        AND sb.branch_id = ANY($3) AND ($4::text IS NULL OR s.staff_id <> $4)
      ORDER BY sb.branch_id
      LIMIT 1`,
    [displayName, branchIds, exceptStaffId],
  );
  return rows[0]?.branch_id;
}

export interface NewStaff {
  staffId: string;
  displayName: string;
  roleIds: string[];
  branchIds: string[];
  deniedPermissions: string[];
  reportsTo: { branch_id: string; lead_staff_id: string }[];
  floors: { branch_id: string; floor_id: string }[];
  now: number;
}

// §6.2 rule 5: pin_hash NULL (B3).
export async function insertStaff(db: TenantSql, s: NewStaff): Promise<void> {
  await db.query(
    `INSERT INTO staff (tenant_id, staff_id, display_name, pin_hash, is_active, created_at, updated_at)
     SELECT tenant_id, $2, $3, NULL, true, $4, $4 FROM tenants WHERE tenant_id = $1`,
    [s.staffId, s.displayName, s.now],
  );
  await addBranches(db, s.staffId, s.branchIds);
  await addRoles(db, s.staffId, s.roleIds);
  await insertDenials(db, s.staffId, s.deniedPermissions);
  await insertLeads(db, s.staffId, s.reportsTo);
  await insertFloors(db, s.staffId, s.floors);
}

// §6.4: the person's own row (name, active state, left_at).
export async function updateStaffRow(
  db: TenantSql,
  staffId: string,
  r: { displayName: string; isActive: boolean; leftAt: number | null; now: number },
): Promise<void> {
  await db.query(
    `UPDATE staff SET display_name = $3, is_active = $4, left_at = $5, updated_at = $6 WHERE tenant_id = $1 AND staff_id = $2`,
    [staffId, r.displayName, r.isActive, r.leftAt, r.now],
  );
}

// B15: the direct reports of `leadStaffId` at the given branches, ordered by branch, then person.
export async function selectReports(
  db: TenantSql,
  leadStaffId: string,
  branchIds: string[],
): Promise<{ branch_id: string; staff_id: string }[]> {
  if (branchIds.length === 0) return [];
  return db.query<{ branch_id: string; staff_id: string }>(
    `SELECT branch_id, staff_id FROM staff_leads WHERE tenant_id = $1 AND lead_staff_id = $2 AND branch_id = ANY($3)
      ORDER BY branch_id, staff_id`,
    [leadStaffId, branchIds],
  );
}

// B15: a moved report gets the leaver's own lead at that branch, or no lead.
export async function setLead(db: TenantSql, branchId: string, staffId: string, leadStaffId: string | null): Promise<void> {
  if (leadStaffId === null) {
    await db.query(`DELETE FROM staff_leads WHERE tenant_id = $1 AND branch_id = $2 AND staff_id = $3`, [branchId, staffId]);
  } else {
    await db.query(`UPDATE staff_leads SET lead_staff_id = $4 WHERE tenant_id = $1 AND branch_id = $2 AND staff_id = $3`, [
      branchId,
      staffId,
      leadStaffId,
    ]);
  }
}

// §3.6: a leaver's (all branches) or a removed branch's staff responsibilities; returns the branches whose set changed.
export async function deleteStaffResponsibilities(db: TenantSql, staffId: string, branchIds: string[] | null): Promise<string[]> {
  if (branchIds !== null && branchIds.length === 0) return [];
  const rows = await db.query<{ branch_id: string }>(
    `DELETE FROM responsibilities
      WHERE tenant_id = $1 AND subject_kind = 'staff' AND subject_id = $2 AND ($3::text[] IS NULL OR branch_id = ANY($3))
      RETURNING branch_id`,
    [staffId, branchIds],
  );
  return [...new Set(rows.map((row) => row.branch_id))];
}

// §5.3: the responsibility rows of the given branches, with their station's archived state (B23 set input).
export async function selectResponsibilityRows(db: TenantSql, branchIds: string[]): Promise<(ResponsibilityRow & { branch_id: string })[]> {
  const rows = await db.query<ResponsibilityRow & { branch_id: string; station_archived_at: string | null }>(
    `SELECT r.branch_id, r.responsibility, r.station_id, r.subject_kind, r.subject_id, st.archived_at AS station_archived_at
       FROM responsibilities r
       LEFT JOIN stations st ON st.tenant_id = r.tenant_id AND st.station_id = r.station_id
      WHERE r.tenant_id = $1 AND r.branch_id = ANY($2)`,
    [branchIds],
  );
  return rows.map((row) => ({ ...row, station_archived_at: row.station_archived_at === null ? null : Number(row.station_archived_at) }));
}

// §5.1 notes (m7): a branch change is a diff, never delete-and-reinsert (leads and floors cascade from the row).
export async function removeBranches(db: TenantSql, staffId: string, branchIds: string[]): Promise<void> {
  if (branchIds.length === 0) return;
  await db.query(`DELETE FROM staff_branches WHERE tenant_id = $1 AND staff_id = $2 AND branch_id = ANY($3)`, [staffId, branchIds]);
}

export async function addBranches(db: TenantSql, staffId: string, branchIds: string[]): Promise<void> {
  if (branchIds.length === 0) return;
  await db.query(
    `INSERT INTO staff_branches (tenant_id, branch_id, staff_id)
     SELECT t.tenant_id, x.b, $3 FROM tenants t, unnest($2::text[]) AS x(b) WHERE t.tenant_id = $1`,
    [branchIds, staffId],
  );
}

export async function removeRoles(db: TenantSql, staffId: string, roleIds: string[]): Promise<void> {
  if (roleIds.length === 0) return;
  await db.query(`DELETE FROM staff_roles WHERE tenant_id = $1 AND staff_id = $2 AND role_id = ANY($3)`, [staffId, roleIds]);
}

export async function addRoles(db: TenantSql, staffId: string, roleIds: string[]): Promise<void> {
  if (roleIds.length === 0) return;
  await db.query(
    `INSERT INTO staff_roles (tenant_id, staff_id, role_id)
     SELECT t.tenant_id, $2, x.r FROM tenants t, unnest($3::text[]) AS x(r) WHERE t.tenant_id = $1`,
    [staffId, roleIds],
  );
}

// §6.4: denials, leads and floors are sent whole and replace the stored list.
export async function replaceDenials(db: TenantSql, staffId: string, permissions: string[]): Promise<void> {
  await db.query(`DELETE FROM staff_permission_denials WHERE tenant_id = $1 AND staff_id = $2`, [staffId]);
  await insertDenials(db, staffId, permissions);
}

export async function replaceLeads(db: TenantSql, staffId: string, reportsTo: NewStaff['reportsTo']): Promise<void> {
  await db.query(`DELETE FROM staff_leads WHERE tenant_id = $1 AND staff_id = $2`, [staffId]);
  await insertLeads(db, staffId, reportsTo);
}

export async function replaceFloors(db: TenantSql, staffId: string, floors: NewStaff['floors']): Promise<void> {
  await db.query(`DELETE FROM staff_floors WHERE tenant_id = $1 AND staff_id = $2`, [staffId]);
  await insertFloors(db, staffId, floors);
}

async function insertDenials(db: TenantSql, staffId: string, permissions: string[]): Promise<void> {
  if (permissions.length === 0) return;
  await db.query(
    `INSERT INTO staff_permission_denials (tenant_id, staff_id, permission)
     SELECT t.tenant_id, $2, x.p FROM tenants t, unnest($3::text[]) AS x(p) WHERE t.tenant_id = $1`,
    [staffId, permissions],
  );
}

async function insertLeads(db: TenantSql, staffId: string, reportsTo: NewStaff['reportsTo']): Promise<void> {
  if (reportsTo.length === 0) return;
  await db.query(
    `INSERT INTO staff_leads (tenant_id, branch_id, staff_id, lead_staff_id)
     SELECT t.tenant_id, x.b, $2, x.l FROM tenants t, unnest($3::text[], $4::text[]) AS x(b, l) WHERE t.tenant_id = $1`,
    [staffId, reportsTo.map((row) => row.branch_id), reportsTo.map((row) => row.lead_staff_id)],
  );
}

async function insertFloors(db: TenantSql, staffId: string, floors: NewStaff['floors']): Promise<void> {
  if (floors.length === 0) return;
  await db.query(
    `INSERT INTO staff_floors (tenant_id, branch_id, staff_id, floor_id)
     SELECT t.tenant_id, x.b, $2, x.fl FROM tenants t, unnest($3::text[], $4::text[]) AS x(b, fl) WHERE t.tenant_id = $1`,
    [staffId, floors.map((row) => row.branch_id), floors.map((row) => row.floor_id)],
  );
}

// §6 script: target rows locked FOR UPDATE in id order, after the tenant row (B11).
export async function lockStaff(db: TenantSql, staffIds: string[]): Promise<Map<string, { is_active: boolean }>> {
  const rows = await db.query<{ staff_id: string; is_active: boolean }>(
    `SELECT staff_id, is_active FROM staff WHERE tenant_id = $1 AND staff_id = ANY($2) ORDER BY staff_id FOR UPDATE`,
    [staffIds],
  );
  return new Map(rows.map((row) => [row.staff_id, { is_active: row.is_active }]));
}

// §6.3: pin_hash and pin_set_at only; the version input does not change (B23).
export async function updatePin(db: TenantSql, staffId: string, pinHash: string, now: number): Promise<void> {
  await db.query(`UPDATE staff SET pin_hash = $3, pin_set_at = $4, updated_at = $4 WHERE tenant_id = $1 AND staff_id = $2`, [
    staffId,
    pinHash,
    now,
  ]);
}

export function pairKey(a: string, b: string): string {
  return JSON.stringify([a, b]);
}

function group<R extends { staff_id: string }, V>(rows: R[], value: (row: R) => V): Map<string, V[]> {
  const out = new Map<string, V[]>();
  for (const row of rows) {
    const list = out.get(row.staff_id);
    if (list === undefined) out.set(row.staff_id, [value(row)]);
    else list.push(value(row));
  }
  return out;
}
