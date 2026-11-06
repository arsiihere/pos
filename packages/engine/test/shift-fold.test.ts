// F §4.7 D42 applyEvent(ReservationsShifted) (task 14b): each shifted unfired reservation's interval moves by by_ms
// (a slot line's booked and fire_ms; a batch load's booked and fire_ms with its members' fire_ms), removed exactly
// (AD-7) and re-added (AD-6 on the removal), `unfired` re-sorted; deadline_ms and the group T stay (D6, D23: lateness
// shows as a slip); no re-plan (D13). "Bounded shift volume": the fold makes the overrun cascade idempotent per
// pass, so live = replay. Pure: every input is deep-frozen.
import { parseEvent, type EngineConfig, type ItemAddedPayload, type PosEvent } from '@pos/events';
import { aFireDispatched, anEngineConfigApplied, anItemAdded, anItemDone, anItemStarted, anOrderBatch, aStockSet } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import { applyEvent, buildEngineState, getTickIntents, initialEngineState, planOrder, type EngineState, type ProposedOrder, type TickDraft } from '../src/index';
import { addInterval, removeInterval } from '../src/profile';
import { fryer, loadOf, submitB } from './batch-kit';

const T0 = 1_761_000_000_000;
const S = 1_000;
const M = 60_000;

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
  return { ...e, recorded_at: t, occurred_at: t, seq: s, event_id: `01H${String(s).padStart(23, '0')}` };
};

function configEvent(stations: Array<Partial<StationCfg> & { station_id: string }>, settings: Partial<Settings> = {}): PosEvent {
  const list = [...stations].sort((a, b) => (a.station_id < b.station_id ? -1 : 1)).map((s) => ({ ...BASE.stations[0]!, name: s.station_id, ...s }));
  return stamp(anEngineConfigApplied({ payload: { stations: list, settings: { ...BASE.settings, ...settings } } }), T0 - 3_600_000);
}

function fold(state: EngineState, events: PosEvent[], opts?: { strict?: boolean }): EngineState {
  let s = deepFreeze(state);
  for (const e of events) s = deepFreeze(applyEvent(s, deepFreeze(e), opts));
  return s;
}

type Item = { id: string; station?: string; program?: string; cook: number; prep?: number; mode?: 'sync' | 'immediate' };

function itemFields(i: Item): Record<string, unknown> {
  return {
    ...(i.program === undefined ? {} : { program_id: i.program, program_cook_time_ms: i.cook }),
    station_id: i.station ?? 'S1',
    cook_time_ms: i.cook,
    prep_buffer_ms: i.prep ?? 0,
    serve_mode: i.mode ?? 'immediate',
    quantity: 1,
    stock_time_ms: null,
    stock_draws: [],
    out_of_stock_behaviour: 'cook_fresh',
  };
}

