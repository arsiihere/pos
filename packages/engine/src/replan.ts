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
//              latestFit(lo = max(t, d − max_early_ms), hi = d − keep), else latestFit(lo, d), else the late set,
//              which sends every free hidden line of the station to the §3.5.6 overload search (overload.ts, AD-15).
//              §3.5.5 D10 (task 11): a hidden line that fits neither way on its station is first tried on its other
//              allowed stations (route.ts, preference order; never onto a FIFO or paused station), each at
//              latestFit(lo, d' − keep') else latestFit(lo, d'), d' = its deadline shifted to that station (same
//              land at the point). Only when none fits does it join the late set. proposed (implementer,
//              overnight) R3: a line that fits on its own station stays there (no churn back to home).
// The new lines (pass 2, §3.5.1 steps 3–4) are placed by plan.ts against the profiles this returns.
// Frozen, fired, COOKING and done lines never move here (the boost / capacity-change D15 exceptions are task 16).
import { InvalidEvent } from './invalid-event.js';
import { effectiveCapacity } from './capacity.js';
import { liveProfile, liveProfiles } from './live.js';
import { bookingAt, overloadPlace, Work, type Booking, type OverloadLine, type Placement } from './overload.js';
import { addInterval, earliestFit, latestFit, occupancy, removeInterval, type Underflow } from './profile.js';
import { allFifo, homeOf, optionOn, rerouted, routeCtx, routeOptions, type Alternate, type RouteCtx, type RouteOption } from './route.js';
import { asLoad, formed, freshnessOf, joinLine, replaced, slotEnd, syncJoin, withMember, workOf, type WorkLoad } from './batch.js';
import type { Diagnostic, EngineLine, EngineState, Profile, StationRuntime } from './state.js';

export { bookingAt, type Booking, type Placement } from './overload.js';

// A new line of the batch being planned, as the pivot and routing read it (an EngineLine or a line of a
// ProposedOrder).
export type NewLine = Pick<
  EngineLine,
  'order_item_id' | 'station_id' | 'serve_mode' | 'units' | 'prep_ms' | 'cook_ms' | 'carry_ms' | 'max_early_ms' | 'max_carry_ms' | 'routed_station_id'
> & {
  alternates: ReadonlyArray<Alternate>;
};

// §3.5.5 (task 11): a re-placement that also changes the line's station: the route fields after the move and the
// deadline on the new station (AD-12 slot shifted so the line lands at the point when it did).
export type Reroute = Pick<EngineLine, 'station_id' | 'carry_ms' | 'alternates' | 'deadline_ms'>;
export type Move = Placement & { to?: Reroute };

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

// §3.5.3 / AD-14: a FIFO station places each new line at its earliest fit, never holds and never re-plans.
export function isFifo(state: EngineState, station_id: string): boolean {
  return stationPolicy(state, station_id).policy === 'fifo';
}

