// 03a task 16b: the read models (§6.1h–§6.1l). Pure in their arguments; nothing is stored, nothing is written.
//   - Every reader uses the exit predicate, never the presence of the row (§3.3), so an abandoned order, or one the
//     removal step keeps only for its reservation (AD-20), is in no view.
//   - In-flight lines are read only through liveInterval / liveProfiles (§3.3).
//   - AD-8: a placeholder is not a line. It is never in `unfired` (nothing is placed until awaiting reaches 0) and it
//     counts for nothing in groupReadiness.
// Hidden / frozen are the §3.4 definitions at the caller's now. `capped` is deliberately not on ViewLine: §3.6.3 and
// §6.5 do not list it, and the overload item reads it on unfired lines only (slip.ts).
import type { ReservationsShiftedPayload, StationPlanLine as WsStationPlanLine } from '@pos/events';
import { effectiveCapacity } from './capacity.js';
import { isPlaceholder, orderInEngine } from './lifecycle.js';
import { liveInterval, liveProfile, liveProfiles } from './live.js';
import { bookingAt } from './overload.js';
import { pressureBand, pressureBp, type PressureBand } from './pressure.js';
import { addInterval, earliestFit, removeInterval } from './profile.js';
import { combine, stationPolicy } from './replan.js';
import type { EngineLine, EngineState, Interval, Profile, StationRuntime } from './state.js';
import { ctxOf, loadReady, pushDown, ready, scratch, type FireDispatchedDraft, type ReservationsShiftedDraft } from './tick.js';

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// The exit predicate per order for one read.
function predicate(state: EngineState, now: number): (order_id: string) => boolean {
  const memo = new Map<string, boolean>();
  return (order_id) => {
    let v = memo.get(order_id);
    if (v === undefined) {
      const order = state.orders[order_id];
      v = order !== undefined && orderInEngine(state, order, now);
      memo.set(order_id, v);
    }
    return v;
  };
}

// §3.4: the station's placed unfired lines at now, `unfired` order = (fire, order_item_id), each with its frozen flag.
function unfiredAt(state: EngineState, station: StationRuntime, now: number): Array<{ line: EngineLine & { fire_ms: number }; frozen: boolean }> {
  const inEngine = predicate(state, now);
  const freeze = stationPolicy(state, station.station_id).freeze_ms;
  const out: Array<{ line: EngineLine & { fire_ms: number }; frozen: boolean }> = [];
  for (const id of station.unfired) {
    const line = state.lines[id];
    if (line === undefined || line.fire_ms === null || line.stage !== 'added' || line.fired_at !== null || !inEngine(line.order_id)) continue;
    out.push({ line: line as EngineLine & { fire_ms: number }, frozen: line.fire_ms <= now + freeze });
  }
  return out;
}

// ---- stationView (§6.1h, D16, D17) ----------------------------------------------------------------------------------

export type ViewLine = Pick<
  EngineLine,
  'order_item_id' | 'order_id' | 'group_id' | 'serve_mode' | 'units' | 'stage' | 'fire_ms' | 'deadline_ms' | 'fired_at' | 'started_at' | 'mark' | 'return_of' | 'load_id'
> & { live: Interval | null };

export interface StationViewBody {
  now: ViewLine[];
  next: ViewLine[];
  later_count: number;
}

function viewLine(state: EngineState, line: EngineLine, now: number): ViewLine {
  return {
    order_item_id: line.order_item_id,
    order_id: line.order_id,
    group_id: line.group_id,
    serve_mode: line.serve_mode,
    units: line.units,
    stage: line.stage,
    fire_ms: line.fire_ms,
    deadline_ms: line.deadline_ms,
    fired_at: line.fired_at,
    started_at: line.started_at,
    mark: line.mark,
    return_of: line.return_of,
    load_id: line.load_id,
    live: liveInterval(state, line.order_item_id, now),
  };
}

