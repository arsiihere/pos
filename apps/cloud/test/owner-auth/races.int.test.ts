import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SystemContext } from '../../src/cli/system-context';
import { seedTenant } from '../../src/cli/seed-tenant';
import { testIdGen } from '../../src/lib/ids';
import { createTestCloud, truncateAll, type TestCloud } from '../helpers/test-cloud';

const T = 1_761_000_000_000;
const PASSWORD = 'password-1';
const NEW_PASSWORD = 'a-much-better-passphrase';

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
});
