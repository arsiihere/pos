// 03a §3.2 (lines, units, cook time) and §3.5.1 (target and promise at submit: planOrder, calculateETA,
// checkOrderable; the fold plans at the ItemAdded that brings awaiting to 0, through the same placement).
// Pure: no clock, no ids; t is the triggering event's recorded_at or the handler's now.
import { DomainError } from '@pos/domain';
import type { ItemAddedPayload } from '@pos/events';
import { InvalidEvent } from './invalid-event.js';
import { effectiveCapacity } from './capacity.js';
import { liveInterval, liveProfiles } from './live.js';
import { addInterval, earliestFit, latestFit, occupancy, removeInterval } from './profile.js';
import { applyMoves, bookingAt, capacityFor, fixedProfiles, heldAfterFrozen, isFifo, isFifoLine, isHidden, pass1, placeFrozen, placementCap, sortUnfired, stationPolicy, syncOrder, type FrozenStep, type Move, type NewLine, type Placement } from './replan.js';
import { chooseImmediate, rerouted, routeCtx, routeOptions, type RouteOption } from './route.js';
import { asLoad, currentProgram, earliestJoinEnd, formed, freshnessOf, immediateJoin, joinAdvance, joinLine, nameLoads, placedUnderOldType, replaced, syncJoin, withMember, workOf, type WorkLoad } from './batch.js';
import type { Diagnostic, EngineLine, EngineState, Load, Profile, StationRuntime } from './state.js';
import type { Pass1Result } from './replan.js';

// §3.2: a line is an ItemAdded with station_id not null and line_kind ≠ 'deal' (01c §3.4.7).
export function isEngineLine(item: Pick<ItemAddedPayload, 'station_id' | 'line_kind'>): boolean {
  return item.station_id !== null && item.line_kind !== 'deal';
}

// §3.2 P-1: quantity for a piece line; 1 for a g / ml line and while a weight is pending (01c V18).
// A filled line therefore has units ≥ 1; units 0 marks a placeholder not yet seen (AD-8).
export function lineUnits(item: Pick<ItemAddedPayload, 'sale_unit' | 'quantity' | 'order_item_id'>): number {
  if (item.sale_unit !== 'piece' || item.quantity === null) return 1;
  if (item.quantity < 1) throw new InvalidEvent('quantity_invalid', item.order_item_id);
  return item.quantity;
}

// AD-6 / AD-8(c): InvalidEvent (its own module, shared with replan.ts).
export { InvalidEvent } from './invalid-event.js';

function required<T>(value: T | null, field: string, order_item_id: string): T {
  if (value === null) throw new InvalidEvent(`${field}_null`, order_item_id);
  return value;
}

// §3.2 (01c B1): slot → stock_time_ms when served from stock, else cook_time_ms; batch → the copied
// stock_program_cook_time_ms / program_cook_time_ms, never config. full_cook_ms is the fresh cook,
// stock_cook_ms the copied stock cook (null when none).
export function lineCookTimes(
  item: ItemAddedPayload,
  type: StationRuntime['type'],
  from_stock: boolean,
): Pick<EngineLine, 'cook_ms' | 'full_cook_ms' | 'stock_cook_ms'> {
  const full =
    type === 'slot'
      ? required(item.cook_time_ms, 'cook_time_ms', item.order_item_id)
      : required(item.program_cook_time_ms, 'program_cook_time_ms', item.order_item_id);
  const stock = type === 'slot' ? item.stock_time_ms : item.stock_program_cook_time_ms;
  // 01c V12: a from-stock line always has its stock cook time; a null one is a writer bug, never the full cook.
  if (from_stock && stock === null) {
    throw new InvalidEvent(type === 'slot' ? 'stock_time_ms_null' : 'stock_program_cook_time_ms_null', item.order_item_id);
  }
  return { cook_ms: from_stock ? stock! : full, full_cook_ms: full, stock_cook_ms: stock };
}

// §3.8a (D28): what a line of an OrderLinesAdded / ProposedOrder is to the engine. A return line (return_of set)
// is immediate, never from stock (its draws are [] in the fold, so reserveStock has nothing to reserve) and cooks
// for the event's cook_ms_override on `fix` (the item's adjust_time_ms copied by 02, never config) or the normal
// fresh cook on `remake`; ItemAdded's serve_mode, stock time and from_stock are not taken. Any other line: §3.2.
export type ReturnLink = { return_of: EngineLine['return_of']; cook_ms_override: number | null };
export function lineShape(
  item: ItemAddedPayload,
  link: ReturnLink,
  type: StationRuntime['type'],
  from_stock: boolean,
): { serve_mode: EngineLine['serve_mode']; from_stock: boolean } & Pick<EngineLine, 'cook_ms' | 'full_cook_ms' | 'stock_cook_ms'> {
  const id = item.order_item_id;
  if (link.return_of === null) {
    return { serve_mode: required(item.serve_mode, 'serve_mode', id), from_stock, ...lineCookTimes(item, type, from_stock) };
  }
  if (link.return_of.mode === 'fix') {
    const cook = required(link.cook_ms_override, 'cook_ms_override', id);
    return { serve_mode: 'immediate', from_stock: false, cook_ms: cook, full_cook_ms: cook, stock_cook_ms: null };
  }
  return { serve_mode: 'immediate', from_stock: false, ...lineCookTimes(item, type, false) };
}

// §3.2: d(L) = T − carry − cook − prep, the latest fire that lands on target.
// Review fix (AD-4): cook = the occupancy cook at the station's effective capacity, so an over-capacity line's
// deadline lands its last round at T − carry. This is the deadline of an unqueued line; a line queued behind
// same-station siblings (F §4.7 D36) gets its queued deadline at placement (AD-12, queuedDeadline).
export function deadlineOf(line: Pick<EngineLine, 'carry_ms' | 'cook_ms' | 'prep_ms' | 'units'>, target_land_ms: number, cap: number): number {
  return target_land_ms - line.carry_ms - occupancy(line.units, cap, line.cook_ms).cook_ms - line.prep_ms;
}

// AD-12 (developer ruling): a line's deadline is its own slot in the D36 queue: d = slot end − cook(occupancy) −
// prep, slot end ≤ T − carry the end the serialisation gave the line (T − carry when not queued). The placement
// was made by a loop whose result `loopT` may differ from the stored target T (append gap, §3.5.3; for an
// immediate line loopT is its own land time); the queue keeps its shape, so slot end = booked.end − (loopT − T)
// and d = fire − (loopT − T). For planOrder at now = recorded_at loopT = T and d = the planned fire.
export function queuedDeadline(fire: number, loopT: number, T: number): number {
  return fire - (loopT - T);
}

export { effectiveCapacity } from './capacity.js';

// Task 13 (01a S11: a batch route requires a program; D49): a batch line whose current program (BF-1) is null is a
// writer bug — InvalidEvent program_id_null (stock_program_id_null for a from-stock line).
export function checkProgram(line: Pick<EngineLine, 'order_item_id' | 'from_stock' | 'program_id' | 'stock_program_id'>, station: Pick<StationRuntime, 'type' | 'station_id'>): void {
  if (station.type === 'batch' && currentProgram(line) === null) {
    throw new InvalidEvent(line.from_stock ? 'stock_program_id_null' : 'program_id_null', line.order_item_id, station.station_id);
  }
}

// ---- §3.5.1 steps 3–4: the one placement sequence of planOrder and the fold ----------------------------------

// What the placement reads of a line (an EngineLine, or a line built from a ProposedOrder). The program fields are
// read on a batch station only (task 13: currentProgram, BF-1).
type PlanLine = Pick<
  EngineLine,
  'order_item_id' | 'station_id' | 'units' | 'prep_ms' | 'cook_ms' | 'carry_ms' | 'max_early_ms' | 'from_stock' | 'program_id' | 'stock_program_id'
> & { return_of?: EngineLine['return_of'] };

// A placement with the station it was made on (§3.5.5) and that station's carry to the point.
// fallback = 'reserve': no allowed station could take the line, booked on its own at full capacity (route.ts).
// On a batch station (task 13) `booked` is the line's load booking (the whole station) and `fire` the load's fire;
// the line itself books nothing (the load is booked once, storeLoads).
export type Routed = Placement & { station_id: string; carry_ms: number; fallback?: 'reserve' };

// Task 13: the unfired loads of each batch station during one placement (from pass 1, then the new lines').
type Loads = Record<string, WorkLoad[]>;

// The line's booking fits on p when fired at `fire` (latestFit over the one-point window [fire, fire]).
function fitsAt(p: Profile, line: PlanLine, cap: number, fire: number): boolean {
  return latestFit(p, fire, fire, line.prep_ms, line.cook_ms, line.units, cap) === fire;
}

// Fire of a sync line whose station interval ends at `end` (F §4.7 step 4: latest_start = end − cook − prep).
function fireEndingAt(line: PlanLine, cap: number, end: number): number {
  return end - occupancy(line.units, cap, line.cook_ms).cook_ms - line.prep_ms;
}

