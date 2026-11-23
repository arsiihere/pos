import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CloudTestHooks } from '../../src/server';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';
import { recipeFixture } from './fixtures';

// 08b P0.5 (§10.4, m-14): the shared fixture is what the plan says, built on real tables through the 01c / 08a
// routes, and CloudTestHooks carries the two optional 08b seams (no-ops unless a test sets them; the routes that
// call them are r1 / r2's).
describe('08b recipe fixture and CloudTestHooks (§10.4, m-14)', () => {
  let cloud: TestCloud;
  beforeAll(async () => {
    cloud = await createTestCloud();
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });

  it('[08b P0.5] Lake City; ingredients with prices and yields; PAYE-COOKED prepared; four sale units; options; a two-part deal; no recipe yet', async () => {
    const fx = await recipeFixture(cloud);
    const q = (sql: string, params: unknown[] = []) => cloud.pool.query(sql, [fx.f.tenantId, ...params]);
    const kinds = await q(`SELECT name, kind, stock_unit FROM stock_items WHERE tenant_id = $1 ORDER BY name COLLATE "C"`);
    expect(kinds.rows).toEqual([
      { name: 'Adrak-lehsan', kind: 'ingredient', stock_unit: 'g' },
      { name: 'Beef', kind: 'ingredient', stock_unit: 'g' },
      { name: 'Ghee', kind: 'ingredient', stock_unit: 'g' },
      { name: 'Makhan', kind: 'ingredient', stock_unit: 'g' },
      { name: 'Milk', kind: 'ingredient', stock_unit: 'ml' },
      { name: 'Oil', kind: 'ingredient', stock_unit: 'ml' },
      { name: 'Onion', kind: 'ingredient', stock_unit: 'g' },
      { name: 'PAYE-COOKED', kind: 'prepared', stock_unit: 'piece' },
      { name: 'PY-1 paye packet', kind: 'packet', stock_unit: 'g' },
      { name: 'Paye raw', kind: 'ingredient', stock_unit: 'g' },
      { name: 'Shorba', kind: 'ingredient', stock_unit: 'ml' },
      { name: 'TP-1 tikka packet', kind: 'packet', stock_unit: 'g' },
    ]);
    const priced = await q(`SELECT s.name, p.price_minor::text AS minor, p.stock_qty_num::text AS qty FROM item_prices p JOIN stock_items s USING (tenant_id, stock_item_id) WHERE p.tenant_id = $1 ORDER BY s.name COLLATE "C"`);
    expect(priced.rows).toEqual([
      { name: 'Beef', minor: '150000', qty: '1000' },
      { name: 'Ghee', minor: '200000', qty: '1000' },
      { name: 'Makhan', minor: '180000', qty: '1000' },
      { name: 'Milk', minor: '20000', qty: '1000' },
      { name: 'Oil', minor: '60000', qty: '1000' },
      { name: 'PY-1 paye packet', minor: '50000', qty: '1000' },
      { name: 'Paye raw', minor: '80000', qty: '1000' },
      { name: 'Shorba', minor: '10000', qty: '1000' },
      { name: 'TP-1 tikka packet', minor: '30000', qty: '1000' },
    ]);
    const yields = await q(`SELECT stock_item_id, yield_bp FROM yield_profiles WHERE tenant_id = $1 ORDER BY yield_bp`);
    expect(yields.rows).toEqual([
      { stock_item_id: fx.stock.payeRaw, yield_bp: 6000 },
      { stock_item_id: fx.stock.beef, yield_bp: 7120 },
    ]);
    expect((await q(`SELECT unit_name, factor_num::int AS n FROM stock_item_units WHERE tenant_id = $1 AND stock_item_id = $2`, [fx.stock.ghee])).rows).toEqual([{ unit_name: 'l', n: 920 }]);
    const units = await q(`SELECT item_id, sale_unit FROM menu_items WHERE tenant_id = $1 AND item_id = ANY($2) ORDER BY name COLLATE "C"`, [Object.values(fx.items)]);
    expect(units.rows).toEqual([
      { item_id: fx.items.chickenKarahi, sale_unit: 'g' },
      { item_id: fx.items.lassi, sale_unit: 'ml' },
      { item_id: fx.items.naan, sale_unit: 'piece' },
      { item_id: fx.items.payeHalf, sale_unit: 'piece' },
      { item_id: fx.items.tawaPiece, sale_unit: 'piece' },
    ]);
    const options = await q(`SELECT option_id, linked_item_id FROM modifier_options WHERE tenant_id = $1 AND modifier_group_id = $2 ORDER BY sort_order, name`, [fx.options.groupId]);
    expect(Object.fromEntries(options.rows.map((r) => [r.option_id, r.linked_item_id]))).toEqual({ [fx.options.spicy]: null, [fx.options.noOnion]: null, [fx.options.extraNaan]: fx.items.naan });
    const parts = await q(`SELECT deal_part_id, quantity FROM deal_parts WHERE tenant_id = $1 AND deal_id = $2 ORDER BY quantity`, [fx.deal.dealId]);
    expect(parts.rows).toEqual([
      { deal_part_id: fx.deal.karahiPartId, quantity: 1 },
      { deal_part_id: fx.deal.tawaPartId, quantity: 2 },
    ]);
    expect((await q(`SELECT count(*)::int AS n FROM recipes WHERE tenant_id = $1`)).rows[0]).toEqual({ n: 0 });
  });

  it('[08b P0.5] CloudTestHooks has the optional afterRecipeLock / afterPublishLock seams', () => {
    const hooks: CloudTestHooks = { afterRecipeLock: async () => {}, afterPublishLock: async () => {} };
    expect(Object.keys(hooks).sort()).toEqual(['afterPublishLock', 'afterRecipeLock']);
  });
});