// §3.5.2: w(L) = weight_pct × (follow_up ∨ mark ∈ {expedite, return} ? weight_follow_up_pct : weight_<type>_pct) / 100;
// 100 for every line on an EDF station (D3). Branch weights read from state.config at each re-plan; weight_pct is
// the line's D25 copy. A return line (return_of set, §3.8a) takes the follow-up weight from its link, so a later
// mark change (boost, moved) never drops it (task 9).
export function weightOf(state: EngineState, line: EngineLine): number {
  if (stationPolicy(state, line.station_id).policy === 'edf') return 100;
  const order = state.orders[line.order_id];
  const settings = state.config?.settings;
  if (order === undefined || settings === undefined) return line.weight_pct;
  const branch =
    order.follow_up || line.mark === 'expedite' || line.mark === 'return' || line.return_of !== null
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
  // Hidden lines whose placement changed (fire, booking, station or the §3.5.6 capped flag), stored by applyMoves.
  moves: Map<string, Move>;
  // §3.5.6: the Λ probes run per station where a late set went to the overload search (for the simulator, task 18).
  probes: Record<string, number>;
  // Task 13: per batch station of the pass, its unfired loads after pass 1 (frozen and pruned loads as stored, the
  // hidden ones re-formed); stored by storeLoads (plan.ts), and the loads new lines may join in pass 2.
  loads: Record<string, WorkLoad[]>;
  // Task 11 re-review: hidden lines pass 1 placed on their own station at full capacity because the reserve shut
  // them out of every allowed station (route.ts fallback 'reserve'); the folding caller appends a reserve_fallback.
  fallbacks: Array<{ order_item_id: string; station_id: string; capacity: number; reserve_units: number }>;
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

// The processing order of a sync group's held lines in the hold-and-fire trial (plan.ts trySyncAt), shared with
// the pivot so its queue bound reads the same order: the lines grouped by their home station (ascending id), each
// group in reverse D36 queue order (shortest occupancy cook at the home station's capacity first, ties by
// order_item_id descending), i.e. the line that lands at T first. With no alternates the home is the line's
// station and this is task 7's per-station order exactly. proposed (implementer, overnight) R9: lines of different
// home stations that share a station chain in this order (home id first), not strictly longest-first (D36). A line placed later in this order on a station ends
// where the ones placed before it there start (D36 chain), or at T − carry.
export function syncOrder<L extends NewLine>(state: EngineState, lines: readonly L[]): L[] {
  const byHome = new Map<string, L[]>();
  for (const l of lines) {
    const h = homeOf(l);
    const list = byHome.get(h);
    if (list === undefined) byHome.set(h, [l]);
    else list.push(l);
  }
  const out: L[] = [];
  for (const h of [...byHome.keys()].sort()) {
    const st = state.stations[h];
    const q = queueOrder(byHome.get(h)!, st === undefined ? 1 : Math.max(1, effectiveCapacity(st)));
    for (let k = q.length - 1; k >= 0; k--) out.push(q[k]!);
  }
  return out;
}

// §3.5.3 / AD-14: a new sync line is a FIFO line (placed at its earliest fit in listing order, no hold) when every
// allowed station is FIFO. A sync line that may also use a held (Waada Guard / EDF) station is routed in the loop,
// where a FIFO station it is placed on still takes it at its earliest fit (plan.ts trySyncAt).
export function isFifoLine(ctx: RouteCtx, line: Pick<NewLine, 'serve_mode'>, options: readonly RouteOption[]): boolean {
  return line.serve_mode === 'sync' && allFifo(ctx, options);
}

// §3.5.3 pivot on station S: min over the new lines that may use S (route.ts: their allowed stations) of
// earliestFit(lo_L) against the fixed profile; −∞ (nothing pruned) when no new line may use S.
// AD-12 queued bound, for every line that may use S, home or alternate (task 11; task 8 used the unqueued
// T_min − carry for an alternate): in the hold-and-fire trial a held line placed on S ends at T − carry or where
// the lines placed on S before it in syncOrder start, so its slot end ≥ T − (max carry on S of the held lines that
// may use S) − (the occupancy cooks on S of those that come before it in syncOrder). T ≥ T_min, so slot end ≥
// that bound with T_min; d_min = bound − cook(occupancy at the line's capacity on S) − prep; lo_L = max(t,
// d_min − max_early_ms). An immediate or FIFO line is placed at its earliest fit from t: lo_L = t. Every placement
// of the line on S fires at ≥ lo_L and fits the fixed profile, so earliestFit(lo_L) ≤ its fire.
function pivotOn(
  fixed: Profile,
  station_id: string,
  held: readonly NewLine[],
  newLines: readonly NewLine[],
  opts: ReadonlyMap<string, RouteOption[]>,
  fifoLines: ReadonlySet<string>,
  t: number,
  T_min: number,
): number {
  let maxCarry = 0;
  const before = new Map<string, number>(); // occupancy cooks on S of the held lines before each one in syncOrder
  let acc = 0;
  for (const L of held) {
    const o = optionOn(opts.get(L.order_item_id)!, station_id);
    if (o === undefined) continue;
    maxCarry = Math.max(maxCarry, o.carry_ms);
    before.set(L.order_item_id, acc);
    acc += occupancy(L.units, o.cap, L.cook_ms).cook_ms;
  }
  let pivot = Number.POSITIVE_INFINITY;
  let any = false;
  for (const L of newLines) {
    const o = optionOn(opts.get(L.order_item_id)!, station_id);
    if (o === undefined) continue;
    let lo = t;
    if (L.serve_mode === 'sync' && !fifoLines.has(L.order_item_id)) {
      const slotEnd = T_min - maxCarry - before.get(L.order_item_id)!;
      const d_min = slotEnd - occupancy(L.units, o.cap, L.cook_ms).cook_ms - L.prep_ms;
      lo = Math.max(t, d_min - L.max_early_ms);
    }
    pivot = Math.min(pivot, earliestFit(fixed, lo, L.prep_ms, L.cook_ms, L.units, o.cap));
    any = true;
  }
  return any ? pivot : Number.NEGATIVE_INFINITY;
}

// T_min = t + max over the order's sync lines of the least (prep + cook + carry) over their allowed stations
// (§3.5.3; task 11: a line may land through an alternate, so its own station's value is not a lower bound).
function tMin(newLines: readonly NewLine[], opts: ReadonlyMap<string, RouteOption[]>, t: number): number {
  let m = 0;
  for (const L of newLines) {
    if (L.serve_mode !== 'sync') continue;
    let least = Number.POSITIVE_INFINITY;
    for (const o of opts.get(L.order_item_id)!) least = Math.min(least, L.prep_ms + occupancy(L.units, o.cap, L.cook_ms).cook_ms + o.carry_ms);
    if (least !== Number.POSITIVE_INFINITY) m = Math.max(m, least);
  }
  return t + m;
}

const NONE: ReadonlySet<string> = new Set();
const sameBooking = (a: Booking | null, b: Booking): boolean => a !== null && a.start === b.start && a.end === b.end && a.units === b.units;

// Pass 1 of §3.5.3 on each of `station_ids` at t. `newLines` are the batch's new lines (empty for a void /
// remove re-plan: no pivot, nothing pruned). Returns a profile for every listed station the state has (and for
// any other station a hidden line was re-routed onto).
// Cost per station: one live read, one sweep for the hidden profile and one for the fixed profile, then one
// fit + one in-place insert per free line on the local working profile; a line that fits neither way on its
// station costs one more fit pair per allowed station it tries (§3.5.5 D10).
// Re-routing (task 11): stations are taken in id order. A line re-routed onto a station of `station_ids` not taken
// yet is fixed input there (like a line of the batch already placed, §3.5.3 fixed); it is fitted against that
// station's live profile with its hidden lines where they are, so it takes only capacity they leave. Onto a
// station already taken (or not in the list) it is fitted against that station's result.
export function pass1(state: EngineState, station_ids: Iterable<string>, newLines: readonly NewLine[], t: number, o: Pass1Options): Pass1Result {
  const ctx = routeCtx(state);
  const ids = [...new Set(station_ids)].filter((id) => state.stations[id] !== undefined).sort();
  const idSet = new Set(ids);
  const live = liveProfiles(state, ids, t);
  const profiles: Record<string, Profile> = {};
  const moves = new Map<string, Move>();
  const probes: Record<string, number> = {};
  const loads: Record<string, WorkLoad[]> = {};
  const fallbacks: Pass1Result['fallbacks'] = [];
  const opts = new Map(newLines.map((L) => [L.order_item_id, routeOptions(ctx, L, false)]));
  const fifoLines = new Set(newLines.filter((L) => isFifoLine(ctx, L, opts.get(L.order_item_id)!)).map((L) => L.order_item_id));
  const held = syncOrder(state, newLines.filter((L) => L.serve_mode === 'sync' && !fifoLines.has(L.order_item_id)));
  const T_min = tMin(newLines, opts, t);

  // Working profiles of re-route targets (§3.5.5 D10).
  const processed = new Set<string>();
  const pending = new Map<string, Work>(); // a station of ids not taken yet: its live profile + incoming
  const settled = new Map<string, Work>(); // a station already taken, or outside ids
  const incoming = new Map<string, Booking[]>();
  const targetOf = (sid: string): Work => {
    const w = settled.get(sid) ?? pending.get(sid);
    if (w !== undefined) return w;
    if (idSet.has(sid) && !processed.has(sid)) {
      const p = new Work(live[sid]!);
      pending.set(sid, p);
      return p;
    }
    const n = new Work(profiles[sid] ?? liveProfile(state, sid, t));
    settled.set(sid, n);
    return n;
  };
  const landOn = (sid: string, b: Booking): void => {
    targetOf(sid).add(b);
    if (idSet.has(sid) && !processed.has(sid)) {
      const list = incoming.get(sid);
      if (list === undefined) incoming.set(sid, [b]);
      else list.push(b);
    }
  };
  // §3.5.5 D10: the first other allowed station (preference order) where the line fits by its deadline there.
  const reroute = (L: EngineLine, options: readonly RouteOption[], own: Pick<RouteOption, 'station_id' | 'carry_ms' | 'cap'>): [string, Move] | null => {
    for (const opt of options) {
      if (opt.station_id === own.station_id) continue;
      // Same land at the point: slot end moves by the carry difference; d' = slot end' − cook' − prep.
      const d =
        L.deadline_ms + occupancy(L.units, own.cap, L.cook_ms).cook_ms - occupancy(L.units, opt.cap, L.cook_ms).cook_ms + own.carry_ms - opt.carry_ms;
      const w = targetOf(opt.station_id);
      const lo = Math.max(t, d - L.max_early_ms);
      const keep = stationPolicy(state, opt.station_id).keep_ms;
      const fire = latestFit(w, lo, d - keep, L.prep_ms, L.cook_ms, L.units, opt.cap) ?? latestFit(w, lo, d, L.prep_ms, L.cook_ms, L.units, opt.cap);
      if (fire === null) continue;
      const booked = bookingAt(L, opt.cap, fire);
      landOn(opt.station_id, booked);
      return [L.order_item_id, { fire, booked, capped: false, to: { ...rerouted(L, opt), deadline_ms: d } }];
    }
    return null;
  };

  for (const id of ids) {
    const station = state.stations[id]!;
    const pol = stationPolicy(state, id);
    const inc = incoming.get(id);
    const liveHere = inc === undefined ? live[id]! : combine(live[id]!, profileOf(inc), 1);
    processed.add(id);
    pending.delete(id);
    // Task 13: a batch station re-forms its hidden loads (alternates are slot-only, P-3: no line is routed onto or
    // off it, and no re-routed line lands here).
    if (station.type === 'batch') {
      const r = batchPass1(state, station, liveHere, pol, newLines, held, opts, fifoLines, t, T_min, o);
      profiles[id] = r.profile;
      loads[id] = r.loads;
      if (r.probes !== null) probes[id] = r.probes;
      continue;
    }
    // FIFO (§3.5.3, D3): no re-plan of older lines; nothing on the station is hidden-and-movable.
    if (pol.policy === 'fifo') {
      profiles[id] = liveHere;
      continue;
    }
    const hidden = station.unfired
      .map((x) => state.lines[x])
      .filter((l): l is EngineLine => l !== undefined && isHidden(state, l, t) && o.held?.has(l.order_item_id) !== true);
    if (hidden.length === 0) {
      profiles[id] = liveHere;
      continue;
    }
    const fixed = combine(liveHere, profileOf(hidden.map((h) => h.booked!)), -1, o.strict ? undefined : () => undefined);
    const pivot = o.prune && newLines.length > 0 ? pivotOn(fixed, id, held, newLines, opts, fifoLines, t, T_min) : Number.NEGATIVE_INFINITY;
    const pruned: Booking[] = [];
    const free: EngineLine[] = [];
    for (const h of hidden) {
      if (h.booked!.end <= pivot) pruned.push(h.booked!);
      else free.push(h);
    }
    const base = combine(fixed, profileOf(pruned), 1);
    const work = new Work(base);
    capacityFor(station, hidden[0]!.order_item_id); // capacity < 1 → InvalidEvent (task 7 review ruling)
    const late: EngineLine[] = [];
    const placed: Array<[string, Placement]> = [];
    const away: Array<[string, Move]> = [];
    const caps = new Map<string, number>();
    for (const L of pass1Order(state, free, pol.keep_ms, t)) {
      const options = routeOptions(ctx, L, true);
      const own = optionOn(options, id);
      if (own === undefined) {
        // §3.5.5 reserve (task 11 review): the line is not home here and the reserve leaves it < 1 unit (the reserve
        // or an override changed since it was placed): it must leave. Its other allowed stations in preference
        // order by its deadline there; else — proposed (implementer, overnight) — the first allowed station at its
        // earliest fit (late; the tick slips it), never refused (D3).
        const from = { station_id: id, carry_ms: L.carry_ms, cap: effectiveCapacity(station) };
        const r = reroute(L, options, from);
        if (r !== null) {
          away.push(r);
          continue;
        }
        const opt = options[0]!;
        const d = L.deadline_ms + occupancy(L.units, from.cap, L.cook_ms).cook_ms - occupancy(L.units, opt.cap, L.cook_ms).cook_ms + from.carry_ms - opt.carry_ms;
        const fire = earliestFit(targetOf(opt.station_id), Math.max(t, d - L.max_early_ms), L.prep_ms, L.cook_ms, L.units, opt.cap);
        const booked = bookingAt(L, opt.cap, fire);
        landOn(opt.station_id, booked);
        away.push([L.order_item_id, { fire, booked, capped: false, to: { ...rerouted(L, opt), deadline_ms: d } }]);
        continue;
      }
      caps.set(L.order_item_id, own.cap);
      if (own.fallback === 'reserve') {
        fallbacks.push({ order_item_id: L.order_item_id, station_id: id, capacity: own.cap, reserve_units: ctx.reserve.get(id) ?? 0 });
      }
      const lo = Math.max(t, L.deadline_ms - L.max_early_ms);
      const fire =
        latestFit(work, lo, L.deadline_ms - pol.keep_ms, L.prep_ms, L.cook_ms, L.units, own.cap) ??
        latestFit(work, lo, L.deadline_ms, L.prep_ms, L.cook_ms, L.units, own.cap);
      if (fire === null) {
        const r = options.length > 1 ? reroute(L, options, own) : null;
        if (r !== null) away.push(r);
        else late.push(L);
        continue;
      }
      const booked = bookingAt(L, own.cap, fire);
      work.add(booked);
      placed.push([L.order_item_id, { fire, booked }]);
    }
    let out = work.snapshot();
    let capped: ReadonlySet<string> = NONE;
    if (late.length > 0) {
      // §3.5.6 / AD-15: a late set re-places all free hidden lines of the station (pass 1's set, not only the late
      // ones; minus those re-routed away above) against base (fixed + pruned; held lines are in fixed) by the
      // weighted-lateness Λ search. Each line at its own capacity on the station (§3.5.5 reserve).
      const gone = new Set(away.map(([x]) => x));
      const r = overloadPlace(
        base,
        free
          .filter((L) => !gone.has(L.order_item_id))
          .map((L) => {
            const w = weightOf(state, L);
            return { ...L, w, urgency: w * (t - (state.orders[L.order_id]?.placed_at ?? t)), cap: caps.get(L.order_item_id)! };
          }),
        capacityFor(station, hidden[0]!.order_item_id),
        t,
        Math.max(1, state.config?.settings.cascade_step_ms ?? 60_000),
      );
      out = r.profile;
      placed.length = 0;
      placed.push(...r.placements);
      capped = new Set(r.capped);
      probes[id] = r.probes;
    }
    // AD-15 Q4b: capped is recomputed at every re-placement of the line (false outside the overload search).
    for (const [x, pl] of placed) {
      const line = state.lines[x]!;
      const c = capped.has(x);
      if (pl.fire !== line.fire_ms || !sameBooking(line.booked, pl.booked) || c !== line.capped) moves.set(x, { ...pl, capped: c });
    }
    for (const [x, mv] of away) moves.set(x, mv);
    profiles[id] = out;
  }
  for (const [sid, w] of settled) profiles[sid] = w.snapshot();
  return { profiles, moves, probes, loads, fallbacks };
}

// Task 13: pass 1 of §3.5.3 on a batch station at t. The unit of placement is the load (F §4.7, batch.ts):
//   fixed  = the live profile minus the hidden loads (fire > t + freeze_ms); frozen loads stay where they are and
//            keep their members, and may still gain joiners (§3.7: "a frozen program-Q load never gains a
//            program-P line", so it may gain a program-Q one);
//   prune  = (submit) hidden loads whose booking ends ≤ the pivot, with each new line fitted as a whole-station
//            booking (D25; joins need no capacity, so a pruned load stays joinable);
//   pass 1 = the hidden loads are re-formed (§12.6 G4-1 #10: "a hidden load is re-formed by every re-plan"): their
//            members in pass-1 order, each line L with slot end E = d + prep + cook
//              1. joins the first load b (start order) of the station with b.end ≤ E − keep and (E − keep) − b.end
//                 ≤ min(freshness, max_early_ms) (the keep cushion applied to the target, so lines that shared a
//                 load re-form together — proposed (implementer, overnight) J4);
//              2. else forms a load at latestFit(lo = max(t, d − max_early_ms), hi = d − keep) (whole station);
//              3. else joins with b.end ≤ E and E − b.end ≤ the window (its own keep, still on time);
//              4. else forms a load at latestFit(lo, d);
//              5. else joins the late set.
//   late   = §3.5.6 on the batch station, proposed (implementer, overnight) J5: every free hidden line is re-placed
//            by the overload search as a load of its own (whole station), the loads formed above discarded; §3.5.6
//            defines no join rule, and a singleton load keeps the search's per-line deadlines exact.
// A re-formed load is named after the stored load the line that formed it came from (nameLoads), so a void of the
// naming line, whose fold re-plans the station, keeps the name (§3.3 v0.2.1).
function batchPass1(
  state: EngineState,
  station: StationRuntime,
  liveHere: Profile,
  pol: ReturnType<typeof stationPolicy>,
  newLines: readonly NewLine[],
  held: readonly NewLine[],
  opts: ReadonlyMap<string, RouteOption[]>,
  fifoLines: ReadonlySet<string>,
  t: number,
  T_min: number,
  o: Pass1Options,
): { profile: Profile; loads: WorkLoad[]; probes: number | null } {
  const id = station.station_id;
  const stored = Object.values(station.loads).map((l) => workOf(state, l));
  if (pol.policy === 'fifo') return { profile: liveHere, loads: stored, probes: null };
  const isHiddenLoad = (b: WorkLoad): boolean => b.fire_ms > t + pol.freeze_ms;
  const hidden = stored.filter(isHiddenLoad);
  if (hidden.length === 0) return { profile: liveHere, loads: stored, probes: null };
  const cap = capacityFor(station, hidden[0]!.members[0] ?? id);
  const fixed = combine(liveHere, profileOf(hidden.map((b) => b.booked)), -1, o.strict ? undefined : () => undefined);
  const whole = <L extends NewLine>(L: L): L => (optionOn(opts.get(L.order_item_id) ?? [], id) === undefined ? L : asLoad(L, cap));
  const pivot = o.prune && newLines.length > 0 ? pivotOn(fixed, id, held.map(whole), newLines.map(whole), opts, fifoLines, t, T_min) : Number.NEGATIVE_INFINITY;
  const pruned = hidden.filter((b) => b.booked.end <= pivot);
  const free = hidden.filter((b) => b.booked.end > pivot);
  const base = combine(fixed, profileOf(pruned.map((b) => b.booked)), 1);
  const keepLoads = [...stored.filter((b) => !isHiddenLoad(b)), ...pruned];
  const from = new Map<string, string>();
  const freeLines: EngineLine[] = [];
  for (const b of free) {
    for (const m of b.members) {
      const l = state.lines[m];
      if (l === undefined || l.stage !== 'added' || l.fired_at !== null) continue;
      freeLines.push(l);
      from.set(m, b.load_id!);
    }
  }
  const window = freshnessOf(state, id);
  const work = new Work(base);
  let cands: WorkLoad[] = [...keepLoads];
  const late: EngineLine[] = [];
  const join = (L: EngineLine, E: number): boolean => {
    const jl = joinLine(L);
    const b = syncJoin(cands, jl, cap, E, window, t);
    if (b === undefined) return false;
    cands = replaced(cands, b, withMember(b, jl));
    return true;
  };
  for (const L of pass1Order(state, freeLines, pol.keep_ms, t)) {
    const E = slotEnd(L, cap);
    if (join(L, E - pol.keep_ms)) continue;
    const W = asLoad(L, cap);
    const lo = Math.max(t, L.deadline_ms - L.max_early_ms);
    let fire = latestFit(work, lo, L.deadline_ms - pol.keep_ms, W.prep_ms, W.cook_ms, W.units, cap);
    if (fire === null && join(L, E)) continue;
    fire ??= latestFit(work, lo, L.deadline_ms, W.prep_ms, W.cook_ms, W.units, cap);
    if (fire === null) {
      late.push(L);
      continue;
    }
    const booked = bookingAt(W, cap, fire);
    work.add(booked);
    cands.push(formed(joinLine(L), fire, booked, from.get(L.order_item_id) ?? null));
  }
  if (late.length === 0) return { profile: work.snapshot(), loads: cands, probes: null };
  // Task 13 review (D14 kept in the overload search): the units of the Λ search are loads. The loads the loop above
  // formed keep their members; the late lines are grouped by the stored load they came from (same program, cook
  // and room by construction) — proposed (implementer, overnight) J6; joins into frozen / pruned loads stay fixed.
  const units: WorkLoad[] = cands.filter((b) => b.load_id === null);
  const lateGroups = new Map<string, EngineLine[]>();
  for (const L of late) {
    const k = from.get(L.order_item_id) ?? L.order_item_id;
    lateGroups.set(k, [...(lateGroups.get(k) ?? []), L]);
  }
  for (const [k, ls] of lateGroups) {
    let u = formed(joinLine(ls[0]!), 0, { start: 0, end: 0, units: 0 }, from.has(ls[0]!.order_item_id) ? k : null);
    for (const L of ls.slice(1)) u = withMember(u, joinLine(L));
    units.push(u);
  }
  const r = overloadPlace(base, units.map((u) => overloadUnit(state, u, cap, t)), cap, t, Math.max(1, state.config?.settings.cascade_step_ms ?? 60_000));
  const capped = new Set(r.capped);
  const placed = new Map(r.placements);
  const loads = units.map((u) => {
    const pl = placed.get(u.members[0]!)!;
    return { ...u, fire_ms: pl.fire, booked: pl.booked, capped: capped.has(u.members[0]!) };
  });
  return { profile: r.profile, loads: [...cands.filter((b) => b.load_id !== null), ...loads], probes: r.probes };
}

// Task 13 review: a load as one unit of the §3.5.6 search (keyed by its first member), fitted whole-station with
// its largest prep and its cook. The unit fires at the load's fire, so in load-fire terms a member m bounds it by
// latest start: fire ≤ d(m) + prep(m) − max_prep, and by max_early_ms: fire ≥ d(m) − max_early_ms(m).
// proposed (implementer, overnight) J7: the unit's deadline is the minimum of those latest fires; the binding
// member (the one giving it; ties by order_item_id) gives the weight (§3.5.2), its max_late_ms and the pass-1 tie
// key, so d_Λ = min member d + min(Λ × 100 / w_binding, max_late_binding); lo = the largest member bound (≤ d).
function overloadUnit(state: EngineState, u: WorkLoad, cap: number, t: number): OverloadLine {
  let bind: EngineLine | null = null;
  let d = Number.POSITIVE_INFINITY;
  let lo = Number.NEGATIVE_INFINITY;
  for (const m of [...u.members].sort()) {
    const L = state.lines[m]!;
    const dm = L.deadline_ms + L.prep_ms - u.max_prep;
    if (dm < d) {
      d = dm;
      bind = L;
    }
    lo = Math.max(lo, L.deadline_ms - L.max_early_ms);
  }
  const w = weightOf(state, bind!);
  return {
    order_item_id: u.members[0]!,
    deadline_ms: d,
    max_early_ms: Math.max(0, d - lo),
    max_late_ms: bind!.max_late_ms,
    units: Math.max(u.units, cap),
    prep_ms: u.max_prep,
    cook_ms: u.cook_ms,
    w,
    urgency: w * (t - (state.orders[bind!.order_id]?.placed_at ?? t)),
    cap,
  };
}

// §3.3 unfired order: (fire, order_item_id).
export function sortUnfired(ids: readonly string[], lines: Readonly<Record<string, EngineLine>>): string[] {
  return [...ids].sort((a, b) => {
    const fa = lines[a]!.fire_ms ?? Number.POSITIVE_INFINITY;
    const fb = lines[b]!.fire_ms ?? Number.POSITIVE_INFINITY;
    return fa - fb || (a < b ? -1 : a > b ? 1 : 0);
  });
}

// One station's share of a batch of moves, in move order: a line leaving (remove its old booking), arriving
// (add its new one) or moving on the station (both).
type Op = { line: EngineLine; remove: Booking | null; add: Booking | null };

// Per-line removal (remove exactly booked, then add the new one) with an AD-6 diagnostic per underflowing line:
// the slow path, used only when the batched sweep found an underflow.
function opsOneByOne(profile: Profile, ops: readonly Op[], event_id: string, station_id: string, strict: boolean, diagnostics: Diagnostic[]): Profile {
  let p = profile;
  for (const { line, remove, add } of ops) {
    if (remove !== null) {
      let underflow: Underflow | null = null;
      p = strict
        ? removeInterval(p, remove, remove.units)
        : removeInterval(p, remove, remove.units, (u) => {
            underflow = u;
          });
      if (underflow !== null) {
        const { at, deficit } = underflow as Underflow;
        diagnostics.push({ kind: 'profile_underflow', event_id, station_id, detail: { order_item_id: line.order_item_id, at, deficit } });
      }
    }
    if (add !== null) p = addInterval(p, add, add.units);
  }
  return p;
}

// Stores re-placements of unfired lines (AD-7: removes exactly the old `booked`, books the new one, sets
// fire_ms and the §3.5.6 / AD-15 `capped` flag) and re-sorts `unfired` on the touched stations. A move with `to`
// (§3.5.5 re-route, task 11) takes the line off its old station (exactly `booked`, and `unfired`) and onto the new
// one, with the new route fields and deadline. Per station one sweep removes all old bookings and one adds the new
// ones. AD-6: if that finds an underflow, the per-line path runs instead: strict → it throws; non-strict → it
// clamps and appends a 'profile_underflow' diagnostic naming the line. Copy-on-write.
export function applyMoves(state: EngineState, moves: ReadonlyMap<string, Move>, event_id: string, strict: boolean): EngineState {
  if (moves.size === 0) return state;
  const stations: Record<string, StationRuntime> = { ...state.stations };
  const lines: Record<string, EngineLine> = { ...state.lines };
  const diagnostics: Diagnostic[] = [];
  const ops = new Map<string, Op[]>();
  const leaving = new Map<string, Set<string>>();
  const arriving = new Map<string, string[]>();
  const push = <V>(m: Map<string, V[]>, k: string, v: V): void => {
    const list = m.get(k);
    if (list === undefined) m.set(k, [v]);
    else list.push(v);
  };
  for (const [id, mv] of moves) {
    const line = lines[id]!;
    const to = mv.to?.station_id ?? line.station_id;
    if (to === line.station_id) {
      push(ops, to, { line, remove: line.booked, add: mv.booked });
    } else {
      push(ops, line.station_id, { line, remove: line.booked, add: null });
      push(ops, to, { line, remove: null, add: mv.booked });
      const out = leaving.get(line.station_id);
      if (out === undefined) leaving.set(line.station_id, new Set([id]));
      else out.add(id);
      push(arriving, to, id);
    }
    lines[id] = { ...line, ...(mv.to ?? {}), fire_ms: mv.fire, booked: mv.booked, capped: mv.capped ?? false };
  }
  for (const [sid, list] of ops) {
    const station = stations[sid]!;
    let underflowed = false;
    const removed = combine(
      station.profile,
      profileOf(list.flatMap((op) => (op.remove === null ? [] : [op.remove]))),
      -1,
      () => {
        underflowed = true;
      },
    );
    const profile = underflowed
      ? opsOneByOne(station.profile, list, event_id, sid, strict, diagnostics)
      : combine(removed, profileOf(list.flatMap((op) => (op.add === null ? [] : [op.add]))), 1);
    const out = leaving.get(sid);
    const unfired = [...(out === undefined ? station.unfired : station.unfired.filter((x) => !out.has(x))), ...(arriving.get(sid) ?? [])];
    stations[sid] = { ...station, profile, unfired: sortUnfired(unfired, lines) };
  }
  return {
    ...state,
    stations,
    lines,
    diagnostics: diagnostics.length === 0 ? state.diagnostics : [...state.diagnostics, ...diagnostics],
  };
}

// ---- §3.7 StockAdded flip (task 12b; BF-7) ---------------------------------------------------------------------

// BF-7 (G4-3 #11): the StockReserved fold that flips a hidden line from fresh to stock re-places only that line, within
// its own slack, on its own station; no other line moves. The line already carries its stock cook time (and on a
// batch station its stock program, BF-1 currentProgram); `oldCook` is the cook it was booked with. Its slot end is
// kept (§3.7 "the line may now fire later and still land on its T"), so its deadline moves later by the occupancy
// difference: d' = d + cook_occ(old) − cook_occ(new) (AD-12 slot). Cost: one live read of its station and one fit
// pair (a batch line also one scan of the station's loads) — independent of the number of hidden lines.
export type FlipPlacement =
  | { kind: 'slot'; deadline_ms: number; move: Move }
  | { kind: 'batch'; deadline_ms: number; loads: WorkLoad[] };

// A slot line: removed from its station's live profile (exactly its `booked`, AD-7), then placed at
// latestFit(lo = max(t, d' − max_early_ms), hi = d' − keep), else latestFit(lo, d'); proposed (implementer,
// overnight): if neither fits (the live profile moved since the line was booked) it takes its old slot end with the
// stock cook (fire = old fire + the occupancy difference), inside its old booking, so it never needs capacity it
// did not hold. FIFO (§3.5.3, AD-14: no re-plan): proposed (implementer, overnight) it keeps its fire, its booking
// shrinks to the stock cook, deadline = fire.
// A batch line (§3.7: "the re-plan places it in a load of that program"; G4-1 #10) leaves its load (which keeps its
// name and booking while it has members; with none left its booking goes, AD-7) and, as batchPass1 steps 1–4 for
// this one line with slot end E: joins the first compatible load (its stock program and cook, room, prep) with
// b.end ≤ E − keep within min(freshness, max_early_ms); else forms a load at latestFit(lo, d' − keep); else joins
// with b.end ≤ E; else forms at latestFit(lo, d'); proposed (implementer, overnight) else at earliestFit(lo) (late;
// the tick slips it, never refused, D3).
export function flipPlacement(state: EngineState, id: string, oldCook: number, t: number, strict: boolean): FlipPlacement {
  const line = state.lines[id]!;
  const station = state.stations[line.station_id]!;
  const pol = stationPolicy(state, station.station_id);
  const own = optionOn(routeOptions(routeCtx(state), line, true), station.station_id);
  const cap = station.type === 'batch' ? capacityFor(station, id) : (own?.cap ?? capacityFor(station, id));
  const shift = occupancy(line.units, cap, oldCook).cook_ms - occupancy(line.units, cap, line.cook_ms).cook_ms;
  const d = line.deadline_ms + shift;
  const lo = Math.max(t, d - line.max_early_ms);
  const clamp = strict ? undefined : (): void => undefined;
  if (station.type !== 'batch') {
    if (pol.policy === 'fifo') return { kind: 'slot', deadline_ms: line.fire_ms!, move: { fire: line.fire_ms!, booked: bookingAt(line, cap, line.fire_ms!), capped: false } };
    const b = line.booked!;
    const work = removeInterval(liveProfile(state, station.station_id, t), b, b.units, clamp);
    const fire =
      latestFit(work, lo, d - pol.keep_ms, line.prep_ms, line.cook_ms, line.units, cap) ??
      latestFit(work, lo, d, line.prep_ms, line.cook_ms, line.units, cap) ??
      line.fire_ms! + shift;
    return { kind: 'slot', deadline_ms: d, move: { fire, booked: bookingAt(line, cap, fire), capped: false } };
  }
  let work = liveProfile(state, station.station_id, t);
  const loads: WorkLoad[] = [];
  for (const l of Object.values(station.loads)) {
    if (!l.order_item_ids.includes(id)) {
      loads.push(workOf(state, l));
      continue;
    }
    const rest = l.order_item_ids.filter((m) => m !== id);
    if (rest.length > 0) loads.push(workOf(state, { ...l, order_item_ids: rest }));
    else work = removeInterval(work, l.booked, l.booked.units, clamp);
  }
  const E = d + line.prep_ms + occupancy(line.units, cap, line.cook_ms).cook_ms;
  const jl = joinLine(line);
  const window = freshnessOf(state, station.station_id);
  const join = (end: number): WorkLoad[] | null => {
    const b = syncJoin(loads, jl, cap, end, window, t);
    return b === undefined ? null : replaced(loads, b, withMember(b, jl));
  };
  const W = asLoad(line, cap);
  const fit = (hi: number): number | null => latestFit(work, lo, hi, W.prep_ms, W.cook_ms, W.units, cap);
  const form = (fire: number): WorkLoad[] => [...loads, formed(jl, fire, bookingAt(W, cap, fire))];
  const viaKeep = join(E - pol.keep_ms);
  if (viaKeep !== null) return { kind: 'batch', deadline_ms: d, loads: viaKeep };
  const f1 = fit(d - pol.keep_ms);
  if (f1 !== null) return { kind: 'batch', deadline_ms: d, loads: form(f1) };
  const viaEnd = join(E);
  if (viaEnd !== null) return { kind: 'batch', deadline_ms: d, loads: viaEnd };
  const f2 = fit(d) ?? earliestFit(work, lo, W.prep_ms, W.cook_ms, W.units, cap);
  return { kind: 'batch', deadline_ms: d, loads: form(f2) };
}
