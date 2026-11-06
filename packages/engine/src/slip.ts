// 03a §3.8 slip warning: the estimate per sync group, the crossing (`slipCrossing`), `slip_due` per table key with its
// minimum `next_alert_due_at` (kept by the folds, upkeepSlips), and getAlertIntents / nextAlertDueAt (§6.1g) for the
// hub's `fires_alerts` tick; §3.10's overload item. Pure: every time is the caller's `now` or a value of the state.
//
// Estimate of a line at t (F §4.7 formulas with carry, §3.8; the group's estimate is the maximum over its sync lines):
//   - COOKING: started + prep + cook + carry (fixed; cook = the AD-4 occupancy cook at the effective capacity);
//   - done / served: done_at + carry (fixed);
//   - fired, not started: s(t) + prep + cook + carry, s(t) its packed Start (§3.3, BF-14 (a): the packing of
//     liveInterval itself, live.ts packStation, so the fired lines ahead of it count);
//   - unfired: max(planned land, t + prep + cook + carry), planned land = its booking's end (a batch member: its
//     load's) + carry.
// Trigger: estimate > level, level = slips[key] ? last_estimate + slip_threshold_ms : T + slip_threshold_ms.
//
// Crossing of a line (the earliest t with estimate(t) > level; BF-3: carry included), never before `lo`:
//   - COOKING / done: lo when the fixed land already exceeds the level, else none;
//   - unfired: lo when the planned land already exceeds, else max(lo, level − prep − cook − carry + 1);
//   - fired, not started: found on the packing (monotone search: lo false, the first t true);
//   - none at or after its order's exit time (§3.3: from then on every reader treats the order as gone).
// The group's crossing is the minimum over its lines, the key's the minimum over its unresolved sync groups.
//
// Proposed (implementer, overnight) readings, each keeping the stated rules:
//   R1 "or the fold's recorded_at when its planned land already exceeds the level" → `lo` = the order's placed_at
//      (≤ every fold that can touch it): due in the same pass as with recorded_at, but slip_due becomes a pure
//      function of the state, so the per-key upkeep equals a full recompute (test 106) and live = replay (test 92)
//      without the value depending on which fold last touched the key. At the submit fold placed_at = recorded_at
//      (test 91's slip half).
//   R2 "> level" is strict on integer ms, so the unstarted crossing is level − prep − cook − carry + 1 (the spec's
//      "t = level − prep − cook" gives estimate = level, no slip); at it getAlertIntents has the item, at − 1 none.
//   R3 "per sync group": only groups with a sync line slip, and only their sync lines count for the estimate and for
//      resolution; an immediate line (a starter, an expedite, a return) never slips.
//   R4 a key's slip resolves when every order of slips[key].order_ids is absent, out of the engine, or has every sync
//      group resolved (every sync line done or later); a later order on the same table never un-resolves it. Any
//      fold that makes a resolved key unresolved clears resolved_at (§3.8 names ItemDoneUndone).
//   R5 BF-4 (with AD-13): for a key with an open alert and no resolution, slip_due = the latest exit time of the
//      slip's unresolved orders (the AD-13 abandon time max(last_line_fold_at + order_abandon_ms, latest planned
//      land), found from the exit predicate itself, as tick.ts abandonTime), or none when one of them cannot exit by
//      time alone (an unfired line); getAlertIntents then lists the key in `resolved`.
//   R6 the slip item: the key's sync groups whose crossing is reached at now; order_ids = their orders, oldest first
//      (placed_at, order_id); estimate = the largest group estimate at now; target = that group's T; promise = that
//      T + its order's padding (promise_ms − target_land_ms of the order: the state keeps no per-group promise).
//   R7 overload (§3.10): every station, sorted by id; waiting = the orders in the engine with a line on the station
//      not yet done (unfired, fired or COOKING); capped = an unfired line of the station has `capped` (AD-15 / 16).
//   R8 upkeep: the touched keys are found by comparing the fold's input and output (copy-on-write, so a changed line,
//      order or slip is a new object): the keys of every changed order and of every changed line's order, every
//      changed slip key; BF-14 (b) generalised — a changed in-flight line (fired-not-started or COOKING, before or
//      after) also touches the keys of every fired-not-started line of its station, and an effective-capacity change
//      every line of that station; a changed slip_threshold_ms or order_abandon_ms (or the first config) touches
//      every key. The comparison is O(lines) only when the fold copied `lines` (already O(lines)); the recompute is
//      O(lines of the touched keys).
import { effectiveCapacity } from './capacity.js';
import { ORDER_EXIT_AFTER_SERVED_MS, orderInEngine } from './lifecycle.js';
import { liveProfiles, packStation } from './live.js';
import { pressureBp, pressureWindowOf } from './pressure.js';
import { occupancy } from './profile.js';
import type { ItemsReleasedPayload } from '@pos/events';
import type { EngineLine, EngineOrder, EngineState, SlipRecord } from './state.js';