function stationOf(stations: Readonly<Record<string, StationRuntime>>, line: Pick<PlanLine, 'station_id' | 'order_item_id'>): StationRuntime {
  const station = stations[line.station_id];
  // Unreachable through the folds (the ItemAdded fold checked the station); a ProposedOrder naming a station the
  // engine has no runtime for is a caller bug.
  if (station === undefined) throw new InvalidEvent('station_missing', line.order_item_id, line.station_id);
  capacityFor(station, line.order_item_id); // capacity < 1 → InvalidEvent capacity_invalid (task 7 review ruling)
  return station;
}

// One trial of the F §4.7 step 3 full pass at candidate T. Each sync line's station interval ends at T − carry
// (hold, D16). Same-station siblings that collide only with each other are serialised (F §4.7 "Intra-order
// collisions", D36): taken in syncOrder (shortest first), packed back from T so the shortest lands at T and each
// longer one ends where the later siblings start. §3.5.5 (task 11): "at candidate T, it fits if it fits at any
// allowed station with interval ending at T − carry; preference: home, then lowest carry, then station_id" — each
// line tries its allowed stations in that order (at its capacity there, D8 reserve) and takes the first that fits.
// A line that fits nowhere gives, per station, the smallest advance of T that clears its conflict there; "T
// advances by the smallest advance over all allowed stations"; the caller then repeats the full pass at the
// advanced T (a pass is trusted only when nothing advanced). With one allowed station per line this is task 7's
// trial exactly.
// Task 13, a batch station (F §4.7 step 3): the line fits at T when (a) it joins an unfired load of its program with
// room whose end is ≤ T − carry and within the freshness window (capped by max_early_ms, batch.ts), or (b) a new
// load — the whole station, so it never overlaps another load — ends at T − carry (prep done by then); same-order
// loads of other programs chain as D36 siblings. Otherwise T advances by the smallest advance to the next time (a)
// or (b) holds. Loads formed in the trial are joinable by the lines after them (the trial's own copy of `loads`).
function trySyncAt(
  profiles: Readonly<Record<string, Profile>>,
  order: readonly PlanLine[],
  options: ReadonlyMap<string, readonly RouteOption[]>,
  fifo: ReadonlySet<string>,
  T: number,
  t: number,
  loads: Readonly<Loads>,
  windows: ReadonlyMap<string, number>,
): { ok: true; placements: Map<string, Routed>; profiles: Record<string, Profile>; loads: Loads } | { ok: false; advance: number } {
  const cur: Record<string, Profile> = { ...profiles };
  const curLoads: Loads = { ...loads };
  const chainStart = new Map<string, number>();
  const placements = new Map<string, Routed>();
  for (const plan of order) {
    let advance = Number.POSITIVE_INFINITY;
    let nonPositive: number | null = null;
    let placed = false;
    for (const o of options.get(plan.order_item_id)!) {
      const sid = o.station_id;
      const cap = o.cap;
      const batch = windows.get(sid);
      // A batch line is fitted as a whole-station booking (batch.ts asLoad).
      const line = batch === undefined ? plan : asLoad(plan, cap);
      if (batch !== undefined && !fifo.has(sid)) {
        const jl = joinLine(plan);
        const list = curLoads[sid] ?? [];
        const b = syncJoin(list, jl, cap, T - o.carry_ms, batch, t);
        if (b !== undefined) {
          const j = withMember(b, jl);
          curLoads[sid] = replaced(list, b, j);
          placements.set(plan.order_item_id, { fire: j.fire_ms, booked: b.booked, station_id: sid, carry_ms: o.carry_ms });
          placed = true;
          break;
        }
        advance = Math.min(advance, joinAdvance(list, jl, cap, T - o.carry_ms, t));
      }
      const base = profiles[sid]!;
      const here = cur[sid]!;
      const cs = chainStart.get(sid);
      const f0 = fireEndingAt(line, cap, T - o.carry_ms);
      let fire: number | null = null;
      let a = 0;
      if (fifo.has(sid)) {
        // §3.5.3 / AD-14 (task 11 review): a FIFO station takes the line at its earliest fit from t, never held;
        // it fits at T when it lands by T (its land floors the group's T), else T must reach that land.
        const e = earliestFit(here, t, line.prep_ms, line.cook_ms, line.units, cap);
        const land = bookingAt(line, cap, e).end + o.carry_ms;
        if (land <= T) fire = e;
        else a = land - T;
      } else if (f0 >= t && fitsAt(here, line, cap, f0)) {
        fire = f0;
      } else if (cs !== undefined && f0 >= t && fitsAt(base, line, cap, f0)) {
        // D36: the conflict is with this order's own siblings only: end where they start.
        const f = fireEndingAt(line, cap, Math.min(T - o.carry_ms, cs));
        if (f >= t && fitsAt(here, line, cap, f)) {
          fire = f;
        } else {
          // The siblings move with T, so the advance is measured against the profile without them.
          a = earliestFit(base, Math.max(f, t), line.prep_ms, line.cook_ms, line.units, cap) - f;
          if (a <= 0) a = earliestFit(here, Math.max(f, t), line.prep_ms, line.cook_ms, line.units, cap) - f;
        }
      } else {
        a = earliestFit(base, Math.max(f0, t), line.prep_ms, line.cook_ms, line.units, cap) - f0;
      }
      if (fire !== null) {
        const booked = bookingAt(line, cap, fire);
        cur[sid] = addInterval(here, booked, booked.units);
        if (!fifo.has(sid)) chainStart.set(sid, Math.min(cs ?? Number.POSITIVE_INFINITY, booked.start));
        if (batch !== undefined) curLoads[sid] = [...(curLoads[sid] ?? []), formed(joinLine(plan), fire, booked)];
        placements.set(plan.order_item_id, { fire, booked, station_id: sid, carry_ms: o.carry_ms, ...(o.fallback === 'reserve' ? { fallback: 'reserve' as const } : {}) });
        placed = true;
        break;
      }
      if (a > 0) advance = Math.min(advance, a);
      else nonPositive ??= a;
    }
    if (!placed) return { ok: false, advance: advance === Number.POSITIVE_INFINITY ? (nonPositive ?? 0) : advance };
  }
  return { ok: true, placements, profiles: cur, loads: curLoads };
}

// Task 13: the freshness window of every batch station (its presence marks the station as batch).
function batchWindows(state: EngineState): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of Object.values(state.stations)) if (s.type === 'batch') out.set(s.station_id, freshnessOf(state, s.station_id));
  return out;
}

// Task 13, step 3 on a batch station (F §4.7 "For immediate items at a batch station: join the earliest
// not-yet-fired load with room …; if none exists, create a new load"; batch.ts J3): a new load at its earliest fit
// from t, unless a compatible load lands no later.
function placeBatchImmediate(
  profile: Profile,
  list: readonly WorkLoad[],
  line: PlanLine,
  cap: number,
  t: number,
): { fire: number; booked: { start: number; end: number; units: number }; loads: WorkLoad[]; formed: boolean } {
  const W = asLoad(line, cap);
  const fire = earliestFit(profile, t, W.prep_ms, W.cook_ms, W.units, cap);
  const booked = bookingAt(W, cap, fire);
  const jl = joinLine(line);
  const b = immediateJoin(list, jl, cap, booked.end, t);
  if (b !== undefined) {
    const j = withMember(b, jl);
    return { fire: j.fire_ms, booked: b.booked, loads: replaced(list, b, j), formed: false };
  }
  return { fire, booked, loads: [...list, formed(jl, fire, booked)], formed: true };
}

// §3.5.1 step 3, one immediate line: on a batch station its load (P-3: its own station only), else its earliest fit
// on each allowed station with the choice of §3.5.5 (minimum arrival; home unless beaten by ≥ min_gain_ms).
function placeImmediate(
  state: EngineState,
  ctx: ReturnType<typeof routeCtx>,
  line: PlanLine,
  opts: readonly RouteOption[],
  profiles: Record<string, Profile>,
  loads: Loads,
  t: number,
): { placement: Routed; profiles: Record<string, Profile>; loads: Loads; formed: boolean } {
  const only = opts.length === 1 ? opts[0]! : undefined;
  if (only !== undefined && state.stations[only.station_id]!.type === 'batch') {
    const sid = only.station_id;
    const r = placeBatchImmediate(profiles[sid]!, loads[sid] ?? [], line, only.cap, t);
    return {
      placement: { fire: r.fire, booked: r.booked, station_id: sid, carry_ms: only.carry_ms, ...(only.fallback === 'reserve' ? { fallback: 'reserve' as const } : {}) },
      profiles: r.formed ? { ...profiles, [sid]: addInterval(profiles[sid]!, r.booked, r.booked.units) } : profiles,
      loads: { ...loads, [sid]: r.loads },
      formed: r.formed,
    };
  }
  const tries = opts.map((x) => {
    const fire = earliestFit(profiles[x.station_id]!, t, line.prep_ms, line.cook_ms, line.units, x.cap);
    return { fire, booked: bookingAt(line, x.cap, fire) };
  });
  const k = chooseImmediate(
    ctx,
    opts,
    tries.map((x, i) => x.booked.end + opts[i]!.carry_ms),
  );
  const { fire, booked } = tries[k]!;
  const sid = opts[k]!.station_id;
  return {
    placement: { fire, booked, station_id: sid, carry_ms: opts[k]!.carry_ms, ...(opts[k]!.fallback === 'reserve' ? { fallback: 'reserve' as const } : {}) },
    profiles: { ...profiles, [sid]: addInterval(profiles[sid]!, booked, booked.units) },
    loads,
    formed: true,
  };
}

