import { createDeal, createModifierGroup, createStockItem } from '../helpers/menu-variants';
import { owner } from '../helpers/restaurant';
import type { TestCloud } from '../helpers/test-cloud';
import { inventoryFixture, type InventoryFixture } from '../inventory/fixtures';

// 08 v1.1 Part B §10.4 (m-14) shared fixture (P0.5): 08a's inventoryFixture (tenant A, Lake City, PAYE-COOKED
// prepared piece counted at Lake City, beef / ghee / paye raw ingredients in g, TP-1 packet, "Paye Half" drawing 1
// PAYE-COOKED) plus, through the 01c / 08a routes:
// - onion (ingredient g, no price, no yield), milk (ingredient ml), shorba (ingredient ml), oil (ingredient ml,
//   Rs 600 / l, no yield), makhan (ingredient g, Rs 1 800 / kg, no yield), adrak-lehsan (ingredient g, no price),
//   PY-1 (packet g, code PY-1, Rs 500 / kg) — the §6.4 Tawa piece and §6.5 PAYE-COOKED edge lines
// - prices (manual, every branch): beef Rs 1 500 / kg, ghee Rs 2 000 / kg, paye raw Rs 800 / kg, TP-1 Rs 300 / kg,
//   milk Rs 200 / l, shorba Rs 100 / l; onion has none (a `no_menu_cost` / partial line)
// - yields: beef 71.20 % (7 120 bp); paye raw 60 %; onion, ghee, milk none (the M-7 AP default)
// - item unit: `l` on ghee = 920 g (the §6.4 "ghee 0.92 l" edge → 846.4 g)
// - menu items: "Tawa piece" (piece), "Chicken karahi" (g), "Lassi" (ml), "Naan" (piece), and 08a's "Paye Half"
// - modifier group "Choices": plain "Spicy" (Rs 0), plain removal "No onion" (Rs 0), linked "Extra naan" (→ Naan)
// - deal "Family deal": part 1 = 1 × Chicken karahi, part 2 = 2 × Tawa piece
// No recipe exists yet: each lane creates its own through the §6.3 route (or SQL where the route is not its own).
// Kinds / codes are set by SQL in inventoryFixture; nothing here depends on 08b code.
export interface RecipeFixture extends InventoryFixture {
  stock: InventoryFixture['ids'] & { onion: string; milk: string; shorba: string; oil: string; makhan: string; adrak: string; py1: string };
  items: { tawaPiece: string; chickenKarahi: string; lassi: string; naan: string; payeHalf: string };
  options: { groupId: string; spicy: string; noOnion: string; extraNaan: string };
  deal: { dealId: string; karahiPartId: string; tawaPartId: string };
}

