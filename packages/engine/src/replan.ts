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
  // Hidden lines kept where they are (fixed input), e.g. the group a void / remove re-loops (§3.5.3, AD-11).
  held?: ReadonlySet<string>;
  // AD-6: true → an underflow of the working profile throws; false → it clamps (the stored-profile removal in
  // applyMoves is the one that reports a diagnostic).
  strict: boolean;
};

export type Pass1Result = {
  // Per station: the live profile at t after pass 1 (fixed + pruned + re-placed hidden lines), for pass 2.
  profiles: Record<string, Profile>;
  // Hidden lines whose placement changed (fire or booking), to be stored by applyMoves.
  moves: Map<string, Placement>;
};

// ---- profile sweeps (review fix 3: no hidden-lines × profile-size cost) ------------------------------------------

// The profile of a set of bookings, built in one sort + sweep (canonical, profile.ts).
export function profileOf(bookings: readonly Booking[]): Profile {
  if (bookings.length === 0) return { t: [], u: [] };
  const delta = new Map<number, number>();
  for (const b of bookings) {
    if (b.end <= b.start || b.units === 0) continue;
    delta.set(b.start, (delta.get(b.start) ?? 0) + b.units);
    delta.set(b.end, (delta.get(b.end) ?? 0) - b.units);
  }
  const keys = [...delta.keys()].sort((a, b) => a - b);
  const t: number[] = [];
  const u: number[] = [];
  let cur = 0;
  let prev = 0;
  for (const k of keys) {
    cur += delta.get(k)!;
    if (cur === prev) continue;
    t.push(k);
    u.push(cur);
    prev = cur;
  }
  return { t, u };
}

// a + sign × b in one linear sweep (canonical). A value below 0 throws (strict, AD-6) or, with onUnderflow,
// clamps at 0 and is reported once ({ first instant, largest deficit }, as removeInterval).
export function combine(a: Profile, b: Profile, sign: 1 | -1, onUnderflow?: (u: Underflow) => void): Profile {
  if (b.t.length === 0) return a;
  const t: number[] = [];
  const u: number[] = [];
  let i = 0;
  let j = 0;
  let ua = 0;
  let ub = 0;
  let prev = 0;
  let underflow: Underflow | null = null;
  while (i < a.t.length || j < b.t.length) {
    const x = Math.min(i < a.t.length ? a.t[i]! : Infinity, j < b.t.length ? b.t[j]! : Infinity);
    if (i < a.t.length && a.t[i] === x) ua = a.u[i++]!;
    if (j < b.t.length && b.t[j] === x) ub = b.u[j++]!;
    let v = ua + sign * ub;
    if (v < 0) {
      if (onUnderflow === undefined) throw new RangeError(`profile: units in use below zero at ${x} (removed more than was booked)`);
      if (underflow === null) underflow = { at: x, deficit: -v };
      else if (-v > underflow.deficit) underflow = { at: underflow.at, deficit: -v };
      v = 0;
    }
    if (v !== prev) {
      t.push(x);
      u.push(v);
      prev = v;
    }
  }
  if (underflow !== null) onUnderflow!(underflow);
  return { t, u };
}

// A local, mutable working profile for pass 1 (never escapes: `snapshot` returns a fresh canonical copy). add()
// inserts at most two boundaries and bumps the segments between them in place; equal neighbours are left
// unmerged until snapshot, which latestFit / earliestFit read correctly (sorted boundaries, last u = 0).
class Work implements Profile {
  readonly t: number[];
  readonly u: number[];
  constructor(p: Profile) {
    this.t = [...p.t];
    this.u = [...p.u];
  }
  private boundary(x: number): number {
    let lo = 0;
    let hi = this.t.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.t[mid]! < x) lo = mid + 1;
      else hi = mid;
    }
    if (this.t[lo] !== x) {
      this.t.splice(lo, 0, x);
      this.u.splice(lo, 0, lo > 0 ? this.u[lo - 1]! : 0);
    }
    return lo;
  }
  add(b: Booking): void {
    if (b.end <= b.start || b.units === 0) return;
    const i = this.boundary(b.start);
    const j = this.boundary(b.end);
    for (let k = i; k < j; k++) this.u[k]! += b.units;
  }
  snapshot(): Profile {
    const t: number[] = [];
    const u: number[] = [];
    let prev = 0;
    for (let k = 0; k < this.t.length; k++) {
      if (this.u[k] === prev) continue;
      t.push(this.t[k]!);
      u.push(this.u[k]!);
      prev = this.u[k]!;
    }
    return { t, u };
  }
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