export interface AlertIntents {
  slips: Array<{ table_key: string; order_ids: string[]; estimate: number; target: number; promise: number }>;
  resolved: Array<{ table_key: string; alert_id: string }>;
  overload: Array<{ station_id: string; pressure_bp: number; waiting: number; capped: boolean }>;
}

const INF = Number.POSITIVE_INFINITY;
const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const ENDED: ReadonlySet<EngineLine['stage']> = new Set(['done', 'served', 'removed', 'voided', 'returned']);

function thresholdOf(state: EngineState): number | null {
  return state.config?.settings.slip_threshold_ms ?? null;
}

// AD-8: a listed line not yet filled by its ItemAdded is not a line.
function isPlaceholder(line: EngineLine): boolean {
  return line.units === 0 && line.fire_ms === null && line.booked === null;
}

function isFiredNotStarted(line: EngineLine): boolean {
  return line.stage === 'added' && line.fired_at !== null;
}

function isInFlight(line: EngineLine): boolean {
  return line.stage === 'cooking' || isFiredNotStarted(line);
}

// ---- reading context: lazily built per call, never stored ----------------------------------------------------------

class Ctx {
  private flight: Map<string, EngineLine[]> | null = null;
  private exits = new Map<string, number>();

  constructor(readonly state: EngineState) {}

  // The in-flight lines of every station, one pass over the lines (the exit filter is applied per t).
  private inFlight(station_id: string): readonly EngineLine[] {
    if (this.flight === null) {
      this.flight = new Map();
      for (const id in this.state.lines) {
        const l = this.state.lines[id]!;
        if (!isInFlight(l)) continue;
        const list = this.flight.get(l.station_id);
        if (list === undefined) this.flight.set(l.station_id, [l]);
        else list.push(l);
      }
    }
    return this.flight.get(station_id) ?? [];
  }

  // BF-14 (a): the end of a fired-not-started line's packed interval at t (liveInterval's packing), or null when its
  // order is out of the engine at t.
  packedEnd(line: EngineLine, t: number): number | null {
    const station = this.state.stations[line.station_id];
    if (station === undefined) return null;
    const memo = new Map<string, boolean>();
    const live = this.inFlight(line.station_id).filter((l) => {
      let v = memo.get(l.order_id);
      if (v === undefined) {
        const o = this.state.orders[l.order_id];
        v = o !== undefined && orderInEngine(this.state, o, t);
        memo.set(l.order_id, v);
      }
      return v;
    });
    if (!live.includes(line)) return null;
    return packStation(station, live, t).bookings.get(line.order_item_id)?.end ?? null;
  }

  exitAt(order: EngineOrder): number {
    let e = this.exits.get(order.order_id);
    if (e === undefined) {
      e = exitTime(this.state, order);
      this.exits.set(order.order_id, e);
    }
    return e;
  }
}

// §3.3: the earliest t at which the order is out of the engine by time alone (served rule or the AD-13 abandon rule),
// INF when never (an unfired line, a listed line not yet seen, no config). Found from the exit predicate itself, as
// tick.ts abandonTime, so there is no second copy of the planned-land rule.
function exitTime(state: EngineState, order: EngineOrder): number {
  const served = order.last_served_at === null ? INF : order.last_served_at + ORDER_EXIT_AFTER_SERVED_MS;
  return Math.min(served, abandonTime(state, order));
}

