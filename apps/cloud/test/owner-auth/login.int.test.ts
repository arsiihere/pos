import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemContext } from '../../src/cli/system-context';
import { seedTenant } from '../../src/cli/seed-tenant';
import { testIdGen, type IdGen } from '../../src/lib/ids';
import { createTestCloud, truncateAll, type TestCloud } from '../helpers/test-cloud';

const verifyHashes = vi.hoisted(() => [] as string[]);

vi.mock('@node-rs/argon2', async () => {
  const actual = await vi.importActual<typeof import('@node-rs/argon2')>('@node-rs/argon2');
  return {
    ...actual,
    verify: async (hash: string, password: string) => {
      verifyHashes.push(hash);
      return actual.verify(hash, password);
    },
  };
});

const T = 1_761_000_000_000;
const DAY_MS = 86_400_000;
const PASSWORD = 'password-1';

const cleanups: Array<() => Promise<void>> = [];
let ids: IdGen = testIdGen();

describe('POST /v1/auth/login', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #53] login happy path; wrong password and unknown email both 401 with similar timing (within 2×); 10 failures → 429', async () => {
    const cloud = await open();
    const created = await seedOwner(cloud, 'owner@example.com');
    const ok = await login(cloud.app, 'Owner@Example.com', PASSWORD);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toMatchObject({
      access_expires_at: T + 3_600_000,
      refresh_expires_at: T + 30 * DAY_MS,
      user: {
        user_id: created.user_id,
        display_name: 'Ada',
        tenant_id: created.tenant_id,
        allowed_branch_ids: [],
      },
    });
    expect(cloud.app.jwt.verify(ok.json().data.access_token)).toEqual({
      sub: created.user_id,
      tenant_id: created.tenant_id,
      allowed_branch_ids: [],
    });
    const stored = await cloud.pool.query<{ token_hash: string }>(
      `SELECT token_hash FROM owner_refresh_tokens WHERE user_id = $1`,
      [created.user_id],
    );
    expect(stored.rows).toEqual([{ token_hash: sha256(ok.json().data.refresh_token as string) }]);

    const wrongMs = await elapsed(() => login(cloud.app, 'owner@example.com', 'wrong-password'));
    const unknownMs = await elapsed(() => login(cloud.app, 'missing@example.com', PASSWORD));
    expect(wrongMs.status).toBe(401);
    expect(unknownMs.status).toBe(401);
    expect(wrongMs.body.error.code).toBe('LOGIN_INVALID');
    expect(unknownMs.body.error.code).toBe('LOGIN_INVALID');
    const slower = Math.max(wrongMs.ms, unknownMs.ms);
    const faster = Math.max(1, Math.min(wrongMs.ms, unknownMs.ms));
    expect(slower).toBeLessThanOrEqual(faster * 2);

    const locked = await seedOwner(cloud, 'locked@example.com', 'Bea');
    for (let i = 0; i < 10; i += 1) {
      const failed = await login(cloud.app, 'locked@example.com', 'wrong-password');
      expect(failed.statusCode).toBe(401);
      expect(failed.json().error.code).toBe('LOGIN_INVALID');
    }
    const row = await cloud.pool.query<{ failed_login_count: number; login_locked_until: string }>(
      `SELECT failed_login_count, login_locked_until FROM owner_users WHERE user_id = $1`,
      [locked.user_id],
    );
    expect(row.rows[0]).toMatchObject({ failed_login_count: 10, login_locked_until: String(T + 900_000) });
  });

  it('[00 §10 #109] a locked account gives identical 401 LOGIN_INVALID for the right and a wrong password; the real hash is not verified; 30 IP failures → 429; 10 concurrent failures count 10', async () => {
    const cloud = await open();
    const created = await seedOwner(cloud, 'owner@example.com');
    await cloud.pool.query(`UPDATE owner_users SET failed_login_count = 10, login_locked_until = $2 WHERE user_id = $1`, [
      created.user_id,
      T + 900_000,
    ]);
    const user = await cloud.pool.query<{ password_hash: string }>(
      `SELECT password_hash FROM owner_users WHERE user_id = $1`,
      [created.user_id],
    );
    verifyHashes.length = 0;
    const right = await login(cloud.app, 'owner@example.com', PASSWORD);
    const wrong = await login(cloud.app, 'owner@example.com', 'wrong-password');
    expect(right.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(right.json().error.code).toBe('LOGIN_INVALID');
    expect(withoutRequestId(right.json())).toEqual(withoutRequestId(wrong.json()));
    expect(verifyHashes).not.toContain(user.rows[0]!.password_hash);
    expect(verifyHashes.length).toBeGreaterThan(0);
    const after = await cloud.pool.query<{ failed_login_count: number }>(
      `SELECT failed_login_count FROM owner_users WHERE user_id = $1`,
      [created.user_id],
    );
    expect(after.rows[0]!.failed_login_count).toBe(10);

    for (let i = 0; i < 30; i += 1) {
      const failed = await login(cloud.app, 'missing@example.com', PASSWORD, '203.0.113.9');
      expect(failed.statusCode).toBe(401);
    }
    const limited = await login(cloud.app, 'missing@example.com', PASSWORD, '203.0.113.9');
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('IP_LOCKED_OUT');
    expect(limited.json().error.details).toEqual({ retry_after_ms: 900_000 });
    expect(limited.headers['retry-after']).toBe('900');

    const concurrent = await seedOwner(cloud, 'race@example.com', 'Cam');
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) => login(cloud.app, 'race@example.com', 'wrong-password', `198.51.100.${index + 1}`)),
    );
    expect(results.every((res) => res.statusCode === 401 && res.json().error.code === 'LOGIN_INVALID')).toBe(true);
    const count = await cloud.pool.query<{ failed_login_count: number }>(
      `SELECT failed_login_count FROM owner_users WHERE user_id = $1`,
      [concurrent.user_id],
    );
    expect(count.rows[0]!.failed_login_count).toBe(10);

    const burst = await Promise.all(
      Array.from({ length: 31 }, () => login(cloud.app, 'missing@example.com', PASSWORD, '203.0.113.50')),
    );
    expect(burst.filter((res) => res.statusCode === 401)).toHaveLength(30);
    expect(burst.filter((res) => res.statusCode === 429 && res.json().error.code === 'IP_LOCKED_OUT')).toHaveLength(1);

    await seedOwner(cloud, 'keeper@example.com', 'Kim');
    const kept = '203.0.113.60';
    expect((await login(cloud.app, 'keeper@example.com', PASSWORD, kept)).statusCode).toBe(200);
    for (let i = 0; i < 30; i += 1) {
      expect((await login(cloud.app, 'missing@example.com', PASSWORD, kept)).statusCode).toBe(401);
    }
    expect((await login(cloud.app, 'missing@example.com', PASSWORD, kept)).statusCode).toBe(429);
  });

  it("[00 §10 #126] login deletes that user's refresh tokens expired more than 7 days; other users' rows untouched", async () => {
    const cloud = await open();
    const owner = await seedOwner(cloud, 'owner@example.com');
    const other = await seedOwner(cloud, 'other@example.com', 'Bea');
    const stale = T - 7 * DAY_MS - 1;
    const kept = T - 7 * DAY_MS;
    await insertToken(cloud, owner, 'stale', stale);
    await insertToken(cloud, owner, 'boundary', kept);
    await insertToken(cloud, owner, 'live', T + 30 * DAY_MS);
    await insertToken(cloud, other, 'other-stale', stale);

    const res = await login(cloud.app, 'owner@example.com', PASSWORD);
    expect(res.statusCode).toBe(200);
    const rows = await cloud.pool.query<{ token_id: string }>(
      `SELECT token_id FROM owner_refresh_tokens ORDER BY token_id`,
    );
    const ids = rows.rows.map((row) => row.token_id);
    expect(ids).not.toContain(tokenId(owner.user_id, 'stale'));
    expect(ids).toEqual(
      expect.arrayContaining([
        tokenId(owner.user_id, 'boundary'),
        tokenId(owner.user_id, 'live'),
        tokenId(other.user_id, 'other-stale'),
      ]),
    );
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

function login(app: FastifyInstance, email: string, password: string, remoteAddress?: string) {
  return app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { email, password },
    remoteAddress,
  });
}

async function elapsed(run: () => Promise<{ statusCode: number; json(): { error: { code: string } } }>) {
  const start = Date.now();
  const res = await run();
  return { ms: Date.now() - start, status: res.statusCode, body: res.json() };
}

function withoutRequestId(body: { error: { request_id: string } }): unknown {
  const copy = structuredClone(body);
  delete (copy.error as { request_id?: string }).request_id;
  return copy;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function tokenId(userId: string, label: string): string {
  return `${userId}:${label}`;
}

async function insertToken(cloud: TestCloud, owner: { tenant_id: string; user_id: string }, label: string, expiresAt: number) {
  await cloud.pool.query(
    `INSERT INTO owner_refresh_tokens
       (tenant_id, token_id, user_id, token_hash, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [owner.tenant_id, tokenId(owner.user_id, label), owner.user_id, sha256(label), T, expiresAt],
  );
}
