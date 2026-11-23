import { describe, expect, it } from 'vitest';
import * as root from '../index';
import { CostWire, CreateRecipeBody, PatchRecipeBody, PublishRecipeBody, RecipeListQuery, RecipeSummaryWire, SaveDraftBody } from './recipes';

// 08 v1.1 Part B §5.4, §3.3 (400 rules): the recipe wires and bodies (P0.4).

const lines = (n: number) => Array.from({ length: n }, (_, i) => ({ stock_item_id: `S${i}`, unit_name: 'g', qty: '10' }));

describe('[08b §5.4] recipe wires and bodies', () => {
  it('[08b §3.3] SaveDraftBody: ≤ 60 lines, a stock item once, qty pattern and ≠ 0, ranges → 400', () => {
    const ok = (body: unknown) => SaveDraftBody.safeParse(body).success;
    expect(ok({ expected_version: null, lines: [] })).toBe(true);
    expect(ok({ expected_version: 'v1', lines: lines(60), base_qty: 1000, batch_yield_qty: 160, misc_allowance_bp: 0 })).toBe(true);
    expect(ok({ expected_version: null, lines: lines(61) })).toBe(false);
    expect(ok({ expected_version: null, lines: [...lines(1), ...lines(1)] })).toBe(false);
    for (const qty of ['0.92', '-30', '123456.1234', '1']) expect(ok({ expected_version: null, lines: [{ stock_item_id: 'S', unit_name: 'L', qty }] })).toBe(true);
    for (const qty of ['0', '-0.0', '1234567', '1.12345', '1,5', '', '.5', '1e3']) expect(ok({ expected_version: null, lines: [{ stock_item_id: 'S', unit_name: 'g', qty }] })).toBe(false);
    expect(ok({ expected_version: null, lines: [], misc_allowance_bp: 5001 })).toBe(false);
    expect(ok({ expected_version: null, lines: [], base_qty: 0 })).toBe(false);
    expect(ok({ expected_version: null, lines: [], base_qty: 1_000_001 })).toBe(false);
    expect(ok({ expected_version: null, lines: [], batch_yield_qty: 1_000_000_001 })).toBe(false);
    expect(ok({ lines: [] })).toBe(false); // expected_version is required (null = no draft yet)
    expect(ok({ expected_version: null, lines: [{ stock_item_id: 'S', unit_name: 'g', qty: '1', qty_basis: 'XP' }] })).toBe(false);
    // unit_name: any string at the body; resolving it is the route's 422 not_convertible (§3.3)
    expect(ok({ expected_version: null, lines: [{ stock_item_id: 'S', unit_name: '', qty: '1' }] })).toBe(true);
  });

  it('[08b §6.3, §6.5, §6.6] create / publish / patch bodies; list query', () => {
    expect(CreateRecipeBody.safeParse({ owner_type: 'stock_item', owner_id: 'S1' }).success).toBe(true);
    expect(CreateRecipeBody.safeParse({ owner_type: 'deal', owner_id: 'D1' }).success).toBe(false);
    expect(PublishRecipeBody.safeParse({}).success).toBe(false);
    expect(PatchRecipeBody.safeParse({ expected_version: 'v', archived: false }).success).toBe(true);
    expect(PatchRecipeBody.safeParse({ expected_version: 'v' }).success).toBe(false);
    expect(RecipeListQuery.parse({})).toEqual({ filter: 'all' });
    expect(RecipeListQuery.safeParse({ filter: 'costed' }).success).toBe(false);
  });

  it('[08b §5.4 t-6] CostWire: minor is a decimal string or null (never "0" for a missing cost); summary row without a recipe', () => {
    expect(CostWire.safeParse({ status: 'partial', minor: null, unknown_items: ['S1'] }).success).toBe(true);
    expect(CostWire.safeParse({ status: 'costed', minor: '-120', unknown_items: [] }).success).toBe(true);
    expect(CostWire.safeParse({ status: 'costed', minor: 120, unknown_items: [] }).success).toBe(false);
    const row = { recipe_id: null, owner_type: 'menu_item', owner_id: 'I1', owner_name: 'Tawa piece', owner_archived: false, archived: false, has_draft: false, published: null, plate_cost: { status: 'no_recipe', minor: null, unknown_items: [] }, version: null };
    expect(RecipeSummaryWire.parse(row)).toEqual(row);
    expect(root.SaveDraftBody).toBe(SaveDraftBody);
  });
});
