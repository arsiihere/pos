/// <reference types="node" />
import { createHash } from 'node:crypto';
import type { DirectoryInput } from '@pos/events';
import type pg from 'pg';

const SAME_ATTEMPT_MS = 3_600_000;

export interface LockedCode {
  code_hash: string;
  tenant_id: string;
  branch_id: string;
  kind: 'new_branch' | 'replace_hub';
  expires_at: number;
  consumed_at: number | null;
  consumed_attempt_id: string | null;
}

export function codeHash(code: string): string {
  return sha256(code.replace(/[\s-]/g, '').toUpperCase());
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function codeIsUsable(row: LockedCode, idempotencyKey: string, now: number): boolean {
  const sameAttempt =
    row.consumed_at !== null &&
    row.consumed_attempt_id === idempotencyKey &&
    now - row.consumed_at < SAME_ATTEMPT_MS;
  return row.expires_at > now && (row.consumed_at === null || sameAttempt);
}

export async function lockRegistrationCode(client: pg.PoolClient, hash: string): Promise<LockedCode | null> {
  const result = await client.query<{
    code_hash: string;
    tenant_id: string;
    branch_id: string;
    kind: 'new_branch' | 'replace_hub';
    expires_at: string;
    consumed_at: string | null;
    consumed_attempt_id: string | null;
  }>(
    `SELECT code_hash, tenant_id, branch_id, kind, expires_at, consumed_at, consumed_attempt_id
       FROM registration_codes
      WHERE code_hash = $1
      FOR UPDATE`,
    [hash],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    ...row,
    expires_at: Number(row.expires_at),
    consumed_at: row.consumed_at === null ? null : Number(row.consumed_at),
  };
}

export async function revokeLiveKey(
  client: pg.PoolClient,
  tenantId: string,
  branchId: string,
  now: number,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE branch_api_keys SET revoked_at = $3
      WHERE tenant_id = $1 AND branch_id = $2 AND revoked_at IS NULL`,
    [tenantId, branchId, now],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function insertApiKey(
  client: pg.PoolClient,
  row: LockedCode,
  keyId: string,
  keyHash: string,
  now: number,
): Promise<void> {
  await client.query(
    `INSERT INTO branch_api_keys (tenant_id, branch_id, key_id, key_hash, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [row.tenant_id, row.branch_id, keyId, keyHash, now],
  );
}

export async function consumeCode(
  client: pg.PoolClient,
  hash: string,
  now: number,
  idempotencyKey: string,
): Promise<void> {
  await client.query(
    `UPDATE registration_codes SET consumed_at = $2, consumed_attempt_id = $3
      WHERE code_hash = $1 AND consumed_at IS NULL`,
    [hash, now, idempotencyKey],
  );
}

export async function loadDirectory(
  client: pg.PoolClient,
  tenantId: string,
  branchId: string,
): Promise<{ branch_name: string; currency_code: string; directory: DirectoryInput }> {
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
    branch_name: header.branch_name,
    currency_code: header.currency_code,
    directory: {
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
    },
  };
}
