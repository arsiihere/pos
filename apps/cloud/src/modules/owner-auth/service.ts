/// <reference types="node" />
import { createHmac } from 'node:crypto';
import { verify } from '@node-rs/argon2';
import { DomainError } from '@pos/domain';
import type pg from 'pg';
import type { Clock } from '../../lib/clock.js';
import type { IdGen } from '../../lib/ids.js';
import type { SecretGen } from '../../lib/secrets.js';
import type { AccessClaims } from '../../plugins/jwt.js';
import {
  deleteStaleRefreshTokens,
  insertRefreshToken,
  markRefreshRotated,
  ownerProfile,
  recordLoginFailure,
  resetLoginFailures,
  revokeLiveRefreshTokens,
  sha256,
} from './repository.js';

const WINDOW_MS = 900_000;
const LOCK_MS = 900_000;
const FAILURE_LIMIT = 10;
const IP_LIMIT = 30;
const REFRESH_TTL_MS = 30 * 86_400_000;
const ACCESS_TTL_MS = 3_600_000;
const STALE_REFRESH_MS = 7 * 86_400_000;
const REFRESH_GRACE_MS = 30_000;

export interface OwnerLoginUser {
  tenant_id: string;
  user_id: string;
  display_name: string;
  password_hash: string;
  allowed_branch_ids: string[];
  login_locked_until: string | null;
}

export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$FvNB5jNPmwC7Zwiv1aMtkg$9pK3a7lFvEyuog5JuYGR337S7Pr04G8Kmer+9b+3q2g';

export interface IpLimiter {
  check(ip: string): { limited: boolean; retryAfterMs: number };
  record(ip: string): void;
}

export function createIpLimiter(o: { max: number; windowMs: number; clock: Clock }): IpLimiter {
  const hits = new Map<string, number[]>();
  return {
    check(ip) {
      const now = o.clock.branchNow();
      const recent = (hits.get(ip) ?? []).filter((at) => now - at < o.windowMs);
      hits.set(ip, recent);
      const oldest = recent[0];
      if (recent.length < o.max || oldest === undefined) return { limited: false, retryAfterMs: 0 };
      return { limited: true, retryAfterMs: oldest + o.windowMs - now };
    },
    record(ip) {
      const now = o.clock.branchNow();
      const recent = hits.get(ip) ?? [];
      recent.push(now);
      hits.set(ip, recent);
    },
  };
}

export interface LoginDeps {
  pool: pg.Pool;
  clock: Clock;
  ids: IdGen;
  secrets: SecretGen;
  jwt: { sign(claims: AccessClaims): string };
}

export interface IssuedTokens {
  access_token: string;
  access_expires_at: number;
  refresh_token: string;
  refresh_expires_at: number;
  user: { user_id: string; display_name: string; tenant_id: string; allowed_branch_ids: string[] };
}

export async function issueTokens(client: pg.PoolClient, user: OwnerLoginUser, deps: LoginDeps): Promise<IssuedTokens> {
  const now = deps.clock.branchNow();
  await resetLoginFailures(client, user.tenant_id, user.user_id);
  await deleteStaleRefreshTokens(client, user.tenant_id, user.user_id, now - STALE_REFRESH_MS);
  const refreshToken = deps.secrets.token256();
  const refreshExpiresAt = now + REFRESH_TTL_MS;
  await insertRefreshToken(client, {
    tenantId: user.tenant_id,
    tokenId: deps.ids.next(),
    userId: user.user_id,
    tokenHash: sha256(refreshToken),
    now,
    expiresAt: refreshExpiresAt,
  });
  return {
    access_token: deps.jwt.sign({
      sub: user.user_id,
      tenant_id: user.tenant_id,
      allowed_branch_ids: user.allowed_branch_ids,
    }),
    access_expires_at: now + ACCESS_TTL_MS,
    refresh_token: refreshToken,
    refresh_expires_at: refreshExpiresAt,
    user: {
      user_id: user.user_id,
      display_name: user.display_name,
      tenant_id: user.tenant_id,
      allowed_branch_ids: user.allowed_branch_ids,
    },
  };
}

