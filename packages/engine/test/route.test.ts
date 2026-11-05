// 03a §3.5.5 routing (D8, D9, D10, D23, P-3): alternates (slot only, order type listed by 02, max_carry_ms, not
// paused); immediate line → minimum arrival unless it beats home by < min_gain_ms; sync line → fits at any allowed
// station ending at T − carry, preference home → lowest carry → station_id; reserve_units only for the station's
// home lines; only hidden lines change station in a re-plan. planOrder = the fold (§3.5.1 one sequence).
import { parseEvent, type EngineConfig, type ItemAddedPayload, type PosEvent } from '@pos/events';
import { aFireDispatched, anEngineConfigApplied, anItemAdded, anItemStarted, anOrderBatch } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import { applyEvent, initialEngineState, planOrder, type EngineState, type PlanResult, type ProposedOrder } from '../src/index';
import { liveProfile } from '../src/live';
import { planOrderWith } from '../src/plan';

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
const SETTINGS = (anEngineConfigApplied().payload as unknown as EngineConfig).settings;
type StationCfg = EngineConfig['stations'][number];

// Slot stations with the config defaults (freeze 2 min, keep 1 min) unless overridden.
function kitchen(stations: Array<Partial<StationCfg>>, settings: Partial<EngineConfig['settings']> = {}): EngineState {
  const cfg = anEngineConfigApplied({
    recorded_at: T0 - 3_600_000,
    payload: { stations: stations.map((s) => ({ ...S1, ...s })), settings: { ...SETTINGS, ...settings } },
  });
  return deepFreeze(applyEvent(initialEngineState(), deepFreeze(cfg)));
}

type Opts = { strict?: boolean; prune?: boolean };
function fold(state: EngineState, events: PosEvent[], opts?: Opts): EngineState {
  let s = deepFreeze(state);
  for (const e of events) s = deepFreeze(applyEvent(s, deepFreeze(e), opts));
  return s;
}

type Alt = { station_id: string; carry_ms: number; home: boolean };
// A line: routed station, serve mode (default sync), cook in minutes, carry in minutes, alternates, max_carry_ms.
type Item = {
  id: string;
  st?: string;
  cook: number;
  mode?: 'sync' | 'immediate';
  units?: number;
  carry?: number;
  alts?: Alt[];
  maxCarry?: number | null;
  prep?: number;
  early?: number;
};
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
    order: { order_type: o.order_type ?? 'dine_in', table_id: 'T12', table_key: 'dine_in:T12', follow_up: false, pickup_at_ms: o.pickup_at_ms ?? null },
    lines: items.map((i) => ({
      ...base,
      order_id,
      order_item_id: i.id,
      station_id: i.st ?? 'S1',
      cook_time_ms: i.cook * M,
      prep_buffer_ms: (i.prep ?? 0) * M,
      serve_mode: i.mode ?? 'sync',
      quantity: i.units ?? 1,
      alternates: i.alts ?? [],
      point_id: null,
      carry_ms: (i.carry ?? 0) * M,
      weight_pct: 100,
      max_early_ms: (i.early ?? 1) * M,
      max_late_ms: null,
      max_carry_ms: i.maxCarry ?? null,
      cook_ms_override: null,
      return_of: null,
    })),
  });
}

// The §4.2 batch 02 appends from a plan: OrderPlaced.lines[] take the plan's station_id, alternates and carry_ms
// (the engine's starting station, §4.2); ItemAdded.station_id stays the routed one (D25).
function batch(order_id: string, items: Item[], recorded_at: number, plan: PlanResult, o: OrderOver = {}): PosEvent[] {
  const byId = new Map(plan.lines.map((l) => [l.order_item_id, l]));
  return anOrderBatch({
    order_id,
    recorded_at,
    seq: nextSeq(items.length),
    lines: items.map((i) => {
      const p = byId.get(i.id)!;
      return {
        order_item_id: i.id,
        item: { station_id: i.st ?? 'S1', cook_time_ms: i.cook * M, prep_buffer_ms: (i.prep ?? 0) * M, serve_mode: i.mode ?? 'sync', quantity: i.units ?? 1 },
        line: { station_id: p.station_id, alternates: p.alternates, carry_ms: p.carry_ms, max_carry_ms: i.maxCarry ?? null, max_early_ms: (i.early ?? 1) * M },
      };
    }),
    order: { order_type: o.order_type ?? 'dine_in', pickup_at_ms: o.pickup_at_ms ?? null, groups: plan.groups },
  });
}

