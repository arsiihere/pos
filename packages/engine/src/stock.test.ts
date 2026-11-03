import type { ConfigItem, ConfigStockItem } from '@pos/events';
import {
  aBranchConfig,
  aBusinessDayClosed,
  aBusinessDayOpened,
  aHubStarted,
  aStockAdded,
  aStockSet,
} from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import {
  availableStock,
  canServeFromStock,
  countIsValid,
  dayDraws,
  dayStockUnit,
  initialEngineState,
  saleUnitsAvailable,
  stockLevel,
  stockOf,
  applyEvent,
  type EngineState,
  type StockEntry,
} from './index';

const T0 = 1_761_000_000_000;
const T1 = T0 + 60_000;

// 01c §3.5.1: carries_over and stock_unit from the stock item, the threshold from its branch row.
function stockItem(id: string, o: Partial<ConfigStockItem> = {}): ConfigStockItem {
  const found = aBranchConfig().stock_items.find((s) => s.stock_item_id === id);
  if (found === undefined) throw new Error(id);
  return { ...found, ...o };
}

function configItem(id: string): ConfigItem {
  const found = aBranchConfig().items.find((i) => i.item_id === id);
  if (found === undefined) throw new Error(id);
  return found;
}

function withEntry(stockItemId: string, entry: StockEntry): EngineState {
  return { ...initialEngineState(), stock: { [stockItemId]: entry } };
}

function stockSet(stockItemId: string, onHand: number, unit: string, at: number) {
  return aStockSet({ stream_id: stockItemId, recorded_at: at, payload: { stock_item_id: stockItemId, on_hand: onHand, unit } });
}

function stockAdded(stockItemId: string, quantity: number, unit: string, at: number) {
  return aStockAdded({ stream_id: stockItemId, recorded_at: at, payload: { stock_item_id: stockItemId, quantity, unit } });
}

