/// <reference types="node" />
import { createHash } from 'node:crypto';
import type pg from 'pg';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function recordLoginFailure(
  db: pg.Pool | pg.PoolClient,
  o: { tenantId: string; userId: string; now: number; windowMs: number; threshold: number; lockMs: number },
): Promise<number> {
  const result = await db.query<{ failed_login_count: number }>(
    `UPDATE owner_users
        SET failed_login_count = CASE
              WHEN login_locked_until IS NOT NULL AND login_locked_until <= $3 THEN 1
              WHEN login_window_started_at IS NULL OR $3 - login_window_started_at >= $4 THEN 1
              ELSE failed_login_count + 1
            END,
            login_window_started_at = CASE
              WHEN login_locked_until IS NOT NULL AND login_locked_until <= $3 THEN $3
              WHEN login_window_started_at IS NULL OR $3 - login_window_started_at >= $4 THEN $3
              ELSE login_window_started_at
            END,
            login_locked_until = CASE
              WHEN (CASE
                      WHEN login_locked_until IS NOT NULL AND login_locked_until <= $3 THEN 1
                      WHEN login_window_started_at IS NULL OR $3 - login_window_started_at >= $4 THEN 1
                      ELSE failed_login_count + 1
                    END) >= $5 THEN $3::bigint + $6::bigint
              ELSE NULL
            END,
            -- 01b §3.7: the UPDATE that sets the lock also sets the notice shown at the next sign-in
            lock_notice_at = CASE
              WHEN (CASE
                      WHEN login_locked_until IS NOT NULL AND login_locked_until <= $3 THEN 1
                      WHEN login_window_started_at IS NULL OR $3 - login_window_started_at >= $4 THEN 1
                      ELSE failed_login_count + 1
                    END) >= $5 THEN $3::bigint
              ELSE lock_notice_at
            END
      WHERE tenant_id = $1 AND user_id = $2
      RETURNING failed_login_count`,
    [o.tenantId, o.userId, o.now, o.windowMs, o.threshold, o.lockMs],
  );
  const count = result.rows[0]?.failed_login_count;
  if (count === undefined) throw new Error('owner user missing');
  return count;
}

export async function resetLoginFailures(client: pg.PoolClient, tenantId: string, userId: string): Promise<void> {
  await client.query(
    `UPDATE owner_users
        SET failed_login_count = 0, login_window_started_at = NULL, login_locked_until = NULL
      WHERE tenant_id = $1 AND user_id = $2`,
    [tenantId, userId],
  );
}

export async function deleteStaleRefreshTokens(
  client: pg.PoolClient,
  tenantId: string,
  userId: string,
  expiredBefore: number,
): Promise<void> {
  await client.query(
    `DELETE FROM owner_refresh_tokens
      WHERE tenant_id = $1 AND user_id = $2 AND expires_at < $3`,
    [tenantId, userId, expiredBefore],
  );
}

export async function markRefreshRotated(
  client: pg.PoolClient,
  tenantId: string,
  tokenId: string,
  now: number,
): Promise<void> {
  await client.query(
    `UPDATE owner_refresh_tokens SET rotated_at = $3 WHERE tenant_id = $1 AND token_id = $2`,
    [tenantId, tokenId, now],
  );
}

export async function revokeLiveRefreshTokens(
  client: pg.PoolClient,
  tenantId: string,
  userId: string,
  now: number,
): Promise<void> {
  await client.query(
    `UPDATE owner_refresh_tokens
        SET revoked_at = $3
      WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [tenantId, userId, now],
  );
}

export interface OwnerAuthRow {
  password_hash: string;
  must_change_password: boolean;
  temp_password_expires_at: number | null;
  credential_version: number;
  lock_notice_at: number | null;
  allowed_branch_ids: string[];
  display_name: string;
}

// 01b B5, §6.13 (N2): the one lock mode on the owner row, taken before any token row by login, refresh,
// change-password and reset. With `passwordHash`, no row means the hash changed after the caller's verify.
export async function lockOwnerRow(
  client: pg.PoolClient,
  tenantId: string,
  userId: string,
  o?: { passwordHash?: string },
): Promise<OwnerAuthRow | null> {
  const result = await client.query<{
    password_hash: string;
    must_change_password: boolean;
    temp_password_expires_at: string | null;
    credential_version: number;
    lock_notice_at: string | null;
    allowed_branch_ids: string[];
    display_name: string;
  }>(
    `SELECT password_hash, must_change_password, temp_password_expires_at, credential_version, lock_notice_at,
            allowed_branch_ids, display_name
       FROM owner_users
      WHERE tenant_id = $1 AND user_id = $2 AND ($3::text IS NULL OR password_hash = $3)
        FOR NO KEY UPDATE`,
    [tenantId, userId, o?.passwordHash ?? null],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    ...row,
    temp_password_expires_at: row.temp_password_expires_at === null ? null : Number(row.temp_password_expires_at),
    credential_version: Number(row.credential_version),
    lock_notice_at: row.lock_notice_at === null ? null : Number(row.lock_notice_at),
  };
}

// §3.7: the notice is shown once.
export async function clearLockNotice(client: pg.PoolClient, tenantId: string, userId: string): Promise<void> {
  await client.query(`UPDATE owner_users SET lock_notice_at = NULL WHERE tenant_id = $1 AND user_id = $2`, [tenantId, userId]);
}

export async function ownerProfile(
  client: pg.PoolClient,
  tenantId: string,
  userId: string,
): Promise<{ display_name: string; allowed_branch_ids: string[]; credential_version: number; must_change_password: boolean } | null> {
  const result = await client.query<{
    display_name: string;
    allowed_branch_ids: string[];
    credential_version: number;
    must_change_password: boolean;
  }>(
    `SELECT display_name, allowed_branch_ids, credential_version, must_change_password
       FROM owner_users WHERE tenant_id = $1 AND user_id = $2`,
    [tenantId, userId],
  );
  return result.rows[0] ?? null;
}

export async function insertRefreshToken(
  client: pg.PoolClient,
  row: {
    tenantId: string;
    tokenId: string;
    userId: string;
    tokenHash: string;
    now: number;
    expiresAt: number;
    credentialVersion: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO owner_refresh_tokens
       (tenant_id, token_id, user_id, token_hash, created_at, expires_at, credential_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [row.tenantId, row.tokenId, row.userId, row.tokenHash, row.now, row.expiresAt, row.credentialVersion],
  );
}
