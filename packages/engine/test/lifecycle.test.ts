// 03a §3.3 Exit (served rule, abandon with BF-6 / AD-13, removal only in listed folds, OrderLinesAdded fold
// order and throw), "Absent ids", "Deterministic ids", §3.12 lists, §6.1a; carried AD-8 writer-bug checks.
import { parseEvent, type EngineConfig, type PosEvent } from '@pos/events';
import {
  aBusinessDayOpened,
  aBusinessDayClosed,
  aFireDispatched,
  anEngineConfigApplied,
  anItemAdded,
  anItemStarted,
  anOrderBatch,
  anOrderLinesAdded,
  aReturnLinesAdded,
  aStockConsumed,
  aStockSet,
} from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import {
  applyEvent,
  applyEvents,
  buildEngineState,
  getTickIntents,
  initialEngineState,
  isOrderInEngine,
  liveInterval,
  noOrderInEngine,
  ORDER_EXIT_AFTER_SERVED_MS,
  stockEffects,
  type EngineState,
} from '../src/index';
import { InvalidEvent } from '../src/invalid-event';
import { liveProfile } from '../src/live';
import { slipDueOf } from '../src/slip';

const T0 = 1_761_000_000_000;
const M = 60_000;
const at = (min: number): number => T0 + min * M;
const ABANDON = 14_400_000;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const S1 = (parseEvent(anEngineConfigApplied()).payload as unknown as EngineConfig).stations[0]!;

function cfg(capacity = 1): PosEvent {
  return anEngineConfigApplied({
    recorded_at: T0 - 3_600_000,
    occurred_at: T0 - 3_600_000,
    seq: 1,
    payload: { stations: [{ ...S1, capacity }, { ...S1, station_id: 'S2', capacity }] },
  });
}

let seq = 10;
const nextSeq = (n = 0): number => {
  const s = seq;
  seq += n + 1;
  return s;
};

type Item = { id: string; cook_min?: number; mode?: 'sync' | 'immediate' };

function batch(order_id: string, items: Item[], recorded_at: number, order?: Record<string, unknown>): PosEvent[] {
  return anOrderBatch({
    order_id,
    recorded_at,
    seq: nextSeq(items.length),
    lines: items.map((i) => ({ order_item_id: i.id, item: { cook_time_ms: (i.cook_min ?? 20) * M, serve_mode: i.mode ?? 'immediate' } })),
    ...(order === undefined ? {} : { order }),
  });
}

// An order-stream event of `order_id` at `recorded_at`.
function ev(event_type: string, order_id: string, payload: Record<string, unknown>, recorded_at: number): PosEvent {
  const s = nextSeq();
  return { ...anItemStarted(), event_type, stream_id: order_id, payload, recorded_at, occurred_at: recorded_at, seq: s, event_id: `01J${String(s).padStart(23, '0')}` };
}
const fire = (ids: string[], t: number, station_id = 'S1'): PosEvent =>
  aFireDispatched({ stream_id: station_id, recorded_at: t, occurred_at: t, seq: nextSeq(), payload: { station_id, order_item_ids: ids, due_at: t } });
const start = (o: string, id: string, t: number): PosEvent => ev('ItemStarted', o, { order_item_id: id, started_at: t, source: 'tap' }, t);
const done = (o: string, id: string, t: number): PosEvent => ev('ItemDone', o, { order_item_id: id, done_at: t, source: 'tap' }, t);
const served = (o: string, ids: string[], t: number): PosEvent => ev('ItemServed', o, { order_item_ids: ids, source: 'tap' }, t);
const voided = (o: string, id: string, units: number, t: number): PosEvent => ev('ItemVoided', o, { order_item_id: id, units }, t);
const removed = (o: string, id: string, t: number): PosEvent => ev('ItemRemoved', o, { order_item_id: id }, t);
// A listed event that names no order (stock stream): runs the removal step only.
const tickle = (t: number): PosEvent => aStockSet({ recorded_at: t, occurred_at: t, seq: nextSeq() });
const unlisted = (event_type: string, t: number): PosEvent => ({ ...tickle(t), stream_type: 'audit', event_type, payload: {} });

function fold(events: PosEvent[], state: EngineState = initialEngineState(), opts?: { strict?: boolean }): EngineState {
  let s = deepFreeze(state);
  for (const e of events) s = deepFreeze(applyEvent(s, deepFreeze(e), opts));
  return s;
}

const reasons = (s: EngineState): unknown[] => s.diagnostics.map((d) => d.detail.reason);

// O1 / L1 (20 min, immediate) placed at 0, fired, started, done and served at 30.
function servedOrder(): PosEvent[] {
  return [...batch('O1', [{ id: 'L1' }], at(0)), fire(['L1'], at(0)), start('O1', 'L1', at(0)), done('O1', 'L1', at(20)), served('O1', ['L1'], at(30))];
}

