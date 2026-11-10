import { describe, expect, it } from 'vitest';
import '../../index';
import { payloadSchema } from '../../registry';

// 03a §4.2: one example per order-stream event (engine fields only; P-9 lets the writer add its own).
const line = {
  order_item_id: 'L1',
  station_id: 'S1',
  alternates: [{ station_id: 'S2', carry_ms: 30_000, home: false }],
  point_id: null,
  carry_ms: 0,
  from_stock: false,
  weight_pct: 100,
  max_early_ms: 60_000,
  max_late_ms: null,
  max_carry_ms: null,
};
const group = { group_id: 'O1:0', target_land_ms: 1_500_000, promise_ms: 1_680_000, order_item_ids: ['L1'] };

// 01c §4.3: every key present on the wire.
const itemAdded = {
  order_id: 'O1',
  order_item_id: 'L1',
  parent_order_item_id: null,
  line_kind: 'item',
  item_id: 'I1',
  deal_id: null,
  deal_part_id: null,
  option_id: null,
  option_quantity: null,
  variant_group_id: 'V1',
  variant_group_name: 'Chicken Karahi',
  variant_name: 'Half',
  name: 'Chicken Karahi — Half',
  category_id: 'C1',
  requires_weighing: false,
  quantity: 2,
  sale_unit: 'piece',
  price_minor: 120_000,
  extra_price_minor: null,
  allocated_price_minor: null,
  tax_class_id: 'X1',
  station_id: 'S1',
  program_id: null,
  stock_program_id: null,
  program_cook_time_ms: null,
  stock_program_cook_time_ms: null,
  serve_mode: 'sync',
  prep_buffer_ms: 0,
  cook_time_ms: 1_200_000,
  stock_time_ms: 300_000,
  out_of_stock_behaviour: 'cook_fresh',
  stock_draws: [{ stock_item_id: 'K1', quantity: 1_000 }],
  options: [{ option_id: 'OP1', modifier_group_id: 'M1', name: 'Spicy', price_minor: 5_000, quantity: 1, charge_minor: 5_000 }],
  line_total_minor: 250_000,
  kitchen_note: null,
};

const examples: Record<string, Record<string, unknown>> = {
  OrderPlaced: {
    order_id: 'O1',
    order_type: 'dine_in',
    table_id: 'T12',
    table_key: 'dine_in:T12',
    follow_up: false,
    pickup_at_ms: null,
    order_item_ids: ['L1'],
    groups: [group],
    lines: [line],
  },
  ItemAdded: itemAdded,
  OrderLinesAdded: {
    order_id: 'O1',
    order_item_ids: ['L2'],
    groups: [{ ...group, group_id: 'O1:1', order_item_ids: ['L2'] }],
    lines: [{ ...line, order_item_id: 'L2', return_of: { order_item_id: 'L1', mode: 'fix' }, cook_ms_override: 180_000 }],
  },
  ItemReturned: { order_item_id: 'L1', mode: 'remake', replacement_order_item_id: 'L2' },
  ItemStarted: { order_item_id: 'L1', started_at: 1_000, source: 'tap' },
  ItemDone: { order_item_id: 'L1', done_at: 2_000, source: 'inferred' },
  ItemDoneUndone: { order_item_id: 'L1' },
  ItemServed: { order_item_ids: ['L1'], source: 'estimated' },
  ItemRemoved: { order_item_id: 'L1' },
  ItemVoided: { order_item_id: 'L1', units: 1 },
  ItemMovedToStock: { order_item_id: 'L1', units: 2 },
  OrderBoosted: { order_id: 'O1' },
  ItemsReleased: { order_id: 'O1', alert_id: null, released: ['L1'], expedite: [] },
  SlipWarned: {
    table_key: 'dine_in:T12',
    order_ids: ['O1'],
    alert_id: 'A1',
    estimated_land_ms: 1_900_000,
    target_land_ms: 1_500_000,
    promise_ms: 1_680_000,
  },
};

const ORDER_EVENTS = Object.keys(examples);

function without(o: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...o };
  delete copy[key];
  return copy;
}

