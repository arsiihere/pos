/// <reference types="node" />
import type { AddressInfo } from 'node:net';
import { BranchConfigSnapshotSchemaV3, type BranchConfig } from '@pos/events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemo } from '../../src/cli/seed-demo';
import { buildSnapshot, type SnapshotHeader } from '../../src/modules/config-sync/builder';
import { createTestCloud, truncateAll, type TestCloud } from '../helpers/test-cloud';

const HEADER: SnapshotHeader = {
  config_version: 1,
  currency_code: 'PKR',
  tax_enabled: false,
  day_stale_after_hours: 16,
  day_min_gap_hours: 4,
};

// The tables seed-demo writes; a second run must leave every count unchanged.
const TABLES = [
  'tenants',
  'branches',
  'staff',
  'stations',
  'menu_items',
  'item_routes',
  'variant_groups',
  'stock_items',
  'stock_item_branches',
  'stock_draws',
  'modifier_groups',
  'modifier_options',
  'modifier_group_links',
  'deals',
  'deal_parts',
  'deal_part_choices',
  'deal_branches',
  'config_audit',
];

describe('seed-demo', () => {
  let cloud: TestCloud;
  let base: string;

  beforeAll(async () => {
    cloud = await createTestCloud();
    await truncateAll(cloud.pool);
    await cloud.app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(cloud.app.server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await cloud.close();
  });

  const counts = async () => {
    const out: Record<string, number> = {};
    for (const table of TABLES) {
      out[table] = (await cloud.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n;
    }
    return out;
  };
  const snapshots = async (): Promise<Array<{ name: string; snapshot: BranchConfig }>> => {
    const branches = (
      await cloud.pool.query<{ tenant_id: string; branch_id: string; name: string }>(`SELECT tenant_id, branch_id, name FROM branches ORDER BY name`)
    ).rows;
    const tenant = Object.freeze({ tenantId: branches[0]!.tenant_id, branchIds: Object.freeze(branches.map((b) => b.branch_id)) });
    const client = await cloud.pool.connect();
    try {
      const out: Array<{ name: string; snapshot: BranchConfig }> = [];
      for (const b of branches) {
        out.push({ name: b.name, snapshot: BranchConfigSnapshotSchemaV3.parse(await buildSnapshot(client, tenant, b.branch_id, HEADER)) });
      }
      return out;
    } finally {
      client.release();
    }
  };

  it(
    '[01c §7] variant group Chicken Karahi Half/Full on one Karahi pot counted at Karahi everywhere; Spice level on category Karahi; Bread links Naan; Family karahi deal sold at every branch; snapshots parse as schema 2; a second run is a no-op',
    async () => {
      const out: string[] = [];
      await seedDemo(base, 'Arif Chatkhara', { pool: cloud.pool, out: (text) => out.push(text) });
      expect(out.join('')).toContain('registration code');

      const all = await snapshots();
      expect(all.map((b) => b.name)).toEqual(['DHA', 'Gulberg', 'Johar Town']);
      for (const { name, snapshot: s } of all) {
        const stationName = new Map(s.stations.map((st) => [st.station_id, st.name]));
        const category = s.categories.find((c) => c.name === 'Karahi')!;
        expect(category, name).toBeDefined();

        // §1, V2: one variant group, two members drawing 500 g / 1 000 g from one Karahi pot (V3, V4).
        const groups = s.variant_groups.filter((g) => g.name === 'Chicken Karahi');
        expect(groups, name).toHaveLength(1);
        const group = groups[0]!;
        expect(group.category_id).toBe(category.category_id);
        const pots = s.stock_items.filter((si) => si.name === 'Karahi pot');
        expect(pots, name).toHaveLength(1);
        const pot = pots[0]!;
        expect(pot.stock_unit).toBe('g');
        expect(stationName.get(pot.station_id), name).toBe('Karahi');
        const members = s.items.filter((i) => i.variant_group_id === group.variant_group_id);
        expect(members.map((i) => [i.variant_name, i.sale_unit, i.stock_draws, stationName.get(i.station_id)]), name).toEqual([
          ['Half', 'piece', [{ stock_item_id: pot.stock_item_id, quantity_per_sale_unit: 500 }], 'Karahi'],
          ['Full', 'piece', [{ stock_item_id: pot.stock_item_id, quantity_per_sale_unit: 1000 }], 'Karahi'],
        ]);

        // m-7: the stock 01a tracked on items is now stock items with branch rows and draws.
        expect(s.stock_items.length, name).toBeGreaterThan(1);
        const tikka = s.items.find((i) => i.name === 'Chicken tikka')!;
        const tikkaStock = s.stock_items.find((si) => si.name === 'Chicken tikka')!;
        expect(tikka.stock_draws).toEqual([{ stock_item_id: tikkaStock.stock_item_id, quantity_per_sale_unit: 1 }]);
        expect(tikkaStock.low_stock_threshold).toBe(10);
        const biryani = s.items.find((i) => i.name === 'Chicken biryani')!;
        const biryaniStock = s.stock_items.find((si) => si.name === 'Chicken biryani')!;
        expect(biryaniStock.stock_unit).toBe('g');
        expect(biryani.stock_draws).toEqual([{ stock_item_id: biryaniStock.stock_item_id, quantity_per_sale_unit: 350 }]);

        // V6, V8: Spice level (min 1, max 1, Normal default) on every item of category Karahi.
        const spice = s.modifier_groups.find((g) => g.name === 'Spice level')!;
        expect(spice, name).toBeDefined();
        expect([spice.min_choices, spice.max_choices]).toEqual([1, 1]);
        expect(spice.options.filter((o) => o.is_default).map((o) => o.name)).toEqual(['Normal']);
        const karahiItems = s.items.filter((i) => i.category_id === category.category_id);
        expect(karahiItems.length).toBeGreaterThanOrEqual(2);
        for (const item of karahiItems) expect(item.modifier_group_ids, item.name).toContain(spice.modifier_group_id);

        // Bread: a linked option to Naan (a piece item).
        const naan = s.items.find((i) => i.name === 'Naan')!;
        expect(naan.sale_unit).toBe('piece');
        const bread = s.modifier_groups.find((g) => g.name === 'Bread')!;
        expect(bread, name).toBeDefined();
        expect(bread.options.map((o) => o.linked_item_id)).toEqual([naan.item_id]);
        for (const item of members) expect(item.modifier_group_ids).toContain(bread.modifier_group_id);

        // V10: the deal is sold here (in the snapshot only with a §6.16 row).
        const deal = s.deals.find((d) => d.name === 'Family karahi deal')!;
        expect(deal, name).toBeDefined();
        expect(deal.parts[0]!.choices.map((c) => c.item_id)).toEqual([members[1]!.item_id]);
      }

      // Idempotent: the second run writes nothing and does not fail.
      const before = await counts();
      const again: string[] = [];
      expect(await seedDemo(base, 'Arif Chatkhara', { pool: cloud.pool, out: (text) => again.push(text) })).toBe(0);
      expect(again.join('')).toContain('already seeded');
      expect(await counts()).toEqual(before);
    },
    120_000,
  );

  // Runs on the seed above. The owner is committed first (seed-tenant), so a run that dies part-way leaves it;
  // the seed's last write is the last staff PIN (Imran). Without it the seed is incomplete: refuse, write nothing.
  it('[01c §7] AD-36 b: the owner exists but the seed did not finish → "partially seeded", exit code 1, nothing written', async () => {
    await cloud.pool.query(`UPDATE staff SET pin_hash = NULL, pin_set_at = NULL WHERE display_name = 'Imran'`);
    const tenantId = (await cloud.pool.query<{ tenant_id: string }>(`SELECT tenant_id FROM tenants`)).rows[0]!.tenant_id;
    const before = await counts();
    const out: string[] = [];
    const code = await seedDemo(base, 'Arif Chatkhara', { pool: cloud.pool, out: (text) => out.push(text) });
    expect(code).toBe(1);
    expect(out.join('')).toContain(`partially seeded: tenant_id ${tenantId}`);
    expect(out.join('')).not.toContain('already seeded');
    expect(await counts()).toEqual(before);
    const pin = await cloud.pool.query<{ pin_hash: string | null }>(`SELECT pin_hash FROM staff WHERE display_name = 'Imran'`);
    expect(pin.rows[0]!.pin_hash).toBeNull();
  });
});
