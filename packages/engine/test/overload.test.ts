// 03a §3.5.6 overload — weighted lateness (D5) with AD-15 (controller ruling 2026-11-06): the lines are placed
// backward, in descending d_Λ, each at latestFit(…, hi = d_Λ), keep off; all free hidden lines of the station are
// re-placed; Λ = 0 first, then exponential, then binary search on multiples of cascade_step_ms, ≤ 16 probes; a
// capped line that cannot fit goes to earliestFit after the others and is flagged `capped` on the line; if the
// budget runs out, the largest Λ probed is used and the leftovers are capped.
import { parseEvent, type EngineConfig, type ItemAddedPayload, type PosEvent } from '@pos/events';
import { aFireDispatched, anEngineConfigApplied, anItemAdded, anItemStarted, anOrderBatch } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import { applyEvent, initialEngineState, planOrder, type EngineState, type ProposedOrder } from '../src/index';
import { liveProfile } from '../src/live';
import { OVERLOAD_MAX_PROBES, overloadPlace, type OverloadLine } from '../src/overload';
import type { Profile } from '../src/state';

const M = 60_000;
const STEP = 60_000; // cascade_step_ms default

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

function line(id: string, o: Partial<OverloadLine> = {}): OverloadLine {
  return { order_item_id: id, deadline_ms: 0, max_early_ms: 1_000 * M, max_late_ms: null, units: 1, prep_ms: 0, cook_ms: 10 * M, w: 100, urgency: 0, ...o };
}

const fireOf = (r: ReturnType<typeof overloadPlace>, id: string): number => r.placements.find(([x]) => x === id)![1].fire;

// Max units in use of a profile, and a check that the placements plus base equal the returned profile.
function maxU(p: Profile): number {
  return Math.max(0, ...p.u);
}
function rebuild(base: Profile, r: ReturnType<typeof overloadPlace>): Profile {
  const delta = new Map<number, number>();
  for (let i = 0; i < base.t.length; i++) delta.set(base.t[i]!, (delta.get(base.t[i]!) ?? 0) + base.u[i]! - (i > 0 ? base.u[i - 1]! : 0));
  for (const [, pl] of r.placements) {
    delta.set(pl.booked.start, (delta.get(pl.booked.start) ?? 0) + pl.booked.units);
    delta.set(pl.booked.end, (delta.get(pl.booked.end) ?? 0) - pl.booked.units);
  }
  const t: number[] = [];
  const u: number[] = [];
  let cur = 0;
  let prev = 0;
  for (const k of [...delta.keys()].sort((a, b) => a - b)) {
    cur += delta.get(k)!;
    if (cur === prev) continue;
    t.push(k);
    u.push(cur);
    prev = cur;
  }
  return { t, u };
}

