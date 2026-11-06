// Batch-station loads (task 13): F §4.7 "Batch station" / "ETA formula — batch station" / hold-and-fire step 3(b)
// (D14, D17, D34, D35, D49), 03a §3.2 (a batch line's cook time is its copied program cook time), §3.3 (load id,
// `loads` on StationRuntime), §3.6.1 item 1 (freshness window capped per line by max_early_ms), BF-1. Pure.
//
// The model (F §4.7): a batch station cooks one load at a time — "no overlap against any existing load on that
// station" (step 3(b)), "a load never overlaps the previous one" (D42) — so a load occupies the *whole* station:
// its profile booking holds every unit (`capacity`, or the AD-4 rounds of one over-size line) over its cook
// interval, once, whatever the number of members. A line joins an existing unfired load or forms a new one; the
// members share the load's interval and its fire.
//
// Join rule (F §4.7 ETA formula / step 3(a)), for a line L whose station interval would end at E (= T − carry):
//   - b is unfired (in `loads`; a fired load has left it, D34);
//   - b.program_id = currentProgram(L) (D49) and b's cook = L's cook (proposed (implementer, overnight) J1: the
//     members' copied cook times are equal, so no member is cooked shorter or longer than its copy, §3.2);
//   - room: b's units + L's units ≤ the station's effective capacity (|b.items| < capacity, read in units, §3.2);
//   - prep (task 13 review, reading of "b.startsAt > now"; F step 3(a) has no other prep condition): L can be
//     prepped by b's start from now, b.start − prep(L) ≥ t; a joiner with more prep than the members moves the
//     load's fire earlier to b.start − prep(L) (withMember), so fire_ms = start − the largest member prep (AD-5);
//   - sync: b.end ≤ E and E − b.end ≤ min(freshness_window_ms, max_early_ms(L)) (§3.6.1: capped per line);
//   - immediate (F: "join the earliest not-yet-fired load with room"): b.end ≤ the land of a new load
//     (proposed (implementer, overnight) J3: in F's model a new load starts after every reservation, so joining
//     never lands later; with gap-filling a new load may land earlier, and then it is formed).
// Among joinable loads the first in start order is taken (F "candidate = first batch b").
import { occupancy } from './profile.js';
import type { Booking } from './overload.js';
import type { EngineLine, EngineState, Load } from './state.js';

// BF-1 (G4-3 #5): program_id and stock_program_id are the immutable ItemAdded copies (D25); the current program of
// a line is derived, never stored.
export function currentProgram(line: Pick<EngineLine, 'from_stock' | 'program_id' | 'stock_program_id'>): string | null {
  return line.from_stock ? line.stock_program_id : line.program_id;
}

// §3.11 station_type ("open lines keep their placement as fixed input; new lines follow the new type"): an unfired line
// placed under the station's previous type, read off its shape, so no new state field is needed: a slot booking
// (`booked`) on a batch station, or a member of a stored load on a slot station. proposed (implementer, overnight) S1:
// every re-placement leaves such a line where it is, whatever the trigger (a later capacity change, a boost, an
// expedite, a void's re-loop, a StockAdded flip), and it stays in the fixed profile of every placement; the tick still
// fires it and the cascade still shifts it (D42, physical). Alternative: a later capacity change re-places it too, which
// would need the old type's placement rules on a station of the new type.
export function placedUnderOldType(state: EngineState, line: EngineLine): boolean {
  const station = state.stations[line.station_id];
  if (station === undefined || line.stage !== 'added' || line.fired_at !== null) return false;
  if (station.type === 'batch') return line.booked !== null;
  return line.load_id !== null && station.loads[line.load_id]?.order_item_ids.includes(line.order_item_id) === true;
}

export function isBatchStation(state: EngineState, station_id: string): boolean {
  return state.stations[station_id]?.type === 'batch';
}

// F §4.7 D17 freshnessWindowMs; 01a §4.2: null only on a slot station, default 0 on a batch station.
export function freshnessOf(state: EngineState, station_id: string): number {
  return state.config?.stations.find((s) => s.station_id === station_id)?.freshness_window_ms ?? 0;
}

// A batch line as the profile fits read it: the whole station (max(units, cap); AD-4 rounds for an over-size line).
export function asLoad<L extends { units: number }>(line: L, cap: number): L {
  return { ...line, units: Math.max(line.units, cap) };
}

// What a join reads of a line.
export type JoinLine = Pick<EngineLine, 'order_item_id' | 'units' | 'prep_ms' | 'cook_ms' | 'max_early_ms'> & { program: string | null };

export function joinLine(line: Pick<EngineLine, 'order_item_id' | 'units' | 'prep_ms' | 'cook_ms' | 'max_early_ms' | 'from_stock' | 'program_id' | 'stock_program_id'>): JoinLine {
  return { order_item_id: line.order_item_id, units: line.units, prep_ms: line.prep_ms, cook_ms: line.cook_ms, max_early_ms: line.max_early_ms, program: currentProgram(line) };
}

// A load being planned. load_id null = formed in this placement, named when stored; inherit = the stored load the
// line that formed it came from (a re-plan re-forms hidden loads, §3.3 "a name, not membership").
export type WorkLoad = {
  load_id: string | null;
  inherit: string | null;
  program_id: string;
  cook_ms: number;
  members: string[];
  units: number;
  max_prep: number;
  fire_ms: number;
  booked: Booking;
  capped: boolean;
};