function proposed(order_id: string, items: Item[]): ProposedOrder {
  const base = anItemAdded().payload as unknown as ItemAddedPayload;
  return deepFreeze({
    order_id,
    order: { order_type: 'dine_in', table_id: 'T12', table_key: 'dine_in:T12', follow_up: false, pickup_at_ms: null },
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

// planOrder at now, then the §4.2 batch 02 appends at recorded_at = now.
function submitEvents(state: EngineState, order_id: string, items: Item[], now: number): PosEvent[] {
  const plan = planOrder(state, proposed(order_id, items), now, {});
  return anOrderBatch({
    order_id,
    recorded_at: now,
    seq: nextSeq(items.length + 1),
    lines: items.map((i) => ({ order_item_id: i.id, item: itemFields(i), line: { station_id: plan.lines.find((l) => l.order_item_id === i.id)!.station_id } })),
    order: { groups: plan.groups },
  }).map((e, k) => ({ ...e, event_id: `01G${String(seq + k).padStart(23, '0')}` }));
}

function asEvents(drafts: readonly TickDraft[], now: number): PosEvent[] {
  return drafts.map((d) => {
    const s = nextSeq();
    return {
      ...d,
      payload: d.payload as unknown as Record<string, unknown>,
      event_id: `01K${String(s).padStart(23, '0')}`,
      tenant_id: 't',
      branch_id: 'b',
      occurred_at: now,
      recorded_at: now,
      actor_id: null,
      device_id: 'hub',
      seq: s,
    };
  });
}

const start = (order_id: string, id: string, t: number): PosEvent => stamp(anItemStarted({ stream_id: order_id, payload: { order_item_id: id, started_at: t, source: 'tap' } }), t);
const done = (order_id: string, id: string, t: number): PosEvent => stamp(anItemDone({ stream_id: order_id, payload: { order_item_id: id, done_at: t, source: 'tap' } }), t);
const fireEv = (station_id: string, ids: string[], t: number): PosEvent =>
  stamp(aFireDispatched({ stream_id: station_id, payload: { station_id, order_item_ids: ids, load_id: null, due_at: t, reason: 'scheduled' } }), t);
// No builder in @pos/events/testing: the §4.2 payload on a FireDispatched envelope (station stream).
function shiftEv(station_id: string, shifts: Array<{ order_item_id: string; by_ms: number }>, t: number, cause: 'overrun' | 'late_start' = 'overrun'): PosEvent {
  return stamp({ ...aFireDispatched({ stream_id: station_id }), event_type: 'ReservationsShifted', payload: { station_id, cause, shifts } }, t);
}

// The F §4.7 test 12 kitchen in ms: capacity-1 slot X (and Y), cascade_step_ms 5. A (O1) COOKING [T, T + 20); B (O2,
// sync) [T + 20, T + 30) with B2 on Y; C (O3, sync) [T + 30, T + 40). Nothing fired but A.
function f12(): EngineState {
  let s = fold(initialEngineState(), [configEvent([{ station_id: 'X', capacity: 1 }, { station_id: 'Y', capacity: 1 }], { cascade_step_ms: 5 })]);
  s = fold(s, submitEvents(s, 'O1', [{ id: 'A', station: 'X', cook: 20 }], T0));
  s = fold(s, [fireEv('X', ['A'], T0), start('O1', 'A', T0)]);
  s = fold(s, submitEvents(s, 'O2', [{ id: 'B', station: 'X', cook: 10, mode: 'sync' }, { id: 'B2', station: 'Y', cook: 10, mode: 'sync' }], T0));
  s = fold(s, submitEvents(s, 'O3', [{ id: 'C', station: 'X', cook: 10, mode: 'sync' }], T0));
  expect(s.lines.B!.booked).toEqual({ start: T0 + 20, end: T0 + 30, units: 1 });
  expect(s.lines.C!.booked).toEqual({ start: T0 + 30, end: T0 + 40, units: 1 });
  expect(s.stations.X!.unfired).toEqual(['B', 'C']);
  return s;
}

describe('@pos/engine ReservationsShifted fold (F §4.7 D42)', () => {
  it('[03a F D42] a slot line: booked and fire_ms += by_ms, exactly the old booking removed and the new added, unfired re-sorted; deadline, T, the clock and the other lines unchanged; no re-plan', () => {
    const s = f12();
    const B = s.lines.B!;
    const after = fold(s, [shiftEv('X', [{ order_item_id: 'B', by_ms: 15 }], T0 + 1)]);
    expect(after.lines.B).toEqual({ ...B, booked: { start: T0 + 35, end: T0 + 45, units: 1 }, fire_ms: B.fire_ms! + 15 });
    expect(after.lines.B!.deadline_ms).toBe(B.deadline_ms);
    expect(after.stations.X!.profile).toEqual(addInterval(removeInterval(s.stations.X!.profile, B.booked!, 1), { start: T0 + 35, end: T0 + 45 }, 1));
    // B now fires after C: re-sorted by (fire, id). C is not re-placed although B overlaps it (no re-plan, D13).
    expect(after.stations.X!.unfired).toEqual(['C', 'B']);
    expect(after.lines.C).toBe(s.lines.C);
    expect(after.lines.B2).toBe(s.lines.B2);
    expect(after.stations.Y).toBe(s.stations.Y);
    // The group T, the order and its clock: a shift never refreshes last_line_fold_at (§3.3).
    expect(after.orders.O2).toBe(s.orders.O2);
    expect(after.lines.B!.stage).toBe('added');
    expect(after.lines.B!.fired_at).toBeNull();
  });

  it('[03a F D42] cause late_start folds the same way as overrun', () => {
    const s = f12();
    const overrun = fold(s, [shiftEv('X', [{ order_item_id: 'C', by_ms: 5 }], T0 + 1)]);
    const late = fold(s, [shiftEv('X', [{ order_item_id: 'C', by_ms: 5 }], T0 + 1, 'late_start')]);
    expect(late).toEqual(overrun);
    expect(late.lines.C!.booked).toEqual({ start: T0 + 35, end: T0 + 45, units: 1 });
  });

  it('[03a F D42] several shifts of one station in one event: each moves by its own by_ms, unfired re-sorted once', () => {
    const s = f12();
    const after = fold(s, [shiftEv('X', [{ order_item_id: 'B', by_ms: 5 }, { order_item_id: 'C', by_ms: 10 }], T0 + 1)]);
    expect(after.lines.B!.booked).toEqual({ start: T0 + 25, end: T0 + 35, units: 1 });
    expect(after.lines.C!.booked).toEqual({ start: T0 + 40, end: T0 + 50, units: 1 });
    expect(after.lines.C!.fire_ms).toBe(s.lines.C!.fire_ms! + 10);
    expect(after.stations.X!.unfired).toEqual(['B', 'C']);
  });

  it('[03a F D42] a batch load moves whole: its booked and fire_ms, every member fire_ms; the profile moved once; members keep booked null', () => {
    let s = submitB(fryer(), 'O1', [{ id: 'F1', cook: 3 * M }], T0 + 10 * M).state;
    s = submitB(s, 'O2', [{ id: 'F2', cook: 3 * M }], T0 + 10 * M).state;
    const load = loadOf(s, 'F1')!;
    expect(load.order_item_ids).toEqual(['F1', 'F2']);
    const by = 2 * M;
    const both = fold(s, [shiftEv('F', [{ order_item_id: 'F1', by_ms: by }, { order_item_id: 'F2', by_ms: by }], T0 + 10 * M)]);
    const moved = both.stations.F!.loads[load.load_id]!;
    expect(moved).toEqual({ ...load, fire_ms: load.fire_ms + by, booked: { ...load.booked, start: load.booked.start + by, end: load.booked.end + by } });
    for (const id of ['F1', 'F2']) {
      expect(both.lines[id]!.fire_ms).toBe(s.lines[id]!.fire_ms! + by);
      expect(both.lines[id]!.booked).toBeNull();
      expect(both.lines[id]!.deadline_ms).toBe(s.lines[id]!.deadline_ms);
    }
    expect(both.stations.F!.profile).toEqual(
      addInterval(removeInterval(s.stations.F!.profile, load.booked, load.booked.units), { start: load.booked.start + by, end: load.booked.end + by }, load.booked.units),
    );
    // One listed member moves the whole load ("a load's members follow").
    expect(fold(s, [shiftEv('F', [{ order_item_id: 'F2', by_ms: by }], T0 + 10 * M)])).toEqual(both);
    // Members listed with different by_ms split the load: a writer bug (AD-8) — strict throws; non-strict the load
    // moves by its first listed member's by_ms and one invalid_event diagnostic names the other.
    const split = shiftEv('F', [{ order_item_id: 'F1', by_ms: by }, { order_item_id: 'F2', by_ms: by + 1 }], T0 + 10 * M);
    expect(() => applyEvent(s, split)).toThrow(/load_split/);
    const lax = applyEvent(s, split, { strict: false });
    expect(lax.stations.F!.loads[load.load_id]).toEqual(moved);
    expect(lax.diagnostics.map((d) => [d.kind, d.detail.reason, d.detail.order_item_id])).toEqual([['invalid_event', 'load_split', 'F2']]);
  });

  it('[03a F D42] absent ids and in-flight / ended lines are a no-op (state itself); an unfired line on another station is an AD-8 writer bug', () => {
    const s = f12();
    // Absent line, absent station, by_ms 0: state itself.
    expect(applyEvent(s, shiftEv('X', [{ order_item_id: 'NOPE', by_ms: 5 }], T0 + 1))).toBe(s);
    expect(applyEvent(s, shiftEv('Z', [{ order_item_id: 'B', by_ms: 5 }], T0 + 1))).toBe(s);
    expect(applyEvent(s, shiftEv('X', [{ order_item_id: 'B', by_ms: 0 }], T0 + 1))).toBe(s);
    // COOKING (A), fired not started (B after its fire), done: they move by the packing (F-20), never by a shift.
    expect(applyEvent(s, shiftEv('X', [{ order_item_id: 'A', by_ms: 5 }], T0 + 1))).toBe(s);
    const fired = fold(s, [fireEv('X', ['B'], T0 + 20)]);
    expect(applyEvent(fired, shiftEv('X', [{ order_item_id: 'B', by_ms: 5 }], T0 + 21))).toBe(fired);
    const ended = fold(s, [done('O1', 'A', T0 + 20)]);
    expect(applyEvent(ended, shiftEv('X', [{ order_item_id: 'A', by_ms: 5 }], T0 + 21))).toBe(ended);
    // B2 is unfired on Y: a shift on X naming it is a writer bug.
    const wrong = shiftEv('X', [{ order_item_id: 'B2', by_ms: 5 }, { order_item_id: 'C', by_ms: 5 }], T0 + 1);
    expect(() => applyEvent(s, wrong)).toThrow(/station_mismatch/);
    const lax = applyEvent(s, wrong, { strict: false });
    expect(lax.lines.B2).toBe(s.lines.B2);
    expect(lax.lines.C!.booked).toEqual({ start: T0 + 35, end: T0 + 45, units: 1 });
    expect(lax.diagnostics.map((d) => [d.kind, d.detail.reason, d.detail.order_item_id])).toEqual([['invalid_event', 'station_mismatch', 'B2']]);
  });

  it('[03a AD-6] the shift removes exactly booked: an underflow throws when strict and is a profile_underflow diagnostic when not', () => {
    const s = f12();
    const broken = deepFreeze({ ...s, stations: { ...s.stations, X: { ...s.stations.X!, profile: { t: [], u: [] } } } });
    const ev = shiftEv('X', [{ order_item_id: 'C', by_ms: 5 }], T0 + 1);
    expect(() => applyEvent(broken, ev)).toThrow();
    const lax = applyEvent(broken, ev, { strict: false });
    expect(lax.lines.C!.booked).toEqual({ start: T0 + 35, end: T0 + 45, units: 1 });
    expect(lax.diagnostics.map((d) => [d.kind, d.station_id, d.detail.order_item_id])).toEqual([['profile_underflow', 'X', 'C']]);
  });
});

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

describe('@pos/engine ReservationsShifted property (F §4.7 "Bounded shift volume")', () => {
  it('[03a F D42] over 50 overrun seeds: a pass folded, the same now gives no new shift; every shift moves exactly by by_ms; live = replay', () => {
    let shiftsSeen = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const rnd = prng(seed);
      const cfg = configEvent(
        [
          { station_id: 'S1', capacity: 1 + Math.floor(rnd() * 2), completion_mode: 'two_tap' },
          { station_id: 'S2', capacity: 1, completion_mode: 'two_tap', policy: rnd() < 0.5 ? 'edf' : 'fifo' },
          {
            station_id: 'F',
            station_type: 'batch',
            capacity: 2,
            freshness_window_ms: 30_000,
            completion_mode: 'two_tap',
            programs: [{ program_id: 'P1', name: 'Fry', cook_time_ms: 999_999, is_archived: false }],
          },
        ],
        { cascade_step_ms: 30_000 },
      );
      const log: PosEvent[] = [cfg, stamp(aStockSet(), T0 - 60 * M)];
      let s = fold(initialEngineState(), log);
      const append = (events: PosEvent[]): void => {
        for (const e of events) {
          s = deepFreeze(applyEvent(s, deepFreeze(e), { strict: false }));
          log.push(e);
        }
      };
      let t = T0;
      let n = 0;
      for (let step = 0; step < 60; step++) {
        t += Math.floor(5 * S + rnd() * 60 * S);
        const r = rnd();
        if (r < 0.3) {
          n++;
          const items: Item[] = Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, j) =>
            rnd() < 0.2
              ? { id: `L${n}_${j}`, station: 'F', program: 'P1', cook: 3 * M, mode: 'sync' }
              : { id: `L${n}_${j}`, station: rnd() < 0.6 ? 'S1' : 'S2', cook: Math.floor(1 * M + rnd() * 5 * M), mode: rnd() < 0.6 ? 'sync' : 'immediate' },
          );
          append(submitEvents(s, `O${n}`, items, t));
        } else if (r < 0.75) {
          // Starts are frequent and Dones rare, so COOKING lines overrun and the cascade shifts.
          const fired = Object.values(s.lines).filter((l) => l.stage === 'added' && l.fired_at !== null);
          if (fired.length > 0) {
            const l = fired[Math.floor(rnd() * fired.length)]!;
            append([start(l.order_id, l.order_item_id, t)]);
          }
        } else if (r < 0.82) {
          const cooking = Object.values(s.lines).filter((l) => l.stage === 'cooking');
          if (cooking.length > 0) {
            const l = cooking[Math.floor(rnd() * cooking.length)]!;
            append([done(l.order_id, l.order_item_id, t)]);
          }
        }
        const label = `seed ${seed} step ${step} t ${t - T0}`;
        const before = s;
        const drafts = getTickIntents(s, t);
        append(asEvents(drafts, t));
        for (const d of drafts) {
          if (d.event_type !== 'ReservationsShifted') continue;
          const p = d.payload as { station_id: string; shifts: Array<{ order_item_id: string; by_ms: number }> };
          for (const { order_item_id: id, by_ms } of p.shifts) {
            shiftsSeen++;
            const was = before.lines[id]!;
            const now = s.lines[id]!;
            if (was.booked !== null) expect(now.booked, `${label} ${id}`).toEqual({ ...was.booked, start: was.booked.start + by_ms, end: was.booked.end + by_ms });
            expect(now.fire_ms, `${label} ${id} fire`).toBe(was.fire_ms! + by_ms);
            expect(now.deadline_ms, `${label} ${id} deadline`).toBe(was.deadline_ms);
          }
        }
        // Idempotent per pass (test 62 boundary clause): the same now yields no new shift.
        expect(getTickIntents(s, t).filter((d) => d.event_type === 'ReservationsShifted'), label).toEqual([]);
      }
      expect(buildEngineState(log, { strict: false }), `seed ${seed} live = replay`).toEqual(s);
    }
    expect(shiftsSeen).toBeGreaterThan(50);
  }, 60_000);
});