// planOrder at now, then the batch folded at now: the fold puts every line on the plan's station at the plan's
// land (§3.5.1 one sequence).
function submit(state: EngineState, order_id: string, items: Item[], now: number, o: OrderOver = {}, opts?: Opts): { plan: PlanResult; state: EngineState } {
  const p = proposed(order_id, items, o);
  const plan = opts?.prune === false ? planOrderWith(state, p, now, {}, { prune: false }) : planOrder(state, p, now, {});
  const s = fold(state, batch(order_id, items, now, plan, o), opts);
  for (const l of plan.lines) {
    expect(s.lines[l.order_item_id]!.station_id).toBe(l.station_id);
    expect(s.lines[l.order_item_id]!.booked!.end + l.carry_ms).toBe(l.eta_ms);
  }
  return { plan, state: s };
}

function fire(ids: string[], recorded_at: number, station_id = 'S1'): PosEvent {
  return aFireDispatched({
    stream_id: station_id,
    recorded_at,
    occurred_at: recorded_at,
    seq: nextSeq(0),
    payload: { station_id, order_item_ids: ids, due_at: recorded_at, load_id: null, reason: 'scheduled' },
  });
}
function orderEvent(event_type: string, order_id: string, payload: Record<string, unknown>, recorded_at: number): PosEvent {
  const s = nextSeq(0);
  return { ...anItemStarted(), event_type, stream_id: order_id, payload, recorded_at, occurred_at: recorded_at, seq: s, event_id: `01JQ${String(s).padStart(22, '0')}` };
}

const line = (plan: PlanResult, id: string) => plan.lines.find((l) => l.order_item_id === id)!;
const T = (plan: PlanResult, i = 0): number => plan.groups[i]!.target_land_ms;

function maxUnits(s: EngineState, station_id: string, t: number): number {
  const p = liveProfile(s, station_id, t);
  let m = 0;
  for (let i = 0; i < p.t.length; i++) if ((i + 1 === p.t.length ? Infinity : p.t[i + 1]!) > t) m = Math.max(m, p.u[i]!);
  return m;
}

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

// S1 busy 12:00–12:20 (an older immediate line, frozen at the next submit); S2 free; both capacity 1.
function busyS1(settings: Partial<EngineConfig['settings']> = {}, extra: Array<Partial<StationCfg>> = []): EngineState {
  const s = kitchen([{ station_id: 'S1', capacity: 1 }, { station_id: 'S2', capacity: 1 }, ...extra], settings);
  return submit(s, 'OX', [{ id: 'X', cook: 20, mode: 'immediate' }], at(0)).state;
}

