import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SystemContext } from '../../src/cli/system-context';
import { seedTenant } from '../../src/cli/seed-tenant';
import { testIdGen } from '../../src/lib/ids';
import { createTestCloud, truncateAll, type TestCloud } from '../helpers/test-cloud';

const T = 1_761_000_000_000;
const PASSWORD = 'password-1';
const RUNS = 50;

describe('no deadlock on the owner row (01b §6.13, review 2 N2)', () => {
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

  const login = () =>
    cloud.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'owner@example.com', password: PASSWORD },
      remoteAddress: `10.6.0.${++ip % 250}`,
    });
  const refresh = (refreshToken: string) =>
    cloud.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: refreshToken } });
  // The test secrets repeat every 8 tokens: each run starts with no token rows.
  const freshRun = async (set: string) => {
    await cloud.pool.query(`DELETE FROM owner_refresh_tokens WHERE user_id = $1`, [owner.user_id]);
    await cloud.pool.query(`UPDATE owner_users SET ${set} WHERE user_id = $1`, [owner.user_id]);
  };
  const ownerRow = async () =>
    (
      await cloud.pool.query<{ failed_login_count: number; lock_notice_at: string | null }>(
        `SELECT failed_login_count, lock_notice_at FROM owner_users WHERE user_id = $1`,
        [owner.user_id],
      )
    ).rows[0]!;
  const noDeadlock = (run: number, ...bodies: string[]) => {
    for (const body of bodies) expect(body, `run ${run}`).not.toContain('40P01');
  };

  it('[01b #98] two logins released together: both 200, the counter reset, no 40P01 (50 runs)', async () => {
    for (let run = 0; run < RUNS; run++) {
      await freshRun('failed_login_count = 3');
      const [a, b] = await Promise.all([login(), login()]);
      noDeadlock(run, a.body, b.body);
      expect(a.statusCode, `run ${run}: ${a.body}`).toBe(200);
      expect(b.statusCode, `run ${run}: ${b.body}`).toBe(200);
      expect((await ownerRow()).failed_login_count).toBe(0);
    }
  }, 120_000);

  it('[01b #98] two rotating refreshes of two tokens released together with lock_notice_at set: both 200, exactly one lockout_notice, no 40P01 (50 runs)', async () => {
    for (let run = 0; run < RUNS; run++) {
      await freshRun('lock_notice_at = NULL');
      const first = (await login()).json().data;
      const second = (await login()).json().data;
      await cloud.pool.query(`UPDATE owner_users SET lock_notice_at = $2 WHERE user_id = $1`, [owner.user_id, T - 1_000]);
      const [a, b] = await Promise.all([refresh(first.refresh_token), refresh(second.refresh_token)]);
      noDeadlock(run, a.body, b.body);
      expect(a.statusCode, `run ${run}: ${a.body}`).toBe(200);
      expect(b.statusCode, `run ${run}: ${b.body}`).toBe(200);
      const notices = [a, b].filter((r) => r.json().data.lockout_notice !== null);
      expect(notices, `run ${run}`).toHaveLength(1);
      expect((await ownerRow()).lock_notice_at).toBeNull();
    }
  }, 120_000);

  it('[01b #98] a login and a rotating refresh released together: both 200, no 40P01 (50 runs)', async () => {
    for (let run = 0; run < RUNS; run++) {
      await freshRun('failed_login_count = 0');
      const session = (await login()).json().data;
      const [a, b] = await Promise.all([login(), refresh(session.refresh_token)]);
      noDeadlock(run, a.body, b.body);
      expect(a.statusCode, `run ${run}: ${a.body}`).toBe(200);
      expect(b.statusCode, `run ${run}: ${b.body}`).toBe(200);
    }
  }, 120_000);
});