// F §4.7 hold-and-fire for one sync group against `profiles` (the profile after the immediate lines, D36; every
// allowed station of every line present): candidate T = max over the group's lines of their least slot-formula
// land time over their allowed stations (earliest fit from t, + carry), raised to `floor` (delivery pickup, D3);
// then full passes until one completes with no advancement.
// Terminates: T only grows, by ≥ 1 ms per advance, and past the profiles' last boundaries every line fits.
// Task 13: on a batch station a line's least land is the earlier of a new load's and the earliest compatible load's.
function holdAndFire(
  state: EngineState,
  profiles: Readonly<Record<string, Profile>>,
  lines: ReadonlyArray<PlanLine & NewLine>,
  options: ReadonlyMap<string, readonly RouteOption[]>,
  t: number,
  floor: number | null,
  loads: Readonly<Loads> = {},
): { T: number; placements: Map<string, Routed>; profiles: Record<string, Profile>; loads: Loads } {
  const windows = batchWindows(state);
  let T = floor ?? Number.NEGATIVE_INFINITY;
  for (const plan of lines) {
    stationOf(state.stations, plan);
    let least = Number.POSITIVE_INFINITY;
    for (const o of options.get(plan.order_item_id)!) {
      const batch = windows.has(o.station_id);
      const line = batch ? asLoad(plan, o.cap) : plan;
      const fire = earliestFit(profiles[o.station_id]!, t, line.prep_ms, line.cook_ms, line.units, o.cap);
      let land = bookingAt(line, o.cap, fire).end;
      if (batch) land = Math.min(land, earliestJoinEnd(loads[o.station_id] ?? [], joinLine(plan), o.cap, t));
      least = Math.min(least, land + o.carry_ms);
    }
    T = Math.max(T, least);
  }
  // F §4.7 D36: longest cook first (ties by order_item_id), the first one earliest in time; by home station.
  const order = syncOrder(state, lines);
  const fifo = routeCtx(state).fifo;
  for (;;) {
    const r = trySyncAt(profiles, order, options, fifo, T, t, loads, windows);
    if (r.ok) return { T, placements: r.placements, profiles: r.profiles, loads: r.loads };
    // Unreachable: capacity < 1 is already refused by stationOf / capacityFor before any loop runs (and route.ts
    // never offers a station where the line's capacity is < 1), and with capacity ≥ 1 every advance comes from a
    // fit that failed at the current fire. Kept as a guard (never a hang): an InvalidEvent, so a non-strict fold
    // records a diagnostic (task 7 review ruling).
    if (!(r.advance > 0)) throw new InvalidEvent('capacity_invalid', lines[0]!.order_item_id, lines[0]!.station_id);
    T += r.advance;
  }
}

// Options of the placement sequence: AD-6 strictness and the D25 prune (default on; off only for the unpruned
// re-plan of test 23 and the simulator, §10.6).
export type SequenceOptions = { strict: boolean; prune: boolean };

// §3.5.1 steps 2–4, "one sequence" (G4-1 #3), shared by planOrder / calculateETA and the fold at awaiting = 0, so
// both reach the same placement for the same (state, t):
//   2. pass 1 of §3.5.3 (replan.ts) on every station a new line may use (its allowed stations, §3.5.5, v0.6
//      G4-2 #23): the older hidden lines are re-placed within their slack, keep first (D6);
//   3. the immediate lines, each at its earliest fit from t on its best station (§3.5.5: minimum arrival = land +
//      carry; home unless another station beats it by ≥ min_gain_ms) against the profile after pass 1, interval
//      added (D36); with them, in `listing` order, every FIFO sync line (§3.5.3 "no hold … placed at
//      earliestFit(t) in submit order; its target is that land time"; AD-14; route.ts: a sync line whose home is
//      FIFO, offered only FIFO stations, routed like an immediate one): no hold, no pickup floor;
//   4. each sync group's hold-and-fire loop over its other lines (routed inside the loop, §3.5.5), in the given
//      order, against the profile after the steps before it, floored by the pickup and by the land of each of the
//      group's FIFO lines (AD-14: the group stays one group and T ≥ every FIFO land, so nothing is late at submit).
//      A group of FIFO lines only has T = max(pickup, their lands).
// Routing reads only the line's own fields (station, alternates with their home flag, carry, max_carry_ms) and
// the state, and a move keeps the allowed set and the home (route.ts R1), so the fold of planOrder's batch routes
// as planOrder did. §3.3: in-flight lines are read only through liveProfiles (inside pass 1); the working
// profiles include their live intervals and are never stored. Returns the new lines' placements (with their
// station), the groups' targets (loop results), the FIFO-placed sync lines and pass 1's moves of older lines.
// `listing` = the batch's order_item_ids in listing order (the step-3 order).
function placeSequence(
  state: EngineState,
  immediates: ReadonlyArray<PlanLine & NewLine>,
  syncGroups: ReadonlyArray<ReadonlyArray<PlanLine & NewLine>>,
  listing: readonly string[],
  t: number,
  floor: number | null,
  o: SequenceOptions,
  event_id = '',
): { placements: Map<string, Routed>; targets: number[]; fifo: Set<string>; moves: Map<string, Move>; loads: Loads; fallbacks: Pass1Result['fallbacks']; base: EngineState; frozen: FrozenStep | null } {
  const stations = state.stations;
  const ctx = routeCtx(state);
  const all = [...immediates, ...syncGroups.flat()];
  for (const line of all) stationOf(stations, line);
  const options = new Map(all.map((l) => [l.order_item_id, routeOptions(ctx, l, false)]));
  const uses = [...options.values()].flatMap((os) => os.map((x) => x.station_id));
  const boosted = boostedReturns(state, ctx, immediates, options);
  const placed = boosted === null ? null : placeReturnBoost(state, ctx, boosted, uses, t, event_id, o);
  const base = placed?.base ?? state;
  const rest = boosted === null ? all : all.filter((l) => !boosted.has(l.order_item_id));
  const p1 = pass1(placed?.work ?? state, uses, rest, t, { prune: o.prune, strict: o.strict, ...(placed === null ? {} : { late: placed.frozen.late, held: heldAfterFrozen(placed.frozen) }) });
  let profiles: Record<string, Profile> = p1.profiles;
  // Task 13: the batch stations' loads after pass 1; the new lines join or form loads in them.
  let loads: Loads = { ...p1.loads };
  const placements = new Map<string, Routed>(placed?.placements ?? []);
  for (const [sid, list] of Object.entries(placed?.loads ?? {})) loads = { ...loads, [sid]: [...(loads[sid] ?? []), ...list] };
  // §3.8a: a return line is an immediate placed here — its earliest fit after pass 1 kept the older lines within
  // d − keep, i.e. "within other lines' slack and min_slack_keep_ms, never past their deadlines"; with
  // settings.returns_boost = true it was placed above, as a boost of the return line only, and may push others.
  // §3.5.3 FIFO / AD-14: a FIFO sync line is placed here like an immediate one.
  const fifo = new Set(syncGroups.flat().filter((l) => isFifoLine(ctx, l, options.get(l.order_item_id)!)).map((l) => l.order_item_id));
  const rank = new Map(listing.map((id, i) => [id, i]));
  const step3 = [...immediates.filter((l) => boosted?.has(l.order_item_id) !== true), ...syncGroups.flat().filter((l) => fifo.has(l.order_item_id))].sort(
    (a, b) => (rank.get(a.order_item_id) ?? 0) - (rank.get(b.order_item_id) ?? 0),
  );
  for (const line of step3) {
    const r = placeImmediate(state, ctx, line, options.get(line.order_item_id)!, profiles, loads, t);
    profiles = r.profiles;
    loads = r.loads;
    placements.set(line.order_item_id, r.placement);
  }
  const targets: number[] = [];
  for (const group of syncGroups) {
    if (group.length === 0) continue;
    // AD-14: each FIFO line's land floors the group's T.
    let g = floor ?? Number.NEGATIVE_INFINITY;
    for (const l of group) {
      const pl = placements.get(l.order_item_id);
      if (fifo.has(l.order_item_id)) g = Math.max(g, pl!.booked.end + pl!.carry_ms);
    }
    const held = group.filter((l) => !fifo.has(l.order_item_id));
    if (held.length === 0) {
      targets.push(g);
      continue;
    }
    const r = holdAndFire(state, profiles, held, options, t, g === Number.NEGATIVE_INFINITY ? null : g, loads);
    profiles = r.profiles;
    loads = r.loads;
    for (const [id, pl] of r.placements) {
      placements.set(id, pl);
      // AD-14: a line the loop placed on a FIFO station is a FIFO line there (deadline = its fire).
      if (ctx.fifo.has(pl.station_id)) fifo.add(id);
    }
    targets.push(r.T);
  }
  return { placements, targets, fifo, moves: p1.moves, loads, fallbacks: p1.fallbacks, base, frozen: placed?.frozen ?? null };
}

