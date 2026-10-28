import { DomainError } from '@pos/domain';
import type { TenantSql } from '../../lib/config-version.js';

// 01b §3.4, B7 (review 1 M4): the person half of "qualifying admin", over `staff s` with `$1` the tenant:
// active, has a PIN, effective access-hub-admin and manage-devices both `allowed` (a role grants each
// `allowed`, no denial of either; archived roles hold no staff_roles rows, B14). Shared with
// issue-registration-code (AD-6), whose first branch has nobody assigned yet.
export const QUALIFIES_AS_ADMIN_SQL = `s.tenant_id = $1 AND s.is_active AND s.pin_hash IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM staff_permission_denials d
                         WHERE d.tenant_id = s.tenant_id AND d.staff_id = s.staff_id
                           AND d.permission IN ('access-hub-admin', 'manage-devices'))
        AND (SELECT count(DISTINCT rp.permission)
               FROM staff_roles sr
               JOIN role_permissions rp ON rp.tenant_id = sr.tenant_id AND rp.role_id = sr.role_id
              WHERE sr.tenant_id = s.tenant_id AND sr.staff_id = s.staff_id AND rp.grant_type = 'allowed'
                AND rp.permission IN ('access-hub-admin', 'manage-devices')) = 2`;

// §3.4: qualifying admins per branch (the person half above, and assigned to the branch). One statement;
// `staffIds` narrows it to those people.
export async function qualifyingAdmins(db: TenantSql, staffIds?: string[]): Promise<Map<string, Set<string>>> {
  const rows = await db.query<{ branch_id: string; staff_id: string }>(
    `SELECT sb.branch_id, s.staff_id
       FROM staff s
       JOIN staff_branches sb ON sb.tenant_id = s.tenant_id AND sb.staff_id = s.staff_id
      WHERE ${QUALIFIES_AS_ADMIN_SQL}
        AND ($2::text[] IS NULL OR s.staff_id = ANY($2))
      ORDER BY sb.branch_id, s.staff_id`,
    [staffIds ?? null],
  );
  const out = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = out.get(row.branch_id);
    if (set === undefined) out.set(row.branch_id, new Set([row.staff_id]));
    else set.add(row.staff_id);
  }
  return out;
}

// §3.4: the own-admin guard first, then the last-admin guard; each compares before and after the write.
export function runAdminGuards(before: Map<string, Set<string>>, after: Map<string, Set<string>>, ownerStaffId: string | null): void {
  const lost = (keep: (branchId: string, admins: Set<string>) => boolean) =>
    [...before.entries()].filter(([branchId, admins]) => !keep(branchId, admins)).map(([branchId]) => branchId).sort();
  if (ownerStaffId !== null) {
    const branchIds = lost((branchId, admins) => !admins.has(ownerStaffId) || after.get(branchId)?.has(ownerStaffId) === true);
    if (branchIds.length > 0) throw new DomainError('OWN_ADMIN_ACCESS', { branch_ids: branchIds });
  } else {
    // Fail safe: the guard cannot tell which row is the owner's, so nobody may stop being a qualifying admin.
    const branchIds = lost((branchId, admins) => [...admins].every((staffId) => after.get(branchId)?.has(staffId) === true));
    if (branchIds.length > 0) throw new DomainError('OWN_ADMIN_ACCESS', { branch_ids: branchIds, reason: 'owner_not_linked' });
  }
  const emptied = lost((branchId) => (after.get(branchId)?.size ?? 0) > 0);
  if (emptied.length > 0) throw new DomainError('LAST_ADMIN_REQUIRED', { branch_ids: emptied });
}
