// 03a §3.2 (lines, units, cook time) and §3.5.1 (target and promise at submit: planOrder, calculateETA,
// checkOrderable; the fold plans at the ItemAdded that brings awaiting to 0, through the same placement).
// Pure: no clock, no ids; t is the triggering event's recorded_at or the handler's now.
import { DomainError } from '@pos/domain';
import type { ItemAddedPayload } from '@pos/events';
import { InvalidEvent } from './invalid-event.js';
import { effectiveCapacity } from './capacity.js';
import { liveInterval, liveProfiles } from './live.js';
import { addInterval, earliestFit, latestFit, occupancy, removeInterval } from './profile.js';
import { applyMoves, bookingAt, capacityFor, isFifo, isHidden, pass1, queueOrder, sortUnfired, type NewLine, type Placement } from './replan.js';
import type { Diagnostic, EngineLine, EngineState, Profile, StationRuntime } from './state.js';

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

// ---- §3.5.1 steps 3–4: the one placement sequence of planOrder and the fold ----------------------------------

// What the placement reads of a line (an EngineLine, or a line built from a ProposedOrder).
type PlanLine = Pick<EngineLine, 'order_item_id' | 'station_id' | 'units' | 'prep_ms' | 'cook_ms' | 'carry_ms'>;

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
// collisions", D36): sorted longest-cook-first, packed back from T so the shortest lands at T and each longer
// one ends where the later siblings start. A line that does not fit gives the smallest advance of T that clears
// its conflict; the caller then repeats the full pass at the advanced T (a pass is trusted only when nothing
// advanced, so restarting gives the same T as continuing the pass).
function trySyncAt(
  profiles: Readonly<Record<string, Profile>>,
  stations: Readonly<Record<string, StationRuntime>>,
  byStation: ReadonlyArray<readonly [string, readonly PlanLine[]]>,
  T: number,
  t: number,
): { ok: true; placements: Map<string, Placement>; profiles: Record<string, Profile> } | { ok: false; advance: number } {
  const out: Record<string, Profile> = { ...profiles };
  const placements = new Map<string, Placement>();
  for (const [station_id, sorted] of byStation) {
    const cap = effectiveCapacity(stations[station_id]!);
    const base = profiles[station_id]!;
    let cur = base;
    let chainStart = Number.POSITIVE_INFINITY;
    let placedHere = false;
    for (let k = sorted.length - 1; k >= 0; k--) {
      const line = sorted[k]!;
      const f0 = fireEndingAt(line, cap, T - line.carry_ms);
      let fire: number;
      if (f0 >= t && fitsAt(cur, line, cap, f0)) {
        fire = f0;
      } else if (placedHere && f0 >= t && fitsAt(base, line, cap, f0)) {
        // D36: the conflict is with this order's own siblings only: end where they start.
        const f = fireEndingAt(line, cap, Math.min(T - line.carry_ms, chainStart));
        if (f >= t && fitsAt(cur, line, cap, f)) {
          fire = f;
        } else {
          // The siblings move with T, so the advance is measured against the profile without them.
          let advance = earliestFit(base, Math.max(f, t), line.prep_ms, line.cook_ms, line.units, cap) - f;
          if (advance <= 0) advance = earliestFit(cur, Math.max(f, t), line.prep_ms, line.cook_ms, line.units, cap) - f;
          return { ok: false, advance };
        }
      } else {
        return { ok: false, advance: earliestFit(base, Math.max(f0, t), line.prep_ms, line.cook_ms, line.units, cap) - f0 };
      }
      const booked = bookingAt(line, cap, fire);
      cur = addInterval(cur, booked, booked.units);
      chainStart = Math.min(chainStart, booked.start);
      placedHere = true;
      placements.set(line.order_item_id, { fire, booked });
    }
    out[station_id] = cur;
  }
  return { ok: true, placements, profiles: out };
}

