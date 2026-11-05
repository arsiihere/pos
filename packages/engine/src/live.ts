// 03a §3.3 "In-flight lines" (F §4.7 D33, D42; §4.5 F-20; P-5). Pure: t is the event's recorded_at or the
// caller's now. The station profile stores only planned bookings (unfired lines, AD-7: a fire, Start, Done,
// serve, remove or void takes the line's booked interval off it); the in-flight lines are laid over it here,
// at each read, so every placement path (planOrder, calculateETA, the fold, later the re-plan and the tick)
// sees the same occupancy at the same t.
//   - COOKING: [started + prep, max(started + prep + cook, t)), started = min(started_at, recorded_at).
//   - Fired, not started: packed per station in (fire_ms, order_item_id) order. Each gets
//     [s + prep, s + prep + cook) with s, its packed Start, the earliest instant ≥ max(fire_ms, t) at which that
//     interval fits within effective capacity beside the COOKING lines and the fired lines packed before it
//     (prep begins at the Start tap, so a line not started at t occupies nothing before t + prep, v0.6.3 N-1).
//     The packing reads only the in-flight lines, never the planned profile.
//   - Every other placed line: its planned (booked) interval; a done / served / removed / voided / returned line
//     and a placeholder (AD-8) occupy nothing.
//   - §3.3: a line of an order out of the engine at t (isOrderInEngine; abandoned before its physical removal)
//     occupies nothing. Only in-flight lines can belong to such an order (an exited order has no unfired line).
// Cook lengths and units are the AD-4 occupancy at the station's effective capacity.
// Batch loads (each fired load one unit of placement) arrive with task 13; until then every line packs alone.
import { orderInEngine } from './lifecycle.js';
import { addInterval, earliestFit, occupancy } from './profile.js';
import type { EngineLine, EngineState, Interval, Profile, StationRuntime } from './state.js';

// D37: effective capacity = override ?? capacity.
export function effectiveCapacity(station: Pick<StationRuntime, 'capacity' | 'capacity_override'>): number {
  return station.capacity_override ?? station.capacity;
}

type Booking = { start: number; end: number; units: number };

function isCooking(line: EngineLine): boolean {
  return line.stage === 'cooking';
}

function isFiredNotStarted(line: EngineLine): boolean {
  return line.stage === 'added' && line.fired_at !== null;
}

// §3.3 COOKING: [started + prep, max(started + prep + cook, t)). started_at is stored as min(started_at,
// recorded_at) by the ItemStarted fold.
function cookingBooking(line: EngineLine, cap: number, t: number): Booking {
  const occ = occupancy(line.units, cap, line.cook_ms);
  const start = (line.started_at ?? t) + line.prep_ms;
  return { start, end: Math.max(start + occ.cook_ms, t), units: occ.units };
}

// §3.3: whether the line's order is in the engine at t, memoised per order for one read.
function inEngineAt(state: EngineState, line: EngineLine, t: number, memo: Map<string, boolean>): boolean {
  let v = memo.get(line.order_id);
  if (v === undefined) {
    const order = state.orders[line.order_id];
    v = order !== undefined && orderInEngine(state, order, t);
    memo.set(line.order_id, v);
  }
  return v;
}

// The in-flight lines (COOKING, fired-not-started) of the given stations at t whose order is in the engine, one
// pass over the lines.
function inFlightOf(state: EngineState, station_ids: ReadonlySet<string>, t: number): Map<string, EngineLine[]> {
  const out = new Map<string, EngineLine[]>();
  const memo = new Map<string, boolean>();
  for (const line of Object.values(state.lines)) {
    if (!station_ids.has(line.station_id) || !(isCooking(line) || isFiredNotStarted(line))) continue;
    if (!inEngineAt(state, line, t, memo)) continue;
    const list = out.get(line.station_id);
    if (list === undefined) out.set(line.station_id, [line]);
    else list.push(line);
  }
  return out;
}