describe('@pos/engine lifecycle: exit by the served rule', () => {
  it('[03a #49] exit on all served / voided / removed and at day close', () => {
    const s = fold([cfg(), ...servedOrder()]);
    expect(s.orders.O1!.last_served_at).toBe(at(30));
    expect(isOrderInEngine(s, 'O1', at(30) + ORDER_EXIT_AFTER_SERVED_MS - 1)).toBe(true);
    expect(isOrderInEngine(s, 'O1', at(30) + ORDER_EXIT_AFTER_SERVED_MS)).toBe(false);
    expect(isOrderInEngine(s, 'NOPE', at(30))).toBe(false);

    // A void or remove that leaves no open line starts the window.
    const two = fold([cfg(), ...batch('O2', [{ id: 'A' }, { id: 'B' }], at(0)), fire(['A'], at(0)), done('O2', 'A', at(20)), served('O2', ['A'], at(25))]);
    expect(two.orders.O2!.last_served_at).toBeNull();
    const v = fold([voided('O2', 'B', 1, at(40))], two);
    expect(v.orders.O2!.last_served_at).toBe(at(40));
    expect(v.orders.O2!.last_line_fold_at).toBe(at(40));
    expect(isOrderInEngine(v, 'O2', at(40) + ORDER_EXIT_AFTER_SERVED_MS)).toBe(false);
    const r = fold([removed('O2', 'B', at(41))], two);
    expect(r.orders.O2!.last_served_at).toBe(at(41));

    // At BusinessDayClosed: an all-served order exits inside its window; an order with an unserved line stays.
    const day = aBusinessDayOpened({ recorded_at: at(-60), occurred_at: at(-60), seq: nextSeq() });
    const open = fold([cfg(), day, ...servedOrder(), ...batch('O4', [{ id: 'D' }], at(31))]);
    const closed = fold([aBusinessDayClosed({ recorded_at: at(32), occurred_at: at(32), seq: nextSeq() })], open);
    expect(closed.orders.O1).toBeUndefined();
    expect(closed.lines.L1).toBeUndefined();
    expect(closed.orders.O4).toBeDefined();
    expect(closed.lines.D!.stage).toBe('added');
    expect(closed.business_day!.closed_at).toBe(at(32));
  });

  it('[03a #78] readers treat it as gone from the deadline; removal at the next listed event only; a return re-opens; absent headerless OrderLinesAdded is InvalidEvent(order_not_in_engine)', () => {
    const s = fold([cfg(), ...servedOrder()]);
    const deadline = at(30) + ORDER_EXIT_AFTER_SERVED_MS;
    // An audit receipt and an AlertSeen past the deadline are not handled: state itself, nothing removed.
    expect(Object.is(applyEvent(s, unlisted('AuditRecorded', deadline + 1)), s)).toBe(true);
    expect(Object.is(applyEvent(s, unlisted('AlertSeen', deadline + 2)), s)).toBe(true);
    expect(s.orders.O1).toBeDefined();
    expect(isOrderInEngine(s, 'O1', deadline + 2)).toBe(false);
    expect(noOrderInEngine(s, deadline + 2)).toBe(true);
    expect(noOrderInEngine(s, deadline - 1)).toBe(false);
    // The next listed event removes it, with its lines.
    const after = fold([tickle(deadline + 3)], s);
    expect(after.orders.O1).toBeUndefined();
    expect(after.lines.L1).toBeUndefined();
    expect(after.stations).toEqual(s.stations);
    // ... and one before the deadline does not.
    expect(fold([tickle(deadline - 1)], s).orders.O1).toBeDefined();

    // A return inside the window re-opens: also when the batch's recorded_at is a few ms past the deadline.
    const ret = aReturnLinesAdded({ ...servedOrder()[1]!, seq: nextSeq(3) }, 'fix', { recorded_at: deadline + 5 });
    const reopened = fold(ret, s);
    expect(reopened.orders.O1!.last_served_at).toBeNull();
    expect(reopened.orders.O1!.last_line_fold_at).toBe(deadline + 5);
    expect(reopened.lines.L1R!.fire_ms).not.toBeNull();
    expect(isOrderInEngine(reopened, 'O1', deadline + 5)).toBe(true);
    // Live = replay.
    expect(buildEngineState([cfg(), ...servedOrder(), ...ret])).toEqual({ ...reopened });

    // E-4 (15b check S-1): after removal, an OrderLinesAdded with non-empty order_item_ids and no order_header is
    // InvalidEvent('order_not_in_engine'): strict throws; non-strict one diagnostic and the event skipped.
    const add = anOrderLinesAdded({ recorded_at: deadline + 10, seq: nextSeq() });
    expect(add.payload).not.toHaveProperty('order_header');
    expect(() => applyEvent(after, add)).toThrow(InvalidEvent);
    expect(() => applyEvent(after, add)).toThrow(/order_not_in_engine/);
    const skipped = applyEvent(after, add, { strict: false });
    expect(reasons(skipped)).toEqual(['order_not_in_engine']);
    expect(skipped.orders.O1).toBeUndefined();
  });

  it('[03a #101 engine] minute 35: predicate false; absent → a headerless OrderLinesAdded is InvalidEvent (strict throws); present past the window → it re-opens', () => {
    const s = fold([cfg(), ...batch('O1', [{ id: 'L1' }], at(0)), done('O1', 'L1', at(0)), served('O1', ['L1'], at(0))]);
    expect(isOrderInEngine(s, 'O1', at(35))).toBe(false);
    const add = anOrderLinesAdded({ recorded_at: at(35), occurred_at: at(35), seq: nextSeq() });
    // Present (no listed fold since the deadline): the removal step skips the event's own order, which re-opens.
    const reopened = fold([add, anItemAdded({ recorded_at: at(35), seq: nextSeq(), payload: { order_item_id: 'L2' } })], s);
    expect(reopened.orders.O1!.last_served_at).toBeNull();
    expect(isOrderInEngine(reopened, 'O1', at(35))).toBe(true);
    expect(reopened.lines.L2!.fire_ms).toBe(at(35));
    // Removed at a listed event first → the headerless addition is InvalidEvent('order_not_in_engine') (E-4 b).
    const gone = fold([tickle(at(34))], s);
    expect(gone.orders.O1).toBeUndefined();
    expect(() => applyEvent(gone, add)).toThrow(InvalidEvent);
  });

  it('[03a #99] day close while cooking: only the all-served order exits; later Done / Served commit; absent ids are no-ops', () => {
    const day = aBusinessDayOpened({ recorded_at: at(-60), occurred_at: at(-60), seq: nextSeq() });
    const events = [
      cfg(2),
      day,
      // O1 COOKING
      ...batch('O1', [{ id: 'C1' }], at(0)),
      fire(['C1'], at(0)),
      start('O1', 'C1', at(0)),
      // O2 served
      ...batch('O2', [{ id: 'V1' }], at(0)),
      done('O2', 'V1', at(1)),
      served('O2', ['V1'], at(2)),
      // O3 only unfired lines (a delivery for a pickup 3 h ahead)
      ...batch('O3', [{ id: 'U1', mode: 'sync' }], at(3), { order_type: 'delivery', pickup_at_ms: at(180) }),
    ];
    const open = fold(events);
    expect(open.lines.U1!.fired_at).toBeNull();
    const closed = fold([aBusinessDayClosed({ recorded_at: at(5), occurred_at: at(5), seq: nextSeq() })], open);
    expect(Object.keys(closed.orders).sort()).toEqual(['O1', 'O3']);
    expect(closed.lines.V1).toBeUndefined();
    expect(noOrderInEngine(closed, at(5))).toBe(false);

    // The COOKING order's Done and Served commit; it exits 30 min after the serve.
    const later = fold([done('O1', 'C1', at(20)), served('O1', ['C1'], at(21))], closed);
    expect(later.orders.O1!.last_served_at).toBe(at(21));
    const gone = fold([tickle(at(21) + ORDER_EXIT_AFTER_SERVED_MS)], later);
    expect(gone.orders.O1).toBeUndefined();
    expect(gone.orders.O3).toBeDefined();
    // An ItemDone / ItemServed for an absent line is a no-op that returns state itself.
    const dup = done('O1', 'C1', at(60));
    expect(Object.is(applyEvent(gone, dup), gone)).toBe(true);
    expect(Object.is(applyEvent(gone, served('O1', ['C1'], at(61))), gone)).toBe(true);
    expect(Object.is(applyEvent(gone, dup, { strict: false }), gone)).toBe(true);
    // Live = replay.
    expect(buildEngineState([...events, aBusinessDayClosed({ recorded_at: at(5), occurred_at: at(5), seq: 900 }), done('O1', 'C1', at(20)), served('O1', ['C1'], at(21)), tickle(at(21) + ORDER_EXIT_AFTER_SERVED_MS)])).toEqual({ ...gone });
  });

  it('[03a Review Focus 4] an order with no plannable line exits by the served rule (last_served_at at the awaiting-0 fold)', () => {
    const b = anOrderBatch({
      order_id: 'O9',
      seq: nextSeq(2),
      recorded_at: at(0),
      lines: [
        { order_item_id: 'D1', item: { line_kind: 'deal', item_id: null, deal_id: 'DL1', station_id: null, serve_mode: null, cook_time_ms: null } },
        { order_item_id: 'N1', item: { station_id: null, serve_mode: null, cook_time_ms: null } },
      ],
      order: { lines: [], groups: [] },
    });
    const s = fold([cfg(), ...b]);
    expect(s.orders.O9!.last_served_at).toBe(at(0));
    expect(isOrderInEngine(s, 'O9', at(29))).toBe(true);
    expect(isOrderInEngine(s, 'O9', at(30))).toBe(false);
    expect(fold([tickle(at(30))], s).orders.O9).toBeUndefined();
  });
});

describe('@pos/engine lifecycle: abandon (BF-6, AD-13)', () => {
  it('[03a #111 engine] a fired line never tapped: at last_line_fold_at + order_abandon_ms the predicate is false and the line occupies nothing', () => {
    const events = [cfg(1), ...batch('O1', [{ id: 'L1' }], at(0)), fire(['L1'], at(1))];
    const s = fold(events);
    expect(s.orders.O1!.last_line_fold_at).toBe(at(1));
    const t = at(1) + ABANDON;
    expect(isOrderInEngine(s, 'O1', t - 1)).toBe(true);
    expect(liveInterval(s, 'L1', t - 1)).not.toBeNull();
    expect(liveProfile(s, 'S1', t - 1).u.some((u) => u > 0)).toBe(true);
    expect(isOrderInEngine(s, 'O1', t)).toBe(false);
    expect(liveInterval(s, 'L1', t)).toBeNull();
    expect(liveProfile(s, 'S1', t)).toEqual({ t: [], u: [] });
    // The next submit sees the unit free.
    const o2 = batch('O2', [{ id: 'N1' }], t);
    const next = fold(o2, s);
    expect(next.orders.O1).toBeUndefined();
    expect(next.lines.L1).toBeUndefined();
    expect(next.lines.N1!.fire_ms).toBe(t);

    // An ItemStarted refreshes the clock; a SlipWarned does not.
    const started = fold([start('O1', 'L1', at(60))], s);
    expect(isOrderInEngine(started, 'O1', t)).toBe(true);
    expect(isOrderInEngine(started, 'O1', at(60) + ABANDON)).toBe(false);
    const slip = fold([ev('SlipWarned', 'O1', { table_key: 'dine_in:T12', order_ids: ['O1'], alert_id: 'A1', estimated_land_ms: at(30), target_land_ms: at(20), promise_ms: at(23) }, at(100))], s);
    expect(slip.orders.O1!.last_line_fold_at).toBe(at(1));
    expect(isOrderInEngine(slip, 'O1', t)).toBe(false);
    // Live = replay.
    expect(buildEngineState([...events, ...o2])).toEqual({ ...next });
  });

  it('[03a #111 engine] an order with an unfired line (delivery pickup 6 h ahead) is never abandoned', () => {
    const s = fold([cfg(1), ...batch('O1', [{ id: 'L1', mode: 'sync' }], at(0), { order_type: 'delivery', pickup_at_ms: at(360) })]);
    expect(s.lines.L1!.fired_at).toBeNull();
    expect(isOrderInEngine(s, 'O1', at(0) + ABANDON + 1)).toBe(true);
    expect(isOrderInEngine(s, 'O1', at(0) + 5 * ABANDON)).toBe(true);
  });

  it('[03a BF-6] a 5 h legitimate cook planned to land after last_line_fold_at + order_abandon_ms is not abandoned before its planned land', () => {
    const cooking = fold([cfg(1), ...batch('O1', [{ id: 'L1', cook_min: 300 }], at(0)), fire(['L1'], at(0)), start('O1', 'L1', at(0))]);
    expect(cooking.orders.O1!.last_line_fold_at).toBe(at(0));
    expect(isOrderInEngine(cooking, 'O1', at(0) + ABANDON)).toBe(true);
    expect(isOrderInEngine(cooking, 'O1', at(300) - 1)).toBe(true);
    expect(isOrderInEngine(cooking, 'O1', at(300))).toBe(false);
    // Fired, never started: the same planned land.
    const fired = fold([cfg(1), ...batch('O2', [{ id: 'L2', cook_min: 300 }], at(0)), fire(['L2'], at(0))]);
    expect(isOrderInEngine(fired, 'O2', at(300) - 1)).toBe(true);
    expect(isOrderInEngine(fired, 'O2', at(300))).toBe(false);
    // A late Start keeps the cook alive from its own start.
    const late = fold([start('O2', 'L2', at(30))], fired);
    expect(isOrderInEngine(late, 'O2', at(330) - 1)).toBe(true);
    expect(isOrderInEngine(late, 'O2', at(330))).toBe(false);
  });
});