describe('@pos/engine routing (§3.5.5)', () => {
  it('[03a #28] immediate: the earliest arrival wins; the station left joins alternates, the plan and the fold agree', () => {
    const s = busyS1();
    const r = submit(s, 'ON', [{ id: 'N', cook: 5, mode: 'immediate', alts: [{ station_id: 'S2', carry_ms: 0, home: false }] }], at(0));
    // Home S1 lands 12:25, S2 12:05: a 20 min gain ≥ min_gain_ms (1 min) → S2.
    expect(line(r.plan, 'N')).toMatchObject({ station_id: 'S2', carry_ms: 0, eta_ms: at(5), alternates: [{ station_id: 'S1', carry_ms: 0, home: true }] });
    expect(r.state.lines.N).toMatchObject({ station_id: 'S2', carry_ms: 0, alternates: [{ station_id: 'S1', carry_ms: 0, home: true }], fire_ms: at(0) });
    expect(r.state.stations.S2!.unfired).toEqual(['N']);
    expect(r.state.stations.S1!.unfired).toEqual(['X']);
    expect(r.state.stations.S2!.profile).toEqual({ t: [at(0), at(5)], u: [1, 0] });
  });

  it('[03a #28] gain < min_gain_ms → home (D9)', () => {
    // min_gain_ms 25 min: S2 beats home by 20 min only → home S1, lands 12:25.
    const s = busyS1({ min_gain_ms: 25 * M });
    const r = submit(s, 'ON', [{ id: 'N', cook: 5, mode: 'immediate', alts: [{ station_id: 'S2', carry_ms: 0, home: false }] }], at(0));
    expect(line(r.plan, 'N')).toMatchObject({ station_id: 'S1', eta_ms: at(25), alternates: [{ station_id: 'S2', carry_ms: 0, home: false }] });
    // A gain exactly at min_gain_ms is not "less than": S2.
    const eq = submit(busyS1({ min_gain_ms: 20 * M }), 'ON', [{ id: 'N', cook: 5, mode: 'immediate', alts: [{ station_id: 'S2', carry_ms: 0, home: false }] }], at(0));
    expect(line(eq.plan, 'N').station_id).toBe('S2');
  });

  it('[03a #28] carry adds to the arrival', () => {
    const s = busyS1();
    // S2 carry 25 min → arrives 12:30, later than home's 12:25 → S1.
    const far = submit(s, 'ON', [{ id: 'N', cook: 5, mode: 'immediate', alts: [{ station_id: 'S2', carry_ms: 25 * M, home: false }] }], at(0));
    expect(line(far.plan, 'N')).toMatchObject({ station_id: 'S1', eta_ms: at(25) });
    // S2 carry 10 min → 12:15, 10 min earlier → S2; eta includes the carry, the line's carry_ms becomes S2's.
    const near = submit(s, 'ON', [{ id: 'N', cook: 5, mode: 'immediate', carry: 2, alts: [{ station_id: 'S2', carry_ms: 10 * M, home: false }] }], at(0));
    expect(line(near.plan, 'N')).toMatchObject({ station_id: 'S2', carry_ms: 10 * M, eta_ms: at(15), alternates: [{ station_id: 'S1', carry_ms: 2 * M, home: true }] });
  });

  it('[03a #28] max_carry_ms (the line\'s copy) filters an alternate; the home station is never filtered', () => {
    const s = busyS1();
    const alt = [{ station_id: 'S2', carry_ms: 10 * M, home: false }];
    expect(line(submit(s, 'ON', [{ id: 'N', cook: 5, mode: 'immediate', alts: alt, maxCarry: 10 * M - 1 }], at(0)).plan, 'N').station_id).toBe('S1');
    expect(line(submit(s, 'ON', [{ id: 'N', cook: 5, mode: 'immediate', alts: alt, maxCarry: 10 * M }], at(0)).plan, 'N').station_id).toBe('S2');
    // Home carry 30 min > max 5 min: home stays allowed (S2's 25 min gain still wins, carry 10 > 5 is filtered → home).
    const home = submit(s, 'ON', [{ id: 'N', cook: 5, mode: 'immediate', carry: 30, alts: alt, maxCarry: 5 * M }], at(0));
    expect(line(home.plan, 'N')).toMatchObject({ station_id: 'S1', eta_ms: at(55) });
  });

  it('[03a #28] a paused or batch alternate is never offered (P-3, D21)', () => {
    const paused = fold(busyS1(), []);
    const st = { ...paused, stations: { ...paused.stations, S2: { ...paused.stations.S2!, paused: true } } };
    const p = submit(deepFreeze(st), 'ON', [{ id: 'N', cook: 5, mode: 'immediate', alts: [{ station_id: 'S2', carry_ms: 0, home: false }] }], at(0));
    expect(line(p.plan, 'N').station_id).toBe('S1');
    const batchSt = busyS1({}, [{ station_id: 'S3', capacity: 4, station_type: 'batch' }]);
    const b = submit(batchSt, 'ON', [{ id: 'N', cook: 5, mode: 'immediate', alts: [{ station_id: 'S3', carry_ms: 0, home: false }] }], at(0));
    expect(line(b.plan, 'N').station_id).toBe('S1');
  });

  it('[03a #28] sync: fits at any allowed station ending at T − carry; preference home, then lowest carry, then station_id', () => {
    const three = (): EngineState => {
      const s = kitchen([{ station_id: 'S1', capacity: 1 }, { station_id: 'S2', capacity: 1 }, { station_id: 'S3', capacity: 1 }]);
      return submit(s, 'OX', [{ id: 'X', cook: 20, mode: 'immediate' }], at(0)).state;
    };
    // Home S1 busy until 12:20: T = 12:11 on S3 (carry 1) rather than S2 (carry 2, ready 12:12) or home (12:30).
    const a = submit(three(), 'ON', [{ id: 'N', cook: 10, alts: [{ station_id: 'S2', carry_ms: 2 * M, home: false }, { station_id: 'S3', carry_ms: M, home: false }] }], at(0));
    expect(T(a.plan)).toBe(at(11));
    expect(line(a.plan, 'N')).toMatchObject({ station_id: 'S3', carry_ms: M, eta_ms: at(11) });
    expect(a.state.lines.N!.deadline_ms).toBe(at(0));
    // Equal carry → station_id: S2.
    const b = submit(three(), 'ON', [{ id: 'N', cook: 10, alts: [{ station_id: 'S3', carry_ms: M, home: false }, { station_id: 'S2', carry_ms: M, home: false }] }], at(0));
    expect(line(b.plan, 'N').station_id).toBe('S2');
    // Home free: home wins at the same T even when an alternate has a lower carry.
    const free = kitchen([{ station_id: 'S1', capacity: 1 }, { station_id: 'S2', capacity: 1 }]);
    const c = submit(free, 'ON', [{ id: 'N', cook: 10, carry: 1, alts: [{ station_id: 'S2', carry_ms: 0, home: false }] }], at(0));
    // T starts at the smallest land over the stations (S2: 12:10), where only S2 fits; home is preferred only where it fits.
    expect(line(c.plan, 'N')).toMatchObject({ station_id: 'S2', eta_ms: at(10) });
    const d = submit(free, 'ON', [{ id: 'N', cook: 10, alts: [{ station_id: 'S2', carry_ms: 0, home: false }] }], at(0));
    expect(line(d.plan, 'N')).toMatchObject({ station_id: 'S1', eta_ms: at(10) });
    // A home-marked alternate is the home: preferred over the routed station.
    const e = submit(free, 'ON', [{ id: 'N', cook: 10, alts: [{ station_id: 'S2', carry_ms: 0, home: true }] }], at(0));
    expect(line(e.plan, 'N')).toMatchObject({ station_id: 'S2', alternates: [{ station_id: 'S1', carry_ms: 0, home: false }] });
  });

  it('[03a #28] sync group: lines spread over home and alternate land together at the smallest T', () => {
    const s = kitchen([{ station_id: 'S1', capacity: 1 }, { station_id: 'S2', capacity: 1 }]);
    const alt = [{ station_id: 'S2', carry_ms: 0, home: false }];
    const r = submit(s, 'ON', [{ id: 'A', cook: 10, alts: alt }, { id: 'B', cook: 10, alts: alt }], at(0));
    // Both at 12:10, one per station (no D36 serialisation to 12:20).
    expect(T(r.plan)).toBe(at(10));
    expect(new Set(r.plan.lines.map((l) => l.station_id))).toEqual(new Set(['S1', 'S2']));
    expect(r.plan.lines.every((l) => l.eta_ms === at(10))).toBe(true);
  });

  it('[03a #29] reserve units are usable only by the station\'s home order types (D8)', () => {
    // S1 capacity 2 with 1 reserved, one unit busy 12:00–12:20; S2 (capacity 1) busy until 12:30.
    const build = (reserve: number): EngineState => {
      let s = kitchen([{ station_id: 'S1', capacity: 2, reserve_units: reserve }, { station_id: 'S2', capacity: 1 }]);
      s = submit(s, 'OX', [{ id: 'X', cook: 20, mode: 'immediate' }], at(0)).state;
      return submit(s, 'OY', [{ id: 'Y', cook: 30, mode: 'immediate', st: 'S2' }], at(0)).state;
    };
    const s = build(1);
    // A takeaway line routed to S2 (home for takeaway), S1 an alternate not home for takeaway: it sees capacity
    // 2 − 1 = 1, in use until 12:20 → lands 12:25 on S1 (S2 would be 12:35).
    const tk = submit(s, 'OT', [{ id: 'K', cook: 5, mode: 'immediate', st: 'S2', alts: [{ station_id: 'S1', carry_ms: 0, home: false }] }], at(0), { order_type: 'takeaway' });
    expect(line(tk.plan, 'K')).toMatchObject({ station_id: 'S1', eta_ms: at(25) });
    // Without the reserve it would take the free unit at 12:00.
    const open = submit(build(0), 'OT', [{ id: 'K', cook: 5, mode: 'immediate', st: 'S2', alts: [{ station_id: 'S1', carry_ms: 0, home: false }] }], at(0), { order_type: 'takeaway' });
    expect(line(open.plan, 'K')).toMatchObject({ station_id: 'S1', eta_ms: at(5) });
    // A dine-in line routed to S2 whose dine-in home is S1 (home_for_order_types): uses the reserved unit at 12:00.
    const di = submit(s, 'OD', [{ id: 'D', cook: 5, mode: 'immediate', st: 'S2', alts: [{ station_id: 'S1', carry_ms: 0, home: true }] }], at(0));
    expect(line(di.plan, 'D')).toMatchObject({ station_id: 'S1', eta_ms: at(5) });
    // And a line routed to S1 with no alternate (S1 its home) uses it too.
    const own = submit(s, 'OO', [{ id: 'H', cook: 5, mode: 'immediate' }], at(0));
    expect(line(own.plan, 'H')).toMatchObject({ station_id: 'S1', eta_ms: at(5) });
    expect(maxUnits(own.state, 'S1', at(0))).toBe(2);
  });

  it('[03a #29] reserve applies in the sync loop too: a non-home sync line never takes the reserved unit', () => {
    let s = kitchen([{ station_id: 'S1', capacity: 2, reserve_units: 1 }, { station_id: 'S2', capacity: 1 }]);
    s = submit(s, 'OX', [{ id: 'X', cook: 20, mode: 'immediate' }], at(0)).state;
    s = submit(s, 'OY', [{ id: 'Y', cook: 30, mode: 'immediate', st: 'S2' }], at(0)).state;
    const r = submit(s, 'OT', [{ id: 'K', cook: 5, st: 'S2', alts: [{ station_id: 'S1', carry_ms: 0, home: false }] }], at(0), { order_type: 'takeaway' });
    expect(T(r.plan)).toBe(at(25));
    expect(line(r.plan, 'K').station_id).toBe('S1');
  });
});

