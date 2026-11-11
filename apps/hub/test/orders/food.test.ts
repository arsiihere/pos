// 02b §3.3 / §3.5 / §3.7 / §3.8 (P-1d, owner Q5; AD-10, AD-13): the pure food rules behind table state. Plain LineViews
// in (the order's lines AFTER the change), envelope-less OrderFoodServed / OrderFoodCleared drafts out.
import { OrderFoodClearedPayload, OrderFoodServedPayload } from '@pos/events';
import { describe, expect, it } from 'vitest';
import type { LineView } from '../../src/orders/contracts';
import { foodDrafts, isFoodLine } from '../../src/orders/food';

const ORDER = 'ord-1';
let next = 0;

/** A live, unserved, one-unit kitchen line of ORDER; `over` sets the case. */
function line(over: Partial<LineView> = {}): LineView {
  next += 1;
  const units = over.units ?? 1;
  return {
    order_item_id: `oi-${next}`,
    order_id: ORDER,
    parent_order_item_id: null,
    line_kind: 'item',
    item_id: `item-${next}`,
    deal_id: null,
    name: 'line',
    sale_unit: 'piece',
    quantity: units,
    units,
    live_units: units,
    comped_units: 0,
    removed_units: 0,
    voided_units: 0,
    returned_units: 0,
    refundable_minor: 100_000,
    comp_minor: 0,
    comp_voided_minor: 0,
    removed_minor: 0,
    refund_minor: 0,
    line_total_minor: 100_000,
    billed_minor: 100_000,
    return_of: null,
    served_from_zone_id: null,
    zone_served: false,
    added_at: 1_000,
    served_at: null,
    served_source: null,
    is_food: false,
    kitchen_note: null,
    ...over,
  };
}
const karahi = (over: Partial<LineView> = {}) => line({ name: 'karahi', is_food: true, ...over });
const water = (over: Partial<LineView> = {}) => line({ name: 'water', is_food: false, ...over });
const served = { served_at: 5_000, served_source: 'tap' as const };
const gone = (units = 1) => ({ live_units: 0, removed_units: units });

const foodServed = { stream_type: 'order', stream_id: ORDER, event_type: 'OrderFoodServed', schema_version: 1, payload: { order_id: ORDER } };
const foodCleared = (food_served: boolean) => ({
  stream_type: 'order',
  stream_id: ORDER,
  event_type: 'OrderFoodCleared',
  schema_version: 1,
  payload: { order_id: ORDER, food_served },
});

describe('[02b §3.3] food line', () => {
  const base = { station_id: 'st-grill', line_kind: 'item' as const, served_from_zone_id: null, is_ready_item: false };

  it('[02b §3.3] is_food = engine line ∧ not zone-served ∧ ¬ready', () => {
    expect(isFoodLine(base)).toBe(true);
    expect(isFoodLine({ ...base, line_kind: 'deal_part' })).toBe(true);
    expect(isFoodLine({ ...base, line_kind: 'option_child' })).toBe(true);
    // not an engine line (03a plan.ts:17): no station, or a deal header
    expect(isFoodLine({ ...base, station_id: null })).toBe(false);
    expect(isFoodLine({ ...base, line_kind: 'deal' })).toBe(false);
    // zone-served lines are never food; ready items (water, drinks, packed) never are, wherever they come from (Q5)
    expect(isFoodLine({ ...base, served_from_zone_id: 'zone-1' })).toBe(false);
    expect(isFoodLine({ ...base, is_ready_item: true })).toBe(false);
  });
});

