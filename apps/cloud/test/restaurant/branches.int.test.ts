import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pgCounter } from '../helpers/pg-counter';
import { restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

describe('branch list (§6.7b, S58)', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let counter: ReturnType<typeof pgCounter>;

  beforeAll(async () => {
    cloud = await createTestCloud({ captureLogs: true, testHooks: { handlerStart: () => counter.reset() } });
    counter = pgCounter(cloud.pool);
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    f = await restaurantFixture(cloud);
  });

  const list = (token?: string) =>
    cloud.app.inject({
      method: 'GET',
      url: '/v1/admin/branches',
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    });

  it('[01a §10 #176] GET /v1/admin/branches → the allowed branches with name and status, by name; another tenant never; 1 statement', async () => {
    const [a, , c] = f.branches;
    // Rename so the order by name differs from the order by id.
    // A is also confirmed, so both statuses show.
    await cloud.pool.query(
      `UPDATE branches SET name = 'Zeta Gulberg', status = 'active', hub_confirmed_at = 1 WHERE branch_id = $1`,
      [a],
    );
    await cloud.pool.query(`UPDATE branches SET name = 'Alpha Johar Town' WHERE branch_id = $1`, [c]);

    await cloud.pool.query('UPDATE branches SET business_day_end_local_ms = 12600000 WHERE branch_id = $1', [a]);
    await cloud.pool.query('UPDATE branch_engine_settings SET takeaway_slip_on_send = false WHERE branch_id = $1', [a]);

    const response = await list(f.tokenFor([a, c, f.other.branchId]));
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      data: {
        // 01a #217–218 / 01b #116–117: branch-specific values and defaults ride the existing list read.
        branches: [
          { branch_id: c, name: 'Alpha Johar Town', status: 'pending_hub', hub_last_seen_at: null, hub_synced_at: null, business_day_end_local_ms: 14_400_000, takeaway_slip_on_send: true },
          { branch_id: a, name: 'Zeta Gulberg', status: 'active', hub_last_seen_at: null, hub_synced_at: null, business_day_end_local_ms: 12_600_000, takeaway_slip_on_send: false },
        ],
        hub_stale_after_ms: 180_000,
      },
    });
    expect(counter.count).toBe(1);
  });

  it('[01a §10 #177] no or bad JWT → 401 JWT_INVALID; only unknown allowed ids → an empty list', async () => {
    for (const token of [undefined, 'not-a-jwt']) {
      const response = await list(token);
      expect(response.statusCode).toBe(401);
      expect(response.json().error).toMatchObject({ code: 'JWT_INVALID' });
    }
    const empty = await list(f.tokenFor(['NO-SUCH-BRANCH']));
    expect(empty.statusCode, empty.body).toBe(200);
    expect(empty.json()).toEqual({ data: { branches: [], hub_stale_after_ms: 180_000 } });
  });
});
