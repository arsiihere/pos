import { describe, expect, it } from 'vitest';
import type { BillView, BillViewSplit } from './contracts';
import { closedUnits, initialColumns, moveUnit, nextSplitNo, openUnits, parseMinor, unplacedOf } from './splits';

// 05 §3.8, §6.5 (task 36): the split editor's arithmetic over the open remainder — units only; money is the hub's.

const zero = { subtotal_minor: 0, discount_minor: 0, service_charge_minor: 0, taxes: [], rounding_minor: 0, total_minor: 0 };
const split = (over: Partial<BillViewSplit> & { split_no: number }): BillViewSplit => ({
  state: 'open',
  plan: null,
  payments: [],
  totals: { cash: zero, digital: zero, as_paid: zero },
  balance_minor: 0,
  invoice: null,
  ...over,
});
const line = (id: string, name: string, units: number, added_after_close = false) => ({ order_item_id: id, order_id: 'O1', name, units, base_minor: 100, tax_profile_id: 'p', tags: [], added_after_close });

function bill(splits: BillViewSplit[]): BillView {
  return {
    bill_id: 'B7',
    state: 'open',
    order_type: 'dine_in',
    identifier: 'T7',
    lines: [line('K', 'Chicken Karahi Full', 1), line('N', 'Naan', 6), line('R', 'Raita', 2)],
    splits,
    currency: { code: 'PKR', exponent: 2 },
    as_of_seq: 3,
  };
}

describe('[05 §3.8] open remainder units', () => {
  it('a closed item split keeps its units; the open remainder is the rest (a line fully closed drops out)', () => {
    const b = bill([split({ split_no: 1, state: 'closed', plan: { lines: [{ order_item_id: 'K', units: 1 }, { order_item_id: 'N', units: 2 }] } }), split({ split_no: 2 })]);
    expect([...closedUnits(b)]).toEqual([['K', 1], ['N', 2]]);
    expect([...openUnits(b)]).toEqual([['N', 4], ['R', 2]]);
  });

  it('no plan: every open unit starts in the lowest open split, plus an empty next split to place into', () => {
    const cols = initialColumns(bill([split({ split_no: 1 })]));
    expect(cols.map((c) => [c.split_no, [...c.lines]])).toEqual([[1, [['K', 1], ['N', 6], ['R', 2]]], [2, []]]);
  });

  it('an item plan on the open splits is the starting placement', () => {
    const b = bill([
      split({ split_no: 1, plan: { lines: [{ order_item_id: 'K', units: 1 }, { order_item_id: 'N', units: 3 }] } }),
      split({ split_no: 2, plan: { lines: [{ order_item_id: 'N', units: 3 }, { order_item_id: 'R', units: 2 }] } }),
    ]);
    expect(initialColumns(b).map((c) => [c.split_no, [...c.lines]])).toEqual([[1, [['K', 1], ['N', 3]]], [2, [['N', 3], ['R', 2]]]]);
  });

  it('unplaced = open units minus what the columns hold; moving one unit keeps the total', () => {
    const b = bill([split({ split_no: 1 })]);
    let cols = initialColumns(b);
    cols = moveUnit(cols, 'N', 1, 2);
    cols = moveUnit(cols, 'N', 1, 2);
    expect(cols.map((c) => c.lines.get('N') ?? 0)).toEqual([4, 2]);
    expect([...unplacedOf(openUnits(b), cols)]).toEqual([]);
    // from the pool (null): a unit no column holds
    const short = [{ split_no: 1, lines: new Map([['K', 1], ['N', 4]]) }, { split_no: 2, lines: new Map<string, number>() }];
    expect([...unplacedOf(openUnits(b), short)]).toEqual([['N', 2], ['R', 2]]);
    const placed = moveUnit(short, 'R', null, 2);
    expect(placed[1]!.lines.get('R')).toBe(1);
    // a source with no unit of the line moves nothing
    expect(moveUnit(short, 'R', 2, 1)).toBe(short);
  });

  it('a new split takes the lowest number not held by a closed or listed split (max 20)', () => {
    expect(nextSplitNo([1, 2])).toBe(3);
    expect(nextSplitNo([1, 3])).toBe(2);
    expect(nextSplitNo(Array.from({ length: 20 }, (_, i) => i + 1))).toBeNull();
  });
});

describe('[05 §8 i18n; row F-6] parseMinor', () => {
  it('typed major units → minor units at the currency exponent; commas ignored; too many decimals refused', () => {
    expect(parseMinor('4,000.00', 2)).toBe(400_000);
    expect(parseMinor('2624', 2)).toBe(262_400);
    expect(parseMinor('1.5', 2)).toBe(150);
    expect(parseMinor('6.624', 3)).toBe(6_624);
    expect(parseMinor('500', 0)).toBe(500);
    expect(parseMinor('1.234', 2)).toBeNull();
    expect(parseMinor('1.5', 0)).toBeNull();
    expect(parseMinor('', 2)).toBeNull();
    expect(parseMinor('-3', 2)).toBeNull();
    expect(parseMinor('abc', 2)).toBeNull();
  });
});