describe('03a order-stream events', () => {
  it('[03a §4.2] the 14 order events are registered at schema_version 1 and each parses its example', () => {
    expect(ORDER_EVENTS).toHaveLength(14);
    for (const type of ORDER_EVENTS) {
      // ItemAdded's two additive fields parse in as null / false (C-1); every other example round-trips unchanged
      const expected = type === 'ItemAdded' ? { ...examples[type], served_from_zone_id: null, is_ready_item: false } : examples[type];
      expect(payloadSchema(type, 1).parse(examples[type]), type).toEqual(expected);
    }
  });

  it('[03a §4.2] each schema refuses its payload with any one engine field missing', () => {
    for (const type of ORDER_EVENTS) {
      for (const key of Object.keys(examples[type]!)) {
        const rest = without(examples[type]!, key);
        expect(payloadSchema(type, 1).safeParse(rest).success, `${type}.${key}`).toBe(false);
      }
    }
  });

  it('[03a §4.2] nested engine fields are required: a line, a group and an alternate each refuse a missing key', () => {
    const placed = payloadSchema('OrderPlaced', 1);
    const base = examples.OrderPlaced!;
    for (const key of Object.keys(line)) {
      const rest = without(line, key);
      expect(placed.safeParse({ ...base, lines: [rest] }).success, `lines[].${key}`).toBe(false);
    }
    for (const key of Object.keys(group)) {
      const rest = without(group, key);
      expect(placed.safeParse({ ...base, groups: [rest] }).success, `groups[].${key}`).toBe(false);
    }
    expect(
      placed.safeParse({ ...base, lines: [{ ...line, alternates: [{ station_id: 'S2', carry_ms: 0 }] }] }).success,
    ).toBe(false);
    const added = payloadSchema('OrderLinesAdded', 1);
    const addedBase = examples.OrderLinesAdded!;
    const addedLine = (addedBase.lines as Record<string, unknown>[])[0]!;
    for (const key of ['return_of', 'cook_ms_override']) {
      const rest = without(addedLine, key);
      expect(added.safeParse({ ...addedBase, lines: [rest] }).success, `lines[].${key}`).toBe(false);
    }
    expect(added.safeParse({ ...addedBase, lines: [{ ...addedLine, return_of: null, cook_ms_override: null }] }).success).toBe(true);
    expect(
      added.safeParse({ ...addedBase, lines: [{ ...addedLine, return_of: { order_item_id: 'L1', mode: 'redo' } }] }).success,
    ).toBe(false);
  });

  it('[03a §4.2] an unknown source is refused on ItemStarted, ItemDone and ItemServed', () => {
    expect(payloadSchema('ItemStarted', 1).safeParse({ ...examples.ItemStarted, source: 'estimated' }).success).toBe(false);
    expect(payloadSchema('ItemStarted', 1).safeParse({ ...examples.ItemStarted, source: 'inferred' }).success).toBe(true);
    expect(payloadSchema('ItemDone', 1).safeParse({ ...examples.ItemDone, source: 'manual' }).success).toBe(false);
    expect(payloadSchema('ItemDone', 1).safeParse({ ...examples.ItemDone, source: 'tap' }).success).toBe(true);
    expect(payloadSchema('ItemServed', 1).safeParse({ ...examples.ItemServed, source: 'inferred' }).success).toBe(false);
    expect(payloadSchema('ItemServed', 1).safeParse({ ...examples.ItemServed, source: 'tap' }).success).toBe(true);
  });

  it('[03a §4.2] ItemServed refuses an empty order_item_ids; ItemVoided refuses units 0; ItemReturned refuses mode fix', () => {
    expect(payloadSchema('ItemServed', 1).safeParse({ ...examples.ItemServed, order_item_ids: [] }).success).toBe(false);
    expect(payloadSchema('ItemVoided', 1).safeParse({ ...examples.ItemVoided, units: 0 }).success).toBe(false);
    expect(payloadSchema('ItemVoided', 1).safeParse({ ...examples.ItemVoided, units: 1.5 }).success).toBe(false);
    expect(payloadSchema('ItemMovedToStock', 1).safeParse({ ...examples.ItemMovedToStock, units: 0 }).success).toBe(false);
    expect(payloadSchema('ItemReturned', 1).safeParse({ ...examples.ItemReturned, mode: 'fix' }).success).toBe(false);
  });

  it('[03a §3.3] OrderPlaced and OrderLinesAdded refuse a group_id that is not order_id:<n>', () => {
    for (const type of ['OrderPlaced', 'OrderLinesAdded']) {
      const schema = payloadSchema(type, 1);
      const base = examples[type]!;
      const g = (base.groups as Record<string, unknown>[])[0]!;
      for (const bad of ['O2:0', 'O1', 'O1:', 'O1:x', 'O1:-1', 'O1:01', 'G1']) {
        expect(schema.safeParse({ ...base, groups: [{ ...g, group_id: bad }] }).success, `${type} ${bad}`).toBe(false);
      }
      expect(schema.safeParse({ ...base, groups: [{ ...g, group_id: 'O1:12' }] }).success, type).toBe(true);
    }
  });

  it('[03a §4.2] OrderPlaced refuses an unknown order_type', () => {
    expect(payloadSchema('OrderPlaced', 1).safeParse({ ...examples.OrderPlaced, order_type: 'drive_thru' }).success).toBe(false);
    for (const t of ['dine_in', 'takeaway', 'delivery', 'parking']) {
      expect(payloadSchema('OrderPlaced', 1).safeParse({ ...examples.OrderPlaced, order_type: t }).success, t).toBe(true);
    }
  });

  it('[03a §4.2] ItemAdded round-trips every 01c §4.3 field for each line_kind', () => {
    const schema = payloadSchema('ItemAdded', 1);
    const deal = {
      ...itemAdded,
      order_item_id: 'L0',
      line_kind: 'deal',
      item_id: null,
      deal_id: 'D1',
      variant_group_id: null,
      variant_group_name: null,
      variant_name: null,
      name: 'Family karahi deal',
      quantity: 1,
      price_minor: 320_000,
      station_id: null,
      serve_mode: null,
      prep_buffer_ms: null,
      cook_time_ms: null,
      stock_time_ms: null,
      out_of_stock_behaviour: null,
      stock_draws: [],
      options: [],
      line_total_minor: 320_000,
    };
    const dealPart = {
      ...itemAdded,
      order_item_id: 'L2',
      line_kind: 'deal_part',
      parent_order_item_id: 'L0',
      deal_id: 'D1',
      deal_part_id: 'P1',
      extra_price_minor: 0,
      allocated_price_minor: 229_315,
      station_id: 'B1',
      program_id: 'PR1',
      stock_program_id: 'PR2',
      program_cook_time_ms: 900_000,
      stock_program_cook_time_ms: 240_000,
      line_total_minor: 0,
    };
    const child = {
      ...itemAdded,
      order_item_id: 'L3',
      line_kind: 'option_child',
      parent_order_item_id: 'L1',
      option_id: 'OP9',
      option_quantity: 3,
      serve_mode: 'immediate',
      out_of_stock_behaviour: 'sold_out',
      kitchen_note: 'well done',
    };
    const weighed = { ...itemAdded, order_item_id: 'L4', requires_weighing: true, quantity: null, sale_unit: 'g', line_total_minor: null };
    for (const payload of [itemAdded, deal, dealPart, child, weighed]) {
      expect(schema.parse(payload), payload.line_kind).toEqual({ ...payload, served_from_zone_id: null, is_ready_item: false });
    }
    expect(schema.safeParse({ ...itemAdded, line_kind: 'combo' }).success).toBe(false);
    expect(schema.safeParse({ ...itemAdded, sale_unit: 'kg' }).success).toBe(false);
    expect(schema.safeParse({ ...itemAdded, stock_draws: [{ stock_item_id: 'K1' }] }).success).toBe(false);
    expect(schema.safeParse({ ...itemAdded, options: [{ ...itemAdded.options[0], charge_minor: undefined }] }).success).toBe(false);
    expect(schema.safeParse({ ...itemAdded, kitchen_note: 'x'.repeat(81) }).success).toBe(false);
    expect(schema.safeParse({ ...itemAdded, kitchen_note: 'x'.repeat(80) }).success).toBe(true);
  });
});

