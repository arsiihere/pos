// 03a §3.3 "In-flight lines" (liveInterval, packing of fired-not-started lines, F-20), §3.4 stage folds,
// AD-6 (strict / non-strict profile underflow), AD-7 (removal of exactly `booked`).
import { parseEvent, type EngineConfig, type ItemAddedPayload, type PosEvent } from '@pos/events';
import { aFireDispatched, anEngineConfigApplied, anItemAdded, anItemDone, anItemStarted, anOrderBatch } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import {
  applyEvent,
  buildEngineState,
  calculateETA,
  initialEngineState,
  liveInterval,
  planOrder,
  type EngineState,
  type PlanResult,
  type ProposedOrder,
} from '../src/index';
import { liveProfile } from '../src/live';

const T0 = 1_761_000_000_000; // "12:00"
const M = 60_000;
const at = (min: number): number => T0 + min * M;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const S1 = (parseEvent(anEngineConfigApplied()).payload as unknown as EngineConfig).stations[0]!;

// One slot station S1 ("tawa") with the given capacity; padding 3 min (the config default, 180 000).
function kitchen(capacity: number): EngineState {
  const cfg = anEngineConfigApplied({ recorded_at: T0 - 3_600_000, payload: { stations: [{ ...S1, capacity }] } });
  return deepFreeze(applyEvent(initialEngineState(), deepFreeze(cfg)));
}

function fold(state: EngineState, events: PosEvent[], opts?: { strict?: boolean }): EngineState {
  let s = deepFreeze(state);
  for (const e of events) s = deepFreeze(applyEvent(s, deepFreeze(e), opts));
  return s;
}

type Item = { id: string; cook_min: number; prep_min?: number; mode?: 'sync' | 'immediate'; units?: number };

let seq = 100;
const nextSeq = (n: number): number => {
  const s = seq;
  seq += n + 1;
  return s;
};

// The §4.2 batch of an order of `items` on S1, appended at `recorded_at` (groups from `plan` when given).
function batch(order_id: string, items: Item[], recorded_at: number, plan?: PlanResult): PosEvent[] {
  return anOrderBatch({
    order_id,
    recorded_at,
    seq: nextSeq(items.length),
    lines: items.map((i) => ({
      order_item_id: i.id,
      item: {
        cook_time_ms: i.cook_min * M,
        prep_buffer_ms: (i.prep_min ?? 0) * M,
        serve_mode: i.mode ?? 'immediate',
        quantity: i.units ?? 1,
      },
    })),
    order: plan === undefined ? {} : { groups: plan.groups },
  });
}

function proposed(order_id: string, items: Item[]): ProposedOrder {
  const base = anItemAdded().payload as unknown as ItemAddedPayload;
  return deepFreeze({
    order_id,
    order: { order_type: 'dine_in', table_id: 'T12', table_key: 'dine_in:T12', follow_up: false, pickup_at_ms: null },
    lines: items.map((i) => ({
      ...base,
      order_id,
      order_item_id: i.id,
      cook_time_ms: i.cook_min * M,
      prep_buffer_ms: (i.prep_min ?? 0) * M,
      serve_mode: i.mode ?? 'immediate',
      quantity: i.units ?? 1,
      alternates: [],
      point_id: null,
      carry_ms: 0,
      weight_pct: 100,
      max_early_ms: 60_000,
      max_late_ms: null,
      max_carry_ms: null,
      cook_ms_override: null,
      return_of: null,
    })),
  });
}

function fire(ids: string[], recorded_at: number, load_id: string | null = null, reason = 'scheduled', due_at = recorded_at): PosEvent {
  return aFireDispatched({ recorded_at, occurred_at: recorded_at, seq: nextSeq(0), payload: { order_item_ids: ids, due_at, load_id, reason } });
}
function start(order_id: string, id: string, recorded_at: number, started_at = recorded_at): PosEvent {
  return anItemStarted({ stream_id: order_id, recorded_at, occurred_at: recorded_at, seq: nextSeq(0), payload: { order_item_id: id, started_at } });
}
function done(order_id: string, id: string, recorded_at: number, done_at = recorded_at): PosEvent {
  return anItemDone({ stream_id: order_id, recorded_at, occurred_at: recorded_at, seq: nextSeq(0), payload: { order_item_id: id, done_at } });
}
function orderEvent(event_type: string, order_id: string, payload: Record<string, unknown>, recorded_at: number): PosEvent {
  const s = nextSeq(0);
  return { ...anItemStarted(), event_type, stream_id: order_id, payload, recorded_at, occurred_at: recorded_at, seq: s, event_id: `01JZ${String(s).padStart(22, '0')}` };
}

