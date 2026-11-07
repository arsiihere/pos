// 03a §3.8 slip estimate (carry, packed Start), trigger from the target, one per table key, re-raise rule, `slip_due` per
// key (touched keys only, one slipCrossing for getAlertIntents and next_alert_due_at), §6.1g getAlertIntents shape,
// §3.10 overload items (pressure, waiting, capped); BF-3, BF-4, BF-10, BF-14; tests 35, 36, 92, 106, the slip half of
// 91. Pure: every input is deep-frozen.
import { parseEvent, type EngineConfig, type ItemAddedPayload, type PosEvent } from '@pos/events';
import {
  aBusinessDayClosed,
  aBusinessDayOpened,
  aFireDispatched,
  anAlertClosed,
  anEngineConfigApplied,
  anItemAdded,
  anItemDone,
  anItemStarted,
  anOrderBatch,
  aStockSet,
} from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import {
  applyEvent,
  buildEngineState,
  getAlertIntents,
  getTickIntents,
  initialEngineState,
  liveInterval,
  nextAlertDueAt,
  planOrder,
  stationPressure,
  type AlertIntents,
  type EngineState,
  type PlanResult,
  type ProposedOrder,
  type TickDraft,
} from '../src/index';
import { slipDueOf, slipGroupsAt } from '../src/slip';

const T0 = 1_761_000_000_000; // "12:00"
const S = 1_000;
const M = 60_000;
const at = (min: number): number => T0 + min * M;
const TH = 120_000; // slip_threshold_ms default
const PAD = 180_000; // promise padding default

