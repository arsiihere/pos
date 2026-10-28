import { gunzipSync } from 'node:zlib';
import { canonicalJson, sha256hex } from '@pos/domain/hash';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { restaurantFixture, seedMenu, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

describe('GET /v1/sync/config gzip (S48)', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;

  beforeAll(async () => {
    cloud = await createTestCloud();
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    f = await restaurantFixture(cloud);
    await seedMenu(cloud.pool, f, {});
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
  const poll = (configVersion: number, directoryVersion: number, headers: Record<string, string> = {}) =>
    cloud.app.inject({
      method: 'GET',
      url: `/v1/sync/config?config_version=${configVersion}&directory_version=${directoryVersion}`,
      headers: { authorization: `Bearer ${f.branchKey}`, ...headers },
    });

  it('[01a S48] with Accept-Encoding gzip the 200 has content-encoding gzip and gunzips to exactly the plain body; its hash matches snapshot_hash', async () => {
    const v = await versions();
    const zipped = await poll(0, v.directory, { 'accept-encoding': 'gzip, deflate' });
    expect(zipped.statusCode).toBe(200);
    expect(zipped.headers['content-encoding']).toBe('gzip');
    expect(zipped.headers['content-type']).toBe('application/json; charset=utf-8');
    const text = gunzipSync(zipped.rawPayload).toString('utf8');

    const plain = await poll(0, v.directory);
    expect(text).toBe(plain.body);

    const data = (JSON.parse(text) as { data: { config: { snapshot_hash: string; snapshot: unknown } } }).data;
    expect(sha256hex(canonicalJson(data.config.snapshot))).toBe(data.config.snapshot_hash);
  });

  it('[01a S48] without Accept-Encoding the body is plain JSON; a 304 has no content-encoding', async () => {
    const v = await versions();
    const plain = await poll(0, v.directory);
    expect(plain.statusCode).toBe(200);
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(plain.json().data.config.snapshot.config_version).toBe(v.config);

    const notModified = await poll(v.config, v.directory, { 'accept-encoding': 'gzip' });
    expect(notModified.statusCode).toBe(304);
    expect(notModified.headers['content-encoding']).toBeUndefined();
    expect(notModified.body).toBe('');
  });

  it('[01a S48] gzip;q=0 is a refusal → plain body; both 200 paths carry vary: accept-encoding', async () => {
    const v = await versions();
    for (const acceptEncoding of ['gzip;q=0', 'GZIP ; q=0.0, deflate']) {
      const refused = await poll(0, v.directory, { 'accept-encoding': acceptEncoding });
      expect(refused.statusCode).toBe(200);
      expect(refused.headers['content-encoding']).toBeUndefined();
      expect(refused.headers.vary).toBe('accept-encoding');
      expect(refused.json().data.config.snapshot.config_version).toBe(v.config);
    }
    const zipped = await poll(0, v.directory, { 'accept-encoding': 'deflate, gzip;q=0.5' });
    expect(zipped.headers['content-encoding']).toBe('gzip');
    expect(zipped.headers.vary).toBe('accept-encoding');
  });
});