function abandonTime(state: EngineState, order: EngineOrder): number {
  const ms = state.config?.settings.order_abandon_ms;
  if (ms === undefined || order.awaiting > 0) return INF;
  for (const id of order.line_ids) {
    const l = state.lines[id];
    if (l !== undefined && l.stage === 'added' && l.fired_at === null) return INF;
  }
  const o = order.last_served_at === null ? order : { ...order, last_served_at: null };
  const gone = (t: number): boolean => !orderInEngine(state, o, t);
  const lo = order.last_line_fold_at + ms;
  if (gone(lo)) return lo;
  let span = 1;
  while (!gone(lo + span)) {
    span *= 2;
    if (span > 2 ** 46) return INF;
  }
  let a = lo + span / 2;
  let b = lo + span;
  while (b - a > 1) {
    const m = a + Math.floor((b - a) / 2);
    if (gone(m)) b = m;
    else a = m;
  }
  return b;
}

// ---- groups ---------------------------------------------------------------------------------------------------------

type SyncGroup = { order: EngineOrder; target: number; lines: EngineLine[] };

// R3: the order's groups with a sync line, each with its sync lines (placeholders and absent ids left out).
function syncGroups(state: EngineState, order: EngineOrder): SyncGroup[] {
  const out: SyncGroup[] = [];
  for (const gid of Object.keys(order.groups).sort(byId)) {
    const g = order.groups[gid]!;
    const lines: EngineLine[] = [];
    for (const id of g.line_ids) {
      const l = state.lines[id];
      if (l !== undefined && l.order_id === order.order_id && l.serve_mode === 'sync' && !isPlaceholder(l)) lines.push(l);
    }
    if (lines.length > 0) out.push({ order, target: g.target_land_ms, lines });
  }
  return out;
}

function groupResolved(g: SyncGroup): boolean {
  return g.lines.every((l) => ENDED.has(l.stage));
}

// R4: every sync group resolved; an order still awaiting listed lines is not.
function orderResolved(state: EngineState, order: EngineOrder): boolean {
  return order.awaiting === 0 && syncGroups(state, order).every(groupResolved);
}

// ---- estimate and crossing (slipCrossing) ---------------------------------------------------------------------------

function capOf(state: EngineState, line: EngineLine): number {
  const station = state.stations[line.station_id];
  const cap = station === undefined ? 0 : effectiveCapacity(station);
  return cap >= 1 ? cap : Math.max(1, line.units);
}

function cookingLand(state: EngineState, line: EngineLine): number {
  return line.started_at! + line.prep_ms + occupancy(line.units, capOf(state, line), line.cook_ms).cook_ms + line.carry_ms;
}

// An unfired line's planned interval: its booking, or its load's (a batch member, AD-7 for loads).
function plannedInterval(state: EngineState, line: EngineLine): { start: number; end: number } | null {
  if (line.booked !== null) return line.booked;
  const load = line.load_id === null ? undefined : state.stations[line.station_id]?.loads[line.load_id];
  return load !== undefined && load.order_item_ids.includes(line.order_item_id) ? load.booked : null;
}

// The line's estimate at t, or null when it lands nothing (ended without a land, unplaced, out of the engine).
function lineEstimate(ctx: Ctx, line: EngineLine, t: number): number | null {
  const state = ctx.state;
  switch (line.stage) {
    case 'cooking':
      return cookingLand(state, line);
    case 'done':
    case 'served':
      return line.done_at === null ? null : line.done_at + line.carry_ms;
    case 'added': {
      if (line.fired_at !== null) {
        const end = ctx.packedEnd(line, t);
        return end === null ? null : end + line.carry_ms;
      }
      const iv = plannedInterval(state, line);
      if (iv === null) return null;
      return Math.max(iv.end, t + line.prep_ms + (iv.end - iv.start)) + line.carry_ms;
    }
    default:
      return null;
  }
}

function lineCrossing(ctx: Ctx, line: EngineLine, level: number, lo: number, exit: number): number {
  const state = ctx.state;
  let c = INF;
  switch (line.stage) {
    case 'cooking':
      if (cookingLand(state, line) > level) c = lo;
      break;
    case 'done':
    case 'served':
      if (line.done_at !== null && line.done_at + line.carry_ms > level) c = lo;
      break;
    case 'added': {
      if (line.fired_at !== null) {
        c = firedCrossing(ctx, line, level, lo, exit);
        break;
      }
      const iv = plannedInterval(state, line);
      if (iv === null) break;
      c = iv.end + line.carry_ms > level ? lo : Math.max(lo, level - line.prep_ms - (iv.end - iv.start) - line.carry_ms + 1);
      break;
    }
    default:
      break;
  }
  return c < exit ? c : INF;
}

