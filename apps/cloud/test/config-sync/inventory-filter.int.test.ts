import { canonicalJson, sha256hex } from "@pos/domain/hash";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildSnapshot,
  type SnapshotHeader,
} from "../../src/modules/config-sync/builder";
import { pgCounter } from "../helpers/pg-counter";
import {
  owner,
  restaurantFixture,
  seedMenu,
  type RestaurantFixture,
} from "../helpers/restaurant";
import { createTestCloud, type TestCloud } from "../helpers/test-cloud";

// 08a §3.1 I9, §4.5 C-6 (01c §4.6 rule 4): the snapshot's stock_items[] holds only kind = 'prepared' stock items.
const HEADER: SnapshotHeader = {
  config_version: 42,
  currency_code: "PKR",
  tax_enabled: false,
  day_stale_after_hours: 16,
  day_min_gap_hours: 4,
  business_day_end_local_ms: 14_400_000,
};
const STOCK_ITEM_KEYS = [
  "carries_over",
  "low_stock_threshold",
  "name",
  "station_id",
  "stock_item_id",
  "stock_unit",
];
// The top-level snapshot keys (schema 4; 08a adds none, §2 / §4.3; ⚠️ 08b P-1, A-3: + the inventory key).
const SNAPSHOT_KEYS = [
  "branch_id",
  "business_day_end_local_ms",
  "categories",
  "config_version",
  "currency_code",
  "day_min_gap_hours",
  "day_stale_after_hours",
  "deals",
  "engine_settings",
  "floors",
  "goes_with",
  "inventory",
  "items",
  "modifier_groups",
  "points",
  "snapshot_schema_version",
  "stations",
  "stock_items",
  "tax_classes",
  "tax_enabled",
  "variant_groups",
];

