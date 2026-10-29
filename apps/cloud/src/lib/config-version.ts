import { DomainError } from '@pos/domain';
import type pg from 'pg';

export interface TenantSql {
  query<R extends pg.QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<R[]>;
}

export type BumpScope = { kind: 'branch'; branchId: string } | { kind: 'tenant'; ownerUserId: string | null /* null = CLI */ };

// S8: the branch rows are locked last, in branch_id order; tenant-wide goes through branches with
// TenantLevelRepository (the D54 exception of S40 N3). A tenant-wide write by an owner whose owner_users row
// (read at write time, never the JWT claim) misses a branch is refused; the CLIs pass null and skip the check.
export async function bumpConfigVersion(
  db: TenantSql,
  scope: BumpScope,
): Promise<Array<{ branch_id: string; config_version: number }>> {
  let rows: Array<{ branch_id: string; config_version: string }>;
  if (scope.kind === 'branch') {
    rows = await db.query(
      `UPDATE branches SET config_version = config_version + 1
        WHERE tenant_id = $1 AND branch_id = $2
        RETURNING branch_id, config_version`,
      [scope.branchId],
    );
    // A write must never commit without its bump (the hub would never download it).
    if (rows.length === 0) throw new DomainError('BRANCH_NOT_FOUND', { branch_id: scope.branchId });
  } else {
    let allowed: string[] | null = null;
    if (scope.ownerUserId !== null) {
      const owners = await db.query<{ allowed_branch_ids: string[] }>(
        `SELECT allowed_branch_ids FROM owner_users WHERE tenant_id = $1 AND user_id = $2`,
        [scope.ownerUserId],
      );
      allowed = owners[0]?.allowed_branch_ids ?? [];
    }
    const locked = await db.query<{ branch_id: string }>(
      `SELECT branch_id FROM branches WHERE tenant_id = $1 ORDER BY branch_id FOR UPDATE`,
    );
    if (allowed !== null && !locked.every((row) => allowed.includes(row.branch_id))) {
      throw new DomainError('PERMISSION_DENIED', { reason: 'tenant_wide_write' });
    }
    rows = await db.query(
      `UPDATE branches SET config_version = config_version + 1
        WHERE tenant_id = $1
        RETURNING branch_id, config_version`,
    );
  }
  return rows
    .map((row) => ({ branch_id: row.branch_id, config_version: Number(row.config_version) }))
    .sort((a, b) => (a.branch_id < b.branch_id ? -1 : a.branch_id > b.branch_id ? 1 : 0));
}

// S8 (v1.0, review 2 S-6): the owner's allowed branches come from owner_users, never the JWT claim.
// One statement; no lock (the §6.11 can_edit_tenant read). No owner row or no branch → false.
export async function coversEveryBranch(db: TenantSql, ownerUserId: string): Promise<boolean> {
  const rows = await db.query<{ covers: boolean | null }>(
    `SELECT bool_and(b.branch_id = ANY(o.allowed_branch_ids)) AS covers
       FROM branches b
       JOIN owner_users o ON o.tenant_id = b.tenant_id AND o.user_id = $2
      WHERE b.tenant_id = $1`,
    [ownerUserId],
  );
  return rows[0]?.covers === true;
}

// 01c §6 (C4: the tenant-wide 403 before all): for a write that ran coversEveryBranch first, in its own
// transaction. Bumps every branch, locked in branch_id order, without a second owner-row read (2 statements).
export async function bumpEveryBranch(db: TenantSql): Promise<Array<{ branch_id: string; config_version: number }>> {
  return bumpConfigVersion(db, { kind: 'tenant', ownerUserId: null });
}