// §3.8a returns_boost: the return lines of a batch placed as a boost, each with the allowed stations a boost may use.
// §3.5.3 / AD-14: a FIFO station never lets a line jump its queue, so a return with only FIFO stations stays an
// ordinary immediate there, and FIFO alternates are left out — proposed (implementer, overnight).
function boostedReturns(
  state: EngineState,
  ctx: ReturnType<typeof routeCtx>,
  immediates: ReadonlyArray<PlanLine & NewLine>,
  options: ReadonlyMap<string, readonly RouteOption[]>,
): Map<string, { line: PlanLine & NewLine; opts: RouteOption[] }> | null {
  if (state.config?.settings.returns_boost !== true) return null;
  const out = new Map<string, { line: PlanLine & NewLine; opts: RouteOption[] }>();
  for (const line of immediates) {
    if ((line.return_of ?? null) === null) continue;
    const opts = options.get(line.order_item_id)!.filter((x) => !ctx.fifo.has(x.station_id));
    if (opts.length > 0) out.set(line.order_item_id, { line, opts });
  }
  return out.size === 0 ? null : out;
}

// §3.8a: "the new line is placed as a boost (§3.9) instead and may push others" — the return line only: at its earliest
// fit against the fixed lines (fired and COOKING); then the D15 exception on the stations it landed on, frozen lines
// first (the caller's pass 1 places the hidden ones). Returns the stored base (frozen moves applied, no return line
// yet: the caller books it) and the working state pass 1 reads (base + the return bookings in the profile).
// mark stays 'return', and order.boosted, the order's other lines and T are not touched: the caller only books it.
// All pure over `state`, so planOrder at now and the fold at recorded_at reach the same placement (§3.5.1).
function placeReturnBoost(
  state: EngineState,
  ctx: ReturnType<typeof routeCtx>,
  boosted: ReadonlyMap<string, { line: PlanLine & NewLine; opts: RouteOption[] }>,
  uses: readonly string[],
  t: number,
  event_id: string,
  o: SequenceOptions,
): { placements: Map<string, Routed>; loads: Loads; frozen: FrozenStep; base: EngineState; work: EngineState } {
  let profiles: Record<string, Profile> = fixedProfiles(state, uses, t, o.strict);
  let loads: Loads = {};
  const placements = new Map<string, Routed>();
  const bookings: Array<{ station_id: string; booked: Load['booked'] }> = [];
  for (const [id, { line, opts }] of boosted) {
    const r = placeImmediate(state, ctx, line, opts, profiles, loads, t);
    profiles = r.profiles;
    loads = r.loads;
    placements.set(id, r.placement);
    if (r.formed) bookings.push({ station_id: r.placement.station_id, booked: r.placement.booked });
  }
  const withBookings = (s: EngineState): EngineState => {
    const stations = { ...s.stations };
    for (const b of bookings) stations[b.station_id] = { ...stations[b.station_id]!, profile: addInterval(stations[b.station_id]!.profile, b.booked, b.booked.units) };
    return { ...s, stations };
  };
  const landed = [...new Set([...placements.values()].map((p) => p.station_id))];
  const frozen = placeFrozen(withBookings(state), landed, t, { strict: o.strict });
  const base = applyPass1(state, frozen, event_id, o.strict);
  return { placements, loads, frozen, base, work: withBookings(base) };
}

// §3.4: a frozen line whose fire_ms changed gets the red marker (`mark: 'moved'`), except a return line, whose mark
// stays (§3.8a); a hidden one is not marked. proposed (implementer, overnight): a FIFO line's deadline stays its fire
// (AD-14) when a capacity drop pushes it.
function markFrozen(state: EngineState, step: FrozenStep | null): EngineState {
  if (step === null || step.before.size === 0) return state;
  let lines: Record<string, EngineLine> | null = null;
  for (const [id, b] of step.before) {
    const l = state.lines[id];
    if (l === undefined || l.fire_ms === b.fire) continue;
    lines ??= { ...state.lines };
    lines[id] = { ...l, ...(b.frozen && l.return_of === null ? { mark: 'moved' as const } : {}), ...(b.fifo ? { deadline_ms: l.fire_ms! } : {}) };
  }
  return lines === null ? state : { ...state, lines };
}

// §3.4 D15 exceptions: the re-plan of a boost or a capacity change on `station_ids` at t: frozen lines first
// (placeFrozen), then pass 1 of the hidden ones (held and just-placed frozen lines are fixed input, heldAfterFrozen), the
// late set through §3.5.6. No new line.
// oldType (the capacity fold only, §3.5.3, §3.10): the bookings placed under the station's old type go with the frozen ones.
export function replanDisturbed(state: EngineState, station_ids: readonly string[], t: number, event_id: string, o: SequenceOptions, held?: ReadonlySet<string>, oldType = false): EngineState {
  if (station_ids.length === 0) return state;
  const step = placeFrozen(state, station_ids, t, { strict: o.strict, oldType, ...(held === undefined ? {} : { held }) });
  const s1 = applyPass1(state, step, event_id, o.strict);
  const p1 = pass1(s1, station_ids, [], t, { prune: false, strict: o.strict, late: step.late, held: heldAfterFrozen(step, held) });
  return markFrozen(applyPass1(s1, p1, event_id, o.strict), step);
}

// §3.10, §3.11, §3.5.3: a capacity change (`after` = `before` with the stations' new capacity or override), re-planned
// at the event. AD-12: an unfired line keeps its slot end, so an over-size line's deadline moves by the occupancy
// difference at the old and new capacity (reserve included, placementCap) — proposed (implementer, overnight), as the
// stock flip does; a FIFO line's deadline follows its fire (markFrozen). AD-4: every line still occupying the
// station with units > the new effective capacity gets an over_capacity diagnostic, both modes, when it changed.
export function replanCapacity(before: EngineState, after: EngineState, station_ids: readonly string[], t: number, event_id: string, o: SequenceOptions): EngineState {
  if (station_ids.length === 0) return after;
  let lines: Record<string, EngineLine> | null = null;
  for (const sid of station_ids) {
    if (isFifo(after, sid)) continue;
    for (const id of after.stations[sid]!.unfired) {
      const l = after.lines[id];
      if (l === undefined) continue;
      const delta = occupancy(l.units, placementCap(before, l), l.cook_ms).cook_ms - occupancy(l.units, placementCap(after, l), l.cook_ms).cook_ms;
      if (delta === 0) continue;
      lines ??= { ...after.lines };
      lines[id] = { ...l, deadline_ms: l.deadline_ms + delta };
    }
  }
  const replanned = replanDisturbed(lines === null ? after : { ...after, lines }, station_ids, t, event_id, o, undefined, true);
  const diagnostics: Diagnostic[] = [];
  const changed = new Map<string, number>();
  for (const sid of station_ids) {
    const cap = effectiveCapacity(after.stations[sid]!);
    if (effectiveCapacity(before.stations[sid]!) !== cap) changed.set(sid, cap);
  }
  if (changed.size > 0) {
    for (const l of Object.values(replanned.lines)) {
      const cap = changed.get(l.station_id);
      if (cap === undefined || l.units <= cap || (l.stage !== 'added' && l.stage !== 'cooking') || l.fire_ms === null) continue;
      diagnostics.push({ kind: 'over_capacity', event_id, order_item_id: l.order_item_id, station_id: l.station_id, detail: { units: l.units, capacity: cap } });
    }
  }
  return diagnostics.length === 0 ? replanned : { ...replanned, diagnostics: [...replanned.diagnostics, ...diagnostics] };
}