// BF-14 (a): the first t ≥ lo at which the packed estimate exceeds the level. s(t) ≥ max(fire, t), so at
// hi = level − prep − cook − carry + 1 the estimate exceeds it whenever the line still packs; a range cut by the exit
// that never crosses gives none. Binary search keeps "lo false, hi true", so the result r has estimate(r) > level and
// estimate(r − 1) ≤ level.
// Assumption: the packed estimate is non-decreasing in t (each packed Start is the earliest fit ≥ max(fire, t) beside
// fixed COOKING intervals); then the result is the earliest crossing. The packing is non-monotone when an order ahead
// exits (it leaves the engine and frees its unit), and then the result is still an instant r with estimate(r) > level
// and estimate(r − 1) ≤ level and a pure function of the state, so per-key = full recompute, live = replay and test
// 92's item / no-item pair hold regardless.
function firedCrossing(ctx: Ctx, line: EngineLine, level: number, lo: number, exit: number): number {
  const pred = (t: number): boolean => {
    const e = ctx.packedEnd(line, t);
    return e !== null && e + line.carry_ms > level;
  };
  if (lo >= exit) return INF;
  if (pred(lo)) return lo;
  let hi = Math.max(lo + 1, level - line.prep_ms - line.cook_ms - line.carry_ms + 1);
  if (hi >= exit) hi = exit - 1;
  if (hi <= lo || !pred(hi)) return INF;
  // Nothing ahead pushes the line at hi − 1 (the usual case: s(t) = max(t, a constant)): hi is the first crossing,
  // since the estimate is non-decreasing in t. Otherwise search [lo, hi).
  if (hi - 1 === lo || !pred(hi - 1)) return hi;
  let a = lo;
  hi -= 1;
  while (hi - a > 1) {
    const m = a + Math.floor((hi - a) / 2);
    if (pred(m)) hi = m;
    else a = m;
  }
  return hi;
}

function levelOf(g: SyncGroup, slip: SlipRecord | undefined, th: number): number {
  return slip === undefined ? g.target + th : slip.last_estimate + th;
}

// slipCrossing: the group's crossing time (INF when none). The one function behind slip_due and getAlertIntents.
function groupCrossing(ctx: Ctx, g: SyncGroup, level: number): number {
  const exit = ctx.exitAt(g.order);
  let c = INF;
  for (const l of g.lines) c = Math.min(c, lineCrossing(ctx, l, level, g.order.placed_at, exit));
  return c;
}

// R5 (BF-4): the latest exit time of the slip's unresolved orders, or null.
function abandonDue(ctx: Ctx, slip: SlipRecord): number | null {
  let due = Number.NEGATIVE_INFINITY;
  for (const id of slip.order_ids) {
    const order = ctx.state.orders[id];
    if (order === undefined || orderResolved(ctx.state, order)) continue;
    const e = ctx.exitAt(order);
    if (e === INF) return null;
    due = Math.max(due, e);
  }
  return due === Number.NEGATIVE_INFINITY ? null : due;
}

// §3.8 slip_due[key]: (a) resolved_at of a resolved slip with an open alert; BF-4 the abandon time of an open alert's
// unresolved orders; (b) with no open alert, the crossing of the key's unresolved sync groups; else null.
function keyDue(ctx: Ctx, key: string, orders: readonly EngineOrder[]): number | null {
  const th = thresholdOf(ctx.state);
  if (th === null) return null;
  const slip = ctx.state.slips[key];
  if (slip !== undefined && slip.alert_id !== null) return slip.resolved_at ?? abandonDue(ctx, slip);
  let best = INF;
  for (const order of orders) {
    if (order.awaiting > 0) continue;
    for (const g of syncGroups(ctx.state, order)) {
      if (!groupResolved(g)) best = Math.min(best, groupCrossing(ctx, g, levelOf(g, slip, th)));
    }
  }
  return best === INF ? null : best;
}

