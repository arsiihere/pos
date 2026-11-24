import { readdirSync, readFileSync, statSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCostInputs, effectiveMenuPrice, plateCost, pricePerStockUnit, stockItemUnitCost } from '@pos/domain';
import { canonicalJson, sha256hex } from '@pos/domain/hash';
import { InventorySnapshotSchema, type InventorySnapshot } from '@pos/events';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readBranchConfigRow } from '../../../hub/src/projections/branch-config';
import { httpConfigClient, type ConfigClient } from '../../../hub/src/sync/config-client';
import { configPoller } from '../../../hub/src/sync/config-poller';
import { createTestHub, type TestHub } from '../../../hub/test/helpers/test-hub';
import { migrate } from '../../src/db/migrate';
import { TenantLevelRepository } from '../../src/db/tenant-level-repository';
import { assertTenantContext } from '../../src/db/tenant-scoped-repository';
import { fixedClock } from '../../src/lib/clock';
import { buildSnapshot, type SnapshotHeader } from '../../src/modules/config-sync/builder';
import { selectSnapshotPrices } from '../../src/modules/config-sync/repository';
import { syncConfig } from '../../src/modules/config-sync/service';
import { selectPriceCandidates } from '../../src/modules/inventory/repository';
import { pgCounter } from '../helpers/pg-counter';
import { owner } from '../helpers/restaurant';
import { dropScratchDatabases, scratchDatabaseAt } from '../helpers/scratch-db';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';
import { recipeFixture, type RecipeFixture } from '../recipes/fixtures';
import { stockItem } from '../inventory/fixtures';

// 08 v1.1 Part B §10.3 (tests 23–25, 27, 27b, 28, 33's key): the snapshot `inventory` key (B15, §5.3; 01a A-3, A-4;
// 01b B-x). Recipes are inserted by SQL (lane R's routes are not this task's); prices with chosen times by SQL too.

const T = 1_761_000_000_000; // the test cloud's fixed clock: the fixture's route-written rows carry it
const H = 3_600_000;
const D = 24 * H;
const HEADER: SnapshotHeader = { config_version: 42, currency_code: 'PKR', tax_enabled: false, day_stale_after_hours: 16, day_min_gap_hours: 4 };
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