// One station's live bookings at t: the COOKING lines, then the fired-not-started ones packed in
// (fire_ms, order_item_id) order. O(fired lines × their boundaries): each fit and insert scans only the pack.
function packStation(lines: readonly EngineLine[], cap: number, t: number): { pack: Profile; bookings: Map<string, Booking> } {
  let pack: Profile = { t: [], u: [] };
  const bookings = new Map<string, Booking>();
  const fired: EngineLine[] = [];
  for (const line of lines) {
    if (!isCooking(line)) {
      fired.push(line);
      continue;
    }
    const b = cookingBooking(line, cap, t);
    pack = addInterval(pack, b, b.units);
    bookings.set(line.order_item_id, b);
  }
  const fireOf = (l: EngineLine): number => l.fire_ms ?? l.fired_at!;
  fired.sort((a, b) => fireOf(a) - fireOf(b) || (a.order_item_id < b.order_item_id ? -1 : a.order_item_id > b.order_item_id ? 1 : 0));
  for (const line of fired) {
    const occ = occupancy(line.units, cap, line.cook_ms);
    const s = earliestFit(pack, Math.max(fireOf(line), t), line.prep_ms, line.cook_ms, line.units, cap);
    const b = { start: s + line.prep_ms, end: s + line.prep_ms + occ.cook_ms, units: occ.units };
    pack = addInterval(pack, b, b.units);
    bookings.set(line.order_item_id, b);
  }
  return { pack, bookings };
}

// Pointwise sum of two canonical profiles in one linear sweep; the result is canonical (profile.ts).
function sumProfiles(a: Profile, b: Profile): Profile {
  if (b.t.length === 0) return a;
  if (a.t.length === 0) return b;
  const t: number[] = [];
  const u: number[] = [];
  let i = 0;
  let j = 0;
  let ua = 0;
  let ub = 0;
  let prev = 0;
  while (i < a.t.length || j < b.t.length) {
    const x = Math.min(i < a.t.length ? a.t[i]! : Infinity, j < b.t.length ? b.t[j]! : Infinity);
    if (i < a.t.length && a.t[i] === x) ua = a.u[i++]!;
    if (j < b.t.length && b.t[j] === x) ub = b.u[j++]!;
    if (ua + ub !== prev) {
      prev = ua + ub;
      t.push(x);
      u.push(prev);
    }
  }
  return { t, u };
}

// The live profiles of the given stations at t: each station's planned profile plus its in-flight lines'
// live intervals. The one read of in-flight lines for every placement path (§3.3).
export function liveProfiles(state: EngineState, station_ids: Iterable<string>, t: number): Record<string, Profile> {
  const ids = new Set(station_ids);
  const inFlight = inFlightOf(state, ids, t);
  const out: Record<string, Profile> = {};
  for (const id of ids) {
    const station = state.stations[id];
    if (station === undefined) continue;
    const lines = inFlight.get(id);
    out[id] = lines === undefined ? station.profile : sumProfiles(station.profile, packStation(lines, effectiveCapacity(station), t).pack);
  }
  return out;
}

export function liveProfile(state: EngineState, station_id: string, t: number): Profile {
  return liveProfiles(state, [station_id], t)[station_id] ?? { t: [], u: [] };
}

// P-5 (spec: liveInterval(line, t)): the occupancy of a line at t, or null when it occupies nothing.
export function liveInterval(state: EngineState, order_item_id: string, t: number): Interval | null {
  const line = state.lines[order_item_id];
  if (line === undefined) return null;
  const station = state.stations[line.station_id];
  if (station === undefined || !inEngineAt(state, line, t, new Map())) return null;
  if (isCooking(line)) {
    const b = cookingBooking(line, effectiveCapacity(station), t);
    return { start: b.start, end: b.end };
  }
  if (isFiredNotStarted(line)) {
    const lines = inFlightOf(state, new Set([line.station_id]), t).get(line.station_id)!;
    const b = packStation(lines, effectiveCapacity(station), t).bookings.get(order_item_id)!;
    return { start: b.start, end: b.end };
  }
  if (line.stage === 'added' && line.booked !== null) return { start: line.booked.start, end: line.booked.end };
  return null;
}