// The present orders of the given keys (all keys when `only` is undefined), oldest first (placed_at, order_id).
function ordersByKey(state: EngineState, only?: ReadonlySet<string>): Map<string, EngineOrder[]> {
  const out = new Map<string, EngineOrder[]>();
  for (const id in state.orders) {
    const o = state.orders[id]!;
    if (only !== undefined && !only.has(o.table_key)) continue;
    const list = out.get(o.table_key);
    if (list === undefined) out.set(o.table_key, [o]);
    else list.push(o);
  }
  for (const list of out.values()) list.sort((a, b) => a.placed_at - b.placed_at || byId(a.order_id, b.order_id));
  return out;
}

// The full recompute of slip_due (test 106: the per-key upkeep must equal it after every fold).
export function slipDueOf(state: EngineState): Record<string, number> {
  const byKey = ordersByKey(state);
  const keys = new Set<string>([...byKey.keys(), ...Object.keys(state.slips)]);
  const ctx = new Ctx(state);
  const out: Record<string, number> = {};
  for (const key of [...keys].sort(byId)) {
    const v = keyDue(ctx, key, byKey.get(key) ?? []);
    if (v !== null) out[key] = v;
  }
  return out;
}

// Per unresolved sync group of the key at t (orders in the engine, none awaiting): its level, crossing and estimate at
// t. A pure reader of the same slipCrossing / estimate as getAlertIntents (the test oracle of test 92).
export function slipGroupsAt(state: EngineState, key: string, t: number): Array<{ order_id: string; placed_at: number; level: number; crossing: number; estimate: number }> {
  const th = thresholdOf(state);
  if (th === null) return [];
  const ctx = new Ctx(state);
  const slip = state.slips[key];
  const out: Array<{ order_id: string; placed_at: number; level: number; crossing: number; estimate: number }> = [];
  for (const order of ordersByKey(state, new Set([key])).get(key) ?? []) {
    if (order.awaiting > 0 || !orderInEngine(state, order, t)) continue;
    for (const g of syncGroups(state, order)) {
      if (groupResolved(g)) continue;
      const level = levelOf(g, slip, th);
      let est = Number.NEGATIVE_INFINITY;
      for (const l of g.lines) est = Math.max(est, lineEstimate(ctx, l, t) ?? Number.NEGATIVE_INFINITY);
      out.push({ order_id: order.order_id, placed_at: order.placed_at, level, crossing: groupCrossing(ctx, g, level), estimate: est });
    }
  }
  return out;
}

// ---- fold-side upkeep (apply-event.ts calls it after every handled fold) --------------------------------------------

