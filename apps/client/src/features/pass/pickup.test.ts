import type { LineDetail } from '@pos/domain';
import type { WsServerMessage } from '@pos/events';
import { describe, expect, it, vi } from 'vitest';
import { createLiveBus } from '../staff/shell/live';
import type { OrderViewBody, SeatingLine } from '../staff/orders/contracts';
import { checkCustomer, createBillEligibility, eligibilityOf, parseBills } from './actions/customer';
import type { PointLine, PointOrder, PointOrderMeta, PointViewBody } from './contracts';
import { pickupReady, readiness } from './cards/readiness';
import { createPassStore } from './store';

// 02b-TK L-CLIENT-1 item 1 (03b v1.0.16 §3.4 "Pickup identity", "Readiness", "Handed to customer", "Bill freshness",
// "Tap and send"; §6.15, §6.16): the Pass store keeps the hub's order metadata (catch-up and `point_lines.orders`),
// a pickup card follows the whole-order readiness, the customer hand-over's bill eligibility and tap check.

const PT = 'PT';
function detail(id: string, over: Partial<LineDetail> = {}): LineDetail {
  return {
    order_item_id: id,
    order_id: 'O1',
    station_id: 'KARAHI',
    point_id: PT,
    identifier: { kind: 'token', token: 48, date: null },
    order_type: 'takeaway',
    item_name: 'Karahi',
    units: 1,
    line_kind: 'item',
    for_parent: null,
    deal_name: null,
    options: [],
    kitchen_note: null,
    order_note: null,
    return_of: null,
    cook_ms: 1,
    prep_ms: 0,
    from_stock: false,
    placed_by_name: null,
    ...over,
  };
}
const pl = (id: string, stage: PointLine['stage'], over: Partial<PointLine> = {}): PointLine => ({ ...detail(id), stage, handed_over: false, ...over });
const order = (lines: PointLine[], over: Partial<PointOrder> = {}): PointOrder => ({ order_id: 'O1', identifier: { kind: 'token', token: 48, date: null }, placed_at: 1_000, lines, ready: null, ...over });
const meta = (over: Partial<PointOrderMeta> = {}): PointOrderMeta => ({
  order_id: 'O1',
  pickup_at_ms: 90_000,
  boosted: false,
  pickup_readiness: { all_engine_lines_done: false, station_less_hold_until: null },
  no_station_lines: [],
  bag_ready_since: null,
  bag_ready_window_ms: null,
  ...over,
});
const view = (orders: PointOrder[]): PointViewBody => ({ point_id: PT, stations: [], orders, takeovers: [] });

describe('[03b v1.0.16 §6.15, §6.16 (R3-M-5)] the Pass store keeps the order metadata', () => {
  it('catch-up carries it; point_lines.orders (empty lines) replaces it; another point or an unheld order changes nothing', () => {
    const store = createPassStore({ now: () => 5_000 });
    let calls = 0;
    store.subscribe(() => (calls += 1));
    store.apply({ type: 'catch_up', as_of_seq: 1, state: { point_view: view([order([pl('L1', 'cooking')], meta())]) } });
    expect(store.snapshot().view!.orders[0]!.pickup_at_ms).toBe(90_000);
    const done = meta({ pickup_readiness: { all_engine_lines_done: true, station_less_hold_until: 90_000 }, no_station_lines: [{ order_item_id: 'L9', item_name: 'Cola', units: 2 }] });
    store.apply({ type: 'point_lines', point_id: PT, lines: [], orders: [done] } as WsServerMessage);
    const o = store.snapshot().view!.orders[0]!;
    expect(o.pickup_readiness).toEqual({ all_engine_lines_done: true, station_less_hold_until: 90_000 });
    expect(o.no_station_lines).toEqual([{ order_item_id: 'L9', item_name: 'Cola', units: 2 }]);
    expect(o.lines.map((l) => l.stage)).toEqual(['cooking']);
    expect(calls).toBe(2);
    store.apply({ type: 'point_lines', point_id: 'OTHER', lines: [], orders: [meta({ boosted: true })] } as WsServerMessage);
    store.apply({ type: 'point_lines', point_id: PT, lines: [], orders: [meta({ order_id: 'O-NOT-HERE' })] } as WsServerMessage);
    expect(calls).toBe(2);
    expect(store.snapshot().view!.orders[0]!.boosted).toBe(false);
  });

  it('metadata for an order whose first line comes in the same frame lands on the new card', () => {
    const store = createPassStore({ now: () => 5_000 });
    store.apply({ type: 'catch_up', as_of_seq: 1, state: { point_view: view([]) } });
    store.apply({ type: 'point_lines', point_id: PT, lines: [{ ...detail('L1', { order_id: 'O2' }), group_id: 'G', serve_mode: 'sync' }], orders: [meta({ order_id: 'O2', boosted: true })] } as WsServerMessage);
    expect(store.snapshot().view!.orders[0]!).toMatchObject({ order_id: 'O2', boosted: true, pickup_at_ms: 90_000 });
  });
});