// §3.9 OrderBoosted at t (D4, D15 exception). The order's unfired lines (hidden and frozen) are re-placed first against
// the fixed lines (fired and COOKING, live; every other unfired line of their stations is out of the way), marked
// `boost` (a return line keeps 'return', §3.8a), then the D15 re-plan of the stations they left or landed on places
// every other unfired line there (frozen first, marked `moved`; late set through §3.5.6). A frozen line stays on its
// station (§3.5.5 D10); a hidden one may take an allowed station. The order's promise stays; its T becomes T_b.
// proposed (implementer, overnight) readings, each keeping §3.9's stated rules:
//   B1 "as one group": the order's sync lines of every group go through one hold-and-fire, every group with a re-placed
//      line takes T_b, order T = max over its groups (AD-8). An immediate line goes at its own earliest fit first
//      (§3.5.1 step 3, §3.2 "no hold"), its own group's T = its land. Alternative: hold immediates to T_b too.
//   B2 a line that cannot move (fired, COOKING, FIFO) of those groups floors T_b at its live land (sync lands together,
//      as AD-11 and AD-14 do); done lines do not. Alternative: T_b below a COOKING sibling's land.
//   B3 no pickup floor: F §4.7 "earliest fitting interval (starting now)", §3.9 earliestFit(t); a boost is the manager's
//      call. Alternative: keep the §3.5.1 pickup floor.
//   B4 FIFO (AD-14; §3.9 does not name FIFO, §3.5.3 "no re-plan of older lines"): a FIFO line of the order stays where
//      it is, unmarked, and nothing on a FIFO station moves. Alternative: the boosted line jumps the FIFO queue.
//   B5 a batch line leaves its stored load (which keeps its name and booking while it has members) and forms or joins a
//      load of the boosted lines only (§3.9 "against the fixed lines"; a frozen load of others is pushed, not joined).
//   B6 a boost with no movable line only sets boosted (nothing to re-place; T kept). A repeat boost runs again.
export function boostOrder(state: EngineState, order_id: string, t: number, event_id: string, o: SequenceOptions): EngineState {
  const order = state.orders[order_id]!;
  const unfired = order.line_ids
    .map((id) => state.lines[id])
    .filter((l): l is EngineLine => l !== undefined && l.stage === 'added' && l.fired_at === null && l.fire_ms !== null);
  const movable = unfired.filter((l) => !isFifo(state, l.station_id) && !placedUnderOldType(state, l));
  if (movable.length === 0) return { ...state, orders: { ...state.orders, [order_id]: { ...order, boosted: true } } };
  const ids = new Set(movable.map((l) => l.order_item_id));
  const ctx = routeCtx(state);
  const options = new Map<string, RouteOption[]>();
  for (const l of movable) {
    const frozen = l.fire_ms! <= t + stationPolicy(state, l.station_id).freeze_ms;
    const all = routeOptions(ctx, l, true);
    if (!frozen && all.length > 0) options.set(l.order_item_id, all);
    else options.set(l.order_item_id, [optionOwn(all, l, placementCap(state, l))]);
  }
  for (const l of movable) stationOf(state.stations, l);
  const uses = [...new Set([...options.values()].flatMap((os) => os.map((x) => x.station_id)))];
  let profiles = fixedProfiles(state, uses, t, o.strict);
  let loads: Loads = {};
  const placements = new Map<string, Routed>();
  // The immediate lines first, then one hold-and-fire over the sync lines (§3.5.1 steps 3–4; B1).
  const immediate = movable.filter((l) => l.serve_mode === 'immediate');
  const sync = movable.filter((l) => l.serve_mode === 'sync');
  for (const l of immediate) {
    const r = placeImmediate(state, ctx, l, options.get(l.order_item_id)!, profiles, loads, t);
    profiles = r.profiles;
    loads = r.loads;
    placements.set(l.order_item_id, r.placement);
  }
  const groupIds = new Set(sync.map((l) => l.group_id));
  let floor: number | null = null;
  for (const gid of groupIds) {
    for (const x of order.groups[gid]?.line_ids ?? []) {
      const l = state.lines[x];
      if (l === undefined || ids.has(x) || (l.stage !== 'added' && l.stage !== 'cooking')) continue;
      const iv = liveInterval(state, x, t);
      if (iv !== null) floor = Math.max(floor ?? iv.end + l.carry_ms, iv.end + l.carry_ms);
    }
  }
  let T_b: number | null = null;
  if (sync.length > 0) {
    const r = holdAndFire(state, profiles, sync, options, t, floor, loads);
    T_b = r.T;
    loads = r.loads;
    for (const [id, pl] of r.placements) placements.set(id, pl);
  }
  // Store: slot lines by applyMoves (AD-7: exactly the old booked), batch stations' loads by storeLoads.
  const moves = new Map<string, Move>();
  for (const l of movable) {
    const pl = placements.get(l.order_item_id)!;
    if (state.stations[pl.station_id]!.type === 'batch') continue;
    const { station_id, carry_ms, fire, booked } = pl;
    moves.set(l.order_item_id, station_id === l.station_id ? { fire, booked, capped: false } : { fire, booked, capped: false, to: { ...rerouted(l, { station_id, carry_ms }), deadline_ms: fire } });
  }
  let next = applyMoves(state, moves, event_id, o.strict);
  const batchIds = new Set([...movable.filter((l) => state.stations[l.station_id]!.type === 'batch').map((l) => l.station_id), ...Object.keys(loads)]);
  for (const sid of [...batchIds].sort()) {
    const others = Object.values(next.stations[sid]!.loads)
      .map((l) => ({ ...l, order_item_ids: l.order_item_ids.filter((m) => !ids.has(m)) }))
      .filter((l) => l.order_item_ids.length > 0)
      .map((l) => workOf(next, l));
    next = storeLoads(next, sid, [...others, ...(loads[sid] ?? [])], event_id, o.strict);
  }
  // Marks, deadlines (AD-12: the line's slot in the new plan, loopT = T_b), group and order T.
  const lines = { ...next.lines };
  const groups = { ...order.groups };
  const stationsTouched = new Set<string>();
  const fallbacks: Pass1Result['fallbacks'] = [];
  for (const l of movable) {
    const pl = placements.get(l.order_item_id)!;
    const batch = next.stations[pl.station_id]!.type === 'batch';
    lines[l.order_item_id] = { ...lines[l.order_item_id]!, mark: l.return_of !== null ? l.mark : 'boost', capped: false, deadline_ms: batch ? pl.booked.start - l.prep_ms : pl.fire };
    stationsTouched.add(l.station_id);
    stationsTouched.add(pl.station_id);
    if (pl.fallback === 'reserve') fallbacks.push({ order_item_id: l.order_item_id, station_id: pl.station_id, capacity: effectiveCapacity(next.stations[pl.station_id]!), reserve_units: ctx.reserve.get(pl.station_id) ?? 0 });
    const g = groups[l.group_id];
    if (g === undefined) continue;
    groups[l.group_id] = { ...g, target_land_ms: l.serve_mode === 'sync' ? T_b! : pl.booked.end + pl.carry_ms };
  }
  const target_land_ms = Math.max(...Object.values(groups).map((g) => g.target_land_ms));
  next = { ...next, lines, orders: { ...next.orders, [order_id]: { ...order, boosted: true, groups, target_land_ms } } };
  return fallbackDiagnostics(replanDisturbed(next, [...stationsTouched].sort(), t, event_id, o, ids), fallbacks, event_id);
}

// A frozen line's only option: its own station (§3.5.5 D10), at the capacity it may use there.
function optionOwn(all: readonly RouteOption[], l: EngineLine, cap: number): RouteOption {
  return all.find((x) => x.station_id === l.station_id) ?? { station_id: l.station_id, carry_ms: l.carry_ms, home: false, cap };
}

// ---- task 13: storing loads ----------------------------------------------------------------------------------

const sameBooking = (a: Load['booked'], b: Load['booked']): boolean => a.start === b.start && a.end === b.end && a.units === b.units;

// Stores the unfired loads of a batch station after a placement (AD-7 for loads, AD-6): names the loads formed in
// it (batch.ts nameLoads), removes exactly the booking of every stored load that is gone or whose booking changed
// and adds the new bookings (a kept load is booked once and left alone), and gives every member line the load's
// fire_ms and load_id (booked null, capped from the overload search). `loads` lists every unfired load of the
// station; every member is an unfired line already in `unfired`. A strict underflow throws; non-strict it clamps
// and appends a profile_underflow diagnostic. Unchanged loads return state itself.
export function storeLoads(state: EngineState, station_id: string, after: readonly WorkLoad[], event_id: string, strict: boolean): EngineState {
  const station = state.stations[station_id]!;
  const named = nameLoads(station_id, after);
  const before = station.loads;
  const unchanged =
    named.length === Object.keys(before).length &&
    named.every((w) => {
      const b = before[w.load_id!];
      return b !== undefined && sameBooking(b.booked, w.booked) && b.order_item_ids.length === w.members.length && b.order_item_ids.every((m) => w.members.includes(m)) && !w.capped;
    });
  if (unchanged) return state;
  const kept = new Set(named.filter((w) => before[w.load_id!] !== undefined && sameBooking(before[w.load_id!]!.booked, w.booked)).map((w) => w.load_id!));
  let profile = station.profile;
  const diagnostics: Diagnostic[] = [];
  for (const b of Object.values(before)) {
    if (kept.has(b.load_id)) continue;
    let under: { at: number; deficit: number } | null = null;
    profile = strict
      ? removeInterval(profile, b.booked, b.booked.units)
      : removeInterval(profile, b.booked, b.booked.units, (u) => {
          under = u;
        });
    if (under !== null) {
      const { at, deficit } = under as { at: number; deficit: number };
      diagnostics.push({ kind: 'profile_underflow', event_id, station_id, detail: { load_id: b.load_id, at, deficit } });
    }
  }
  const loads: Record<string, Load> = {};
  const lines: Record<string, EngineLine> = { ...state.lines };
  for (const w of named) {
    if (!kept.has(w.load_id!)) profile = addInterval(profile, w.booked, w.booked.units);
    const members = [...w.members].sort();
    loads[w.load_id!] = { load_id: w.load_id!, program_id: w.program_id, order_item_ids: members, fire_ms: w.fire_ms, booked: { ...w.booked } };
    for (const m of members) lines[m] = { ...lines[m]!, fire_ms: w.fire_ms, load_id: w.load_id!, booked: null, capped: w.capped };
  }
  return {
    ...state,
    stations: { ...state.stations, [station_id]: { ...station, profile, loads, unfired: sortUnfired(station.unfired, lines) } },
    lines,
    diagnostics: diagnostics.length === 0 ? state.diagnostics : [...state.diagnostics, ...diagnostics],
  };
}