function touchedKeys(prev: EngineState, next: EngineState): Set<string> {
  const keys = new Set<string>();
  const pc = prev.config;
  const nc = next.config;
  if (
    pc !== nc &&
    (pc === null ||
      nc === null ||
      pc.settings.slip_threshold_ms !== nc.settings.slip_threshold_ms ||
      pc.settings.order_abandon_ms !== nc.settings.order_abandon_ms)
  ) {
    for (const s of [prev, next]) {
      for (const id in s.orders) keys.add(s.orders[id]!.table_key);
      for (const k in s.slips) keys.add(k);
    }
    return keys;
  }
  if (prev.slips !== next.slips) {
    for (const k in prev.slips) if (prev.slips[k] !== next.slips[k]) keys.add(k);
    for (const k in next.slips) if (prev.slips[k] !== next.slips[k]) keys.add(k);
  }
  const flight = new Set<string>();
  // A changed order may change its exit time without changing a line (last_line_fold_at: OrderBoosted / ItemsReleased
  // via foldNamesOrder), and that moves the packing of the lines behind its in-flight lines: their stations count as
  // in-flight changes (review, task 15).
  const orderFlight = (s: EngineState, o: EngineOrder): void => {
    for (const lid of o.line_ids) {
      const l = s.lines[lid];
      if (l !== undefined && isInFlight(l)) flight.add(l.station_id);
    }
  };
  if (prev.orders !== next.orders) {
    for (const id in next.orders) {
      const a = prev.orders[id];
      const b = next.orders[id]!;
      if (a === b) continue;
      keys.add(b.table_key);
      orderFlight(next, b);
      if (a !== undefined) {
        keys.add(a.table_key);
        orderFlight(prev, a);
      }
    }
    for (const id in prev.orders) {
      const a = prev.orders[id]!;
      if (next.orders[id] === undefined) {
        keys.add(a.table_key);
        orderFlight(prev, a);
      }
    }
  }
  if (prev.lines !== next.lines) {
    const add = (l: EngineLine): void => {
      const o = next.orders[l.order_id] ?? prev.orders[l.order_id];
      if (o !== undefined) keys.add(o.table_key);
      if (isInFlight(l)) flight.add(l.station_id);
    };
    for (const id in next.lines) {
      const a = prev.lines[id];
      const b = next.lines[id]!;
      if (a === b) continue;
      add(b);
      if (a !== undefined) add(a);
    }
    for (const id in prev.lines) if (next.lines[id] === undefined) add(prev.lines[id]!);
  }
  const capChanged = new Set<string>();
  if (prev.stations !== next.stations) {
    for (const sid in next.stations) {
      const a = prev.stations[sid];
      const b = next.stations[sid]!;
      if (a !== undefined && a !== b && effectiveCapacity(a) !== effectiveCapacity(b)) capChanged.add(sid);
    }
  }
  if (flight.size > 0 || capChanged.size > 0) {
    for (const id in next.lines) {
      const l = next.lines[id]!;
      if (capChanged.has(l.station_id) || (flight.has(l.station_id) && isFiredNotStarted(l))) {
        const o = next.orders[l.order_id];
        if (o !== undefined) keys.add(o.table_key);
      }
    }
  }
  return keys;
}

// R4 at the fold's recorded_at: every order of the slip absent, out of the engine, or with every sync group resolved.
function slipResolved(state: EngineState, slip: SlipRecord, t: number): boolean {
  return slip.order_ids.every((id) => {
    const o = state.orders[id];
    return o === undefined || !orderInEngine(state, o, t) || orderResolved(state, o);
  });
}

// §3.8 Slip state and slip_due upkeep for the keys the fold touched (prev = the fold's input, next = its output, t =
// its recorded_at): a resolving fold sets resolved_at = t when the alert is open, else drops slips[key]; a fold that
// un-resolves clears resolved_at; then slip_due[key] is recomputed for those keys only and next_alert_due_at is its
// minimum. Nothing changed → `next` itself (slip_due and next_alert_due_at keep their references, test 106).
export function upkeepSlips(prev: EngineState, next: EngineState, t: number): EngineState {
  if (prev === next) return next;
  const touched = touchedKeys(prev, next);
  if (touched.size === 0) return next;
  let slips = next.slips;
  for (const key of touched) {
    const slip = slips[key];
    if (slip === undefined) continue;
    const resolved = slipResolved(next, slip, t);
    if (resolved && slip.alert_id === null) {
      slips = { ...slips };
      delete slips[key];
    } else if (resolved && slip.resolved_at === null) {
      slips = { ...slips, [key]: { ...slip, resolved_at: t } };
    } else if (!resolved && slip.resolved_at !== null) {
      slips = { ...slips, [key]: { ...slip, resolved_at: null } };
    }
  }
  const state = slips === next.slips ? next : { ...next, slips };
  const ctx = new Ctx(state);
  const byKey = ordersByKey(state, touched);
  let due = state.slip_due;
  for (const key of touched) {
    const v = keyDue(ctx, key, byKey.get(key) ?? []);
    const old = due[key];
    if (v === null ? old === undefined : old === v) continue;
    if (due === state.slip_due) due = { ...due };
    if (v === null) delete due[key];
    else due[key] = v;
  }
  if (due === state.slip_due) return state;
  let min: number | null = null;
  for (const k in due) if (min === null || due[k]! < min) min = due[k]!;
  return { ...state, slip_due: due, next_alert_due_at: min };
}

// ---- readers (§6.1g) ------------------------------------------------------------------------------------------------