// Proposed (implementer, overnight) V1: Now = every fired line until its Done, the COOKING ones too (§4.3 To 03b #2:
// "Done removes its line"; the §3.4 diagram stops at the fired line). Alternative: fired-not-started only, which would
// leave a cooking line on no list.
// Proposed (implementer, overnight) V2: both lists stay in fire order, (fire_ms, order_item_id), and a marked line is not
// moved here; "jump to the top in red" is the screen's rule (§4.3 To 03b #2) and the line carries `mark`. Alternative:
// sort marked lines first here, which would put a screen rule in the engine.
export function stationView(state: EngineState, station_id: string, now: number): StationViewBody {
  const station = state.stations[station_id];
  if (station === undefined) return { now: [], next: [], later_count: 0 };
  const inEngine = predicate(state, now);
  const fired: EngineLine[] = [];
  for (const id in state.lines) {
    const l = state.lines[id]!;
    if (l.station_id === station_id && (l.stage === 'cooking' || (l.stage === 'added' && l.fired_at !== null)) && inEngine(l.order_id)) fired.push(l);
  }
  const fireOf = (l: EngineLine): number => l.fire_ms ?? l.fired_at ?? l.started_at ?? 0;
  fired.sort((a, b) => fireOf(a) - fireOf(b) || byId(a.order_item_id, b.order_item_id));
  const unfired = unfiredAt(state, station, now);
  return {
    now: fired.map((l) => viewLine(state, l, now)),
    next: unfired.filter((u) => u.frozen).map((u) => viewLine(state, u.line, now)),
    later_count: unfired.filter((u) => !u.frozen).length,
  };
}

// ---- stationPlan (§3.6.3) -------------------------------------------------------------------------------------------

export type StationPlanLine = WsStationPlanLine;
export interface StationPlanBody {
  station_id: string;
  lines: StationPlanLine[];
}

// §3.6.3 minus as_of_seq (the host stamps it): every unfired line. Task 1b: every listed line has a number fire_ms (a
// line enters `unfired` only when it is placed), so the ws schema's fire_ms is a number.
export function stationPlan(state: EngineState, station_id: string, now: number): StationPlanBody {
  const station = state.stations[station_id];
  if (station === undefined) return { station_id, lines: [] };
  return {
    station_id,
    lines: unfiredAt(state, station, now).map(({ line, frozen }) => ({
      order_item_id: line.order_item_id,
      order_id: line.order_id,
      fire_ms: line.fire_ms,
      deadline_ms: line.deadline_ms,
      mark: line.mark,
      frozen,
    })),
  };
}

// ---- groupReadiness (§6.1i, §3.4, F §4.7 hold at pass) --------------------------------------------------------------

export interface GroupReadiness {
  group_id: string;
  done: string[];
  waiting: string[];
  hold: boolean;
}

// Per group, its sync lines only (F: "Immediate items are never held"): done = `done` or later, waiting = `added` or
// `cooking`; a removed / voided / returned line is neither. hold is a hint (§3.4 v0.3), never a block: a line still at
// the pass (`done`) with a sibling not yet done. Order READY (§3.4) = no group has anything waiting.
// Proposed (implementer, overnight) G1: `now` is a required third argument. §6.1i has no time, but §3.3 says every view
// uses the predicate, which needs one; required, so a host written from §6.1i gets a compile error instead of silently
// skipping the predicate. Alternative: no predicate here (an exited order would still answer until its row goes).
// Proposed (implementer, overnight) G2: a served line counts as done ("done (or later)", §3.4) but holds nothing, it has
// left the pass. Alternative: hold = done ∧ waiting, which would flag HOLD with nothing on the pass.
export function groupReadiness(state: EngineState, order_id: string, now: number): GroupReadiness[] {
  const order = state.orders[order_id];
  if (order === undefined || !orderInEngine(state, order, now)) return [];
  return Object.keys(order.groups).map((group_id) => {
    const done: string[] = [];
    const waiting: string[] = [];
    let atPass = false;
    for (const id of order.groups[group_id]!.line_ids) {
      const line = state.lines[id];
      if (line === undefined || line.serve_mode !== 'sync' || isPlaceholder(line)) continue;
      if (line.stage === 'added' || line.stage === 'cooking') waiting.push(id);
      else if (line.stage === 'done' || line.stage === 'served') {
        done.push(id);
        atPass ||= line.stage === 'done';
      }
    }
    return { group_id, done, waiting, hold: atPass && waiting.length > 0 };
  });
}

// ---- stationsLive (§6.5, §6.1j) -------------------------------------------------------------------------------------

export interface StationLive {
  station_id: string;
  name: string;
  capacity: number;
  capacity_override: number | null;
  effective_capacity: number;
  paused: boolean;
  pause_enabled: boolean;
  pressure_bp: number;
  band: PressureBand;
  later_count: number;
  wait_ms: number;
}

export interface StationsLiveBody {
  now_ms: number;
  stations: StationLive[];
}

// §6.5 "time until one unit with the station's reference_cook_ms can start": the first stretch of the live profile that
// holds it. reference_cook_ms 0 (no routed items, §3.11) has nothing to fit: 0.
function waitMs(profile: Profile, reference_cook_ms: number, cap: number, now: number): number {
  return cap >= 1 ? earliestFit(profile, now, 0, reference_cook_ms, 1, cap) - now : 0;
}

