// 03a §3.5.3 re-plan (fixed set, pivot, pass 1 with keep then without, late set → stub), §3.5.1 "one sequence"
// (pass 1 → immediate → sync, planOrder = the fold), §3.4 hidden / frozen at recorded_at, D13 triggers (one
// re-plan per station per batch; ItemRemoved / ItemVoided T' = min(T, loop), promise never moves), D25 prune.
import { parseEvent, type EngineConfig, type ItemAddedPayload, type PosEvent } from '@pos/events';
import { aFireDispatched, anEngineConfigApplied, anItemAdded, anItemStarted, anOrderBatch } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import {
  applyEvent,
  buildEngineState,
  initialEngineState,
  planOrder,
  type EngineState,
  type PlanResult,
  type ProposedOrder,
} from '../src/index';
import { liveProfile } from '../src/live';
import { planOrderWith } from '../src/plan';
import { placeLateSet } from '../src/replan';

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
type StationCfg = EngineConfig['stations'][number];

// Slot stations with the config defaults (freeze 2 min, keep 1 min, padding 3 min) unless overridden.
function kitchen(stations: Array<Partial<StationCfg>>): EngineState {
  const cfg = anEngineConfigApplied({
    recorded_at: T0 - 3_600_000,
    payload: { stations: stations.map((s) => ({ ...S1, ...s })) },
  });
  return deepFreeze(applyEvent(initialEngineState(), deepFreeze(cfg)));
}

type Opts = { strict?: boolean; prune?: boolean };
function fold(state: EngineState, events: PosEvent[], opts?: Opts): EngineState {
  let s = deepFreeze(state);
  for (const e of events) s = deepFreeze(applyEvent(s, deepFreeze(e), opts));
  return s;
}

// A line of an order: station, serve mode (default sync), cook / prep in minutes, units, carry in minutes.
// early = max_early_ms in minutes (default 1, the config default).
type Item = { id: string; st?: string; cook: number; prep?: number; mode?: 'sync' | 'immediate'; units?: number; carry?: number; early?: number };
type OrderOver = { pickup_at_ms?: number | null; order_type?: 'dine_in' | 'takeaway' | 'delivery' | 'parking' };

let seq = 100;
const nextSeq = (n: number): number => {
  const s = seq;
  seq += n + 1;
  return s;
};

function proposed(order_id: string, items: Item[], o: OrderOver = {}): ProposedOrder {
  const base = anItemAdded().payload as unknown as ItemAddedPayload;
  return deepFreeze({
    order_id,
    order: {
      order_type: o.order_type ?? 'dine_in',
      table_id: 'T12',
      table_key: 'dine_in:T12',
      follow_up: false,
      pickup_at_ms: o.pickup_at_ms ?? null,
    },
    lines: items.map((i) => ({
      ...base,
      order_id,
      order_item_id: i.id,
      station_id: i.st ?? 'S1',
      cook_time_ms: i.cook * M,
      prep_buffer_ms: (i.prep ?? 0) * M,
      serve_mode: i.mode ?? 'sync',
      quantity: i.units ?? 1,
      alternates: [],
      point_id: null,
      carry_ms: (i.carry ?? 0) * M,
      weight_pct: 100,
      max_early_ms: (i.early ?? 1) * M,
      max_late_ms: null,
      max_carry_ms: null,
      cook_ms_override: null,
      return_of: null,
    })),
  });
}

// The §4.2 batch 02 appends for `items` at recorded_at with the plan's groups (or explicit ones).
function batch(order_id: string, items: Item[], recorded_at: number, groups: PlanResult['groups'], o: OrderOver = {}): PosEvent[] {
  return anOrderBatch({
    order_id,
    recorded_at,
    seq: nextSeq(items.length),
    lines: items.map((i) => ({
      order_item_id: i.id,
      item: {
        station_id: i.st ?? 'S1',
        cook_time_ms: i.cook * M,
        prep_buffer_ms: (i.prep ?? 0) * M,
        serve_mode: i.mode ?? 'sync',
        quantity: i.units ?? 1,
      },
      line: { station_id: i.st ?? 'S1', carry_ms: (i.carry ?? 0) * M, max_early_ms: (i.early ?? 1) * M },
    })),
    order: { order_type: o.order_type ?? 'dine_in', pickup_at_ms: o.pickup_at_ms ?? null, groups },
  });
}

