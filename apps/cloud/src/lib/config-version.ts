import type pg from 'pg';

export interface TenantSql {
  query<R extends pg.QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<R[]>;
}

export type BumpScope = { kind: 'branch'; branchId: string } | { kind: 'tenant'; ownerUserId: string | null /* null = CLI */ };

// S8: the branch rows are locked last, in branch_id order; tenant-wide goes through branches with
// TenantLevelRepository (the D54 exception of S40 N3). The owner-row check is task 33.
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
  } else {
    await db.query(`SELECT branch_id FROM branches WHERE tenant_id = $1 ORDER BY branch_id FOR UPDATE`);
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