function storeAllLoads(state: EngineState, loads: Readonly<Loads>, event_id: string, strict: boolean): EngineState {
  let next = state;
  for (const sid of Object.keys(loads).sort()) next = storeLoads(next, sid, loads[sid]!, event_id, strict);
  return next;
}

// Task 11 re-review: a hidden line pass 1 kept on its own station at full capacity because the reserve shut it out
// everywhere gets the same reserve_fallback diagnostic as a new line (bookNew).
function fallbackDiagnostics(state: EngineState, fallbacks: Pass1Result['fallbacks'], event_id: string): EngineState {
  if (fallbacks.length === 0) return state;
  const ds: Diagnostic[] = fallbacks.map((f) => ({
    kind: 'reserve_fallback',
    event_id,
    order_item_id: f.order_item_id,
    station_id: f.station_id,
    detail: { capacity: f.capacity, reserve_units: f.reserve_units },
  }));
  return { ...state, diagnostics: [...state.diagnostics, ...ds] };
}

// Pass 1's stored effect: the slot moves (applyMoves), the batch stations' loads, the reserve fallbacks.
export function applyPass1(state: EngineState, p1: Pick<Pass1Result, 'moves' | 'loads' | 'fallbacks'>, event_id: string, strict: boolean): EngineState {
  return fallbackDiagnostics(storeAllLoads(applyMoves(state, p1.moves, event_id, strict), p1.loads, event_id, strict), p1.fallbacks, event_id);
}

// Books new lines (AD-7: `booked` on the line, added to the stored profile; fire_ms set) and re-sorts `unfired`
// on their stations (§3.3, (fire, order_item_id)); a line over effective capacity appends an 'over_capacity'
// diagnostic (AD-4) in both modes. The stored profile gets only planned bookings, never live intervals (§3.3).
// §3.5.5: a line goes to the station its placement was made on, with the route fields of that move (route.ts R1;
// the same station as OrderPlaced.lines[].station_id when the fold routes as planOrder did).
function bookNew(
  state: EngineState,
  pending: readonly EngineLine[],
  placements: ReadonlyMap<string, Routed>,
  deadlines: ReadonlyMap<string, number>,
  event_id: string,
): EngineState {
  const stations: Record<string, StationRuntime> = { ...state.stations };
  const lines: Record<string, EngineLine> = { ...state.lines };
  const diagnostics: Diagnostic[] = [];
  const touched = new Set<string>();
  for (const line of pending) {
    const pl = placements.get(line.order_item_id)!;
    const { fire, booked } = pl;
    const sid = pl.station_id;
    const station = stations[sid]!;
    // Task 13: a batch line's booking is its load's, stored once by storeLoads.
    const batch = station.type === 'batch';
    lines[line.order_item_id] = { ...line, ...rerouted(line, pl), fire_ms: fire, booked: batch ? null : booked, capped: false, deadline_ms: deadlines.get(line.order_item_id)! };
    stations[sid] = {
      ...station,
      profile: batch ? station.profile : addInterval(station.profile, booked, booked.units),
      unfired: [...station.unfired, line.order_item_id],
    };
    touched.add(sid);
    const cap = effectiveCapacity(station);
    if (pl.fallback === 'reserve') {
      // task 11 review: the reserve left the line no station; booked here at full capacity (D3), logged by the host.
      diagnostics.push({
        kind: 'reserve_fallback',
        event_id,
        order_item_id: line.order_item_id,
        station_id: sid,
        detail: { capacity: cap, reserve_units: state.config?.stations.find((c) => c.station_id === sid)?.reserve_units ?? 0 },
      });
    }
    if (line.units > cap) {
      diagnostics.push({
        kind: 'over_capacity',
        event_id,
        order_item_id: line.order_item_id,
        station_id: sid,
        detail: { units: line.units, capacity: cap },
      });
    }
  }
  for (const sid of touched) stations[sid] = { ...stations[sid]!, unfired: sortUnfired(stations[sid]!.unfired, lines) };
  return {
    ...state,
    stations,
    lines,
    diagnostics: diagnostics.length === 0 ? state.diagnostics : [...state.diagnostics, ...diagnostics],
  };
}

// §3.5.1 "When the fold plans": at the ItemAdded that brought awaiting to 0 (the one re-plan of the batch per
// station, §3.5.3 triggers), runs the sequence (pass 1, immediates, sync; the order's pickup_at_ms is the
// delivery floor) for the order's lines not placed yet. The sync groups go in line_ids order of their first line.
// Pass 1's moves are stored first (AD-7: exactly the old `booked` removed, AD-6), then the new lines are booked.
// The stored group T and P are never recomputed (§3.5.1 step 6, P-2): the loop result only places the lines, and
// for a batch planned by planOrder at now = recorded_at against the same state it lands every group exactly at
// its stored T; a line that no longer fits by the append gap lands at its earliest fit (the whole group moves
// with the loop) and the tick slips it (§3.5.3, test 91). Copy-on-write: only touched stations and lines.
export function planNewLines(state: EngineState, order_id: string, t: number, event_id: string, o: SequenceOptions): EngineState {
  const order = state.orders[order_id];
  if (order === undefined) return state;
  const pending = order.line_ids
    .map((id) => state.lines[id])
    .filter((l): l is EngineLine => l !== undefined && l.stage === 'added' && l.fire_ms === null && l.booked === null);
  if (pending.length === 0) return state;

  const immediates = pending.filter((l) => l.serve_mode === 'immediate');
  const syncGroups = new Map<string, EngineLine[]>();
  for (const l of pending) {
    if (l.serve_mode === 'sync') syncGroups.set(l.group_id, [...(syncGroups.get(l.group_id) ?? []), l]);
  }
  const groups = [...syncGroups.values()];
  const placed = placeSequence(
    state,
    immediates,
    groups,
    pending.map((l) => l.order_item_id),
    t,
    order.pickup_at_ms,
    o,
    event_id,
  );
  // AD-12: each new line's queued deadline, from the stored group T and the loop result that placed it.
  const loopT = new Map<string, number>();
  groups.forEach((g, i) => loopT.set(g[0]!.group_id, placed.targets[i]!));
  const deadlines = new Map<string, number>();
  for (const l of pending) {
    const pl = placed.placements.get(l.order_item_id)!;
    const T = order.groups[l.group_id]?.target_land_ms ?? pl.booked.end + pl.carry_ms;
    // §3.5.3 / AD-14: a FIFO line's target is its own land time, so its deadline is its fire.
    if (placed.fifo.has(l.order_item_id)) {
      deadlines.set(l.order_item_id, pl.fire);
      continue;
    }
    const lt = l.serve_mode === 'sync' ? loopT.get(l.group_id)! : pl.booked.end + pl.carry_ms;
    // Task 13: a batch line's slot is its load's interval, so its latest fire is load start − its own prep (the
    // load fires at start − its largest prep, ≤ that).
    const own = state.stations[pl.station_id]!.type === 'batch' ? pl.booked.start - l.prep_ms : pl.fire;
    deadlines.set(l.order_item_id, queuedDeadline(own, lt, T));
  }
  const moved = applyMoves(placed.base, placed.moves, event_id, o.strict);
  const booked = bookNew(moved, pending, placed.placements, deadlines, event_id);
  return markFrozen(fallbackDiagnostics(storeAllLoads(booked, placed.loads, event_id, o.strict), placed.fallbacks, event_id), placed.frozen);
}