// planOrder at `now`, then the batch folded at `recorded_at` (default now). When recorded_at = now the fold must
// place every new line exactly where the plan said (§3.5.1 one sequence: planOrder = the fold).
function submit(
  state: EngineState,
  order_id: string,
  items: Item[],
  now: number,
  o: OrderOver = {},
  recorded_at = now,
  opts?: Opts,
): { plan: PlanResult; state: EngineState } {
  const p = proposed(order_id, items, o);
  const plan = opts?.prune === false ? planOrderWith(state, p, now, {}, { prune: false }) : planOrder(state, p, now, {});
  const s = fold(state, batch(order_id, items, recorded_at, plan.groups, o), opts);
  if (recorded_at === now) {
    for (const l of plan.lines) expect(s.lines[l.order_item_id]!.booked!.end + l.carry_ms).toBe(l.eta_ms);
  }
  return { plan, state: s };
}

function fire(ids: string[], recorded_at: number): PosEvent {
  return aFireDispatched({ recorded_at, occurred_at: recorded_at, seq: nextSeq(0), payload: { order_item_ids: ids, due_at: recorded_at, load_id: null, reason: 'scheduled' } });
}
function start(order_id: string, id: string, recorded_at: number): PosEvent {
  return anItemStarted({ stream_id: order_id, recorded_at, occurred_at: recorded_at, seq: nextSeq(0), payload: { order_item_id: id, started_at: recorded_at } });
}
function orderEvent(event_type: string, order_id: string, payload: Record<string, unknown>, recorded_at: number): PosEvent {
  const s = nextSeq(0);
  return { ...anItemStarted(), event_type, stream_id: order_id, payload, recorded_at, occurred_at: recorded_at, seq: s, event_id: `01JZ${String(s).padStart(22, '0')}` };
}

const fireOf = (s: EngineState, id: string): number => s.lines[id]!.fire_ms!;
const T = (plan: PlanResult, i = 0): number => plan.groups[i]!.target_land_ms;
const eta = (plan: PlanResult, id: string): number => plan.lines.find((l) => l.order_item_id === id)!.eta_ms;

// Max units in use on the live profile from `from` on.
function maxUnits(s: EngineState, station_id: string, t: number, from = t): number {
  const p = liveProfile(s, station_id, t);
  let m = 0;
  for (let i = 0; i < p.t.length; i++) if ((i + 1 === p.t.length ? Infinity : p.t[i + 1]!) > from) m = Math.max(m, p.u[i]!);
  return m;
}

// Seeded PRNG (mulberry32), local to this file; rnd(n) is uniform in 0 … n − 1 from the high bits.
function prng(seed0: number): (n: number) => number {
  let a = seed0 >>> 0;
  return (n: number) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return Math.floor((((x ^ (x >>> 14)) >>> 0) / 4_294_967_296) * n);
  };
}

