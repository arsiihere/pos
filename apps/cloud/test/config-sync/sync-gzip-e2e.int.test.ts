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

// ⚠️ 08b m-15 (01a S48 b: "about 300 KB on the wire" at 5 000 items): the gzip 200 with the inventory key.
const GZIP_BOUND_BYTES = 300_000;
const DAY = 86_400_000;

// ⚠️ 08b m-15: 200 stock items (ingredients in g), each with a manual price and 30 days of daily market rates
// (each rate dominates the one before it), and 300 recipes on the first 300 menu items, each with 4 versions
// (1 published + 3 superseded) of 5 lines. Raw SQL: only the volume matters here.
async function seedInventoryKey(cloud: TestCloud, f: Awaited<ReturnType<typeof restaurantFixture>>): Promise<void> {
  const now = cloud.clock.branchNow();
  const q = (text: string, params: unknown[] = []) => cloud.pool.query(text, [f.tenantId, ...params]);
  await q(
    `INSERT INTO stock_items (tenant_id, stock_item_id, name, stock_unit, kind, carries_over, created_at, updated_at)
     SELECT $1, 'SK-INV-' || lpad(i::text, 3, '0'), 'Ingredient ' || i, 'g', 'ingredient', false, $2, $2 FROM generate_series(0, 199) i`,
    [now],
  );
  await q(
    `INSERT INTO item_prices (tenant_id, price_id, stock_item_id, branch_id, kind, unit_name, price_minor, stock_qty_num, stock_qty_den,
       stock_unit, created_at, valid_until_at, note, recorded_by)
     SELECT $1, 'PR-INV-' || lpad(i::text, 3, '0') || '-' || lpad(d::text, 2, '0'), 'SK-INV-' || lpad(i::text, 3, '0'), NULL,
            CASE WHEN d = 0 THEN 'manual' ELSE 'market_rate' END, 'kg', 100000 + i * 10 + d, 1000, 1, 'g',
            $2::bigint - (31 - d) * $3::bigint, CASE WHEN d = 0 THEN NULL ELSE $2::bigint - (30 - d) * $3::bigint END, NULL, $4
       FROM generate_series(0, 199) i, generate_series(0, 30) d`,
    [now, DAY, f.userId],
  );
  await q(
    `INSERT INTO recipes (tenant_id, recipe_id, owner_type, owner_id, created_at, updated_at)
     SELECT $1, 'RC-' || lpad(r::text, 4, '0'), 'menu_item', 'IT-' || lpad(r::text, 4, '0'), $2, $2 FROM generate_series(0, 299) r`,
    [now],
  );
  await q(
    `INSERT INTO recipe_versions (tenant_id, recipe_version_id, recipe_id, version_no, status, basis, misc_allowance_bp,
       created_by, created_at, updated_at, published_by, published_at)
     SELECT $1, 'RV-' || lpad(r::text, 4, '0') || '-' || n, 'RC-' || lpad(r::text, 4, '0'), n,
            CASE WHEN n = 4 THEN 'published' ELSE 'superseded' END, 'per_unit', 500, $3, $2, $2, $3, $2::bigint - (4 - n) * $4::bigint
       FROM generate_series(0, 299) r, generate_series(1, 4) n`,
    [now, f.userId, DAY],
  );
  await q(
    `INSERT INTO recipe_lines (tenant_id, recipe_version_id, line_no, stock_item_id, unit_name, entered_num, entered_den,
       stock_qty_num, stock_qty_den, stock_unit, qty_basis)
     SELECT $1, 'RV-' || lpad(r::text, 4, '0') || '-' || n, l, 'SK-INV-' || lpad(((r * 5 + l) % 200)::text, 3, '0'), 'g',
            100 + l, 1, 100 + l, 1, 'g', 'AP'
       FROM generate_series(0, 299) r, generate_series(1, 4) n, generate_series(1, 5) l`,
  );
}

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

  it('[01a §10 #140] [08b #25 ⚠️ A-4, m-15] 5 000-item branch with a deal sold there and an inventory key: ≤ 40 statements with the directory, gzip within S48\'s size ([01b B-8]; 01a v2.2 A-1 +1; 01b v1.6 B-2 +1; AD-16; 01b v1.4 B-5); gzip 200 decompresses to JSON whose hash matches; the hub poller applies it through real fetch; plain without the header; a 304 has no Content-Encoding', async () => {
    const f = await restaurantFixture(cloud);
    const menu = await seedMenu(cloud.pool, f, { items: 5_000 });
    await seedInventoryKey(cloud, f); // ⚠️ 08b m-15 (A-4): the snapshot carries an inventory key of pilot-plus size
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
    expect(counter.count).toBeLessThanOrEqual(40); // + 1 billing (05 row A-1 (5)); ⚠️ 08b A-4, B-x: + 5 inventory key reads
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

    // ⚠️ 08b m-15 (test 25): the key is in the applied body (dominance keeps 2 prices per item: the manual and the
    // newest daily rate), and the gzip 200 stays within S48's wire size
    const inventory = (JSON.parse(stored.body) as { inventory: { items: unknown[]; prices: unknown[]; recipes: unknown[] } }).inventory;
    expect(inventory.items.length).toBeGreaterThanOrEqual(200);
    expect(inventory.prices).toHaveLength(400);
    expect(inventory.recipes).toHaveLength(1_200);
    const zipped = await cloud.app.inject({
      method: 'GET',
      url: '/v1/sync/config?config_version=0&directory_version=0',
      headers: { authorization: `Bearer ${f.branchKey}`, 'accept-encoding': 'gzip' },
    });
    expect(zipped.headers['content-encoding']).toBe('gzip');
    expect(zipped.rawPayload.length).toBeLessThanOrEqual(GZIP_BOUND_BYTES);
  }, 120_000);

  it('[01d #48] [01b B-5] 200 with the directory lists two no-PIN staff with lead_staff_id in ≤ 40 statements; directory-only ≤ 17, config-only ≤ 33, 304 unchanged [01b B-8; 01a v2.2 A-1 +1; 01b v1.6 B-2 +1; ⚠️ 08b A-4, B-x]; the hub applies it and keeps the PIN holder\'s lead (B-6)', async () => {
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
    expect(counter.count).toBeLessThanOrEqual(40); // + 1 billing (05 row A-1 (5)); ⚠️ 08b A-4, B-x: + 5 inventory key reads
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
    expect(counter.count).toBeLessThanOrEqual(33); // + 1 zones (01a v2.2 A-1); ⚠️ 08b A-4: + 5 inventory key reads
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