// §3.5.3 triggers (D13): ItemRemoved / ItemVoided re-plan "that station", and "the group's T may move earlier,
// never later: T' = min(T, loop result); the promise P never moves" (test 89; story "void of an item in-flight →
// latest-start times of the remaining items in that order are recalculated; target land time may move earlier").
// Called after the ended line left the profile (AD-7). Reading (report): the one sequence again —
//   1. pass 1 on the ended line's station, with the group's hidden lines held where they are (fixed input);
//   2. the group's hold-and-fire loop over its hidden lines on all their allowed stations (§3.5.5: a hidden line may
//      change station, D10; never onto / off a FIFO station), against the live profiles after step 1 without those
//      lines; floor = the pickup time and the land time (live interval end + carry) of every other open line of the
//      group that cannot move (frozen, fired, COOKING, FIFO);
//   3. loop < T → the hidden lines take the loop placement, the group T and every group line's deadline become
//      T', the order T = max over its groups; otherwise nothing of the group changes (T kept).
//      With no hidden line left to re-loop (task 11 fix: e.g. only FIFO siblings remain) the loop result is the
//      floor itself: T' = min(T, floor).
// Promises (EngineOrder.promise_ms) are never touched. An immediate line is its own group: nothing to re-loop.
// Task 12 review (§3.5.3 lists ItemVoided with no partial / whole distinction; AD-11): `partial` = the line was
// partially voided and is still open at its lower units (BF-12). It stays among the group's lines: when hidden and
// not FIFO it is movable — left free in step 1, so pass 1 re-books it with its remaining units (AD-7: exactly its
// old `booked` leaves the profile) even when the loop keeps T, then re-looped with the group; otherwise its live
// interval is a floor like any other line that cannot move.
export function replanEnded(state: EngineState, ended: EngineLine, t: number, event_id: string, o: SequenceOptions, partial = false): EngineState {
  const order = state.orders[ended.order_id];
  const group = order?.groups[ended.group_id];
  const siblings =
    order === undefined || group === undefined || ended.serve_mode !== 'sync'
      ? []
      : group.line_ids
          .filter((id) => partial || id !== ended.order_item_id)
          .map((id) => state.lines[id])
          .filter((l): l is EngineLine => l !== undefined && l.units > 0 && (l.stage === 'added' || l.stage === 'cooking'));
  // §3.5.3 / AD-14: a FIFO line is never re-looped (no re-plan of older lines); its land is a floor below.
  const movable = siblings.filter((l) => isHidden(state, l, t) && !isFifo(state, l.station_id));
  const held = new Set(movable.map((l) => l.order_item_id).filter((id) => id !== ended.order_item_id));
  const p1 = pass1(state, [ended.station_id], [], t, { prune: false, held, strict: o.strict });
  let next = applyPass1(state, p1, event_id, o.strict);
  if (siblings.length === 0) return next;

  let floor = order!.pickup_at_ms ?? Number.NEGATIVE_INFINITY;
  for (const l of siblings) {
    if (held.has(l.order_item_id)) continue;
    const iv = liveInterval(next, l.order_item_id, t);
    if (iv !== null) floor = Math.max(floor, iv.end + l.carry_ms);
  }
  const T = group!.target_land_ms;
  let loop: { T: number; placements: Map<string, Routed> };
  if (movable.length === 0) {
    if (floor === Number.NEGATIVE_INFINITY || !(floor < T)) return next;
    loop = { T: floor, placements: new Map() };
  } else {
    const ctx = routeCtx(next);
    const lines = movable.map((l) => next.lines[l.order_item_id]!);
    const options = new Map(lines.map((l) => [l.order_item_id, routeOptions(ctx, l, true)]));
    const ids = [...new Set([...options.values()].flatMap((os) => os.map((x) => x.station_id)))];
    const profiles: Record<string, Profile> = { ...liveProfiles(next, ids, t) };
    for (const l of lines) {
      const b = l.booked!;
      profiles[l.station_id] = o.strict
        ? removeInterval(profiles[l.station_id]!, b, b.units)
        : removeInterval(profiles[l.station_id]!, b, b.units, () => undefined);
    }
    for (const l of lines) stationOf(next.stations, l);
    loop = holdAndFire(next, profiles, lines, options, t, floor === Number.NEGATIVE_INFINITY ? null : floor);
    if (!(loop.T < T)) return next;
    const moves = new Map<string, Move>();
    for (const l of lines) {
      const pl = loop.placements.get(l.order_item_id)!;
      const { station_id, carry_ms, ...placement } = pl;
      moves.set(
        l.order_item_id,
        station_id === l.station_id ? placement : { ...placement, to: { ...rerouted(l, { station_id, carry_ms }), deadline_ms: pl.fire } },
      );
    }
    next = applyMoves(next, moves, event_id, o.strict);
  }
  // AD-12: the group's queued deadlines at T'. A re-looped line's slot is its loop placement (loopT = T'); a
  // sibling that cannot move keeps its slot, never later than its unqueued deadline at T'.
  const lines = { ...next.lines };
  for (const id of group!.line_ids) {
    const l = lines[id];
    if (l === undefined || l.units === 0) continue;
    const pl = loop.placements.get(id);
    const cap = capacityFor(next.stations[l.station_id]!, id);
    lines[id] = { ...l, deadline_ms: pl !== undefined ? queuedDeadline(pl.fire, loop.T, loop.T) : Math.min(l.deadline_ms, deadlineOf(l, loop.T, cap)) };
  }
  const groups = { ...order!.groups, [ended.group_id]: { ...group!, target_land_ms: loop.T } };
  const target_land_ms = Math.max(...Object.values(groups).map((g) => g.target_land_ms));
  return { ...next, lines, orders: { ...next.orders, [order!.order_id]: { ...order!, groups, target_land_ms } } };
}

// Task 15b (AD-12 for a group whose membership changed: ItemsReleased, §3.8): the group keeps its stored T ("unticked
// lines stay sync with each other at their old T"), and its hidden lines get their queued deadlines (their D36 slots)
// again without the lines that left. proposed (implementer, overnight): the trial is replanEnded's step 2 floored by T
// itself — the group's hold-and-fire loop over its hidden, non-FIFO lines (fixed input: every other line, and the
// group's lines that cannot move as a floor at their live land), against the live profiles at t without those lines;
// each line the loop places on its own station takes d = queuedDeadline(fire, loopT, T) (loopT > T only when the
// group no longer fits at T: the AD-12 append-gap shape). Nothing is moved or booked here (the fold's re-plan, if
// any, follows and reads the new deadlines); a line placed on another station in the trial keeps its deadline.
// Unchanged deadlines return state itself.
export function requeueGroup(state: EngineState, order_id: string, group_id: string, t: number, o: SequenceOptions): EngineState {
  const order = state.orders[order_id];
  const group = order?.groups[group_id];
  if (order === undefined || group === undefined) return state;
  const siblings = group.line_ids
    .map((id) => state.lines[id])
    .filter((l): l is EngineLine => l !== undefined && l.serve_mode === 'sync' && l.units > 0 && (l.stage === 'added' || l.stage === 'cooking'));
  const movable = siblings.filter((l) => isHidden(state, l, t) && !isFifo(state, l.station_id));
  if (movable.length === 0) return state;
  const held = new Set(movable.map((l) => l.order_item_id));
  const T = group.target_land_ms;
  let floor = Math.max(T, order.pickup_at_ms ?? Number.NEGATIVE_INFINITY);
  for (const l of siblings) {
    if (held.has(l.order_item_id)) continue;
    const iv = liveInterval(state, l.order_item_id, t);
    if (iv !== null) floor = Math.max(floor, iv.end + l.carry_ms);
  }
  const ctx = routeCtx(state);
  const options = new Map(movable.map((l) => [l.order_item_id, routeOptions(ctx, l, true)]));
  const ids = [...new Set([...options.values()].flatMap((os) => os.map((x) => x.station_id)))];
  const profiles: Record<string, Profile> = { ...liveProfiles(state, ids, t) };
  for (const l of movable) {
    const b = l.booked!;
    profiles[l.station_id] = o.strict
      ? removeInterval(profiles[l.station_id]!, b, b.units)
      : removeInterval(profiles[l.station_id]!, b, b.units, () => undefined);
  }
  // stationOf throws InvalidEvent for a line whose station is gone (as in replanEnded); kept for that throw.
  for (const l of movable) stationOf(state.stations, l);
  const loop = holdAndFire(state, profiles, movable, options, t, floor);
  let lines: Record<string, EngineLine> | null = null;
  for (const l of movable) {
    const pl = loop.placements.get(l.order_item_id);
    if (pl === undefined || pl.station_id !== l.station_id) continue;
    const d = queuedDeadline(pl.fire, loop.T, T);
    if (d === l.deadline_ms) continue;
    lines ??= { ...state.lines };
    lines[l.order_item_id] = { ...l, deadline_ms: d };
  }
  return lines === null ? state : { ...state, lines };
}

// Task 15b (review fix 1; §3.8 D12, proposed (implementer, overnight), controller ruling option (a)): the one re-plan of
// an ItemsReleased for its hidden expedite lines, which must never land later than their sync slot:
//   1. pass 1 once on every station the lines may use, with the lines held at their OLD bookings as fixed input
//      (so no sibling can be moved keep-first into an old slot);
//   2. per line (payload order), its earliest fit from t on each allowed station against the live profile after step
//      1 (and the lines moved before it) with its own old booking removed, the station chosen as an immediate's
//      (§3.5.5 chooseImmediate on arrival = land + carry);
//   3. the line moves there only when that arrival is earlier than its old one (AD-7: exactly the old `booked`
//      removed, the new one booked; a move to another station takes the route fields); else it keeps its booking.
// Either way its deadline becomes its fire (immediate, AD-12); the fold sets its group T to its land.
export function placeExpedites(state: EngineState, ids: readonly string[], t: number, event_id: string, o: SequenceOptions): EngineState {
  if (ids.length === 0) return state;
  const ctx0 = routeCtx(state);
  const opts = new Map(ids.map((id) => [id, routeOptions(ctx0, state.lines[id]!, true)]));
  const uses = [...new Set([...opts.values()].flatMap((os) => os.map((x) => x.station_id)))];
  const p1 = pass1(state, uses, [], t, { prune: false, held: new Set(ids), strict: o.strict });
  let next = applyPass1(state, p1, event_id, o.strict);
  const ctx = routeCtx(next);
  for (const id of ids) {
    const line = next.lines[id]!;
    const old = line.booked!;
    const options = opts.get(id)!;
    const live = liveProfiles(next, [line.station_id, ...options.map((x) => x.station_id)], t);
    live[line.station_id] = o.strict ? removeInterval(live[line.station_id]!, old, old.units) : removeInterval(live[line.station_id]!, old, old.units, () => undefined);
    const tries = options.map((x) => {
      const fire = earliestFit(live[x.station_id]!, t, line.prep_ms, line.cook_ms, line.units, x.cap);
      return { fire, booked: bookingAt(line, x.cap, fire) };
    });
    const k = tries.length === 0 ? -1 : chooseImmediate(ctx, options, tries.map((x, i) => x.booked.end + options[i]!.carry_ms));
    let fire = line.fire_ms!;
    if (k >= 0 && tries[k]!.booked.end + options[k]!.carry_ms < old.end + line.carry_ms) {
      const { fire: f, booked } = tries[k]!;
      const opt = options[k]!;
      const move: Move = opt.station_id === line.station_id ? { fire: f, booked, capped: false } : { fire: f, booked, capped: false, to: { ...rerouted(line, opt), deadline_ms: f } };
      next = applyMoves(next, new Map([[id, move]]), event_id, o.strict);
      fire = f;
    }
    next = { ...next, lines: { ...next.lines, [id]: { ...next.lines[id]!, deadline_ms: fire } } };
  }
  return next;
}

