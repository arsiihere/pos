import type pg from 'pg';

// 01b #79 (review 1 M7): the v1.4 cloud loadDirectory, kept verbatim (from the commit before 01b task 6) so a
// test can run v1.4's SQL over rows written by 01b and check the rollback of the approver move stays safe.
export async function loadDirectoryV14(client: pg.PoolClient, tenantId: string, branchId: string): Promise<unknown> {
  const branch = await client.query<{ branch_name: string; currency_code: string; directory_version: string }>(
    `SELECT b.name AS branch_name, t.currency_code, t.directory_version
       FROM branches b
       JOIN tenants t ON t.tenant_id = b.tenant_id
      WHERE b.tenant_id = $1 AND b.branch_id = $2`,
    [tenantId, branchId],
  );
  const header = branch.rows[0];
  if (header === undefined) throw new Error('branch not found');
  const staff = await client.query<{ staff_id: string; display_name: string; pin_hash: string }>(
    `SELECT s.staff_id, s.display_name, s.pin_hash
       FROM staff s
       JOIN staff_branches sb ON sb.tenant_id = s.tenant_id AND sb.staff_id = s.staff_id
      WHERE s.tenant_id = $1 AND sb.branch_id = $2 AND s.is_active
      ORDER BY s.staff_id`,
    [tenantId, branchId],
  );
  const roles = await client.query<{ role_id: string; name: string; session_idle_ttl_ms: number }>(
    `WITH branch_roles AS (
       SELECT DISTINCT sr.role_id
         FROM staff_roles sr
         JOIN staff s ON s.tenant_id = sr.tenant_id AND s.staff_id = sr.staff_id
         JOIN staff_branches sb ON sb.tenant_id = sr.tenant_id AND sb.staff_id = sr.staff_id
        WHERE sr.tenant_id = $1 AND sb.branch_id = $2 AND s.is_active
     )
     SELECT r.role_id, r.name, r.session_idle_ttl_ms
       FROM roles r
      WHERE r.tenant_id = $1
        AND (
          r.role_id IN (SELECT role_id FROM branch_roles)
          OR r.role_id IN (
            SELECT rp.approver_role_id FROM role_permissions rp
             WHERE rp.tenant_id = $1 AND rp.approver_role_id IS NOT NULL
               AND rp.role_id IN (SELECT role_id FROM branch_roles)
          )
        )
      ORDER BY r.name`,
    [tenantId, branchId],
  );
  const roleIds = roles.rows.map((role) => role.role_id);
  const staffIds = staff.rows.map((member) => member.staff_id);
  const permissions = await client.query<{
    role_id: string;
    permission: string;
    grant_type: 'allowed' | 'requires_approval';
    approver_role_id: string | null;
  }>(
    `SELECT role_id, permission, grant_type, approver_role_id
       FROM role_permissions
      WHERE tenant_id = $1 AND role_id = ANY($2::text[])
      ORDER BY role_id, permission`,
    [tenantId, roleIds],
  );
  const links = await client.query<{ staff_id: string; role_id: string | null; denied: string | null }>(
    `SELECT staff_id, role_id, NULL::text AS denied
       FROM staff_roles
      WHERE tenant_id = $1 AND staff_id = ANY($2::text[])
     UNION ALL
     SELECT staff_id, NULL::text, permission
       FROM staff_permission_denials
      WHERE tenant_id = $1 AND staff_id = ANY($2::text[])`,
    [tenantId, staffIds],
  );
  const rolesByStaff = new Map<string, string[]>();
  const denialsByStaff = new Map<string, string[]>();
  for (const link of links.rows) {
    if (link.role_id !== null) {
      const list = rolesByStaff.get(link.staff_id) ?? [];
      list.push(link.role_id);
      rolesByStaff.set(link.staff_id, list);
    }
    if (link.denied !== null) {
      const list = denialsByStaff.get(link.staff_id) ?? [];
      list.push(link.denied);
      denialsByStaff.set(link.staff_id, list);
    }
  }
  return {
    directory_version: Number(header.directory_version),
    staff: staff.rows.map((member) => ({
      staff_id: member.staff_id,
      display_name: member.display_name,
      pin_hash: member.pin_hash,
      role_ids: (rolesByStaff.get(member.staff_id) ?? []).slice().sort(),
      denied_permissions: (denialsByStaff.get(member.staff_id) ?? []).slice().sort(),
    })),
    roles: roles.rows.map((role) => ({
      role_id: role.role_id,
      name: role.name,
      session_idle_ttl_ms: role.session_idle_ttl_ms,
      permissions: permissions.rows
        .filter((grant) => grant.role_id === role.role_id)
        .map((grant) => ({
          permission: grant.permission,
          grant_type: grant.grant_type,
          approver_role_id: grant.approver_role_id,
        })),
    })),
  };
}
