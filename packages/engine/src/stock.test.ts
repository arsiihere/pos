import type { ConfigItem, ConfigItemV1 } from '@pos/events';
import {
  aBranchConfig,
  aBranchConfigV1,
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

function item(id: string, o: Partial<ConfigItemV1> = {}): ConfigItemV1 {
  const found = aBranchConfigV1().items.find((i) => i.item_id === id);
  if (found === undefined) throw new Error(id);
  return { ...found, ...o };
}

function withEntry(itemId: string, entry: StockEntry): EngineState {
  return { ...initialEngineState(), stock: { [itemId]: entry } };
}

function stockSet(itemId: string, onHand: number, unit: string, at: number) {
  return aStockSet({ stream_id: itemId, recorded_at: at, payload: { stock_item_id: itemId, on_hand: onHand, unit } });
}

function stockAdded(itemId: string, quantity: number, unit: string, at: number) {
  return aStockAdded({ stream_id: itemId, recorded_at: at, payload: { stock_item_id: itemId, quantity, unit } });
}

describe('@pos/engine stock slice', () => {
  it('[01a §10 #66] StockSet keeps reserved; available never negative; on_hand and reserved never below 0', () => {
    const i1 = item('I1');
    const s0 = withEntry('I1', { on_hand: 5, reserved: 2, set_at: T0, unit: 'piece' });
    const s1 = applyEvent(s0, stockSet('I1', 4, 'piece', T1));
    expect(stockOf(s1, 'I1')).toEqual({ on_hand: 4, reserved: 2, set_at: T1, unit: 'piece' });
    expect(availableStock(s1, 'I1', T0, i1)).toBe(2);
    const s2 = applyEvent(s1, stockSet('I1', 1, 'piece', T1));
    expect(availableStock(s2, 'I1', T0, i1)).toBe(0);

    const full = withEntry('I1', { on_hand: 5, reserved: 5, set_at: T0, unit: 'piece' });
    const s3 = applyEvent(full, stockSet('I1', 3, 'piece', T1));
    expect(stockOf(s3, 'I1')).toMatchObject({ on_hand: 3, reserved: 5 });
    expect(availableStock(s3, 'I1', T0, i1)).toBe(0);
    for (const s of [s1, s2, s3]) {
      expect(stockOf(s, 'I1').on_hand).toBeGreaterThanOrEqual(0);
      expect(stockOf(s, 'I1').reserved).toBeGreaterThanOrEqual(0);
    }
  });

  it('[01a §10 #129] StockAdded adds; StockSet resets set_at; unit mismatch; sale units; a mismatched add throws', () => {
    const i3 = item('I3'); // stock_unit 'g', 250 g per piece
    const s0 = withEntry('I3', { on_hand: 500, reserved: 0, set_at: T0, unit: 'g' });
    const s1 = applyEvent(s0, stockAdded('I3', 250, 'g', T1));
    expect(stockOf(s1, 'I3')).toEqual({ on_hand: 750, reserved: 0, set_at: T0, unit: 'g' });
    const s2 = applyEvent(s1, stockSet('I3', 300, 'g', T1));
    expect(stockOf(s2, 'I3')).toMatchObject({ on_hand: 300, set_at: T1 });

    const inPieces = { ...i3, stock_unit: 'piece' as const, stock_per_sale_unit: 1 };
    expect(countIsValid(stockOf(s1, 'I3'), T0, { carries_over: false, stock_unit: 'piece' })).toBe(false);
    expect(availableStock(s1, 'I3', T0, inPieces)).toBe(0);
    expect(countIsValid(stockOf(s1, 'I3'), T0, { carries_over: false, stock_unit: 'g' })).toBe(true);

    expect(saleUnitsAvailable(750, 250)).toBe(3);
    expect(saleUnitsAvailable(749, 250)).toBe(2);

    expect(() => applyEvent(s1, stockAdded('I3', 1, 'piece', T1))).toThrow('StockAdded unit mismatch');
    expect(stockOf(s1, 'I3')).toEqual({ on_hand: 750, reserved: 0, set_at: T0, unit: 'g' });
  });

  it('[01a §10 #148] canServeFromStock needs the whole line', () => {
    expect(canServeFromStock(1_000, 4, 250)).toBe(true);
    expect(canServeFromStock(999, 4, 250)).toBe(false);
    expect(canServeFromStock(100, 1, 250)).toBe(false);
    expect(canServeFromStock(300, 500, 1)).toBe(false);
    expect(canServeFromStock(500, 500, 1)).toBe(true);
    expect(canServeFromStock(0, 1, 1)).toBe(false);
  });

  it('[01a S41] availableStock follows the count validity rule', () => {
    const i1 = item('I1');
    const kept = item('I1', { carries_over: true });
    const s = withEntry('I1', { on_hand: 7, reserved: 2, set_at: T0, unit: 'piece' });
    expect(availableStock(s, 'I1', T1, i1)).toBe(0); // set_at before start
    expect(availableStock(s, 'I1', T0, i1)).toBe(5); // at start
    expect(availableStock(s, 'I1', T0 - 1, i1)).toBe(5); // after start
    expect(availableStock(s, 'I1', null, i1)).toBe(0); // no day open
    expect(availableStock(s, 'I1', T1, kept)).toBe(5);
    expect(availableStock(s, 'I1', null, kept)).toBe(5);
    const never = withEntry('I1', { on_hand: 7, reserved: 0, set_at: null, unit: 'piece' });
    expect(availableStock(never, 'I1', T0, i1)).toBe(0);
    expect(availableStock(never, 'I1', T0, kept)).toBe(0);
  });

  it('[01a §10 #157] the threshold applies only in its own unit: no low while the open day froze another unit', () => {
    const day = (unit: 'piece' | 'g', at: number) => ({
      business_date: '2026-10-25',
      opened_at: at,
      closed_at: null,
      stock_units: { I1: unit },
      draws: { I1: { sale_unit: 'piece' as const, stock_draws: [{ stock_item_id: 'I1', quantity_per_sale_unit: unit === 'g' ? 250 : 1 }] } },
    });
    // The config now says g with a 1 000 g threshold; the open day froze piece.
    const grams = item('I1', { stock_unit: 'g', sale_unit: 'piece', stock_per_sale_unit: 250, low_stock_threshold: 1000 });
    const pieceDay = (onHand: number): EngineState => ({
      stock: { I1: { on_hand: onHand, reserved: 0, set_at: T1, unit: 'piece' } },
      business_day: day('piece', T0),
    });
    expect(stockLevel(pieceDay(5), 'I1', T0, grams)).toBe('ok');
    expect(stockLevel(pieceDay(0), 'I1', T0, grams)).toBe('out');

    // The next open froze g: the threshold applies again.
    const gramDay = (onHand: number): EngineState => ({
      stock: { I1: { on_hand: onHand, reserved: 0, set_at: T1, unit: 'g' } },
      business_day: day('g', T0),
    });
    expect(stockLevel(gramDay(500), 'I1', T0, grams)).toBe('low');
    expect(stockLevel(gramDay(1500), 'I1', T0, grams)).toBe('ok');
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
    const s = withEntry('I1', { on_hand: 1, reserved: 0, set_at: T0, unit: 'piece' });
    expect(applyEvent(s, aHubStarted())).toBe(s);
  });
});
