import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SystemContext } from '../../src/cli/system-context';
import { seedTenant } from '../../src/cli/seed-tenant';
import { testIdGen } from '../../src/lib/ids';
import { createTestCloud, truncateAll, type TestCloud } from '../helpers/test-cloud';

const T = 1_761_000_000_000;
const PASSWORD = 'password-1';

describe('refresh: owner-row lock, credential version and lockout notice (01b §6.13)', () => {
  let cloud: TestCloud;
  let owner: { tenant_id: string; user_id: string };
  let ip = 0;

  beforeAll(async () => {
    cloud = await createTestCloud();
    await cloud.app.ready();
  });
  afterAll(async () => {
    await truncateAll(cloud.pool);
    await cloud.close();
  });
  beforeEach(async () => {
    cloud.clock.set(T);
    await truncateAll(cloud.pool);
    owner = await seedTenant(
      new SystemContext(cloud.pool),
      { name: 'Pilot', currency: 'PKR', ownerEmail: 'owner@example.com', ownerName: 'Ada', password: PASSWORD, pin: '1234' },
      { clock: cloud.clock, ids: testIdGen() },
    );
  });

  const login = (password = PASSWORD) =>
    cloud.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'owner@example.com', password },
      remoteAddress: `10.1.0.${++ip % 250}`,
    });
  const refresh = (refreshToken: string) =>
    cloud.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: refreshToken } });
  const admin = (token: string) =>
    cloud.app.inject({ method: 'GET', url: '/v1/admin/branches', headers: { authorization: `Bearer ${token}` } });
  const noticeAt = async () =>
    (await cloud.pool.query(`SELECT lock_notice_at FROM owner_users WHERE user_id = $1`, [owner.user_id])).rows[0].lock_notice_at as
      | string
      | null;

  it('[01b #42] refresh while must_change_password is set → 200 with user.must_change_password true; /v1/admin/* with the new token is still 403', async () => {
    const first = (await login()).json().data;
    await cloud.pool.query(`UPDATE owner_users SET must_change_password = true WHERE user_id = $1`, [owner.user_id]);
    const refreshed = await refresh(first.refresh_token);
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().data.user.must_change_password).toBe(true);
    const blocked = await admin(refreshed.json().data.access_token);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    await cloud.pool.query(`UPDATE owner_users SET must_change_password = false WHERE user_id = $1`, [owner.user_id]);
    expect((await admin(refreshed.json().data.access_token)).statusCode).toBe(200); // read from the row, not the token
  });

  it('[01b #81] after a lock, the next rotating refresh returns lockout_notice and clears it; the following refresh and the next login return null; a grace refresh returns null and clears nothing', async () => {
    const first = (await login()).json().data;
    const lockedAt = T + 1_000;
    cloud.clock.set(lockedAt);
    for (let i = 0; i < 10; i += 1) expect((await login('wrong-password')).statusCode).toBe(401);

    const rotated = await refresh(first.refresh_token);
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json().data.lockout_notice).toEqual({ locked_at: lockedAt, failed_count: 10 });
    expect(await noticeAt()).toBeNull();
    const following = await refresh(rotated.json().data.refresh_token);
    expect(following.json().data.lockout_notice).toBeNull();

    cloud.clock.set(lockedAt + 900_001);
    const next = await login();
    expect(next.statusCode).toBe(200);
    expect(next.json().data.lockout_notice).toBeNull();

    const fresh = await refresh(next.json().data.refresh_token);
    expect(fresh.statusCode).toBe(200);
    await cloud.pool.query(`UPDATE owner_users SET lock_notice_at = $2 WHERE user_id = $1`, [owner.user_id, lockedAt]);
    cloud.clock.set(lockedAt + 900_001 + 10_000);
    const grace = await refresh(next.json().data.refresh_token); // already rotated, inside 30 s (M49)
    expect(grace.statusCode).toBe(200);
    expect(grace.json().data.refresh_token).toBe(fresh.json().data.refresh_token);
    expect(grace.json().data.lockout_notice).toBeNull();
    expect(Number(await noticeAt())).toBe(lockedAt);
  });

  it('[01b §6.13] after credential_version + 1, the old access token → 401 JWT_INVALID and its refresh token → 401 REFRESH_TOKEN_INVALID, nothing revoked', async () => {
    const old = (await login()).json().data;
    await cloud.pool.query(`UPDATE owner_users SET credential_version = credential_version + 1 WHERE user_id = $1`, [owner.user_id]);
    const access = await admin(old.access_token);
    expect(access.statusCode).toBe(401);
    expect(access.json().error.code).toBe('JWT_INVALID');
    const refused = await refresh(old.refresh_token);
    expect(refused.statusCode).toBe(401);
    expect(refused.json().error.code).toBe('REFRESH_TOKEN_INVALID');
    const tokens = await cloud.pool.query(`SELECT revoked_at, rotated_at FROM owner_refresh_tokens WHERE user_id = $1`, [owner.user_id]);
    expect(tokens.rows).toEqual([{ revoked_at: null, rotated_at: null }]);

    const fresh = (await login()).json().data;
    const ok = await refresh(fresh.refresh_token);
    expect(ok.statusCode).toBe(200);
    expect(cloud.app.jwt.verify(ok.json().data.access_token).cv).toBe(1);
  });

  it('[01b §6.13] refresh takes the owner row FOR NO KEY UPDATE before its token row FOR UPDATE', async () => {
    const first = (await login()).json().data;
    const hold = await cloud.pool.connect();
    try {
      await hold.query('BEGIN');
      await hold.query(`SELECT 1 FROM owner_users WHERE user_id = $1 FOR NO KEY UPDATE`, [owner.user_id]);
      let settled = false;
      const pending = refresh(first.refresh_token).finally(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false); // waiting on the owner row …
      const tokenLock = await hold.query(
        `SELECT 1 FROM owner_refresh_tokens WHERE user_id = $1 FOR UPDATE NOWAIT`,
        [owner.user_id],
      ); // … without holding the token row
      expect(tokenLock.rows).toHaveLength(1);
      await hold.query('ROLLBACK');
      expect((await pending).statusCode).toBe(200);
    } finally {
      hold.release();
    }
  });
});