// F §4.7 D36 queue order of same-station sync siblings: longest occupancy cook first, ties by order_item_id
// (plan.ts holdAndFire uses the same order); the line that lands at T is the last one.
export function queueOrder<L extends Pick<NewLine, 'order_item_id' | 'units' | 'cook_ms'>>(lines: readonly L[], cap: number): L[] {
  const dur = (l: L): number => occupancy(l.units, cap, l.cook_ms).cook_ms;
  return [...lines].sort((x, y) => dur(y) - dur(x) || (x.order_item_id < y.order_item_id ? -1 : 1));
}

// §3.5.3 pivot on station S: min over the new lines that may use S (its station or an allowed alternate) of
// earliestFit(lo_L) against the fixed profile; −∞ (nothing pruned) when no new line may use S.
// AD-12: d_min is the line's queued deadline lower bound. In a D36 queue a line's slot ends where the later
// (shorter) siblings start, so slot end ≥ T_min − (max carry of the group's sync lines on S) − (the occupancy
// cooks of the siblings queued after it); d_min = that − cook(occupancy) − prep. Every placement of the line has
// fire ≥ d_min ≥ lo_L and fits the fixed profile, so earliestFit(lo_L) ≤ its fire: a strict lower bound.
function pivotOn(fixed: Profile, station: StationRuntime, newLines: readonly NewLine[], t: number, T_min: number): number {
  let pivot = Number.POSITIVE_INFINITY;
  let any = false;
  const cap0 = newLines.length > 0 ? capacityFor(station, newLines[0]!.order_item_id) : 1;
  const home = queueOrder(
    newLines.filter((L) => L.serve_mode === 'sync' && L.station_id === station.station_id),
    cap0,
  );
  const maxCarry = Math.max(0, ...home.map((L) => L.carry_ms));
  const after = new Map<string, number>(); // occupancy cooks queued after each home sibling
  let acc = 0;
  for (let k = home.length - 1; k >= 0; k--) {
    after.set(home[k]!.order_item_id, acc);
    acc += occupancy(home[k]!.units, cap0, home[k]!.cook_ms).cook_ms;
  }
  for (const L of newLines) {
    const isHome = L.station_id === station.station_id;
    const carry = isHome ? L.carry_ms : L.alternates.find((a) => a.station_id === station.station_id)?.carry_ms;
    if (carry === undefined) continue;
    const cap = capacityFor(station, L.order_item_id);
    let lo = t;
    if (L.serve_mode === 'sync') {
      const slotEnd = isHome ? T_min - maxCarry - after.get(L.order_item_id)! : T_min - carry;
      const d_min = slotEnd - occupancy(L.units, cap, L.cook_ms).cook_ms - L.prep_ms;
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

// §3.5.6 seam — STUB until task 10 (weighted-lateness overload search): each late line, in the given (pass-1)
// order, at its earliest fit from its early bound max(t, d − max_early_ms) against the profile after the lines
// placed before it. Never a refusal (D3). Pure: returns the new profile and the placements in order.
export function placeLateSet(
  work: Profile,
  late: ReadonlyArray<Pick<EngineLine, 'order_item_id' | 'deadline_ms' | 'max_early_ms' | 'units' | 'prep_ms' | 'cook_ms'>>,
  cap: number,
  t: number,
): { profile: Profile; placements: Array<[string, Placement]> } {
  const w = new Work(work);
  const placements: Array<[string, Placement]> = [];
  for (const L of late) {
    const lo = Math.max(t, L.deadline_ms - L.max_early_ms);
    const fire = earliestFit(w, lo, L.prep_ms, L.cook_ms, L.units, cap);
    const booked = bookingAt(L, cap, fire);
    w.add(booked);
    placements.push([L.order_item_id, { fire, booked }]);
  }
  return { profile: w.snapshot(), placements };
}

const sameBooking = (a: Booking | null, b: Booking): boolean => a !== null && a.start === b.start && a.end === b.end && a.units === b.units;

// Pass 1 of §3.5.3 on each of `station_ids` at t. `newLines` are the batch's new lines (empty for a void /
// remove re-plan: no pivot, nothing pruned). Returns a profile for every listed station the state has.
// Cost per station: one live read, one sweep for the hidden profile and one for the fixed profile, then one
// fit + one in-place insert per free line on the local working profile.
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
    if (hidden.length === 0) {
      profiles[id] = live[id]!;
      continue;
    }
    const fixed = combine(live[id]!, profileOf(hidden.map((h) => h.booked!)), -1, o.strict ? undefined : () => undefined);
    const pivot = o.prune && newLines.length > 0 ? pivotOn(fixed, station, newLines, t, T_min) : Number.NEGATIVE_INFINITY;
    const pruned: Booking[] = [];
    const free: EngineLine[] = [];
    for (const h of hidden) {
      if (h.booked!.end <= pivot) pruned.push(h.booked!);
      else free.push(h);
    }
    const work = new Work(combine(fixed, profileOf(pruned), 1));
    const cap = capacityFor(station, hidden[0]!.order_item_id);
    const late: EngineLine[] = [];
    const placed: Array<[string, Placement]> = [];
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
      work.add(booked);
      placed.push([L.order_item_id, { fire, booked }]);
    }
    let out = work.snapshot();
    if (late.length > 0) {
      const r = placeLateSet(out, late, cap, t);
      out = r.profile;
      placed.push(...r.placements);
    }
    for (const [x, pl] of placed) {
      const line = state.lines[x]!;
      if (pl.fire !== line.fire_ms || !sameBooking(line.booked, pl.booked)) moves.set(x, pl);
    }
    profiles[id] = out;
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

// Per-line removal (remove exactly booked, then add the new one) with an AD-6 diagnostic per underflowing line:
// the slow path, used only when the batched sweep found an underflow.
function movesOneByOne(profile: Profile, list: ReadonlyArray<[EngineLine, Placement]>, event_id: string, station_id: string, strict: boolean, diagnostics: Diagnostic[]): Profile {
  let p = profile;
  for (const [line, pl] of list) {
    if (line.booked !== null) {
      let underflow: Underflow | null = null;
      p = strict
        ? removeInterval(p, line.booked, line.booked.units)
        : removeInterval(p, line.booked, line.booked.units, (u) => {
            underflow = u;
          });
      if (underflow !== null) {
        const { at, deficit } = underflow as Underflow;
        diagnostics.push({ kind: 'profile_underflow', event_id, station_id, detail: { order_item_id: line.order_item_id, at, deficit } });
      }
    }
    p = addInterval(p, pl.booked, pl.booked.units);
  }
  return p;
}

// Stores re-placements of unfired lines (AD-7: removes exactly the old `booked`, books the new one, sets
// fire_ms) and re-sorts `unfired` on the touched stations. Per station one sweep removes all old bookings and
// one adds the new ones. AD-6: if that finds an underflow, the per-line path runs instead: strict → it throws;
// non-strict → it clamps and appends a 'profile_underflow' diagnostic naming the line. Copy-on-write.
export function applyMoves(state: EngineState, moves: ReadonlyMap<string, Placement>, event_id: string, strict: boolean): EngineState {
  if (moves.size === 0) return state;
  const stations: Record<string, StationRuntime> = { ...state.stations };
  const lines: Record<string, EngineLine> = { ...state.lines };
  const diagnostics: Diagnostic[] = [];
  const byStation = new Map<string, Array<[EngineLine, Placement]>>();
  for (const [id, pl] of moves) {
    const line = lines[id]!;
    const list = byStation.get(line.station_id);
    if (list === undefined) byStation.set(line.station_id, [[line, pl]]);
    else list.push([line, pl]);
    lines[id] = { ...line, fire_ms: pl.fire, booked: pl.booked };
  }
  for (const [sid, list] of byStation) {
    const station = stations[sid]!;
    let underflowed = false;
    const removed = combine(
      station.profile,
      profileOf(list.flatMap(([l]) => (l.booked === null ? [] : [l.booked]))),
      -1,
      () => {
        underflowed = true;
      },
    );
    const profile = underflowed
      ? movesOneByOne(station.profile, list, event_id, sid, strict, diagnostics)
      : combine(removed, profileOf(list.map(([, pl]) => pl.booked)), 1);
    stations[sid] = { ...station, profile, unfired: sortUnfired(station.unfired, lines) };
  }
  return {
    ...state,
    stations,
    lines,
    diagnostics: diagnostics.length === 0 ? state.diagnostics : [...state.diagnostics, ...diagnostics],
  };
}
