import { buildCostInputs } from '@pos/domain';
import { describe, expect, it } from 'vitest';
import { aBranchConfig } from '../testing/index';
import * as root from './index';
import { BranchConfigSnapshotSchemaV4, InventoryElementsLenient, InventorySnapshotSchema } from './config';

// 08 v1.1 Part B §5.3, B15 (c), rows A-3; tests 24 / 27 / 27b at the schema level (the builder and hub halves are
// s1's). AD-12: buildCostInputs (@pos/domain, no zod) and InventoryElementsLenient decide every element alike.

const item = { stock_item_id: 'S1', kind: 'ingredient', name: 'Beef', code: 'BF-1', stock_unit: 'g', cost_category: 'food', is_a_item: true };
const unit = { stock_item_id: 'S1', unit_name: 'peti', factor_num: '20000', factor_den: '1' };
const price = {
  price_id: 'P1',
  stock_item_id: 'S1',
  branch_id: null,
  kind: 'market_rate',
  unit_name: 'kg',
  stock_unit: 'g',
  price_minor: '150000',
  stock_qty_num: '1000',
  stock_qty_den: '1',
  created_at: 1_700_000_000_000,
  valid_until_at: 1_700_086_400_000,
};
const line = { stock_item_id: 'S1', stock_qty_num: '-30', stock_qty_den: '1', stock_unit: 'g', qty_basis: 'AP' };
const recipe = {
  recipe_version_id: 'V1',
  status: 'published',
  owner_type: 'menu_item',
  owner_id: 'I1',
  basis: 'per_measure',
  base_qty: 1000,
  measure_unit: 'g',
  recipe_archived: false,
  batch_yield_qty: null,
  batch_stock_unit: null,
  misc_allowance_bp: 500,
  published_at: 1_700_000_000_000,
  lines: [line],
};
const key = { items: [item], units: [unit], prices: [price], yields: [{ stock_item_id: 'S1', yield_bp: 7120 }], recipes: [recipe] };

