// 03a §3.8 split send (D11, D12): applyEvent(ItemsReleased) — released lines leave their group, expedite lines become
// immediate with the follow-up weight, the rest stay sync at their old T, one re-plan; §6.1m planRelease / goesWith;
// [03a #77 engine] the slip close folds (built by task 15, locked here); the split part of #81 (next_group_index,
// snapshot + replay = full replay); AD-7, AD-12 for the group whose membership changed. Pure: every input is
// deep-frozen.
import { parseEvent, type EngineConfig, type ItemAddedPayload, type PosEvent } from '@pos/events';
import { aFireDispatched, anAlertClosed, anEngineConfigApplied, anItemAdded, anItemDone, anItemStarted, anOrderBatch, aReturnLinesAdded } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import {
  applyEvent,
  buildEngineState,
  getAlertIntents,
  goesWith,
  initialEngineState,
  planOrder,
  planRelease,
  type AlertIntents,
  type EngineState,
  type GoesWithLink,
  type ProposedOrder,
} from '../src/index';
import { profileOf, weightOf, type Booking } from '../src/replan';
import { slipDueOf } from '../src/slip';
import { fryer, loadOf, submitB, T as BT } from './batch-kit';

const T0 = 1_761_000_000_000; // "12:00"
const M = 60_000;
const at = (min: number): number => T0 + min * M;
const TH = 120_000; // slip_threshold_ms default
const KEEP = 60_000; // min_slack_keep_ms default