// §6.5 body minus as_of_seq (the host stamps it). One read of the lines (liveProfiles) and of each station's `unfired`,
// so §7.1's 5 ms holds with no per-line liveInterval.
// Proposed (implementer, overnight) SL1: an archived station is left out like an unknown id (§6.6 step 3 treats it so);
// stations in id order whatever the order of station_ids. Alternative: archived listed while it has open lines.
export function stationsLive(state: EngineState, now: number, station_ids?: string[]): StationsLiveBody {
  const wanted = station_ids === undefined ? null : new Set(station_ids);
  const cfgs = (state.config?.stations ?? []).filter((c) => !c.is_archived && state.stations[c.station_id] !== undefined && (wanted === null || wanted.has(c.station_id)));
  cfgs.sort((a, b) => byId(a.station_id, b.station_id));
  const profiles = liveProfiles(state, cfgs.map((c) => c.station_id), now);
  return {
    now_ms: now,
    stations: cfgs.map((c) => {
      const station = state.stations[c.station_id]!;
      const cap = effectiveCapacity(station);
      const profile = profiles[c.station_id]!;
      const pressure_bp = pressureBp(profile, cap, c.pressure_window_ms, now);
      return {
        station_id: c.station_id,
        name: c.name,
        capacity: station.capacity,
        capacity_override: station.capacity_override,
        effective_capacity: cap,
        paused: station.paused,
        pause_enabled: c.pause_enabled,
        pressure_bp,
        band: pressureBand(pressure_bp, c),
        later_count: unfiredAt(state, station, now).filter((u) => !u.frozen).length,
        wait_ms: waitMs(profile, c.reference_cook_ms, cap, now),
      };
    }),
  };
}

// ---- pullEarly (§6.1k, D16 Give me more) ----------------------------------------------------------------------------

function pullDraft(station_id: string, order_item_ids: string[], load_id: string | null, due_at: number): FireDispatchedDraft {
  return { stream_type: 'station', stream_id: station_id, event_type: 'FireDispatched', schema_version: 1, payload: { station_id, order_item_ids, load_id, due_at, reason: 'pulled' } };
}

// Not due yet (a due line is the tick's, it fires it within a pass) and inside its max_early_ms.
function pullable(line: EngineLine, now: number): boolean {
  return line.fire_ms !== null && line.fire_ms > now && now >= line.deadline_ms - line.max_early_ms;
}

// The packed Start a pulled reservation would get, if its interval there runs over no other planned booking.
// `pack` = the in-flight lines only, `others` = the live profile without this reservation's own booking.
function pullStart(pack: Profile, others: Profile, now: number, prep: number, cook: number, units: number, cap: number): number | null {
  const s = earliestFit(pack, now, prep, cook, units, cap);
  return earliestFit(others, s, prep, cook, units, cap) === s ? s : null;
}

// Whether the lines fit together as the fold will place them: every one gets fire_ms = now, so they pack by
// order_item_id (§3.3 packing, AD-9), not in the order they were chosen.
function pullSetFits(live: Profile, pack: Profile, lines: readonly EngineLine[], now: number, cap: number): boolean {
  let others = live;
  for (const l of lines) others = removeInterval(others, l.booked!, l.booked!.units, () => {});
  let packed = pack;
  for (const l of [...lines].sort((a, b) => byId(a.order_item_id, b.order_item_id))) {
    const s = pullStart(packed, others, now, l.prep_ms, l.cook_ms, l.units, cap);
    if (s === null) return false;
    const b = bookingAt(l, cap, s);
    others = addInterval(others, b, b.units);
    packed = addInterval(packed, b, b.units);
  }
  return true;
}

// Slot station: the next n lines in fire order ("pulls the next items early", D16; D17 never reorders). A line joins
// only if the whole set still fits in the fold's order.
function pullSlot(state: EngineState, station: StationRuntime, n: number, now: number, cap: number): FireDispatchedDraft | null {
  const live = liveProfile(state, station.station_id, now);
  const pack = combine(live, station.profile, -1, () => {});
  const out: EngineLine[] = [];
  for (const id of station.unfired) {
    if (out.length >= n) break;
    const line = state.lines[id];
    if (!ready(state, line) || line.booked === null || !pullable(line, now)) continue;
    if (pullSetFits(live, pack, [...out, line], now, cap)) out.push(line);
  }
  if (out.length === 0) return null;
  return pullDraft(station.station_id, out.map((l) => l.order_item_id).sort(byId), null, out[0]!.fire_ms!);
}