// R6: the slip item of a due key with no open alert, or null when no group's crossing is reached at now.
function slipItem(ctx: Ctx, key: string, orders: readonly EngineOrder[], th: number, now: number): AlertIntents['slips'][number] | null {
  const slip = ctx.state.slips[key];
  const ids = new Set<string>();
  let best: { estimate: number; target: number; order: EngineOrder } | null = null;
  for (const order of orders) {
    if (order.awaiting > 0 || !orderInEngine(ctx.state, order, now)) continue;
    for (const g of syncGroups(ctx.state, order)) {
      if (groupResolved(g) || groupCrossing(ctx, g, levelOf(g, slip, th)) > now) continue;
      let est = Number.NEGATIVE_INFINITY;
      for (const l of g.lines) est = Math.max(est, lineEstimate(ctx, l, now) ?? Number.NEGATIVE_INFINITY);
      ids.add(order.order_id);
      if (best === null || est > best.estimate) best = { estimate: est, target: g.target, order };
    }
  }
  if (best === null) return null;
  return {
    table_key: key,
    order_ids: orders.filter((o) => ids.has(o.order_id)).map((o) => o.order_id),
    estimate: best.estimate,
    target: best.target,
    promise: best.target + (best.order.promise_ms - best.order.target_land_ms),
  };
}

// R7: §3.10's per-station inputs of the overload check.
function overloadItems(state: EngineState, now: number): AlertIntents['overload'] {
  const ids = Object.keys(state.stations).sort(byId);
  if (ids.length === 0) return [];
  const profiles = liveProfiles(state, ids, now);
  const waiting = new Map<string, Set<string>>();
  const capped = new Set<string>();
  const memo = new Map<string, boolean>();
  for (const id in state.lines) {
    const l = state.lines[id]!;
    if ((l.stage !== 'added' && l.stage !== 'cooking') || isPlaceholder(l)) continue;
    let v = memo.get(l.order_id);
    if (v === undefined) {
      const o = state.orders[l.order_id];
      v = o !== undefined && orderInEngine(state, o, now);
      memo.set(l.order_id, v);
    }
    if (!v) continue;
    const w = waiting.get(l.station_id);
    if (w === undefined) waiting.set(l.station_id, new Set([l.order_id]));
    else w.add(l.order_id);
    if (l.capped && l.stage === 'added' && l.fired_at === null) capped.add(l.station_id);
  }
  return ids.map((sid) => ({
    station_id: sid,
    pressure_bp: pressureBp(profiles[sid]!, effectiveCapacity(state.stations[sid]!), pressureWindowOf(state, sid), now),
    waiting: waiting.get(sid)?.size ?? 0,
    capped: capped.has(sid),
  }));
}

// §6.1g: pure; the same result twice. A key is due when now ≥ slip_due[key]: an open alert's key is listed in
// `resolved` (closed `done`; resolved_at set, or BF-4 every unresolved order out of the engine), any other due key
// gives one slip item (§3.8 one per table key). Keys and stations in id order.
export function getAlertIntents(state: EngineState, now: number): AlertIntents {
  const slips: AlertIntents['slips'] = [];
  const resolved: AlertIntents['resolved'] = [];
  const th = thresholdOf(state);
  const due = Object.keys(state.slip_due)
    .filter((k) => state.slip_due[k]! <= now)
    .sort(byId);
  if (due.length > 0 && th !== null) {
    const ctx = new Ctx(state);
    const byKey = ordersByKey(state, new Set(due));
    for (const key of due) {
      const slip = state.slips[key];
      if (slip !== undefined && slip.alert_id !== null) {
        resolved.push({ table_key: key, alert_id: slip.alert_id });
        continue;
      }
      const item = slipItem(ctx, key, byKey.get(key) ?? [], th, now);
      if (item !== null) slips.push(item);
    }
  }
  return { slips, resolved, overload: overloadItems(state, now) };
}

// §6.1g: state.next_alert_due_at; with `exclude` (the host's skipped keys, §3.8) the same minimum without those keys.
export function nextAlertDueAt(state: EngineState, exclude?: ReadonlySet<string>): number | null {
  if (exclude === undefined || exclude.size === 0) return state.next_alert_due_at;
  let min: number | null = null;
  for (const k in state.slip_due) {
    if (exclude.has(k)) continue;
    const v = state.slip_due[k]!;
    if (min === null || v < min) min = v;
  }
  return min;
}

// ---- §6.1m split send (D11, D12; task 15b) ----------------------------------------------------------------------------