// AD-20 (task 14b, proposed (implementer, overnight)): the removal step keeps an exited order while one of its lines
// holds a live reservation (reserved_seq ≠ null), so the abandon release (§3.6.1 4a) or the close release (§3.7) can
// still find it; it occupies nothing meanwhile, and leaves at the first listed fold after its release.
describe('@pos/engine lifecycle: an exited order is kept while it holds a reservation (AD-20)', () => {
  // KB: 4 pieces counted before the day. O1 / L1 (20 min, immediate) from stock, one KB reserved at the submit.
  function reservedOrder(order_id: string, id: string, t: number): PosEvent[] {
    return anOrderBatch({
      order_id,
      recorded_at: t,
      seq: nextSeq(3),
      lines: [{ order_item_id: id, item: { cook_time_ms: 20 * M, serve_mode: 'immediate', stock_time_ms: 60_000, stock_draws: [{ stock_item_id: 'KB', quantity: 1 }] }, line: { from_stock: true } }],
      reserved: [{ stock_item_id: 'KB', order_item_id: id, quantity: 1 }],
    });
  }
  const kb = (on_hand: number, t: number): PosEvent => aStockSet({ stream_id: 'KB', recorded_at: t, occurred_at: t, seq: nextSeq(), payload: { stock_item_id: 'KB', on_hand, unit: 'piece' } });
  // The host's part (task 22): engine drafts stamped at now.
  function stamped(drafts: ReadonlyArray<{ stream_type: string; stream_id: string; event_type: string; payload: unknown }>, t: number): PosEvent[] {
    return drafts.map((d) => {
      const s = nextSeq();
      return { ...tickle(t), stream_type: d.stream_type as PosEvent['stream_type'], stream_id: d.stream_id, event_type: d.event_type, schema_version: 1, payload: d.payload as Record<string, unknown>, seq: s, event_id: `01J${String(s).padStart(23, '0')}` };
    });
  }

  it('[03a AD-20] abandoned with a live reservation: not removed by a later listed fold; occupies nothing; the tick release is drafted and folded; removed at the next listed fold', () => {
    const events = [cfg(1), kb(4, at(-60)), ...reservedOrder('O1', 'L1', at(0)), fire(['L1'], at(1))];
    const s = fold(events);
    expect(s.lines.L1!.reserved_seq).not.toBeNull();
    expect(s.stock.KB!.reserved).toBe(1);
    const t = at(1) + ABANDON;
    // A listed fold past the abandon time keeps O1: it holds a reservation.
    const kept = fold([tickle(t + 1)], s);
    expect(kept.orders.O1).toBeDefined();
    expect(kept.lines.L1).toBeDefined();
    expect(isOrderInEngine(kept, 'O1', t + 1)).toBe(false);
    expect(liveInterval(kept, 'L1', t + 1)).toBeNull();
    expect(liveProfile(kept, 'S1', t + 1)).toEqual({ t: [], u: [] });
    // §3.6.1 noOrderInEngine: "no line of an exited order holds a live reservation".
    expect(noOrderInEngine(kept, t + 1)).toBe(false);
    // The fires pass drafts the abandon release from the kept line; folded, the line is fresh and the entry free.
    const drafts = getTickIntents(kept, t + 1);
    expect(drafts.map((d) => [d.event_type, (d.payload as { reason?: string }).reason])).toEqual([['StockReleased', 'abandoned']]);
    const released = fold(stamped(drafts, t + 1), kept);
    expect(released.stock.KB!.reserved).toBe(0);
    expect(released.lines.L1!.reserved_seq).toBeNull();
    expect(released.orders.O1).toBeDefined(); // the removal step ran before the release's own fold
    expect(noOrderInEngine(released, t + 1)).toBe(true);
    const gone = fold([tickle(t + 2)], released);
    expect(gone.orders.O1).toBeUndefined();
    expect(gone.lines.L1).toBeUndefined();
    expect(gone.stock.KB!.reserved).toBe(0);
    // Live = replay.
    expect(buildEngineState([...events, tickle(t + 1), ...stamped(drafts, t + 1), tickle(t + 2)])).toEqual({ ...gone });
  });

  it('[03a AD-20] a kept exited order never re-enters: order-stream and station folds on it return state itself; the release still folds; then removed', () => {
    const events = [cfg(1), kb(4, at(-60)), ...reservedOrder('O1', 'L1', at(0)), fire(['L1'], at(1))];
    const t = at(1) + ABANDON;
    const kept = fold([tickle(t + 1)], fold(events));
    expect(kept.orders.O1).toBeDefined();
    const shift = { ...fire(['L1'], t + 2), event_type: 'ReservationsShifted', payload: { station_id: 'S1', cause: 'overrun', shifts: [{ order_item_id: 'L1', by_ms: 60_000 }] } };
    const boosted = ev('OrderBoosted', 'O1', { order_id: 'O1' }, t + 2);
    for (const e of [start('O1', 'L1', t + 2), done('O1', 'L1', t + 2), served('O1', ['L1'], t + 2), removed('O1', 'L1', t + 2), voided('O1', 'L1', 1, t + 2), fire(['L1'], t + 2), shift, boosted]) {
      for (const strict of [true, false]) {
        const after = applyEvent(kept, e, { strict });
        expect(Object.is(after, kept), `${e.event_type} strict=${strict}`).toBe(true);
        expect(isOrderInEngine(after, 'O1', t + 2)).toBe(false);
      }
    }
    // After a Start that changed nothing, the abandon release is still drafted, folds, and the next listed fold removes O1.
    const tapped = fold([start('O1', 'L1', t + 2)], kept);
    const drafts = getTickIntents(tapped, t + 3);
    expect(drafts.map((d) => [d.event_type, (d.payload as { reason?: string }).reason])).toEqual([['StockReleased', 'abandoned']]);
    const released = fold(stamped(drafts, t + 3), tapped);
    expect(released.stock.KB!.reserved).toBe(0);
    expect(released.orders.O1).toBeDefined();
    expect(fold([tickle(t + 4)], released).orders.O1).toBeUndefined();
  });

  it('[03a AD-20] a log with no consume (a writer that skipped stockEffects; AD-29 Q7 drafts one): the served exit is kept 30 min on; released by the abandon pass, or by the close', () => {
    const day = aBusinessDayOpened({ recorded_at: at(-60), occurred_at: at(-60), seq: nextSeq() });
    const events = [cfg(1), day, kb(4, at(-60)), ...reservedOrder('O1', 'L1', at(0)), fire(['L1'], at(0)), done('O1', 'L1', at(20)), served('O1', ['L1'], at(25))];
    const s = fold(events);
    expect(s.lines.L1!.stage).toBe('served');
    expect(s.lines.L1!.reserved_seq).not.toBeNull(); // the fold of the Done itself never consumes; only a StockConsumed does
    const exit = at(25) + ORDER_EXIT_AFTER_SERVED_MS;
    const kept = fold([tickle(exit + 1)], s);
    expect(kept.orders.O1).toBeDefined();
    expect(isOrderInEngine(kept, 'O1', exit + 1)).toBe(false);
    expect(noOrderInEngine(kept, exit + 1)).toBe(false);
    // (a) The abandon pass, at last_line_fold_at + order_abandon_ms (the served rule set aside, §3.6.1 4a).
    const abandon = at(25) + ABANDON;
    expect(getTickIntents(kept, abandon - 1)).toEqual([]);
    const drafts = getTickIntents(kept, abandon);
    expect(drafts.map((d) => [d.event_type, (d.payload as { order_item_id?: string }).order_item_id, (d.payload as { reason?: string }).reason])).toEqual([['StockReleased', 'L1', 'abandoned']]);
    const a = fold([...stamped(drafts, abandon), tickle(abandon + 1)], kept);
    expect(a.orders.O1).toBeUndefined();
    expect(a.stock.KB!.reserved).toBe(0);
    // (b) The close (§3.7 close row: a line of an order already out of the engine that still holds a reservation).
    const closeAt = exit + 2;
    const close = aBusinessDayClosed({ recorded_at: closeAt, occurred_at: closeAt, seq: nextSeq() });
    const releases = stockEffects(kept, { event_type: 'BusinessDayClosed', payload: {}, occurred_at: closeAt });
    expect(releases.map((d) => [d.event_type, (d.payload as { order_item_id?: string }).order_item_id, (d.payload as { reason?: string }).reason])).toEqual([['StockReleased', 'L1', 'day_closed']]);
    const b = fold([...stamped(releases, closeAt), close], kept);
    expect(b.orders.O1).toBeUndefined();
    expect(b.stock.KB!.reserved).toBe(0);
    expect(noOrderInEngine(b, closeAt)).toBe(true);
  });

  // AD-29 Q7: the consume is drafted with the cause, so no reservation outlives the serve and the AD-20 keep does not apply.
  function withEffects(state: EngineState, cause: PosEvent, t: number): EngineState {
    const drafts = stockEffects(state, { event_type: cause.event_type, payload: cause.payload, occurred_at: t });
    return fold([cause, ...stamped(drafts, t)], state);
  }

  it.each([
    ['a Done without a Start', true],
    ['a Served with neither', false],
  ])('[03a AD-29 Q7] %s: the order exits on the served rule, removed at the next listed fold, reserved back to 0', (_name, tapDone) => {
    const day = aBusinessDayOpened({ recorded_at: at(-60), occurred_at: at(-60), seq: nextSeq() });
    let s = fold([cfg(1), day, kb(4, at(-60)), ...reservedOrder('O1', 'L1', at(0)), fire(['L1'], at(0))]);
    if (tapDone) s = withEffects(s, done('O1', 'L1', at(20)), at(20));
    s = withEffects(s, served('O1', ['L1'], at(25)), at(25));
    expect(s.lines.L1).toMatchObject({ stage: 'served', reserved_seq: null, from_stock: true });
    expect(s.stock.KB).toMatchObject({ on_hand: 3, reserved: 0 });
    const exit = at(25) + ORDER_EXIT_AFTER_SERVED_MS;
    expect(isOrderInEngine(s, 'O1', exit - 1)).toBe(true);
    expect(noOrderInEngine(s, exit - 1)).toBe(false);
    expect(noOrderInEngine(s, exit)).toBe(true); // not the 4 h of AD-20: nothing is held
    expect(getTickIntents(s, exit)).toEqual([]);
    const gone = fold([tickle(exit)], s);
    expect(gone.orders.O1).toBeUndefined();
    expect(gone.lines.L1).toBeUndefined();
    expect(gone.stock.KB!.reserved).toBe(0);
    expect(noOrderInEngine(gone, exit)).toBe(true);
  });

  it('[03a AD-29 Q7] the tick: an inferred Done needs a COOKING line, so it never meets a Start-less reservation; a Done without a Start, then Undo, gets no second consume', () => {
    const config = anEngineConfigApplied({ recorded_at: at(-60), occurred_at: at(-60), seq: 1, payload: { stations: [{ ...S1, capacity: 1, completion_mode: 'auto_done' }] } });
    const day = aBusinessDayOpened({ recorded_at: at(-60), occurred_at: at(-60), seq: nextSeq() });
    const s0 = fold([config, day, kb(4, at(-60)), ...reservedOrder('O1', 'L1', at(0)), fire(['L1'], at(0))]);
    // Fired, never started, far past any planned end: no inferred Done is due, the reservation just stays.
    expect(getTickIntents(s0, at(600)).filter((d) => d.event_type === 'ItemDone')).toEqual([]);
    // Done without a Start, then Undo: COOKING again with the consume standing.
    const undone = fold([ev('ItemDoneUndone', 'O1', { order_item_id: 'L1' }, at(2))], withEffects(s0, done('O1', 'L1', at(1)), at(1)));
    expect(undone.lines.L1).toMatchObject({ stage: 'cooking', reserved_seq: null, started_at: at(1) });
    const inferred = getTickIntents(undone, at(100)).filter((d) => d.event_type === 'ItemDone');
    expect(inferred.map((d) => (d.payload as { order_item_id: string }).order_item_id)).toEqual(['L1']);
    expect(getTickIntents(undone, at(100)).filter((d) => d.event_type === 'StockConsumed')).toEqual([]);
    expect(stockEffects(undone, { event_type: 'ItemDone', payload: inferred[0]!.payload as unknown as Record<string, unknown>, occurred_at: at(100) })).toEqual([]);
  });

  // Reading 3, proposed (implementer): the draft reads the line only, as the Start's does. The stage fold is a no-op on a
  // kept order; the consume still folds, so the tick has no release left and the order leaves at the next listed fold.
  it.each([
    ['Done', (t: number): PosEvent => done('O1', 'L1', t)],
    ['Served', (t: number): PosEvent => served('O1', ['L1'], t)],
  ])('[03a AD-29 Q7] %s naming a line of an AD-20 kept order: its fold is a no-op, the consume folds, no abandon release is left', (_name, cause) => {
    const day = aBusinessDayOpened({ recorded_at: at(-60), occurred_at: at(-60), seq: nextSeq() });
    const s0 = fold([cfg(1), day, kb(4, at(-60)), ...reservedOrder('O1', 'L1', at(0)), fire(['L1'], at(0))]);
    const t = at(0) + ABANDON + 5 * M;
    const kept = fold([tickle(t)], s0);
    expect(kept.orders.O1).toBeDefined();
    expect(isOrderInEngine(kept, 'O1', t)).toBe(false);
    expect(getTickIntents(kept, t).map((d) => d.event_type)).toEqual(['StockReleased']);
    const s = withEffects(kept, cause(t), t);
    expect(s.lines.L1).toMatchObject({ stage: 'added', reserved_seq: null, from_stock: true });
    expect(s.stock.KB).toMatchObject({ reserved: 0 });
    expect(s.stock.KB!.on_hand).toBe(kept.stock.KB!.on_hand - 1);
    expect(getTickIntents(s, t + 1)).toEqual([]);
    expect(noOrderInEngine(s, t + 1)).toBe(true);
    expect(fold([tickle(t + 1)], s).orders.O1).toBeUndefined();
  });

  it('[03a AD-20] a kept served-exit order is present: an OrderLinesAdded past its exit re-opens it (§3.3, test 78); its reservation stays', () => {
    const events = [cfg(1), kb(4, at(-60)), ...reservedOrder('O1', 'L1', at(0)), fire(['L1'], at(0)), done('O1', 'L1', at(20)), served('O1', ['L1'], at(25))];
    const exit = at(25) + ORDER_EXIT_AFTER_SERVED_MS;
    const kept = fold([tickle(exit)], fold(events));
    expect(kept.orders.O1).toBeDefined();
    expect(isOrderInEngine(kept, 'O1', exit + 1)).toBe(false);
    const p = anOrderLinesAdded().payload as { groups: Array<Record<string, unknown>>; lines: Array<Record<string, unknown>> };
    const s2 = nextSeq();
    const added: PosEvent = {
      ...anOrderLinesAdded({
        stream_id: 'O1',
        payload: {
          order_id: 'O1',
          order_item_ids: ['L2'],
          groups: p.groups.map((g) => ({ ...g, group_id: `O1:${kept.orders.O1!.next_group_index}`, order_item_ids: ['L2'] })),
          lines: p.lines.map((l) => ({ ...l, order_item_id: 'L2' })),
        },
      }),
      recorded_at: exit + 1,
      occurred_at: exit + 1,
      seq: s2,
      event_id: `01J${String(s2).padStart(23, '0')}`,
    };
    const reopened = fold([added], kept);
    expect(reopened.orders.O1!.last_served_at).toBeNull();
    expect(isOrderInEngine(reopened, 'O1', exit + 1)).toBe(true);
    expect(reopened.lines.L1!.reserved_seq).toBe(kept.lines.L1!.reserved_seq);
    expect(reopened.stock.KB!.reserved).toBe(1);
    expect(buildEngineState([...events, tickle(exit), added])).toEqual({ ...reopened });
  });

  it('[03a AD-20] the close itself keeps an all-served order whose line still holds a reservation (no release written)', () => {
    const day = aBusinessDayOpened({ recorded_at: at(-60), occurred_at: at(-60), seq: nextSeq() });
    const s = fold([cfg(1), day, kb(4, at(-60)), ...reservedOrder('O1', 'L1', at(0)), fire(['L1'], at(0)), done('O1', 'L1', at(20)), served('O1', ['L1'], at(25))]);
    const closed = fold([aBusinessDayClosed({ recorded_at: at(26), occurred_at: at(26), seq: nextSeq() })], s);
    expect(closed.orders.O1).toBeDefined();
    expect(closed.lines.L1!.reserved_seq).not.toBeNull();
    expect(closed.stock.KB!.reserved).toBe(1);
  });
});