describe('[02b §3.3] foodDrafts after a serve (§3.7, AD-13)', () => {
  it('[02b #12 pure] served food → OrderFoodServed', () => {
    const k = karahi(served);
    const w = water();
    expect(foodDrafts(ORDER, [k, w], { kind: 'served', order_item_ids: [k.order_item_id] })).toEqual([foodServed]);
  });

  it('[02b #12 pure] served water only → none (bottle from the counter station while the karahi cooks)', () => {
    const k = karahi();
    const w = water(served);
    expect(foodDrafts(ORDER, [k, w], { kind: 'served', order_item_ids: [w.order_item_id] })).toEqual([]);
  });

  it('[02b #12 pure] one ItemServed serving water and a karahi → one OrderFoodServed', () => {
    const k = karahi(served);
    const w = water(served);
    expect(foodDrafts(ORDER, [k, w], { kind: 'served', order_item_ids: [w.order_item_id, k.order_item_id] })).toEqual([foodServed]);
  });

  it('[02b #12 pure] a repeat food serve emits again (every serve of a food line; 1 → 1 harmless)', () => {
    const k1 = karahi(served);
    const k2 = karahi(served);
    expect(foodDrafts(ORDER, [k1, k2], { kind: 'served', order_item_ids: [k2.order_item_id] })).toEqual([foodServed]);
  });

  it('[02b #12 pure] AD-13: karahi returned, replacement cooking, water tap-served → no OrderFoodServed', () => {
    const old = karahi({ ...served, returned_units: 1 });
    const replacement = karahi({ return_of: old.order_item_id, refundable_minor: 0, line_total_minor: 0, billed_minor: 0 });
    const w = water(served);
    expect(foodDrafts(ORDER, [old, replacement, w], { kind: 'served', order_item_ids: [w.order_item_id] })).toEqual([]);
  });

  it('[02b #12 pure] a return replacement karahi served → OrderFoodServed (M-5)', () => {
    const old = karahi({ ...served, returned_units: 1 });
    const replacement = karahi({ ...served, return_of: old.order_item_id });
    expect(foodDrafts(ORDER, [old, replacement], { kind: 'served', order_item_ids: [replacement.order_item_id] })).toEqual([foodServed]);
  });

  it('[02b #12 pure] reheated karahi from stock is food → OrderFoodServed; a food deal part served → OrderFoodServed', () => {
    const reheated = karahi(served);
    expect(foodDrafts(ORDER, [reheated], { kind: 'served', order_item_ids: [reheated.order_item_id] })).toEqual([foodServed]);
    const header = line({ line_kind: 'deal', item_id: null, deal_id: 'deal-1', is_food: false });
    const part = karahi({ ...served, line_kind: 'deal_part', parent_order_item_id: header.order_item_id });
    expect(foodDrafts(ORDER, [header, part], { kind: 'served', order_item_ids: [part.order_item_id] })).toEqual([foodServed]);
  });

  it('[02b §3.3] a serve never drafts OrderFoodCleared, even when no unserved food is left', () => {
    const w = water(served);
    expect(foodDrafts(ORDER, [w], { kind: 'served', order_item_ids: [w.order_item_id] })).toEqual([]);
  });
});

describe('[02b §3.3] foodDrafts after a change (§3.5 RemoveItems, lineChangeDrafts)', () => {
  it('[02b #12 pure] change leaving a live order with no live unserved food → OrderFoodCleared { food_served }', () => {
    // mixed round whose karahi is then removed → { food_served: false } (table not stranded)
    expect(foodDrafts(ORDER, [karahi(gone()), water(served)], 'change')).toEqual([foodCleared(false)]);
    // karahi served, the unserved second karahi removed → { food_served: true }
    expect(foodDrafts(ORDER, [karahi(served), karahi(gone()), water()], 'change')).toEqual([foodCleared(true)]);
  });

  it('[02b #12 pure] a live unserved food line left → none', () => {
    expect(foodDrafts(ORDER, [karahi(), water(gone())], 'change')).toEqual([]);
    // partial remove: 1 of 2 karahi units left, unserved
    expect(foodDrafts(ORDER, [karahi({ units: 2, live_units: 1, removed_units: 1 })], 'change')).toEqual([]);
  });

  it('[02b #12 pure] R-4: a live no-station or ready line never blocks OrderFoodCleared', () => {
    const noStation = line({ name: 'packed sweets', is_food: false });
    const ready = water();
    expect(foodDrafts(ORDER, [karahi(gone()), noStation, ready], 'change')).toEqual([foodCleared(false)]);
    const zoneRaita = line({ name: 'raita', served_from_zone_id: 'zone-1', zone_served: true, is_food: false, ...served, served_source: 'zone' });
    expect(foodDrafts(ORDER, [karahi(served), karahi(gone()), zoneRaita], 'change')).toEqual([foodCleared(true)]);
  });

  it('[02b #12 pure] N-2: remake then remove the replacement → OrderFoodCleared { food_served: true }', () => {
    const old = karahi({ ...served, returned_units: 1 });
    const replacement = karahi({ return_of: old.order_item_id, ...gone() });
    expect(foodDrafts(ORDER, [old, replacement], 'change')).toEqual([foodCleared(true)]);
  });

  it('[02b §3.3] food_served counts a served food line whose units later left billing (void after serve)', () => {
    const voided = karahi({ ...served, live_units: 0, voided_units: 1 });
    expect(foodDrafts(ORDER, [voided, water(served)], 'change')).toEqual([foodCleared(true)]);
  });

  it('[02b §3.5] no live line left → none (OrderCancelled is the caller’s)', () => {
    expect(foodDrafts(ORDER, [karahi(gone()), water(gone())], 'change')).toEqual([]);
    expect(foodDrafts(ORDER, [], 'change')).toEqual([]);
  });

  it('[02b §3.4] a deal header is never a live line: parts only', () => {
    // every part removed one by one, the header's own counter still says live → the order has no live line
    const header = line({ line_kind: 'deal', item_id: null, deal_id: 'deal-1', is_food: false });
    const part = karahi({ line_kind: 'deal_part', parent_order_item_id: header.order_item_id, ...gone() });
    expect(foodDrafts(ORDER, [header, part], 'change')).toEqual([]);
    // a live unserved food part blocks; once the part is served and a water stays live → cleared { true }
    const livePart = karahi({ line_kind: 'deal_part', parent_order_item_id: header.order_item_id });
    expect(foodDrafts(ORDER, [header, livePart, water(gone())], 'change')).toEqual([]);
    const servedPart = karahi({ ...served, line_kind: 'deal_part', parent_order_item_id: header.order_item_id });
    expect(foodDrafts(ORDER, [header, servedPart, water()], 'change')).toEqual([foodCleared(true)]);
  });

  it('[02b §3.3] O-1: a water-only order change still drafts OrderFoodCleared { false } (harmless)', () => {
    expect(foodDrafts(ORDER, [water(), water(gone())], 'change')).toEqual([foodCleared(false)]);
  });
});

