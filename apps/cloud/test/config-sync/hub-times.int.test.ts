import { CONFIG_POLL_INTERVAL_MS } from '@pos/events';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pgCounter } from '../helpers/pg-counter';
import { restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

describe('hub check-in and up-to-date times (01b B19, D-11, 01a §6.1 step 6, §6.7b)', () => {
  let cloud: TestCloud;
  let counter: ReturnType<typeof pgCounter>;
  let f: RestaurantFixture;

  beforeAll(async () => {
    cloud = await createTestCloud({ testHooks: { handlerStart: () => counter.reset() } });
    counter = pgCounter(cloud.pool);
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    f = await restaurantFixture(cloud);
  });

  const versions = async () => {
    const row = (
      await cloud.pool.query<{ config_version: string; directory_version: string }>(
        `SELECT b.config_version, t.directory_version FROM branches b JOIN tenants t ON t.tenant_id = b.tenant_id
          WHERE b.branch_id = $1`,
        [f.branches[0]],
      )
    ).rows[0]!;
    return { config: Number(row.config_version), directory: Number(row.directory_version) };
  };
  const poll = (configVersion: number, directoryVersion: number) =>
    cloud.app.inject({
      method: 'GET',
      url: `/v1/sync/config?config_version=${configVersion}&directory_version=${directoryVersion}`,
      headers: { authorization: `Bearer ${f.branchKey}` },
    });
  const times = async (branchId: string) => {
    const row = (
      await cloud.pool.query<{ hub_last_seen_at: string | null; hub_synced_at: string | null }>(
        'SELECT hub_last_seen_at, hub_synced_at FROM branches WHERE branch_id = $1',
        [branchId],
      )
    ).rows[0]!;
    return {
      hub_last_seen_at: row.hub_last_seen_at === null ? null : Number(row.hub_last_seen_at),
      hub_synced_at: row.hub_synced_at === null ? null : Number(row.hub_synced_at),
    };
  };
  const list = () =>
    cloud.app.inject({ method: 'GET', url: '/v1/admin/branches', headers: { authorization: `Bearer ${f.token}` } });

  it('[01b #67] the poll sets hub_last_seen_at on 304 and 200, hub_synced_at on 304 only; a hub stuck on an old config_version moves only hub_last_seen_at; GET /v1/admin/branches returns both; [01b B-8] query counts 2, ≤ 27 config only and ≤ 17 directory only', async () => {
    const [a, b] = f.branches;
    const t0 = 1_761_000_100_000; // within the owner token's hour
    expect(await times(a)).toEqual({ hub_last_seen_at: null, hub_synced_at: null });

    // 304: both times, 2 statements.
    cloud.clock.set(t0);
    const v = await versions();
    const current = await poll(v.config, v.directory);
    expect(current.statusCode).toBe(304);
    expect(counter.count).toBe(2);
    expect(await times(a)).toEqual({ hub_last_seen_at: t0, hub_synced_at: t0 });

    // A hub that keeps reporting an old config_version: 200 each time, only hub_last_seen_at moves.
    for (const at of [t0 + 60_000, t0 + 120_000]) {
      cloud.clock.set(at);
      const stuck = await poll(v.config - 1, v.directory);
      expect(stuck.statusCode).toBe(200);
      // Config only (the directory is current): AD-16's config-only bound, ≤ 27 (01b v1.5 B-8); + 1 zones (01a v2.2 A-1) → ≤ 28.
      expect(counter.count).toBeLessThanOrEqual(28);
      expect(await times(a)).toEqual({ hub_last_seen_at: at, hub_synced_at: t0 });
    }
    // A directory behind is also a 200.
    cloud.clock.set(t0 + 180_000);
    expect((await poll(v.config, v.directory - 1)).statusCode).toBe(200);
    expect(counter.count).toBeLessThanOrEqual(17);
    expect(await times(a)).toEqual({ hub_last_seen_at: t0 + 180_000, hub_synced_at: t0 });

    // The other branches are untouched.
    expect(await times(b)).toEqual({ hub_last_seen_at: null, hub_synced_at: null });

    // The branches list returns both; 1 statement.
    const response = await list();
    expect(response.statusCode, response.body).toBe(200);
    expect(counter.count).toBe(1);
    const rows = response.json().data.branches as Array<{ branch_id: string; hub_last_seen_at: number | null; hub_synced_at: number | null }>;
    expect(rows.find((row) => row.branch_id === a)).toMatchObject({ hub_last_seen_at: t0 + 180_000, hub_synced_at: t0 });
    expect(rows.find((row) => row.branch_id === b)).toMatchObject({ hub_last_seen_at: null, hub_synced_at: null });
  });

  it('[01b #92] GET /v1/admin/branches returns hub_stale_after_ms = 3 × CONFIG_POLL_INTERVAL_MS', async () => {
    const response = await list();
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data.hub_stale_after_ms).toBe(3 * CONFIG_POLL_INTERVAL_MS);
    expect(counter.count).toBe(1);
  });
});