export async function login(
  credentials: { byEmail(email: string): Promise<OwnerLoginUser | null> },
  input: { email: string; password: string },
  deps: LoginDeps,
  ip: string,
  limiter: IpLimiter,
): Promise<IssuedTokens> {
  const gate = limiter.check(ip);
  if (gate.limited) throw new DomainError('IP_LOCKED_OUT', { retry_after_ms: gate.retryAfterMs });
  const user = await credentials.byEmail(input.email);
  const now = deps.clock.branchNow();
  if (user === null || locked(user, now)) {
    await verify(DUMMY_PASSWORD_HASH, input.password);
    limiter.record(ip);
    throw new DomainError('LOGIN_INVALID');
  }
  const match = await verify(user.password_hash, input.password);
  if (!match) {
    await recordLoginFailure(deps.pool, {
      tenantId: user.tenant_id,
      userId: user.user_id,
      now,
      windowMs: WINDOW_MS,
      threshold: FAILURE_LIMIT,
      lockMs: LOCK_MS,
    });
    limiter.record(ip);
    throw new DomainError('LOGIN_INVALID');
  }
  const client = await deps.pool.connect();
  try {
    await client.query('BEGIN');
    const tokens = await issueTokens(client, user, deps);
    await client.query('COMMIT');
    return tokens;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function locked(user: OwnerLoginUser, now: number): boolean {
  if (user.login_locked_until === null) return false;
  return Number(user.login_locked_until) > now;
}

export const IP_LOGIN_LIMIT = { max: IP_LIMIT, windowMs: WINDOW_MS };

interface StoredRefresh {
  tenant_id: string;
  token_id: string;
  user_id: string;
  expires_at: string;
  rotated_at: string | null;
  revoked_at: string | null;
}

export interface RefreshDeps extends LoginDeps {
  refreshSecret: string;
}

export async function refreshTokens(
  credentials: {
    refreshByHash(client: pg.PoolClient, hash: string, forUpdate: boolean): Promise<StoredRefresh | null>;
  },
  token: string,
  deps: RefreshDeps,
): Promise<IssuedTokens> {
  const client = await deps.pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    const row = await credentials.refreshByHash(client, sha256(token), true);
    const now = deps.clock.branchNow();
    if (row === null || Number(row.expires_at) <= now || row.revoked_at !== null) {
      throw new DomainError('REFRESH_TOKEN_INVALID');
    }
    const successor = createHmac('sha256', deps.refreshSecret).update(token).digest('base64url');
    if (row.rotated_at !== null && now - Number(row.rotated_at) > REFRESH_GRACE_MS) {
      await revokeLiveRefreshTokens(client, row.tenant_id, row.user_id, now);
      await client.query('COMMIT');
      committed = true;
      throw new DomainError('REFRESH_TOKEN_INVALID');
    } else if (row.rotated_at !== null) {
      const stored = await credentials.refreshByHash(client, sha256(successor), false);
      if (stored === null) throw new Error('successor missing');
      const issued = await issueAccess(client, row, successor, Number(stored.expires_at), deps, now);
      await client.query('COMMIT');
      return issued;
    } else {
      await markRefreshRotated(client, row.tenant_id, row.token_id, now);
      const refreshExpiresAt = now + REFRESH_TTL_MS;
      await insertRefreshToken(client, {
        tenantId: row.tenant_id,
        tokenId: deps.ids.next(),
        userId: row.user_id,
        tokenHash: sha256(successor),
        now,
        expiresAt: refreshExpiresAt,
      });
      const issued = await issueAccess(client, row, successor, refreshExpiresAt, deps, now);
      await client.query('COMMIT');
      return issued;
    }
  } catch (error) {
    if (!committed) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function issueAccess(
  client: pg.PoolClient,
  row: StoredRefresh,
  refreshToken: string,
  refreshExpiresAt: number,
  deps: RefreshDeps,
  now: number,
): Promise<IssuedTokens> {
  const profile = await ownerProfile(client, row.tenant_id, row.user_id);
  if (profile === null) throw new Error('owner missing');
  return {
    access_token: deps.jwt.sign({
      sub: row.user_id,
      tenant_id: row.tenant_id,
      allowed_branch_ids: profile.allowed_branch_ids,
    }),
    access_expires_at: now + ACCESS_TTL_MS,
    refresh_token: refreshToken,
    refresh_expires_at: refreshExpiresAt,
    user: {
      user_id: row.user_id,
      display_name: profile.display_name,
      tenant_id: row.tenant_id,
      allowed_branch_ids: profile.allowed_branch_ids,
    },
  };
}