describe('@pos/engine lifecycle: invariants and deterministic ids', () => {
  it('[03a §6.1a] a type outside ENGINE_REPLAY_EVENTS returns state itself; a listed event with nothing to remove does not copy orders', () => {
    const s = fold([cfg(), ...servedOrder()]);
    for (const type of ['AuditRecorded', 'AlertSeen', 'HubStarted', 'TableLockReleased']) {
      expect(Object.is(applyEvent(s, unlisted(type, at(10_000))), s)).toBe(true);
    }
    expect(fold([tickle(at(31))], s).orders).toBe(s.orders);
  });

  it('[03a #81] group ids order_id:0…, a new OrderLinesAdded group takes next_group_index, FireDispatched fixes load_id; snapshot + replay = full replay', () => {
    const groups = [
      { group_id: 'O1:0', target_land_ms: at(20), promise_ms: at(23), order_item_ids: ['A'] },
      { group_id: 'O1:1', target_land_ms: at(20), promise_ms: at(23), order_item_ids: ['B'] },
    ];
    const placed = batch('O1', [{ id: 'A', mode: 'sync' }, { id: 'B', mode: 'sync' }], at(0), { groups });
    const s = fold([cfg(2), ...placed]);
    expect(Object.keys(s.orders.O1!.groups)).toEqual(['O1:0', 'O1:1']);
    expect(s.orders.O1!.next_group_index).toBe(2);
    expect(s.lines.B!.group_id).toBe('O1:1');

    const add = anOrderLinesAdded({ recorded_at: at(1), seq: nextSeq(), payload: { groups: [{ group_id: 'O1:2', target_land_ms: at(30), promise_ms: at(33), order_item_ids: ['L2'] }] } });
    const a = fold([add, anItemAdded({ recorded_at: at(1), seq: nextSeq(), payload: { order_item_id: 'L2' } })], s);
    expect(a.orders.O1!.next_group_index).toBe(3);
    expect(a.lines.L2!.group_id).toBe('O1:2');

    // A group id that is not order_id:(next_group_index + i) is a writer bug (AD-8).
    for (const bad of ['O1:5', 'O1:1', 'O2:2', 'O1:x']) {
      const e = anOrderLinesAdded({ recorded_at: at(1), seq: nextSeq(), payload: { groups: [{ group_id: bad, target_land_ms: at(30), promise_ms: at(33), order_item_ids: ['L2'] }] } });
      expect(() => applyEvent(s, e)).toThrow(/group_id_invalid/);
      const ns = applyEvent(s, e, { strict: false });
      expect(ns.orders).toBe(s.orders);
      expect(reasons(ns)).toEqual(['group_id_invalid']);
    }
    const badPlaced = batch('O7', [{ id: 'Z' }], at(0), { groups: [{ group_id: 'O7:1', target_land_ms: at(20), promise_ms: at(23), order_item_ids: ['Z'] }] });
    expect(() => fold([cfg(), badPlaced[0]!])).toThrow(/group_id_invalid/);

    // FireDispatched.load_id is stored as the line's load name.
    const f = fold([aFireDispatched({ recorded_at: at(2), seq: nextSeq(), payload: { order_item_ids: ['A'], load_id: 'S1:A' } })], a);
    expect(f.lines.A!.load_id).toBe('S1:A');

    // Snapshot (JSON round trip) + replay of the rest = full replay.
    const head = [cfg(2), ...placed];
    const tail = [add, anItemAdded({ recorded_at: at(1), seq: 800, payload: { order_item_id: 'L2' } }), fire(['A'], at(2)), done('O1', 'A', at(22)), served('O1', ['A', 'B', 'L2'], at(40)), tickle(at(40) + ORDER_EXIT_AFTER_SERVED_MS)];
    const snap = JSON.parse(JSON.stringify(buildEngineState(head))) as EngineState;
    let resumed = snap;
    for (const e of tail) resumed = applyEvent(resumed, e);
    expect(resumed).toEqual(buildEngineState([...head, ...tail]));
  });

  it('[03a §3.3] last_line_fold_at: listed order folds refresh it, an ItemReturned included; stock and tick-only events do not', () => {
    const s = fold([cfg(), ...servedOrder()]);
    expect(s.orders.O1!.last_line_fold_at).toBe(at(30));
    const ret = aReturnLinesAdded({ ...servedOrder()[1]!, seq: nextSeq(3) }, 'remake', { recorded_at: at(31) });
    const r = fold([...ret.slice(0, 2), { ...ret[2]!, recorded_at: at(32) }], s);
    expect(r.lines.L1!.stage).toBe('returned');
    expect(r.orders.O1!.last_line_fold_at).toBe(at(32));
    expect(fold([tickle(at(50))], r).orders.O1!.last_line_fold_at).toBe(at(32));
    for (const [type, payload] of [
      ['OrderBoosted', { order_id: 'O1' }],
      ['ItemsReleased', { order_id: 'O1', alert_id: null, released: [], expedite: [] }],
      ['ItemMovedToStock', { order_item_id: 'L1R', units: 1 }],
    ] as const) {
      expect(fold([ev(type, 'O1', payload, at(60))], r).orders.O1!.last_line_fold_at).toBe(at(60));
    }
    // A wrong-stage no-op (AD-10) returns state itself and does not refresh.
    expect(Object.is(applyEvent(r, done('O1', 'L1', at(70))), r)).toBe(true);
  });
});