function deepFreeze<V>(value: V): V {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const BASE = parseEvent(anEngineConfigApplied()).payload as unknown as EngineConfig;
type StationCfg = EngineConfig['stations'][number];

let seq = 10;
const nextSeq = (n = 0): number => {
  const s = seq;
  seq += n + 1;
  return s;
};
const stamp = (e: PosEvent, t: number): PosEvent => {
  const s = nextSeq();
  return { ...e, recorded_at: t, occurred_at: t, seq: s, event_id: `01R${String(s).padStart(23, '0')}` };
};

function configEvent(stations: Array<Partial<StationCfg> & { station_id: string }>): PosEvent {
  const list = [...stations].sort((a, b) => (a.station_id < b.station_id ? -1 : 1)).map((s) => ({ ...BASE.stations[0]!, name: s.station_id, ...s }));
  return stamp(anEngineConfigApplied({ payload: { stations: list, settings: BASE.settings } }), T0 - 3_600_000);
}

function checkUpkeep(s: EngineState): void {
  expect(s.slip_due).toEqual(slipDueOf(s));
  const vals = Object.values(s.slip_due);
  expect(s.next_alert_due_at).toBe(vals.length === 0 ? null : Math.min(...vals));
}

function fold(state: EngineState, events: PosEvent[], log?: PosEvent[], opts?: { strict?: boolean }): EngineState {
  let s = deepFreeze(state);
  for (const e of events) {
    s = deepFreeze(applyEvent(s, deepFreeze(e), opts));
    log?.push(e);
    checkUpkeep(s);
  }
  return s;
}

function kitchen(stations: Array<Partial<StationCfg> & { station_id: string }>, log?: PosEvent[]): EngineState {
  return fold(initialEngineState(), [configEvent(stations)], log);
}

type Item = { id: string; station?: string; cook: number; mode?: 'sync' | 'immediate' };

function itemFields(i: Item): Record<string, unknown> {
  return { station_id: i.station ?? 'S1', cook_time_ms: i.cook, prep_buffer_ms: 0, serve_mode: i.mode ?? 'sync', quantity: 1 };
}

function proposed(order_id: string, items: Item[], key: string): ProposedOrder {
  const base = anItemAdded().payload as unknown as ItemAddedPayload;
  return deepFreeze({
    order_id,
    order: { order_type: 'dine_in', table_id: 'T12', table_key: key, follow_up: false, pickup_at_ms: null },
    lines: items.map((i) => ({
      ...base,
      ...(itemFields(i) as Partial<ItemAddedPayload>),
      order_id,
      order_item_id: i.id,
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

function submitEvents(state: EngineState, order_id: string, items: Item[], now: number, key = 'dine_in:T12'): PosEvent[] {
  const plan = planOrder(state, proposed(order_id, items, key), now, {});
  const first = nextSeq(items.length + 1);
  return anOrderBatch({
    order_id,
    recorded_at: now,
    seq: first,
    lines: items.map((i) => ({
      order_item_id: i.id,
      item: itemFields(i),
      line: { station_id: plan.lines.find((l) => l.order_item_id === i.id)!.station_id, carry_ms: 0, max_early_ms: 60_000 },
    })),
    order: { groups: plan.groups, order_type: 'dine_in', table_key: key, pickup_at_ms: null },
  }).map((e, k) => ({ ...e, event_id: `01S${String(first + k).padStart(23, '0')}` }));
}

function submit(state: EngineState, order_id: string, items: Item[], now: number, key?: string, log?: PosEvent[]): EngineState {
  return fold(state, submitEvents(state, order_id, items, now, key), log);
}

const doneEv = (order_id: string, id: string, t: number): PosEvent => stamp(anItemDone({ stream_id: order_id, payload: { order_item_id: id, done_at: t, source: 'tap' } }), t);
const undoEv = (order_id: string, id: string, t: number): PosEvent =>
  stamp({ ...anItemDone(), event_type: 'ItemDoneUndone', stream_id: order_id, payload: { order_item_id: id } }, t);
const fireEv = (station_id: string, ids: string[], t: number): PosEvent =>
  stamp(aFireDispatched({ stream_id: station_id, payload: { station_id, order_item_ids: ids, load_id: null, due_at: t, reason: 'scheduled' } }), t);
const servedEv = (order_id: string, ids: string[], t: number): PosEvent =>
  stamp({ ...anItemDone(), event_type: 'ItemServed', stream_id: order_id, payload: { order_item_ids: ids } }, t);
const releasedEv = (order_id: string, released: string[], expedite: string[], t: number, alert_id: string | null = null): PosEvent =>
  stamp({ ...anItemStarted(), event_type: 'ItemsReleased', stream_id: order_id, payload: { order_id, alert_id, released, expedite } }, t);
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
const alertClosedEv = (alert_id: string, t: number): PosEvent => stamp(anAlertClosed({ stream_type: 'order', stream_id: 'O1', payload: { alert_id, reason: 'done', by_staff_id: null, note: null } }), t);

// The stored profile of a slot station = exactly the bookings of its unfired lines (AD-7).
function bookedProfile(s: EngineState, sid: string): EngineState['stations'][string]['profile'] {
  const bookings: Booking[] = s.stations[sid]!.unfired.map((id) => s.lines[id]!.booked!);
  return profileOf(bookings);
}

// O1 on S1 (capacity 2) and S2 (capacity 1): C (S1, 30 min) sets T = 12:30 and fires at once (frozen); B (S2, 6 min)
// and A (S1, 4 min) are hidden, queued to land at T. A is done early (Done from added, AD-10) at 12:01.
function scene(log?: PosEvent[]): EngineState {
  let s = kitchen([{ station_id: 'S1', capacity: 2 }, { station_id: 'S2', capacity: 1 }], log);
  s = submit(
    s,
    'O1',
    [
      { id: 'A', cook: 4 * M },
      { id: 'B', station: 'S2', cook: 6 * M },
      { id: 'C', cook: 30 * M },
    ],
    at(0),
    undefined,
    log,
  );
  return fold(s, [doneEv('O1', 'A', at(1))], log);
}

describe('03a §3.8 applyEvent(ItemsReleased) (D11, D12)', () => {
  it('[03a #37] released lines leave the group; expedite become immediate with the follow-up weight; the rest stay sync at their old T; one re-plan', () => {
    const s = scene();
    const T = s.orders.O1!.groups['O1:0']!.target_land_ms;
    expect(T).toBe(at(30));
    expect(s.lines.B!.fire_ms).toBe(at(24)); // hidden at 12:02 (freeze 2 min)
    expect(s.lines.C!.fire_ms).toBe(at(0));
    const before = s.lines.C!;

    const r = fold(s, [releasedEv('O1', ['A'], ['B'], at(2))]);
    const o = r.orders.O1!;
    // Released: A leaves O1:0 into a group of its own (next_group_index), no hold.
    expect(r.lines.A).toMatchObject({ stage: 'done', serve_mode: 'immediate', group_id: 'O1:1', mark: null });
    expect(o.groups['O1:1']).toEqual({ target_land_ms: T, line_ids: ['A'] });
    // Expedite: B is immediate, mark 'expedite', its own group, placed at its earliest fit from 12:02 on S2.
    expect(r.lines.B).toMatchObject({ serve_mode: 'immediate', group_id: 'O1:2', mark: 'expedite', fire_ms: at(2), deadline_ms: at(2) });
    expect(r.lines.B!.booked).toEqual({ start: at(2), end: at(8), units: 1 });
    expect(o.groups['O1:2']).toEqual({ target_land_ms: at(8), line_ids: ['B'] });
    expect(weightOf(r, r.lines.B!)).toBe(100 * BASE.settings.weight_follow_up_pct / 100);
    // The rest: C stays sync in O1:0 at its old T, untouched.
    expect(o.groups['O1:0']).toEqual({ target_land_ms: T, line_ids: ['C'] });
    expect(r.lines.C).toBe(before);
    expect(weightOf(r, r.lines.C!)).toBe(100 * BASE.settings.weight_dine_in_pct / 100);
    expect(o.next_group_index).toBe(3);
    expect(o.target_land_ms).toBe(s.orders.O1!.target_land_ms);
    expect(o.promise_ms).toBe(s.orders.O1!.promise_ms);
    expect(o.last_line_fold_at).toBe(at(2));
    // AD-7: S2's profile is exactly B's new booking (the old one removed exactly once); S1 is not re-planned.
    expect(r.stations.S2!.profile).toEqual(bookedProfile(r, 'S2'));
    expect(r.stations.S2!.profile).toEqual({ t: [at(2), at(8)], u: [1, 0] });
    expect(r.stations.S1).toBe(s.stations.S1);
    // The same event again changes no line or group (the lines are no longer sync).
    const again = fold(r, [releasedEv('O1', ['A'], ['B'], at(3))]);
    expect(again.lines).toBe(r.lines);
    expect(again.orders.O1!.groups).toBe(r.orders.O1!.groups);
  });

  it('[03a #37] one re-plan per station: pass 1 re-places the other hidden lines of the expedite station keep-first, then the expedite line takes its earliest fit', () => {
    let s = kitchen([{ station_id: 'S1', capacity: 2 }, { station_id: 'S2', capacity: 1 }]);
    s = submit(s, 'O1', [{ id: 'B', station: 'S2', cook: 6 * M }, { id: 'C', cook: 30 * M }], at(0));
    s = submit(s, 'O2', [{ id: 'D', station: 'S2', cook: 6 * M }, { id: 'G', cook: 40 * M }], at(0), 'dine_in:T7');
    const d = s.lines.D!;
    expect(d.fire_ms).toBeGreaterThan(at(4));
    const r = fold(s, [releasedEv('O1', [], ['B'], at(2))]);
    // D (hidden on S2) went through pass 1 once: latest fit by d − keep.
    expect(r.lines.D!.fire_ms).toBe(d.deadline_ms - KEEP);
    expect(r.lines.D!.deadline_ms).toBe(d.deadline_ms);
    expect(r.lines.B!.fire_ms).toBe(at(2));
    expect(r.stations.S2!.profile).toEqual(bookedProfile(r, 'S2'));
    expect(r.stations.S1).toBe(s.stations.S1);
  });

  it('[03a D12] an expedited line never lands later than its sync slot: pass 1 cannot move a sibling into its old slot (review probe)', () => {
    for (const g of [26, 30]) {
      let s = kitchen([{ station_id: 'S1', capacity: 2 }, { station_id: 'S2', capacity: 1 }]);
      s = submit(s, 'O0', [{ id: 'X', station: 'S2', cook: 16 * M, mode: 'immediate' }], at(0), 'dine_in:T5');
      s = fold(s, [fireEv('S2', ['X'], at(0)), stamp(anItemStarted({ stream_id: 'O0', payload: { order_item_id: 'X', started_at: at(0), source: 'tap' } }), at(0))]);
      s = submit(s, 'O1', [{ id: 'B', station: 'S2', cook: 6 * M }, { id: 'C', cook: 24 * M }], at(0));
      s = submit(s, 'O2', [{ id: 'D', station: 'S2', cook: 6 * M }, { id: 'G', cook: g * M }], at(0), 'dine_in:T7');
      const old = s.lines.B!;
      expect(old.fire_ms! > at(4)).toBe(true); // hidden at 12:02
      const r = fold(s, [releasedEv('O1', [], ['B'], at(2))]);
      const b = r.lines.B!;
      expect(b).toMatchObject({ serve_mode: 'immediate', mark: 'expedite' });
      expect(b.booked!.end + b.carry_ms).toBeLessThanOrEqual(old.booked!.end + old.carry_ms);
      expect(b.deadline_ms).toBe(b.fire_ms);
      expect(r.orders.O1!.groups[b.group_id]!.target_land_ms).toBe(b.booked!.end + b.carry_ms);
      for (const sid of ['S1', 'S2']) expect(r.stations[sid]!.profile).toEqual(bookedProfile(r, sid));
    }
  });

  it('[03a D12] property over 40 seeds: an expedited line never lands later than before its release; profiles = bookings; live = replay', () => {
    let rng = 0;
    const rand = (n: number): number => {
      rng = (rng * 1_103_515_245 + 12_345) % 2_147_483_648;
      return rng % n;
    };
    let checked = 0;
    for (let seed = 1; seed <= 40; seed++) {
      rng = seed;
      const log: PosEvent[] = [];
      let s = kitchen([{ station_id: 'S1', capacity: 1 + rand(2) }, { station_id: 'S2', capacity: 1 + rand(2) }], log);
      const orders = 2 + rand(3);
      for (let k = 0; k < orders; k++) {
        const items: Item[] = [];
        const n = 2 + rand(3);
        for (let j = 0; j < n; j++) items.push({ id: `L${k}_${j}`, station: rand(2) === 0 ? 'S1' : 'S2', cook: (2 + rand(20)) * M });
        s = submit(s, `O${k}`, items, at(0), `dine_in:T${k}`, log);
      }
      const t = at(2);
      const k = rand(orders);
      const cands = s.orders[`O${k}`]!.line_ids.filter((id) => {
        const l = s.lines[id]!;
        return l.booked !== null && l.fire_ms! > t + 120_000;
      });
      if (cands.length === 0) continue;
      const pickN = 1 + rand(cands.length);
      const exp = cands.slice(0, pickN);
      const before = Object.fromEntries(exp.map((id) => [id, s.lines[id]!.booked!.end + s.lines[id]!.carry_ms]));
      const ev = releasedEv(`O${k}`, [], exp, t);
      const r = fold(s, [ev], log);
      for (const id of exp) {
        const l = r.lines[id]!;
        expect(l.mark).toBe('expedite');
        expect(l.booked!.end + l.carry_ms, `seed ${seed} ${id}`).toBeLessThanOrEqual(before[id]!);
        checked++;
      }
      for (const sid of ['S1', 'S2']) expect(r.stations[sid]!.profile).toEqual(bookedProfile(r, sid));
      expect(buildEngineState(log)).toEqual(r);
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('[03a task 13] a hidden expedite line that is a batch load member keeps its load (the load is the unit of placement)', () => {
    let s = fryer({ capacity: 4 });
    ({ state: s } = submitB(s, 'O1', [{ id: 'A', cook: 30 * M }, { id: 'B', cook: 5 * M }], BT));
    const before = s.lines.B!;
    expect(before.fire_ms! > BT + 4 * M).toBe(true);
    const load = loadOf(s, 'B')!;
    const r = fold(s, [stamp({ ...anItemStarted(), event_type: 'ItemsReleased', stream_id: 'O1', payload: { order_id: 'O1', alert_id: null, released: [], expedite: ['B'] } }, BT + 2 * M)]);
    expect(r.lines.B).toMatchObject({ serve_mode: 'immediate', mark: 'expedite', fire_ms: before.fire_ms, load_id: load.load_id, booked: null });
    expect(r.stations.F).toBe(s.stations.F);
  });

  it('[03a AD-14] a hidden expedite line on a FIFO station keeps its placement (no re-plan of placed lines); it is still immediate, mark expedite', () => {
    let s = kitchen([{ station_id: 'S1', capacity: 2 }, { station_id: 'S2', capacity: 1, policy: 'fifo' }]);
    s = submit(s, 'O0', [{ id: 'X', station: 'S2', cook: 10 * M }], at(0), 'dine_in:T7');
    s = submit(s, 'O1', [{ id: 'B', station: 'S2', cook: 6 * M }, { id: 'C', cook: 30 * M }], at(0));
    expect(s.lines.B!.fire_ms).toBe(at(10)); // queued behind X, hidden at 12:01
    const r = fold(s, [releasedEv('O1', [], ['B'], at(1))]);
    expect(r.lines.B).toMatchObject({ serve_mode: 'immediate', mark: 'expedite', group_id: 'O1:1', fire_ms: at(10), booked: s.lines.B!.booked });
    expect(r.orders.O1!.groups['O1:1']).toEqual({ target_land_ms: s.orders.O1!.groups['O1:0']!.target_land_ms, line_ids: ['B'] });
    expect(r.stations).toBe(s.stations);
  });

  it('[03a AD-12] the group whose membership changed gets its queued deadlines again at the same T', () => {
    // S1 capacity 1: C (10 min), E (5 min), A (3 min) queue back to back, longest first, to land at T = 12:40 (F on S2
    // sets it): A [37, 40), E [32, 37), C [22, 32). A is done early and released: E [35, 40), C [25, 35) now.
    let s = kitchen([{ station_id: 'S1', capacity: 1 }, { station_id: 'S2', capacity: 1 }]);
    s = submit(
      s,
      'O1',
      [
        { id: 'C', cook: 10 * M },
        { id: 'A', cook: 3 * M },
        { id: 'E', cook: 5 * M },
        { id: 'F', station: 'S2', cook: 40 * M },
      ],
      at(0),
    );
    expect(s.orders.O1!.groups['O1:0']!.target_land_ms).toBe(at(40));
    expect([s.lines.C!.deadline_ms, s.lines.A!.deadline_ms, s.lines.E!.deadline_ms]).toEqual([at(22), at(37), at(32)]);
    s = fold(s, [doneEv('O1', 'A', at(1))]);
    expect(s.lines.C!.deadline_ms).toBe(at(22)); // a Done changes no group
    const r = fold(s, [releasedEv('O1', ['A'], [], at(2))]);
    expect(r.orders.O1!.groups['O1:0']).toEqual({ target_land_ms: at(40), line_ids: ['C', 'E', 'F'] });
    expect(r.lines.C!.deadline_ms).toBe(at(25));
    expect(r.lines.E!.deadline_ms).toBe(at(35));
    expect(r.lines.A!.deadline_ms).toBe(s.lines.A!.deadline_ms);
    expect(r.lines.F!.deadline_ms).toBe(s.lines.F!.deadline_ms);
    // No hidden line was expedited: nothing is re-placed (the placements and profiles are kept).
    expect(r.lines.C!.fire_ms).toBe(s.lines.C!.fire_ms);
    expect(r.stations).toBe(s.stations);
  });

  it('[03a §3.8] a group every line of which leaves is removed; the order\'s slip resolves (no sync line left)', () => {
    const s = scene();
    const r = fold(s, [releasedEv('O1', ['A'], ['B', 'C'], at(2))]);
    const o = r.orders.O1!;
    expect(Object.keys(o.groups).sort()).toEqual(['O1:1', 'O1:2', 'O1:3']);
    expect(r.lines.C).toMatchObject({ serve_mode: 'immediate', mark: 'expedite', group_id: 'O1:3', fire_ms: at(0) }); // frozen: kept (D15)
    expect(o.groups['O1:3']!.target_land_ms).toBe(at(30));
    expect(r.slip_due).toEqual({});
  });

  it('[03a §3.3] absent order → state itself; absent ids and lines no longer sync are skipped; a line of another order is a writer bug (AD-8)', () => {
    const s = scene();
    const absent = releasedEv('O9', ['A'], [], at(2));
    expect(Object.is(applyEvent(s, absent), s)).toBe(true);
    // An absent id is skipped; the clock is refreshed (§3.3 last_line_fold_at).
    const r = fold(s, [releasedEv('O1', ['ZZ'], [], at(2))]);
    expect(r.lines).toBe(s.lines);
    expect(r.orders.O1!.last_line_fold_at).toBe(at(2));
    // A line of another order.
    const t = submit(s, 'O2', [{ id: 'X', cook: 5 * M }], at(1), 'dine_in:T7');
    const bad = releasedEv('O1', ['X'], [], at(2));
    expect(() => applyEvent(t, bad)).toThrow(/line_not_in_order/);
    const ns = applyEvent(t, bad, { strict: false });
    expect(ns.lines).toBe(t.lines);
    expect(ns.diagnostics.map((d) => d.detail.reason)).toEqual(['line_not_in_order']);
  });

  it('[03a §3.8a] a return line listed in expedite keeps its mark \'return\' and its group (it is immediate, never sync)', () => {
    const log: PosEvent[] = [];
    let s = kitchen([{ station_id: 'S1', capacity: 2 }], log);
    s = submit(s, 'O1', [{ id: 'L1', cook: 5 * M }], at(0), undefined, log);
    s = fold(s, [doneEv('O1', 'L1', at(5)), servedEv('O1', ['L1'], at(6))]);
    const added = log.find((e) => e.event_type === 'ItemAdded')!;
    s = fold(s, aReturnLinesAdded(added, 'fix', { recorded_at: at(7) }).map((e) => stamp(e, at(7))));
    const rid = 'L1R';
    expect(s.lines[rid]!.mark).toBe('return');
    const r = fold(s, [releasedEv('O1', [], [rid], at(8))]);
    expect(r.lines[rid]).toBe(s.lines[rid]);
    expect(weightOf(r, r.lines[rid]!)).toBe(100 * BASE.settings.weight_follow_up_pct / 100);
  });

  it('[03a #81 split] a split takes next_group_index; snapshot + replay = full replay', () => {
    const log: PosEvent[] = [];
    scene(log);
    const tail = [releasedEv('O1', ['A'], ['B'], at(2)), fireEv('S2', ['B'], at(2)), doneEv('O1', 'B', at(8)), releasedEv('O1', ['B'], [], at(9))];
    const full = buildEngineState([...log, ...tail]);
    expect(Object.keys(full.orders.O1!.groups).sort()).toEqual(['O1:0', 'O1:1', 'O1:2']);
    expect(full.orders.O1!.next_group_index).toBe(3);
    for (let k = 0; k <= tail.length; k++) {
      const snap = JSON.parse(JSON.stringify(buildEngineState([...log, ...tail.slice(0, k)]))) as EngineState;
      let resumed = snap;
      for (const e of tail.slice(k)) resumed = applyEvent(resumed, e);
      expect(resumed).toEqual(full);
    }
  });

  it('[03a §3.8] a removed order\'s slip_due entry and resolved slip go (the alert is still closed done first)', () => {
    let s = kitchen([{ station_id: 'S1', capacity: 1 }]);
    s = submit(s, 'O1', [{ id: 'A', cook: 10 * M }], at(0));
    const f = s.lines.A!.fire_ms!;
    s = fold(s, [fireEv('S1', ['A'], f)]);
    const c = s.next_alert_due_at!;
    s = fold(s, [slipWarnedEv(getAlertIntents(s, c).slips[0]!, 'AL1', c)]);
    s = fold(s, [doneEv('O1', 'A', c + 1), servedEv('O1', ['A'], c + 2)]);
    expect(s.slips['dine_in:T12']!.resolved_at).toBe(c + 1);
    expect(s.slip_due).toEqual({ 'dine_in:T12': c + 1 });
    // The order exits 30 min after its serve; the slip stays until its alert closes, then nothing is left.
    s = fold(s, [alertClosedEv('AL1', c + 3 + 1_800_000)]);
    expect(s.orders.O1).toBeUndefined();
    expect(s.slips).toEqual({});
    expect(s.slip_due).toEqual({});
    expect(s.next_alert_due_at).toBeNull();
  });
});

describe('03a §3.8 [03a #77 engine] slip close folds (built by task 15; regression lock)', () => {
  it('[03a #77 engine] SlipWarned.alert_id stored; its AlertClosed sets alert_id = null; another alert\'s AlertClosed → same state; an Undo that un-resolves clears resolved_at', () => {
    let s = kitchen([{ station_id: 'S1', capacity: 1 }]);
    s = submit(s, 'O1', [{ id: 'A', cook: 10 * M }], at(0));
    s = fold(s, [fireEv('S1', ['A'], s.lines.A!.fire_ms!)]);
    const c = s.next_alert_due_at!;
    const item = getAlertIntents(s, c).slips[0]!;
    s = fold(s, [slipWarnedEv(item, 'AL1', c)]);
    expect(s.slips['dine_in:T12']).toEqual({ order_ids: ['O1'], last_estimate: item.estimate, alert_id: 'AL1', resolved_at: null });
    // Another alert's close: state itself.
    const other = alertClosedEv('AL2', c + 1);
    expect(Object.is(applyEvent(s, deepFreeze(other)), s)).toBe(true);
    // Resolution sets resolved_at; an Undo that un-resolves clears it (the alert stays open).
    const d = fold(s, [doneEv('O1', 'A', c + 2)]);
    expect(d.slips['dine_in:T12']!.resolved_at).toBe(c + 2);
    const u = fold(d, [undoEv('O1', 'A', c + 3)]);
    expect(u.slips['dine_in:T12']).toMatchObject({ alert_id: 'AL1', resolved_at: null });
    // Its own close (unresolved): alert_id = null, the record kept for the re-raise gate.
    const closed = fold(u, [alertClosedEv('AL1', c + 4)]);
    expect(closed.slips['dine_in:T12']).toEqual({ order_ids: ['O1'], last_estimate: item.estimate, alert_id: null, resolved_at: null });
  });
});

describe('03a §6.1m goesWith / planRelease (D12)', () => {
  const karahi = { item_id: 'karahi', category_id: 'curries' };
  const salan = { item_id: 'salan', category_id: 'curries' };
  const roti = { item_id: 'roti', category_id: 'breads' };
  const naan = { item_id: 'naan', category_id: 'breads' };
  const raita = { item_id: 'raita', category_id: 'sides' };
  const link = (l: Partial<GoesWithLink> & Pick<GoesWithLink, 'source_kind' | 'source_id' | 'target_kind' | 'target_id'>): GoesWithLink => ({ excluded: false, ...l });

  it('[03a #38] category default, item add, item exclude; nothing configured → nothing pre-ticked', () => {
    const links = deepFreeze([
      link({ source_kind: 'category', source_id: 'curries', target_kind: 'category', target_id: 'breads' }),
      link({ source_kind: 'item', source_id: 'karahi', target_kind: 'item', target_id: 'raita' }),
      link({ source_kind: 'item', source_id: 'salan', target_kind: 'item', target_id: 'naan', excluded: true }),
    ]);
    // Category default: every curry goes with every bread.
    expect(goesWith(karahi, roti, links)).toBe(true);
    expect(goesWith(karahi, naan, links)).toBe(true);
    expect(goesWith(salan, roti, links)).toBe(true);
    // Item add.
    expect(goesWith(karahi, raita, links)).toBe(true);
    expect(goesWith(salan, raita, links)).toBe(false);
    // Item exclude removes the category default for that item only.
    expect(goesWith(salan, naan, links)).toBe(false);
    expect(goesWith(karahi, naan, links)).toBe(true);
    // Direction: a link goes from what is released to what is pre-ticked.
    expect(goesWith(roti, karahi, links)).toBe(false);
    // Nothing configured.
    expect(goesWith(karahi, roti, [])).toBe(false);
    // An item exclude of a whole category; an item add inside an excluded category wins (more specific target).
    const more = deepFreeze([
      link({ source_kind: 'category', source_id: 'curries', target_kind: 'category', target_id: 'breads' }),
      link({ source_kind: 'item', source_id: 'salan', target_kind: 'category', target_id: 'breads', excluded: true }),
      link({ source_kind: 'item', source_id: 'salan', target_kind: 'item', target_id: 'roti' }),
    ]);
    expect(goesWith(salan, naan, more)).toBe(false);
    expect(goesWith(salan, roti, more)).toBe(true);
    // A line with no item id matches only category targets.
    expect(goesWith(karahi, { item_id: null, category_id: 'breads' }, links)).toBe(true);
    expect(goesWith({ item_id: null, category_id: 'sides' }, roti, links)).toBe(false);
  });

  it('[03a §6.1m] planRelease: released = the done sync lines, expedite = the ticks (none → none); one draft per order with work', () => {
    const s = scene();
    const [draft, ...rest] = planRelease(s, ['O1', 'O9']);
    expect(rest).toEqual([]);
    expect(draft).toEqual({
      stream_type: 'order',
      stream_id: 'O1',
      event_type: 'ItemsReleased',
      schema_version: 1,
      payload: { order_id: 'O1', alert_id: null, released: ['A'], expedite: [] },
    });
    // Ticks: only open sync lines of the order; a tick that names a done line is not an expedite.
    expect(planRelease(s, ['O1'], { expedite: ['B', 'A', 'ZZ'] })[0]!.payload).toEqual({ order_id: 'O1', alert_id: null, released: ['A'], expedite: ['B'] });
    expect(planRelease(s, ['O1'], { released: [], expedite: ['C'] })[0]!.payload).toEqual({ order_id: 'O1', alert_id: null, released: [], expedite: ['C'] });
    // Nothing to send.
    expect(planRelease(s, ['O1'], { released: [] })).toEqual([]);
    // After the release nothing is left to release again.
    const r = fold(s, [releasedEv('O1', ['A'], [], at(2))]);
    expect(planRelease(r, ['O1'])).toEqual([]);
    // Every line done (test 72's engine half): released only.
    const all = fold(s, [doneEv('O1', 'B', at(3)), doneEv('O1', 'C', at(4))]);
    expect(planRelease(all, ['O1'])[0]!.payload).toEqual({ order_id: 'O1', alert_id: null, released: ['A', 'B', 'C'], expedite: [] });
  });

  it('[03a §6.1m] planRelease carries the open slip alert of the order\'s table key; its fold lands as planned', () => {
    let s = kitchen([{ station_id: 'S1', capacity: 1 }, { station_id: 'S2', capacity: 1 }]);
    s = submit(s, 'O1', [{ id: 'A', cook: 2 * M }, { id: 'B', station: 'S2', cook: 10 * M }], at(0));
    s = fold(s, [fireEv('S2', ['B'], s.lines.B!.fire_ms!), doneEv('O1', 'A', at(1))]);
    const c = s.next_alert_due_at!;
    s = fold(s, [slipWarnedEv(getAlertIntents(s, c).slips[0]!, 'AL1', c)]);
    const drafts = planRelease(s, ['O1']);
    expect(drafts.map((d) => d.payload)).toEqual([{ order_id: 'O1', alert_id: 'AL1', released: ['A'], expedite: [] }]);
    const r = fold(s, [stamp({ ...anItemStarted(), ...drafts[0]! }, c + 1)]);
    expect(r.lines.A!.serve_mode).toBe('immediate');
    expect(r.slips['dine_in:T12']!.alert_id).toBe('AL1'); // the alert is closed by its own AlertClosed
    expect(TH).toBe(BASE.settings.slip_threshold_ms);
  });
});