describe("[08a C-6, I9] builder lists only prepared stock items", () => {
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
    await seedMenu(cloud.pool, f, { archived: true });
  });

  const tenant = () =>
    Object.freeze({
      tenantId: f.tenantId,
      branchIds: Object.freeze([...f.branches]),
    });
  const sql = (text: string, params: unknown[] = []) =>
    cloud.pool.query(text, [f.tenantId, ...params]);
  // The builder alone on its own client, with the pg counter around it (transaction control excluded).
  const buildCounted = async () => {
    const counter = pgCounter(cloud.pool);
    const client = await cloud.pool.connect();
    try {
      counter.reset();
      const snapshot = await buildSnapshot(
        client,
        tenant(),
        f.branches[0],
        HEADER,
      );
      return { snapshot, statements: counter.count };
    } finally {
      client.release();
    }
  };
  const configVersion = async () =>
    BigInt(
      String(
        (
          await cloud.pool.query<{ config_version: string }>(
            `SELECT config_version FROM branches WHERE branch_id = $1`,
            [f.branches[0]],
          )
        ).rows[0]!.config_version,
      ),
    );
  // GET /v1/sync/config with a config_version one behind the cloud's: the hub's real path (snapshot + snapshot_hash).
  const poll = async () => {
    const versions = (
      await cloud.pool.query<{
        config_version: string;
        directory_version: string;
      }>(
        `SELECT b.config_version, t.directory_version FROM branches b JOIN tenants t ON t.tenant_id = b.tenant_id WHERE b.branch_id = $1`,
        [f.branches[0]],
      )
    ).rows[0]!;
    const behind = BigInt(String(versions.config_version)) - 1n;
    const response = await cloud.app.inject({
      method: "GET",
      url: `/v1/sync/config?config_version=${behind}&directory_version=${BigInt(String(versions.directory_version))}`,
      headers: { authorization: `Bearer ${f.branchKey}` },
    });
    expect(response.statusCode).toBe(200);
    return response.json().data.config as {
      snapshot_hash: string;
      snapshot: Record<string, unknown>;
    };
  };
  // Two prepared stock items (the 01c-era kind, the column default), each counted at a station of branch A.
  const seedPrepared = async () => {
    await sql(
      `INSERT INTO stock_items (tenant_id, stock_item_id, name, stock_unit, carries_over, archived_at, created_at, updated_at)
       VALUES ($1, 'SK-1', 'Karahi pot', 'g', false, NULL, 0, 0), ($1, 'SK-2', 'fries', 'piece', true, NULL, 0, 0)`,
    );
    await sql(
      `INSERT INTO stock_item_branches (tenant_id, branch_id, stock_item_id, station_id, low_stock_threshold, updated_at)
       VALUES ($1, $2, 'SK-1', 'ST-1', 1000, 0), ($1, $2, 'SK-2', 'ST-2', NULL, 0)`,
      [f.branches[0]],
    );
  };
  // An ingredient and a packet (stock_unit g, 08a §5.1 packet unit), created as prepared; kind is set afterwards by raw SQL.
  const seedInventoryOnly = async (counted: boolean) => {
    await sql(
      `INSERT INTO stock_items (tenant_id, stock_item_id, name, stock_unit, carries_over, archived_at, created_at, updated_at)
       VALUES ($1, 'SK-I', 'Chicken (raw)', 'g', false, NULL, 0, 0), ($1, 'SK-K', 'Masala packet', 'g', false, NULL, 0, 0)`,
    );
    if (counted) {
      // The C-4 write check bypassed: the branch rows exist while the items are still prepared.
      await sql(
        `INSERT INTO stock_item_branches (tenant_id, branch_id, stock_item_id, station_id, low_stock_threshold, updated_at)
         VALUES ($1, $2, 'SK-I', 'ST-1', 500, 0), ($1, $2, 'SK-K', 'ST-2', NULL, 0)`,
        [f.branches[0]],
      );
    }
    await sql(
      `UPDATE stock_items SET kind = 'ingredient' WHERE tenant_id = $1 AND stock_item_id = 'SK-I'`,
    );
    await sql(
      `UPDATE stock_items SET kind = 'packet' WHERE tenant_id = $1 AND stock_item_id = 'SK-K'`,
    );
  };

  it("[08a #24] a raw-SQL stock_item_branches row onto an ingredient or a packet is not in stock_items[]; a counted prepared item still is", async () => {
    await seedPrepared();
    await seedInventoryOnly(true);
    // I9 draw half: a menu item drawing from the prepared SK-1 and the counted-but-filtered ingredient SK-I (raw SQL)
    await sql(
      `INSERT INTO stock_draws (tenant_id, item_id, stock_item_id, quantity_per_sale_unit)
       VALUES ($1, 'IT-0000', 'SK-1', 250), ($1, 'IT-0000', 'SK-I', 100)`,
    );
    const counted = await sql(
      `SELECT b.stock_item_id, s.kind FROM stock_item_branches b
         JOIN stock_items s ON s.tenant_id = b.tenant_id AND s.stock_item_id = b.stock_item_id
        WHERE b.tenant_id = $1 AND b.branch_id = $2 ORDER BY b.stock_item_id`,
      [f.branches[0]],
    );
    expect(counted.rows).toEqual([
      { stock_item_id: "SK-1", kind: "prepared" },
      { stock_item_id: "SK-2", kind: "prepared" },
      { stock_item_id: "SK-I", kind: "ingredient" },
      { stock_item_id: "SK-K", kind: "packet" },
    ]);

    const { snapshot, statements } = await buildCounted();
    const stockItems = snapshot.stock_items as Array<{ stock_item_id: string }>;
    expect(stockItems.map((item) => item.stock_item_id)).toEqual([
      "SK-2",
      "SK-1",
    ]);
    expect(stockItems[1]).toEqual({
      stock_item_id: "SK-1",
      name: "Karahi pot",
      stock_unit: "g",
      carries_over: false,
      station_id: "ST-1",
      low_stock_threshold: 1000,
    });
    // the draw onto the filtered ingredient is dropped (01c V12 rule); no draw points outside stock_items[]
    const items = snapshot.items as Array<{
      item_id: string;
      stock_draws: Array<{
        stock_item_id: string;
        quantity_per_sale_unit: number;
      }>;
    }>;
    expect(items.find((i) => i.item_id === "IT-0000")?.stock_draws).toEqual([
      { stock_item_id: "SK-1", quantity_per_sale_unit: 250 },
    ]);
    const listed = new Set(stockItems.map((s) => s.stock_item_id));
    for (const item of items)
      for (const d of item.stock_draws)
        expect(listed.has(d.stock_item_id)).toBe(true);
    // C-6: no statement-count change (01c §4.5, 01a §10 #5: 23); ⚠️ 08b P-1, A-4: + 5 inventory key reads → 28.
    expect(statements).toBe(28);
  });

  it("[08a #25 ⚠️ 08b P-1] prepared, ingredient and packet items, only prepared counted: ingredient / packet items change inventory.items[] and bump; stock_items[] stays byte for byte the same (same statements, 28)", async () => {
    await seedPrepared();
    const versionBefore = await configVersion();
    const before = await buildCounted();
    const polledBefore = await poll();

    // ⚠️ 08b P-1 (B16): created through the route (01c §6.7 / 08a §6.2), which bumps every branch
    for (const payload of [
      { name: "Chicken (raw)", stock_unit: "g", carries_over: false, kind: "ingredient" },
      { name: "Masala packet", stock_unit: "g", carries_over: false, kind: "packet" },
    ]) {
      const created = await cloud.app.inject({ method: "POST", url: "/v1/admin/stock-items", ...owner(f), payload });
      expect(created.statusCode, created.body).toBe(201);
    }
    const kinds = await sql(
      `SELECT kind, count(*)::int AS n FROM stock_items WHERE tenant_id = $1 GROUP BY kind ORDER BY kind`,
    );
    expect(kinds.rows).toEqual([
      { kind: "ingredient", n: 1 },
      { kind: "packet", n: 1 },
      { kind: "prepared", n: 2 },
    ]);

    const after = await buildCounted();
    expect(Object.keys(after.snapshot).sort()).toEqual(SNAPSHOT_KEYS);
    // stock_items[] (the engine's input, I9) is unchanged byte for byte; no new keys on a stock item entry
    expect(JSON.stringify(after.snapshot.stock_items)).toBe(
      JSON.stringify(before.snapshot.stock_items),
    );
    for (const item of after.snapshot.stock_items as Array<
      Record<string, unknown>
    >) {
      expect(Object.keys(item).sort()).toEqual(STOCK_ITEM_KEYS);
    }
    // inventory.items[] gains the two (B15 b: every active item, every kind)
    const inventoryKinds = (snapshot: Record<string, unknown>) =>
      (snapshot.inventory as { items: Array<{ kind: string }> }).items
        .map((item) => item.kind)
        .sort();
    expect(inventoryKinds(before.snapshot)).toEqual(["prepared", "prepared"]);
    expect(inventoryKinds(after.snapshot)).toEqual([
      "ingredient",
      "packet",
      "prepared",
      "prepared",
    ]);
    expect(canonicalJson(after.snapshot)).not.toBe(
      canonicalJson(before.snapshot),
    );
    // The builder's statement count is unchanged by the extra items.
    expect(after.statements).toBe(before.statements);
    expect(after.statements).toBe(28);

    // The hub's path: config_version bumped (once per POST), a new body and snapshot_hash.
    expect(await configVersion()).toBe(versionBefore + 2n);
    const polledAfter = await poll();
    expect(polledAfter.snapshot_hash).not.toBe(polledBefore.snapshot_hash);
    expect(polledAfter.snapshot_hash).toBe(
      sha256hex(canonicalJson(polledAfter.snapshot)),
    );
  });
});