describe('@pos/engine lifecycle: carried AD-8 writer-bug checks', () => {
  it('[03a AD-8] a duplicate deal ItemAdded while awaiting > 0 is consumed once: strict throws, non-strict diagnostic, the engine line still plans', () => {
    const b = anOrderBatch({
      seq: nextSeq(3),
      recorded_at: at(0),
      lines: [{ order_item_id: 'D1', item: { line_kind: 'deal', item_id: null, deal_id: 'DL1', station_id: null, serve_mode: null, cook_time_ms: null } }, { order_item_id: 'L1' }],
      order: { lines: [b0Line('L1')] },
    });
    const [placed, deal, line] = b as [PosEvent, PosEvent, PosEvent];
    const events = [cfg(), placed, deal, { ...deal, seq: 777 }, line];
    expect(() => fold(events)).toThrow(/line_not_listed/);
    const s = fold(events, initialEngineState(), { strict: false });
    expect(reasons(s)).toEqual(['line_not_listed']);
    expect(s.orders.O1!.awaiting).toBe(0);
    expect(s.lines.L1!.fire_ms).toBe(at(0));
    // A non-engine ItemAdded after awaiting 0 is unlisted too.
    expect(() => fold([{ ...deal, seq: 778 }], fold([cfg(), placed, deal, line]))).toThrow(/line_not_listed/);
  });

  it('[03a AD-8] an OrderPlaced lines[] entry whose id is not in order_item_ids is a writer bug', () => {
    const b = anOrderBatch({ seq: nextSeq(1), recorded_at: at(0), order: { lines: [b0Line('L1'), b0Line('GHOST')] } });
    expect(() => fold([cfg(), b[0]!])).toThrow(/line_not_in_order/);
    const s = fold([cfg(), ...b], initialEngineState(), { strict: false });
    expect(s.orders.O1).toBeUndefined();
    expect(reasons(s)).toEqual(['line_not_in_order']);
  });

  it('[03a AD-8] FireDispatched: a line on another station, or of an order still awaiting lines, is left untouched', () => {
    const base = fold([cfg(), ...batch('O1', [{ id: 'A' }, { id: 'B' }], at(0))]);
    const wrong = fire(['A', 'B'], at(1), 'S2');
    expect(() => applyEvent(base, wrong)).toThrow(/station_mismatch/);
    const mixed = aFireDispatched({ recorded_at: at(1), seq: nextSeq(), payload: { order_item_ids: ['A', 'B'] } });
    const onS2 = { ...base, lines: { ...base.lines, B: { ...base.lines.B!, station_id: 'S2' } } };
    const ns = applyEvent(deepFreeze(onS2), mixed, { strict: false });
    expect(ns.lines.A!.fired_at).toBe(at(1));
    expect(ns.lines.B).toBe(onS2.lines.B);
    expect(reasons(ns)).toEqual(['station_mismatch']);

    const placed = anOrderBatch({ seq: nextSeq(2), recorded_at: at(0), lines: [{ order_item_id: 'L1' }, { order_item_id: 'L2' }] });
    const half = fold([cfg(), placed[0]!, placed[1]!]);
    expect(half.orders.O1!.awaiting).toBe(1);
    const f = aFireDispatched({ recorded_at: at(0), seq: nextSeq() });
    expect(() => applyEvent(half, f)).toThrow(/order_awaiting/);
    const nh = applyEvent(half, f, { strict: false });
    expect(nh.lines.L1).toBe(half.lines.L1);
    expect(reasons(nh)).toEqual(['order_awaiting']);
  });

  it('[03a AD-8] an order-stream event on another order stream is a writer bug', () => {
    const s = fold([cfg(), ...batch('O1', [{ id: 'L1' }], at(0))]);
    for (const e of [start('O2', 'L1', at(1)), done('O2', 'L1', at(1)), served('O2', ['L1'], at(1)), removed('O2', 'L1', at(1))]) {
      expect(() => applyEvent(s, e)).toThrow(/stream_id_mismatch/);
      const ns = applyEvent(s, e, { strict: false });
      expect(ns.lines).toBe(s.lines);
      expect(reasons(ns)).toEqual(['stream_id_mismatch']);
    }
    const placed = batch('O5', [{ id: 'X' }], at(0));
    expect(() => fold([cfg(), { ...placed[0]!, stream_id: 'O6' }])).toThrow(/stream_id_mismatch/);
  });
});

