// 03a §3.5.3 re-plan, pass 1 (D13, D15, D24, D25), with §3.4 hidden / frozen evaluated at t (the triggering
// event's recorded_at, or the handler's now in planOrder / calculateETA). Pure: no clock, no ids; writes no
// event (D13). A re-plan of station S at t:
//   fixed    = lines on S that are fired, COOKING (their live interval, §3.3), frozen (fire ≤ t + freeze_ms) or
//              done (occupies nothing), and every booking on S that is not a hidden line;
//   pivot    = (submit only) min over the new lines L that may use S of earliestPossible(L): earliestFit(lo_L)
//              against the fixed profile; lo_L = t for an immediate line, max(t, d_min(L) − max_early_ms(L))
//              for a sync line, d_min(L) = T_min − carry − cook − prep, T_min = t + max over the order's sync
//              lines of (prep + cook + carry); fire times throughout (v0.6, G4-2 #8);
//   fixed   += hidden lines on S whose booked interval ends ≤ pivot (D25 prune);
//   pass 1   : the other hidden lines in (d − keep, −w × (t − placed_at), order_item_id) order, each at
//              latestFit(lo = max(t, d − max_early_ms), hi = d − keep), else latestFit(lo, d), else the late set.
// The new lines (pass 2, §3.5.1 steps 3–4) are placed by plan.ts against the profiles this returns.
// Frozen, fired, COOKING and done lines never move here (the boost / capacity-change D15 exceptions are task 16).
import { InvalidEvent } from './invalid-event.js';
import { effectiveCapacity, liveProfiles } from './live.js';
import { addInterval, earliestFit, latestFit, occupancy, removeInterval, type Underflow } from './profile.js';
import type { Diagnostic, EngineLine, EngineState, Profile, StationRuntime } from './state.js';

export type Booking = { start: number; end: number; units: number };
export type Placement = { fire: number; booked: Booking };

// A new line of the batch being planned, as the pivot reads it (an EngineLine or a line of a ProposedOrder).
export type NewLine = Pick<EngineLine, 'order_item_id' | 'station_id' | 'serve_mode' | 'units' | 'prep_ms' | 'cook_ms' | 'carry_ms' | 'max_early_ms'> & {
  alternates: ReadonlyArray<{ station_id: string; carry_ms: number }>;
};

// §3.4: an unfired, placed line is hidden when fire_ms > t + freeze_ms; otherwise frozen.
export function isUnfiredPlaced(line: EngineLine): boolean {
  return line.stage === 'added' && line.fired_at === null && line.fire_ms !== null && line.booked !== null;
}
export function isHidden(state: EngineState, line: EngineLine, t: number): boolean {
  return isUnfiredPlaced(line) && line.fire_ms! > t + stationPolicy(state, line.station_id).freeze_ms;
}

// The station's planning knobs from state.config (§3.11). A station the config no longer lists keeps the 01a
// v2.1 §5.2a defaults (Waada Guard, freeze 120 000, keep 60 000).
export function stationPolicy(state: EngineState, station_id: string): { policy: 'waada_guard' | 'edf' | 'fifo'; freeze_ms: number; keep_ms: number } {
  const cfg = state.config?.stations.find((s) => s.station_id === station_id);
  if (cfg === undefined) return { policy: 'waada_guard', freeze_ms: 120_000, keep_ms: 60_000 };
  // §3.5.3: keep = min_slack_keep_ms (Waada Guard); 0 on EDF (D3).
  return { policy: cfg.policy, freeze_ms: cfg.freeze_ms, keep_ms: cfg.policy === 'waada_guard' ? cfg.min_slack_keep_ms : 0 };
}

// §3.5.2: w(L) = weight_pct × (follow_up ∨ mark ∈ {expedite, return} ? weight_follow_up_pct : weight_<type>_pct) / 100;
// 100 for every line on an EDF station (D3). Branch weights read from state.config at each re-plan.
export function weightOf(state: EngineState, line: EngineLine): number {
  if (stationPolicy(state, line.station_id).policy === 'edf') return 100;
  const order = state.orders[line.order_id];
  const settings = state.config?.settings;
  if (order === undefined || settings === undefined) return line.weight_pct;
  const branch =
    order.follow_up || line.mark === 'expedite' || line.mark === 'return'
      ? settings.weight_follow_up_pct
      : settings[`weight_${order.order_type}_pct`];
  return (line.weight_pct * branch) / 100;
}

// The station's effective capacity for a placement; < 1 is invalid data (task 7 review ruling): an InvalidEvent,
// so a non-strict fold records an invalid_event diagnostic instead of stopping replay.
export function capacityFor(station: StationRuntime, order_item_id: string): number {
  const cap = effectiveCapacity(station);
  if (!(cap >= 1)) throw new InvalidEvent('capacity_invalid', order_item_id, station.station_id);
  return cap;
}