describe('@pos/engine overload Λ search (§3.5.6, D5, AD-15)', () => {
  it('[03a #26] one slot: a weight-2 line carries half the lateness of a weight-1 line (D5)', () => {
    const base = deepFreeze({ t: [0, 10 * M], u: [1, 0] }); // the slot is busy until 10 min
    const lines = deepFreeze([line('A', { w: 100 }), line('B', { w: 200 })]);
    const r = overloadPlace(base, lines, 1, 0, STEP);
    const lateA = fireOf(r, 'A') - 0;
    const lateB = fireOf(r, 'B') - 0;
    expect(lateB).toBe(10 * M);
    expect(lateA).toBe(20 * M);
    expect(lateB * 2).toBe(lateA);
    expect(r.lambda).toBe(20 * M); // Λ = lateness × w / 100 for both
    expect(r.capped).toEqual([]);
    expect(r.probes).toBeLessThanOrEqual(OVERLOAD_MAX_PROBES);
    expect(maxU(r.profile)).toBeLessThanOrEqual(1);
    expect(r.profile).toEqual(rebuild(base, r));
  });

  it('[03a AD-15] one slot, A w100, B w200, d = 0, cook 10 min: Λ = 600 000, B on time, A 10 min late (Lawler-optimal)', () => {
    const r = overloadPlace(deepFreeze({ t: [], u: [] }), deepFreeze([line('A', { w: 100 }), line('B', { w: 200 })]), 1, 0, STEP);
    expect(r.lambda).toBe(600_000);
    expect(fireOf(r, 'B')).toBe(0);
    expect(fireOf(r, 'A')).toBe(10 * M);
    expect(r.probes).toBeLessThanOrEqual(OVERLOAD_MAX_PROBES);
  });

  it('[03a AD-16] forward compaction: a line with a free slot by its own deadline is not left late (A, B due 0; C due 30 → 30)', () => {
    const r = overloadPlace(deepFreeze({ t: [], u: [] }), deepFreeze([line('A'), line('B'), line('C', { deadline_ms: 30 * M })]), 1, 0, STEP);
    expect(r.lambda).toBe(10 * M);
    expect(fireOf(r, 'C')).toBe(30 * M);
    expect(maxU(r.profile)).toBeLessThanOrEqual(1);
    const late = overloadPlace(deepFreeze({ t: [], u: [] }), deepFreeze([line('A'), line('B'), line('F', { deadline_ms: 120 * M })]), 1, 0, STEP);
    expect(fireOf(late, 'F')).toBe(120 * M);
    expect([fireOf(late, 'A'), fireOf(late, 'B')].sort((a, b) => a - b)).toEqual([0, 10 * M]);
  });

  it('[03a AD-16] property, 40 seeds: after compaction no line is later, max weighted lateness never higher, units ≤ cap, rebuild = profile', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rnd = prng(1_000 + seed);
      const cap = 1 + rnd(4);
      const lines: OverloadLine[] = [];
      for (let k = 0; k < 5 + rnd(40); k++) {
        lines.push(line(`L${String(k).padStart(3, '0')}`, { deadline_ms: rnd(120) * M, cook_ms: (2 + rnd(12)) * M, units: 1 + rnd(2), w: [100, 200, 300][rnd(3)]!, max_early_ms: rnd(10) * M, urgency: rnd(50), max_late_ms: rnd(4) === 0 ? rnd(30) * M : null }));
      }
      const base = deepFreeze({ t: [0, rnd(30) * M + 1], u: [cap, 0] });
      const frozen = deepFreeze(lines);
      const raw = overloadPlace(base, frozen, cap, 0, STEP, false);
      const r = overloadPlace(base, frozen, cap, 0, STEP);
      expect(r.lambda).toBe(raw.lambda);
      const wl = (x: ReturnType<typeof overloadPlace>): number =>
        Math.max(0, ...lines.filter((L) => !x.capped.includes(L.order_item_id)).map((L) => ((fireOf(x, L.order_item_id) - L.deadline_ms) * L.w) / 100));
      for (const L of lines) expect(fireOf(r, L.order_item_id)).toBeLessThanOrEqual(fireOf(raw, L.order_item_id));
      expect(wl(r)).toBeLessThanOrEqual(wl(raw)); // only earlier moves: never higher (it can drop on capacity > 1)
      expect(maxU(r.profile)).toBeLessThanOrEqual(cap);
      expect(r.profile).toEqual(rebuild(base, r));
    }
  });

  it('[03a §3.5.6] Λ = 0 is probed first: EDF without keep may fit everything pass 1 could not (one probe)', () => {
    const r = overloadPlace(deepFreeze({ t: [], u: [] }), deepFreeze([line('A', { deadline_ms: 10 * M }), line('B', { deadline_ms: 0 })]), 1, 0, STEP);
    expect(r.lambda).toBe(0);
    expect(r.probes).toBe(1);
    expect(fireOf(r, 'B')).toBe(0);
    expect(fireOf(r, 'A')).toBe(10 * M);
  });

  it('[03a #27] a line at its max_late_ms cap is not shifted past the cap and is reported capped', () => {
    const base = deepFreeze({ t: [0, 5 * M], u: [1, 0] });
    // Without a cap, B (the later id) takes the late slot: 15 min late.
    const free = overloadPlace(base, deepFreeze([line('A'), line('B')]), 1, 0, STEP);
    expect(fireOf(free, 'B')).toBe(15 * M);
    expect(free.capped).toEqual([]);
    // With max_late_ms 5 min, B is held at its cap (5 min late) and A carries the rest.
    const r = overloadPlace(base, deepFreeze([line('A'), line('B', { max_late_ms: 5 * M })]), 1, 0, STEP);
    expect(fireOf(r, 'B')).toBe(5 * M);
    expect(fireOf(r, 'B')).toBeLessThanOrEqual(0 + 5 * M);
    expect(fireOf(r, 'A')).toBe(15 * M);
    expect(r.capped).toEqual(['B']);
    expect(maxU(r.profile)).toBeLessThanOrEqual(1);
  });

  it('[03a #27] a capped line that cannot fit by its cap goes at earliestFit after the others, flagged capped (never a refusal)', () => {
    const base = deepFreeze({ t: [0, 10 * M], u: [1, 0] });
    const r = overloadPlace(base, deepFreeze([line('A'), line('B', { max_late_ms: 5 * M })]), 1, 0, STEP);
    expect(fireOf(r, 'A')).toBe(10 * M); // A is not pushed further for a line that cannot be helped
    expect(fireOf(r, 'B')).toBe(20 * M); // earliest fit after A
    expect(r.capped).toEqual(['B']);
    expect(r.placements).toHaveLength(2);
    expect(maxU(r.profile)).toBeLessThanOrEqual(1);
    expect(r.profile).toEqual(rebuild(base, r));
  });

  it('[03a §3.5.6] the probe budget runs out → the largest Λ probed, the leftovers placed after the others and capped', () => {
    // w = 1 %, step 1 ms: Λ = 0, 1, 2, …, 2^14 (16 probes) stretch d by at most 1 638 400 ms; the slot is busy
    // for 1 000 min, so no probe succeeds.
    const base = deepFreeze({ t: [0, 1_000 * M], u: [1, 0] });
    const r = overloadPlace(base, deepFreeze([line('A', { w: 1, cook_ms: 10 * M })]), 1, 0, 1);
    expect(r.probes).toBe(OVERLOAD_MAX_PROBES);
    expect(r.lambda).toBe(2 ** 14);
    expect(fireOf(r, 'A')).toBe(1_000 * M);
    expect(r.capped).toEqual(['A']);
  });

  it('[03a §3.5.6] lo = max(t, d − max_early_ms) is kept; nothing is placed before t', () => {
    const base = deepFreeze({ t: [5 * M, 15 * M], u: [1, 0] });
    const r = overloadPlace(base, deepFreeze([line('A', { deadline_ms: 6 * M }), line('B', { deadline_ms: 30 * M, max_early_ms: 2 * M })]), 1, 2 * M, STEP);
    for (const [, pl] of r.placements) expect(pl.fire).toBeGreaterThanOrEqual(2 * M);
    expect(fireOf(r, 'B')).toBeGreaterThanOrEqual(28 * M);
    expect(maxU(r.profile)).toBeLessThanOrEqual(1);
  });

  it('[03a §3.5.6] 125 % tandoor fixture: ≤ 16 probes, no over-booking, every line placed once, at or after its lo', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rnd = prng(seed);
      const cap = 4;
      const horizon = 180 * M; // a 3-hour rush
      const lines: OverloadLine[] = [];
      let unitMs = 0;
      for (let k = 0; unitMs < 1.25 * cap * horizon; k++) {
        const cook = (8 + rnd(8)) * M;
        const units = 1 + rnd(2);
        const d = rnd(horizon / M) * M;
        const w = [100, 200, 300][rnd(3)]!;
        lines.push(line(`L${String(k).padStart(4, '0')}`, { deadline_ms: d, cook_ms: cook, units, w, max_early_ms: M, urgency: rnd(100), max_late_ms: rnd(5) === 0 ? 20 * M : null }));
        unitMs += cook * units;
      }
      const base = deepFreeze({ t: [0, 12 * M], u: [2, 0] });
      const r = overloadPlace(base, deepFreeze(lines), cap, 0, STEP);
      expect(r.probes).toBeLessThanOrEqual(OVERLOAD_MAX_PROBES);
      expect(new Set(r.placements.map(([x]) => x)).size).toBe(lines.length);
      expect(r.placements).toHaveLength(lines.length);
      expect(maxU(r.profile)).toBeLessThanOrEqual(cap);
      expect(r.profile).toEqual(rebuild(base, r));
      for (const L of lines) expect(fireOf(r, L.order_item_id)).toBeGreaterThanOrEqual(Math.max(0, L.deadline_ms - L.max_early_ms));
      // An uncapped line that was not left over is late by at most Λ × 100 / w.
      for (const L of lines) {
        if (r.capped.includes(L.order_item_id)) continue;
        expect(fireOf(r, L.order_item_id) - L.deadline_ms).toBeLessThanOrEqual(Math.floor((r.lambda * 100) / L.w));
      }
    }
  });
});