// OrderPlaced.lines[] engine entry (as the builder's default).
function b0Line(id: string): Record<string, unknown> {
  return { order_item_id: id, station_id: 'S1', alternates: [], point_id: null, carry_ms: 0, from_stock: false, weight_pct: 100, max_early_ms: 60_000, max_late_ms: null, max_carry_ms: null };
}

// AD-29 Q5 (developer: "reject a reused order_item_id; the device mints it"), AD-8: an id that already names a line in
// state.lines, or that one payload lists twice, is a writer bug: strict throws, non-strict one invalid_event, no write.
describe('@pos/engine lifecycle: a reused order_item_id is refused (AD-29 Q5, AD-8)', () => {
  const REUSED = /order_item_id_reused/;
  const placed = (order_id: string, ids: string[], t: number): PosEvent =>
    anOrderBatch({ order_id, recorded_at: t, seq: nextSeq(ids.length), lines: ids.map((id) => ({ order_item_id: id, item: { cook_time_ms: 20 * M, serve_mode: 'immediate' } })) })[0]!;
  const addition = (order_id: string, ids: string[], t: number, group_index: number): PosEvent =>
    anOrderLinesAdded({
      stream_id: order_id,
      recorded_at: t,
      occurred_at: t,
      seq: nextSeq(),
      payload: {
        order_id,
        order_item_ids: ids,
        groups: [{ group_id: `${order_id}:${group_index}`, target_land_ms: t + 30 * M, promise_ms: t + 33 * M, order_item_ids: ids }],
        lines: ids.map((id) => ({ ...b0Line(id), return_of: null, cook_ms_override: null })),
      },
    });

  // Strict throws; non-strict changes nothing but one invalid_event, and applyEvents leaves what the per-event fold leaves.
  function expectRefused(prior: PosEvent[], bad: PosEvent, id: string): EngineState {
    const s = fold(prior);
    expect(() => applyEvent(deepFreeze(s), deepFreeze(bad))).toThrow(REUSED);
    const n = fold([bad], s, { strict: false });
    expect(n.orders).toEqual(s.orders);
    expect(n.lines).toEqual(s.lines);
    expect(n.stations).toEqual(s.stations);
    expect(n.slip_due).toEqual(s.slip_due);
    const added = n.diagnostics.slice(s.diagnostics.length);
    expect(added.map((d) => [d.kind, d.detail.reason, d.detail.order_item_id, d.event_id])).toEqual([['invalid_event', 'order_item_id_reused', id, bad.event_id]]);
    expect(JSON.stringify(applyEvents(deepFreeze(s), [deepFreeze(bad)], { strict: false }))).toBe(JSON.stringify(n));
    return n;
  }

  it('[03a AD-29 Q5] OrderPlaced naming a live line of another order: refused, whatever the line\'s stage', () => {
    const one = batch('O1', [{ id: 'L1' }], at(0));
    expectRefused([cfg(), ...one], placed('O2', ['L1', 'N1'], at(1)), 'L1');
    expectRefused([cfg(), ...one, fire(['L1'], at(1)), start('O1', 'L1', at(1))], placed('O2', ['N1', 'L1'], at(2)), 'L1');
    expectRefused([cfg(), ...one, voided('O1', 'L1', 1, at(1))], placed('O2', ['L1'], at(2)), 'L1');
    expectRefused([cfg(), ...servedOrder()], placed('O2', ['L1'], at(31)), 'L1');
  });

  it('[03a AD-29 Q5] a placeholder of an order still awaiting its ItemAdded is a line too', () => {
    const [p1] = batch('O1', [{ id: 'L1' }, { id: 'L2' }], at(0)) as [PosEvent, ...PosEvent[]];
    expectRefused([cfg(), p1], placed('O2', ['L2'], at(0)), 'L2');
  });

  it('[03a AD-29 Q5] OrderLinesAdded naming a line of its own order, or of another: refused, the order keeps its awaiting and its groups', () => {
    const prior = [cfg(), ...batch('O1', [{ id: 'L1' }], at(0)), ...batch('O2', [{ id: 'L2' }], at(0))];
    const own = expectRefused(prior, addition('O1', ['N1', 'L1'], at(1), 1), 'L1');
    expect(own.orders.O1).toMatchObject({ awaiting: 0, next_group_index: 1 });
    expectRefused(prior, addition('O1', ['L2'], at(1), 1), 'L2');
  });

  it('[03a AD-29 Q5] a deal line (no lines[] entry) with a reused id is refused too', () => {
    const bad = anOrderBatch({
      order_id: 'O2',
      seq: nextSeq(3),
      recorded_at: at(1),
      lines: [{ order_item_id: 'L1', item: { line_kind: 'deal', item_id: null, deal_id: 'DL1', station_id: null, serve_mode: null, cook_time_ms: null } }, { order_item_id: 'N1' }],
      order: { lines: [b0Line('N1')] },
    })[0]!;
    expectRefused([cfg(), ...batch('O1', [{ id: 'L1' }], at(0))], bad, 'L1');
  });

  it('[03a AD-29 Q5] an AD-20 kept order (exited, still reserved) still owns its ids', () => {
    const kept = anOrderBatch({
      order_id: 'O1',
      recorded_at: at(0),
      seq: nextSeq(3),
      lines: [{ order_item_id: 'L1', item: { cook_time_ms: 20 * M, serve_mode: 'immediate', stock_time_ms: 60_000, stock_draws: [{ stock_item_id: 'KB', quantity: 1 }] }, line: { from_stock: true } }],
      reserved: [{ stock_item_id: 'KB', order_item_id: 'L1', quantity: 1 }],
    });
    const stockSet = aStockSet({ stream_id: 'KB', recorded_at: at(-60), occurred_at: at(-60), seq: nextSeq(), payload: { stock_item_id: 'KB', on_hand: 4, unit: 'piece' } });
    const prior = [cfg(), stockSet, ...kept, fire(['L1'], at(0)), done('O1', 'L1', at(20)), served('O1', ['L1'], at(25))];
    const t = at(25) + ORDER_EXIT_AFTER_SERVED_MS + 1;
    const n = expectRefused([...prior, tickle(t)], placed('O2', ['L1'], t), 'L1');
    expect(n.orders.O1).toBeDefined();
    expect(n.lines.L1!.order_id).toBe('O1');
  });

  it('[03a AD-29 Q5] the same id twice in one payload: order_item_ids, lines[], or two groups', () => {
    const base = placed('O2', ['A', 'B'], at(1));
    const pay = base.payload as { order_item_ids: string[]; groups: Array<Record<string, unknown>>; lines: Array<Record<string, unknown>> };
    const prior = [cfg()];
    expectRefused(prior, { ...base, payload: { ...pay, order_item_ids: ['A', 'B', 'A'] } }, 'A');
    expectRefused(prior, { ...base, payload: { ...pay, lines: [...pay.lines, pay.lines[1]!] } }, 'B');
    const g = pay.groups[0]!;
    const twoGroups = [{ ...g, order_item_ids: ['A', 'B'] }, { ...g, group_id: 'O2:1', order_item_ids: ['B'] }];
    expectRefused(prior, { ...base, payload: { ...pay, groups: twoGroups } }, 'B');
  });

  it('[03a AD-29 Q5] the rest of a refused batch: ItemAdded of a refused OrderPlaced is an absent-order no-op; of a refused OrderLinesAdded, line_not_listed', () => {
    const prior = [cfg(), ...batch('O1', [{ id: 'L1' }], at(0))];
    const b = anOrderBatch({ order_id: 'O2', recorded_at: at(1), seq: nextSeq(3), lines: [{ order_item_id: 'L1', item: { cook_time_ms: 20 * M, serve_mode: 'immediate' } }, { order_item_id: 'N1', item: { cook_time_ms: 20 * M, serve_mode: 'immediate' } }] });
    const s = fold([...prior, ...b], initialEngineState(), { strict: false });
    expect(s.orders.O2).toBeUndefined();
    expect(s.lines.N1).toBeUndefined();
    expect(s.lines.L1!.order_id).toBe('O1');
    expect(reasons(s)).toEqual(['order_item_id_reused']);
    const bad = addition('O1', ['N1', 'L1'], at(1), 1);
    const item = anItemAdded({ stream_id: 'O1', recorded_at: at(1), occurred_at: at(1), seq: nextSeq(), payload: { order_id: 'O1', order_item_id: 'N1' } });
    const t = fold([...prior, bad, item], initialEngineState(), { strict: false });
    expect(reasons(t)).toEqual(['order_item_id_reused', 'line_not_listed']);
    expect(t.lines.N1).toBeUndefined();
    expect(t.orders.O1!.awaiting).toBe(0);
  });

  // A reused id with `reserved:`. StockReserved carries no order_id, so once the OrderPlaced is refused it names the
  // other order's line.
  const KB_DRAW = { stock_time_ms: 60_000, stock_draws: [{ stock_item_id: 'KB', quantity: 1 }] };
  const stockAt = (t: number): PosEvent => aStockSet({ stream_id: 'KB', recorded_at: t, occurred_at: t, seq: nextSeq(), payload: { stock_item_id: 'KB', on_hand: 9, unit: 'piece' } });
  const stocked = (order_id: string, from_stock: boolean, t: number, cook_min = 20): PosEvent[] =>
    anOrderBatch({
      order_id,
      recorded_at: t,
      seq: nextSeq(3),
      lines: [{ order_item_id: 'L1', item: { cook_time_ms: cook_min * M, serve_mode: 'immediate', ...KB_DRAW }, line: { from_stock } }],
      ...(from_stock ? { reserved: [{ stock_item_id: 'KB', order_item_id: 'L1', quantity: 1 }] } : {}),
    });
  const consumed = (t: number): PosEvent => aStockConsumed({ stream_id: 'KB', recorded_at: t, occurred_at: t, seq: nextSeq(), payload: { stock_item_id: 'KB', order_item_id: 'L1', quantity: 1 } });
  const NS = { strict: false };

  it.each([
    ['cooking', (t: number): PosEvent[] => [fire(['L1'], t), start('O1', 'L1', t), consumed(t)]],
    ['done', (t: number): PosEvent[] => [fire(['L1'], t), start('O1', 'L1', t), consumed(t), done('O1', 'L1', t)]],
    ['done, no Start', (t: number): PosEvent[] => [done('O1', 'L1', t), consumed(t)]],
    ['served', (t: number): PosEvent[] => [done('O1', 'L1', t), consumed(t), served('O1', ['L1'], t)]],
  ])('[03a AD-29 Q5, §3.7] a refused batch with reserved: its StockReserved on a line %s is refused too, no write', (_name, path) => {
    const s = fold([cfg(), stockAt(at(-60)), ...stocked('O1', true, at(0)), ...path(at(1))]);
    expect(s.lines.L1!.reserved_seq).toBeNull();
    const refused = stocked('O2', true, at(2));
    const n = fold(refused, s, NS);
    expect(n.stock).toEqual(s.stock);
    expect(n.lines.L1).toEqual(s.lines.L1);
    expect(n.orders.O2).toBeUndefined();
    expect(reasons(n)).toEqual(['order_item_id_reused', 'stock_reserved_past_added']);
    expect(n.diagnostics.filter((d) => d.kind === 'stock_breach')).toEqual([]);
    expect(JSON.stringify(applyEvents(deepFreeze(s), refused.map(deepFreeze), NS))).toBe(JSON.stringify(n));
    // The StockReserved alone, strict: AD-8 throws.
    expect(() => fold([refused[refused.length - 1]!], s)).toThrow(/stock_reserved_past_added/);
  });

  // KNOWN LIMIT, closed by the To 02 row (02 refuses a reused id before append; the device mints it). A StockReserved has
  // no order_id, so on a line still at `added` the fold can't tell a refused batch's from a legal StockAdded flip (§3.7).
  // S2: the other order's fresh line takes the reservation and its stock cook. This pins today's result, not a wanted one.
  it('[03a AD-29 Q5] known limit, To 02: a refused batch\'s StockReserved flips the other order\'s fresh line at `added`', () => {
    const s = fold([cfg(), stockAt(at(-60)), ...stocked('O1', false, at(0))]);
    expect(s.lines.L1).toMatchObject({ from_stock: false, cook_ms: 20 * M, reserved_seq: null });
    const n = fold(stocked('O2', true, at(1)), s, NS);
    expect(n.orders.O2).toBeUndefined();
    expect(n.lines.L1).toMatchObject({ order_id: 'O1', from_stock: true, cook_ms: 60_000 });
    expect(n.lines.L1!.reserved_seq).not.toBeNull();
    expect(n.stock.KB!.reserved).toBe(1);
    expect(reasons(n)).toEqual(['order_item_id_reused']);
  });

  // S3, also at `added`, so the stage guard does not reach it, and also closed by the To 02 row: the draw is full, so the
  // fold takes nothing; the only effect is one stock_breach diagnostic beside the invalid_event.
  it('[03a AD-29 Q5] known limit, To 02: a refused batch\'s StockReserved on a line at `added` already holding changes nothing but one breach', () => {
    const s = fold([cfg(), stockAt(at(-60)), ...stocked('O1', true, at(0))]);
    const n = fold(stocked('O2', true, at(1)), s, NS);
    expect(n.stock).toEqual(s.stock);
    expect(n.lines.L1!.draws).toEqual(s.lines.L1!.draws);
    expect(n.lines.L1!.reserved_seq).toBe(s.lines.L1!.reserved_seq);
    expect(n.diagnostics.map((d) => d.kind)).toEqual(['invalid_event', 'stock_breach']);
  });

  it('[03a AD-29 Q5] an id free again after its order left the state is not reused: the check reads state.lines only', () => {
    const t = at(30) + ORDER_EXIT_AFTER_SERVED_MS;
    const s = fold([cfg(), ...servedOrder(), placed('O2', ['L1'], t)]);
    expect(s.orders.O1).toBeUndefined();
    expect(s.lines.L1!.order_id).toBe('O2');
  });

  it('[03a AD-29 Q5, #106] the minimal log of hostile seed 131: refused, and the upkeep equals the full recompute at every fold', () => {
    const LATE = at(-510);
    const sync = (id: string, station_id: string, cook_min: number) => ({ order_item_id: id, item: { station_id, cook_time_ms: cook_min * M, serve_mode: 'sync' }, line: { station_id } });
    const ids = ['L1', 'L2', 'L3', 'L4', 'L5'];
    const [placedO1, a1, a2, a3, a4, a5] = anOrderBatch({
      order_id: 'O1',
      recorded_at: at(0),
      seq: nextSeq(6),
      lines: [sync('L1', 'S1', 3), sync('L2', 'S1', 3), sync('L3', 'S2', 20), sync('L4', 'S2', 20), sync('L5', 'S2', 20)],
      order: { order_type: 'delivery', table_key: 'dine_in:T25', pickup_at_ms: LATE, groups: [{ group_id: 'O1:0', target_land_ms: LATE, promise_ms: LATE + 3 * M, order_item_ids: ids }] },
    }) as [PosEvent, PosEvent, PosEvent, PosEvent, PosEvent, PosEvent];
    const warned: PosEvent = { ...ev('SlipWarned', 'H', { table_key: 'dine_in:T25', order_ids: ['O1'], estimated_land_ms: at(10), alert_id: 'AL1' }, at(0)), stream_type: 'audit' };
    const again = anOrderBatch({
      order_id: 'O2',
      recorded_at: at(20),
      seq: nextSeq(3),
      lines: [sync('L1', 'S2', 20), sync('R1', 'S2', 20)],
      order: { table_id: 'T12', table_key: 'dine_in:T12', groups: [{ group_id: 'O2:0', target_land_ms: at(25), promise_ms: at(28), order_item_ids: ['L1', 'R1'] }] },
    });
    const log = [cfg(50), placedO1, a1, a2, a3, warned, a4, a5, again[0]!, again[1]!, start('O1', 'L2', at(21)), done('O1', 'L3', at(24)), done('O1', 'L4', at(24)), done('O1', 'L5', at(24)), removed('O2', 'L1', at(24))];
    let s = initialEngineState();
    for (const e of log) {
      s = applyEvent(deepFreeze(s), deepFreeze(e), { strict: false });
      expect(s.slip_due).toEqual(slipDueOf(s));
    }
    expect(s.lines.L1).toMatchObject({ order_id: 'O1', station_id: 'S1' });
    expect(s.orders.O2).toBeUndefined();
    expect(reasons(s)).toContain('order_item_id_reused');
    expect(() => fold(log)).toThrow(REUSED);
  });
});

