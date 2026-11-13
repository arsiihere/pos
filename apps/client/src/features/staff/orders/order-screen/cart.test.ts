import { lineTotalMinor, optionChargeMinor, orderLineTotalMinor } from '@pos/domain';
import type { BranchConfig } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import type { EtaPreviewBody } from '../contracts';
import { addTap, cartCount, cartLineMoney, cartTotal, configUnits, groupCart, lineProblems, removeLine, setUnits, toEtaDraft, toSubmitLines, zoneCovered, type Cart, type UnitOf } from './cart';

// I1 Half Rs 1,200 (piece); I2 Mutton by weight (g, Rs 3,800 / kg); I4 Naan (linked from option OPN); plain option OPX
// "less oil" +Rs 40; deal D1 = 1 karahi (I1 or I3 +Rs 300) + 2 naan.
function cfg(): BranchConfig {
  const base = aBranchConfig();
  const item = (id: string, o: Record<string, unknown>) => ({ ...base.items.find((i) => i.item_id === 'I2')!, item_id: id, ...o });
  return {
    ...base,
    items: [
      ...base.items.map((i) => (i.item_id === 'I2' ? { ...i, sale_unit: 'g' as const, price_minor: 380_000, requires_weighing: true } : i)),
      item('I4', { name: 'Naan', price_minor: 4_000 }),
    ],
    modifier_groups: [
      {
        modifier_group_id: 'G1',
        name: 'Extras',
        min_choices: 0,
        max_choices: 3,
        sort_order: 1,
        has_plain_options: true,
        options: [
          { option_id: 'OPX', name: 'Less oil', price_minor: 4_000, max_quantity: 2, is_default: false, linked_item_id: null, sort_order: 1 },
          { option_id: 'OPN', name: 'Extra naan', price_minor: 4_000, max_quantity: 4, is_default: false, linked_item_id: 'I4', sort_order: 2 },
        ],
      },
    ],
    deals: [
      {
        deal_id: 'D1',
        category_id: 'C1',
        name: 'Family deal',
        description: null,
        sort_order: 1,
        price_minor: 250_000,
        tax_class_id: null,
        availability_windows: [],
        parts: [
          { deal_part_id: 'P1', quantity: 1, sort_order: 1, choices: [{ item_id: 'I1', extra_price_minor: 0, sort_order: 1 }, { item_id: 'I3', extra_price_minor: 30_000, sort_order: 2 }] },
          { deal_part_id: 'P2', quantity: 2, sort_order: 2, choices: [{ item_id: 'I4', extra_price_minor: 0, sort_order: 1 }] },
        ],
      },
    ],
  };
}

let n = 0;
const key = () => `K${++n}`;