// F §4.7 hold-and-fire for one sync group against `profiles` (the profile after the immediate lines, D36):
// candidate T = max over the group's lines of their slot-formula land time (earliest fit from t, + carry),
// raised to `floor` (delivery pickup, D3); then full passes until one completes with no advancement.
// Terminates: T only grows, by ≥ 1 ms per advance, and past the profiles' last boundaries every line fits.
function holdAndFire(
  profiles: Readonly<Record<string, Profile>>,
  stations: Readonly<Record<string, StationRuntime>>,
  lines: readonly PlanLine[],
  t: number,
  floor: number | null,
): { T: number; placements: Map<string, Placement>; profiles: Record<string, Profile> } {
  const groups = new Map<string, PlanLine[]>();
  let T = floor ?? Number.NEGATIVE_INFINITY;
  for (const line of lines) {
    const cap = effectiveCapacity(stationOf(stations, line));
    const fire = earliestFit(profiles[line.station_id]!, t, line.prep_ms, line.cook_ms, line.units, cap);
    T = Math.max(T, bookingAt(line, cap, fire).end + line.carry_ms);
    groups.set(line.station_id, [...(groups.get(line.station_id) ?? []), line]);
  }
  const byStation = [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, ls]) => {
      const cap = effectiveCapacity(stations[id]!);
      // F §4.7 D36: longest cook first (ties by order_item_id), the first one earliest in time (queueOrder).
      return [id, queueOrder(ls, cap)] as const;
    });
  for (;;) {
    const r = trySyncAt(profiles, stations, byStation, T, t);
    if (r.ok) return { T, placements: r.placements, profiles: r.profiles };
    // Unreachable: capacity < 1 is already refused by stationOf / capacityFor before any loop runs, and with
    // capacity ≥ 1 every advance comes from a fit that failed at the current fire. Kept as a guard (never a
    // hang): an InvalidEvent, so a non-strict fold records a diagnostic (task 7 review ruling).
    if (!(r.advance > 0)) throw new InvalidEvent('capacity_invalid', lines[0]!.order_item_id, lines[0]!.station_id);
    T += r.advance;
  }
}

// Options of the placement sequence: AD-6 strictness and the D25 prune (default on; off only for the unpruned
// re-plan of test 23 and the simulator, §10.6).
export type SequenceOptions = { strict: boolean; prune: boolean };

// §3.5.1 steps 2–4, "one sequence" (G4-1 #3), shared by planOrder / calculateETA and the fold at awaiting = 0, so
// both reach the same placement for the same (state, t):
//   2. pass 1 of §3.5.3 (replan.ts) on every station a new line may use (its station and its allowed alternates,
//      v0.6 G4-2 #23): the older hidden lines are re-placed within their slack, keep first (D6);
//   3. the immediate lines, each at its earliest fit from t against the profile after pass 1, interval added (D36);
//      with them, in `listing` order, every sync line on a FIFO station (§3.5.3 "no hold … placed at
//      earliestFit(t) in submit order; its target is that land time"; AD-14): no hold, no pickup floor;
//   4. each sync group's hold-and-fire loop over its other lines, in the given order, against the profile after
//      the steps before it, floored by the pickup and by the land of each of the group's FIFO lines (AD-14: the
//      group stays one group and T ≥ every FIFO land, so nothing is late at submit). A group of FIFO lines only
//      has T = max(pickup, their lands).
// Routing (§3.5.5) is task 11: every new line is placed on its engine station. §3.3: in-flight lines are read only
// through liveProfiles (inside pass 1); the working profiles include their live intervals and are never stored.
// Returns the new lines' placements, the groups' targets (loop results), the FIFO-placed sync lines and pass 1's
// moves of older lines. `listing` = the batch's order_item_ids in listing order (the step-3 order).
function placeSequence(
  state: EngineState,
  immediates: ReadonlyArray<PlanLine & NewLine>,
  syncGroups: ReadonlyArray<ReadonlyArray<PlanLine & NewLine>>,
  listing: readonly string[],
  t: number,
  floor: number | null,
  o: SequenceOptions,
): { placements: Map<string, Placement>; targets: number[]; fifo: Set<string>; moves: Map<string, Placement> } {
  const stations = state.stations;
  const all = [...immediates, ...syncGroups.flat()];
  for (const line of all) stationOf(stations, line);
  const uses = all.flatMap((l) => [l.station_id, ...l.alternates.map((a) => a.station_id)]);
  const p1 = pass1(state, uses, all, t, { prune: o.prune, strict: o.strict });
  let profiles: Record<string, Profile> = p1.profiles;
  const placements = new Map<string, Placement>();
  // §3.8a: a return line is an immediate placed here — its earliest fit after pass 1 kept the older lines within
  // d − keep, i.e. "within other lines' slack and min_slack_keep_ms, never past their deadlines". SEAM (task 16):
  // with settings.returns_boost = true it is placed as a boost of the return line only (§3.9) and may push others.
  // §3.5.3 FIFO / AD-14: a FIFO station's sync line is placed here like an immediate one.
  const fifo = new Set(syncGroups.flat().filter((l) => isFifo(state, l.station_id)).map((l) => l.order_item_id));
  const rank = new Map(listing.map((id, i) => [id, i]));
  const step3 = [...immediates, ...syncGroups.flat().filter((l) => fifo.has(l.order_item_id))].sort(
    (a, b) => (rank.get(a.order_item_id) ?? 0) - (rank.get(b.order_item_id) ?? 0),
  );
  for (const line of step3) {
    const cap = effectiveCapacity(stations[line.station_id]!);
    const fire = earliestFit(profiles[line.station_id]!, t, line.prep_ms, line.cook_ms, line.units, cap);
    const booked = bookingAt(line, cap, fire);
    profiles = { ...profiles, [line.station_id]: addInterval(profiles[line.station_id]!, booked, booked.units) };
    placements.set(line.order_item_id, { fire, booked });
  }
  const targets: number[] = [];
  for (const group of syncGroups) {
    if (group.length === 0) continue;
    // AD-14: each FIFO line's land floors the group's T.
    let g = floor ?? Number.NEGATIVE_INFINITY;
    for (const l of group) if (fifo.has(l.order_item_id)) g = Math.max(g, placements.get(l.order_item_id)!.booked.end + l.carry_ms);
    const held = group.filter((l) => !fifo.has(l.order_item_id));
    if (held.length === 0) {
      targets.push(g);
      continue;
    }
    const r = holdAndFire(profiles, stations, held, t, g === Number.NEGATIVE_INFINITY ? null : g);
    profiles = r.profiles;
    for (const [id, pl] of r.placements) placements.set(id, pl);
    targets.push(r.T);
  }
  return { placements, targets, fifo, moves: p1.moves };
}

