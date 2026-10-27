import type { Permission } from '@pos/domain';
import type { TenantSql } from '../../lib/config-version.js';
import type { StaffRow } from './versions.js';

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
  await db.query(
    `INSERT INTO staff_branches (tenant_id, branch_id, staff_id)
     SELECT t.tenant_id, x.b, $3 FROM tenants t, unnest($2::text[]) AS x(b) WHERE t.tenant_id = $1`,
    [s.branchIds, s.staffId],
  );
  await db.query(`INSERT INTO staff_roles (tenant_id, staff_id, role_id)
     SELECT t.tenant_id, $2, x.r FROM tenants t, unnest($3::text[]) AS x(r) WHERE t.tenant_id = $1`, [s.staffId, s.roleIds]);
  if (s.deniedPermissions.length > 0) {
    await db.query(
      `INSERT INTO staff_permission_denials (tenant_id, staff_id, permission)
       SELECT t.tenant_id, $2, x.p FROM tenants t, unnest($3::text[]) AS x(p) WHERE t.tenant_id = $1`,
      [s.staffId, s.deniedPermissions],
    );
  }
  if (s.reportsTo.length > 0) {
    await db.query(
      `INSERT INTO staff_leads (tenant_id, branch_id, staff_id, lead_staff_id)
       SELECT t.tenant_id, x.b, $2, x.l FROM tenants t, unnest($3::text[], $4::text[]) AS x(b, l) WHERE t.tenant_id = $1`,
      [s.staffId, s.reportsTo.map((row) => row.branch_id), s.reportsTo.map((row) => row.lead_staff_id)],
    );
  }
  if (s.floors.length > 0) {
    await db.query(
      `INSERT INTO staff_floors (tenant_id, branch_id, staff_id, floor_id)
       SELECT t.tenant_id, x.b, $2, x.fl FROM tenants t, unnest($3::text[], $4::text[]) AS x(b, fl) WHERE t.tenant_id = $1`,
      [s.staffId, s.floors.map((row) => row.branch_id), s.floors.map((row) => row.floor_id)],
    );
  }
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