// ---- through the fold: a void re-plan that leaves a late set (§3.5.3 → §3.5.6), capped stored on the line ----

const T0 = 1_761_000_000_000;
const at = (min: number): number => T0 + min * M;
const S1 = (parseEvent(anEngineConfigApplied()).payload as unknown as EngineConfig).stations[0]!;

function kitchen(capacity: number): EngineState {
  const cfg = anEngineConfigApplied({ recorded_at: T0 - 3_600_000, payload: { stations: [{ ...S1, station_id: 'S1', capacity }] } });
  return deepFreeze(applyEvent(initialEngineState(), deepFreeze(cfg)));
}
function fold(state: EngineState, events: PosEvent[]): EngineState {
  let s = deepFreeze(state);
  for (const e of events) s = deepFreeze(applyEvent(s, deepFreeze(e)));
  return s;
}
let seq = 100;
const nextSeq = (n: number): number => {
  const s = seq;
  seq += n + 1;
  return s;
};
type Item = { id: string; cook: number; mode?: 'sync' | 'immediate'; max_late?: number | null };
function submit(state: EngineState, order_id: string, items: Item[], now: number, pickup_at_ms: number | null): EngineState {
  const base = anItemAdded().payload as unknown as ItemAddedPayload;
  const p: ProposedOrder = deepFreeze({
    order_id,
    order: { order_type: 'dine_in', table_id: 'T12', table_key: 'dine_in:T12', follow_up: false, pickup_at_ms },
    lines: items.map((i) => ({
      ...base,
      order_id,
      order_item_id: i.id,
      station_id: 'S1',
      cook_time_ms: i.cook * M,
      prep_buffer_ms: 0,
      serve_mode: i.mode ?? 'sync',
      quantity: 1,
      alternates: [],
      point_id: null,
      carry_ms: 0,
      weight_pct: 100,
      max_early_ms: M,
      max_late_ms: i.max_late === undefined ? null : i.max_late === null ? null : i.max_late * M,
      max_carry_ms: null,
      cook_ms_override: null,
      return_of: null,
    })),
  });
  const plan = planOrder(state, p, now, {});
  const events = anOrderBatch({
    order_id,
    recorded_at: now,
    seq: nextSeq(items.length),
    lines: items.map((i) => ({
      order_item_id: i.id,
      item: { station_id: 'S1', cook_time_ms: i.cook * M, prep_buffer_ms: 0, serve_mode: i.mode ?? 'sync', quantity: 1 },
      line: { station_id: 'S1', carry_ms: 0, max_early_ms: M, max_late_ms: i.max_late === undefined || i.max_late === null ? null : i.max_late * M },
    })),
    order: { order_type: 'dine_in', pickup_at_ms, groups: plan.groups },
  });
  return fold(state, events);
}
function fire(ids: string[], recorded_at: number): PosEvent {
  return aFireDispatched({
    stream_id: 'S1',
    recorded_at,
    occurred_at: recorded_at,
    seq: nextSeq(0),
    payload: { station_id: 'S1', order_item_ids: ids, due_at: recorded_at, load_id: null, reason: 'scheduled' },
  });
}
function orderEvent(event_type: string, order_id: string, payload: Record<string, unknown>, recorded_at: number): PosEvent {
  const s = nextSeq(0);
  return { ...anItemStarted(), event_type, stream_id: order_id, payload, recorded_at, occurred_at: recorded_at, seq: s, event_id: `01JZ${String(s).padStart(22, '0')}` };
}
function maxUnits(s: EngineState, t: number): number {
  return Math.max(0, ...liveProfile(s, 'S1', t).u);
}