// AD-4: the booking of a line fired at `fire` (prep off-station, D35).
export function bookingAt(line: Pick<EngineLine, 'units' | 'prep_ms' | 'cook_ms'>, cap: number, fire: number): Booking {
  const occ = occupancy(line.units, cap, line.cook_ms);
  return { start: fire + line.prep_ms, end: fire + line.prep_ms + occ.cook_ms, units: occ.units };
}

export type Pass1Options = {
  // D25 prune (default true). false = the unpruned re-plan test 23 and the simulator compare against.
  prune: boolean;
  // Hidden lines kept where they are (fixed input), e.g. the group a void / remove re-loops (§3.5.3 triggers).
  held?: ReadonlySet<string>;
  // AD-6: true → an underflow of the working profile throws; false → it clamps (the stored-profile removal in
  // applyMoves is the one that reports a diagnostic).
  strict: boolean;
};

export type Pass1Result = {
  // Per station: the live profile at t after pass 1 (fixed + pruned + re-placed hidden lines), for pass 2.
  profiles: Record<string, Profile>;
  // Hidden lines whose placement changed (fire and booking), to be stored by applyMoves.
  moves: Map<string, Placement>;
};

function removeWorking(p: Profile, b: Booking, strict: boolean): Profile {
  return strict ? removeInterval(p, b, b.units) : removeInterval(p, b, b.units, () => undefined);
}

// The order of pass 1 (§3.5.3): (d − keep, −w × (t − placed_at), order_item_id).
function pass1Order(state: EngineState, lines: readonly EngineLine[], keep: number, t: number): EngineLine[] {
  const key = new Map(
    lines.map((l) => [l.order_item_id, { d: l.deadline_ms - keep, w: -weightOf(state, l) * (t - (state.orders[l.order_id]?.placed_at ?? t)) }]),
  );
  return [...lines].sort((a, b) => {
    const ka = key.get(a.order_item_id)!;
    const kb = key.get(b.order_item_id)!;
    return ka.d - kb.d || ka.w - kb.w || (a.order_item_id < b.order_item_id ? -1 : a.order_item_id > b.order_item_id ? 1 : 0);
  });
}

// §3.5.3 pivot on station S: min over the new lines that may use S (its station or an allowed alternate) of
// earliestFit(lo_L) against the fixed profile. +∞ never prunes more than "every line", −∞ prunes nothing.
function pivotOn(fixed: Profile, station: StationRuntime, newLines: readonly NewLine[], t: number, T_min: number): number {
  let pivot = Number.POSITIVE_INFINITY;
  let any = false;
  for (const L of newLines) {
    const carry = L.station_id === station.station_id ? L.carry_ms : L.alternates.find((a) => a.station_id === station.station_id)?.carry_ms;
    if (carry === undefined) continue;
    const cap = capacityFor(station, L.order_item_id);
    let lo = t;
    if (L.serve_mode === 'sync') {
      const d_min = T_min - carry - occupancy(L.units, cap, L.cook_ms).cook_ms - L.prep_ms;
      lo = Math.max(t, d_min - L.max_early_ms);
    }
    pivot = Math.min(pivot, earliestFit(fixed, lo, L.prep_ms, L.cook_ms, L.units, cap));
    any = true;
  }
  return any ? pivot : Number.NEGATIVE_INFINITY;
}

// T_min = t + max over the order's sync lines of (prep + cook + carry) at their own station (§3.5.3).
function tMin(state: EngineState, newLines: readonly NewLine[], t: number): number {
  let m = 0;
  for (const L of newLines) {
    if (L.serve_mode !== 'sync') continue;
    const station = state.stations[L.station_id];
    if (station === undefined) continue;
    const cap = capacityFor(station, L.order_item_id);
    m = Math.max(m, L.prep_ms + occupancy(L.units, cap, L.cook_ms).cook_ms + L.carry_ms);
  }
  return t + m;
}

// §3.5.6 seam — STUB until task 10 (weighted-lateness overload search): each late line, in pass-1 order, at its
// earliest fit from its early bound against the profile after the others. Never a refusal (D3).
function placeLateSet(work: Profile, late: readonly EngineLine[], cap: number, t: number, moves: Map<string, Placement>): Profile {
  let p = work;
  for (const L of late) {
    const lo = Math.max(t, L.deadline_ms - L.max_early_ms);
    const fire = earliestFit(p, lo, L.prep_ms, L.cook_ms, L.units, cap);
    const booked = bookingAt(L, cap, fire);
    p = addInterval(p, booked, booked.units);
    moves.set(L.order_item_id, { fire, booked });
  }
  return p;
}

