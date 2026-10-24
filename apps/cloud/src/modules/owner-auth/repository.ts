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

export async function insertRefreshToken(
  client: pg.PoolClient,
  row: { tenantId: string; tokenId: string; userId: string; tokenHash: string; now: number; expiresAt: number },
): Promise<void> {
  await client.query(
    `INSERT INTO owner_refresh_tokens
       (tenant_id, token_id, user_id, token_hash, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [row.tenantId, row.tokenId, row.userId, row.tokenHash, row.now, row.expiresAt],
  );
}