describe('02b additive order-event fields (03a v1.2 §4.2; 01c v1.1.2 C-1)', () => {
  it('[02p U-5] ItemAdded without served_from_zone_id / is_ready_item parses as null / false', () => {
    const parsed = payloadSchema('ItemAdded', 1).parse(itemAdded) as Record<string, unknown>;
    expect(parsed.served_from_zone_id).toBeNull();
    expect(parsed.is_ready_item).toBe(false);
  });

  it('[02p U-5] ItemAdded with both fields round-trips', () => {
    const withBoth = { ...itemAdded, served_from_zone_id: 'Z1', is_ready_item: true };
    expect(payloadSchema('ItemAdded', 1).parse(withBoth)).toEqual(withBoth);
    const nullZone = { ...itemAdded, served_from_zone_id: null, is_ready_item: false };
    expect(payloadSchema('ItemAdded', 1).parse(nullZone)).toEqual(nullZone);
  });

  it('[03a #129] OrderPlaced, ItemServed, ItemRemoved, ItemVoided round-trip the new fields', () => {
    const placed = {
      ...examples.OrderPlaced,
      business_date: '2026-11-08',
      token: '42',
      car_number: 'ABC-123',
      car_type: 'Corolla',
      order_note: 'no onions',
      sent_after_reconnect: true,
      has_phone: true,
      has_food: false,
    };
    expect(payloadSchema('OrderPlaced', 1).parse(placed)).toEqual(placed);
    const served = { order_item_ids: ['L1'], source: 'tap', served_at: 1_700_000_000_000 };
    expect(payloadSchema('ItemServed', 1).parse(served)).toEqual(served);
    const removed = { order_item_id: 'L1', units: 2 };
    expect(payloadSchema('ItemRemoved', 1).parse(removed)).toEqual(removed);
    const voided = { order_item_id: 'L1', units: 1, refund_minor: 5_000, comp_voided_minor: 0 };
    expect(payloadSchema('ItemVoided', 1).parse(voided)).toEqual(voided);
    // optional: the bare forms still parse
    expect(payloadSchema('ItemRemoved', 1).safeParse({ order_item_id: 'L1' }).success).toBe(true);
    expect(payloadSchema('OrderPlaced', 1).safeParse(examples.OrderPlaced).success).toBe(true);
  });

  it('[03a #129] the new optional fields refuse a wrong type or value', () => {
    expect(payloadSchema('ItemRemoved', 1).safeParse({ order_item_id: 'L1', units: 0 }).success).toBe(false);
    expect(payloadSchema('ItemRemoved', 1).safeParse({ order_item_id: 'L1', units: 1.5 }).success).toBe(false);
    expect(payloadSchema('ItemServed', 1).safeParse({ ...examples.ItemServed, served_at: 1.5 }).success).toBe(false);
    expect(payloadSchema('ItemVoided', 1).safeParse({ ...examples.ItemVoided, refund_minor: 1.5 }).success).toBe(false);
    expect(payloadSchema('ItemVoided', 1).safeParse({ ...examples.ItemVoided, comp_voided_minor: 'x' }).success).toBe(false);
    expect(payloadSchema('OrderPlaced', 1).safeParse({ ...examples.OrderPlaced, has_phone: 'yes' }).success).toBe(false);
  });

  it("[03a §4.2 Q-6] ItemServed source 'zone' accepted; 'other' rejected", () => {
    expect(payloadSchema('ItemServed', 1).safeParse({ ...examples.ItemServed, source: 'zone' }).success).toBe(true);
    expect(payloadSchema('ItemServed', 1).safeParse({ ...examples.ItemServed, source: 'other' }).success).toBe(false);
  });
});