describe('@pos/engine overload through the re-plan (§3.5.3 late set → §3.5.6)', () => {
  // Capacity 1. X (immediate, 10 min) fires at 12:00 and is never started, so at 12:25 it packs at [12:25, 12:35).
  // B and C are held for pickups; at 12:25 a void of V re-plans S1 and B / C no longer fit by their deadlines.
  function scene(maxLateC: number | null): { before: EngineState; after: EngineState } {
    let s = kitchen(1);
    s = submit(s, 'OX', [{ id: 'X', cook: 10, mode: 'immediate' }], at(0), null);
    s = fold(s, [fire(['X'], at(0))]);
    s = submit(s, 'OB', [{ id: 'B', cook: 5 }], at(1), at(38));
    s = submit(s, 'OC', [{ id: 'C', cook: 5, max_late: maxLateC }], at(2), at(44));
    s = submit(s, 'OV', [{ id: 'V', cook: 1 }], at(3), at(60));
    const after = fold(s, [orderEvent('ItemVoided', 'OV', { order_item_id: 'V', units: 1 }, at(25))]);
    return { before: s, after };
  }

  it('[03a §3.5.6] the late lines are re-placed after the in-flight line, no over-booking, capped false', () => {
    const { before, after } = scene(null);
    expect(before.lines.B!.deadline_ms).toBe(at(33));
    expect(before.lines.C!.deadline_ms).toBe(at(39));
    // Λ = 2 min (both w 100): B 2 min late at 12:35; C (d_Λ 12:41) compacted to 12:40, the first free instant (AD-16).
    expect(after.lines.B!.fire_ms).toBe(at(35));
    expect(after.lines.C!.fire_ms).toBe(at(40));
    expect(after.lines.B!.capped).toBe(false);
    expect(after.lines.C!.capped).toBe(false);
    expect(before.lines.B!.capped).toBe(false);
    expect(maxUnits(after, at(25))).toBeLessThanOrEqual(1);
    // The stored profile equals the bookings of the unfired lines (AD-7).
    expect([...after.stations.S1!.unfired].sort()).toEqual(['B', 'C']);
  });

  it('[03a #27] cap 0: C is not let late (B carries the lateness after it); on time, so it never reached its cap', () => {
    const { after } = scene(0);
    // C fires by its deadline 12:39 (12:38, within max_early) and B goes after it (Λ = 10 min: 12:43, not 12:35).
    expect(after.lines.C!.fire_ms).toBeLessThanOrEqual(after.lines.C!.deadline_ms);
    expect(after.lines.C!.fire_ms).toBe(at(38));
    expect(after.lines.B!.fire_ms).toBe(at(43));
    expect(after.lines.C!.capped).toBe(false); // AD-16: capped from the final lateness (−1 min < 0)
    expect(maxUnits(after, at(25))).toBeLessThanOrEqual(1);
  });

  it('[03a #27] a line that ends at its max_late_ms cap is stored capped = true on the line', () => {
    const { after } = scene(1);
    expect(after.lines.C!.fire_ms).toBe(at(40)); // d 12:39 + cap 1 min, never later
    expect(after.lines.B!.fire_ms).toBe(at(35));
    expect(after.lines.C!.capped).toBe(true);
    expect(after.lines.B!.capped).toBe(false);
    expect(maxUnits(after, at(25))).toBeLessThanOrEqual(1);
  });
});

// Seeded PRNG (mulberry32).
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