// Batch station: a whole load or nothing (task 14 note), and every member inside its own max_early_ms; one event names
// one load, so one load per draft whatever n is.
function pullBatch(state: EngineState, station: StationRuntime, now: number, cap: number): FireDispatchedDraft | null {
  const live = liveProfile(state, station.station_id, now);
  const pack = combine(live, station.profile, -1, () => {});
  const loads = Object.values(station.loads).sort((a, b) => a.fire_ms - b.fire_ms || byId(a.load_id, b.load_id));
  for (const load of loads) {
    if (!loadReady(state, load) || !load.order_item_ids.every((id) => pullable(state.lines[id]!, now))) continue;
    if (pullStart(pack, removeInterval(live, load.booked, load.booked.units, () => {}), now, load.booked.start - load.fire_ms, load.booked.end - load.booked.start, Math.min(load.booked.units, cap), cap) !== null) {
      return pullDraft(station.station_id, [...load.order_item_ids].sort(byId), load.load_id, load.fire_ms);
    }
  }
  return null;
}

// Proposed (implementer, overnight) E1: the limit is max_early_ms only (D16 "same max_early_ms limit"), not auto-fill's
// "fits from now": a line auto-fill could take is already on Now, so that test would leave the button nothing. A pulled
// line goes on Now and packs behind the in-flight lines (§3.3), so the chef decides when to Start it.
// Proposed (implementer, overnight) E2: a line whose interval at its packed Start would run over another line's planned
// booking is passed over, so a pull never over-books nor pushes a frozen line (D15: exactly two exceptions, and a pull is
// not one). Alternative: pull it regardless and let lateStartShift move the others at its Start.
// Proposed (implementer, overnight) E3: one draft with several lines has one due_at, the earliest planned fire (the fold
// does not read it, §4.2). Alternative: only lines sharing a fire per draft, which would make n > 1 rare.
export function pullEarly(state: EngineState, station_id: string, n: number, now: number): FireDispatchedDraft | null {
  const station = state.stations[station_id];
  if (station === undefined || !(n >= 1)) return null;
  const cap = effectiveCapacity(station);
  if (!(cap >= 1)) return null;
  return station.type === 'batch' ? pullBatch(state, station, now, cap) : pullSlot(state, station, n, now, cap);
}

// ---- lateStartShift (§3.3, §6.1l, F §4.7 D42) -----------------------------------------------------------------------

// The draft 03b's StartItem appends with ItemStarted (same transaction), from the state before or after that fold (a
// line not yet COOKING is folded on a scratch copy at started_at). F §4.7 D42's loop: the later unstarted reservations
// in start order, each by the smallest delay that fits beside the live intervals. A fired line is never listed, it moves
// by the packing (C1, tick.ts).
// §3.3 "only by how far the Start came after its packed Start s": a line placed at t was placed behind that line's packed
// Start at t, so the overlap is at most started − t and the same delay passes down the queue; a Start at s overlaps
// nothing and moves nothing.
// Proposed (implementer, overnight) S1: no cascade_step_ms rounding on a late Start. F §4.7 D42's pseudocode rounds for
// both causes, but its reason is "an overrun grows continuously" and §3.3 bounds this shift by the delay (a 61 s late
// Start would otherwise move a line 120 s). Alternative: round up as the overrun cascade does.
export function lateStartShift(state: EngineState, order_item_id: string, started_at: number): ReservationsShiftedDraft | null {
  const line = state.lines[order_item_id];
  if (line === undefined || isPlaceholder(line) || (line.stage !== 'added' && line.stage !== 'cooking')) return null;
  const order = state.orders[line.order_id];
  if (order === undefined || !orderInEngine(state, order, started_at)) return null;
  const started =
    line.stage === 'cooking'
      ? state
      : scratch(state, [{ stream_type: 'order', stream_id: line.order_id, event_type: 'ItemStarted', schema_version: 1, payload: { order_item_id, started_at, source: 'tap' } }], started_at);
  const station = started.stations[line.station_id];
  if (station === undefined) return null;
  const shifts: ReservationsShiftedPayload['shifts'] = pushDown(ctxOf(started), station, started_at, 1);
  if (shifts.length === 0) return null;
  return { stream_type: 'station', stream_id: line.station_id, event_type: 'ReservationsShifted', schema_version: 1, payload: { station_id: line.station_id, cause: 'late_start', shifts } };
}