describe('@pos/engine re-plan pass 1 (§3.5.3, §3.5.1 one sequence, §3.4 freeze)', () => {
  it('[03a #20] a newer order cannot push an older line past d − keep (D6); on EDF (keep 0) it may take up to d', () => {
    for (const policy of ['waada_guard', 'edf'] as const) {
      let s = kitchen([{ station_id: 'S1', capacity: 1, policy }]);
      // Older line A (cook 10) held for a pickup at 12:30: d(A) = 12:20, placed at its deadline.
      ({ state: s } = submit(s, 'OA', [{ id: 'A', cook: 10 }], at(0), { pickup_at_ms: at(30) }));
      expect(fireOf(s, 'A')).toBe(at(20));
      expect(s.lines.A!.deadline_ms).toBe(at(20));
      // A newer order N (cook 19) at 12:01 would end exactly at 12:20 if it were placed first.
      const r = submit(s, 'ON', [{ id: 'N', cook: 19 }], at(1));
      if (policy === 'waada_guard') {
        // Pass 1 runs first: A keeps its cushion (fire = d − keep), so N lands after A.
        expect(fireOf(r.state, 'A')).toBe(at(19));
        expect(fireOf(r.state, 'A')).toBeLessThanOrEqual(r.state.lines.A!.deadline_ms - 60_000);
        expect(T(r.plan)).toBe(at(48));
        expect(r.state.lines.N!.booked).toEqual({ start: at(29), end: at(48), units: 1 });
      } else {
        // EDF: keep 0, A stays on its deadline and N takes the window before it.
        expect(fireOf(r.state, 'A')).toBe(at(20));
        expect(T(r.plan)).toBe(at(20));
      }
      expect(maxUnits(r.state, 'S1', at(1))).toBeLessThanOrEqual(1);
    }
  });

  it('[03a #21] an older hidden line moves within its slack; frozen and fired lines do not move (D13, D15)', () => {
    let s = kitchen([{ station_id: 'S1', capacity: 1 }]);
    // F: fired at 12:00 (not started). Z: held for 12:06 → fire 12:03. H: held for 12:20 → fire 12:17.
    ({ state: s } = submit(s, 'OF', [{ id: 'F', cook: 2, mode: 'immediate' }], at(0)));
    s = fold(s, [fire(['F'], at(0))]);
    ({ state: s } = submit(s, 'OZ', [{ id: 'Z', cook: 3 }], at(0), { pickup_at_ms: at(6) }));
    expect(fireOf(s, 'Z')).toBe(at(3));
    ({ state: s } = submit(s, 'OH', [{ id: 'H', cook: 3 }], at(1), { pickup_at_ms: at(20) }));
    expect(fireOf(s, 'H')).toBe(at(17));
    const zBooked = s.lines.Z!.booked;
    const fBefore = s.lines.F!;
    // New order N at 12:01: Z (fire 12:03 ≤ 12:01 + freeze 2 min) is frozen; H (12:17) is hidden.
    const r = submit(s, 'ON', [{ id: 'N', cook: 2, mode: 'immediate' }], at(1));
    expect(fireOf(r.state, 'H')).toBe(at(16)); // moved to d − keep, still within slack (≤ d)
    expect(fireOf(r.state, 'H')).toBeLessThanOrEqual(r.state.lines.H!.deadline_ms);
    expect(r.state.lines.H!.booked).toEqual({ start: at(16), end: at(19), units: 1 });
    expect(fireOf(r.state, 'Z')).toBe(at(3)); // frozen: d − keep would be 12:02, but it never moves
    expect(r.state.lines.Z!.booked).toEqual(zBooked);
    expect(r.state.lines.F).toEqual(fBefore); // fired: untouched
    expect(eta(r.plan, 'N')).toBe(at(8)); // after F (packed [12:01, 12:03)) and Z [12:03, 12:06)
    // The stored profile holds exactly the planned bookings: Z, H (moved), N.
    expect(r.state.stations.S1!.profile).toEqual({ t: [at(3), at(8), at(16), at(19)], u: [1, 0, 1, 0] });
    expect(r.state.stations.S1!.unfired).toEqual(['Z', 'N', 'H']);
  });

  it('[03a #22] freeze is evaluated at the event recorded_at, never a clock (D13): fire ≤ t + freeze_ms is frozen', () => {
    let s = kitchen([{ station_id: 'S1', capacity: 1 }]);
    ({ state: s } = submit(s, 'OZ', [{ id: 'Z', cook: 3 }], at(0), { pickup_at_ms: at(10) }));
    expect(fireOf(s, 'Z')).toBe(at(7));
    const N: Item[] = [{ id: 'N', cook: 1, mode: 'immediate' }];
    // Batch at 12:05 exactly: Z's fire 12:07 = t + freeze → frozen, stays.
    const frozen = submit(s, 'ON', N, at(5));
    expect(fireOf(frozen.state, 'Z')).toBe(at(7));
    // Batch 1 ms earlier: Z is hidden → moves to d − keep (12:06).
    const hidden = submit(s, 'ON', N, at(5) - 1);
    expect(fireOf(hidden.state, 'Z')).toBe(at(6));
    // The handler planned at now = 12:05 − 1 ms (Z hidden there) but the batch is stamped 12:05: the fold
    // uses recorded_at, so Z stays frozen; folding the same events again gives the same state.
    const gap = submit(s, 'ON', N, at(5) - 1, {}, at(5));
    expect(fireOf(gap.state, 'Z')).toBe(at(7));
    const again = fold(s, batch('ON', N, at(5), gap.plan.groups));
    expect(again.lines).toEqual(gap.state.lines);
    expect(again.stations).toEqual(gap.state.stations);
  });

  it('[03a #23] prune fixture: an older hidden line ending ≤ the pivot is fixed input; unpruned it moves; same T', () => {
    // Capacity 2; X COOKING holds 1 unit to 12:12. P (1 unit) held for 12:10 → fire 12:07, ends 12:10.
    let s = kitchen([{ station_id: 'S1', capacity: 2 }]);
    ({ state: s } = submit(s, 'OX', [{ id: 'X', cook: 12, mode: 'immediate' }], at(0)));
    s = fold(s, [fire(['X'], at(0)), start('OX', 'X', at(0))]);
    ({ state: s } = submit(s, 'OP', [{ id: 'P', cook: 3 }], at(0), { pickup_at_ms: at(10) }));
    expect(fireOf(s, 'P')).toBe(at(7));
    // N needs both units: its earliest fire against the fixed profile (X) is 12:12 → pivot = 12:12 (a fire
    // time); P's interval ends 12:10 ≤ pivot → pruned.
    const N: Item[] = [{ id: 'N', cook: 5, units: 2 }];
    const pruned = submit(s, 'ON', N, at(0));
    const unpruned = submit(s, 'ON', N, at(0), {}, at(0), { prune: false });
    expect(fireOf(pruned.state, 'P')).toBe(at(7)); // fixed
    expect(fireOf(unpruned.state, 'P')).toBe(at(6)); // re-placed at d − keep
    expect(T(pruned.plan)).toBe(at(17));
    expect(T(pruned.plan)).toBeLessThanOrEqual(T(unpruned.plan));
    for (const r of [pruned, unpruned]) expect(maxUnits(r.state, 'S1', at(0))).toBeLessThanOrEqual(2);
  });

  it('[03a #23] property, 50 seeds: pruned keeps on time every line unpruned keeps, T_pruned ≤ T_unpruned, no over-booking', () => {
    let differ = 0;
    for (let run = 0; run < 50; run++) {
      const rnd = prng(2_300 + run); // 50 independent seeds
      const caps = [1 + rnd(3), 1 + rnd(3)];
      const stations = ['S1', 'S2'];
      let s = kitchen([{ station_id: 'S1', capacity: caps[0]! }, { station_id: 'S2', capacity: caps[1]! }]);
      let now = T0;
      const orders = 4 + rnd(6);
      const randomItems = (prefix: string): Item[] => {
        const n = 1 + rnd(3);
        const items: Item[] = [];
        for (let k = 0; k < n; k++) {
          const si = rnd(2);
          items.push({
            id: `${prefix}L${k}`,
            st: stations[si],
            cook: 1 + rnd(20),
            prep: rnd(2),
            mode: rnd(4) === 0 ? 'immediate' : 'sync',
            units: 1 + rnd(caps[si]!),
            carry: rnd(2),
            early: rnd(15), // max_early_ms 0 … 14 min
          });
        }
        return items;
      };
      for (let k = 0; k < orders; k++) {
        // The tick's work so far: every fired line is started, every due line fired.
        const lines = Object.values(s.lines);
        const toStart = lines.filter((l) => l.stage === 'added' && l.fired_at !== null);
        const due = lines.filter((l) => l.stage === 'added' && l.fired_at === null && l.fire_ms !== null && l.fire_ms <= now);
        s = fold(s, [...toStart.map((l) => start(l.order_id, l.order_item_id, now)), ...(due.length > 0 ? [fire(due.map((l) => l.order_item_id), now)] : [])]);
        // Most orders are held for a pickup, so their lines stay hidden (with slack) across later submits.
        const pickup = rnd(3) === 0 ? null : now + (5 + rnd(40)) * M;
        ({ state: s } = submit(s, `O${run}_${k}`, randomItems(`O${run}_${k}`), now, { pickup_at_ms: pickup }));
        now += rnd(3) * M;
      }
      const items = randomItems(`N${run}`);
      const pickup = rnd(3) === 0 ? now + (10 + rnd(40)) * M : null;
      const P = submit(s, `N${run}`, items, now, { pickup_at_ms: pickup });
      const U = submit(s, `N${run}`, items, now, { pickup_at_ms: pickup }, now, { prune: false });
      expect(P.plan.groups.length).toBe(U.plan.groups.length);
      for (let g = 0; g < P.plan.groups.length; g++) expect(T(P.plan, g)).toBeLessThanOrEqual(T(U.plan, g));
      const old = Object.values(s.lines).filter((l) => l.stage === 'added' && l.fired_at === null && l.booked !== null);
      const onTime = (st: EngineState): Set<string> =>
        new Set(old.filter((l) => st.lines[l.order_item_id]!.fire_ms! <= l.deadline_ms).map((l) => l.order_item_id));
      const onP = onTime(P.state);
      if (old.some((l) => P.state.lines[l.order_item_id]!.fire_ms !== U.state.lines[l.order_item_id]!.fire_ms)) differ++;
      for (const id of onTime(U.state)) expect(onP.has(id)).toBe(true);
      for (const [i, st] of stations.entries()) {
        if (maxUnits(s, st, now) > caps[i]!) continue; // already over capacity before (fired packing vs planned)
        expect(maxUnits(P.state, st, now)).toBeLessThanOrEqual(caps[i]!);
        expect(maxUnits(U.state, st, now)).toBeLessThanOrEqual(caps[i]!);
      }
    }
    // Not vacuous: in some runs the prune fixed a line the unpruned re-plan moved.
    expect(differ).toBeGreaterThan(0);
  });

  it('[03a #98] capacity 1, an early Done frees [12:01, 12:08): older A (latest fire 12:03) placed first, new immediate N after; planOrder = the fold', () => {
    let s = kitchen([{ station_id: 'S1', capacity: 1 }]);
    // X started 11:53, cook 15 → COOKING to 12:08.
    ({ state: s } = submit(s, 'OX', [{ id: 'X', cook: 15, mode: 'immediate' }], at(-7)));
    s = fold(s, [fire(['X'], at(-7)), start('OX', 'X', at(-7))]);
    // A's stored target 12:08 (cook 5 → latest fire 12:03); the fold places it after X, at 12:08.
    const A: Item[] = [{ id: 'A', cook: 5 }];
    s = fold(s, batch('OA', A, at(-6), [{ group_id: 'OA:0', target_land_ms: at(8), promise_ms: at(11), order_item_ids: ['A'] }]));
    expect(s.lines.A!.deadline_ms).toBe(at(3));
    expect(fireOf(s, 'A')).toBe(at(8));
    // Done early at 12:01 frees [12:01, 12:08).
    s = fold(s, [orderEvent('ItemDone', 'OX', { order_item_id: 'X', done_at: at(1), source: 'tap' }, at(1))]);
    const r = submit(s, 'ON', [{ id: 'N', cook: 5, mode: 'immediate' }], at(1));
    expect(fireOf(r.state, 'A')).toBe(at(2)); // pass 1: latestFit(lo = 12:02, hi = d − keep = 12:02)
    expect(r.state.lines.N!.booked).toEqual({ start: at(7), end: at(12), units: 1 });
    expect(eta(r.plan, 'N')).toBe(at(12));
    expect(maxUnits(r.state, 'S1', at(1))).toBe(1);
  });

  it('[03a #91] a line that fits at the handler t but not at the batch recorded_at is placed at its earliest fit', () => {
    let s = kitchen([{ station_id: 'S1', capacity: 1 }, { station_id: 'S2', capacity: 1 }]);
    ({ state: s } = submit(s, 'OX', [{ id: 'X', cook: 5, mode: 'immediate' }], at(0)));
    s = fold(s, [fire(['X'], at(0))]); // fired, not started: packs from max(fire, t)
    const items: Item[] = [{ id: 'A', cook: 3 }, { id: 'B', st: 'S2', cook: 1 }];
    const now = at(1);
    const rec = at(1) + 30_000;
    const r = submit(s, 'ON', items, now, {}, rec);
    expect(T(r.plan)).toBe(at(9)); // at now: X packs [12:01, 12:06), A [12:06, 12:09)
    // At recorded_at X packs [12:01:30, 12:06:30): A no longer fits at its planned slot and is placed at its
    // earliest fit. The hold-and-fire loop at recorded_at moves the whole sync group to the new T, so the
    // sibling B (which still fits) moves with it. The stored T stays the plan's (P-2); the slip half
    // (the next fires_alerts pass slips it) is the [03a §3.8] test in task 15.
    expect(r.state.lines.A!.booked).toEqual({ start: at(6) + 30_000, end: at(9) + 30_000, units: 1 });
    expect(r.state.lines.B!.booked).toEqual({ start: at(8) + 30_000, end: at(9) + 30_000, units: 1 });
    expect(r.state.orders.ON!.groups['ON:0']!.target_land_ms).toBe(at(9));
  });

  it('[03a §3.5.3] one re-plan per station per batch: only the ItemAdded that brings awaiting to 0 re-plans', () => {
    let s = kitchen([{ station_id: 'S1', capacity: 1 }]);
    ({ state: s } = submit(s, 'OH', [{ id: 'H', cook: 3 }], at(0), { pickup_at_ms: at(20) }));
    expect(fireOf(s, 'H')).toBe(at(17));
    const items: Item[] = [{ id: 'N1', cook: 2 }, { id: 'N2', cook: 2 }];
    const plan = planOrder(s, proposed('ON', items), at(1), {});
    const events = batch('ON', items, at(1), plan.groups);
    // OrderPlaced, ItemAdded N1 (awaiting 1): H untouched.
    const mid = fold(s, events.slice(0, 2));
    expect(mid.lines.H).toBe(s.lines.H);
    expect(mid.stations.S1).toBe(s.stations.S1);
    const end = fold(mid, events.slice(2));
    expect(fireOf(end, 'H')).toBe(at(16));
  });

  it('[03a AD-6] a re-plan removes exactly booked: an underflow throws when strict; non-strict records profile_underflow', () => {
    let s = kitchen([{ station_id: 'S1', capacity: 1 }]);
    ({ state: s } = submit(s, 'OH', [{ id: 'H', cook: 3 }], at(0), { pickup_at_ms: at(20) }));
    // Corrupt bookkeeping: H's booking is missing from the stored profile.
    const broken = deepFreeze({ ...s, stations: { ...s.stations, S1: { ...s.stations.S1!, profile: { t: [], u: [] } } } });
    const plan = planOrder(broken, proposed('ON', [{ id: 'N', cook: 2 }]), at(1), {});
    const events = batch('ON', [{ id: 'N', cook: 2 }], at(1), plan.groups);
    expect(() => fold(broken, events)).toThrow(RangeError);
    const lax = fold(broken, events, { strict: false });
    expect(lax.diagnostics).toEqual([
      expect.objectContaining({ kind: 'profile_underflow', station_id: 'S1', detail: expect.objectContaining({ order_item_id: 'H' }) }),
    ]);
    expect(lax.lines.H!.fire_ms).toBe(at(16));
  });

  it('[03a AD-12] a feasible serialised group stays on time across a later submit (queued deadline)', () => {
    let s = kitchen([{ station_id: 'S1', capacity: 1 }]);
    // D36 queue on capacity 1: A (cook 10) [12:25, 12:35), then B (cook 5) [12:35, 12:40) = T.
    ({ state: s } = submit(s, 'OG', [{ id: 'A', cook: 10 }, { id: 'B', cook: 5 }], at(0), { pickup_at_ms: at(40) }));
    expect(s.lines.A!.booked).toEqual({ start: at(25), end: at(35), units: 1 });
    expect(s.lines.A!.deadline_ms).toBe(at(25)); // its own slot, not T − cook = 12:30
    expect(s.lines.B!.deadline_ms).toBe(at(35));
    const r = submit(s, 'ON', [{ id: 'N', cook: 1, mode: 'immediate' }], at(1));
    // Pass 1 keeps both in their queue, each taking its keep: A [12:24, 12:34), B [12:34, 12:39) ≤ T.
    expect(r.state.lines.A!.booked).toEqual({ start: at(24), end: at(34), units: 1 });
    expect(r.state.lines.B!.booked).toEqual({ start: at(34), end: at(39), units: 1 });
    for (const id of ['A', 'B']) expect(fireOf(r.state, id)).toBeLessThanOrEqual(r.state.lines[id]!.deadline_ms);
  });

  it('[03a AD-12] property, 50 seeds: a serialised group stays on time across later submits (no disturbance)', () => {
    for (let run = 0; run < 50; run++) {
      const rnd = prng(1_200 + run);
      const cap = 1 + rnd(2);
      let s = kitchen([{ station_id: 'S1', capacity: cap }, { station_id: 'S2', capacity: 1 + rnd(2) }]);
      let now = T0;
      const gItems: Item[] = [];
      for (let k = 0; k < 2 + rnd(3); k++) {
        gItems.push({ id: `G${run}L${k}`, st: rnd(4) === 0 ? 'S2' : 'S1', cook: 2 + rnd(12), prep: rnd(2), units: 1 + rnd(cap), carry: rnd(2), early: rnd(15) });
      }
      const g = submit(s, `G${run}`, gItems, now, { pickup_at_ms: now + (20 + rnd(40)) * M });
      s = g.state;
      const TG = T(g.plan);
      const onTime = (st: EngineState): void => {
        for (const it of gItems) {
          const l = st.lines[it.id]!;
          expect(l.fire_ms!).toBeLessThanOrEqual(l.deadline_ms);
          expect(l.booked!.end + l.carry_ms).toBeLessThanOrEqual(TG);
        }
      };
      onTime(s);
      for (let k = 0; k < 1 + rnd(4); k++) {
        now += rnd(3) * M;
        const items: Item[] = [];
        for (let j = 0; j < 1 + rnd(3); j++) {
          items.push({ id: `N${run}_${k}L${j}`, st: rnd(2) === 0 ? 'S1' : 'S2', cook: 1 + rnd(10), mode: rnd(3) === 0 ? 'immediate' : 'sync', early: rnd(15) });
        }
        ({ state: s } = submit(s, `N${run}_${k}`, items, now, { pickup_at_ms: rnd(2) === 0 ? null : now + (5 + rnd(40)) * M }));
        onTime(s);
      }
    }
  });

  it('[03a AD-4] a 4-unit line on capacity 3 is never pass-1-placed past T − carry (occupancy deadline)', () => {
    let s = kitchen([{ station_id: 'S1', capacity: 3 }]);
    // 4 units on capacity 3: the whole station for 2 rounds × 5 min = [12:20, 12:30), T = 12:30.
    ({ state: s } = submit(s, 'OX', [{ id: 'X', cook: 5, units: 4 }], at(0), { pickup_at_ms: at(30) }));
    expect(s.lines.X!.booked).toEqual({ start: at(20), end: at(30), units: 3 });
    expect(s.lines.X!.deadline_ms).toBe(at(20));
    const r = submit(s, 'ON', [{ id: 'N', cook: 1, mode: 'immediate' }], at(1));
    expect(r.state.lines.X!.booked).toEqual({ start: at(19), end: at(29), units: 3 });
    expect(r.state.lines.X!.booked!.end).toBeLessThanOrEqual(at(30));
  });

  it('[03a §3.5.6 stub] the late set is placed in the given (pass-1) order, each at its earliest fit from max(t, d − max_early)', () => {
    const line = (id: string, d: number, early: number) => ({ order_item_id: id, deadline_ms: d, max_early_ms: early, units: 1, prep_ms: 0, cook_ms: 2 * M });
    const busy = { t: [at(0), at(10)], u: [1, 0] };
    // L2 first (as given), then L1 after it; L3's early bound 12:19 is later than the free point.
    const r = placeLateSet(busy, [line('L2', at(3), M), line('L1', at(5), M), line('L3', at(20), M)], 1, at(0));
    expect(r.placements).toEqual([
      ['L2', { fire: at(10), booked: { start: at(10), end: at(12), units: 1 } }],
      ['L1', { fire: at(12), booked: { start: at(12), end: at(14), units: 1 } }],
      ['L3', { fire: at(19), booked: { start: at(19), end: at(21), units: 1 } }],
    ]);
    expect(r.profile).toEqual({ t: [at(0), at(14), at(19), at(21)], u: [1, 0, 1, 0] });
    expect(busy).toEqual({ t: [at(0), at(10)], u: [1, 0] }); // input untouched
  });

  it('[03a §3.5.3] capacity < 1 is invalid data: strict throws InvalidEvent capacity_invalid; non-strict records invalid_event', () => {
    const s = kitchen([{ station_id: 'S1', capacity: 0 }]);
    const events = batch('O1', [{ id: 'L1', cook: 5 }], at(0), [{ group_id: 'O1:0', target_land_ms: at(5), promise_ms: at(8), order_item_ids: ['L1'] }]);
    expect(() => fold(s, events)).toThrow(/capacity_invalid/);
    const lax = fold(s, events, { strict: false });
    expect(lax.diagnostics).toEqual([
      expect.objectContaining({ kind: 'invalid_event', station_id: 'S1', detail: expect.objectContaining({ reason: 'capacity_invalid', order_item_id: 'L1' }) }),
    ]);
    expect(() => planOrder(s, proposed('O1', [{ id: 'L1', cook: 5 }]), at(0), {})).toThrow(/capacity_invalid/);
  });
});