describe('@pos/engine stock slice', () => {
  it('[01a §10 #66] StockSet keeps reserved; available never negative; on_hand and reserved never below 0', () => {
    const k1 = stockItem('K1'); // 'g'
    const s0 = withEntry('K1', { on_hand: 5, reserved: 2, set_at: T0, unit: 'g' });
    const s1 = applyEvent(s0, stockSet('K1', 4, 'g', T1));
    expect(stockOf(s1, 'K1')).toEqual({ on_hand: 4, reserved: 2, set_at: T1, unit: 'g' });
    expect(availableStock(s1, 'K1', T0, k1)).toBe(2);
    const s2 = applyEvent(s1, stockSet('K1', 1, 'g', T1));
    expect(availableStock(s2, 'K1', T0, k1)).toBe(0);

    const full = withEntry('K1', { on_hand: 5, reserved: 5, set_at: T0, unit: 'g' });
    const s3 = applyEvent(full, stockSet('K1', 3, 'g', T1));
    expect(stockOf(s3, 'K1')).toMatchObject({ on_hand: 3, reserved: 5 });
    expect(availableStock(s3, 'K1', T0, k1)).toBe(0);
    for (const s of [s1, s2, s3]) {
      expect(stockOf(s, 'K1').on_hand).toBeGreaterThanOrEqual(0);
      expect(stockOf(s, 'K1').reserved).toBeGreaterThanOrEqual(0);
    }
  });

  it('[01a §10 #129] StockAdded adds; StockSet resets set_at; unit mismatch; sale units; a mismatched add throws', () => {
    const k1 = stockItem('K1'); // stock_unit 'g'
    const s0 = withEntry('K1', { on_hand: 500, reserved: 0, set_at: T0, unit: 'g' });
    const s1 = applyEvent(s0, stockAdded('K1', 250, 'g', T1));
    expect(stockOf(s1, 'K1')).toEqual({ on_hand: 750, reserved: 0, set_at: T0, unit: 'g' });
    const s2 = applyEvent(s1, stockSet('K1', 300, 'g', T1));
    expect(stockOf(s2, 'K1')).toMatchObject({ on_hand: 300, set_at: T1 });

    const inPieces = stockItem('K1', { stock_unit: 'piece' });
    expect(countIsValid(stockOf(s1, 'K1'), T0, { carries_over: false, stock_unit: 'piece' })).toBe(false);
    expect(availableStock(s1, 'K1', T0, inPieces)).toBe(0);
    expect(countIsValid(stockOf(s1, 'K1'), T0, { carries_over: false, stock_unit: 'g' })).toBe(true);
    expect(availableStock(s1, 'K1', T0, k1)).toBe(750);

    expect(saleUnitsAvailable(750, 250)).toBe(3);
    expect(saleUnitsAvailable(749, 250)).toBe(2);

    expect(() => applyEvent(s1, stockAdded('K1', 1, 'piece', T1))).toThrow('StockAdded unit mismatch');
    expect(stockOf(s1, 'K1')).toEqual({ on_hand: 750, reserved: 0, set_at: T0, unit: 'g' });
  });

  it('[01a §10 #148] canServeFromStock needs the whole line', () => {
    expect(canServeFromStock(1_000, 4, 250)).toBe(true);
    expect(canServeFromStock(999, 4, 250)).toBe(false);
    expect(canServeFromStock(100, 1, 250)).toBe(false);
    expect(canServeFromStock(300, 500, 1)).toBe(false);
    expect(canServeFromStock(500, 500, 1)).toBe(true);
    expect(canServeFromStock(0, 1, 1)).toBe(false);
  });

  it('[01c #69] canServeFromStock per draw: Half (500 g) with 400 g available → false; Full (1 000 g) with 1 000 g → true', () => {
    const config = aBranchConfig();
    const k1 = stockItem('K1');
    const units = Object.fromEntries(config.stock_items.map((s) => [s.stock_item_id, s.stock_unit]));
    const halfDraw = dayDraws(initialEngineState(), configItem('I1'), units).stock_draws[0]!;
    const fullDraw = dayDraws(initialEngineState(), configItem('I3'), units).stock_draws[0]!;
    expect(halfDraw).toEqual({ stock_item_id: 'K1', quantity_per_sale_unit: 500 });
    expect(fullDraw).toEqual({ stock_item_id: 'K1', quantity_per_sale_unit: 1_000 });

    const at400 = withEntry('K1', { on_hand: 400, reserved: 0, set_at: T0, unit: 'g' });
    expect(canServeFromStock(availableStock(at400, halfDraw.stock_item_id, T0, k1), 1, halfDraw.quantity_per_sale_unit)).toBe(false);
    const at1000 = withEntry('K1', { on_hand: 1_000, reserved: 0, set_at: T0, unit: 'g' });
    expect(canServeFromStock(availableStock(at1000, fullDraw.stock_item_id, T0, k1), 1, fullDraw.quantity_per_sale_unit)).toBe(true);
  });

  it('[01a S41] availableStock follows the count validity rule', () => {
    const k1 = stockItem('K1');
    const kept = stockItem('K1', { carries_over: true });
    const s = withEntry('K1', { on_hand: 7, reserved: 2, set_at: T0, unit: 'g' });
    expect(availableStock(s, 'K1', T1, k1)).toBe(0); // set_at before start
    expect(availableStock(s, 'K1', T0, k1)).toBe(5); // at start
    expect(availableStock(s, 'K1', T0 - 1, k1)).toBe(5); // after start
    expect(availableStock(s, 'K1', null, k1)).toBe(0); // no day open
    expect(availableStock(s, 'K1', T1, kept)).toBe(5);
    expect(availableStock(s, 'K1', null, kept)).toBe(5);
    const never = withEntry('K1', { on_hand: 7, reserved: 0, set_at: null, unit: 'g' });
    expect(availableStock(never, 'K1', T0, k1)).toBe(0);
    expect(availableStock(never, 'K1', T0, kept)).toBe(0);
  });

  it('[01a §10 #157] the threshold applies only in its own unit: no low while the open day froze another unit', () => {
    const day = (unit: 'piece' | 'g', at: number) => ({
      business_date: '2026-10-25',
      opened_at: at,
      closed_at: null,
      stock_units: { K1: unit },
      draws: { I1: { sale_unit: 'piece' as const, stock_draws: [{ stock_item_id: 'K1', quantity_per_sale_unit: unit === 'g' ? 500 : 1 }] } },
    });
    // The config now counts the pot in g with a 1 000 g threshold; the open day froze piece.
    const grams = stockItem('K1', { stock_unit: 'g', low_stock_threshold: 1000 });
    const pieceDay = (onHand: number): EngineState => ({
      ...initialEngineState(),
      stock: { K1: { on_hand: onHand, reserved: 0, set_at: T1, unit: 'piece' } },
      business_day: day('piece', T0),
    });
    expect(stockLevel(pieceDay(5), 'K1', T0, grams)).toBe('ok');
    expect(stockLevel(pieceDay(0), 'K1', T0, grams)).toBe('out');

    // The next open froze g: the threshold applies again.
    const gramDay = (onHand: number): EngineState => ({
      ...initialEngineState(),
      stock: { K1: { on_hand: onHand, reserved: 0, set_at: T1, unit: 'g' } },
      business_day: day('g', T0),
    });
    expect(stockLevel(gramDay(500), 'K1', T0, grams)).toBe('low');
    expect(stockLevel(gramDay(1500), 'K1', T0, grams)).toBe('ok');
    expect(stockLevel(gramDay(500), 'K1', T0, stockItem('K1'))).toBe('ok'); // threshold null
  });

  it('[01c #108] dayDraws: an item added mid-day uses its config draw; a draw whose stock item changed unit mid-day is not used that day; after the next open the frozen draw', () => {
    const config = aBranchConfig();
    const half = config.items.find((i) => i.item_id === 'I1')!;
    const quarter: ConfigItem = {
      ...half,
      item_id: 'I4',
      name: 'Chicken Karahi — Quarter',
      variant_name: 'Quarter',
      sort_order: 4,
      stock_draws: [{ stock_item_id: 'K1', quantity_per_sale_unit: 250 }],
    };
    const quarterDraw = { sale_unit: 'piece', stock_draws: [{ stock_item_id: 'K1', quantity_per_sale_unit: 250 }] };
    // Day open with the pot frozen in g; Quarter is not in the day's draws.
    const open = applyEvent(
      initialEngineState(),
      aBusinessDayOpened({
        recorded_at: T0,
        payload: {
          business_date: '2026-10-25',
          stock_units: { K1: 'g' },
          draws: {
            I1: { sale_unit: 'piece', stock_draws: [{ stock_item_id: 'K1', quantity_per_sale_unit: 500 }] },
            I3: { sale_unit: 'piece', stock_draws: [{ stock_item_id: 'K1', quantity_per_sale_unit: 1_000 }] },
          },
        },
      }),
    );
    expect(dayDraws(open, quarter, { K1: 'g' })).toEqual(quarterDraw);
    expect(dayDraws(open, half, { K1: 'g' })).toEqual({ sale_unit: 'piece', stock_draws: [{ stock_item_id: 'K1', quantity_per_sale_unit: 500 }] });

    // The pot's config stock_unit changes to piece mid-day: Quarter is untracked for the day; Half keeps its frozen draw.
    expect(dayDraws(open, quarter, { K1: 'piece' })).toEqual({ sale_unit: 'piece', stock_draws: [] });
    expect(dayStockUnit(open, { stock_item_id: 'K1', stock_unit: 'piece' })).toBe('g');
    expect(dayDraws(open, half, { K1: 'piece' }).stock_draws).toEqual([{ stock_item_id: 'K1', quantity_per_sale_unit: 500 }]);

    // The next open freezes piece and Quarter's draw: used again.
    const closed = applyEvent(open, aBusinessDayClosed({ recorded_at: T1 }));
    const next = applyEvent(
      closed,
      aBusinessDayOpened({
        recorded_at: T1 + 1,
        payload: { business_date: '2026-10-26', stock_units: { K1: 'piece' }, draws: { I4: quarterDraw } },
      }),
    );
    expect(dayStockUnit(next, { stock_item_id: 'K1', stock_unit: 'piece' })).toBe('piece');
    expect(dayDraws(next, quarter, { K1: 'piece' })).toEqual(quarterDraw);
    expect(dayDraws(next, quarter, { K1: 'g' })).toEqual(quarterDraw);
  });

  it("[01a S14] stockOf on a missing item → { 0, 0, null, 'piece' }", () => {
    expect(stockOf(initialEngineState(), 'nope')).toEqual({ on_hand: 0, reserved: 0, set_at: null, unit: 'piece' });
  });

  it('[01a S15] applyEvent returns the same reference for a non-stock event', () => {
    const s = withEntry('K1', { on_hand: 1, reserved: 0, set_at: T0, unit: 'g' });
    expect(applyEvent(s, aHubStarted())).toBe(s);
  });
});