// Plans `items` as a new order at `now` with planOrder and calculateETA, folds the batch 02 would append at
// recorded_at = now, and checks the three agree (§3.3: every placement path reads the same live intervals).
function submit(state: EngineState, order_id: string, items: Item[], now: number): { plan: PlanResult; state: EngineState } {
  const p = proposed(order_id, items);
  const plan = planOrder(state, p, now, {});
  expect(calculateETA(state, p, now)).toEqual(plan);
  const s = fold(state, batch(order_id, items, now, plan));
  for (const l of plan.lines) expect(s.lines[l.order_item_id]!.booked!.end + l.carry_ms).toBe(l.eta_ms);
  return { plan, state: s };
}

const iv = (a: number, b: number) => ({ start: a, end: b });
const booked = (s: EngineState, id: string) => {
  const b = s.lines[id]!.booked!;
  return iv(b.start, b.end);
};
function maxUnits(s: EngineState, t: number, from = t): number {
  const p = liveProfile(s, 'S1', t);
  let m = 0;
  for (let i = 0; i < p.t.length; i++) if ((i + 1 === p.t.length ? Infinity : p.t[i + 1]!) > from) m = Math.max(m, p.u[i]!);
  return m;
}

describe('@pos/engine stage folds (§3.4; stage only, stock in task 12)', () => {
  it('[03a §3.4] FireDispatched sets fired_at and load_id, removes exactly booked from the profile and the line from unfired', () => {
    const s0 = fold(kitchen(1), [...batch('O1', [{ id: 'L1', cook_min: 5 }, { id: 'L2', cook_min: 5 }], at(0))]);
    expect(s0.stations.S1!.unfired).toEqual(['L1', 'L2']);
    expect(s0.stations.S1!.profile).toEqual({ t: [at(0), at(10)], u: [1, 0] });

    const s1 = fold(s0, [fire(['L1', 'NOPE'], at(0), 'S1:L1')]);
    expect(s1.lines.L1).toEqual({ ...s0.lines.L1, fired_at: at(0), load_id: 'S1:L1', booked: null, rounds: 1 });
    expect(s1.stations.S1!.unfired).toEqual(['L2']);
    // Only L2's planned booking stays in the profile (AD-7: exactly L1's booked removed).
    expect(s1.stations.S1!.profile).toEqual({ t: [at(5), at(10)], u: [1, 0] });
    expect(s1.lines.L2).toBe(s0.lines.L2);
    expect(s1.diagnostics).toEqual([]);

    // Fired never fires twice (§3.4): a second FireDispatched leaves the line as it was.
    const s2 = fold(s1, [fire(['L1'], at(3), 'other')]);
    expect(s2).toBe(s1);
    // A FireDispatched naming no line in the state is a no-op returning state itself (§3.3 absent ids).
    expect(applyEvent(s1, fire(['NOPE'], at(3)))).toBe(s1);
  });

  it('[03a AD-9] a pulled line packs from its actual fire, not its later planned fire; a scheduled or missed fire keeps fire_ms; live = replay', () => {
    const cfg = anEngineConfigApplied({ recorded_at: T0 - 3_600_000, payload: { stations: [{ ...S1, capacity: 1 }] } });
    const placed = batch('O1', [{ id: 'L1', cook_min: 5 }, { id: 'L2', cook_min: 5 }], at(0));
    const pull = fire(['L2'], at(1), null, 'pulled', at(5));
    const s0 = fold(initialEngineState(), [cfg, ...placed]);
    expect(s0.lines.L2!.fire_ms).toBe(at(5));
    const s1 = fold(s0, [pull]);
    // fire_ms = min(fire_ms, recorded_at); the planned fire stays in the event's due_at.
    expect(s1.lines.L2).toMatchObject({ fire_ms: at(1), fired_at: at(1) });
    expect(liveInterval(s1, 'L2', at(1))).toEqual(iv(at(1), at(6)));
    expect(liveInterval(s1, 'L2', at(2))).toEqual(iv(at(2), at(7)));
    // Live = replay.
    expect(buildEngineState([cfg, ...placed, pull].map(deepFreeze))).toEqual(s1);

    // A missed scheduled fire (recorded after the planned fire) keeps fire_ms.
    const missed = fold(s0, [fire(['L2'], at(7), null, 'scheduled', at(5))]);
    expect(missed.lines.L2).toMatchObject({ fire_ms: at(5), fired_at: at(7) });
    const onTime = fold(s0, [fire(['L1'], at(0))]);
    expect(onTime.lines.L1).toMatchObject({ fire_ms: at(0), fired_at: at(0) });
  });

  it('[03a §3.4] ItemStarted → COOKING with started = min(started_at, recorded_at); an unfired line leaves the profile', () => {
    const s0 = fold(kitchen(1), [...batch('O1', [{ id: 'L1', cook_min: 5 }, { id: 'L2', cook_min: 5 }], at(0)), fire(['L1'], at(0))]);
    // started_at after recorded_at → recorded_at; before → started_at (§4.2).
    const late = fold(s0, [start('O1', 'L1', at(1), at(2))]);
    expect(late.lines.L1!.stage).toBe('cooking');
    expect(late.lines.L1!.started_at).toBe(at(1));
    const early = fold(s0, [start('O1', 'L1', at(1), at(0) + 30_000)]);
    expect(early.lines.L1!.started_at).toBe(at(0) + 30_000);
    expect(liveInterval(early, 'L1', at(1))).toEqual(iv(at(0) + 30_000, at(5) + 30_000));

    // A Start on a line that was never fired takes its planned booking off the profile and out of unfired.
    const s1 = fold(late, [start('O1', 'L2', at(2))]);
    expect(s1.lines.L2).toMatchObject({ stage: 'cooking', started_at: at(2), booked: null, fired_at: null });
    expect(s1.stations.S1!.unfired).toEqual([]);
    expect(s1.stations.S1!.profile).toEqual({ t: [], u: [] });
    // A second Start changes nothing.
    expect(applyEvent(s1, start('O1', 'L2', at(3)))).toBe(s1);
  });

  it('[03a §3.4] ItemDone → done with done_at = min(done_at, recorded_at); a done line occupies nothing', () => {
    const s0 = fold(kitchen(1), [...batch('O1', [{ id: 'L1', cook_min: 5 }], at(0)), fire(['L1'], at(0)), start('O1', 'L1', at(0))]);
    const s1 = fold(s0, [done('O1', 'L1', at(4), at(5))]);
    expect(s1.lines.L1).toMatchObject({ stage: 'done', done_at: at(4), started_at: at(0) });
    expect(liveInterval(s1, 'L1', at(4))).toBeNull();
    expect(fold(s0, [done('O1', 'L1', at(4), at(3))]).lines.L1!.done_at).toBe(at(3));
  });

  it('[03a §3.4] ItemServed marks every listed line served; ItemRemoved / ItemVoided (whole line) leave the profile', () => {
    const s0 = fold(kitchen(2), [
      ...batch('O1', [{ id: 'L1', cook_min: 5 }, { id: 'L2', cook_min: 5 }, { id: 'L3', cook_min: 5 }, { id: 'L4', cook_min: 5, units: 2 }], at(0)),
      fire(['L1'], at(0)),
      start('O1', 'L1', at(0)),
      done('O1', 'L1', at(5)),
    ]);
    const served = fold(s0, [orderEvent('ItemServed', 'O1', { order_item_ids: ['L1', 'NOPE'], source: 'tap' }, at(6))]);
    expect(served.lines.L1!.stage).toBe('served');
    expect(liveInterval(served, 'L1', at(6))).toBeNull();

    const removed = fold(served, [orderEvent('ItemRemoved', 'O1', { order_item_id: 'L2' }, at(6))]);
    expect(removed.lines.L2).toMatchObject({ stage: 'removed', booked: null });
    expect(removed.stations.S1!.unfired).toEqual(['L3', 'L4']);
    const voided = fold(removed, [orderEvent('ItemVoided', 'O1', { order_item_id: 'L3', units: 1 }, at(6))]);
    expect(voided.lines.L3).toMatchObject({ stage: 'voided', booked: null });
    expect(voided.stations.S1!.unfired).toEqual(['L4']);
    // Only L4's booking is left in the profile (exactly what each removal booked, AD-7).
    expect(voided.stations.S1!.profile).toEqual({ t: [voided.lines.L4!.booked!.start, voided.lines.L4!.booked!.end], u: [2, 0] });
    // A partial void (BF-12: units and draws are task 12's) does not end the line.
    const partial = fold(voided, [orderEvent('ItemVoided', 'O1', { order_item_id: 'L4', units: 1 }, at(6))]);
    expect(partial.lines.L4!.stage).toBe('added');
    // A served line is not removed or voided afterwards.
    expect(applyEvent(voided, orderEvent('ItemVoided', 'O1', { order_item_id: 'L1', units: 1 }, at(7)))).toBe(voided);
  });

  it('[03a §3.3 absent ids] a stage event for a line not in the state, or still a placeholder (AD-8), returns state itself', () => {
    const s0 = fold(kitchen(1), [...batch('O1', [{ id: 'L1', cook_min: 5 }], at(0))]);
    for (const e of [
      start('O1', 'NOPE', at(1)),
      done('O1', 'NOPE', at(1)),
      orderEvent('ItemDoneUndone', 'O1', { order_item_id: 'NOPE' }, at(1)),
      orderEvent('ItemServed', 'O1', { order_item_ids: ['NOPE'], source: 'tap' }, at(1)),
      orderEvent('ItemRemoved', 'O1', { order_item_id: 'NOPE' }, at(1)),
      orderEvent('ItemVoided', 'O1', { order_item_id: 'NOPE', units: 1 }, at(1)),
      fire(['NOPE'], at(1)),
    ]) {
      expect(applyEvent(s0, deepFreeze(e))).toBe(s0);
    }
    // A placeholder (its ItemAdded not seen yet) is not a line: a Start for it changes nothing.
    const [placed] = batch('O2', [{ id: 'P1', cook_min: 5 }], at(0));
    const pending = fold(s0, [placed!]);
    expect(applyEvent(pending, deepFreeze(start('O2', 'P1', at(1))))).toBe(pending);
    expect(applyEvent(pending, deepFreeze(fire(['P1'], at(1))))).toBe(pending);
  });

  it('[03a AD-6] a removal that underflows the profile throws when strict and records profile_underflow when not', () => {
    const s0 = fold(kitchen(1), [...batch('O1', [{ id: 'L1', cook_min: 5 }], at(0))]);
    // Forced: the profile lost L1's booking (a corrupt snapshot), so removing exactly booked underflows.
    const broken = deepFreeze({ ...s0, stations: { ...s0.stations, S1: { ...s0.stations.S1!, profile: { t: [], u: [] } } } });
    const e = deepFreeze(fire(['L1'], at(0)));
    expect(() => applyEvent(broken, e)).toThrow(RangeError);
    expect(() => applyEvent(broken, e, {})).toThrow(RangeError);

    const s1 = applyEvent(broken, e, { strict: false });
    expect(s1.diagnostics).toEqual([
      { kind: 'profile_underflow', event_id: e.event_id, station_id: 'S1', detail: { order_item_id: 'L1', at: at(0), deficit: 1 } },
    ]);
    // Otherwise consistent: the line is fired, booked cleared, out of unfired, the profile canonical (clamped at 0).
    expect(s1.lines.L1).toMatchObject({ fired_at: at(0), booked: null });
    expect(s1.stations.S1!.unfired).toEqual([]);
    expect(s1.stations.S1!.profile).toEqual({ t: [], u: [] });
  });

  it('[03a #51] ItemDoneUndone returns the line to COOKING and its occupancy (D16)', () => {
    const s0 = fold(kitchen(1), [...batch('O1', [{ id: 'A', cook_min: 5 }], at(0)), fire(['A'], at(0)), start('O1', 'A', at(0)), done('O1', 'A', at(2))]);
    expect(liveInterval(s0, 'A', at(2))).toBeNull();
    // While done, a new line is placed at once.
    expect(planOrder(s0, proposed('O2', [{ id: 'B', cook_min: 5 }]), at(2), {}).lines[0]!.eta_ms).toBe(at(7));

    const s1 = fold(s0, [orderEvent('ItemDoneUndone', 'O1', { order_item_id: 'A' }, at(2) + 20_000)]);
    expect(s1.lines.A).toMatchObject({ stage: 'cooking', started_at: at(0), done_at: null });
    expect(liveInterval(s1, 'A', at(3))).toEqual(iv(at(0), at(5)));
    // Its occupancy is back: B waits for A's live end.
    const { plan, state: s2 } = submit(s1, 'O2', [{ id: 'B', cook_min: 5 }], at(3));
    expect(plan.lines[0]!.eta_ms).toBe(at(10));
    expect(booked(s2, 'B')).toEqual(iv(at(5), at(10)));
    // Undo on a line that is not done changes nothing.
    expect(applyEvent(s1, orderEvent('ItemDoneUndone', 'O1', { order_item_id: 'A' }, at(3)))).toBe(s1);
  });

  it('[03a §3.3] liveInterval: an unfired line → its booked interval; COOKING overrun → [started + prep, t); absent → null', () => {
    const s0 = fold(kitchen(1), [...batch('O1', [{ id: 'A', cook_min: 5, prep_min: 1 }, { id: 'B', cook_min: 5 }], at(0))]);
    expect(liveInterval(s0, 'B', at(0))).toEqual(booked(s0, 'B'));
    expect(liveInterval(s0, 'NOPE', at(0))).toBeNull();
    const s1 = fold(s0, [fire(['A'], at(0)), start('O1', 'A', at(0))]);
    expect(liveInterval(s1, 'A', at(3))).toEqual(iv(at(1), at(6)));
    expect(liveInterval(s1, 'A', at(9))).toEqual(iv(at(1), at(9)));
  });
});

