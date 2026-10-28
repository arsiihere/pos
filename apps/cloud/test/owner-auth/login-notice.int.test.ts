import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemContext } from '../../src/cli/system-context';
import { seedTenant } from '../../src/cli/seed-tenant';
import { testIdGen } from '../../src/lib/ids';
import { createTestCloud, truncateAll, type TestCloud } from '../helpers/test-cloud';

// Runs after a password check that matched, before the login's own transaction (01b §6.13 "after the verify").
const afterVerify = vi.hoisted(() => ({ run: null as null | (() => Promise<void>) }));

vi.mock('@node-rs/argon2', async () => {
  const actual = await vi.importActual<typeof import('@node-rs/argon2')>('@node-rs/argon2');
  return {
    ...actual,
    verify: async (hash: string, password: string) => {
      const match = await actual.verify(hash, password);
      if (match && afterVerify.run !== null) await afterVerify.run();
      return match;
    },
  };
});

const T = 1_761_000_000_000;
const PASSWORD = 'password-1';

describe('login: owner-row lock and lockout notice (01b §6.13, §3.7, M73)', () => {
  let cloud: TestCloud;
  let owner: { tenant_id: string; user_id: string };

  beforeAll(async () => {
    cloud = await createTestCloud();
    await cloud.app.ready();
  });
  afterAll(async () => {
    await truncateAll(cloud.pool);
    await cloud.close();
  });
  beforeEach(async () => {
    afterVerify.run = null;
    cloud.clock.set(T);
    await truncateAll(cloud.pool);
    owner = await seedTenant(
      new SystemContext(cloud.pool),
      { name: 'Pilot', currency: 'PKR', ownerEmail: 'owner@example.com', ownerName: 'Ada', password: PASSWORD, pin: '1234' },
      { clock: cloud.clock, ids: testIdGen() },
    );
  });

  let ip = 0;
  const login = (app: FastifyInstance, password: string) =>
    app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'owner@example.com', password }, remoteAddress: `10.0.0.${++ip % 250}` });
  const row = async () =>
    (
      await cloud.pool.query<{ failed_login_count: number; lock_notice_at: string | null; credential_version: number }>(
        `SELECT failed_login_count, lock_notice_at, credential_version FROM owner_users WHERE user_id = $1`,
        [owner.user_id],
      )
    ).rows[0]!;

  it('[01b #4] after 10 wrong passwords lock the account, the next successful login returns lockout_notice { locked_at, failed_count: 10 }; the one after returns null', async () => {
    const first = await login(cloud.app, PASSWORD);
    expect(first.statusCode).toBe(200);
    expect(first.json().data.lockout_notice).toBeNull();
    expect(first.json().data.user.must_change_password).toBe(false);

    const lockedAt = T + 5_000;
    cloud.clock.set(lockedAt);
    for (let i = 0; i < 10; i += 1) expect((await login(cloud.app, 'wrong-password')).statusCode).toBe(401);
    expect(Number((await row()).lock_notice_at)).toBe(lockedAt);

    cloud.clock.set(lockedAt + 900_001);
    const next = await login(cloud.app, PASSWORD);
    expect(next.statusCode).toBe(200);
    expect(next.json().data.lockout_notice).toEqual({ locked_at: lockedAt, failed_count: 10 });
    expect((await row()).lock_notice_at).toBeNull();

    const after = await login(cloud.app, PASSWORD);
    expect(after.json().data.lockout_notice).toBeNull();
  });

  it('[01b §6.13] a matching password whose hash changed after the verify → 401 LOGIN_INVALID, nothing counted, no token', async () => {
    afterVerify.run = async () => {
      afterVerify.run = null;
      await cloud.pool.query(`UPDATE owner_users SET password_hash = 'changed-elsewhere', credential_version = credential_version + 1 WHERE user_id = $1`, [
        owner.user_id,
      ]);
    };
    const raced = await login(cloud.app, PASSWORD);
    expect(raced.statusCode).toBe(401);
    expect(raced.json().error.code).toBe('LOGIN_INVALID');
    expect((await row()).failed_login_count).toBe(0);
    const tokens = await cloud.pool.query(`SELECT 1 FROM owner_refresh_tokens WHERE user_id = $1`, [owner.user_id]);
    expect(tokens.rows).toHaveLength(0);
  });

  it('[01b §6.13] an expired temporary password set by SQL → 401 LOGIN_INVALID, counted; an unexpired one signs in with must_change_password', async () => {
    await cloud.pool.query(`UPDATE owner_users SET must_change_password = true, temp_password_expires_at = $2 WHERE user_id = $1`, [
      owner.user_id,
      T + 1_000,
    ]);
    const fresh = await login(cloud.app, PASSWORD);
    expect(fresh.statusCode).toBe(200);
    expect(fresh.json().data.user.must_change_password).toBe(true);

    cloud.clock.set(T + 1_000);
    const expired = await login(cloud.app, PASSWORD);
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error.code).toBe('LOGIN_INVALID');
    expect((await row()).failed_login_count).toBe(1);
    const tokens = await cloud.pool.query(`SELECT 1 FROM owner_refresh_tokens WHERE user_id = $1`, [owner.user_id]);
    expect(tokens.rows).toHaveLength(1); // only the unexpired login's
  });
});