describe('03a v1.2 E-4: OrderLinesAdded order_header (§4.2)', () => {
  const header = { order_type: 'dine_in', table_key: 'dine_in:T12', table_id: 'T12', follow_up: false, pickup_at_ms: null, placed_by: 'S_WAIT' };

  it('[03a #138] OrderLinesAdded with and without order_header round-trips; the header fields take §4.2 types', () => {
    const schema = payloadSchema('OrderLinesAdded', 1);
    const bare = examples.OrderLinesAdded!;
    expect(schema.parse(bare)).toEqual(bare);
    expect(schema.parse(bare)).not.toHaveProperty('order_header');
    const withHeader = { ...bare, order_header: header };
    expect(schema.parse(withHeader)).toEqual(withHeader);
    const nulls = { ...bare, order_header: { ...header, table_id: null, placed_by: null, pickup_at_ms: 1_700_000_000_000, order_type: 'delivery', follow_up: true } };
    expect(schema.parse(nulls)).toEqual(nulls);
    // An empty addition with a header (E-4 a′) parses too.
    const empty = { order_id: 'O1', order_item_ids: [], groups: [], lines: [], order_header: header };
    expect(schema.parse(empty)).toEqual(empty);
  });

  it('[03a #138] order_header is absent, never null; each field refuses a wrong type or a missing key', () => {
    const schema = payloadSchema('OrderLinesAdded', 1);
    const bare = examples.OrderLinesAdded!;
    expect(schema.safeParse({ ...bare, order_header: null }).success).toBe(false);
    expect(schema.safeParse({ ...bare, order_header: { ...header, order_type: 'counter' } }).success).toBe(false);
    expect(schema.safeParse({ ...bare, order_header: { ...header, pickup_at_ms: 1.5 } }).success).toBe(false);
    expect(schema.safeParse({ ...bare, order_header: { ...header, follow_up: 'no' } }).success).toBe(false);
    for (const key of Object.keys(header)) {
      expect(schema.safeParse({ ...bare, order_header: without(header, key) }).success, key).toBe(false);
    }
  });
});