// A stored load as a WorkLoad (cook, prep and units from its members' lines).
export function workOf(state: EngineState, load: Load): WorkLoad {
  let units = 0;
  let max_prep = 0;
  let cook_ms = 0;
  for (const id of load.order_item_ids) {
    const l = state.lines[id];
    if (l === undefined) continue;
    units += l.units;
    max_prep = Math.max(max_prep, l.prep_ms);
    cook_ms = l.cook_ms;
  }
  return { load_id: load.load_id, inherit: null, program_id: load.program_id, cook_ms, members: [...load.order_item_ids], units, max_prep, fire_ms: load.fire_ms, booked: load.booked, capped: false };
}

// Room, program, cook and prep (the conditions that do not depend on the line's target).
export function compatible(b: WorkLoad, L: JoinLine, cap: number, t: number): boolean {
  return L.program !== null && b.program_id === L.program && b.cook_ms === L.cook_ms && b.units + L.units <= cap && b.booked.start - L.prep_ms >= t;
}

const byStart = (a: WorkLoad, b: WorkLoad): number => a.booked.start - b.booked.start || a.booked.end - b.booked.end;

// Sync join (F step 3(a)): the first load in start order with b.end ≤ E and E − b.end ≤ min(window, max_early_ms).
export function syncJoin(loads: readonly WorkLoad[], L: JoinLine, cap: number, E: number, window: number, t: number): WorkLoad | undefined {
  const w = Math.min(window, L.max_early_ms);
  return [...loads].sort(byStart).find((b) => compatible(b, L, cap, t) && b.booked.end <= E && E - b.booked.end <= w);
}

// Immediate join (J3): the first compatible load in start order that lands no later than `newEnd`.
export function immediateJoin(loads: readonly WorkLoad[], L: JoinLine, cap: number, newEnd: number, t: number): WorkLoad | undefined {
  return [...loads].sort(byStart).find((b) => compatible(b, L, cap, t) && b.booked.end <= newEnd);
}

// The smallest advance of a sync line's E after which some compatible load becomes joinable (b.end > E now).
export function joinAdvance(loads: readonly WorkLoad[], L: JoinLine, cap: number, E: number, t: number): number {
  let a = Number.POSITIVE_INFINITY;
  for (const b of loads) if (b.booked.end > E && compatible(b, L, cap, t)) a = Math.min(a, b.booked.end - E);
  return a;
}

// The earliest land of a compatible load (a lower bound for the hold-and-fire candidate T).
export function earliestJoinEnd(loads: readonly WorkLoad[], L: JoinLine, cap: number, t: number): number {
  let e = Number.POSITIVE_INFINITY;
  for (const b of loads) if (compatible(b, L, cap, t)) e = Math.min(e, b.booked.end);
  return e;
}

// A joiner with more prep moves the load's fire earlier (AD-5: fire_ms = booked.start − the largest member prep);
// storeLoads gives every member the load's fire.
export function withMember(b: WorkLoad, L: Pick<JoinLine, 'order_item_id' | 'units' | 'prep_ms'>): WorkLoad {
  return {
    ...b,
    members: [...b.members, L.order_item_id],
    units: b.units + L.units,
    max_prep: Math.max(b.max_prep, L.prep_ms),
    fire_ms: Math.min(b.fire_ms, b.booked.start - L.prep_ms),
  };
}

export function formed(L: JoinLine, fire: number, booked: Booking, inherit: string | null = null, capped = false): WorkLoad {
  return { load_id: null, inherit, program_id: L.program!, cook_ms: L.cook_ms, members: [L.order_item_id], units: L.units, max_prep: L.prep_ms, fire_ms: fire, booked, capped };
}

// Replaces `from` by `to` in a list (copy).
export function replaced(list: readonly WorkLoad[], from: WorkLoad, to: WorkLoad): WorkLoad[] {
  return list.map((x) => (x === from ? to : x));
}

// The slot end of a placed batch line (its deadline is fire-at-latest: d = E − cook − prep, AD-12).
export function slotEnd(line: Pick<EngineLine, 'deadline_ms' | 'prep_ms' | 'cook_ms' | 'units'>, cap: number): number {
  return line.deadline_ms + line.prep_ms + occupancy(line.units, cap, line.cook_ms).cook_ms;
}

// §3.3 deterministic names: a load formed without a name takes the name of the stored load it was re-formed from
// (`inherit`) when no other load takes it, else station_id + ':' + its earliest member (then the next member, a
// fallback that never repeats a name). Stored loads keep their names.
export function nameLoads(station_id: string, loads: readonly WorkLoad[]): WorkLoad[] {
  const taken = new Set(loads.flatMap((l) => (l.load_id === null ? [] : [l.load_id])));
  return loads.map((l) => {
    if (l.load_id !== null) return l;
    const tries = [...(l.inherit === null ? [] : [l.inherit]), ...[...l.members].sort().map((m) => `${station_id}:${m}`)];
    let name = tries.find((n) => !taken.has(n));
    for (let k = 1; name === undefined; k++) if (!taken.has(`${tries[tries.length - 1]}:${k}`)) name = `${tries[tries.length - 1]}:${k}`;
    taken.add(name);
    return { ...l, load_id: name };
  });
}