// 03a v1.2 Q-6 (§4.2 ItemServed, test 128): source 'zone' (lines served from a zone, never engine lines) is a no-op; the
// optional served_at keeps a queued serve's real time: the served time is min(served_at, recorded_at), as ItemStarted.
describe('@pos/engine lifecycle: ItemServed source zone and served_at (03a v1.2 Q-6)', () => {
  // O1 / L1 (20 min, immediate) placed at 0, fired, started, done at 20, not served.
  const doneOrder = (): PosEvent[] => [...batch('O1', [{ id: 'L1' }], at(0)), fire(['L1'], at(0)), start('O1', 'L1', at(0)), done('O1', 'L1', at(20))];
  const serve = (ids: string[], t: number, payload: Record<string, unknown>): PosEvent => ev('ItemServed', 'O1', { order_item_ids: ids, source: 'tap', ...payload }, t);

  it("[03a #128] source 'zone' is a no-op", () => {
    const log = [cfg(), ...doneOrder()];
    const s = fold(log);
    // Even naming an engine line (a writer would not): the zone serve returns state itself, strict or not, no diagnostic.
    for (const ids of [['L1'], ['Z9'], ['L1', 'Z9']]) {
      const zone = serve(ids, at(25), { source: 'zone' });
      expect(Object.is(applyEvent(s, deepFreeze(zone)), s), ids.join()).toBe(true);
      const loose = applyEvent(s, deepFreeze(zone), { strict: false });
      expect(Object.is(loose, s), ids.join()).toBe(true);
      expect(loose.diagnostics).toEqual([]);
    }
    const zone = serve(['L1'], at(25), { source: 'zone', served_at: at(24) });
    expect(Object.is(applyEvent(s, deepFreeze(zone)), s)).toBe(true);
    expect(s.lines.L1!.stage).toBe('done');
    expect(s.orders.O1!.last_served_at).toBeNull();
    // Replay = live: the log with the zone serve folds as the log without it.
    expect(buildEngineState([...log, zone].map(deepFreeze))).toEqual(s);
    // A tap serve of the same line does serve it.
    expect(fold([serve(['L1'], at(25), {})], s).lines.L1!.stage).toBe('served');
  });

  it('[03a #128] served_at earlier → served_at; later → recorded_at', () => {
    const s = fold([cfg(), ...doneOrder()]);
    // Earlier (a serve queued offline at 26, appended at 30): the order's served time is 26, its fold clock 30.
    const early = fold([serve(['L1'], at(30), { served_at: at(26) })], s);
    expect(early.lines.L1!.stage).toBe('served');
    expect(early.orders.O1).toMatchObject({ last_served_at: at(26), last_line_fold_at: at(30) });
    expect(isOrderInEngine(early, 'O1', at(26) + ORDER_EXIT_AFTER_SERVED_MS - 1)).toBe(true);
    expect(isOrderInEngine(early, 'O1', at(26) + ORDER_EXIT_AFTER_SERVED_MS)).toBe(false);
    // Replay = live for the early-served_at log.
    const earlyLog = [cfg(), ...doneOrder(), serve(['L1'], at(30), { served_at: at(26) })].map(deepFreeze);
    const earlyLive = fold(earlyLog);
    expect(earlyLive.orders.O1).toMatchObject({ last_served_at: at(26), last_line_fold_at: at(30) });
    expect(buildEngineState(earlyLog)).toEqual(earlyLive);
    expect(applyEvents(initialEngineState(), earlyLog)).toEqual(earlyLive);
    // A serve queued past the whole exit window (served_at + ORDER_EXIT_AFTER_SERVED_MS ≤ recorded_at): the order is out
    // of the engine at its own serve, and the next listed event removes it, live and replay alike.
    const stale = at(30) + ORDER_EXIT_AFTER_SERVED_MS;
    const staleLog = [cfg(), ...doneOrder(), serve(['L1'], stale, { served_at: at(30) })].map(deepFreeze);
    const staleLive = fold(staleLog);
    expect(staleLive.orders.O1!.last_served_at).toBe(at(30));
    expect(isOrderInEngine(staleLive, 'O1', stale)).toBe(false);
    const next = deepFreeze(tickle(stale + 1));
    const removedLive = fold([next], staleLive);
    expect(removedLive.orders.O1).toBeUndefined();
    expect(removedLive.lines.L1).toBeUndefined();
    expect(buildEngineState([...staleLog, next])).toEqual(removedLive);
    expect(applyEvents(initialEngineState(), [...staleLog, next])).toEqual(removedLive);
    // Later than recorded_at (a device clock ahead): recorded_at.
    const late = fold([serve(['L1'], at(30), { served_at: at(35) })], s);
    expect(late.orders.O1).toMatchObject({ last_served_at: at(30), last_line_fold_at: at(30) });
    // Absent (a log written before v1.2): recorded_at.
    const absent = fold([serve(['L1'], at(30), {})], s);
    expect(absent.orders.O1).toMatchObject({ last_served_at: at(30), last_line_fold_at: at(30) });
    expect(late).toEqual(absent);
    // A serve that leaves a line open sets no served time, whatever served_at says.
    const two = fold([cfg(), ...batch('O1', [{ id: 'A' }, { id: 'B' }], at(0)), fire(['A'], at(0)), done('O1', 'A', at(20))]);
    const partly = fold([serve(['A'], at(30), { served_at: at(26) })], two);
    expect(partly.lines.A!.stage).toBe('served');
    expect(partly.orders.O1).toMatchObject({ last_served_at: null, last_line_fold_at: at(30) });
  });
});