describe('[08b §5.3, B15] snapshot inventory key', () => {
  let cloud: TestCloud;
  let counter: ReturnType<typeof pgCounter>;
  let base: string;
  let fx: RecipeFixture;
  const hubs: TestHub[] = [];

  beforeAll(async () => {
    cloud = await createTestCloud({ captureLogs: true, testHooks: { handlerStart: () => counter.reset() } });
    counter = pgCounter(cloud.pool);
    await cloud.app.listen({ host: '127.0.0.1', port: 0 });
    base = `http://127.0.0.1:${(cloud.app.server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    cloud.clock.set(T);
    fx = await recipeFixture(cloud);
  }, 60_000);
  afterEach(async () => {
    cloud.clock.set(T);
    for (const h of hubs.splice(0)) await h.close();
  });

  const lakeCity = () => fx.lakeCity;
  const tenantCtx = () => Object.freeze({ tenantId: fx.f.tenantId, branchIds: Object.freeze([...fx.f.branches]) });
  const sql = (text: string, params: unknown[] = []) => cloud.pool.query(text, [fx.f.tenantId, ...params]);

  const buildCounted = async () => {
    const client = await cloud.pool.connect();
    try {
      counter.reset();
      const snapshot = await buildSnapshot(client, tenantCtx(), lakeCity(), HEADER);
      return { snapshot, statements: counter.count };
    } finally {
      client.release();
    }
  };
  const versions = async () => {
    const row = (
      await cloud.pool.query<{ config_version: string; directory_version: string }>(
        `SELECT b.config_version, t.directory_version FROM branches b JOIN tenants t ON t.tenant_id = b.tenant_id WHERE b.branch_id = $1`,
        [lakeCity()],
      )
    ).rows[0]!;
    return { config: Number(row.config_version), directory: Number(row.directory_version) };
  };
  const poll = (configVersion: number, directoryVersion: number, headers: Record<string, string> = {}) =>
    cloud.app.inject({
      method: 'GET',
      url: `/v1/sync/config?config_version=${configVersion}&directory_version=${directoryVersion}`,
      headers: { authorization: `Bearer ${fx.f.branchKey}`, ...headers },
    });
  const pollBehind = async () => {
    const v = await versions();
    const response = await poll(v.config - 1, v.directory);
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data.config as { snapshot_hash: string; snapshot: Record<string, unknown> & { inventory: InventorySnapshot } };
  };

  // ------------------------------------------------------------------------------------------- raw-SQL rows

  let priceSeq = 0;
  const price = async (p: {
    id?: string;
    item: string;
    branch?: string | null;
    kind: 'manual' | 'market_rate';
    at: number | string;
    until?: number | null;
    price_minor: number;
    unit_name?: string;
    stock_unit?: string;
    qty?: number;
  }) => {
    const id = p.id ?? `PR-${String(++priceSeq).padStart(3, '0')}`;
    await sql(
      `INSERT INTO item_prices (tenant_id, price_id, stock_item_id, branch_id, kind, unit_name, price_minor, stock_qty_num, stock_qty_den,
         stock_unit, created_at, valid_until_at, note, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10, $11, NULL, $12)`,
      [id, p.item, p.branch ?? null, p.kind, p.unit_name ?? 'kg', p.price_minor, p.qty ?? 1000, p.stock_unit ?? 'g', String(p.at), p.until ?? null, fx.f.userId],
    );
    return id;
  };
  const recipe = async (id: string, ownerType: string, ownerId: string, archived = false) => {
    await sql(
      `INSERT INTO recipes (tenant_id, recipe_id, owner_type, owner_id, archived_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [id, ownerType, ownerId, archived ? T : null, T],
    );
    return id;
  };
  interface VersionSpec {
    id: string;
    recipe: string;
    no: number;
    status: 'draft' | 'published' | 'superseded';
    basis?: 'per_unit' | 'per_measure' | 'per_batch';
    base_qty?: number | null;
    measure_unit?: 'g' | 'ml' | null;
    batch_yield_qty?: string | null;
    batch_stock_unit?: 'piece' | 'g' | 'ml' | null;
    published_at?: number;
    lines: Array<{ item: string; num: string; den?: string; unit: 'piece' | 'g' | 'ml'; basis?: 'AP' | 'EP' }>;
  }
  const version = async (v: VersionSpec) => {
    const publishedAt = v.status === 'draft' ? null : (v.published_at ?? T);
    await sql(
      `INSERT INTO recipe_versions (tenant_id, recipe_version_id, recipe_id, version_no, status, basis, base_qty, batch_yield_qty,
         batch_stock_unit, measure_unit, misc_allowance_bp, created_by, created_at, updated_at, published_by, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 500, $11, $12, $12, $13, $14)`,
      [
        v.id,
        v.recipe,
        v.no,
        v.status,
        v.basis ?? 'per_unit',
        v.base_qty ?? null,
        v.batch_yield_qty ?? null,
        v.batch_stock_unit ?? null,
        v.measure_unit ?? null,
        fx.f.userId,
        T,
        publishedAt === null ? null : fx.f.userId,
        publishedAt,
      ],
    );
    for (const [i, l] of v.lines.entries()) {
      await sql(
        `INSERT INTO recipe_lines (tenant_id, recipe_version_id, line_no, stock_item_id, unit_name, entered_num, entered_den,
           stock_qty_num, stock_qty_den, stock_unit, qty_basis)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $6, $7, $5, $8)`,
        [v.id, i + 1, l.item, l.unit, l.num, l.den ?? '1', l.basis ?? 'AP'],
      );
    }
    return v;
  };
  const keyVersion = (v: VersionSpec, ownerType: string, ownerId: string, archived = false) => ({
    recipe_version_id: v.id,
    status: v.status,
    owner_type: ownerType,
    owner_id: ownerId,
    basis: v.basis ?? 'per_unit',
    base_qty: v.base_qty ?? null,
    measure_unit: v.measure_unit ?? null,
    recipe_archived: archived,
    batch_yield_qty: v.batch_yield_qty ?? null,
    batch_stock_unit: v.batch_stock_unit ?? null,
    misc_allowance_bp: 500,
    published_at: v.published_at ?? T,
    lines: v.lines.map((l) => ({ stock_item_id: l.item, stock_qty_num: l.num, stock_qty_den: l.den ?? '1', stock_unit: l.unit, qty_basis: l.basis ?? 'AP' })),
  });

  // The recipes of test 23: every owner kind, the ≤ 3 superseded cut, a draft, an archived recipe, and two owners
  // the builder's backstop leaves out (a packet, a linked option).
  const seedRecipes = async () => {
    const s = fx.stock;
    const tawa = await recipe('RC-TAWA', 'menu_item', fx.items.tawaPiece);
    const tawaVersions: VersionSpec[] = [];
    for (let n = 1; n <= 5; n += 1) {
      tawaVersions.push(
        await version({
          id: `RV-TAWA-${n}`,
          recipe: tawa,
          no: n,
          status: n === 5 ? 'published' : 'superseded',
          published_at: T - (6 - n) * H,
          lines: [
            { item: s.beef, num: String(100 + n), unit: 'g', basis: 'EP' },
            { item: s.ghee, num: '20', unit: 'g' },
          ],
        }),
      );
    }
    await version({ id: 'RV-TAWA-6', recipe: tawa, no: 6, status: 'draft', lines: [{ item: s.onion, num: '5', unit: 'g' }] });
    const karahi = await recipe('RC-KARAHI', 'menu_item', fx.items.chickenKarahi);
    const karahiV = await version({
      id: 'RV-KARAHI-1',
      recipe: karahi,
      no: 1,
      status: 'published',
      basis: 'per_measure',
      base_qty: 1000,
      measure_unit: 'g',
      lines: [
        { item: s.beef, num: '700', unit: 'g' },
        { item: s.oil, num: '61', den: '2', unit: 'ml' },
      ],
    });
    const spicy = await recipe('RC-SPICY', 'modifier_option', fx.options.spicy);
    const spicyV = await version({ id: 'RV-SPICY-1', recipe: spicy, no: 1, status: 'published', lines: [{ item: s.makhan, num: '5', unit: 'g' }] });
    const noOnion = await recipe('RC-NOONION', 'modifier_option', fx.options.noOnion);
    const noOnionV = await version({ id: 'RV-NOONION-1', recipe: noOnion, no: 1, status: 'published', lines: [{ item: s.onion, num: '-20', unit: 'g' }] });
    const paye = await recipe('RC-PAYE', 'stock_item', s.payeCooked);
    const payeV = await version({
      id: 'RV-PAYE-1',
      recipe: paye,
      no: 1,
      status: 'published',
      basis: 'per_batch',
      batch_yield_qty: '40',
      batch_stock_unit: 'piece',
      lines: [
        { item: s.payeRaw, num: '10000', unit: 'g' },
        { item: s.shorba, num: '8000', unit: 'ml' },
      ],
    });
    const lassi = await recipe('RC-LASSI', 'menu_item', fx.items.lassi, true); // t-7 b: archived
    const lassiOld = await version({
      id: 'RV-LASSI-1',
      recipe: lassi,
      no: 1,
      status: 'superseded',
      basis: 'per_measure',
      base_qty: 250,
      measure_unit: 'ml',
      published_at: T - H,
      lines: [{ item: s.milk, num: '200', unit: 'ml' }],
    });
    const lassiV = await version({
      id: 'RV-LASSI-2',
      recipe: lassi,
      no: 2,
      status: 'published',
      basis: 'per_measure',
      base_qty: 250,
      measure_unit: 'ml',
      lines: [{ item: s.milk, num: '220', unit: 'ml' }],
    });
    // builder backstop (M-4): a raw-SQL recipe owned by a packet, by a linked option, by an ingredient — never sent
    const packet = await recipe('RC-PACKET', 'stock_item', s.py1);
    await version({ id: 'RV-PACKET-1', recipe: packet, no: 1, status: 'published', lines: [{ item: s.beef, num: '1', unit: 'g' }] });
    const linked = await recipe('RC-LINKED', 'modifier_option', fx.options.extraNaan);
    await version({ id: 'RV-LINKED-1', recipe: linked, no: 1, status: 'published', lines: [{ item: s.beef, num: '1', unit: 'g' }] });
    const ingredient = await recipe('RC-ONION', 'stock_item', s.onion);
    await version({ id: 'RV-ONION-1', recipe: ingredient, no: 1, status: 'published', lines: [{ item: s.beef, num: '1', unit: 'g' }] });

    return [
      ...tawaVersions.slice(1).map((v) => keyVersion(v, 'menu_item', fx.items.tawaPiece)),
      keyVersion(karahiV, 'menu_item', fx.items.chickenKarahi),
      keyVersion(spicyV, 'modifier_option', fx.options.spicy),
      keyVersion(noOnionV, 'modifier_option', fx.options.noOnion),
      keyVersion(payeV, 'stock_item', s.payeCooked),
      keyVersion(lassiOld, 'menu_item', fx.items.lassi, true),
      keyVersion(lassiV, 'menu_item', fx.items.lassi, true),
    ].sort((a, b) => byCodePoint(a.recipe_version_id, b.recipe_version_id));
  };

  // -------------------------------------------------------------------------------------------------- tests

  it('[08b #23] key contents for Lake City: active items, current units, non-dominated prices, active yields, published + ≤ 3 superseded versions of the three owner kinds (archived recipe flagged), drafts and backstop owners absent; the price read has no now (N-3)', async () => {
    const s = fx.stock;
    // items: an archived ingredient is not sent; prices / units / yields of it neither
    const gone = (
      await cloud.app.inject({ method: 'POST', url: '/v1/admin/stock-items', ...owner(fx.f), payload: { name: 'Old masala', stock_unit: 'g', carries_over: false } })
    ).json().data.stock_item.stock_item_id as string;
    await sql(`UPDATE stock_items SET kind = 'ingredient', archived_at = $3 WHERE tenant_id = $1 AND stock_item_id = $2`, [gone, T]);
    await price({ item: gone, kind: 'manual', at: T, price_minor: 1 });
    // units: a newer `l` on ghee supersedes the fixture's; a unit row in another base (piece) is not current
    await sql(
      `INSERT INTO stock_item_units (tenant_id, unit_row_id, stock_item_id, unit_name, base_unit, factor_num, factor_den, note, recorded_by, created_at)
       VALUES ($1, 'UR-1', $2, 'l', 'g', 915, 1, NULL, $3, $4), ($1, 'UR-2', $2, 'tin', 'piece', 3, 1, NULL, $3, $4)`,
      [s.ghee, fx.f.userId, T + H],
    );
    // prices on beef (every branch): the fixture's manual at T; an older manual and an older rate (dominated by it);
    // rate A then rate B, B newer and expiring later (A dominated, B kept); at Lake City a branch rate (kept); at
    // branch B a rate (another branch: absent); a row in ml (not beef's stock unit: absent)
    await price({ item: s.beef, kind: 'manual', at: T - D, price_minor: 140_000 });
    await price({ item: s.beef, kind: 'market_rate', at: T - 2 * D, until: T - D, price_minor: 130_000 });
    await price({ item: s.beef, kind: 'market_rate', at: T + H, until: T + 25 * H, price_minor: 160_000 });
    const rateB = await price({ item: s.beef, kind: 'market_rate', at: T + 2 * H, until: T + 26 * H, price_minor: 165_000 });
    const lakeRate = await price({ item: s.beef, branch: lakeCity(), kind: 'market_rate', at: T + 3 * H, until: T + 4 * H, price_minor: 170_000 });
    // dominance is per scope: a Lake City rate older than the every-branch manual (T) is not dominated by it
    const lakeEarly = await price({ item: s.beef, branch: lakeCity(), kind: 'market_rate', at: T - 2 * H, until: T + D, price_minor: 168_000 });
    await price({ item: s.beef, branch: fx.f.branches[1], kind: 'market_rate', at: T + 3 * H, until: T + 30 * H, price_minor: 175_000 });
    await price({ item: s.beef, kind: 'manual', at: T + 5 * H, price_minor: 999, unit_name: 'l', stock_unit: 'ml' });
    // yields: a newer beef profile replaces the fixture's; a raw-SQL yield on a packet is not sent
    await sql(
      `INSERT INTO yield_profiles (tenant_id, yield_profile_id, stock_item_id, yield_bp, note, recorded_by, created_at)
       VALUES ($1, 'YP-1', $2, 7300, NULL, $3, $4), ($1, 'YP-2', $5, 9000, NULL, $3, $4)`,
      [s.beef, fx.f.userId, T + H, s.py1],
    );
    const expectedRecipes = await seedRecipes();
    // B15 (e): an archived menu item's recipe versions are still sent (owner active or archived)
    await sql(`UPDATE menu_items SET archived_at = $3 WHERE tenant_id = $1 AND item_id = $2`, [fx.items.chickenKarahi, T]);

    const { snapshot } = await buildCounted();
    const key = snapshot.inventory as InventorySnapshot;
    expect(Object.keys(key).sort()).toEqual(['items', 'prices', 'recipes', 'units', 'yields']);

    // (b) active items, every kind, by stock_item_id in code-point order
    const active = (
      await sql(`SELECT stock_item_id, kind, name, code, stock_unit, cost_category, is_a_item FROM stock_items WHERE tenant_id = $1 AND archived_at IS NULL`)
    ).rows.sort((a, b) => byCodePoint(a.stock_item_id, b.stock_item_id));
    expect(key.items).toEqual(active);
    expect(key.items.map((i) => i.stock_item_id)).not.toContain(gone);
    expect(key.items.find((i) => i.stock_item_id === s.ghee)).toEqual({
      stock_item_id: s.ghee,
      kind: 'ingredient',
      name: 'Ghee',
      code: null,
      stock_unit: 'g',
      cost_category: 'food',
      is_a_item: true,
    });

    // (d) units: the latest per name in the item's current base; factors as strings (m-16)
    expect(key.units).toEqual([{ stock_item_id: s.ghee, unit_name: 'l', factor_num: '915', factor_den: '1' }]);

    // (a) prices: per item and scope, the rows not dominated
    const beefRows = key.prices.filter((p) => p.stock_item_id === s.beef);
    const fixtureManual = (
      await sql(`SELECT price_id FROM item_prices WHERE tenant_id = $1 AND stock_item_id = $2 AND created_at = $3 AND kind = 'manual'`, [s.beef, T])
    ).rows[0]!.price_id as string;
    expect(beefRows.map((p) => p.price_id).sort(byCodePoint)).toEqual([fixtureManual, rateB, lakeRate, lakeEarly].sort(byCodePoint));
    expect(beefRows.find((p) => p.price_id === rateB)).toEqual({
      price_id: rateB,
      stock_item_id: s.beef,
      branch_id: null,
      kind: 'market_rate',
      unit_name: 'kg',
      stock_unit: 'g',
      price_minor: '165000',
      stock_qty_num: '1000',
      stock_qty_den: '1',
      created_at: T + 2 * H,
      valid_until_at: T + 26 * H,
    });
    expect(beefRows.find((p) => p.price_id === fixtureManual)).toMatchObject({ kind: 'manual', valid_until_at: null, created_at: T, unit_name: 'kg', stock_unit: 'g' });
    expect(beefRows.find((p) => p.price_id === lakeRate)?.branch_id).toBe(lakeCity());
    expect(beefRows.find((p) => p.price_id === lakeEarly)).toMatchObject({ branch_id: lakeCity(), created_at: T - 2 * H, valid_until_at: T + D });
    // every fixture-priced item keeps its one manual price; onion and adrak have none
    const pricedItems = new Set(key.prices.map((p) => p.stock_item_id));
    expect(pricedItems).toEqual(new Set([s.beef, s.ghee, s.payeRaw, s.tp1, s.milk, s.shorba, s.oil, s.makhan, s.py1]));
    expect(key.prices.map((p) => p.price_id)).toEqual([...key.prices.map((p) => p.price_id)].sort(byCodePoint));

    // (d) yields: the active profile of each ingredient
    expect(key.yields).toEqual(
      [
        { stock_item_id: s.beef, yield_bp: 7300 },
        { stock_item_id: s.payeRaw, yield_bp: 6000 },
      ].sort((a, b) => byCodePoint(a.stock_item_id, b.stock_item_id)),
    );

    // (e) recipes: published + ≤ 3 superseded per recipe (RV-TAWA-1 is the 4th superseded: absent), drafts absent,
    // the packet / linked-option / ingredient owners absent (backstop), the archived Lassi recipe present and flagged;
    // batch_stock_unit, measure_unit (T-2), lines with their frozen stock_unit in line_no order
    expect(key.recipes).toEqual(expectedRecipes);
    const ids = key.recipes.map((r) => r.recipe_version_id);
    for (const absent of ['RV-TAWA-1', 'RV-TAWA-6', 'RV-PACKET-1', 'RV-LINKED-1', 'RV-ONION-1']) expect(ids).not.toContain(absent);
    expect(key.recipes.find((r) => r.recipe_version_id === 'RV-KARAHI-1')).toMatchObject({ basis: 'per_measure', base_qty: 1000, measure_unit: 'g' }); // owner archived
    expect(key.recipes.find((r) => r.recipe_version_id === 'RV-PAYE-1')).toMatchObject({ batch_yield_qty: '40', batch_stock_unit: 'piece' });
    // t-7 b on the hub: the archived recipe's versions are kept by id but never in publishedByOwner
    const inputs = buildCostInputs(key);
    expect(inputs.versions.has('RV-LASSI-2')).toBe(true);
    expect(inputs.publishedByOwner.has(`menu_item:${fx.items.lassi}`)).toBe(false);
    expect(inputs.publishedByOwner.get(`menu_item:${fx.items.tawaPiece}`)).toBe('RV-TAWA-5');
    expect(inputs.dropped).toBe(0);

    // N-3: the builder's own price read takes (db, branchId) — no `now` parameter, no time in its SQL
    expect(selectSnapshotPrices.length).toBe(2);
    const seen: Array<{ text: string; params: readonly unknown[] }> = [];
    const level = new TenantLevelRepository(tenantCtx(), cloud.pool);
    const spy = {
      query: <R extends pg.QueryResultRow>(text: string, params: readonly unknown[] = []) => {
        seen.push({ text, params });
        return level.query<R>(text, params);
      },
    };
    const direct = await selectSnapshotPrices(spy, lakeCity());
    expect(seen).toHaveLength(1);
    expect(seen[0]!.params).toEqual([lakeCity()]);
    expect(seen[0]!.text).not.toMatch(/\$3|now\(\)|current_timestamp|clock_timestamp/i);
    expect(direct.map((p) => p.price_id).sort(byCodePoint)).toEqual(key.prices.map((p) => p.price_id));

    // B15 (e): the published version is always kept, even when 4 superseded ones carry a later published_at (raw SQL)
    await sql(`UPDATE recipe_versions SET published_at = $2 WHERE tenant_id = $1 AND recipe_version_id = 'RV-TAWA-5'`, [T - 10 * H]);
    const tawaIds = ((await buildCounted()).snapshot.inventory as InventorySnapshot).recipes
      .map((r) => r.recipe_version_id)
      .filter((id) => id.startsWith('RV-TAWA-'));
    expect(tawaIds).toEqual(['RV-TAWA-2', 'RV-TAWA-3', 'RV-TAWA-4', 'RV-TAWA-5']);
  });

  it('[08b #24] the typed InventorySnapshotSchema parses every built key and is not .strict(); a key failing it logs inventory_key_invalid (branch id, issue paths) and the sync still answers 200 with the key as built (N-4)', async () => {
    await seedRecipes();
    const good = await pollBehind();
    expect(InventorySnapshotSchema.safeParse(good.snapshot.inventory).success).toBe(true);
    const extra = structuredClone(good.snapshot.inventory) as InventorySnapshot & { items: Array<Record<string, unknown>> };
    extra.items[0]!.received_today = '5'; // 08d may add fields: stripped, not refused
    const parsed = InventorySnapshotSchema.safeParse(extra);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.items[0]).not.toHaveProperty('received_today');
    expect(cloud.logs()).not.toContain('inventory_key_invalid');
    const mark = cloud.logs().length;

    // a manual price whose created_at is not a safe integer (raw SQL; no route writes one) fails the typed schema
    const badId = await price({ item: fx.stock.makhan, kind: 'manual', at: '9007199254740993', price_minor: 190_000 });
    const bad = await pollBehind();
    const index = bad.snapshot.inventory.prices.findIndex((p) => p.price_id === badId);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(InventorySnapshotSchema.safeParse(bad.snapshot.inventory).success).toBe(false);
    expect(bad.snapshot_hash).toBe(sha256hex(canonicalJson(bad.snapshot)));
    const line = cloud
      .logs()
      .slice(mark)
      .split('\n')
      .filter((l) => l.includes('inventory_key_invalid'))
      .map((l) => JSON.parse(l) as { branch_id: string; issues: string[]; msg: string });
    expect(line).toHaveLength(1);
    expect(line[0]).toMatchObject({ msg: 'inventory_key_invalid', branch_id: lakeCity(), issues: [`prices.${index}.created_at`] });
  });

  it('[08b #25] builder ≤ 28; sync config-only ≤ 33, with directory ≤ 40 (01a A-4, 01b B-x)', async () => {
    await seedRecipes();
    const { statements } = await buildCounted();
    expect(statements).toBe(28); // 23 + 5 (items, units, prices, yields, versions with lines)
    expect(statements).toBeLessThanOrEqual(28);
    const v = await versions();
    const configOnly = await poll(v.config - 1, v.directory);
    expect(configOnly.statusCode).toBe(200);
    expect(configOnly.json().data.config.snapshot.inventory.recipes.length).toBeGreaterThan(0);
    expect(counter.count).toBeLessThanOrEqual(33);
    const both = await poll(v.config - 1, v.directory - 1);
    expect(both.statusCode).toBe(200);
    expect(both.json().data.directory).not.toBeNull();
    expect(counter.count).toBeLessThanOrEqual(40);
  });

  it('[08b #27] hash stability (M-2): two builds of one config_version, the second after a market rate\'s valid_until_at, have equal hashes', async () => {
    await seedRecipes();
    await price({ item: fx.stock.oil, kind: 'market_rate', at: T + H, until: T + 2 * H, price_minor: 70_000, unit_name: 'l', stock_unit: 'ml' });
    const first = await pollBehind();
    expect(first.snapshot.inventory.prices.some((p) => p.valid_until_at === T + 2 * H)).toBe(true);
    cloud.clock.set(T + 3 * H); // the rate has expired on the cloud's clock
    const second = await pollBehind();
    expect(second.snapshot.config_version).toBe(first.snapshot.config_version);
    expect(second.snapshot_hash).toBe(first.snapshot_hash);
    expect(canonicalJson(second.snapshot)).toBe(canonicalJson(first.snapshot));
  });

  it('[08b #27] hub (M-5, n-1, t-1): a key failing the typed schema still applies (branch_config updated, no schema_invalid); a body without the key applies; hub clock 10 min behind the newest manual price uses it; price_id order ≠ created_at order → the hub picks I7\'s row', async () => {
    const s = fx.stock;
    await seedRecipes();
    // n-1: the newest manual on beef, a day ahead of the hub's clock
    const newest = await price({ item: s.beef, kind: 'manual', at: T + D, price_minor: 155_000 });
    // t-1: two oil rates, the newer one with the smaller price_id, both non-dominated (the newer expires first)
    await price({ id: 'ZZ-OLDER', item: s.oil, kind: 'market_rate', at: T + H, until: T + 10 * D, price_minor: 61_000, unit_name: 'l', stock_unit: 'ml' });
    await price({ id: 'AA-NEWER', item: s.oil, kind: 'market_rate', at: T + 2 * H, until: T + D, price_minor: 62_000, unit_name: 'l', stock_unit: 'ml' });
    // M-5: a key the typed schema refuses (an unsafe created_at on makhan)
    await price({ item: s.makhan, kind: 'manual', at: '9007199254740993', price_minor: 190_000 });
    await sql(`UPDATE branches SET config_version = config_version + 1 WHERE tenant_id = $1`);
    const v = await versions();

    const hubFor = async (configClient: ConfigClient) => {
      const h = await createTestHub({
        config: {
          cloud_base_url: base,
          provisioned: { tenant_id: fx.f.tenantId, branch_id: lakeCity(), branch_name: 'Lake City', branch_api_key: fx.f.branchKey, confirmed_at: 1 },
        },
        configClient,
      });
      hubs.push(h);
      return h;
    };
    const h = await hubFor(httpConfigClient(base, fx.f.branchKey));
    const poller = configPoller(h.app);
    const applied = await poller.pollOnce();
    expect(applied.outcome).toBe('applied');
    expect(poller.lastProblem()).toBeNull();
    expect(h.logs()).not.toContain('schema_invalid');
    expect(readBranchConfigRow(h.deps.db, lakeCity())?.config_version).toBe(v.config);
    const stored = h.deps.db.prepare('SELECT snapshot_hash, body FROM config_snapshots').get() as { snapshot_hash: string; body: string };
    const body = JSON.parse(stored.body) as { inventory: InventorySnapshot };
    expect(InventorySnapshotSchema.safeParse(body.inventory).success).toBe(false);

    // the hub's cost inputs from the stored key (08c's path): every row in effect on any hub clock
    const inputs = buildCostInputs(body.inventory);
    expect(inputs.dropped).toBe(1); // the unsafe-created_at row, element by element (t-5)
    const hubNow = T + D - 10 * 60_000; // 10 min behind the newest manual's created_at
    expect(stockItemUnitCost(inputs, s.beef, lakeCity(), hubNow)?.per_stock_unit).toEqual(
      pricePerStockUnit({ price_minor: 155_000n, stock_qty_num: 1000n, stock_qty_den: 1n }),
    );
    expect(body.inventory.prices.some((p) => p.price_id === newest)).toBe(true);
    // t-1: the cloud's I7 at a time both oil rates are in effect, against the hub's ranked rows
    const cloudNow = T + 3 * H;
    const level = new TenantLevelRepository(tenantCtx(), cloud.pool);
    const candidates = await selectPriceCandidates(level, [s.oil], lakeCity(), cloudNow);
    const cloudRow = effectiveMenuPrice(candidates, lakeCity(), cloudNow, 'ml');
    expect(cloudRow?.price_id).toBe('AA-NEWER');
    expect(stockItemUnitCost(inputs, s.oil, lakeCity(), cloudNow)?.per_stock_unit).toEqual(pricePerStockUnit(cloudRow!));

    // a body without the key parses and applies (the key is optional, A-3)
    const fresh = await poll(0, v.directory);
    expect(fresh.statusCode).toBe(200);
    const envelope = fresh.json() as { data: { config: { snapshot_hash: string; snapshot: Record<string, unknown> }; directory: null } };
    delete envelope.data.config.snapshot.inventory;
    envelope.data.config.snapshot_hash = sha256hex(canonicalJson(envelope.data.config.snapshot));
    const withoutKey = await hubFor({ fetchConfig: async () => ({ kind: 'ok', text: JSON.stringify(envelope) }) });
    const plain = configPoller(withoutKey.app);
    expect((await plain.pollOnce()).outcome).toBe('applied');
    expect(plain.lastProblem()).toBeNull();
    expect(readBranchConfigRow(withoutKey.deps.db, lakeCity())?.config_version).toBe(v.config);
    expect(buildCostInputs(undefined).items.size).toBe(0); // T-3: an absent key = inventory not configured
  }, 60_000);

  it('[08b #27b] a key with one items[] row of kind semi_prepared and one malformed recipes[] element: every other sale line is costed from it on the hub (dropped = 1)', async () => {
    await seedRecipes();
    const built = (await buildCounted()).snapshot.inventory as InventorySnapshot;
    const broken = structuredClone(built) as unknown as { items: unknown[]; recipes: unknown[] };
    broken.items.push({ stock_item_id: 'SK-SEMI', kind: 'semi_prepared', name: 'Semi', code: null, stock_unit: 'g', cost_category: 'food', is_a_item: false });
    broken.recipes.push({ recipe_version_id: 42, lines: 'none' });
    const clean = buildCostInputs(built);
    const lenient = buildCostInputs(broken);
    expect(lenient.dropped).toBe(1);
    const lines = [
      { kind: 'item' as const, item_id: fx.items.tawaPiece, quantity: 2n, sale_unit: 'piece' as const, options: [{ option_id: fx.options.spicy, quantity: 1n }] },
      { kind: 'item' as const, item_id: fx.items.chickenKarahi, quantity: 500n, sale_unit: 'g' as const, options: [] },
    ];
    for (const line of lines) {
      const expected = plateCost(clean, line, lakeCity(), T);
      expect(expected.status).toBe('costed');
      expect(plateCost(lenient, line, lakeCity(), T)).toEqual(expected);
    }
  });

  it('[08b #28] no hub file reads the inventory key (outside the events schemas); the engine has no inventory code', () => {
    const root = fileURLToPath(new URL('../../../../', import.meta.url));
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : files(path);
        return /\.(ts|tsx)$/.test(name) ? [path] : [];
      });
    const readers = [...files(join(root, 'apps/hub/src')), ...files(join(root, 'packages/engine/src'))].filter((path) =>
      /\binventory\b|InventorySnapshot|InventoryElementsLenient|buildCostInputs|costing/.test(readFileSync(path, 'utf8')),
    );
    expect(readers).toEqual([]);
  });
});