// ---- §6.1b–d: planOrder, calculateETA, checkOrderable --------------------------------------------------------

type OrderType = 'dine_in' | 'takeaway' | 'delivery' | 'parking';

// 03a §4.2 (v0.2, pre-G2 #8): the input of planOrder, calculateETA, checkOrderable and reserveStock, built by 02.
export type ProposedLine = ItemAddedPayload & {
  alternates: Array<{ station_id: string; carry_ms: number; home: boolean }>; // allowed for this order type (D8)
  point_id: string | null;
  carry_ms: number; // home station → point
  weight_pct: number;
  max_early_ms: number;
  max_late_ms: number | null;
  max_carry_ms: number | null;
  cook_ms_override: number | null; // a `fix` return: the item's adjust_time_ms (D28)
  return_of: { order_item_id: string; mode: 'fix' | 'remake' } | null;
};

export type ProposedOrder = {
  order_id: string;
  order: { order_type: OrderType; table_id: string | null; table_key: string; follow_up: boolean; pickup_at_ms: number | null };
  lines: ProposedLine[];
};

// 03a §6.1b.
export interface PlanResult {
  groups: Array<{ group_id: string; target_land_ms: number; promise_ms: number; order_item_ids: string[] }>;
  lines: Array<{
    order_item_id: string;
    station_id: string;
    alternates: Array<{ station_id: string; carry_ms: number; home: boolean }>;
    point_id: string | null;
    carry_ms: number;
    from_stock: boolean;
    eta_ms: number;
  }>;
}

// 03a §6.1d, §3.5.1 step 1 (D21, §3.10): a line routed only to a paused station → 409 STATION_PAUSED
// { station_id } (the line's station). "Routed" = its §3.5.5 allowed set (carry, reserve, not paused; route.ts):
// when that set is empty the placement would fall back onto the line's own station, and when that station is
// paused the line is refused (task 11 review). Lines that are not engine lines (§3.2) are never checked; a station
// the engine does not know is not paused.
export function checkOrderable(state: EngineState, proposed: ProposedOrder): void {
  const ctx = routeCtx(state);
  for (const line of proposed.lines) {
    if (!isEngineLine(line)) continue;
    const opts = routeOptions(
      ctx,
      {
        order_item_id: line.order_item_id,
        station_id: line.station_id!,
        routed_station_id: line.station_id!,
        carry_ms: line.carry_ms,
        max_carry_ms: line.max_carry_ms,
        alternates: line.alternates,
      },
      false,
    );
    const only = opts.length === 1 ? opts[0]! : undefined;
    if (only?.fallback !== undefined && state.stations[only.station_id]?.paused === true) {
      throw new DomainError('STATION_PAUSED', { station_id: line.station_id });
    }
  }
}

// §3.5.1 step 5 (D6, D3): padding = the station's promise_padding_ms ?? the branch's per order type; 0 on a FIFO
// or EDF station. A group takes the max over its stations.
function paddingOf(state: EngineState, station_id: string, order_type: OrderType): number {
  const config = state.config;
  if (config === null) return 0;
  const station = config.stations.find((s) => s.station_id === station_id);
  if (station !== undefined && station.policy !== 'waada_guard') return 0;
  return station?.promise_padding_ms ?? config.settings[`promise_padding_${order_type}_ms`];
}

// 03a §6.1b, §3.5.1 steps 1–6, BF-2: the one sequence (pass 1 → immediate → sync, placeSequence) at now, the
// same as the fold at awaiting = 0; in-flight lines through liveInterval at now (§3.3). Pure: returns the plan,
// never state, so nothing is appended (AD-4's over_capacity diagnostic is the fold's). from_stock is
// reserveStock's map (a line absent from it is fresh). Groups: the sync group first (`order_id:n`, n = the
// order's next_group_index, 0 for a new order), then one group per immediate line in listing order; eta_ms is
// the line's own land time at its point (a serialised sync sibling lands before T, D36).
export function planOrder(
  state: EngineState,
  proposed: ProposedOrder,
  now: number,
  from_stock: Readonly<Record<string, boolean>>,
): PlanResult {
  return planOrderWith(state, proposed, now, from_stock, { prune: true });
}

// planOrder with the D25 prune as an option: { prune: false } is the unpruned re-plan test 23 (and the §10.6
// simulator) compares against. Not exported from the package index. A working-profile underflow clamps (no
// state is returned to carry a diagnostic; the fold reports it, AD-6).
export function planOrderWith(
  state: EngineState,
  proposed: ProposedOrder,
  now: number,
  from_stock: Readonly<Record<string, boolean>>,
  o: { prune: boolean },
): PlanResult {
  checkOrderable(state, proposed);
  const engineLines = proposed.lines.filter((l) => isEngineLine(l));
  const planLines = engineLines.map((l) => {
    const station = stationOf(state.stations, { order_item_id: l.order_item_id, station_id: l.station_id! });
    let shape: ReturnType<typeof lineShape>;
    try {
      shape = lineShape(l, l, station.type, from_stock[l.order_item_id] === true);
    } catch (e) {
      if (e instanceof InvalidEvent) throw new InvalidEvent(e.reason, l.order_item_id, station.station_id);
      throw e;
    }
    const line: PlanLine & NewLine = {
      order_item_id: l.order_item_id,
      station_id: station.station_id,
      units: lineUnits(l),
      prep_ms: l.prep_buffer_ms ?? 0,
      cook_ms: shape.cook_ms,
      carry_ms: l.carry_ms,
      serve_mode: shape.serve_mode,
      max_early_ms: l.max_early_ms,
      max_carry_ms: l.max_carry_ms,
      routed_station_id: station.station_id,
      alternates: l.alternates,
      from_stock: shape.from_stock,
      program_id: l.program_id,
      stock_program_id: l.stock_program_id,
      return_of: l.return_of,
    };
    checkProgram(line, station);
    return line;
  });
  const immediates = planLines.filter((l) => l.serve_mode === 'immediate');
  const sync = planLines.filter((l) => l.serve_mode === 'sync');
  const placed = placeSequence(
    state,
    immediates,
    [sync],
    planLines.map((l) => l.order_item_id),
    now,
    proposed.order.pickup_at_ms,
    { prune: o.prune, strict: false },
  );

  const order_type = proposed.order.order_type;
  const placementOf = (l: PlanLine): Routed => placed.placements.get(l.order_item_id)!;
  const land = (l: PlanLine): number => placementOf(l).booked.end + placementOf(l).carry_ms;
  let index = state.orders[proposed.order_id]?.next_group_index ?? 0;
  const groups: PlanResult['groups'] = [];
  if (sync.length > 0) {
    const T = placed.targets[0]!;
    const padding = Math.max(...sync.map((l) => paddingOf(state, placementOf(l).station_id, order_type)));
    groups.push({ group_id: `${proposed.order_id}:${index++}`, target_land_ms: T, promise_ms: T + padding, order_item_ids: sync.map((l) => l.order_item_id) });
  }
  for (const l of immediates) {
    const T = land(l);
    groups.push({
      group_id: `${proposed.order_id}:${index++}`,
      target_land_ms: T,
      promise_ms: T + paddingOf(state, placementOf(l).station_id, order_type),
      order_item_ids: [l.order_item_id],
    });
  }
  // §4.2: OrderPlaced.lines[].station_id is the engine's starting station (D8): the chosen one, with its carry,
  // and the other allowed stations as alternates (route.ts R1).
  return {
    groups,
    lines: planLines.map((l, i) => {
      const r = rerouted(l, placementOf(l));
      return {
        order_item_id: l.order_item_id,
        station_id: r.station_id,
        alternates: r.alternates,
        point_id: engineLines[i]!.point_id,
        carry_ms: r.carry_ms,
        from_stock: l.from_stock,
        eta_ms: land(l),
      };
    }),
  };
}

// 03a §6.1c: planOrder as a preview; no stock claim is kept or changed (BF-2: without the map every line is
// fresh, as when no ItemAdded.from_stock is known).
export function calculateETA(
  state: EngineState,
  proposed: ProposedOrder,
  now: number,
  from_stock?: Readonly<Record<string, boolean>>,
): PlanResult {
  return planOrder(state, proposed, now, from_stock ?? {});
}