describe('@pos/engine re-plan on void / remove (D13: T\' = min(T, loop), promise never moves)', () => {
  for (const kind of ['ItemVoided', 'ItemRemoved'] as const) {
    const end = (id: string, t: number): PosEvent =>
      orderEvent(kind, 'OG', kind === 'ItemVoided' ? { order_item_id: id, units: 1 } : { order_item_id: id }, t);

    it(`[03a #89] ${kind} of the critical line gives T' < T; the promise is unchanged`, () => {
      let s = kitchen([{ station_id: 'S1', capacity: 1 }, { station_id: 'S2', capacity: 1 }]);
      // A (cook 10, S1) is the critical line; B (cook 2, S2) is held to land with it at 12:10.
      const r = submit(s, 'OG', [{ id: 'A', cook: 10 }, { id: 'B', st: 'S2', cook: 2 }], at(0));
      s = r.state;
      expect(T(r.plan)).toBe(at(10));
      expect(fireOf(s, 'B')).toBe(at(8));
      const P = s.orders.OG!.promise_ms;
      const after = fold(s, [end('A', at(1))]);
      // B alone: the loop at 12:01 lands it at 12:03 → T' = min(12:10, 12:03).
      expect(after.orders.OG!.groups['OG:0']!.target_land_ms).toBe(at(3));
      expect(after.orders.OG!.target_land_ms).toBe(at(3));
      expect(after.lines.B!.booked).toEqual({ start: at(1), end: at(3), units: 1 });
      expect(after.lines.B!.deadline_ms).toBe(at(1));
      expect(after.orders.OG!.promise_ms).toBe(P);
      expect(after.stations.S2!.profile).toEqual({ t: [at(1), at(3)], u: [1, 0] });
      expect(after.stations.S1!.profile).toEqual({ t: [], u: [] });
    });

    it(`[03a #89] ${kind} where the loop would need a later T keeps T; the promise is unchanged`, () => {
      let s = kitchen([{ station_id: 'S1', capacity: 1 }, { station_id: 'S2', capacity: 2 }]);
      const r = submit(s, 'OG', [{ id: 'A', cook: 10 }, { id: 'B', st: 'S2', cook: 2 }, { id: 'V', st: 'S2', cook: 1 }], at(0));
      s = r.state;
      expect(T(r.plan)).toBe(at(10));
      // A fired at 12:00 but not started: at 12:01 it packs [12:01, 12:11), past T.
      s = fold(s, [fire(['A'], at(0))]);
      const P = s.orders.OG!.promise_ms;
      const bBefore = s.lines.B!;
      const after = fold(s, [end('V', at(1))]);
      expect(after.orders.OG!.groups['OG:0']!.target_land_ms).toBe(at(10)); // loop ≥ 12:11 → T kept
      expect(after.lines.B).toEqual(bBefore);
      expect(after.orders.OG!.promise_ms).toBe(P);
      expect(after.lines.V!.stage).toBe(kind === 'ItemVoided' ? 'voided' : 'removed');
    });
  }

  it('[03a #89] a void re-plans its station: an older hidden line there moves within slack', () => {
    let s = kitchen([{ station_id: 'S1', capacity: 2 }]);
    // V holds the whole station [12:15, 12:17); at 12:13 it is frozen, so H (held for 12:20) sits at d = 12:17.
    ({ state: s } = submit(s, 'OG', [{ id: 'V', cook: 2, units: 2 }], at(0), { pickup_at_ms: at(17) }));
    expect(fireOf(s, 'V')).toBe(at(15));
    ({ state: s } = submit(s, 'OH', [{ id: 'H', cook: 3 }], at(13), { pickup_at_ms: at(20) }));
    expect(fireOf(s, 'H')).toBe(at(17));
    const after = fold(s, [orderEvent('ItemVoided', 'OG', { order_item_id: 'V', units: 2 }, at(13))]);
    expect(fireOf(after, 'H')).toBe(at(16)); // the freed window lets H take its keep (d − keep)
    expect(after.stations.S1!.unfired).toEqual(['H']);
    expect(after.stations.S1!.profile).toEqual({ t: [at(16), at(19)], u: [1, 0] });
  });
});

