import type { AddressInfo } from 'node:net';
import { canonicalJson, sha256hex } from '@pos/domain/hash';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { branchConfig } from '../../../hub/src/sync/branch-config-holder';
import { httpConfigClient } from '../../../hub/src/sync/config-client';
import { configPoller } from '../../../hub/src/sync/config-poller';
import { createTestHub, type TestHub } from '../../../hub/test/helpers/test-hub';
import { pgCounter } from '../helpers/pg-counter';
import { restaurantFixture, seedMenu } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const realFetch = globalThis.fetch;

describe('config sync end to end (S48)', () => {
  let cloud: TestCloud;
  let counter: ReturnType<typeof pgCounter>;
  let base: string;
  const hubs: TestHub[] = [];

  beforeAll(async () => {
    cloud = await createTestCloud({ testHooks: { handlerStart: () => counter.reset() } });
    counter = pgCounter(cloud.pool);
    await cloud.app.listen({ host: '127.0.0.1', port: 0 });
    base = `http://127.0.0.1:${(cloud.app.server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await cloud.close();
  });
  afterEach(async () => {
    globalThis.fetch = realFetch;
    for (const h of hubs.splice(0)) await h.close();
  });

  it('[01a §10 #140] 5 000-item branch: ≤ 13 statements; gzip 200 decompresses to JSON whose hash matches; the hub poller applies it through real fetch; plain without the header; a 304 has no Content-Encoding', async () => {
    const f = await restaurantFixture(cloud);
    await seedMenu(cloud.pool, f, { items: 5_000 });

    const seen: Array<{ status: number; encoding: string | null; acceptEncoding: string | null }> = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const response = await realFetch(input, init);
      seen.push({
        status: response.status,
        encoding: response.headers.get('content-encoding'),
        acceptEncoding: new Headers(init?.headers).get('accept-encoding'),
      });
      return response;
    }) as typeof fetch;

    const h = await createTestHub({
      config: {
        cloud_base_url: base,
        provisioned: { tenant_id: f.tenantId, branch_id: f.branches[0], branch_name: 'Branch A', branch_api_key: f.branchKey, confirmed_at: 1 },
      },
      configClient: httpConfigClient(base, f.branchKey),
    });
    hubs.push(h);
    const poller = configPoller(h.app);

    const applied = await poller.pollOnce();
    expect(applied.outcome).toBe('applied');
    // 01a v1.3 §6.1: ≤ 17 for a 200 (directory v2 is 8 statements, 01b §7.3)
    expect(counter.count).toBeLessThanOrEqual(17);
    expect(seen[0]).toEqual({ status: 200, encoding: 'gzip', acceptEncoding: 'gzip' });
    const config = branchConfig();
    expect(config?.items).toHaveLength(5_000);
    const stored = h.deps.db.prepare('SELECT snapshot_hash, body FROM config_snapshots').get() as { snapshot_hash: string; body: string };
    expect(sha256hex(stored.body)).toBe(stored.snapshot_hash);

    const unchanged = await poller.pollOnce();
    expect(unchanged.outcome).toBe('unchanged');
    expect(seen[1]).toEqual({ status: 304, encoding: null, acceptEncoding: 'gzip' });

    globalThis.fetch = realFetch;
    const plain = await realFetch(`${base}/v1/sync/config?config_version=0&directory_version=0`, {
      headers: { authorization: `Bearer ${f.branchKey}`, 'accept-encoding': 'identity' },
    });
    expect(plain.status).toBe(200);
    expect(plain.headers.get('content-encoding')).toBeNull();
    const data = ((await plain.json()) as { data: { config: { snapshot_hash: string; snapshot: unknown } } }).data;
    expect(sha256hex(canonicalJson(data.config.snapshot))).toBe(data.config.snapshot_hash);
    expect(data.config.snapshot_hash).toBe(stored.snapshot_hash);
  }, 120_000);
});