describe('[03b v1.0.16 §3.4 Readiness (R3-M-5)] a pickup card follows the whole-order summary', () => {
  it('Ready only when every engine line of the order is done and the station-less hold has passed; no HOLD hint', () => {
    const lines = [pl('L1', 'done', { group_id: 'G', serve_mode: 'sync' }), pl('L2', 'cooking', { group_id: 'G', serve_mode: 'sync' })];
    // the point-local rule would say HOLD; a pickup card says Cooking until the whole order is done
    expect(readiness(order(lines), 0).state).toBe('hold');
    expect(readiness(order(lines, meta()), 0)).toEqual({ state: 'cooking', held: new Set() });
    const local = [pl('L1', 'done')];
    // a line at another point still cooking → not ready
    expect(readiness(order(local, meta()), 0).state).toBe('cooking');
    const whole = meta({ pickup_readiness: { all_engine_lines_done: true, station_less_hold_until: 90_000 } });
    expect(readiness(order(local, whole), 89_999).state).toBe('cooking');
    expect(readiness(order(local, whole), 90_000).state).toBe('ready');
    expect(pickupReady(order(local, meta({ pickup_readiness: { all_engine_lines_done: true, station_less_hold_until: null } })), 0)).toBe(true);
    // a known pickup without the whole-order fields (an older hub) is never ready by itself
    expect(readiness(order(local, { pickup_at_ms: 90_000 }), 100_000).state).toBe('cooking');
    // not a pickup: the point-local rule
    expect(readiness(order(local, { pickup_at_ms: null }), 0).state).toBe('ready');
  });
});

function sline(id: string, over: Partial<SeatingLine> = {}): SeatingLine {
  return {
    order_item_id: id,
    order_id: 'O1',
    parent_order_item_id: null,
    line_kind: 'item',
    item_id: 'I',
    deal_id: null,
    name: id,
    sale_unit: 'piece',
    quantity: 1,
    units: 1,
    live_units: 1,
    comped_units: 0,
    removed_units: 0,
    voided_units: 0,
    returned_units: 0,
    refundable_minor: 0,
    comp_minor: 0,
    comp_voided_minor: 0,
    removed_minor: 0,
    refund_minor: 0,
    line_total_minor: 100,
    billed_minor: 0,
    return_of: null,
    served_from_zone_id: null,
    zone_served: false,
    added_at: 0,
    served_at: null,
    served_source: null,
    is_food: true,
    kitchen_note: null,
    stage: 'done',
    fired: true,
    ...over,
  };
}
const ov = (lines: SeatingLine[]): OrderViewBody =>
  ({ order_id: 'O1', placed_by: { staff_id: 'S', name: null }, placed_at: 0, follow_up: false, cancelled: false, billed: false, has_phone: false, promise_ms: null, lines, order_type: 'takeaway', seating_id: null }) as OrderViewBody;

describe('[03b v1.0.16 §3.4 Tap and send (R3-M-10, R2-B-1; tests 115, 116)] the order-wide check', () => {
  it('every live unserved non-deal line: done anywhere counts, station-less lines and option children go too; served / removed / deal headers do not', () => {
    const lines = [
      sline('KARAHI'),
      sline('RAITA', { line_kind: 'option_child', parent_order_item_id: 'KARAHI', stage: null, fired: false }),
      sline('COLA', { stage: null, fired: false }),
      sline('DEAL', { line_kind: 'deal', stage: null }),
      sline('NAAN', { line_kind: 'deal_part', parent_order_item_id: 'DEAL' } as Partial<SeatingLine>),
      sline('GONE', { live_units: 0, removed_units: 1, stage: 'removed' }),
      sline('SERVED', { stage: 'served', served_at: 5 }),
    ];
    expect(checkCustomer(ov(lines), { pickup_at_ms: null, boosted: false }, 0)).toEqual({ ok: true, ids: ['KARAHI', 'RAITA', 'COLA', 'NAAN'] });
  });

  it('a line still added / cooking (at any point) refuses; a pickup holds a station-less line until the pickup time, unless boosted', () => {
    expect(checkCustomer(ov([sline('A'), sline('B', { stage: 'cooking' })]), { pickup_at_ms: null, boosted: false }, 0)).toEqual({ ok: false, reason: 'not_ready' });
    expect(checkCustomer(ov([sline('A'), sline('B', { stage: 'added', fired: false })]), { pickup_at_ms: null, boosted: false }, 0)).toEqual({ ok: false, reason: 'not_ready' });
    const withCola = ov([sline('A'), sline('COLA', { stage: null, fired: false })]);
    expect(checkCustomer(withCola, { pickup_at_ms: 90_000, boosted: false }, 89_999)).toEqual({ ok: false, reason: 'pickup', pickup_at_ms: 90_000 });
    expect(checkCustomer(withCola, { pickup_at_ms: 90_000, boosted: false }, 90_000)).toEqual({ ok: true, ids: ['A', 'COLA'] });
    expect(checkCustomer(withCola, { pickup_at_ms: 90_000, boosted: true }, 0)).toEqual({ ok: true, ids: ['A', 'COLA'] });
    expect(checkCustomer(ov([sline('S', { stage: 'served', served_at: 1 })]), { pickup_at_ms: null, boosted: false }, 0)).toEqual({ ok: true, ids: [] });
  });
});

