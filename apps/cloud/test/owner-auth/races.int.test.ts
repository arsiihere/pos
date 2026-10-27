import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetOwnerPassword } from '../../src/cli/reset-owner-password';
import { SystemContext } from '../../src/cli/system-context';
import { seedTenant } from '../../src/cli/seed-tenant';
import { fixedClock } from '../../src/lib/clock';
import { testIdGen, ulidGen } from '../../src/lib/ids';
import { cryptoSecrets } from '../../src/lib/secrets';
import { createTestCloud, truncateAll, type TestCloud } from '../helpers/test-cloud';

const T = 1_761_000_000_000;
const PASSWORD = 'password-1';
const NEW_PASSWORD = 'a-much-better-passphrase';
const MINUTE = 60_000;

type OwnerRowPath = 'login' | 'refresh' | 'change' | 'reset';

describe('owner-row races (01b §6.13, review 2 N1)', () => {
  let cloud: TestCloud;
  let owner: { tenant_id: string; user_id: string };
  let ip = 0;
  // Set by a test to pause the next owner-row lock taken on `pause.path`.
  let pause: { path: OwnerRowPath; reached: () => void; released: Promise<void> } | undefined;

  beforeAll(async () => {
    cloud = await createTestCloud({
      testHooks: {
        afterOwnerRowLock: async (path) => {
          if (pause === undefined || pause.path !== path) return;
          const held = pause;
          pause = undefined;
          held.reached();
          await held.released;
        },
      },
    });
    await cloud.app.ready();
  });
  afterAll(async () => {
    await truncateAll(cloud.pool);
    await cloud.close();
  });
  beforeEach(async () => {
    pause = undefined;
    cloud.clock.set(T);
    await truncateAll(cloud.pool);
    owner = await seedTenant(
      new SystemContext(cloud.pool),
      { name: 'Pilot', currency: 'PKR', ownerEmail: 'owner@example.com', ownerName: 'Ada', password: PASSWORD, pin: '1234' },
      { clock: cloud.clock, ids: testIdGen() },
    );
  });

  // Pauses the next owner-row lock on `path`; `held` resolves once it is reached, `release()` lets it go on.
  const pauseAt = (path: OwnerRowPath) => {
    let reached!: () => void;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (reached = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    pause = { path, reached, released };
    return { held, release };
  };
  // True once some backend waits on a row lock (the second transaction reached the owner row).
  const lockWaiter = async (timeoutMs = 5_000) => {
    for (let waited = 0; waited < timeoutMs; waited += 25) {
      const rows = await cloud.pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
      );
      if (Number(rows.rows[0]!.n) > 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return false;
  };

  const login = () =>
    cloud.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'owner@example.com', password: PASSWORD },
      remoteAddress: `10.4.0.${++ip % 250}`,
    });
  const refresh = (refreshToken: string) =>
    cloud.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: refreshToken } });
  const change = (token: string) =>
    cloud.app.inject({
      method: 'POST',
      url: '/v1/auth/change-password',
      headers: { authorization: `Bearer ${token}` },
      payload: { current_password: PASSWORD, new_password: NEW_PASSWORD },
      remoteAddress: `10.5.0.${++ip % 250}`,
    });
  const admin = (token: string) =>
    cloud.app.inject({ method: 'GET', url: '/v1/admin/staff', headers: { authorization: `Bearer ${token}` } });
  const tokenRows = async () =>
    Number(
      (await cloud.pool.query<{ n: string }>(`SELECT count(*) AS n FROM owner_refresh_tokens WHERE user_id = $1`, [owner.user_id]))
        .rows[0]!.n,
    );
  // The CLI in-process, its clock `skewMs` off the API's; its owner-row lock reports to the same pause as the API's.
  const reset = (skewMs = 0) => {
    const clock = fixedClock(T + skewMs);
    return resetOwnerPassword(
      new SystemContext(cloud.pool),
      { email: 'owner@example.com' },
      { clock, ids: ulidGen(clock), secrets: cryptoSecrets },
      {
        afterOwnerRowLock: async () => {
          if (pause === undefined || pause.path !== 'reset') return;
          const held = pause;
          pause = undefined;
          held.reached();
          await held.released;
        },
      },
    );
  };
  const failedCount = async () =>
    Number(
      (await cloud.pool.query<{ n: number }>(`SELECT failed_login_count AS n FROM owner_users WHERE user_id = $1`, [owner.user_id]))
        .rows[0]!.n,
    );

  it('[01b #74 a] a rotating refresh holds the owner row while change-password waits: after both commit its access token → 401 JWT_INVALID and its successor → 401 REFRESH_TOKEN_INVALID', async () => {
    const session = (await login()).json().data;
    const gate = pauseAt('refresh');
    const refreshing = refresh(session.refresh_token);
    await gate.held;
    const changing = change(session.access_token);
    expect(await lockWaiter(), 'change-password waits on the owner row').toBe(true);
    gate.release();

    const refreshed = await refreshing;
    const changed = await changing;
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    expect(changed.statusCode, changed.body).toBe(200);

    const access = await admin(refreshed.json().data.access_token);
    expect(access.statusCode).toBe(401);
    expect(access.json().error.code).toBe('JWT_INVALID');
    const successor = await refresh(refreshed.json().data.refresh_token);
    expect(successor.statusCode).toBe(401);
    expect(successor.json().error.code).toBe('REFRESH_TOKEN_INVALID');
    expect((await admin(changed.json().data.access_token)).statusCode).toBe(200);
  });

  it('[01b #74 b] change-password holds the owner row while a refresh waits: the refresh → 401 REFRESH_TOKEN_INVALID, no token issued', async () => {
    const session = (await login()).json().data;
    const gate = pauseAt('change');
    const changing = change(session.access_token);
    await gate.held;
    const refreshing = refresh(session.refresh_token);
    expect(await lockWaiter(), 'the refresh waits on the owner row').toBe(true);
    gate.release();

    const changed = await changing;
    const refreshed = await refreshing;
    expect(changed.statusCode, changed.body).toBe(200);
    expect(refreshed.statusCode).toBe(401);
    expect(refreshed.json().error.code).toBe('REFRESH_TOKEN_INVALID');
    expect(await tokenRows()).toBe(2); // the login's and change-password's; none from the refresh
  });

  describe.each([
    ['the same clock', 0],
    ['the CLI clock 5 minutes ahead', 5 * MINUTE],
    ['the CLI clock 5 minutes behind', -5 * MINUTE],
  ])('[01b #74 c] reset-owner-password with %s', (_label, skewMs) => {
    it('a rotating refresh holds the owner row while the reset waits: its access token → 401 JWT_INVALID, its successor → 401 REFRESH_TOKEN_INVALID', async () => {
      const session = (await login()).json().data;
      const gate = pauseAt('refresh');
      const refreshing = refresh(session.refresh_token);
      await gate.held;
      const resetting = reset(skewMs);
      expect(await lockWaiter(), 'the reset waits on the owner row').toBe(true);
      gate.release();

      const refreshed = await refreshing;
      await resetting;
      expect(refreshed.statusCode, refreshed.body).toBe(200);

      const access = await admin(refreshed.json().data.access_token);
      expect(access.statusCode).toBe(401);
      expect(access.json().error.code).toBe('JWT_INVALID');
      const successor = await refresh(refreshed.json().data.refresh_token);
      expect(successor.statusCode).toBe(401);
      expect(successor.json().error.code).toBe('REFRESH_TOKEN_INVALID');
    });

    it('the reset holds the owner row while a refresh waits: the refresh → 401 REFRESH_TOKEN_INVALID, no token issued', async () => {
      const session = (await login()).json().data;
      const gate = pauseAt('reset');
      const resetting = reset(skewMs);
      await gate.held;
      const refreshing = refresh(session.refresh_token);
      expect(await lockWaiter(), 'the refresh waits on the owner row').toBe(true);
      gate.release();

      await resetting;
      const refreshed = await refreshing;
      expect(refreshed.statusCode).toBe(401);
      expect(refreshed.json().error.code).toBe('REFRESH_TOKEN_INVALID');
      expect(await tokenRows()).toBe(1); // the login's, revoked by the reset; none from the refresh
    });
  });

  it('[01b #74 d] a login that verified the old password holds the owner row while a reset waits: its access token → 401 JWT_INVALID, its refresh token → 401 REFRESH_TOKEN_INVALID', async () => {
    const gate = pauseAt('login');
    const loggingIn = login();
    await gate.held;
    const resetting = reset();
    expect(await lockWaiter(), 'the reset waits on the owner row').toBe(true);
    gate.release();

    const loggedIn = await loggingIn;
    await resetting;
    expect(loggedIn.statusCode, loggedIn.body).toBe(200);

    const access = await admin(loggedIn.json().data.access_token);
    expect(access.statusCode).toBe(401);
    expect(access.json().error.code).toBe('JWT_INVALID');
    const refreshed = await refresh(loggedIn.json().data.refresh_token);
    expect(refreshed.statusCode).toBe(401);
    expect(refreshed.json().error.code).toBe('REFRESH_TOKEN_INVALID');
  });

  it('[01b #74 d] a login that verified the old password and waits behind the reset → 401 LOGIN_INVALID, no refresh token inserted, account counter unchanged', async () => {
    const gate = pauseAt('reset');
    const resetting = reset();
    await gate.held;
    const loggingIn = login();
    expect(await lockWaiter(), 'the login waits on the owner row').toBe(true);
    gate.release();

    await resetting;
    const loggedIn = await loggingIn;
    expect(loggedIn.statusCode).toBe(401);
    expect(loggedIn.json().error.code).toBe('LOGIN_INVALID');
    expect(await tokenRows()).toBe(0);
    expect(await failedCount()).toBe(0); // the reset cleared it; the refused login did not count
  });

  it('[01b #74 e] 50 interleaved runs of refresh against change-password: no deadlock (40P01)', async () => {
    const original = (
      await cloud.pool.query<{ password_hash: string }>(`SELECT password_hash FROM owner_users WHERE user_id = $1`, [owner.user_id])
    ).rows[0]!.password_hash;
    for (let run = 0; run < 50; run++) {
      await cloud.pool.query(`UPDATE owner_users SET password_hash = $2 WHERE user_id = $1`, [owner.user_id, original]);
      // the test secrets repeat every 8 tokens: drop the earlier runs' rows
      await cloud.pool.query(`DELETE FROM owner_refresh_tokens WHERE user_id = $1`, [owner.user_id]);
      const session = (await login()).json().data;
      const [refreshed, changed] =
        run % 2 === 0
          ? await Promise.all([refresh(session.refresh_token), change(session.access_token)])
          : await Promise.all([change(session.access_token), refresh(session.refresh_token)]).then(([c, r]) => [r, c] as const);
      expect(changed.statusCode, `run ${run}: ${changed.body}`).toBe(200);
      expect([200, 401], `run ${run}: ${refreshed.body}`).toContain(refreshed.statusCode);
      if (refreshed.statusCode === 401) expect(refreshed.json().error.code).toBe('REFRESH_TOKEN_INVALID');
      expect(`${refreshed.body}${changed.body}`).not.toContain('40P01');
    }
  }, 120_000);
});
