/// <reference types="node" />
import { createHash } from 'node:crypto';
import type { Scope } from '@pos/domain';
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

// 01b §4.3.1, §7.3: 9 fixed statements whatever the staff count. Staff with no PIN are sent apart as no_pin_staff (B-1, B-5); the
// role set adds every approver role named by those roles' grants (m3); floors and responsibilities skip
// archived floors and stations; approver_role_id is the dual-written first approver (B18 a).
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
      WHERE s.tenant_id = $1 AND sb.branch_id = $2 AND s.is_active AND s.pin_hash IS NOT NULL
      ORDER BY s.staff_id`,
    [tenantId, branchId],
  );
  const staffIds = staff.rows.map((member) => member.staff_id);
  // 01b v1.4 B-1, B-5 (§4.4 row 6): active staff at the branch without a PIN, with their lead, in one statement.
  const noPin = await client.query<{ staff_id: string; display_name: string; lead_staff_id: string | null }>(
    `SELECT s.staff_id, s.display_name, sl.lead_staff_id
       FROM staff s
       JOIN staff_branches sb ON sb.tenant_id = s.tenant_id AND sb.staff_id = s.staff_id
       LEFT JOIN staff_leads sl ON sl.tenant_id = sb.tenant_id AND sl.branch_id = sb.branch_id AND sl.staff_id = s.staff_id
      WHERE s.tenant_id = $1 AND sb.branch_id = $2 AND s.is_active AND s.pin_hash IS NULL
      ORDER BY s.staff_id`,
    [tenantId, branchId],
  );
  const roles = await client.query<{ role_id: string; name: string; session_idle_ttl_ms: number }>(
    `WITH branch_roles AS (
       SELECT DISTINCT role_id FROM staff_roles WHERE tenant_id = $1 AND staff_id = ANY($2::text[])
     )
     SELECT r.role_id, r.name, r.session_idle_ttl_ms
       FROM roles r
      WHERE r.tenant_id = $1
        AND (
          r.role_id IN (SELECT role_id FROM branch_roles)
          OR r.role_id IN (
            SELECT rpa.approver_role_id FROM role_permission_approvers rpa
             WHERE rpa.tenant_id = $1 AND rpa.role_id IN (SELECT role_id FROM branch_roles)
          )
        )
      ORDER BY r.name`,
    [tenantId, staffIds],
  );
  const roleIds = roles.rows.map((role) => role.role_id);
  const permissions = await client.query<{
    role_id: string;
    permission: string;
    grant_type: 'allowed' | 'requires_approval';
    approver_role_id: string | null;
    approver_role_ids: string[];
    scope: Scope;
  }>(
    `SELECT rp.role_id, rp.permission, rp.grant_type, rp.approver_role_id, rp.scope,
            COALESCE(array_agg(rpa.approver_role_id) FILTER (WHERE rpa.approver_role_id IS NOT NULL), '{}') AS approver_role_ids
       FROM role_permissions rp
       LEFT JOIN role_permission_approvers rpa
         ON rpa.tenant_id = rp.tenant_id AND rpa.role_id = rp.role_id AND rpa.permission = rp.permission
      WHERE rp.tenant_id = $1 AND rp.role_id = ANY($2::text[])
      GROUP BY rp.role_id, rp.permission, rp.grant_type, rp.approver_role_id, rp.scope
      ORDER BY rp.role_id, rp.permission`,
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
  const leads = await client.query<{ staff_id: string; lead_staff_id: string }>(
    `SELECT staff_id, lead_staff_id FROM staff_leads
      WHERE tenant_id = $1 AND branch_id = $2 AND staff_id = ANY($3::text[])`,
    [tenantId, branchId, staffIds],
  );
  const floors = await client.query<{ staff_id: string; floor_id: string }>(
    `SELECT sf.staff_id, sf.floor_id
       FROM staff_floors sf
       JOIN floors fl ON fl.tenant_id = sf.tenant_id AND fl.branch_id = sf.branch_id AND fl.floor_id = sf.floor_id
      WHERE sf.tenant_id = $1 AND sf.branch_id = $2 AND sf.staff_id = ANY($3::text[]) AND fl.archived_at IS NULL`,
    [tenantId, branchId, staffIds],
  );
  const responsibilities = await client.query<{
    responsibility: DirectoryInput['responsibilities'][number]['responsibility'];
    station_id: string;
    subject_kind: 'staff' | 'role';
    subject_id: string;
  }>(
    `SELECT r.responsibility, r.station_id, r.subject_kind, r.subject_id
       FROM responsibilities r
       JOIN stations st ON st.tenant_id = r.tenant_id AND st.branch_id = r.branch_id AND st.station_id = r.station_id
      WHERE r.tenant_id = $1 AND r.branch_id = $2 AND st.archived_at IS NULL`,
    [tenantId, branchId],
  );
  const rolesByStaff = new Map<string, string[]>();
  const denialsByStaff = new Map<string, string[]>();
  for (const link of links.rows) {
    if (link.role_id !== null) push(rolesByStaff, link.staff_id, link.role_id);
    if (link.denied !== null) push(denialsByStaff, link.staff_id, link.denied);
  }
  const leadByStaff = new Map(leads.rows.map((row) => [row.staff_id, row.lead_staff_id]));
  const floorsByStaff = new Map<string, string[]>();
  for (const row of floors.rows) push(floorsByStaff, row.staff_id, row.floor_id);
  const sets = new Map<string, DirectoryInput['responsibilities'][number]>();
  for (const row of responsibilities.rows) {
    const key = JSON.stringify([row.station_id, row.responsibility]);
    let set = sets.get(key);
    if (set === undefined) {
      set = { responsibility: row.responsibility, station_id: row.station_id, staff_ids: [], role_ids: [] };
      sets.set(key, set);
    }
    (row.subject_kind === 'staff' ? set.staff_ids : set.role_ids).push(row.subject_id);
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
        role_ids: sorted(rolesByStaff.get(member.staff_id) ?? []),
        denied_permissions: sorted(denialsByStaff.get(member.staff_id) ?? []),
        lead_staff_id: leadByStaff.get(member.staff_id) ?? null,
        floor_ids: sorted(floorsByStaff.get(member.staff_id) ?? []),
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
            approver_role_ids: sorted(grant.approver_role_ids),
            scope: grant.scope,
          })),
      })),
      responsibilities: [...sets.values()]
        .map((set) => ({ ...set, staff_ids: sorted(set.staff_ids), role_ids: sorted(set.role_ids) }))
        .sort((a, b) => compare(a.station_id, b.station_id) || compare(a.responsibility, b.responsibility)),
      no_pin_staff: noPin.rows.map((member) => ({
        staff_id: member.staff_id,
        display_name: member.display_name,
        lead_staff_id: member.lead_staff_id,
      })),
    },
  };
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sorted(values: readonly string[]): string[] {
  return values.slice().sort(compare);
}

export async function confirmBranch(
  client: pg.PoolClient,
  tenantId: string,
  branchId: string,
  now: number,
): Promise<number | null> {
  const updated = await client.query<{ hub_confirmed_at: string }>(
    `UPDATE branches
        SET status = 'active', hub_confirmed_at = COALESCE(hub_confirmed_at, $3)
      WHERE tenant_id = $1 AND branch_id = $2
      RETURNING hub_confirmed_at`,
    [tenantId, branchId, now],
  );
  const row = updated.rows[0];
  if (row === undefined) return null;
  await client.query(
    `UPDATE registration_codes SET expires_at = $3
      WHERE tenant_id = $1 AND branch_id = $2 AND consumed_at IS NULL AND expires_at > $3`,
    [tenantId, branchId, now],
  );
  return Number(row.hub_confirmed_at);
}