describe('@pos/engine liveInterval: fired-not-started lines packed per station (§3.3, F-20)', () => {
  it('[03a #96] one fired line, capacity 1, prep 0: B waits for A\'s sliding interval; a late Start moves B by at most the delay', () => {
    const s0 = fold(kitchen(1), [...batch('O1', [{ id: 'A', cook_min: 5 }], at(0)), fire(['A'], at(0))]);
    expect(liveInterval(s0, 'A', at(6))).toEqual(iv(at(6), at(11)));
    const { plan, state: s1 } = submit(s0, 'O2', [{ id: 'B', cook_min: 5, mode: 'sync' }], at(6));
    expect(booked(s1, 'B')).toEqual(iv(at(11), at(16)));
    expect(plan.groups[0]).toMatchObject({ target_land_ms: at(16), promise_ms: at(19) });
    expect(plan.groups[0]!.promise_ms).toBeGreaterThanOrEqual(at(11) + 5 * M);
    expect(maxUnits(s1, at(6))).toBe(1);

    // A starts at 12:08 → [12:08, 12:13); B (shifted by lateStartShift, task 16b) needs at most [12:13, 12:18) ≤ P.
    const s2 = fold(s1, [start('O1', 'A', at(8))]);
    expect(liveInterval(s2, 'A', at(8))).toEqual(iv(at(8), at(13)));
    const shift = liveInterval(s2, 'A', at(8))!.end - s1.lines.B!.booked!.start;
    expect(shift).toBe(2 * M);
    expect(s1.lines.B!.booked!.end + shift).toBeLessThanOrEqual(plan.groups[0]!.promise_ms);
  });

  it('[03a #96] prep > 0 variant: A (prep 4) occupies nothing before 12:06 + prep; an on-time Start moves nothing', () => {
    const s0 = fold(kitchen(1), [...batch('O1', [{ id: 'A', cook_min: 5, prep_min: 4 }], at(0)), fire(['A'], at(0))]);
    // Packed Start 12:06 → [12:10, 12:15): nothing before t + prep.
    expect(liveInterval(s0, 'A', at(6))).toEqual(iv(at(10), at(15)));
    const { plan, state: s1 } = submit(s0, 'O2', [{ id: 'B', cook_min: 5, mode: 'sync' }], at(6));
    expect(booked(s1, 'B')).toEqual(iv(at(15), at(20)));
    expect(plan.groups[0]).toMatchObject({ target_land_ms: at(20), promise_ms: at(23) });

    const onTime = fold(s1, [start('O1', 'A', at(6))]);
    expect(liveInterval(onTime, 'A', at(6))).toEqual(iv(at(10), at(15)));
    expect(liveInterval(onTime, 'A', at(6))!.end).toBeLessThanOrEqual(s1.lines.B!.booked!.start); // B does not move
    const late = fold(s1, [start('O1', 'A', at(8))]);
    expect(liveInterval(late, 'A', at(8))).toEqual(iv(at(12), at(17)));
    // B moves to [12:17, 12:22) and its promise holds.
    expect(liveInterval(late, 'A', at(8))!.end - s1.lines.B!.booked!.start).toBe(2 * M);
    expect(at(22)).toBeLessThanOrEqual(plan.groups[0]!.promise_ms);
  });

  it('[03a #115] two fired lines, capacity 1: packed one after the other; N after both; a Start passes the delay down the queue', () => {
    const s0 = fold(kitchen(1), [
      ...batch('O1', [{ id: 'A', cook_min: 5 }], at(0)),
      fire(['A'], at(0)),
      ...batch('O2', [{ id: 'B', cook_min: 5 }], at(0)),
    ]);
    expect(booked(s0, 'B')).toEqual(iv(at(5), at(10))); // planned behind A
    const s1 = fold(s0, [fire(['B'], at(5))]);
    expect(liveInterval(s1, 'A', at(6))).toEqual(iv(at(6), at(11)));
    expect(liveInterval(s1, 'B', at(6))).toEqual(iv(at(11), at(16))); // B's estimate 12:16

    const { plan, state: s2 } = submit(s1, 'O3', [{ id: 'N', cook_min: 5 }], at(6));
    expect(booked(s2, 'N')).toEqual(iv(at(16), at(21)));
    expect(plan.groups[0]).toMatchObject({ target_land_ms: at(21), promise_ms: at(24) });
    expect(maxUnits(s2, at(6))).toBe(1);

    // A is started at 12:07 → B packed to [12:12, 12:17); N (cascade, task 16b) to [12:17, 12:22) ≤ P.
    const s3 = fold(s2, [start('O1', 'A', at(7))]);
    expect(liveInterval(s3, 'A', at(7))).toEqual(iv(at(7), at(12)));
    expect(liveInterval(s3, 'B', at(7))).toEqual(iv(at(12), at(17)));
    expect(liveInterval(s3, 'B', at(7))!.end - s2.lines.N!.booked!.start).toBe(M);
    expect(at(22)).toBeLessThanOrEqual(plan.groups[0]!.promise_ms);
  });

  it('[03a #115] prep > 0 case: a Start made on time never breaks a later order\'s promise', () => {
    const s0 = fold(kitchen(1), [...batch('O1', [{ id: 'A', cook_min: 5, prep_min: 4 }], at(0)), fire(['A'], at(0))]);
    expect(s0.lines.A!.fire_ms).toBe(at(0)); // planned cook [12:04, 12:09)
    expect(liveInterval(s0, 'A', at(6))).toEqual(iv(at(10), at(15))); // A's estimate 12:15
    const { plan, state: s1 } = submit(s0, 'O2', [{ id: 'N', cook_min: 5 }], at(6));
    expect(booked(s1, 'N')).toEqual(iv(at(15), at(20)));
    expect(plan.groups[0]).toMatchObject({ target_land_ms: at(20), promise_ms: at(23) });
    // Regression: the v0.6.2 bound would have placed N on [12:11, 12:16) with P 12:19.
    expect(booked(s1, 'N')).not.toEqual(iv(at(11), at(16)));

    const onTime = fold(s1, [start('O1', 'A', at(6))]);
    expect(liveInterval(onTime, 'A', at(6))).toEqual(iv(at(10), at(15)));
    expect(maxUnits(onTime, at(6))).toBe(1); // N does not move
    const late = fold(s1, [start('O1', 'A', at(7))]);
    expect(liveInterval(late, 'A', at(7))).toEqual(iv(at(11), at(16)));
    // N moves by 1 min to [12:16, 12:21) ≤ P.
    expect(liveInterval(late, 'A', at(7))!.end - s1.lines.N!.booked!.start).toBe(M);
    expect(at(21)).toBeLessThanOrEqual(plan.groups[0]!.promise_ms);
  });

  const four = (prep_min = 0): Item[] => ['A', 'C', 'E', 'G'].map((id) => ({ id, cook_min: 5, prep_min }));

  it('[03a #116] four fired lines, capacity 2: A, C on [t, t + 5), E, G on [t + 5, t + 10); a new line at [t + 10, t + 15)', () => {
    const t = at(20);
    const s0 = fold(kitchen(2), [...batch('O1', four(), at(0)), fire(['A', 'C', 'E', 'G'], t)]);
    expect(['A', 'C', 'E', 'G'].map((id) => s0.lines[id]!.fire_ms)).toEqual([at(0), at(0), at(5), at(5)]);
    expect(['A', 'C', 'E', 'G'].map((id) => liveInterval(s0, id, t))).toEqual([
      iv(t, t + 5 * M), iv(t, t + 5 * M), iv(t + 5 * M, t + 10 * M), iv(t + 5 * M, t + 10 * M),
    ]);
    const { state: s1 } = submit(s0, 'O2', [{ id: 'N', cook_min: 5 }], t);
    expect(booked(s1, 'N')).toEqual(iv(t + 10 * M, t + 15 * M));
    expect(maxUnits(s1, t)).toBe(2);
  });

  it('[03a #116] with one COOKING line on [t − 2, t + 3): A, C, E, G packed beside it', () => {
    const t = at(20);
    const s0 = fold(kitchen(2), [
      ...batch('O0', [{ id: 'X', cook_min: 5 }], at(-30)),
      ...batch('O1', four(), at(0)),
      fire(['X'], t - 2 * M),
      start('O0', 'X', t - 2 * M),
      fire(['A', 'C', 'E', 'G'], t),
    ]);
    expect(liveInterval(s0, 'X', t)).toEqual(iv(t - 2 * M, t + 3 * M));
    expect(['A', 'C', 'E', 'G'].map((id) => liveInterval(s0, id, t))).toEqual([
      iv(t, t + 5 * M), iv(t + 3 * M, t + 8 * M), iv(t + 5 * M, t + 10 * M), iv(t + 8 * M, t + 13 * M),
    ]);
    const { state: s1 } = submit(s0, 'O2', [{ id: 'N', cook_min: 5 }], t);
    expect(booked(s1, 'N')).toEqual(iv(t + 10 * M, t + 15 * M));
    expect(maxUnits(s1, t)).toBe(2);
  });

  it('[03a #116] outage: 20 missed fires dispatched at once pack two by two, never above capacity', () => {
    const t = at(60);
    const ids = Array.from({ length: 20 }, (_, i) => `L${String(i).padStart(2, '0')}`);
    const s0 = fold(kitchen(2), [...batch('O1', ids.map((id) => ({ id, cook_min: 5 })), at(0)), fire(ids, t)]);
    expect(s0.stations.S1!.unfired).toEqual([]);
    expect(s0.stations.S1!.profile).toEqual({ t: [], u: [] });
    ids.forEach((id, i) => {
      const k = Math.floor(i / 2);
      expect(liveInterval(s0, id, t)).toEqual(iv(t + 5 * k * M, t + 5 * (k + 1) * M));
    });
    expect(maxUnits(s0, t)).toBe(2);
    const { state: s1 } = submit(s0, 'O2', [{ id: 'N', cook_min: 5 }], t);
    expect(booked(s1, 'N')).toEqual(iv(t + 50 * M, t + 55 * M));
    // The packing slides with t: 7 min later every line starts no earlier than t + 7.
    expect(liveInterval(s0, ids[0]!, t + 7 * M)).toEqual(iv(t + 7 * M, t + 12 * M));
  });

  it('[03a #116] prep > 0 variant: Starts t for A, C on [t + 2, t + 7) and t + 5 for E, G on [t + 7, t + 12)', () => {
    const t = at(20);
    const s0 = fold(kitchen(2), [...batch('O1', four(2), at(0)), fire(['A', 'C', 'E', 'G'], t)]);
    expect(['A', 'C', 'E', 'G'].map((id) => liveInterval(s0, id, t))).toEqual([
      iv(t + 2 * M, t + 7 * M), iv(t + 2 * M, t + 7 * M), iv(t + 7 * M, t + 12 * M), iv(t + 7 * M, t + 12 * M),
    ]);
    const { state: s1 } = submit(s0, 'O2', [{ id: 'N', cook_min: 5 }], t);
    expect(booked(s1, 'N')).toEqual(iv(t + 12 * M, t + 17 * M));
    expect(maxUnits(s1, t)).toBe(2);
  });

  it('[03a §3.3] the fold places against the live intervals but stores only planned bookings in the profile', () => {
    const s0 = fold(kitchen(1), [...batch('O1', [{ id: 'A', cook_min: 5 }], at(0)), fire(['A'], at(0))]);
    const { state: s1 } = submit(s0, 'O2', [{ id: 'B', cook_min: 5 }], at(6));
    expect(s1.stations.S1!.profile).toEqual({ t: [at(11), at(16)], u: [1, 0] });
    expect(s1.stations.S1!.unfired).toEqual(['B']);
    expect(s1.lines.A!.booked).toBeNull();
  });
});
