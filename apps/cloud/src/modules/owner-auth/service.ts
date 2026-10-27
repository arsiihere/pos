/// <reference types="node" />
import { createHmac } from 'node:crypto';
import { Algorithm, hash, verify, Version } from '@node-rs/argon2';
import { DomainError } from '@pos/domain';
import type pg from 'pg';
import { TenantLevelRepository } from '../../db/tenant-level-repository.js';
import type { TenantContext } from '../../db/tenant-scoped-repository.js';
import type { Clock } from '../../lib/clock.js';
import { writeConfigAudit } from '../../lib/config-audit.js';
import type { IdGen } from '../../lib/ids.js';
import type { SecretGen } from '../../lib/secrets.js';
import type { AccessClaims } from '../../plugins/jwt.js';
import {
  clearLockNotice,
  deleteStaleRefreshTokens,
  lockOwnerRow,
  insertRefreshToken,
  markRefreshRotated,
  recordLoginFailure,
  resetLoginFailures,
  revokeLiveRefreshTokens,
  sha256,
  writeChangedPassword,
  type OwnerAuthRow,
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
  credential_version: number;
}

export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$FvNB5jNPmwC7Zwiv1aMtkg$9pK3a7lFvEyuog5JuYGR337S7Pr04G8Kmer+9b+3q2g';

export interface IpLimiter {
  check(ip: string): { limited: boolean; retryAfterMs: number; at: number };
  release(ip: string, at: number): void;
}