describe('[02b §8 Ordering screen] cart', () => {
  it('[02b #36] cart sorted by ETA, grouped by promise ("Food together · 8:27 PM"); counter lines "From the counter · Now"', () => {
    const cart: Cart = { lines: ['A', 'B', 'C', 'D', 'E'].map((k) => ({ key: k, item_id: 'I1', quantity: 1, options: [] })) };
    const preview: EtaPreviewBody = {
      as_of_seq: 1,
      groups: [
        { promise_ms: 2_000_000, keys: ['A', 'C'] },
        { promise_ms: 1_000_000, keys: ['D'] },
      ],
      lines: [
        { key: 'A', eta_ms: 1_900_000, from_stock: false, zone_served: false },
        { key: 'B', eta_ms: null, from_stock: false, zone_served: true },
        { key: 'C', eta_ms: 1_500_000, from_stock: true, zone_served: false },
        { key: 'D', eta_ms: 900_000, from_stock: false, zone_served: false },
      ],
    };
    const groups = groupCart(cart, preview);
    expect(groups.map((g) => [g.kind, g.kind === 'promise' ? g.promise_ms : null, g.lines.map((l) => l.line.key).join('')])).toEqual([
      ['counter', null, 'B'],
      ['promise', 1_000_000, 'D'],
      ['promise', 2_000_000, 'CA'], // by time, not cart order
      ['pending', null, 'E'], // added after the reply
    ]);
    // no preview: one pending group in cart order
    expect(groupCart(cart, null)).toEqual([{ kind: 'pending', lines: cart.lines.map((line) => ({ line, eta_ms: null, refused: null })) }]);
    expect(groupCart({ lines: [] }, null)).toEqual([]);
  });

  it('[02b §8 Ordering screen] cart total = Σ orderLineTotalMinor (options, deal allocation) from @pos/domain', () => {
    const config = cfg();
    const karahi = { key: 'L1', item_id: 'I1', quantity: 2, options: [{ option_id: 'OPX', quantity: 1 }, { option_id: 'OPN', quantity: 2, order_item_id: 'L1c' }] };
    const mutton = { key: 'L2', item_id: 'I2', quantity: 1_250, options: [{ option_id: 'OPN', quantity: 3, order_item_id: 'L2c' }] };
    const pending = { key: 'L3', item_id: 'I2', quantity: null, options: [] };
    const deal = {
      key: 'L4',
      deal_id: 'D1',
      quantity: 2,
      options: [],
      deal_choices: [
        { deal_part_id: 'P1', item_id: 'I3', order_item_id: 'L4a', options: [{ option_id: 'OPX', quantity: 1 }] },
        { deal_part_id: 'P2', item_id: 'I4', order_item_id: 'L4b' },
      ],
    };
    // the hub's buildSubmit numbers, from @pos/domain:
    const karahiHub =
      orderLineTotalMinor({ line_kind: 'item', price_minor: 120_000, quantity: 2, sale_unit: 'piece', option_charges_minor: [optionChargeMinor(4_000, 1, 2, 'piece')] })! +
      orderLineTotalMinor({ line_kind: 'option_child', price_minor: 4_000, quantity: 4, option_charges_minor: [] })!; // 2 naan × 2 karahi
    const muttonHub =
      orderLineTotalMinor({ line_kind: 'item', price_minor: 380_000, quantity: 1_250, sale_unit: 'g', option_charges_minor: [] })! +
      orderLineTotalMinor({ line_kind: 'option_child', price_minor: 4_000, quantity: 3, option_charges_minor: [] })!; // g parent: option qty
    const dealHub = orderLineTotalMinor({
      line_kind: 'deal',
      price_minor: 250_000,
      quantity: 2,
      parts: [
        { sale_unit: 'piece', quantity: 1, extra_price_minor: 30_000, option_charges_minor: [optionChargeMinor(4_000, 1, 2, 'piece')] },
        { sale_unit: 'piece', quantity: 2, extra_price_minor: 0, option_charges_minor: [] },
      ],
    })!;
    const units = configUnits(config);
    const ok = (minor: number) => ({ kind: 'ok', minor });
    expect(cartLineMoney(config, karahi, units)).toEqual(ok(karahiHub));
    expect(karahiHub).toBe(240_000 + 8_000 + 16_000);
    expect(cartLineMoney(config, mutton, units)).toEqual(ok(muttonHub));
    expect(muttonHub).toBe(lineTotalMinor(380_000, 1_250, 'g') + 12_000);
    expect(cartLineMoney(config, pending, units)).toEqual({ kind: 'pending', minor: 0 });
    expect(cartLineMoney(config, deal, units)).toEqual(ok(dealHub));
    // the deal by the hub's rules, by hand (build-submit.ts :330-340, B2): 2 × Rs 2,500 + the Full extra Rs 300 × part
    // qty 1 × 2 deals + "less oil" Rs 40 × 1 per piece of the part (part qty 1 × deal qty 2) = 500 000 + 60 000 + 8 000
    expect(dealHub).toBe(568_000);
    expect(cartTotal(config, { lines: [karahi, mutton, pending, deal] }, units)).toBe(karahiHub + muttonHub + dealHub);
  });

  it('[02b §3.6] a "Weigh later" line: the parent waits for its weight, its linked children are billed now', () => {
    const config = cfg();
    // Mutton (g) weighed later with 3 extra naan: hub build-submit.ts :214 childQuantity(3, 0, 'g') = 3 (a g parent
    // takes the option qty), :233 the child's line_total = 3 × Rs 40; :247 the parent's orderLineTotalMinor = null.
    const later = { key: 'W1', item_id: 'I2', quantity: null, options: [{ option_id: 'OPN', quantity: 3, order_item_id: 'W1c' }] };
    const HUB_CHILDREN = 12_000;
    expect(cartLineMoney(config, later, configUnits(config))).toEqual({ kind: 'pending', minor: HUB_CHILDREN });
    expect(cartTotal(config, { lines: [later] }, configUnits(config))).toBe(HUB_CHILDREN);
    expect(cartCount({ lines: [later] }, configUnits(config))).toBe(1);
  });

  it('[02b §8 Ordering screen] money uses the day-frozen sale unit (01c V20), as the hub does', () => {
    const config = cfg();
    // I1 is sold by the piece in the config, but the open day froze it in g (BusinessDayOpened.draws): hub
    // build-submit.ts :145-147 unitOf = ctx.draws(item).sale_unit, :247-253 orderLineTotalMinor(…, sale_unit: unitOf)
    // → lineTotalMinor(120 000, 750, 'g') = 120 000 × 750 / 1 000 = 90 000 (whole rupees, S59).
    const dayUnits: UnitOf = (id) => (id === 'I1' ? 'g' : configUnits(config)(id));
    const line = { key: 'D1', item_id: 'I1', quantity: 750, options: [] };
    const HUB_DAY = 90_000;
    expect(cartLineMoney(config, line, dayUnits)).toEqual({ kind: 'ok', minor: HUB_DAY });
    expect(cartLineMoney(config, line, configUnits(config))).toEqual({ kind: 'ok', minor: 120_000 * 750 }); // the config's unit would bill 750 pieces
    expect(cartCount({ lines: [line] }, dayUnits)).toBe(1);
  });

  it('[02b §8 Ordering screen] missing menu data shows "—", never a lower price', () => {
    const config = cfg();
    const units = configUnits(config);
    const unknown = { kind: 'unknown' };
    expect(cartLineMoney(config, { key: 'X', item_id: 'GONE', quantity: 1, options: [] }, units)).toEqual(unknown);
    expect(cartLineMoney(config, { key: 'X', item_id: 'I1', quantity: 1, options: [{ option_id: 'GONE', quantity: 1 }] }, units)).toEqual(unknown);
    expect(cartLineMoney(config, { key: 'X', deal_id: 'D1', quantity: 1, options: [], deal_choices: [{ deal_part_id: 'P1', item_id: 'I1', order_item_id: 'a' }] }, units)).toEqual(unknown); // P2 not chosen
    expect(cartLineMoney(config, { key: 'X', deal_id: 'D1', quantity: 1, options: [], deal_choices: [{ deal_part_id: 'P1', item_id: 'I2', order_item_id: 'a' }, { deal_part_id: 'P2', item_id: 'I4', order_item_id: 'b' }] }, units)).toEqual(unknown); // I2 not a choice of P1
    expect(cartLineMoney(config, { key: 'X', item_id: 'I1', quantity: null, options: [] }, units)).toEqual(unknown); // a piece line has a quantity
    expect(cartTotal(config, { lines: [{ key: 'A', item_id: 'I1', quantity: 1, options: [] }, { key: 'X', item_id: 'GONE', quantity: 1, options: [] }] }, units)).toBeNull();
  });

  it('[02b §8 Zone items] zone tile "Raita · 6 here"; a tap adds or increments one from_zone line', () => {
    let cart: Cart = { lines: [] };
    cart = addTap(cart, 'I4', key, { from_zone: true });
    cart = addTap(cart, 'I4', key, { from_zone: true });
    cart = addTap(cart, 'I4', key); // a kitchen line stays its own line
    expect(cart.lines.map((l) => [l.item_id, l.quantity, l.from_zone === true])).toEqual([
      ['I4', 2, true],
      ['I4', 1, false],
    ]);
    const draft = toEtaDraft(cart, { order_type: 'dine_in', table_id: 'T1', seating_id: 'S1' });
    expect(draft.lines[0]).toEqual({ key: cart.lines[0]!.key, item_id: 'I4', quantity: 2, from_zone: true });
    expect(toSubmitLines(cart)[0]).toEqual({ order_item_id: cart.lines[0]!.key, item_id: 'I4', quantity: 2, from_zone: true });
  });

  it('[02b §8 Ordering screen] stepper capped (O15), remove; a sold_out line over the count is a line problem', () => {
    let cart: Cart = { lines: [] };
    cart = addTap(cart, 'I1', key);
    const k = cart.lines[0]!.key;
    cart = setUnits(cart, k, 5, 2);
    expect(cart.lines[0]!.quantity).toBe(2);
    cart = setUnits(cart, k, 0);
    expect(cart.lines[0]!.quantity).toBe(1);
    cart = setUnits(cart, k, 4);
    expect(lineProblems(cart, null, (id) => (id === 'I1' ? 2 : null)).get(k)).toEqual({ kind: 'only_left', n: 2 });
    const refused: EtaPreviewBody = { as_of_seq: 1, groups: [], lines: [{ key: k, eta_ms: null, from_stock: false, zone_served: false, refused: { code: 'STATION_PAUSED', details: {} } }] };
    expect(lineProblems(cart, refused, () => null).get(k)).toEqual({ kind: 'station_paused' });
    expect(removeLine(cart, k).lines).toEqual([]);
  });

  it('[02b §3.10] zone-covered from_zone lines (whole, in line order) are never a kitchen stock problem', () => {
    const cart: Cart = {
      lines: [
        { key: 'Z1', item_id: 'I4', quantity: 4, options: [], from_zone: true },
        { key: 'Z2', item_id: 'I4', quantity: 3, options: [], from_zone: true }, // 4 + 3 > 6: not covered, a kitchen line
        { key: 'Z3', item_id: 'I4', quantity: 2, options: [], from_zone: true }, // the 2 left cover it
      ],
    };
    const covered = zoneCovered(cart, (id) => (id === 'I4' ? 6 : null));
    expect([...covered]).toEqual(['Z1', 'Z3']);
    expect(lineProblems(cart, null, () => 0, covered)).toEqual(new Map([['Z2', { kind: 'sold_out' }]]));
  });
});