// Pass 1 of §3.5.3 on each of `station_ids` at t. `newLines` are the batch's new lines (empty for a void /
// remove re-plan: no pivot, nothing pruned). Returns a profile for every listed station the state has.
export function pass1(state: EngineState, station_ids: Iterable<string>, newLines: readonly NewLine[], t: number, o: Pass1Options): Pass1Result {
  const ids = [...new Set(station_ids)].filter((id) => state.stations[id] !== undefined).sort();
  const live = liveProfiles(state, ids, t);
  const profiles: Record<string, Profile> = {};
  const moves = new Map<string, Placement>();
  const T_min = tMin(state, newLines, t);
  for (const id of ids) {
    const station = state.stations[id]!;
    const pol = stationPolicy(state, id);
    // FIFO (D3): no re-plan of older lines.
    if (pol.policy === 'fifo') {
      profiles[id] = live[id]!;
      continue;
    }
    const hidden = station.unfired
      .map((x) => state.lines[x])
      .filter((l): l is EngineLine => l !== undefined && isHidden(state, l, t) && o.held?.has(l.order_item_id) !== true);
    let fixed = live[id]!;
    for (const h of hidden) fixed = removeWorking(fixed, h.booked!, o.strict);
    const pivot = o.prune && newLines.length > 0 ? pivotOn(fixed, station, newLines, t, T_min) : Number.NEGATIVE_INFINITY;
    let work = fixed;
    const free: EngineLine[] = [];
    for (const h of hidden) {
      if (h.booked!.end <= pivot) work = addInterval(work, h.booked!, h.booked!.units);
      else free.push(h);
    }
    const late: EngineLine[] = [];
    const placedMoves = new Map<string, Placement>();
    if (free.length > 0) {
      const cap = capacityFor(station, free[0]!.order_item_id);
      for (const L of pass1Order(state, free, pol.keep_ms, t)) {
        const lo = Math.max(t, L.deadline_ms - L.max_early_ms);
        const fire =
          latestFit(work, lo, L.deadline_ms - pol.keep_ms, L.prep_ms, L.cook_ms, L.units, cap) ??
          latestFit(work, lo, L.deadline_ms, L.prep_ms, L.cook_ms, L.units, cap);
        if (fire === null) {
          late.push(L);
          continue;
        }
        const booked = bookingAt(L, cap, fire);
        work = addInterval(work, booked, booked.units);
        placedMoves.set(L.order_item_id, { fire, booked });
      }
      work = placeLateSet(work, late, cap, t, placedMoves);
    }
    for (const [x, pl] of placedMoves) if (pl.fire !== state.lines[x]!.fire_ms) moves.set(x, pl);
    profiles[id] = work;
  }
  return { profiles, moves };
}

// §3.3 unfired order: (fire, order_item_id).
export function sortUnfired(ids: readonly string[], lines: Readonly<Record<string, EngineLine>>): string[] {
  return [...ids].sort((a, b) => {
    const fa = lines[a]!.fire_ms ?? Number.POSITIVE_INFINITY;
    const fb = lines[b]!.fire_ms ?? Number.POSITIVE_INFINITY;
    return fa - fb || (a < b ? -1 : a > b ? 1 : 0);
  });
}

// Stores re-placements of unfired lines (AD-7: removes exactly the old `booked`, books the new one, sets
// fire_ms) and re-sorts `unfired` on the touched stations. AD-6: strict → an underflow throws; non-strict → it
// clamps and a 'profile_underflow' diagnostic is appended. Copy-on-write: only touched stations / lines.
export function applyMoves(state: EngineState, moves: ReadonlyMap<string, Placement>, event_id: string, strict: boolean): EngineState {
  if (moves.size === 0) return state;
  const stations: Record<string, StationRuntime> = { ...state.stations };
  const lines: Record<string, EngineLine> = { ...state.lines };
  const diagnostics: Diagnostic[] = [];
  const touched = new Set<string>();
  for (const [id, pl] of moves) {
    const line = lines[id]!;
    const station = stations[line.station_id]!;
    let profile = station.profile;
    if (line.booked !== null) {
      let underflow: Underflow | null = null;
      profile = strict
        ? removeInterval(profile, line.booked, line.booked.units)
        : removeInterval(profile, line.booked, line.booked.units, (u) => {
            underflow = u;
          });
      if (underflow !== null) {
        const { at, deficit } = underflow as Underflow;
        diagnostics.push({ kind: 'profile_underflow', event_id, station_id: station.station_id, detail: { order_item_id: id, at, deficit } });
      }
    }
    profile = addInterval(profile, pl.booked, pl.booked.units);
    stations[line.station_id] = { ...station, profile };
    lines[id] = { ...line, fire_ms: pl.fire, booked: pl.booked };
    touched.add(line.station_id);
  }
  for (const sid of touched) stations[sid] = { ...stations[sid]!, unfired: sortUnfired(stations[sid]!.unfired, lines) };
  return {
    ...state,
    stations,
    lines,
    diagnostics: diagnostics.length === 0 ? state.diagnostics : [...state.diagnostics, ...diagnostics],
  };
}