export function createIpLimiter(o: { max: number; windowMs: number; clock: Clock }): IpLimiter {
  const hits = new Map<string, number[]>();
  return {
    check(ip) {
      const now = o.clock.branchNow();
      const recent = (hits.get(ip) ?? []).filter((at) => now - at < o.windowMs);
      if (recent.length >= o.max) {
        hits.set(ip, recent);
        const oldest = recent[0] ?? now;
        return { limited: true, retryAfterMs: oldest + o.windowMs - now, at: now };
      }
      recent.push(now);
      hits.set(ip, recent);
      return { limited: false, retryAfterMs: 0, at: now };
    },
    release(ip, at) {
      const recent = hits.get(ip);
      if (recent === undefined) return;
      const index = recent.lastIndexOf(at);
      if (index >= 0) recent.splice(index, 1);
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
  user: { user_id: string; display_name: string; tenant_id: string; allowed_branch_ids: string[]; must_change_password: boolean };
  lockout_notice: { locked_at: number; failed_count: number } | null;
}

// 01b §3.7, M73: what the notice reports; the count is the lock threshold.
function lockoutNotice(lockNoticeAt: number | null): IssuedTokens['lockout_notice'] {
  return lockNoticeAt === null ? null : { locked_at: lockNoticeAt, failed_count: FAILURE_LIMIT };
}

// 01b §6.13 (c): runs under the owner-row lock; `owner` is the locked row.
export async function issueTokens(
  client: pg.PoolClient,
  user: OwnerLoginUser,
  owner: OwnerAuthRow,
  deps: LoginDeps,
): Promise<IssuedTokens> {
  const now = deps.clock.branchNow();
  await resetLoginFailures(client, user.tenant_id, user.user_id);
  if (owner.lock_notice_at !== null) await clearLockNotice(client, user.tenant_id, user.user_id);
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
    credentialVersion: owner.credential_version,
  });
  return {
    access_token: deps.jwt.sign({
      sub: user.user_id,
      tenant_id: user.tenant_id,
      allowed_branch_ids: owner.allowed_branch_ids,
      cv: owner.credential_version,
    }),
    access_expires_at: now + ACCESS_TTL_MS,
    refresh_token: refreshToken,
    refresh_expires_at: refreshExpiresAt,
    user: {
      user_id: user.user_id,
      display_name: owner.display_name,
      tenant_id: user.tenant_id,
      allowed_branch_ids: owner.allowed_branch_ids,
      must_change_password: owner.must_change_password,
    },
    lockout_notice: lockoutNotice(owner.lock_notice_at),
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
  let succeeded = false; // also true for a refusal that is not a guess (the IP is not counted)
  try {
    const user = await credentials.byEmail(input.email);
    const now = deps.clock.branchNow();
    if (user === null || locked(user, now)) {
      await verify(DUMMY_PASSWORD_HASH, input.password);
      throw new DomainError('LOGIN_INVALID');
    }
    const match = await verify(user.password_hash, input.password);
    const failure = async () => {
      await recordLoginFailure(deps.pool, {
        tenantId: user.tenant_id,
        userId: user.user_id,
        now,
        windowMs: WINDOW_MS,
        threshold: FAILURE_LIMIT,
        lockMs: LOCK_MS,
      });
      return new DomainError('LOGIN_INVALID');
    };
    if (!match) throw await failure();
    // 01b §6.13: the success transaction, under the owner row taken FOR NO KEY UPDATE first.
    const client = await deps.pool.connect();
    let outcome: IssuedTokens | 'changed' | 'expired';
    try {
      await client.query('BEGIN');
      const owner = await lockOwnerRow(client, user.tenant_id, user.user_id, { passwordHash: user.password_hash });
      if (owner === null) outcome = 'changed';
      else if (owner.must_change_password && owner.temp_password_expires_at !== null && owner.temp_password_expires_at <= now) {
        outcome = 'expired';
      } else outcome = await issueTokens(client, user, owner, deps);
      await client.query(typeof outcome === 'string' ? 'ROLLBACK' : 'COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    // (a) a change or reset committed after the verify: refused, nothing counted
    if (outcome === 'changed') {
      succeeded = true;
      throw new DomainError('LOGIN_INVALID');
    }
    // (b) expired temporary password (M3): the failure path
    if (outcome === 'expired') throw await failure();
    succeeded = true;
    return outcome;
  } finally {
    if (succeeded) limiter.release(ip, gate.at);
  }
}

function locked(user: OwnerLoginUser, now: number): boolean {
  if (user.login_locked_until === null) return false;
  return Number(user.login_locked_until) > now;
}

export const IP_LOGIN_LIMIT = { max: IP_LIMIT, windowMs: WINDOW_MS };

// 00 M8
const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1, algorithm: Algorithm.Argon2id, version: Version.V0x13 };

export type ChangedPassword = Omit<IssuedTokens, 'user' | 'lockout_notice'>;

// 01b §6.11. Shares login's per-IP limiter (M64): a refusal that is a guess counts for the IP.
export async function changePassword(
  input: { current_password: string; new_password: string },
  who: { tenant: TenantContext; userId: string },
  deps: LoginDeps,
  ip: string,
  limiter: IpLimiter,
): Promise<ChangedPassword> {
  // (0)
  const gate = limiter.check(ip);
  if (gate.limited) throw new DomainError('IP_LOCKED_OUT', { retry_after_ms: gate.retryAfterMs });
  let uncounted = false;
  try {
    // (1) before any hash work
    if (input.new_password === input.current_password) {
      uncounted = true;
      throw new DomainError('PASSWORD_UNCHANGED');
    }
    // (2)
    const users = await new TenantLevelRepository(who.tenant, deps.pool).query<{ password_hash: string; login_locked_until: string | null }>(
      `SELECT password_hash, login_locked_until FROM owner_users WHERE tenant_id = $1 AND user_id = $2`,
      [who.userId],
    );
    const user = users[0];
    if (user === undefined) {
      uncounted = true;
      throw new DomainError('JWT_INVALID');
    }
    // (3) locked (M73): dummy verify, the IP failure counted, the account counter unchanged
    if (user.login_locked_until !== null && Number(user.login_locked_until) > deps.clock.branchNow()) {
      await verify(DUMMY_PASSWORD_HASH, input.current_password);
      throw new DomainError('PASSWORD_INVALID');
    }
    // (4) mismatch: login's counter UPDATE (sets lock_notice_at with the lock) and the IP failure
    if (!(await verify(user.password_hash, input.current_password))) {
      await recordLoginFailure(deps.pool, {
        tenantId: who.tenant.tenantId,
        userId: who.userId,
        now: deps.clock.branchNow(),
        windowMs: WINDOW_MS,
        threshold: FAILURE_LIMIT,
        lockMs: LOCK_MS,
      });
      throw new DomainError('PASSWORD_INVALID');
    }
    const newHash = await hash(input.new_password, ARGON);
    // (5)
    const client = await deps.pool.connect();
    try {
      await client.query('BEGIN');
      const owner = await lockOwnerRow(client, who.tenant.tenantId, who.userId, { passwordHash: user.password_hash });
      if (owner === null) {
        // (a) a concurrent change or reset committed after (2): not a guess
        await client.query('ROLLBACK');
        uncounted = true;
        throw new DomainError('PASSWORD_INVALID');
      }
      const now = deps.clock.branchNow();
      const version = await writeChangedPassword(client, {
        tenantId: who.tenant.tenantId,
        userId: who.userId,
        passwordHash: newHash,
        now,
      });
      // (c)
      await revokeLiveRefreshTokens(client, who.tenant.tenantId, who.userId, now);
      const refreshToken = deps.secrets.token256();
      const refreshExpiresAt = now + REFRESH_TTL_MS;
      await insertRefreshToken(client, {
        tenantId: who.tenant.tenantId,
        tokenId: deps.ids.next(),
        userId: who.userId,
        tokenHash: sha256(refreshToken),
        now,
        expiresAt: refreshExpiresAt,
        credentialVersion: version,
      });
      await writeConfigAudit(
        new TenantLevelRepository(who.tenant, client),
        {
          actor: { kind: 'owner', ownerUserId: who.userId },
          entity: 'owner_user',
          entityId: who.userId,
          branchId: null,
          action: 'password_change',
          before: { credential_version: owner.credential_version, password_changed_at: owner.password_changed_at },
          after: { credential_version: version, password_changed_at: now },
        },
        deps,
      );
      await client.query('COMMIT');
      uncounted = true;
      return {
        access_token: deps.jwt.sign({
          sub: who.userId,
          tenant_id: who.tenant.tenantId,
          allowed_branch_ids: owner.allowed_branch_ids,
          cv: version,
        }),
        access_expires_at: now + ACCESS_TTL_MS,
        refresh_token: refreshToken,
        refresh_expires_at: refreshExpiresAt,
      };
    } catch (error) {
      if (!uncounted) await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    if (uncounted) limiter.release(ip, gate.at);
  }
}

interface StoredRefresh {
  tenant_id: string;
  token_id: string;
  user_id: string;
  expires_at: string;
  rotated_at: string | null;
  revoked_at: string | null;
  credential_version: number;
}

export interface RefreshDeps extends LoginDeps {
  refreshSecret: string;
}

// 01b §6.13 lock order (N1, N2): (1) the token unlocked, to learn its user; (2) the owner row FOR NO KEY UPDATE;
// (3) the token row FOR UPDATE and 00's checks; (4) its credential_version must equal the owner's.
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
    const hash = sha256(token);
    const found = await credentials.refreshByHash(client, hash, false);
    if (found === null) throw new DomainError('REFRESH_TOKEN_INVALID');
    const owner = await lockOwnerRow(client, found.tenant_id, found.user_id);
    if (owner === null) throw new Error('owner missing');
    const row = await credentials.refreshByHash(client, hash, true);
    const now = deps.clock.branchNow();
    if (row === null || Number(row.expires_at) <= now || row.revoked_at !== null) {
      throw new DomainError('REFRESH_TOKEN_INVALID');
    }
    // N1: a token issued before the owner's last change or reset is refused; nothing revoked.
    if (Number(row.credential_version) !== owner.credential_version) throw new DomainError('REFRESH_TOKEN_INVALID');
    const successor = createHmac('sha256', deps.refreshSecret).update(token).digest('base64url');
    if (row.rotated_at !== null && now - Number(row.rotated_at) > REFRESH_GRACE_MS) {
      await revokeLiveRefreshTokens(client, row.tenant_id, row.user_id, now);
      await client.query('COMMIT');
      committed = true;
      throw new DomainError('REFRESH_TOKEN_INVALID');
    } else if (row.rotated_at !== null) {
      // M49 grace: writes nothing, so the notice stays for the next rotating refresh or login (m1)
      const stored = await credentials.refreshByHash(client, sha256(successor), false);
      if (stored === null) throw new Error('successor missing');
      const issued = issueAccess(row, owner, successor, Number(stored.expires_at), null, deps, now);
      await client.query('COMMIT');
      return issued;
    } else {
      await markRefreshRotated(client, row.tenant_id, row.token_id, now);
      if (owner.lock_notice_at !== null) await clearLockNotice(client, row.tenant_id, row.user_id);
      const refreshExpiresAt = now + REFRESH_TTL_MS;
      await insertRefreshToken(client, {
        tenantId: row.tenant_id,
        tokenId: deps.ids.next(),
        userId: row.user_id,
        tokenHash: sha256(successor),
        now,
        expiresAt: refreshExpiresAt,
        credentialVersion: owner.credential_version,
      });
      const issued = issueAccess(row, owner, successor, refreshExpiresAt, lockoutNotice(owner.lock_notice_at), deps, now);
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

function issueAccess(
  row: StoredRefresh,
  profile: OwnerAuthRow,
  refreshToken: string,
  refreshExpiresAt: number,
  notice: IssuedTokens['lockout_notice'],
  deps: RefreshDeps,
  now: number,
): IssuedTokens {
  return {
    access_token: deps.jwt.sign({
      sub: row.user_id,
      tenant_id: row.tenant_id,
      allowed_branch_ids: profile.allowed_branch_ids,
      cv: profile.credential_version,
    }),
    access_expires_at: now + ACCESS_TTL_MS,
    refresh_token: refreshToken,
    refresh_expires_at: refreshExpiresAt,
    user: {
      user_id: row.user_id,
      display_name: profile.display_name,
      tenant_id: row.tenant_id,
      allowed_branch_ids: profile.allowed_branch_ids,
      must_change_password: profile.must_change_password,
    },
    lockout_notice: notice,
  };
}