// Books new lines (AD-7: `booked` on the line, added to the stored profile; fire_ms set) and re-sorts `unfired`
// on their stations (§3.3, (fire, order_item_id)); a line over effective capacity appends an 'over_capacity'
// diagnostic (AD-4) in both modes. The stored profile gets only planned bookings, never live intervals (§3.3).
function bookNew(
  state: EngineState,
  pending: readonly EngineLine[],
  placements: ReadonlyMap<string, Placement>,
  deadlines: ReadonlyMap<string, number>,
  event_id: string,
): EngineState {
  const stations: Record<string, StationRuntime> = { ...state.stations };
  const lines: Record<string, EngineLine> = { ...state.lines };
  const diagnostics: Diagnostic[] = [];
  const touched = new Set<string>();
  for (const line of pending) {
    const { fire, booked } = placements.get(line.order_item_id)!;
    lines[line.order_item_id] = { ...line, fire_ms: fire, booked, deadline_ms: deadlines.get(line.order_item_id)! };
    const station = stations[line.station_id]!;
    stations[line.station_id] = {
      ...station,
      profile: addInterval(station.profile, booked, booked.units),
      unfired: [...station.unfired, line.order_item_id],
    };
    touched.add(line.station_id);
    const cap = effectiveCapacity(station);
    if (line.units > cap) {
      diagnostics.push({
        kind: 'over_capacity',
        event_id,
        order_item_id: line.order_item_id,
        station_id: line.station_id,
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
  );
  // AD-12: each new line's queued deadline, from the stored group T and the loop result that placed it.
  const loopT = new Map<string, number>();
  groups.forEach((g, i) => loopT.set(g[0]!.group_id, placed.targets[i]!));
  const deadlines = new Map<string, number>();
  for (const l of pending) {
    const pl = placed.placements.get(l.order_item_id)!;
    const T = order.groups[l.group_id]?.target_land_ms ?? pl.booked.end + l.carry_ms;
    // §3.5.3 / AD-14: a FIFO line's target is its own land time, so its deadline is its fire.
    if (placed.fifo.has(l.order_item_id)) {
      deadlines.set(l.order_item_id, pl.fire);
      continue;
    }
    const lt = l.serve_mode === 'sync' ? loopT.get(l.group_id)! : pl.booked.end + l.carry_ms;
    deadlines.set(l.order_item_id, queuedDeadline(pl.fire, lt, T));
  }
  return bookNew(applyMoves(state, placed.moves, event_id, o.strict), pending, placed.placements, deadlines, event_id);
}

// §3.5.3 triggers (D13): ItemRemoved / ItemVoided re-plan "that station", and "the group's T may move earlier,
// never later: T' = min(T, loop result); the promise P never moves" (test 89; story "void of an item in-flight →
// latest-start times of the remaining items in that order are recalculated; target land time may move earlier").
// Called after the ended line left the profile (AD-7). Reading (report): the one sequence again —
//   1. pass 1 on the ended line's station, with the group's hidden lines held where they are (fixed input);
//   2. the group's hold-and-fire loop over its hidden lines on all their stations, against the live profiles
//      after step 1 without those lines; floor = the pickup time and the land time (live interval end + carry)
//      of every other open line of the group that cannot move (frozen, fired, COOKING);
//   3. loop < T → the hidden lines take the loop placement, the group T and every group line's deadline become
//      T', the order T = max over its groups; otherwise nothing of the group changes (T kept).
// Promises (EngineOrder.promise_ms) are never touched. An immediate line is its own group: nothing to re-loop.
export function replanEnded(state: EngineState, ended: EngineLine, t: number, event_id: string, o: SequenceOptions): EngineState {
  const order = state.orders[ended.order_id];
  const group = order?.groups[ended.group_id];
  const siblings =
    order === undefined || group === undefined || ended.serve_mode !== 'sync'
      ? []
      : group.line_ids
          .filter((id) => id !== ended.order_item_id)
          .map((id) => state.lines[id])
          .filter((l): l is EngineLine => l !== undefined && l.units > 0 && (l.stage === 'added' || l.stage === 'cooking'));
  // §3.5.3 / AD-14: a FIFO line is never re-looped (no re-plan of older lines); its land is a floor below.
  const movable = siblings.filter((l) => isHidden(state, l, t) && !isFifo(state, l.station_id));
  const held = new Set(movable.map((l) => l.order_item_id));
  const p1 = pass1(state, [ended.station_id], [], t, { prune: false, held, strict: o.strict });
  let next = applyMoves(state, p1.moves, event_id, o.strict);
  if (movable.length === 0) return next;

  const ids = [...new Set(movable.map((l) => l.station_id))];
  const live = liveProfiles(next, ids, t);
  const profiles: Record<string, Profile> = { ...live };
  for (const l of movable) {
    const b = l.booked!;
    profiles[l.station_id] = o.strict
      ? removeInterval(profiles[l.station_id]!, b, b.units)
      : removeInterval(profiles[l.station_id]!, b, b.units, () => undefined);
  }
  let floor = order!.pickup_at_ms ?? Number.NEGATIVE_INFINITY;
  for (const l of siblings) {
    if (held.has(l.order_item_id)) continue;
    const iv = liveInterval(next, l.order_item_id, t);
    if (iv !== null) floor = Math.max(floor, iv.end + l.carry_ms);
  }
  for (const l of movable) stationOf(next.stations, l);
  const loop = holdAndFire(profiles, next.stations, movable, t, floor === Number.NEGATIVE_INFINITY ? null : floor);
  const T = group!.target_land_ms;
  if (!(loop.T < T)) return next;

  next = applyMoves(next, loop.placements, event_id, o.strict);
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

// 03a §6.1d, §3.5.1 step 1 (D21): a line routed only to a paused station (its engine station and every allowed
// alternate paused) → 409 STATION_PAUSED { station_id } (the line's station). Lines that are not engine lines
// (§3.2) are never checked; a station the engine does not know is not paused.
export function checkOrderable(state: EngineState, proposed: ProposedOrder): void {
  for (const line of proposed.lines) {
    if (!isEngineLine(line)) continue;
    const ids = [line.station_id!, ...line.alternates.map((a) => a.station_id)];
    if (ids.every((id) => state.stations[id]?.paused === true)) {
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
    const line: PlanLine & NewLine & { from_stock: boolean } = {
      order_item_id: l.order_item_id,
      station_id: station.station_id,
      units: lineUnits(l),
      prep_ms: l.prep_buffer_ms ?? 0,
      cook_ms: shape.cook_ms,
      carry_ms: l.carry_ms,
      serve_mode: shape.serve_mode,
      max_early_ms: l.max_early_ms,
      alternates: l.alternates,
      from_stock: shape.from_stock,
    };
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
  const land = (l: PlanLine): number => placed.placements.get(l.order_item_id)!.booked.end + l.carry_ms;
  let index = state.orders[proposed.order_id]?.next_group_index ?? 0;
  const groups: PlanResult['groups'] = [];
  if (sync.length > 0) {
    const T = placed.targets[0]!;
    const padding = Math.max(...sync.map((l) => paddingOf(state, l.station_id, order_type)));
    groups.push({ group_id: `${proposed.order_id}:${index++}`, target_land_ms: T, promise_ms: T + padding, order_item_ids: sync.map((l) => l.order_item_id) });
  }
  for (const l of immediates) {
    const T = land(l);
    groups.push({
      group_id: `${proposed.order_id}:${index++}`,
      target_land_ms: T,
      promise_ms: T + paddingOf(state, l.station_id, order_type),
      order_item_ids: [l.order_item_id],
    });
  }
  return {
    groups,
    lines: planLines.map((l, i) => ({
      order_item_id: l.order_item_id,
      station_id: l.station_id,
      alternates: engineLines[i]!.alternates.map((a) => ({ ...a })),
      point_id: engineLines[i]!.point_id,
      carry_ms: l.carry_ms,
      from_stock: l.from_stock,
      eta_ms: land(l),
    })),
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

