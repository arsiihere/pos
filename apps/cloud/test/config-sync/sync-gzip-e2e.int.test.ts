import type { AddressInfo } from 'node:net';
import { canonicalJson, sha256hex } from '@pos/domain/hash';
import { DirectorySchema } from '@pos/events';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { branchConfig } from '../../../hub/src/sync/branch-config-holder';
import { httpConfigClient } from '../../../hub/src/sync/config-client';
import { configPoller } from '../../../hub/src/sync/config-poller';
import { createTestHub, type TestHub } from '../../../hub/test/helpers/test-hub';
import { createDeal } from '../helpers/menu-variants';
import { pgCounter } from '../helpers/pg-counter';
import { owner, restaurantFixture, seedMenu } from '../helpers/restaurant';
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

  it('[01a §10 #140] 5 000-item branch with a deal sold there: ≤ 34 statements with the directory ([01b B-8]; 01a v2.2 A-1 +1; 01b v1.6 B-2 +1; AD-16; 01b v1.4 B-5); gzip 200 decompresses to JSON whose hash matches; the hub poller applies it through real fetch; plain without the header; a 304 has no Content-Encoding', async () => {
    const f = await restaurantFixture(cloud);
    const menu = await seedMenu(cloud.pool, f, { items: 5_000 });
    // 01c §6.14, §6.16: one deal sold at branch A, so the builder's deal reads return rows
    const deal = await createDeal(cloud, f, {
      name: 'Family karahi deal',
      category_id: menu.categoryIds[0]!,
      tax_class_id: null,
      price_minor: 320_000,
      parts: [{ quantity: 2, choices: [{ item_id: menu.itemIds[2]! }, { item_id: menu.itemIds[3]!, extra_price_minor: 3_000 }] }],
    });
    const listed = await cloud.app.inject({ method: 'GET', url: '/v1/admin/deals', headers: owner(f).headers });
    const noRow = (listed.json().data.deals as Array<{ branches: Array<{ branch_id: string; version: string }> }>)[0]!.branches.find(
      (b) => b.branch_id === f.branches[0],
    )!.version;
    const sold = await cloud.app.inject({
      method: 'PUT',
      url: `/v1/admin/deals/${deal.deal_id}/branches/${f.branches[0]}`,
      ...owner(f),
      payload: { expected_version: noRow, is_sold: true, price_minor_override: 300_000 },
    });
    expect(sold.statusCode, sold.body).toBe(200);

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
    // 01a v1.3 §6.1: ≤ 17 for a 200 (directory v2 is 8 statements, 01b §7.3); + 9 builder statements (01c §4.5, §6.17,
    // AD-16); measured 26 after 01c task 31 (builder 16); + 1 no_pin_staff read (01b v1.4 B-5, README R32 c) → 27; + 5 builder statements (01b v1.5 B-8) → ≤ 32; + 1 zones (01a v2.2 A-1) → ≤ 33; + 1 assignments (01b v1.6 B-2) → ≤ 34
    expect(counter.count).toBeLessThanOrEqual(34);
    expect(seen[0]).toEqual({ status: 200, encoding: 'gzip', acceptEncoding: 'gzip' });
    const config = branchConfig();
    expect(config?.items).toHaveLength(5_000);
    expect(config?.deals.map((d) => [d.deal_id, d.price_minor])).toEqual([[deal.deal_id, 300_000]]);
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

  it('[01d #48] [01b B-5] 200 with the directory lists two no-PIN staff with lead_staff_id in ≤ 34 statements; directory-only ≤ 17, config-only ≤ 28, 304 unchanged [01b B-8; 01a v2.2 A-1 +1; 01b v1.6 B-2 +1]; the hub applies it and keeps the PIN holder\'s lead (B-6)', async () => {
    const f = await restaurantFixture(cloud);
    await seedMenu(cloud.pool, f);
    const branch = f.branches[0];
    const pinHolder = (
      await cloud.pool.query<{ staff_id: string }>(
        `SELECT s.staff_id FROM staff s JOIN staff_branches sb ON sb.tenant_id = s.tenant_id AND sb.staff_id = s.staff_id
          WHERE s.tenant_id = $1 AND sb.branch_id = $2 AND s.pin_hash IS NOT NULL`,
        [f.tenantId, branch],
      )
    ).rows[0]!.staff_id;
    const addNoPin = async (staffId: string, name: string, o: { active?: boolean; branchId?: string } = {}) => {
      const active = o.active ?? true;
      await cloud.pool.query(
        `INSERT INTO staff (tenant_id, staff_id, display_name, pin_hash, is_active, left_at, created_at, updated_at)
         VALUES ($1, $2, $3, NULL, $4, $5, 1, 1)`,
        [f.tenantId, staffId, name, active, active ? null : 1],
      );
      await cloud.pool.query(`INSERT INTO staff_branches (tenant_id, branch_id, staff_id) VALUES ($1, $2, $3)`, [
        f.tenantId,
        o.branchId ?? branch,
        staffId,
      ]);
    };
    await addNoPin('s-sana', 'Sana');
    await addNoPin('s-adil', 'Adil');
    await addNoPin('s-left', 'Left', { active: false }); // a leaver is not sent
    await addNoPin('s-other', 'Other', { branchId: f.branches[1] }); // another branch's no-PIN person is not sent
    await cloud.pool.query(
      `INSERT INTO staff_leads (tenant_id, branch_id, staff_id, lead_staff_id) VALUES ($1, $2, $3, 's-sana'), ($1, $2, 's-adil', $3)`,
      [f.tenantId, branch, pinHolder],
    );

    const poll = (configVersion: number, directoryVersion: number) =>
      cloud.app.inject({
        method: 'GET',
        url: `/v1/sync/config?config_version=${configVersion}&directory_version=${directoryVersion}`,
        headers: { authorization: `Bearer ${f.branchKey}` },
      });
    const both = await poll(0, 0);
    expect(both.statusCode, both.body).toBe(200);
    // 01b v1.5 §4.4 row 6 (B-8, README R32 c): ≤ 32 with the directory; + 1 zones (01a v2.2 A-1) → ≤ 33; + 1 assignments (01b v1.6 B-2) → ≤ 34
    expect(counter.count).toBeLessThanOrEqual(34);
    const directory = DirectorySchema.parse(both.json().data.directory);
    expect(directory.no_pin_staff).toEqual([
      { staff_id: 's-adil', display_name: 'Adil', lead_staff_id: pinHolder },
      { staff_id: 's-sana', display_name: 'Sana', lead_staff_id: null },
    ]);
    expect(directory.staff.map((member) => member.staff_id)).toEqual([pinHolder]);
    expect(directory.staff[0]!.lead_staff_id).toBe('s-sana');

    const configVersion = both.json().data.config.snapshot.config_version as number;
    const directoryOnly = await poll(configVersion, directory.directory_version - 1);
    expect(directoryOnly.statusCode).toBe(200);
    expect(directoryOnly.json().data.config).toBeNull();
    expect(counter.count).toBeLessThanOrEqual(17); // measured 12 (01b v1.4 B-5: 10 → 11; v1.6 B-2: 11 → 12)
    const configOnly = await poll(configVersion - 1, directory.directory_version);
    expect(configOnly.statusCode).toBe(200);
    expect(configOnly.json().data.directory).toBeNull();
    expect(counter.count).toBeLessThanOrEqual(28); // + 1 zones (01a v2.2 A-1)
    const unchanged = await poll(configVersion, directory.directory_version);
    expect(unchanged.statusCode).toBe(304);
    expect(counter.count).toBe(2);

    // B-6: the hub applies the poll and keeps the PIN holder's lead, who is in no_pin_staff
    const h = await createTestHub({
      config: {
        cloud_base_url: base,
        provisioned: { tenant_id: f.tenantId, branch_id: branch, branch_name: 'Branch A', branch_api_key: f.branchKey, confirmed_at: 1 },
      },
      configClient: httpConfigClient(base, f.branchKey),
    });
    hubs.push(h);
    expect((await configPoller(h.app).pollOnce()).outcome).toBe('applied');
    expect(h.deps.db.prepare('SELECT staff_id, lead_staff_id FROM staff').all()).toEqual([
      { staff_id: pinHolder, lead_staff_id: 's-sana' },
    ]);
    expect(h.deps.db.prepare('SELECT staff_id, display_name, lead_staff_id FROM no_pin_staff ORDER BY staff_id').all()).toEqual([
      { staff_id: 's-adil', display_name: 'Adil', lead_staff_id: pinHolder },
      { staff_id: 's-sana', display_name: 'Sana', lead_staff_id: null },
    ]);
  }, 60_000);
});