// A line as goesWith reads it: ItemAdded.item_id (null for a line with no menu item) and ItemAdded.category_id.
export type GoesWithLine = { item_id: string | null; category_id: string };
// One row of 01a v2.1 A-13 `goes_with_links` as the config snapshot (schema 3) carries it in `goes_with[]`.
export type GoesWithLink = { source_kind: 'category' | 'item'; source_id: string; target_kind: 'category' | 'item'; target_id: string; excluded: boolean };

// D12: does lineB go with lineA (lineA released, lineB a candidate to pre-tick)? A row matches when its source is
// lineA's item (item rows) or category (category rows) and its target lineB's item or category. A-13: a category row is
// the category's default, an item row adds to it, and an item row with `excluded` removes a default.
// Proposed (implementer, overnight): the most specific matching row decides — item source over category source, then
// item target over category target (so an item's exclude of a whole category is undone for one item it adds back);
// on a tie an exclude wins. No matching row (nothing configured) → false.
export function goesWith(lineA: GoesWithLine, lineB: GoesWithLine, links: ReadonlyArray<GoesWithLink>): boolean {
  let best = -1;
  let ok = false;
  for (const l of links) {
    const src = l.source_kind === 'item' ? lineA.item_id !== null && l.source_id === lineA.item_id : l.source_id === lineA.category_id;
    if (!src) continue;
    const tgt = l.target_kind === 'item' ? lineB.item_id !== null && l.target_id === lineB.item_id : l.target_id === lineB.category_id;
    if (!tgt) continue;
    const rank = (l.source_kind === 'item' ? 2 : 0) + (l.target_kind === 'item' ? 1 : 0);
    if (rank > best) {
      best = rank;
      ok = !l.excluded;
    } else if (rank === best && l.excluded) {
      ok = false;
    }
  }
  return ok;
}

// The draft as the other engine drafts (tick.ts): no envelope ids or times; the host stamps them.
export type ItemsReleasedDraft = { stream_type: 'order'; stream_id: string; event_type: 'ItemsReleased'; schema_version: 1; payload: ItemsReleasedPayload };

// §3.8 / §6.1m: one ItemsReleased per order with work, in order_ids order (an absent order or one with nothing to send
// gives none): released = the order's done sync lines (go now, no hold), expedite = its open (added / cooking) sync
// lines that are ticked; lines in line_ids order. ticks.released narrows released to the ticked done lines.
// Proposed (implementer, overnight): the engine state carries no goes-with links (§3.11's EngineConfigApplied has no
// goes_with field) nor a line's item / category, so planRelease pre-ticks nothing by itself: the caller (the
// slip_warning apply, 02's table view) computes D12's pre-ticks with goesWith over the snapshot's goes_with and passes
// them as ticks.expedite; with no ticks nothing is expedited (D12: "none configured → none"). alert_id = the open
// slip alert of the order's table key (slips[table_key].alert_id), else null.
export function planRelease(state: EngineState, order_ids: string[], ticks?: { released?: string[]; expedite?: string[] }): ItemsReleasedDraft[] {
  const rel = ticks?.released === undefined ? null : new Set(ticks.released);
  const exp = new Set(ticks?.expedite ?? []);
  const out: ItemsReleasedDraft[] = [];
  const seen = new Set<string>();
  for (const order_id of order_ids) {
    if (seen.has(order_id)) continue;
    seen.add(order_id);
    const order = state.orders[order_id];
    if (order === undefined) continue;
    const released: string[] = [];
    const expedite: string[] = [];
    for (const id of order.line_ids) {
      const l = state.lines[id];
      if (l === undefined || isPlaceholder(l) || l.serve_mode !== 'sync') continue;
      if (l.stage === 'done') {
        if (rel === null || rel.has(id)) released.push(id);
      } else if ((l.stage === 'added' || l.stage === 'cooking') && exp.has(id)) {
        expedite.push(id);
      }
    }
    if (released.length + expedite.length === 0) continue;
    const alert_id = state.slips[order.table_key]?.alert_id ?? null;
    out.push({ stream_type: 'order', stream_id: order_id, event_type: 'ItemsReleased', schema_version: 1, payload: { order_id, alert_id, released, expedite } });
  }
  return out;
}