const row = (order_id: string, order_type: string, bill?: unknown) => ({ order_id, order_type, ...(bill === undefined ? {} : { bill }) });

describe('[03b v1.0.16 §3.4 Bill freshness (R3-M-4; tests 118, 119)] billing eligibility from open-orders?order_type=all', () => {
  it('no bill field (today\'s hub) → unknown; paid → paid; due → due with the amount; due 0 → paid', () => {
    const read = parseBills({ orders: [row('A', 'takeaway'), row('B', 'takeaway', { state: 'paid', due_minor: 0 }), row('C', 'takeaway', { state: 'due', due_minor: 119_000 }), row('D', 'parking', { state: 'due', due_minor: 0 })] }, 10_000)!;
    const of = (order_id: string, order_type: 'takeaway' | 'parking' = 'takeaway') => eligibilityOf(read, { order_id, order_type, placed_at: 5_000 });
    expect(of('A')).toEqual({ state: 'unknown' });
    expect(of('B')).toEqual({ state: 'paid' });
    expect(of('C')).toEqual({ state: 'due', due_minor: 119_000, approved: false });
    expect(of('D', 'parking')).toEqual({ state: 'paid' });
    expect(eligibilityOf(null, { order_id: 'B', order_type: 'takeaway', placed_at: 0 })).toEqual({ state: 'unknown' });
  });

  it('an absent row is paid only for parking, and only when the read was issued at or after the card was placed', () => {
    const read = parseBills({ orders: [] }, 10_000)!;
    expect(eligibilityOf(read, { order_id: 'P', order_type: 'parking', placed_at: 10_000 })).toEqual({ state: 'paid' });
    expect(eligibilityOf(read, { order_id: 'P', order_type: 'parking', placed_at: 10_001 })).toEqual({ state: 'unknown' });
    expect(eligibilityOf(read, { order_id: 'T', order_type: 'takeaway', placed_at: 0 })).toEqual({ state: 'unknown' });
    expect(parseBills({ nope: 1 }, 0)).toBeNull();
  });

  it('reads at start; a billing frame, catch-up or reconnect invalidates (unknown) and reads again after ≥ 1 s; a superseded answer is dropped', async () => {
    vi.useFakeTimers();
    try {
      const live = createLiveBus();
      let resolveFirst: (v: unknown) => void = () => undefined;
      const answers: Array<Promise<unknown>> = [
        new Promise((r) => (resolveFirst = r)),
        Promise.resolve({ ok: true, data: { orders: [row('B', 'takeaway', { state: 'due', due_minor: 5 })] } }),
        Promise.resolve({ ok: true, data: { orders: [row('B', 'takeaway', { state: 'paid', due_minor: 0 })] } }),
      ];
      const read = vi.fn(() => answers.shift()! as never);
      let now = 1_000;
      const bills = createBillEligibility({ live, read, now: () => now });
      const of = () => eligibilityOf(bills.current(), { order_id: 'B', order_type: 'takeaway', placed_at: 0 }).state;
      bills.start();
      expect(read).toHaveBeenCalledTimes(1);
      // a fresh read for a tap supersedes the background one
      now = 2_000;
      const fresh = await bills.fresh();
      expect(fresh?.at).toBe(2_000);
      expect(of()).toBe('due');
      resolveFirst({ ok: true, data: { orders: [row('B', 'takeaway', { state: 'paid', due_minor: 0 })] } });
      await vi.advanceTimersByTimeAsync(0);
      expect(of()).toBe('due');
      const epoch = bills.epoch();
      live.frame({ type: 'event', seq: 5, event: { event_id: 'E5', event_type: 'OrdersBilled', schema_version: 1, payload: {} } } as WsServerMessage);
      expect(of()).toBe('unknown');
      expect(bills.epoch()).toBe(epoch + 1);
      await vi.advanceTimersByTimeAsync(999);
      expect(read).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(read).toHaveBeenCalledTimes(3);
      expect(of()).toBe('paid');
      bills.stop();
      live.frame({ type: 'event', seq: 6, event: { event_id: 'E6', event_type: 'OpenOrderBillChanged', schema_version: 1, payload: {} } } as WsServerMessage);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(read).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