describe('@pos/engine Review Focus 2: equal recorded_at and equal fire_ms across stations', () => {
  it('[03a §3.5.3] Review Focus 2, 50 seeds: one recorded_at per day, equal fires across stations → stable placement, live = rebuild', () => {
    for (let run = 0; run < 50; run++) {
      const rnd = prng(200 + run); // 50 independent seeds
      const cap = 1 + rnd(2);
      const stations = ['S1', 'S2', 'S3'];
      const base = kitchen(stations.map((id) => ({ station_id: id, capacity: cap })));
      const cfgEvents = [
        anEngineConfigApplied({ recorded_at: T0 - 3_600_000, payload: { stations: stations.map((id) => ({ ...S1, station_id: id, capacity: cap })) } }),
      ];
      const t = at(rnd(5));
      const cook = 1 + rnd(6);
      let live = base;
      const log: PosEvent[] = [...cfgEvents];
      for (let k = 0; k < 4 + rnd(4); k++) {
        // The same items on every station, so fires tie across stations; all batches share recorded_at t.
        const n = 1 + rnd(2);
        const items: Item[] = [];
        for (let j = 0; j < n; j++) {
          const mode = rnd(3) === 0 ? 'immediate' : 'sync';
          for (const st of stations) items.push({ id: `R${run}O${k}L${j}${st}`, st, cook, mode });
        }
        const pickup = rnd(2) === 0 ? t + (10 + rnd(20)) * M : null;
        const p = proposed(`R${run}O${k}`, items, { pickup_at_ms: pickup });
        const plan = planOrder(live, p, t, {});
        const events = batch(`R${run}O${k}`, items, t, plan.groups, { pickup_at_ms: pickup });
        live = fold(live, events);
        log.push(...events);
        for (const l of plan.lines) expect(live.lines[l.order_item_id]!.booked!.end + l.carry_ms).toBe(l.eta_ms);
      }
      const rebuilt = buildEngineState(log.map((e) => deepFreeze(e)));
      expect(rebuilt.lines).toEqual(live.lines);
      expect(rebuilt.stations).toEqual(live.stations);
      expect(rebuilt.orders).toEqual(live.orders);
      for (const st of stations) {
        const unfired = live.stations[st]!.unfired;
        for (let i = 1; i < unfired.length; i++) {
          const a = live.lines[unfired[i - 1]!]!;
          const b = live.lines[unfired[i]!]!;
          expect(a.fire_ms! < b.fire_ms! || (a.fire_ms === b.fire_ms && a.order_item_id < b.order_item_id)).toBe(true);
        }
        expect(maxUnits(live, st, t)).toBeLessThanOrEqual(cap);
      }
      // Identical stations, identical work: every station has the same fire times.
      const fires = stations.map((st) => live.stations[st]!.unfired.map((id) => live.lines[id]!.fire_ms));
      expect(fires[1]).toEqual(fires[0]);
      expect(fires[2]).toEqual(fires[0]);
    }
  });
});
