// 03a §3.2 (lines, units, cook time) and §3.5.1 (target and promise at submit: planOrder, calculateETA,
// checkOrderable; the fold plans at the ItemAdded that brings awaiting to 0, through the same placement).
// Pure: no clock, no ids; t is the triggering event's recorded_at or the handler's now.
import { DomainError } from '@pos/domain';
import type { ItemAddedPayload } from '@pos/events';
import { addInterval, earliestFit, latestFit, occupancy } from './profile.js';
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

// AD-6 / AD-8(c): a writer bug found by an order fold. Strict folds throw it. Non-strict: a listed bad line is
// dropped and still decrements awaiting (foldItemAdded); an unlisted one changes nothing (applyEvent catches
// it); either way one 'invalid_event' diagnostic is appended.
export class InvalidEvent extends Error {
  constructor(
    readonly reason: string,
    readonly order_item_id: string,
    readonly station_id?: string,
  ) {
    super(`invalid event (${reason}) for line ${order_item_id}${station_id === undefined ? '' : ` on station ${station_id}`}`);
    this.name = 'InvalidEvent';
  }
}

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

// §3.2: d(L) = T − carry − cook − prep, the latest fire that lands on target.
export function deadlineOf(line: Pick<EngineLine, 'carry_ms' | 'cook_ms' | 'prep_ms'>, target_land_ms: number): number {
  return target_land_ms - line.carry_ms - line.cook_ms - line.prep_ms;
}

// D37: effective capacity = override ?? capacity.
export function effectiveCapacity(station: Pick<StationRuntime, 'capacity' | 'capacity_override'>): number {
  return station.capacity_override ?? station.capacity;
}

// Sorted insert into StationRuntime.unfired, ordered by (fire, order_item_id) (§3.3).
function insertUnfired(unfired: readonly string[], id: string, fire: number, lines: Readonly<Record<string, EngineLine>>): string[] {
  const out = [...unfired];
  let i = out.length;
  while (i > 0) {
    const prev = lines[out[i - 1]!]!;
    const pf = prev.fire_ms ?? Number.POSITIVE_INFINITY;
    if (pf < fire || (pf === fire && out[i - 1]! < id)) break;
    i--;
  }
  out.splice(i, 0, id);
  return out;
}

// ---- §3.5.1 steps 3–4: the one placement sequence of planOrder and the fold ----------------------------------

// What the placement reads of a line (an EngineLine, or a line built from a ProposedOrder).
type PlanLine = Pick<EngineLine, 'order_item_id' | 'station_id' | 'units' | 'prep_ms' | 'cook_ms' | 'carry_ms'>;
type Booking = { start: number; end: number; units: number };
type Placement = { fire: number; booked: Booking };

// AD-4: the booking of a line fired at `fire` (prep off-station, D35).
function bookingAt(line: PlanLine, cap: number, fire: number): Booking {
  const occ = occupancy(line.units, cap, line.cook_ms);
  return { start: fire + line.prep_ms, end: fire + line.prep_ms + occ.cook_ms, units: occ.units };
}

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
      const dur = (l: PlanLine): number => occupancy(l.units, cap, l.cook_ms).cook_ms;
      // F §4.7 D36: longest cook first (ties by order_item_id), the first one earliest in time.
      return [id, [...ls].sort((x, y) => dur(y) - dur(x) || (x.order_item_id < y.order_item_id ? -1 : 1))] as const;
    });
  for (;;) {
    const r = trySyncAt(profiles, stations, byStation, T, t);
    if (r.ok) return { T, placements: r.placements, profiles: r.profiles };
    // Unreachable (every advance comes from a fit that failed at the current fire): a bug, never a hang.
    if (!(r.advance > 0)) throw new Error(`hold-and-fire made no progress at T = ${T}`);
    T += r.advance;
  }
}

