import { canonicalJson, sha256hex } from '@pos/domain/hash';
import { BranchConfigSnapshotSchemaV1 } from '@pos/events';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadDirectory } from '../../src/modules/hub-registration/repository';
import { pgCounter } from '../helpers/pg-counter';
import { restaurantFixture, seedMenu, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

describe('GET /v1/sync/config', () => {
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
    await seedMenu(cloud.pool, f, { archived: true });
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
  const poll = (configVersion: number, directoryVersion: number, key = f.branchKey) =>
    cloud.app.inject({
      method: 'GET',
      url: `/v1/sync/config?config_version=${configVersion}&directory_version=${directoryVersion}`,
      headers: { authorization: `Bearer ${key}` },
    });

  it('[01a §10 #1] both versions equal → 304, empty body, exactly 1 statement after the key lookup', async () => {
    const v = await versions();
    const response = await poll(v.config, v.directory);
    expect(response.statusCode).toBe(304);
    expect(response.body).toBe('');
    // v1.3 (01b B19): plus step (6), the hub-times UPDATE → 2.
    expect(counter.count).toBe(2);
  });

  it('[01a §10 #2] config_version behind → 200, the snapshot parses, snapshot_hash is its canonical sha256, directory null', async () => {
    const v = await versions();
    const response = await poll(v.config - 1, v.directory);
    expect(response.statusCode).toBe(200);
    expect(counter.count).toBeLessThanOrEqual(13);
    const data = response.json().data;
    expect(data.directory).toBeNull();
    const snapshot = BranchConfigSnapshotSchemaV1.parse(data.config.snapshot);
    expect(snapshot).toMatchObject({ config_version: v.config, branch_id: f.branches[0], currency_code: 'PKR' });
    expect(data.config.snapshot_hash).toBe(sha256hex(canonicalJson(data.config.snapshot)));

    // a version ahead of the cloud's (after a restore) also gets a 200; the hub decides (§3.4)
    const ahead = await poll(v.config + 5, v.directory);
    expect(ahead.statusCode).toBe(200);
    expect(ahead.json().data.config.snapshot.config_version).toBe(v.config);
  });

  it('[01a §10 #3] directory_version behind only → config null, directory equals loadDirectory', async () => {
    const v = await versions();
    const response = await poll(v.config, v.directory - 1);
    expect(response.statusCode).toBe(200);
    // 01a v1.3 §6.1: ≤ 17 for a 200 (directory v2 is 8 statements, 01b §7.3)
    expect(counter.count).toBeLessThanOrEqual(17);
    const data = response.json().data;
    expect(data.config).toBeNull();
    const client = await cloud.pool.connect();
    try {
      const loaded = await loadDirectory(client, f.tenantId, f.branches[0]);
      expect(data.directory).toEqual(JSON.parse(JSON.stringify(loaded.directory)));
    } finally {
      client.release();
    }
  });

  it('[01a §10 #6] unknown or revoked branch key → 401 BRANCH_API_KEY_INVALID', async () => {
    const unknown = await poll(0, 0, 'not-a-real-key');
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().error.code).toBe('BRANCH_API_KEY_INVALID');

    await cloud.pool.query(`UPDATE branch_api_keys SET revoked_at = 1 WHERE tenant_id = $1`, [f.tenantId]);
    const revoked = await poll(0, 0);
    expect(revoked.statusCode).toBe(401);
    expect(revoked.json().error.code).toBe('BRANCH_API_KEY_INVALID');
  });

  it('[01a §6.1] a negative or missing version → 400 VALIDATION_FAILED', async () => {
    const negative = await poll(-1, 0);
    expect(negative.statusCode).toBe(400);
    expect(negative.json().error.code).toBe('VALIDATION_FAILED');
    const missing = await cloud.app.inject({
      method: 'GET',
      url: '/v1/sync/config?config_version=1',
      headers: { authorization: `Bearer ${f.branchKey}` },
    });
    expect(missing.statusCode).toBe(400);
  });

  it('[01a §10 #114] wire hash: the hub-style hash over the response text equals snapshot_hash; undefined throws', async () => {
    const v = await versions();
    const response = await poll(0, v.directory);
    expect(response.statusCode).toBe(200);
    const received = JSON.parse(response.body) as { data: { config: { snapshot_hash: string; snapshot: unknown } } };
    const hubHash = sha256hex(canonicalJson(BranchConfigSnapshotSchemaV1.parse(received.data.config.snapshot)));
    expect(hubHash).toBe(received.data.config.snapshot_hash);

    // an optional field undefined on one row: canonicalJson throws, so the hash can only be taken over the wire.
    // The "hub applies it" clause lands with tasks 39–40 as [01a §10 #114 hub part].
    const parsed = { items: [{ item_id: 'a', note: undefined }, { item_id: 'b', note: 'x' }] };
    expect(() => canonicalJson(parsed)).toThrow();
    expect(() => canonicalJson({ a: undefined })).toThrow();
    expect(() => canonicalJson([undefined])).toThrow();
  });
});