function deepFreeze<V>(value: V): V {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const BASE = parseEvent(anEngineConfigApplied()).payload as unknown as EngineConfig;
type StationCfg = EngineConfig['stations'][number];
type Settings = EngineConfig['settings'];

let seq = 10;
const nextSeq = (n = 0): number => {
  const s = seq;
  seq += n + 1;
  return s;
};
const stamp = (e: PosEvent, t: number): PosEvent => {
  const s = nextSeq();
  return { ...e, recorded_at: t, occurred_at: t, seq: s, event_id: `01X${String(s).padStart(23, '0')}` };
};

function configEvent(stations: Array<Partial<StationCfg> & { station_id: string }>, settings: Partial<Settings> = {}, t = T0 - 3_600_000): PosEvent {
  const list = [...stations].sort((a, b) => (a.station_id < b.station_id ? -1 : 1)).map((s) => ({ ...BASE.stations[0]!, name: s.station_id, ...s }));
  return stamp(anEngineConfigApplied({ payload: { stations: list, settings: { ...BASE.settings, ...settings } } }), t);
}

// Every fold of a test goes through here: deep-frozen input, and after each fold the stored slip_due equals the full
// recompute (test 106) and next_alert_due_at is its minimum.
function fold(state: EngineState, events: PosEvent[], log?: PosEvent[]): EngineState {
  let s = deepFreeze(state);
  for (const e of events) {
    s = deepFreeze(applyEvent(s, deepFreeze(e)));
    log?.push(e);
    checkUpkeep(s);
  }
  return s;
}

function checkUpkeep(s: EngineState): void {
  expect(s.slip_due).toEqual(slipDueOf(s));
  const vals = Object.values(s.slip_due);
  expect(s.next_alert_due_at).toBe(vals.length === 0 ? null : Math.min(...vals));
}

function kitchen(stations: Array<Partial<StationCfg> & { station_id: string }>, settings: Partial<Settings> = {}, log?: PosEvent[]): EngineState {
  return fold(initialEngineState(), [configEvent(stations, settings)], log);
}

type Item = { id: string; station?: string; cook: number; prep?: number; mode?: 'sync' | 'immediate'; units?: number; carry?: number; early?: number };
type OrderOpts = { key?: string; order_type?: 'dine_in' | 'takeaway' | 'delivery' | 'parking'; actor?: string | null };

function itemFields(i: Item): Record<string, unknown> {
  return {
    station_id: i.station ?? 'S1',
    cook_time_ms: i.cook,
    prep_buffer_ms: i.prep ?? 0,
    serve_mode: i.mode ?? 'sync',
    quantity: i.units ?? 1,
  };
}

function proposed(order_id: string, items: Item[], o: OrderOpts = {}): ProposedOrder {
  const base = anItemAdded().payload as unknown as ItemAddedPayload;
  return deepFreeze({
    order_id,
    order: { order_type: o.order_type ?? 'dine_in', table_id: 'T12', table_key: o.key ?? 'dine_in:T12', follow_up: false, pickup_at_ms: null },
    lines: items.map((i) => ({
      ...base,
      ...(itemFields(i) as Partial<ItemAddedPayload>),
      order_id,
      order_item_id: i.id,
      alternates: [],
      point_id: null,
      carry_ms: i.carry ?? 0,
      weight_pct: 100,
      max_early_ms: i.early ?? 60_000,
      max_late_ms: null,
      max_carry_ms: null,
      cook_ms_override: null,
      return_of: null,
    })),
  });
}

// planOrder at now, then the §4.2 batch folded at recorded_at (default now).
function submit(state: EngineState, order_id: string, items: Item[], now: number, o: OrderOpts = {}, recorded_at = now, log?: PosEvent[]): { plan: PlanResult; state: EngineState } {
  const plan = planOrder(state, proposed(order_id, items, o), now, {});
  const first = nextSeq(items.length + 1);
  const events = anOrderBatch({
    order_id,
    recorded_at,
    seq: first,
    actor_id: o.actor ?? null,
    lines: items.map((i) => ({
      order_item_id: i.id,
      item: itemFields(i),
      line: { station_id: plan.lines.find((l) => l.order_item_id === i.id)!.station_id, carry_ms: i.carry ?? 0, max_early_ms: i.early ?? 60_000 },
    })),
    order: { groups: plan.groups, order_type: o.order_type ?? 'dine_in', table_key: o.key ?? 'dine_in:T12', pickup_at_ms: null },
  }).map((e, k) => ({ ...e, event_id: `01S${String(first + k).padStart(23, '0')}` }));
  return { plan, state: fold(state, events, log) };
}

const fireEv = (station_id: string, ids: string[], t: number): PosEvent =>
  stamp(aFireDispatched({ stream_id: station_id, payload: { station_id, order_item_ids: ids, load_id: null, due_at: t, reason: 'scheduled' } }), t);
const startEv = (order_id: string, id: string, t: number): PosEvent => stamp(anItemStarted({ stream_id: order_id, payload: { order_item_id: id, started_at: t, source: 'tap' } }), t);
const doneEv = (order_id: string, id: string, t: number): PosEvent => stamp(anItemDone({ stream_id: order_id, payload: { order_item_id: id, done_at: t, source: 'tap' } }), t);
const undoEv = (order_id: string, id: string, t: number): PosEvent =>
  stamp({ ...anItemDone(), event_type: 'ItemDoneUndone', stream_id: order_id, payload: { order_item_id: id } }, t);
// fires_alerts (task 22a) builds SlipWarned from a slip item and the alert_id raiseMany returned (§3.8).
function slipWarnedEv(item: AlertIntents['slips'][number], alert_id: string, t: number): PosEvent {
  return stamp(
    {
      ...anItemStarted(),
      event_type: 'SlipWarned',
      stream_id: item.order_ids[0]!,
      payload: {
        table_key: item.table_key,
        order_ids: item.order_ids,
        alert_id,
        estimated_land_ms: item.estimate,
        target_land_ms: item.target,
        promise_ms: item.promise,
      },
    },
    t,
  );
}
const alertClosedEv = (alert_id: string, t: number): PosEvent => stamp(anAlertClosed({ payload: { alert_id, reason: 'done', by_staff_id: null, note: null } }), t);

const T = (s: EngineState, order_id: string): number => s.orders[order_id]!.groups[`${order_id}:0`]!.target_land_ms;

// The order's sync group lands at T: one line on a capacity-1 station, cook 10 min, fired at its planned fire.
function lateLine(o: { policy?: StationCfg['policy']; carry?: number; prep?: number; settings?: Partial<Settings> } = {}): { s: EngineState; f: number } {
  let s = kitchen([{ station_id: 'S1', capacity: 1, policy: o.policy ?? 'waada_guard' }], o.settings);
  ({ state: s } = submit(s, 'O1', [{ id: 'A', cook: 10 * M, carry: o.carry ?? 0, prep: o.prep ?? 0 }], at(0)));
  const f = s.lines.A!.fire_ms!;
  s = fold(s, [fireEv('S1', ['A'], f)]);
  return { s, f };
}

describe('03a §3.8 slip estimate and crossing', () => {
  it('[03a #35] the slip threshold is measured from the target, not the promise', () => {
    const { s, f } = lateLine();
    const target = T(s, 'O1');
    expect(target).toBe(f + 10 * M); // fired on schedule: planned land = T
    expect(s.orders.O1!.promise_ms).toBe(target + PAD);
    // A fired, never started: its estimate is s + prep + cook with s = max(fire, t) (packed Start, nothing ahead), so
    // it exceeds T + threshold at the first t > f + threshold (never P + threshold = f + 15 min).
    const c = f + TH + 1;
    expect(s.slip_due).toEqual({ 'dine_in:T12': c });
    expect(s.next_alert_due_at).toBe(c);
    expect(getAlertIntents(s, c - 1).slips).toEqual([]);
    expect(getAlertIntents(s, c).slips).toEqual([{ table_key: 'dine_in:T12', order_ids: ['O1'], estimate: target + TH + 1, target, promise: target + PAD }]);
    // The estimate keeps growing with t while the line is not started.
    expect(getAlertIntents(s, c + 5 * M).slips[0]!.estimate).toBe(target + TH + 1 + 5 * M);
  });

  it('[03a BF-3] the crossing and the estimate include carry (t = level − prep − cook − carry)', () => {
    const { s, f } = lateLine({ carry: 2 * M, prep: 1 * M });
    const target = T(s, 'O1');
    expect(target).toBe(f + 1 * M + 10 * M + 2 * M);
    const c = target + TH - 1 * M - 10 * M - 2 * M + 1;
    expect(s.next_alert_due_at).toBe(c);
    expect(getAlertIntents(s, c - 1).slips).toEqual([]);
    expect(getAlertIntents(s, c).slips[0]!.estimate).toBe(target + TH + 1);
  });

  it('[03a §3.8] COOKING lands at its fixed end; a Start on time clears the key, a Done resolves nothing without a slip', () => {
    const { s: s0, f } = lateLine();
    // Started 1 min late: lands at f + 11 min ≤ T + threshold → no crossing (a COOKING land is fixed).
    let s = fold(s0, [startEv('O1', 'A', f + M)]);
    expect(s.slip_due).toEqual({});
    expect(s.next_alert_due_at).toBeNull();
    expect(getAlertIntents(s, at(60)).slips).toEqual([]);
    // Started 3 min late: lands at T + 3 min > T + threshold → due at once (the order's placed_at, ≤ the fold).
    s = fold(s0, [startEv('O1', 'A', f + 3 * M)]);
    expect(s.next_alert_due_at).toBe(s.orders.O1!.placed_at);
    expect(getAlertIntents(s, f + 3 * M).slips[0]!.estimate).toBe(T(s, 'O1') + 3 * M);
    s = fold(s, [doneEv('O1', 'A', f + 13 * M)]);
    expect(s.slip_due).toEqual({});
  });

  it('[03a #36] one slip per table key: the late orders of a key are grouped, other keys apart', () => {
    let s = kitchen([{ station_id: 'S1', capacity: 3 }]);
    ({ state: s } = submit(s, 'O1', [{ id: 'A', cook: 10 * M }], at(0), { key: 'dine_in:T1' }));
    ({ state: s } = submit(s, 'O2', [{ id: 'B', cook: 10 * M }], at(0), { key: 'dine_in:T1' }));
    ({ state: s } = submit(s, 'O3', [{ id: 'C', cook: 10 * M }], at(0), { key: 'dine_in:T2' }));
    const f = s.lines.A!.fire_ms!;
    s = fold(s, [fireEv('S1', ['A', 'B', 'C'], f)]);
    const c = f + TH + 1;
    expect(s.slip_due).toEqual({ 'dine_in:T1': c, 'dine_in:T2': c });
    const a = getAlertIntents(s, c);
    expect(a.slips.map((x) => [x.table_key, x.order_ids])).toEqual([
      ['dine_in:T1', ['O1', 'O2']],
      ['dine_in:T2', ['O3']],
    ]);
  });

  it('[03a #36] re-raise only after another +threshold and only once the previous alert is closed', () => {
    const { s: s0, f } = lateLine();
    const c = f + TH + 1;
    const item = getAlertIntents(s0, c).slips[0]!;
    // fires_alerts raises at c: SlipWarned stores the record; an open alert gives no slip item.
    let s = fold(s0, [slipWarnedEv(item, 'AL1', c)]);
    expect(s.slips['dine_in:T12']).toEqual({ order_ids: ['O1'], last_estimate: item.estimate, alert_id: 'AL1', resolved_at: null });
    // An open, unresolved alert contributes only its BF-4 abandon time (f + order_abandon_ms, AD-13).
    expect(s.slip_due).toEqual({ 'dine_in:T12': f + BASE.settings.order_abandon_ms });
    // Grown by far more than another threshold while the alert is open: still nothing.
    expect(getAlertIntents(s, c + 30 * M)).toEqual({ slips: [], resolved: [], overload: getAlertIntents(s, c + 30 * M).overload });
    // Another alert's AlertClosed changes nothing (§3.8: state itself).
    expect(applyEvent(s, deepFreeze(alertClosedEv('OTHER', c + M)))).toBe(s);
    // Its own AlertClosed: alert_id null; the level is now last_estimate + threshold.
    s = fold(s, [alertClosedEv('AL1', c + M)]);
    expect(s.slips['dine_in:T12']!.alert_id).toBeNull();
    // estimate(t) = t + 10 min > last_estimate + threshold = T + 2 × threshold + 1 → t = c + threshold + 1.
    const c2 = c + TH + 1;
    expect(s.next_alert_due_at).toBe(c2);
    expect(getAlertIntents(s, c2 - 1).slips).toEqual([]);
    expect(getAlertIntents(s, c2).slips[0]!.estimate).toBe(item.estimate + TH + 1);
  });

  it('[03a §3.8] resolution: a resolved key with an open alert is due at resolved_at (closed done); without an alert the record is dropped', () => {
    const { s: s0, f } = lateLine();
    const c = f + TH + 1;
    let s = fold(s0, [slipWarnedEv(getAlertIntents(s0, c).slips[0]!, 'AL1', c)]);
    s = fold(s, [startEv('O1', 'A', c + M), doneEv('O1', 'A', c + 11 * M)]);
    expect(s.slips['dine_in:T12']!.resolved_at).toBe(c + 11 * M);
    expect(s.slip_due).toEqual({ 'dine_in:T12': c + 11 * M });
    expect(getAlertIntents(s, c + 11 * M - 1).resolved).toEqual([]);
    expect(getAlertIntents(s, c + 11 * M).resolved).toEqual([{ table_key: 'dine_in:T12', alert_id: 'AL1' }]);
    // An Undo before the close pass makes it unresolved again: resolved_at cleared, the alert stays open.
    const u = fold(s, [undoEv('O1', 'A', c + 11 * M + S)]);
    expect(u.slips['dine_in:T12']!.resolved_at).toBeNull();
    expect(u.slip_due).toEqual({ 'dine_in:T12': u.orders.O1!.last_line_fold_at + BASE.settings.order_abandon_ms }); // BF-4 only
    // The close's AlertClosed drops the record.
    s = fold(s, [alertClosedEv('AL1', c + 12 * M)]);
    expect(s.slips).toEqual({});
    expect(s.slip_due).toEqual({});
    // A slip whose alert was closed by someone else (alert_id null) is dropped at resolution.
    let r = fold(s0, [slipWarnedEv(getAlertIntents(s0, c).slips[0]!, 'AL2', c), alertClosedEv('AL2', c + S)]);
    expect(r.slips['dine_in:T12']!.alert_id).toBeNull();
    r = fold(r, [startEv('O1', 'A', c + M), doneEv('O1', 'A', c + 11 * M)]);
    expect(r.slips).toEqual({});
  });

  it('[03a BF-14] the crossing of a fired line packs behind the fired lines ahead; a Start of the first recomputes the second key', () => {
    let s = kitchen([{ station_id: 'S1', capacity: 1 }]);
    ({ state: s } = submit(s, 'O1', [{ id: 'A', cook: 10 * M }], at(0), { key: 'dine_in:T1' }));
    ({ state: s } = submit(s, 'O2', [{ id: 'B', cook: 10 * M }], at(0), { key: 'dine_in:T2' }));
    const f = s.lines.A!.fire_ms!;
    const tB = T(s, 'O2');
    expect(tB).toBe(f + 20 * M);
    // Both fired at f (B pulled early, AD-9): B packs behind A, so its estimate is t + 20 min, not t + 10 min.
    s = fold(s, [fireEv('S1', ['A', 'B'], f)]);
    expect(liveInterval(s, 'B', f)).toEqual({ start: f + 10 * M, end: f + 20 * M });
    expect(s.slip_due['dine_in:T2']).toBe(f + TH + 1);
    expect(s.slip_due['dine_in:T1']).toBe(f + TH + 1);
    // A starts at f + 1 min: B now packs from A's fixed end f + 11 min, so its crossing moves to f + 12 min + 1.
    const before = s.slip_due;
    s = fold(s, [startEv('O1', 'A', f + M)]);
    expect(s.slip_due).not.toBe(before);
    expect(s.slip_due).toEqual({ 'dine_in:T2': f + 12 * M + 1 });
    expect(getAlertIntents(s, f + 12 * M).slips).toEqual([]);
    expect(getAlertIntents(s, f + 12 * M + 1).slips[0]!.estimate).toBe(tB + TH + 1);
  });

  it('[03a BF-10] defaults: a Waada Guard slip is raised before its promise; on EDF / FIFO (padding 0) after P (AD-3)', () => {
    for (const policy of ['waada_guard', 'edf', 'fifo'] as const) {
      const { s } = lateLine({ policy });
      const item = getAlertIntents(s, s.next_alert_due_at!).slips[0]!;
      expect(item.target).toBe(T(s, 'O1'));
      if (policy === 'waada_guard') {
        expect(item.promise - item.target).toBe(PAD);
        expect(item.estimate).toBeLessThan(item.promise); // the order taker hears before the promise is blown (D11)
      } else {
        expect(item.promise).toBe(item.target); // padding 0 (D3): the claim is narrowed to Waada Guard (AD-3)
        expect(item.estimate).toBeGreaterThan(item.promise);
      }
    }
  });

  it('[03a BF-4] every order of a key abandoned: slip_due = its abandon time and resolved lists the key', () => {
    const { s: s0, f } = lateLine();
    const c = f + TH + 1;
    const s = fold(s0, [slipWarnedEv(getAlertIntents(s0, c).slips[0]!, 'AL1', c)]);
    // The last line fold is the FireDispatched at f (SlipWarned refreshes nothing, §3.3); the land (f + 10 min) is
    // earlier, so the abandon time is f + order_abandon_ms (AD-13).
    const abandon = f + BASE.settings.order_abandon_ms;
    expect(s.slip_due).toEqual({ 'dine_in:T12': abandon });
    expect(getAlertIntents(s, abandon - 1).resolved).toEqual([]);
    expect(getAlertIntents(s, abandon)).toMatchObject({ slips: [], resolved: [{ table_key: 'dine_in:T12', alert_id: 'AL1' }] });
    // Without an open alert the key's crossing stops at the abandon time: an abandoned order never slips.
    const n = fold(s, [alertClosedEv('AL1', c + M)]);
    expect(n.slip_due).toEqual({ 'dine_in:T12': c + TH + 1 });
    const late = fold(n, [stamp(aStockSet(), abandon + S)]); // a listed fold after the abandon removes the order
    expect(late.orders.O1).toBeUndefined();
    expect(late.slips).toEqual({});
    expect(late.slip_due).toEqual({});
  });

  it('[03a §3.8] the slip half of #91: a line placed late by the submit gap has next_alert_due_at at its crossing', () => {
    let s = kitchen([{ station_id: 'S1', capacity: 1 }, { station_id: 'S2', capacity: 1 }], { slip_threshold_ms: 10_000 });
    ({ state: s } = submit(s, 'OX', [{ id: 'X', cook: 5 * M, mode: 'immediate' }], at(0), { key: 'dine_in:TX' }));
    s = fold(s, [fireEv('S1', ['X'], at(0))]);
    const now = at(1);
    const rec = at(1) + 30_000;
    const r = submit(s, 'ON', [{ id: 'A', cook: 3 * M }, { id: 'B', station: 'S2', cook: M }], now, {}, rec);
    expect(r.state.lines.A!.booked).toEqual({ start: at(6) + 30_000, end: at(9) + 30_000, units: 1 });
    expect(T(r.state, 'ON')).toBe(at(9));
    // Planned land 12:09:30 > T + 10 s at the batch's own fold: due at once (the order's placed_at = recorded_at).
    expect(r.state.slip_due['dine_in:T12']).toBe(rec);
    expect(r.state.next_alert_due_at).toBe(rec);
    expect(getAlertIntents(r.state, rec).slips).toEqual([{ table_key: 'dine_in:T12', order_ids: ['ON'], estimate: at(9) + 30_000, target: at(9), promise: at(9) + PAD }]);
  });

  it('[03a §3.8] an immediate line is not a sync group: it never slips', () => {
    let s = kitchen([{ station_id: 'S1', capacity: 1 }]);
    ({ state: s } = submit(s, 'O1', [{ id: 'A', cook: 10 * M, mode: 'immediate' }], at(0)));
    s = fold(s, [fireEv('S1', ['A'], s.lines.A!.fire_ms!)]);
    expect(s.slip_due).toEqual({});
    expect(getAlertIntents(s, at(120)).slips).toEqual([]);
  });

  it('[03a #106] a fold that touches no slip or group leaves slip_due and next_alert_due_at identical', () => {
    const { s } = lateLine();
    expect(s.next_alert_due_at).not.toBeNull();
    const others: PosEvent[] = [
      stamp(aStockSet({ payload: { stock_item_id: 'X9', on_hand: 4, unit: 'piece' } }), at(1)),
      stamp(aBusinessDayOpened(), at(1)),
      alertClosedEv('NOT-A-SLIP', at(1)),
      stamp(anItemStarted({ stream_id: 'O-absent', payload: { order_item_id: 'nope', started_at: at(1), source: 'tap' } }), at(1)),
    ];
    for (const e of others) {
      const n = applyEvent(s, deepFreeze(e));
      expect(Object.is(n.slip_due, s.slip_due)).toBe(true);
      expect(Object.is(n.next_alert_due_at, s.next_alert_due_at)).toBe(true);
    }
  });

  it('[03a §3.8] BusinessDayClosed drops slips: an open slip of an order carried over the close slips afresh by the crossing', () => {
    const r0 = lateLine();
    const f = r0.f;
    let s = r0.s;
    s = fold(s, [stamp(aBusinessDayOpened(), f)]);
    s = fold(s, [startEv('O1', 'A', f + 3 * M)]); // lands T + 3 min > T + threshold
    const item = getAlertIntents(s, f + 3 * M).slips[0]!;
    s = fold(s, [slipWarnedEv(item, 'AL1', f + 3 * M)]);
    expect(s.slips['dine_in:T12']!.alert_id).toBe('AL1');
    s = fold(s, [stamp(aBusinessDayClosed(), f + 4 * M)]);
    expect(s.orders.O1).toBeDefined(); // a COOKING line: carried over the close (Q13)
    expect(s.slips).toEqual({});
    const placed = s.orders.O1!.placed_at;
    expect(s.slip_due).toEqual({ 'dine_in:T12': placed });
    const a = getAlertIntents(s, placed);
    expect(a.resolved).toEqual([]);
    expect(a.slips).toEqual([{ table_key: 'dine_in:T12', order_ids: ['O1'], estimate: T(s, 'O1') + 3 * M, target: T(s, 'O1'), promise: T(s, 'O1') + PAD }]);
  });

  it('[03a §3.8] an order whose only change is its clock (OrderBoosted) moves its abandon time: the keys packed behind it are recomputed', () => {
    // abandon 15 min, threshold 15 min; A (O1, key k1) and B (O2, key k2) fired together on capacity 1, never tapped.
    let s = kitchen([{ station_id: 'S1', capacity: 1 }], { order_abandon_ms: 15 * M, slip_threshold_ms: 15 * M });
    ({ state: s } = submit(s, 'O1', [{ id: 'A', cook: 10 * M }], at(0), { key: 'k1' }));
    ({ state: s } = submit(s, 'O2', [{ id: 'B', cook: 10 * M }], at(0), { key: 'k2' }));
    const f = s.lines.A!.fire_ms!;
    s = fold(s, [fireEv('S1', ['A', 'B'], f)]);
    const boosted = (order_id: string, t: number): PosEvent =>
      stamp({ ...anItemStarted(), event_type: 'OrderBoosted', stream_id: order_id, payload: { order_id } }, t);
    // O2's clock refreshed at f + 12: O2 exits at f + 27. A exits at f + 15, so B packs behind A until then and its
    // crossing (level f + 35) is after A has gone: t + 10 min > f + 35 min.
    s = fold(s, [boosted('O2', f + 12 * M)]);
    expect(s.slip_due.k2).toBe(f + 25 * M + 1);
    // O1's clock refreshed at f + 13: A stays until f + 28, B packs behind it, t + 20 min > f + 35 → f + 15 min + 1.
    s = fold(s, [boosted('O1', f + 13 * M)]);
    expect(s.slip_due.k2).toBe(f + 15 * M + 1);
  });

  it('[03a #106] a capacity change moves the exit of an order on that station: the keys packed behind it on another station are recomputed', () => {
    // Abandon 10 min, threshold 15. O1: C (4 units, cook 10) COOKING on A, X fired on B (capacity 1), never tapped. O2 (k2):
    // Y (cook 20, T = 12:30, level 12:45) pulled on B behind X.
    let s = kitchen([{ station_id: 'A', capacity: 4 }, { station_id: 'B', capacity: 1 }], { order_abandon_ms: 10 * M, slip_threshold_ms: 15 * M });
    ({ state: s } = submit(s, 'O1', [{ id: 'C', station: 'A', cook: 10 * M, units: 4 }, { id: 'X', station: 'B', cook: 10 * M, mode: 'immediate' }], at(0), { key: 'k1' }));
    ({ state: s } = submit(s, 'O2', [{ id: 'Y', station: 'B', cook: 20 * M }], at(0), { key: 'k2' }));
    const pulled = stamp(aFireDispatched({ stream_id: 'B', payload: { station_id: 'B', order_item_ids: ['Y'], load_id: null, due_at: at(1), reason: 'pulled' } }), at(1));
    s = fold(s, [fireEv('A', ['C'], at(1)), startEv('O1', 'C', at(1)), fireEv('B', ['X'], at(1)), pulled]);
    // At capacity 4 C lands at 12:11, so O1 is gone then, Y packs alone, and it would cross only at 12:25, after its own
    // exit at 12:21: no key.
    expect(s.slip_due).toEqual({});
    // At capacity 3 C cooks 20 min: O1 stays until 12:21, Y packs behind X, t + 30 min > 12:45 at 12:15 + 1 ms. Nothing
    // of O2 or of B changed, and the late-order alert exists only if k2 is recomputed.
    const cap: PosEvent = stamp({ ...anItemStarted(), event_type: 'StationCapacitySet', stream_id: 'A', payload: { station_id: 'A', capacity_override: 3 } }, at(2));
    s = fold(s, [cap]);
    expect(s.slip_due).toEqual({ k2: at(15) + 1 });
  });

  it('[03a §3.8] an EngineConfigApplied that changes slip_threshold_ms recomputes every key', () => {
    const { s, f } = lateLine();
    expect(s.next_alert_due_at).toBe(f + TH + 1);
    const n = fold(s, [configEvent([{ station_id: 'S1', capacity: 1 }], { slip_threshold_ms: 60_000 }, f + S)]);
    expect(n.slip_due).toEqual({ 'dine_in:T12': f + 60_001 });
    // The same config again touches nothing: slip_due keeps its reference.
    const again = applyEvent(n, deepFreeze(configEvent([{ station_id: 'S1', capacity: 1 }], { slip_threshold_ms: 60_000 }, f + 2 * S)));
    expect(Object.is(again.slip_due, n.slip_due)).toBe(true);
  });

  it('[03a §6.1g] nextAlertDueAt: the field, and with exclude the same minimum without those keys', () => {
    let s = kitchen([{ station_id: 'S1', capacity: 2 }]);
    ({ state: s } = submit(s, 'O1', [{ id: 'A', cook: 10 * M }], at(0), { key: 'k1' }));
    ({ state: s } = submit(s, 'O2', [{ id: 'B', cook: 20 * M }], at(0), { key: 'k2' }));
    s = fold(s, [fireEv('S1', ['A'], s.lines.A!.fire_ms!), fireEv('S1', ['B'], s.lines.B!.fire_ms!)]);
    expect(nextAlertDueAt(s)).toBe(s.next_alert_due_at);
    expect(nextAlertDueAt(s, new Set(['k1']))).toBe(s.slip_due.k2);
    expect(nextAlertDueAt(s, new Set(['k1', 'k2']))).toBeNull();
    expect(nextAlertDueAt(initialEngineState())).toBeNull();
    expect(initialEngineState().next_alert_due_at).toBeNull();
  });
});

describe('03a §3.10 overload items', () => {
  it('[03a §3.10] per station: pressure in basis points from the live profile, orders waiting, the capped flag of unfired lines', () => {
    let s = kitchen([{ station_id: 'S1', capacity: 2 }, { station_id: 'S2', capacity: 1 }]);
    ({ state: s } = submit(s, 'O1', [{ id: 'A', cook: 10 * M }], at(0)));
    ({ state: s } = submit(s, 'O2', [{ id: 'B', cook: 5 * M, mode: 'immediate' }], at(0)));
    const now = at(0);
    const window = BASE.stations[0]!.pressure_window_ms;
    // A [12:00, 12:10) and B [12:00, 12:05) booked on S1 (2 units): 15 unit-min of 2 × 15 min = 5 000 bp.
    expect(window).toBe(15 * M);
    expect(stationPressure(s, 'S1', now)).toBe(Math.floor((15 * M * 10_000) / (2 * window)));
    const a = getAlertIntents(s, now);
    expect(a.overload).toEqual([
      { station_id: 'S1', pressure_bp: 5_000, waiting: 2, capped: false },
      { station_id: 'S2', pressure_bp: 0, waiting: 0, capped: false },
    ]);
    // §3.10 reads `capped` on unfired lines only (AD-15).
    const capped = deepFreeze({ ...s, lines: { ...s.lines, A: { ...s.lines.A!, capped: true } } });
    expect(getAlertIntents(capped, now).overload[0]!.capped).toBe(true);
    const fired = fold(capped, [fireEv('S1', ['A'], now)]);
    expect(getAlertIntents(fired, now).overload[0]!.capped).toBe(false);
    // Pure: the same result twice.
    expect(getAlertIntents(s, now)).toEqual(a);
  });
});

// ---- property: tests 92 and 106 over 50 seeds (BF-3 carry, BF-14 two fired lines on capacity 1) -------------------

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function asEvents(drafts: readonly TickDraft[], now: number): PosEvent[] {
  return drafts.map((d) => stamp({ ...anItemStarted(), ...d, payload: d.payload as unknown as Record<string, unknown>, actor_id: null, device_id: 'hub' }, now));
}

// After every fold: slip_due = the full recompute (106); whenever next_alert_due_at is finite, getAlertIntents at it has
// a slip or resolved item for its key and at − 1 none for that key (92).
function check92(s: EngineState): void {
  checkUpkeep(s);
  const due = s.next_alert_due_at;
  if (due === null) return;
  const key = Object.keys(s.slip_due).find((k) => s.slip_due[k] === due)!;
  const has = (a: AlertIntents): boolean => a.slips.some((x) => x.table_key === key) || a.resolved.some((x) => x.table_key === key);
  expect(has(getAlertIntents(s, due)), `item for ${key} at ${due}`).toBe(true);
  expect(has(getAlertIntents(s, due - 1)), `no item for ${key} at ${due - 1}`).toBe(false);
  // Oracle (review): a slip item's estimate exceeds its level; a group crossing at `due` after its order's placed_at
  // is not over its level at due − 1 (the crossing is the first such instant).
  const item = getAlertIntents(s, due).slips.find((x) => x.table_key === key);
  if (item === undefined) return;
  const slip = s.slips[key];
  expect(item.estimate).toBeGreaterThan((slip === undefined ? item.target : slip.last_estimate) + s.config!.settings.slip_threshold_ms);
  const before = slipGroupsAt(s, key, due - 1);
  for (const g of slipGroupsAt(s, key, due)) {
    if (g.crossing !== due) continue;
    expect(g.estimate).toBeGreaterThan(g.level);
    if (due > g.placed_at) {
      const b = before.find((x) => x.order_id === g.order_id && x.level === g.level && x.crossing === g.crossing);
      expect(b, `group of ${g.order_id} at due − 1`).toBeDefined();
      expect(b!.estimate).toBeLessThanOrEqual(g.level);
    }
  }
}

function runSeed(seed: number): { live: EngineState; log: PosEvent[]; firedOnCap1: number } {
  const rnd = prng(seed);
  const pick = <V>(xs: readonly V[]): V => xs[Math.floor(rnd() * xs.length)]!;
  const log: PosEvent[] = [];
  const carry = seed % 2 === 0 ? 0 : 30_000 + Math.floor(rnd() * 4) * 30_000; // BF-3: odd seeds carry > 0
  let s = kitchen([{ station_id: 'S1', capacity: 1 }, { station_id: 'S2', capacity: 2, policy: seed % 3 === 0 ? 'edf' : 'waada_guard' }], {}, log);
  const stepFold = (events: PosEvent[]): void => {
    s = fold(s, events, log);
    check92(s);
  };
  let now = at(0);
  let n = 0;
  let firedOnCap1 = 0;
  let alerts = 0;
  for (let step = 0; step < 40; step++) {
    now += Math.floor(rnd() * 4 * M);
    const r = rnd();
    if (r < 0.35 && n < 12) {
      const id = `O${n++}`;
      const k = 1 + Math.floor(rnd() * 3);
      const items: Item[] = Array.from({ length: k }, (_, j) => ({
        id: `${id}L${j}`,
        station: rnd() < 0.5 ? 'S1' : 'S2',
        cook: (2 + Math.floor(rnd() * 10)) * M,
        prep: rnd() < 0.3 ? M : 0,
        carry,
        mode: rnd() < 0.85 ? 'sync' : 'immediate',
      }));
      ({ state: s } = submit(s, id, items, now, { key: pick(['k1', 'k2', 'k3']) }, now, log));
      check92(s);
    } else if (r < 0.6) {
      // BF-14: fire every unfired S1 line due within 15 min at once, so several fired-not-started lines pack on capacity 1.
      const ids = s.stations.S1!.unfired.filter((x) => s.lines[x]!.fire_ms! <= now + 15 * M);
      if (ids.length > 0) {
        stepFold([fireEv('S1', ids, now)]);
        firedOnCap1 = Math.max(firedOnCap1, Object.values(s.lines).filter((l) => l.station_id === 'S1' && l.stage === 'added' && l.fired_at !== null).length);
      }
    } else if (r < 0.75) {
      const fired = Object.values(s.lines).filter((l) => l.stage === 'added' && l.fired_at !== null);
      if (fired.length > 0) {
        const l = pick(fired);
        stepFold([startEv(l.order_id, l.order_item_id, now)]);
      }
    } else if (r < 0.85) {
      const cooking = Object.values(s.lines).filter((l) => l.stage === 'cooking');
      if (cooking.length > 0) {
        const l = pick(cooking);
        stepFold([doneEv(l.order_id, l.order_item_id, now)]);
        if (rnd() < 0.3) stepFold([undoEv(l.order_id, l.order_item_id, now + S)]);
      }
    } else {
      // A fires pass (scheduled fires, cascades) and a fires_alerts pass at the next due time if any.
      const drafts = getTickIntents(s, now);
      if (drafts.length > 0) stepFold(asEvents(drafts, now));
      const due = s.next_alert_due_at;
      if (due !== null && due <= now) {
        const a = getAlertIntents(s, now);
        for (const x of a.resolved) stepFold([alertClosedEv(x.alert_id, now)]);
        for (const x of a.slips) stepFold([slipWarnedEv(x, `AL${seed}-${alerts++}`, now)]);
        // Sometimes the alert is closed by someone else right away (02's ReleaseItems), so re-raise is exercised.
        if (rnd() < 0.5) for (const x of Object.values(s.slips)) if (x.alert_id !== null && x.resolved_at === null) stepFold([alertClosedEv(x.alert_id, now + S)]);
      }
    }
  }
  return { live: s, log, firedOnCap1 };
}

describe('03a §3.8 property (50 seeds)', () => {
  it('[03a #92] next_alert_due_at: an item at it, none at − 1, equal live and replayed, null on an idle state; [03a #106] per-key = full recompute', () => {
    expect(initialEngineState().next_alert_due_at).toBeNull();
    expect(kitchen([{ station_id: 'S1' }]).next_alert_due_at).toBeNull();
    let maxFired = 0;
    let withDue = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const { live, log, firedOnCap1 } = runSeed(seed);
      maxFired = Math.max(maxFired, firedOnCap1);
      if (live.next_alert_due_at !== null || Object.keys(live.slips).length > 0) withDue++;
      const replayed = buildEngineState(log);
      expect(replayed.slip_due).toEqual(live.slip_due);
      expect(replayed.next_alert_due_at).toBe(live.next_alert_due_at);
      expect(replayed.slips).toEqual(live.slips);
    }
    expect(maxFired).toBeGreaterThanOrEqual(2); // BF-14 exercised
    expect(withDue).toBeGreaterThan(10);
  }, 60_000);
});