// §3.5.1 steps 3–4 against the current station profiles (pass 1, step 2, arrives in task 8): the immediate lines
// first, each at its earliest fit from t, its interval added (D36); then each sync group's hold-and-fire loop,
// in the given order, against the profile after the steps before it. Routing (§3.5.5) is task 11: every line
// uses its engine station. Shared by planOrder / calculateETA and the fold at awaiting = 0, so both reach the
// same placement for the same (state, t).
function placeBatch(
  stations: Readonly<Record<string, StationRuntime>>,
  immediates: readonly PlanLine[],
  syncGroups: ReadonlyArray<readonly PlanLine[]>,
  t: number,
  floor: number | null,
): { placements: Map<string, Placement>; targets: number[]; profiles: Record<string, Profile> } {
  let profiles: Record<string, Profile> = {};
  for (const line of [...immediates, ...syncGroups.flat()]) profiles[line.station_id] = stationOf(stations, line).profile;
  const placements = new Map<string, Placement>();
  for (const line of immediates) {
    const cap = effectiveCapacity(stations[line.station_id]!);
    const fire = earliestFit(profiles[line.station_id]!, t, line.prep_ms, line.cook_ms, line.units, cap);
    const booked = bookingAt(line, cap, fire);
    profiles = { ...profiles, [line.station_id]: addInterval(profiles[line.station_id]!, booked, booked.units) };
    placements.set(line.order_item_id, { fire, booked });
  }
  const targets: number[] = [];
  for (const group of syncGroups) {
    if (group.length === 0) continue;
    const r = holdAndFire(profiles, stations, group, t, floor);
    profiles = r.profiles;
    for (const [id, pl] of r.placements) placements.set(id, pl);
    targets.push(r.T);
  }
  return { placements, targets, profiles };
}

// §3.5.1 "When the fold plans": places the order's lines that are not placed yet (this batch's lines) at the
// ItemAdded that brought awaiting to 0, through placeBatch (steps 3–4; the order's pickup_at_ms is the delivery
// floor). The sync groups go in line_ids order of their first line. The stored group T and P are never
// recomputed (§3.5.1 step 6, P-2): the loop result only places the lines, and for a batch planned by planOrder
// at a now ≤ recorded_at against the same state it lands every group exactly at its stored T; a line that no
// longer fits by the append gap lands later and the tick slips it (§3.5.3). Each booking is the AD-4 occupancy,
// stored on the line (AD-7); a line over effective capacity appends an 'over_capacity' diagnostic (AD-4) in
// both modes. Copy-on-write: only the touched stations and lines are copied.
export function planNewLines(state: EngineState, order_id: string, t: number, event_id: string): EngineState {
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
  const placed = placeBatch(state.stations, immediates, [...syncGroups.values()], t, order.pickup_at_ms);

  const stations: Record<string, StationRuntime> = { ...state.stations };
  for (const [id, profile] of Object.entries(placed.profiles)) stations[id] = { ...stations[id]!, profile };
  const lines: Record<string, EngineLine> = { ...state.lines };
  const diagnostics: Diagnostic[] = [];
  for (const line of pending) {
    const { fire, booked } = placed.placements.get(line.order_item_id)!;
    lines[line.order_item_id] = { ...line, fire_ms: fire, booked };
    const station = stations[line.station_id]!;
    stations[line.station_id] = { ...station, unfired: insertUnfired(station.unfired, line.order_item_id, fire, lines) };
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
  return {
    ...state,
    stations,
    lines,
    diagnostics: diagnostics.length === 0 ? state.diagnostics : [...state.diagnostics, ...diagnostics],
  };
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

// 03a §6.1b, §3.5.1 steps 1, 3–6 (pass 1 of step 2 arrives in task 8), BF-2. Pure: returns the plan, never
// state, so nothing is appended (AD-4's over_capacity diagnostic is the fold's). from_stock is reserveStock's map
// (a line absent from it is fresh). Groups: the sync group first (`order_id:n`, n = the order's
// next_group_index, 0 for a new order), then one group per immediate line in listing order; eta_ms is the line's
// own land time at its point (a serialised sync sibling lands before T, D36).
export function planOrder(
  state: EngineState,
  proposed: ProposedOrder,
  now: number,
  from_stock: Readonly<Record<string, boolean>>,
): PlanResult {
  checkOrderable(state, proposed);
  const engineLines = proposed.lines.filter((l) => isEngineLine(l));
  const planLines = engineLines.map((l) => {
    const station = stationOf(state.stations, { order_item_id: l.order_item_id, station_id: l.station_id! });
    const fs = from_stock[l.order_item_id] === true;
    if (l.serve_mode === null) throw new InvalidEvent('serve_mode_null', l.order_item_id, station.station_id);
    const line: PlanLine & { serve_mode: 'sync' | 'immediate'; from_stock: boolean } = {
      order_item_id: l.order_item_id,
      station_id: station.station_id,
      units: lineUnits(l),
      prep_ms: l.prep_buffer_ms ?? 0,
      cook_ms: lineCookTimes(l, station.type, fs).cook_ms,
      carry_ms: l.carry_ms,
      serve_mode: l.serve_mode,
      from_stock: fs,
    };
    return line;
  });
  const immediates = planLines.filter((l) => l.serve_mode === 'immediate');
  const sync = planLines.filter((l) => l.serve_mode === 'sync');
  const placed = placeBatch(state.stations, immediates, [sync], now, proposed.order.pickup_at_ms);

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