export async function recipeFixture(cloud: TestCloud): Promise<RecipeFixture> {
  const fx = await inventoryFixture(cloud);
  const { f, menu, lakeCity } = fx;
  const set = (id: string, sql: string) => cloud.pool.query(`UPDATE stock_items SET ${sql} WHERE tenant_id = $1 AND stock_item_id = $2`, [f.tenantId, id]);
  const onion = (await createStockItem(cloud, f, { name: 'Onion', stock_unit: 'g', carries_over: false })).stock_item_id;
  const milk = (await createStockItem(cloud, f, { name: 'Milk', stock_unit: 'ml', carries_over: false })).stock_item_id;
  const shorba = (await createStockItem(cloud, f, { name: 'Shorba', stock_unit: 'ml', carries_over: false })).stock_item_id;
  const oil = (await createStockItem(cloud, f, { name: 'Oil', stock_unit: 'ml', carries_over: false })).stock_item_id;
  const makhan = (await createStockItem(cloud, f, { name: 'Makhan', stock_unit: 'g', carries_over: false })).stock_item_id;
  const adrak = (await createStockItem(cloud, f, { name: 'Adrak-lehsan', stock_unit: 'g', carries_over: false })).stock_item_id;
  const py1 = (await createStockItem(cloud, f, { name: 'PY-1 paye packet', stock_unit: 'g', carries_over: false })).stock_item_id;
  for (const id of [onion, milk, shorba, oil, makhan, adrak]) await set(id, `kind = 'ingredient'`);
  await set(py1, `kind = 'packet', code = 'PY-1'`);

  const post = async (url: string, payload: object) => {
    const response = await cloud.app.inject({ method: 'POST', url, ...owner(f), payload });
    if (response.statusCode !== 201) throw new Error(`POST ${url} failed: ${response.statusCode} ${response.body}`);
    return response.json().data as Record<string, unknown>;
  };
  const price = (id: string, unit_name: string, price_minor: number) => post(`/v1/admin/stock-items/${id}/prices`, { kind: 'manual', unit_name, price_minor });
  await price(fx.ids.beef, 'kg', 150_000);
  await price(fx.ids.ghee, 'kg', 200_000);
  await price(fx.ids.payeRaw, 'kg', 80_000);
  await price(fx.ids.tp1, 'kg', 30_000);
  await price(milk, 'l', 20_000);
  await price(shorba, 'l', 10_000);
  await price(oil, 'l', 60_000);
  await price(makhan, 'kg', 180_000);
  await price(py1, 'kg', 50_000);
  await post(`/v1/admin/stock-items/${fx.ids.beef}/yields`, { yield_bp: 7120 });
  await post(`/v1/admin/stock-items/${fx.ids.payeRaw}/yields`, { yield_bp: 6000 });
  await post(`/v1/admin/stock-items/${fx.ids.ghee}/units`, { unit_name: 'l', factor_num: 920 });

  const item = async (name: string, sale_unit: 'piece' | 'g' | 'ml', price_minor: number) => {
    const data = await post('/v1/admin/menu-items', {
      category_id: menu.categoryIds[0],
      tax_class_id: null,
      name,
      price_minor,
      sale_unit,
      serve_mode: 'sync',
      cook_time_ms: 600_000,
      routes: [{ branch_id: lakeCity, station_id: menu.slotStationId }],
    });
    return (data.item as { item_id: string }).item_id;
  };
  const tawaPiece = await item('Tawa piece', 'piece', 45_000);
  const chickenKarahi = await item('Chicken karahi', 'g', 220_000);
  const lassi = await item('Lassi', 'ml', 40_000);
  const naan = await item('Naan', 'piece', 3_000);

  const group = await createModifierGroup(cloud, f, {
    name: 'Choices',
    min_choices: 0,
    max_choices: 3,
    options: [
      { name: 'Spicy', price_minor: 0 },
      { name: 'No onion', price_minor: 0 },
      { name: 'Extra naan', linked_item_id: naan },
    ],
  });
  const optionId = (name: string) => group.options.find((o) => o.name === name)!.option_id;

  const deal = await createDeal(cloud, f, {
    name: 'Family deal',
    category_id: menu.categoryIds[0],
    tax_class_id: null,
    price_minor: 400_000,
    parts: [
      { quantity: 1, choices: [{ item_id: chickenKarahi }] },
      { quantity: 2, sort_order: 1, choices: [{ item_id: tawaPiece }] },
    ],
  });
  const partOf = (itemId: string) => deal.parts.find((p) => p.choices.some((c) => c.item_id === itemId))!.deal_part_id;

  return {
    ...fx,
    stock: { ...fx.ids, onion, milk, shorba, oil, makhan, adrak, py1 },
    items: { tawaPiece, chickenKarahi, lassi, naan, payeHalf: fx.payeHalfItemId },
    options: { groupId: group.modifier_group_id, spicy: optionId('Spicy'), noOnion: optionId('No onion'), extraNaan: optionId('Extra naan') },
    deal: { dealId: deal.deal_id, karahiPartId: partOf(chickenKarahi), tawaPartId: partOf(tawaPiece) },
  };
}