// 02a SG-2: the five 02b v1.0.2 §6 events 02a folds (shapes from the 02b §6.19 table).
describe('02a SG-2: folded 02b events (02b v1.0.2 §6.19)', () => {
  const folded: Record<string, Record<string, unknown>> = {
    OrderFoodServed: { order_id: 'O1' },
    OrderFoodCleared: { order_id: 'O1', food_served: true },
    OrderCancelled: { order_id: 'O1' },
    LineWeightSet: { order_item_id: 'L1', quantity: 450, line_total_minor: 90_000 },
    LineComped: {
      order_item_id: 'L1',
      units: 2,
      value_minor: 120_000,
      reason_code: 'other',
      note: null,
      requester_staff_id: 'W1',
      alert_id: null,
      approver_staff_id: null,
    },
  };

  it('[02a SG-2] each of the five 02b events round-trips with its 02b §6 payload', () => {
    for (const [type, payload] of Object.entries(folded)) {
      expect(payloadSchema(type, 1).parse(payload), type).toEqual(payload);
    }
    const approved = { ...folded.LineComped!, note: 'cold', alert_id: 'A1', approver_staff_id: 'W2' };
    expect(payloadSchema('LineComped', 1).parse(approved)).toEqual(approved);
  });

  it('[02a SG-2] OrderFoodCleared.food_served is boolean', () => {
    const schema = payloadSchema('OrderFoodCleared', 1);
    expect(schema.safeParse({ order_id: 'O1', food_served: false }).success).toBe(true);
    expect(schema.safeParse({ order_id: 'O1', food_served: 'yes' }).success).toBe(false);
    expect(schema.safeParse({ order_id: 'O1' }).success).toBe(false);
  });

  it('[02a SG-2] no field beyond the 02b table; every listed field is required', () => {
    for (const [type, payload] of Object.entries(folded)) {
      const schema = payloadSchema(type, 1);
      expect(schema.safeParse({ ...payload, extra: 1 }).success, type).toBe(false);
      for (const key of Object.keys(payload)) {
        const rest = Object.fromEntries(Object.entries(payload).filter(([k]) => k !== key));
        expect(schema.safeParse(rest).success, `${type}.${key}`).toBe(false);
      }
    }
  });
});