// The #30 fixture: S1, S2 capacity 1. A1 (cook 20) fired on S1 at 12:00 and never started, so it packs from t
// (§3.3). H (cook 20, delivery for 13:00) is held on its home S1 at fire 12:40 (deadline 12:40). A submit for S1
// at `t` re-plans S1: at 12:30 A1 packs [12:30, 12:50), so H no longer fits on S1.
function heldH(alts: Alt[], maxCarry: number | null = null, extra: Array<Partial<StationCfg>> = []): EngineState {
  let s = kitchen([{ station_id: 'S1', capacity: 1 }, { station_id: 'S2', capacity: 1 }, ...extra]);
  s = submit(s, 'OA', [{ id: 'A1', cook: 20, mode: 'immediate' }], at(0)).state;
  s = fold(s, [fire(['A1'], at(0))]);
  s = submit(s, 'OB', [{ id: 'H', cook: 20, alts, maxCarry }], at(0), { order_type: 'delivery', pickup_at_ms: at(60) }).state;
  expect(s.lines.H).toMatchObject({ station_id: 'S1', fire_ms: at(40), deadline_ms: at(40) });
  return s;
}
const S2ALT: Alt[] = [{ station_id: 'S2', carry_ms: 0, home: false }];

describe('@pos/engine re-routing (§3.5.5 D10)', () => {
  it('[03a #30] a hidden line that no longer fits on its station moves to an alternate in the re-plan; exactly its booking moves (AD-7)', () => {
    const s = heldH(S2ALT);
    const r = submit(s, 'OC', [{ id: 'C1', cook: 1, mode: 'immediate' }], at(30));
    // Pass 1 on S1: H fits neither by d − keep nor by d on S1 → re-placed on S2 within its keep (12:39).
    expect(r.state.lines.H).toMatchObject({ station_id: 'S2', carry_ms: 0, fire_ms: at(39), deadline_ms: at(40), alternates: [{ station_id: 'S1', carry_ms: 0, home: true }] });
    expect(r.state.lines.H!.booked).toEqual({ start: at(39), end: at(59), units: 1 });
    expect(r.state.stations.S1!.unfired).toEqual(['C1']);
    expect(r.state.stations.S2!.unfired).toEqual(['H']);
    expect(r.state.stations.S1!.profile).toEqual({ t: [at(50), at(51)], u: [1, 0] });
    expect(r.state.stations.S2!.profile).toEqual({ t: [at(39), at(59)], u: [1, 0] });
    // The fired line A1 never moves.
    expect(r.state.lines.A1).toEqual(s.lines.A1);
  });

  it('[03a #30] a frozen line stays on its station even when late; a hidden line that fits stays put', () => {
    const s = heldH(S2ALT);
    // At 12:39 H (fire 12:40 ≤ t + freeze) is frozen: fixed input, it keeps S1.
    const frozen = submit(s, 'OC', [{ id: 'C1', cook: 1, mode: 'immediate' }], at(39));
    expect(frozen.state.lines.H).toMatchObject({ station_id: 'S1', fire_ms: at(40) });
    expect(frozen.state.stations.S2!.unfired).toEqual([]);
    // At 12:10 A1 packs [12:10, 12:30): H fits on S1 within d − keep → stays on S1 (12:39), S2 unused.
    const fits = submit(s, 'OC', [{ id: 'C1', cook: 1, mode: 'immediate' }], at(10));
    expect(fits.state.lines.H).toMatchObject({ station_id: 'S1', fire_ms: at(39) });
    expect(fits.state.stations.S2!.unfired).toEqual([]);
  });

  it('[03a #28] max_carry_ms from the line drives re-routing (#80 routing part)', () => {
    const alt: Alt[] = [{ station_id: 'S2', carry_ms: M, home: false }];
    // Carry 1 min ≤ max 1 min: re-routed, its deadline on S2 shifted by the carry (12:39), fire 12:38 (keep).
    const ok = submit(heldH(alt, M), 'OC', [{ id: 'C1', cook: 1, mode: 'immediate' }], at(30));
    expect(ok.state.lines.H).toMatchObject({ station_id: 'S2', carry_ms: M, deadline_ms: at(39), fire_ms: at(38) });
    expect(ok.state.lines.H!.deadline_ms + 20 * M + M).toBe(at(60)); // its slot still lands at T through the carry
    // max 1 min − 1 ms: S2 is filtered; H stays on S1 and goes to the late set (§3.5.6).
    const no = submit(heldH(alt, M - 1), 'OC', [{ id: 'C1', cook: 1, mode: 'immediate' }], at(30));
    expect(no.state.lines.H!.station_id).toBe('S1');
    expect(no.state.stations.S2!.unfired).toEqual([]);
  });

  it('[03a §3.5.5] a re-plan never moves a line onto a FIFO station; a non-FIFO sync line is not offered a FIFO alternate', () => {
    const s = heldH(S2ALT, null, [{ station_id: 'S2', capacity: 1, policy: 'fifo' }]);
    const r = submit(s, 'OC', [{ id: 'C1', cook: 1, mode: 'immediate' }], at(30));
    expect(r.state.lines.H!.station_id).toBe('S1');
    expect(r.state.stations.S2!.unfired).toEqual([]);
  });

  it('[03a §3.5.3] FireDispatched skips a listed line that already fired elsewhere (the station check is only for lines about to fire)', () => {
    const s = heldH(S2ALT);
    const r = submit(s, 'OC', [{ id: 'C1', cook: 1, mode: 'immediate' }], at(30)).state;
    const fired = fold(r, [fire(['H'], at(38), 'S2')]);
    expect(fired.lines.H!.fired_at).toBe(at(38));
    // A stale FireDispatched of S1 re-listing H (fired on S2) changes nothing and does not throw (strict).
    const again = fold(fired, [fire(['A1', 'H'], at(39), 'S1')]);
    expect(again.lines.H).toEqual(fired.lines.H);
    expect(again.lines.A1).toEqual(fired.lines.A1);
    // A done line re-listed on another station: also skipped.
    const done = fold(fired, [orderEvent('ItemDone', 'OB', { order_item_id: 'H', done_at: at(40), source: 'tap' }, at(40))]);
    expect(() => fold(done, [fire(['H'], at(41), 'S1')])).not.toThrow();
    // An unfired line listed on another station is still a writer bug (AD-8).
    expect(() => fold(r, [fire(['C1'], at(31), 'S2')])).toThrow();
  });
});

