import { describe, expect, it } from 'vitest';
import type { StockItemInventoryData } from '../../../api/cloud-admin';
import { costText, coverageText, derivedBasis, liveLineCost, livePlateCost, makesText, measureText, miscPercentText, parseMiscPercent, parseQty, roundHalfAway } from './recipes';

// 08b §8 pure texts and the editor's live cost (B4, B5, B9): exact bigint fractions, rounded once, half away from zero.
const inv = (over: Partial<StockItemInventoryData['stock_item']>, menu: string | null, yieldBp: number | null): StockItemInventoryData =>
  ({
    can_edit_tenant: true,
    stock_item: { stock_item_id: 'S', name: 'S', stock_unit: 'g', carries_over: false, archived_at: null, kind: 'ingredient', code: null, cost_category: 'food', is_a_item: false, version: 'v', ...over },
    builtin_units: [{ unit_name: 'kg', base: 'g', num: 1000, den: 1 }, { unit_name: 'l', base: 'ml', num: 1000, den: 1 }],
    units: [{ unit_row_id: 'U', unit_name: 'peti', base_unit: 'g', factor_num: '12000', factor_den: 1, is_current: true, note: null, recorded_by: 'O', recorded_by_name: 'O', created_at: 0 }],
    prices: [],
    menu_cost: menu === null ? null : { branch_id: null, price_id: 'P', per_stock_unit: { num: menu, den: '1' }, display_per: { unit: 'kg', minor: '0', below_one_minor: false } },
    yields: [],
    active_yield: yieldBp === null ? null : { yield_profile_id: 'Y', yield_bp: yieldBp, test_ap_qty: null, test_ep_qty: null, test_unit: null, note: null, recorded_by: 'O', recorded_by_name: 'O', created_at: 0 },
  }) as StockItemInventoryData;

describe('[08b §8] recipe texts and live cost', () => {
  it('[08b #29] CostWire texts; a negative option cost keeps its sign; coverage rounds half up', () => {
    expect(costText({ status: 'costed', minor: '41250' })).toBe('Rs 412.50');
    expect(costText({ status: 'costed', minor: '-550' })).toBe('Rs -5.50');
    expect(costText({ status: 'partial', minor: null })).toBe('No cost yet · partial');
    expect(costText({ status: 'no_recipe', minor: null })).toBe('No recipe');
    expect(coverageText({ items_total: 3, items_with_recipe: 2, pct_bp: 6667 })).toBe('2 of 3 items have a recipe — 67 %');
  });

  it('[08b #30] basis texts, quantities, misc percent, derived AP / EP default (M-7)', () => {
    expect(measureText('g', 1000)).toBe('per kg');
    expect(measureText('ml', 1000)).toBe('per litre');
    expect(measureText('g', 500)).toBe('per 500 g');
    expect(makesText('160', 'piece')).toBe('makes 160 piece');
    expect(parseQty('0.25')).toEqual({ num: 25n, den: 100n });
    expect(parseQty('-30')).toEqual({ num: -30n, den: 1n });
    expect(parseQty('0')).toBeNull();
    expect(parseQty('1.23456')).toBeNull();
    expect(parseMiscPercent('5')).toBe(500);
    expect(parseMiscPercent('12.5')).toBe(1250);
    expect(parseMiscPercent('50.01')).toBeNull();
    expect(miscPercentText(1250)).toBe('12.5');
    expect(derivedBasis('per_unit', 'ingredient', true)).toBe('EP');
    expect(derivedBasis('per_unit', 'ingredient', false)).toBe('AP');
    expect(derivedBasis('per_unit', 'ingredient', null)).toBeNull();
    expect(derivedBasis('per_batch', 'ingredient', true)).toBe('AP');
    expect(derivedBasis('per_measure', 'packet', null)).toBe('AP');
  });

  it('[08b #30] line cost = qty × unit × menu cost ÷ yield (EP ingredient); unknown when no menu cost, EP without yield, prepared', () => {
    const beef = inv({}, '150', 7120);
    expect(liveLineCost(beef, { qty: '1', unit_name: 'peti', basis: 'AP' })).toEqual({ known: true, value: { num: 1800000n, den: 1n } });
    const ep = liveLineCost(beef, { qty: '250', unit_name: 'g', basis: 'EP' });
    expect(ep.known && roundHalfAway(ep.value)).toBe(52669n);
    expect(liveLineCost(inv({}, '150', null), { qty: '250', unit_name: 'g', basis: 'EP' })).toEqual({ known: false });
    expect(liveLineCost(inv({}, null, null), { qty: '250', unit_name: 'g', basis: 'AP' })).toEqual({ known: false });
    expect(liveLineCost(inv({ kind: 'prepared' }, '150', null), { qty: '1', unit_name: 'g', basis: 'AP' })).toEqual({ known: false });
    expect(liveLineCost(beef, { qty: '1', unit_name: 'l', basis: 'AP' })).toEqual({ known: false });
    expect(roundHalfAway({ num: -5n, den: 2n })).toBe(-3n);
    expect(roundHalfAway({ num: 5n, den: 2n })).toBe(3n);
  });

  it('[08b #30] plate cost: misc at the top only (B5), partial with the known part, minor null when nothing is known, empty option = 0', () => {
    const a = { known: true as const, value: { num: 1000n, den: 1n } };
    expect(livePlateCost([a], 500, true)).toEqual({ status: 'costed', minor: '1050', unknown_items: [] });
    expect(livePlateCost([a], 500, false)).toEqual({ status: 'costed', minor: '1000', unknown_items: [] });
    expect(livePlateCost([a, { known: false }], 500, true).status).toBe('partial');
    expect(livePlateCost([{ known: false }], 500, true)).toEqual({ status: 'partial', minor: null, unknown_items: [] });
    expect(livePlateCost([], 500, true)).toEqual({ status: 'costed', minor: '0', unknown_items: [] });
    expect(livePlateCost([], 500, true, false)).toEqual({ status: 'partial', minor: null, unknown_items: [] }); // AD-25
  });
});