// 08b test 33 (AD-7): the release delivery — after 0019 migrates, a hub on the pre-migration version gets a 200
// whose snapshot carries the inventory key.
describe('[08b #33, A-6] release: the pre-migration version gets the inventory key', () => {
  const TN = 't1';
  let pool: pg.Pool;
  const q = (text: string, params: unknown[] = []) => pool.query(text, params);
  const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

  beforeAll(async () => {
    ({ pool } = await scratchDatabaseAt(18));
  }, 60_000);
  afterAll(async () => {
    await dropScratchDatabases();
  });

  it('[08b #33] GET /v1/sync/config with the pre-migration version returns 200 with inventory', async () => {
    await q(`INSERT INTO tenants (tenant_id, name, currency_code, created_at) VALUES ($1, 'Pilot', 'PKR', $2)`, [TN, T]);
    await q(`INSERT INTO branches (tenant_id, branch_id, name, status, created_at) VALUES ($1, 'b1', 'b1', 'pending_hub', $2)`, [TN, T]);
    await q(`INSERT INTO branch_engine_settings (tenant_id, branch_id, created_at, updated_at) VALUES ($1, 'b1', $2, $2)`, [TN, T]);
    await q(
      `INSERT INTO stock_items (tenant_id, stock_item_id, name, stock_unit, kind, carries_over, created_at, updated_at)
       VALUES ($1, 's2', 'Beef', 'g', 'ingredient', false, $2, $2)`,
      [TN, T],
    );
    const pre = Number((await q(`SELECT config_version FROM branches WHERE branch_id = 'b1'`)).rows[0].config_version);
    await migrate(pool, migrationsDir, fixedClock(T));
    const directory = Number((await q(`SELECT directory_version FROM tenants WHERE tenant_id = $1`, [TN])).rows[0].directory_version);
    const result = await syncConfig(pool, fixedClock(T), assertTenantContext(Object.freeze({ tenantId: TN, branchIds: Object.freeze(['b1']) })), {
      config_version: pre,
      directory_version: directory,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const snapshot = result.data.config!.snapshot as { config_version: number; inventory: InventorySnapshot };
    expect(snapshot.config_version).toBe(pre + 1);
    expect(InventorySnapshotSchema.parse(snapshot.inventory)).toEqual({
      items: [{ stock_item_id: 's2', kind: 'ingredient', name: 'Beef', code: null, stock_unit: 'g', cost_category: 'food', is_a_item: false }],
      units: [],
      prices: [],
      yields: [],
      recipes: [],
    });
  });
});

// 08b test 26 (B16, rows P-1, A-2′): a write bumps exactly the branches whose snapshot it changes. Every bump is the
// write's last lock (01a S8: branch rows last): the beforeBump hook fires after the write's other statements, and
// only the bump (2 statements every branch, 1 for one branch) plus withIdempotency's key response and prune follow.
// Recipe create / draft save (bump none) are lane R's routes (r1 / r2), not registered here.
describe('[08b #26, B16] bump rule on the 08a writes', () => {
  let cloud: TestCloud;
  let counter: ReturnType<typeof pgCounter>;
  let fx: RecipeFixture;
  let atBump: number | null = null;

  beforeAll(async () => {
    cloud = await createTestCloud({
      testHooks: {
        handlerStart: () => {
          counter.reset();
          atBump = null;
        },
        beforeBump: async () => {
          atBump = counter.count;
        },
      },
    });
    counter = pgCounter(cloud.pool);
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    cloud.clock.set(T);
    fx = await recipeFixture(cloud);
  }, 60_000);

  const tenantCtx = () => Object.freeze({ tenantId: fx.f.tenantId, branchIds: Object.freeze([...fx.f.branches]) });
  const versions = async () =>
    Object.fromEntries(
      (
        await cloud.pool.query<{ branch_id: string; config_version: string }>(
          `SELECT branch_id, config_version FROM branches WHERE tenant_id = $1 ORDER BY branch_id`,
          [fx.f.tenantId],
        )
      ).rows.map((row) => [row.branch_id, Number(row.config_version)]),
    );
  // every branch's built snapshot (fixed header, so a branch whose rows did not change builds the same bytes)
  const snapshots = async () => {
    const client = await cloud.pool.connect();
    try {
      const out: Record<string, { body: string; inventory: string }> = {};
      for (const branchId of fx.f.branches) {
        const snapshot = await buildSnapshot(client, tenantCtx(), branchId, HEADER);
        out[branchId] = { body: sha256hex(canonicalJson(snapshot)), inventory: sha256hex(canonicalJson(snapshot.inventory)) };
      }
      return out;
    } finally {
      client.release();
    }
  };
  const write = async (method: 'POST' | 'PATCH', url: string, payload: object, status: number) => {
    const response = await cloud.app.inject({ method, url, ...owner(fx.f), payload });
    expect(response.statusCode, response.body).toBe(status);
    return { statements: counter.count, atBump, data: response.json().data };
  };
  // the bumped branches gain exactly 1 and their inventory changes; every other branch keeps its version and its
  // whole snapshot
  const expectBumped = async (run: () => Promise<unknown>, bumped: readonly string[]) => {
    const v0 = await versions();
    const s0 = await snapshots();
    await run();
    const v1 = await versions();
    const s1 = await snapshots();
    for (const branchId of fx.f.branches) {
      if (bumped.includes(branchId)) {
        expect(v1[branchId], branchId).toBe(v0[branchId]! + 1);
        expect(s1[branchId]!.inventory, branchId).not.toBe(s0[branchId]!.inventory);
      } else {
        expect(v1[branchId], branchId).toBe(v0[branchId]);
        expect(s1[branchId]!.body, branchId).toBe(s0[branchId]!.body);
      }
    }
  };

  it('[08b #26] item unit POST bumps every branch: 9 statements, the bump last', async () => {
    await expectBumped(async () => {
      const r = await write('POST', `/v1/admin/stock-items/${fx.ids.beef}/units`, { unit_name: 'tin', factor_num: 16_000 }, 201);
      expect(r.statements).toBe(9);
      expect(r.atBump).toBe(9 - 4); // then 2 bump, key response, prune
    }, fx.f.branches);
  });

  it('[08b #26] yield POST bumps every branch: 9 statements, the bump last', async () => {
    await expectBumped(async () => {
      const r = await write('POST', `/v1/admin/stock-items/${fx.stock.onion}/yields`, { yield_bp: 9_000 }, 201);
      expect(r.statements).toBe(9);
      expect(r.atBump).toBe(9 - 4);
    }, fx.f.branches);
  });

  it('[08b #26] every-branch price POST bumps every branch: 11 statements, the bump last', async () => {
    await expectBumped(async () => {
      const r = await write('POST', `/v1/admin/stock-items/${fx.stock.onion}/prices`, { kind: 'manual', unit_name: 'kg', price_minor: 12_000 }, 201);
      expect(r.statements).toBe(11);
      expect(r.atBump).toBe(11 - 4);
    }, fx.f.branches);
  });

  it('[08b #26] a branch market rate bumps that branch only (1 statement): 11 statements, the bump last; other branches unchanged', async () => {
    await expectBumped(async () => {
      const r = await write(
        'POST',
        `/v1/admin/stock-items/${fx.ids.beef}/prices`,
        { kind: 'market_rate', branch_id: fx.lakeCity, unit_name: 'kg', price_minor: 170_000, valid_for_hours: 24 },
        201,
      );
      expect(r.statements).toBe(11);
      expect(r.atBump).toBe(11 - 3); // then 1 bump, key response, prune
    }, [fx.lakeCity]);
    expect(fx.f.branches.length).toBeGreaterThan(1);
  });

  it('[08b #26] stock-item PATCH of is_a_item / kind / code / cost_category bumps every branch, the bump last', async () => {
    const patch = async (payload: object) => {
      const fresh = await stockItem(cloud, fx.f, fx.stock.onion);
      return write('PATCH', `/v1/admin/stock-items/${fx.stock.onion}`, { expected_version: fresh.version, ...payload }, 200);
    };
    await expectBumped(async () => {
      const r = await patch({ is_a_item: true });
      expect(r.statements).toBe(6); // tenant-wide, lock, update, audit, 2 bump
      expect(r.atBump).toBe(6 - 2);
    }, fx.f.branches);
    await expectBumped(() => patch({ cost_category: 'beverage' }), fx.f.branches);
    await expectBumped(() => patch({ code: 'ON-1' }), fx.f.branches);
    await expectBumped(() => patch({ kind: 'packet' }), fx.f.branches);
  });
});