describe('@pos/engine routing invariants', () => {
  it('[03a §3.5.5] with carry 0 and no alternates — or alternates that are all filtered out — the plan is the routed station\'s (task 7)', () => {
    for (let run = 0; run < 30; run++) {
      const rnd = prng(1_100 + run);
      const base = kitchen([
        { station_id: 'S1', capacity: 1 + rnd(3) },
        { station_id: 'S2', capacity: 1 + rnd(3) },
        { station_id: 'S3', capacity: 2, station_type: 'batch' },
      ]);
      const paused: EngineState = deepFreeze({ ...base, stations: { ...base.stations, S4: { ...base.stations.S1!, station_id: 'S4', paused: true } } });
      let s = paused;
      let now = T0;
      const items = (prefix: string, filtered: boolean): Item[] => {
        const n = 1 + rnd(3);
        const out: Item[] = [];
        for (let k = 0; k < n; k++) {
          const st = rnd(2) === 0 ? 'S1' : 'S2';
          out.push({
            id: `${prefix}L${k}`,
            st,
            cook: 1 + rnd(20),
            mode: rnd(4) === 0 ? 'immediate' : 'sync',
            maxCarry: filtered ? 5 * M : null,
            alts: filtered
              ? [
                  { station_id: 'S3', carry_ms: 0, home: false }, // batch (P-3)
                  { station_id: 'S4', carry_ms: 0, home: false }, // paused
                  { station_id: st === 'S1' ? 'S2' : 'S1', carry_ms: 6 * M, home: false }, // carry > max_carry_ms
                ]
              : [],
          });
        }
        return out;
      };
      for (let k = 0; k < 6; k++) {
        const filteredItems = items(`O${run}_${k}`, true);
        const plain = filteredItems.map((i) => ({ ...i, alts: [], maxCarry: null }));
        const pickup = rnd(3) === 0 ? null : now + (5 + rnd(40)) * M;
        const a = planOrder(s, proposed(`O${run}_${k}`, plain, { pickup_at_ms: pickup }), now, {});
        const b = planOrder(s, proposed(`O${run}_${k}`, filteredItems, { pickup_at_ms: pickup }), now, {});
        expect(b.groups).toEqual(a.groups);
        expect(b.lines.map(({ alternates, ...l }) => (void alternates, l))).toEqual(a.lines.map(({ alternates, ...l }) => (void alternates, l)));
        for (const l of a.lines) expect(l.station_id).toBe(plain.find((i) => i.id === l.order_item_id)!.st);
        s = fold(s, batch(`O${run}_${k}`, plain, now, a, { pickup_at_ms: pickup }));
        now += rnd(3) * M;
      }
    }
  });

  it('[03a §3.5.1] property, 40 seeds: with alternates, the fold places every line where planOrder did; no over-booking; pruned T ≤ unpruned T', () => {
    const stations = ['S1', 'S2', 'S3'];
    let routed = 0;
    let rerouted = 0;
    for (let run = 0; run < 40; run++) {
      const rnd = prng(3_000 + run);
      const caps = stations.map(() => 1 + rnd(3));
      let s = kitchen(stations.map((st, i) => ({ station_id: st, capacity: caps[i]!, reserve_units: rnd(3) === 0 ? 1 : 0 })), { min_gain_ms: rnd(3) * M });
      let now = T0;
      const items = (prefix: string): Item[] => {
        const n = 1 + rnd(3);
        const out: Item[] = [];
        for (let k = 0; k < n; k++) {
          const si = rnd(3);
          const alts: Alt[] = [];
          for (let j = 0; j < 3; j++) if (j !== si && rnd(2) === 0) alts.push({ station_id: stations[j]!, carry_ms: rnd(3) * M, home: rnd(5) === 0 });
          out.push({ id: `${prefix}L${k}`, st: stations[si], cook: 1 + rnd(20), mode: rnd(4) === 0 ? 'immediate' : 'sync', units: 1 + rnd(2), carry: rnd(2), alts, maxCarry: rnd(3) === 0 ? M : null, early: rnd(15) });
        }
        return out;
      };
      for (let k = 0; k < 7; k++) {
        const lines = Object.values(s.lines);
        const toStart = lines.filter((l) => l.stage === 'added' && l.fired_at !== null);
        const due = lines.filter((l) => l.stage === 'added' && l.fired_at === null && l.fire_ms !== null && l.fire_ms <= now);
        s = fold(s, [
          ...toStart.map((l) => orderEvent('ItemStarted', l.order_id, { order_item_id: l.order_item_id, started_at: now, source: 'tap' }, now)),
          ...stations.flatMap((st) => {
            const ids = due.filter((l) => l.station_id === st).map((l) => l.order_item_id);
            return ids.length > 0 ? [fire(ids, now, st)] : [];
          }),
        ]);
        const before = s;
        const its = items(`O${run}_${k}`);
        const pickup = rnd(3) === 0 ? null : now + (5 + rnd(40)) * M;
        const P = submit(s, `O${run}_${k}`, its, now, { pickup_at_ms: pickup });
        const U = submit(s, `O${run}_${k}`, its, now, { pickup_at_ms: pickup }, { prune: false });
        for (let g = 0; g < P.plan.groups.length; g++) expect(T(P.plan, g)).toBeLessThanOrEqual(T(U.plan, g));
        for (const l of P.plan.lines) if (l.station_id !== its.find((i) => i.id === l.order_item_id)!.st) routed++;
        for (const l of Object.values(before.lines)) if (P.state.lines[l.order_item_id] !== undefined && P.state.lines[l.order_item_id]!.station_id !== l.station_id) rerouted++;
        for (const [i, st] of stations.entries()) {
          if (maxUnits(before, st, now) > caps[i]!) continue;
          expect(maxUnits(P.state, st, now)).toBeLessThanOrEqual(caps[i]!);
        }
        // Every unfired line is in its station's unfired list, (fire, id)-ordered, and its booking is in that profile.
        for (const st of stations) {
          const ids = P.state.stations[st]!.unfired;
          for (const id of ids) expect(P.state.lines[id]!.station_id).toBe(st);
          const sorted = [...ids].sort((x, y) => P.state.lines[x]!.fire_ms! - P.state.lines[y]!.fire_ms! || (x < y ? -1 : 1));
          expect(ids).toEqual(sorted);
        }
        s = P.state;
        now += rnd(3) * M;
      }
    }
    // Not vacuous: lines were routed off their routed station, and hidden lines re-routed by later re-plans.
    expect(routed).toBeGreaterThan(0);
    expect(rerouted).toBeGreaterThan(0);
  });
});

describe('@pos/engine void re-plan with only FIFO siblings (carried from task 9)', () => {
  it('[03a §3.5.3] voiding the critical line of a group whose other lines are all FIFO lowers T to max(pickup, FIFO lands); P unchanged', () => {
    let s = kitchen([{ station_id: 'S1', capacity: 1 }, { station_id: 'S2', capacity: 1, policy: 'fifo' }]);
    const r = submit(s, 'OG', [{ id: 'W', cook: 30 }, { id: 'F', cook: 5, st: 'S2' }], at(0));
    s = r.state;
    expect(T(r.plan)).toBe(at(30));
    const P = s.orders.OG!.promise_ms;
    const v = fold(s, [orderEvent('ItemVoided', 'OG', { order_item_id: 'W', units: 1 }, at(1))]);
    expect(v.orders.OG!.groups['OG:0']!.target_land_ms).toBe(at(5));
    expect(v.orders.OG!.target_land_ms).toBe(at(5));
    expect(v.orders.OG!.promise_ms).toBe(P);
    expect(v.lines.F).toMatchObject({ station_id: 'S2', fire_ms: at(0), deadline_ms: at(0) });
  });
});