describe('[02b §3.3] foodDrafts after a return (§3.8)', () => {
  it('[02b #12 pure] N-1: non-food return with a karahi still cooking → none', () => {
    const k = karahi();
    const w = water(served);
    const wReturn = water({ return_of: w.order_item_id, refundable_minor: 0, line_total_minor: 0, billed_minor: 0 });
    expect(foodDrafts(ORDER, [k, w, wReturn], 'return')).toEqual([]);
  });

  it('[02b #12 pure] water fix return after the karahi was served → OrderFoodCleared { food_served: true }', () => {
    const k = karahi(served);
    const w = water(served);
    const wReturn = water({ return_of: w.order_item_id });
    expect(foodDrafts(ORDER, [k, w, wReturn], 'return')).toEqual([foodCleared(true)]);
  });

  it('[02b #12 pure] non-food return in a water-only order → OrderFoodCleared { food_served: false }', () => {
    const w = water(served);
    expect(foodDrafts(ORDER, [w, water({ return_of: w.order_item_id })], 'return')).toEqual([foodCleared(false)]);
  });

  it('[02b #12 pure] food return → none (the order waits for the replacement’s OrderFoodServed)', () => {
    const k = karahi({ ...served, returned_units: 1 });
    expect(foodDrafts(ORDER, [k, karahi({ return_of: k.order_item_id })], 'return')).toEqual([]);
  });

  it('[02b §3.3] the returned line’s own flag gates the return, not only the replacement’s', () => {
    // a food line returned whose replacement row is (wrongly) not flagged food: the spec clause "returned line is
    // not food" still refuses OrderFoodCleared
    const k = karahi(served);
    expect(foodDrafts(ORDER, [k, water({ return_of: k.order_item_id })], 'return')).toEqual([]);
  });
});

describe('[02b §6.19] draft payloads parse with the event schemas', () => {
  it('[02b §6.19] OrderFoodServed / OrderFoodCleared payloads are strict-valid', () => {
    const k = karahi(served);
    const [s] = foodDrafts(ORDER, [k], { kind: 'served', order_item_ids: [k.order_item_id] });
    expect(OrderFoodServedPayload.parse(s?.payload)).toEqual({ order_id: ORDER });
    const [c] = foodDrafts(ORDER, [karahi(gone()), water()], 'change');
    expect(OrderFoodClearedPayload.parse(c?.payload)).toEqual({ order_id: ORDER, food_served: false });
  });
});