describe('[08b §5.3] InventorySnapshotSchema, InventoryElementsLenient, V4 inventory key', () => {
  it('[08b #24] the typed schema parses a key; not .strict(): an extra field on items[] parses (stripped)', () => {
    expect(InventorySnapshotSchema.parse(key)).toEqual(key);
    const extra = { ...key, items: [{ ...item, counted_daily: true }], extra_top: 1 };
    const parsed = InventorySnapshotSchema.parse(extra);
    expect(parsed.items[0]).toEqual(item);
    expect('extra_top' in parsed).toBe(false);
    // typed enums: an unknown kind fails the typed schema (the builder logs inventory_key_invalid, N-4)
    expect(InventorySnapshotSchema.safeParse({ ...key, items: [{ ...item, kind: 'semi_prepared' }] }).success).toBe(false);
    expect(root.InventorySnapshotSchema).toBe(InventorySnapshotSchema);
    expect(root.InventoryElementsLenient).toBe(InventoryElementsLenient);
  });

  it('[08b #27 M-5, A-3] V4: inventory is z.unknown().optional() — a body without it parses, a body with a broken one still parses, kept raw', () => {
    const base = aBranchConfig();
    expect(BranchConfigSnapshotSchemaV4.safeParse(base).success).toBe(true);
    const broken = { ...base, inventory: { items: 'not an array', recipes: [{ nonsense: true }] } };
    const parsed = BranchConfigSnapshotSchemaV4.parse(broken);
    expect(parsed.inventory).toEqual(broken.inventory);
    expect(BranchConfigSnapshotSchemaV4.parse({ ...base, inventory: key }).inventory).toEqual(key);
  });

  it('[08b #27b t-5] lenient elements: enum-like fields as strings; malformed elements fail', () => {
    expect(InventoryElementsLenient.item.safeParse({ ...item, kind: 'semi_prepared' }).success).toBe(true);
    expect(InventoryElementsLenient.item.safeParse({ ...item, stock_unit: 'tola' }).success).toBe(true);
    expect(InventoryElementsLenient.item.safeParse({ ...item, is_a_item: 'yes' }).success).toBe(false);
    expect(InventoryElementsLenient.price.safeParse({ ...price, kind: 'quote' }).success).toBe(true);
    expect(InventoryElementsLenient.price.safeParse({ ...price, price_minor: 12.5 }).success).toBe(false);
    expect(InventoryElementsLenient.recipe.safeParse({ ...recipe, basis: 'per_kg', lines: [{ junk: 1 }] }).success).toBe(true); // lines checked one by one
    expect(InventoryElementsLenient.line.safeParse({ ...line, qty_basis: 'XP' }).success).toBe(true);
    expect(InventoryElementsLenient.line.safeParse({ ...line, stock_qty_num: 'abc' }).success).toBe(false);
  });

  it('[08b AD-12] buildCostInputs keeps exactly the elements InventoryElementsLenient accepts', () => {
    const cases: Array<[keyof typeof key, keyof typeof InventoryElementsLenient, unknown]> = [
      ['items', 'item', item],
      ['items', 'item', { ...item, kind: 'semi_prepared', extra: 1 }],
      ['items', 'item', { ...item, code: 5 }],
      ['items', 'item', { ...item, is_a_item: 'no' }],
      ['items', 'item', { ...item, name: undefined }],
      ['units', 'unit', unit],
      ['units', 'unit', { ...unit, factor_num: 20000 }],
      ['units', 'unit', { ...unit, factor_den: '1.5' }],
      ['units', 'unit', { ...unit, factor_den: '0' }],
      ['prices', 'price', { ...price, stock_qty_num: '0' }],
      ['prices', 'price', { ...price, price_minor: '0' }],
      ['yields', 'yield', { stock_item_id: 'S1', yield_bp: 0 }],
      ['yields', 'yield', { stock_item_id: 'S1', yield_bp: 50_001 }],
      ['recipes', 'recipe', { ...recipe, batch_yield_qty: '0' }],
      ['recipes', 'recipe', { ...recipe, batch_yield_qty: '160', base_qty: null }],
      ['prices', 'price', price],
      ['prices', 'price', { ...price, kind: 'quote' }],
      ['prices', 'price', { ...price, price_minor: 12.5 }],
      ['prices', 'price', { ...price, valid_until_at: '1' }],
      ['prices', 'price', { ...price, created_at: 1.5 }],
      ['prices', 'price', { ...price, branch_id: 7 }],
      ['yields', 'yield', { stock_item_id: 'S1', yield_bp: 7120 }],
      ['yields', 'yield', { stock_item_id: 'S1', yield_bp: '7120' }],
      ['recipes', 'recipe', recipe],
      ['recipes', 'recipe', { ...recipe, basis: 'per_kg', owner_type: 'deal' }],
      ['recipes', 'recipe', { ...recipe, base_qty: '1000' }],
      ['recipes', 'recipe', { ...recipe, recipe_archived: 'no' }],
      ['recipes', 'recipe', { ...recipe, batch_yield_qty: 160 }],
      ['recipes', 'recipe', { ...recipe, lines: 'x' }],
      ['recipes', 'recipe', { ...recipe, misc_allowance_bp: -20000 }],
      ['recipes', 'recipe', { ...recipe, misc_allowance_bp: 5001 }],
      ['prices', 'price', { ...price, price_minor: '123456789012345678901234' }], // long digits: both keep
      ['prices', 'price', { ...price, created_at: 2 ** 60 }], // not a safe integer: both drop
    ];
    for (const [arr, kind, element] of cases) {
      const accepted = InventoryElementsLenient[kind].safeParse(element).success;
      const inputs = buildCostInputs({ items: [], units: [], prices: [], yields: [], recipes: [], [arr]: [element] });
      expect({ element, kept: inputs.dropped === 0 }).toEqual({ element, kept: accepted });
    }
    const lineCases: unknown[] = [line, { ...line, qty_basis: 'XP', stock_unit: 'tola' }, { ...line, stock_qty_num: 'abc' }, { ...line, stock_qty_den: '-1' }, { ...line, stock_qty_num: 30 }, { ...line, stock_qty_num: '0' }, { ...line, stock_qty_den: '0' }, { ...line, stock_qty_num: '-0' }];
    for (const l of lineCases) {
      const accepted = InventoryElementsLenient.line.safeParse(l).success;
      const inputs = buildCostInputs({ items: [], units: [], prices: [], yields: [], recipes: [{ ...recipe, lines: [l] }] });
      expect({ l, kept: inputs.dropped === 0 }).toEqual({ l, kept: accepted });
    }
  });
});
