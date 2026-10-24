import { createHash, createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { SystemContext } from '../../src/cli/system-context';
import { seedTenant } from '../../src/cli/seed-tenant';
import { testIdGen, type IdGen } from '../../src/lib/ids';
import { createTestCloud, truncateAll, type TestCloud } from '../helpers/test-cloud';

const T = 1_761_000_000_000;
const PASSWORD = 'password-1';
const GRACE_MS = 30_000;

const cleanups: Array<() => Promise<void>> = [];
let ids: IdGen = testIdGen();

describe('owner refresh and logout', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #54] refresh rotates; the same rotated token within 30 s returns the same successor and revokes nothing; two concurrent refreshes both return that successor; after 30 s the token is 401 and every live token of the user is revoked', async () => {
    const cloud = await open();
    const owner = await seedOwner(cloud, 'owner@example.com');
    const first = await login(cloud.app, 'owner@example.com');
    expect(first.statusCode).toBe(200);
    const original = first.json().data.refresh_token as string;
    await insertToken(cloud, owner, 'extra', T + 86_400_000);

    const rotated = await refresh(cloud.app, original);
    expect(rotated.statusCode).toBe(200);
    const successor = successorOf(cloud.env.REFRESH_TOKEN_SECRET, original);
    expect(rotated.json().data.refresh_token).toBe(successor);
    expect(rotated.json().data.user.user_id).toBe(owner.user_id);

    cloud.clock.set(T + GRACE_MS);
    const replay = await refresh(cloud.app, original);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data.refresh_token).toBe(successor);
    expect(replay.json().data.access_token).not.toBe(rotated.json().data.access_token);
    const mid = await tokenRows(cloud, owner.user_id);
    expect(mid.every((row) => row.revoked_at === null)).toBe(true);
    expect(mid.filter((row) => row.token_hash === sha256(successor))).toHaveLength(1);

    cloud.clock.set(T + GRACE_MS + 1);
    const reused = await refresh(cloud.app, original);
    expect(reused.statusCode).toBe(401);
    expect(reused.json().error.code).toBe('REFRESH_TOKEN_INVALID');
    const after = await tokenRows(cloud, owner.user_id);
    expect(after.every((row) => row.revoked_at !== null)).toBe(true);

    const other = await seedOwner(cloud, 'race@example.com', 'Bea');
    const raced = await login(cloud.app, 'race@example.com');
    const token = raced.json().data.refresh_token as string;
    const [left, right] = await Promise.all([refresh(cloud.app, token), refresh(cloud.app, token)]);
    expect(left.statusCode).toBe(200);
    expect(right.statusCode).toBe(200);
    const same = successorOf(cloud.env.REFRESH_TOKEN_SECRET, token);
    expect(left.json().data.refresh_token).toBe(same);
    expect(right.json().data.refresh_token).toBe(same);
    const rows = await tokenRows(cloud, other.user_id);
    expect(rows.filter((row) => row.token_hash === sha256(same))).toHaveLength(1);
    expect(rows.every((row) => row.revoked_at === null)).toBe(true);
  });

  it("[00 §10 #55] logout revokes own token; another user's token → revoked: false, still valid", async () => {
    const cloud = await open();
    const owner = await seedOwner(cloud, 'owner@example.com');
    const other = await seedOwner(cloud, 'other@example.com', 'Bea');
    const mine = await login(cloud.app, 'owner@example.com');
    const theirs = await login(cloud.app, 'other@example.com');
    const loggedOut = await logout(cloud.app, mine.json().data.access_token, mine.json().data.refresh_token);
    expect(loggedOut.statusCode).toBe(200);
    expect(loggedOut.json().data).toEqual({ revoked: true });
    const again = await refresh(cloud.app, mine.json().data.refresh_token);
    expect(again.statusCode).toBe(401);
    expect(again.json().error.code).toBe('REFRESH_TOKEN_INVALID');

    const foreign = await logout(cloud.app, mine.json().data.access_token, theirs.json().data.refresh_token);
    expect(foreign.statusCode).toBe(200);
    expect(foreign.json().data).toEqual({ revoked: false });
    const still = await refresh(cloud.app, theirs.json().data.refresh_token);
    expect(still.statusCode).toBe(200);
    expect(still.json().data.user.user_id).toBe(other.user_id);
    const own = await tokenRows(cloud, owner.user_id);
    expect(own.find((row) => row.token_hash === sha256(mine.json().data.refresh_token))?.revoked_at).not.toBeNull();
  });

  it('[00 §10 #123] an expired refresh token is 401; a successful login resets the failure counter', async () => {
    const cloud = await open();
    const owner = await seedOwner(cloud, 'owner@example.com');
    await cloud.pool.query(
      `UPDATE owner_users SET failed_login_count = 4, login_window_started_at = $2 WHERE user_id = $1`,
      [owner.user_id, T],
    );
    await insertToken(cloud, owner, 'expired', T);
    const expired = await refresh(cloud.app, 'expired');
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error.code).toBe('REFRESH_TOKEN_INVALID');

    const ok = await login(cloud.app, 'owner@example.com');
    expect(ok.statusCode).toBe(200);
    const row = await cloud.pool.query<{ failed_login_count: number; login_locked_until: string | null }>(
      `SELECT failed_login_count, login_locked_until FROM owner_users WHERE user_id = $1`,
      [owner.user_id],
    );
    expect(row.rows[0]).toEqual({ failed_login_count: 0, login_locked_until: null });
  });
});

async function open(): Promise<TestCloud> {
  ids = testIdGen();
  const cloud = await createTestCloud();
  cleanups.push(async () => {
    await truncateAll(cloud.pool);
    await cloud.close();
  });
  await truncateAll(cloud.pool);
  return cloud;
}

async function seedOwner(cloud: TestCloud, email: string, ownerName = 'Ada') {
  return seedTenant(
    new SystemContext(cloud.pool),
    { name: ownerName, currency: 'PKR', ownerEmail: email, ownerName, password: PASSWORD, pin: '1234' },
    { clock: cloud.clock, ids },
  );
}

function login(app: FastifyInstance, email: string) {
  return app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: PASSWORD } });
}

function refresh(app: FastifyInstance, refreshToken: string) {
  return app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: refreshToken } });
}

function logout(app: FastifyInstance, accessToken: string, refreshToken: string) {
  return app.inject({
    method: 'POST',
    url: '/v1/auth/logout',
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { refresh_token: refreshToken },
  });
}

function successorOf(secret: string, token: string): string {
  return createHmac('sha256', secret).update(token).digest('base64url');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function insertToken(
  cloud: TestCloud,
  owner: { tenant_id: string; user_id: string },
  label: string,
  expiresAt: number,
) {
  await cloud.pool.query(
    `INSERT INTO owner_refresh_tokens
       (tenant_id, token_id, user_id, token_hash, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [owner.tenant_id, `${owner.user_id}:${label}`, owner.user_id, sha256(label), T, expiresAt],
  );
}

async function tokenRows(cloud: TestCloud, userId: string) {
  const result = await cloud.pool.query<{ token_hash: string; revoked_at: string | null }>(
    `SELECT token_hash, revoked_at FROM owner_refresh_tokens WHERE user_id = $1`,
    [userId],
  );
  return result.rows;
}
