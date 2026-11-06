// 03a §3.6.1 (the intents of one `fires` pass), the nextDueAt terms (BF-5) and §3.6.3 firesDue. Pure: every time is
// the caller's `now` / `t`; nothing here mutates its input (scratch states come from applyEvent, which copies).
//
// getTickIntents(state, now) returns the drafts of one pass in fold order (D44: one transaction, the host stamps the
// envelope and folds them in this order):
//   1. scheduled fires — every unfired line or batch load with fire_ms ≤ now: one FireDispatched { scheduled } per
//      (station, planned fire) for slot lines, one per load (load_id, every member, and the compatible lines it
//      pulls in; F §4.7 D14 / D17, capped per line by max_early_ms);
//   2. auto-fill (D16) — slot stations that are not FIFO, from frozen then hidden lines eligible at
//      now ≥ d − max_early_ms whose whole cook from now fits (Waada Guard: slack ≤ keep first by d, then the larger
//      w × waiting; EDF: by d): FireDispatched { early_fill };
//   3. single_tap (D60) — an inferred ItemStarted for each line fired in 1–2, each followed by its StockConsumed
//      drafts (§3.7 consume at Start, from stockEffects);
//   4. auto_done (D60) — an inferred ItemDone at started_at + prep + cook for each COOKING line past it;
//   5. overrun cascade (F §4.7 D42) — one ReservationsShifted { overrun } per station with an overrunning COOKING line
//      whose unfired bookings no longer fit, each shift quantised up to cascade_step_ms;
//   6. abandon (§3.3, §3.7) — StockReleased { abandoned } per draw of every line with a live reservation of an
//      abandoned order (lineReleases).
// Steps 2–5 read the state after the earlier steps' drafts (folded on a scratch state at now), so each step sees what
// the fold will see; in-flight lines are read only through liveProfiles (§3.3, the placement's occupancy).
//
// Every reader applies the exit predicate (§3.3): a line of an order out of the engine at now gives no intent.
// A line of an order still awaiting listed lines (AD-8) is never fired, and a load fires whole or not at all.
import type { EngineConfig, FireDispatchedPayload, ItemDonePayload, ItemStartedPayload, PosEvent, ReservationsShiftedPayload } from '@pos/events';
import { applyEvent } from './apply-event.js';
import { compatible, currentProgram, freshnessOf, joinLine, slotEnd, withMember, workOf, type WorkLoad } from './batch.js';
import { effectiveCapacity } from './capacity.js';
import { orderInEngine } from './lifecycle.js';
import { liveProfiles } from './live.js';
import { bookingAt, type Booking } from './overload.js';
import { addInterval, earliestFit, occupancy, removeInterval } from './profile.js';
import { combine, stationPolicy, weightOf } from './replan.js';
import type { EngineLine, EngineOrder, EngineState, Load, Profile, StationRuntime } from './state.js';
import { lineReleases, stockEffects, type StockConsumedDraft, type StockReleasedDraft } from './stock.js';

// Engine drafts (as StockReservedDraft, task 12): the event-specific part only, no ids or times in the envelope; the
// host stamps event_id, seq, occurred_at / recorded_at (the pass's now), actor and device. Proposed (implementer,
// overnight): interfaces.md types the result EventDraft[], whose occurred_at / actor_id / device_id the engine does
// not know (same reading as reserveStock / stockEffects).
export type FireDispatchedDraft = { stream_type: 'station'; stream_id: string; event_type: 'FireDispatched'; schema_version: 1; payload: FireDispatchedPayload };
export type ItemStartedDraft = { stream_type: 'order'; stream_id: string; event_type: 'ItemStarted'; schema_version: 1; payload: ItemStartedPayload };
export type ItemDoneDraft = { stream_type: 'order'; stream_id: string; event_type: 'ItemDone'; schema_version: 1; payload: ItemDonePayload };
export type ReservationsShiftedDraft = {
  stream_type: 'station';
  stream_id: string;
  event_type: 'ReservationsShifted';
  schema_version: 1;
  payload: ReservationsShiftedPayload;
};
export type TickDraft = FireDispatchedDraft | ItemStartedDraft | StockConsumedDraft | ItemDoneDraft | ReservationsShiftedDraft | StockReleasedDraft;

type StationCfg = EngineConfig['stations'][number];

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function configOf(state: EngineState, station_id: string): StationCfg | undefined {
  return state.config?.stations.find((s) => s.station_id === station_id);
}

// ---- readiness ---------------------------------------------------------------------------------------------------

// An unfired, placed line the tick may fire: in its station's `unfired` (placed), stage added, never fired, its order
// present and not awaiting listed lines (AD-8: the FireDispatched fold refuses those). An unfired line keeps its order
// in the engine (§3.3), so the exit predicate needs no check here.
function ready(state: EngineState, line: EngineLine | undefined): line is EngineLine {
  if (line === undefined || line.stage !== 'added' || line.fired_at !== null || line.fire_ms === null) return false;
  const order = state.orders[line.order_id];
  return order !== undefined && order.awaiting === 0;
}

// The stored load a line is a member of, if any.
function loadOf(station: StationRuntime, line: EngineLine): Load | undefined {
  const load = line.load_id === null ? undefined : station.loads[line.load_id];
  return load !== undefined && load.order_item_ids.includes(line.order_item_id) ? load : undefined;
}

function loadReady(state: EngineState, load: Load): boolean {
  return load.order_item_ids.every((id) => ready(state, state.lines[id]));
}

// ---- step 1: scheduled fires -------------------------------------------------------------------------------------

type Fire = { station_id: string; ids: string[]; load_id: string | null; due_at: number; reason: 'scheduled' | 'early_fill' };

function fireDraft(f: Fire): FireDispatchedDraft {
  return {
    stream_type: 'station',
    stream_id: f.station_id,
    event_type: 'FireDispatched',
    schema_version: 1,
    payload: { station_id: f.station_id, order_item_ids: f.ids, load_id: f.load_id, due_at: f.due_at, reason: f.reason },
  };
}

// A firing load pulls in compatible unfired lines of its station whose target lies within the freshness window
// (§3.6.1 item 1; F §4.7 D14 / D17), capped per line by max_early_ms — the join rule of placement (batch.ts
// compatible + the sync window: b.end ≤ E ∧ E − b.end ≤ min(window, max_early_ms)), read at now. Candidates in
// (E, order_item_id) order while the load has room. A pulled-in line leaves its own load at the fold (task 13), so a
// load is never fired in part: only lines that are not due with their own load this pass are taken.
// Proposed (implementer, overnight) P1: frozen as well as hidden lines may be pulled in (auto-fill, D16, fires frozen
// lines early too); the line's slot end E = slotEnd (its AD-12 deadline + prep + cook).
function pullIns(state: EngineState, station: StationRuntime, load: Load, taken: ReadonlySet<string>, now: number): string[] {
  const cap = effectiveCapacity(station);
  const window = freshnessOf(state, station.station_id);
  let b: WorkLoad = workOf(state, load);
  const cands: Array<{ line: EngineLine; E: number }> = [];
  for (const id of station.unfired) {
    const line = state.lines[id];
    if (taken.has(id) || !ready(state, line) || currentProgram(line) !== load.program_id) continue;
    const E = slotEnd(line, cap);
    if (load.booked.end <= E && E - load.booked.end <= Math.min(window, line.max_early_ms)) cands.push({ line, E });
  }
  cands.sort((x, y) => x.E - y.E || byId(x.line.order_item_id, y.line.order_item_id));
  const out: string[] = [];
  for (const { line } of cands) {
    const L = joinLine(line);
    if (!compatible(b, L, cap, now)) continue;
    b = withMember(b, L);
    out.push(line.order_item_id);
  }
  return out;
}

function scheduledFires(state: EngineState, now: number): Fire[] {
  const out: Fire[] = [];
  for (const sid of Object.keys(state.stations).sort()) {
    const station = state.stations[sid]!;
    const slot = new Map<number, string[]>();
    const loads = new Map<string, Load>();
    for (const id of station.unfired) {
      const line = state.lines[id];
      if (!ready(state, line) || line.fire_ms! > now) continue;
      const load = loadOf(station, line);
      if (load !== undefined) {
        if (load.fire_ms <= now) loads.set(load.load_id, load);
        continue;
      }
      const list = slot.get(line.fire_ms!);
      if (list === undefined) slot.set(line.fire_ms!, [id]);
      else list.push(id);
    }
    const fires: Fire[] = [...slot].map(([due_at, ids]) => ({ station_id: sid, ids: [...ids].sort(byId), load_id: null, due_at, reason: 'scheduled' }));
    const due = [...loads.values()].filter((l) => loadReady(state, l)).sort((a, b) => a.fire_ms - b.fire_ms || byId(a.load_id, b.load_id));
    const taken = new Set<string>([...fires.flatMap((f) => f.ids), ...due.flatMap((l) => l.order_item_ids)]);
    for (const load of due) {
      const pulled = pullIns(state, station, load, taken, now);
      for (const id of pulled) taken.add(id);
      fires.push({ station_id: sid, ids: [...load.order_item_ids, ...pulled].sort(byId), load_id: load.load_id, due_at: load.fire_ms, reason: 'scheduled' });
    }
    fires.sort((a, b) => a.due_at - b.due_at || byId(a.ids[0]!, b.ids[0]!));
    out.push(...fires);
  }
  return out;
}

// ---- scratch folds -----------------------------------------------------------------------------------------------

// The drafts as the host will fold them (recorded_at = now), on a scratch copy; non-strict, so a scratch fold never
// stops the pass (its diagnostics stay on the scratch state).
function scratch(state: EngineState, drafts: readonly TickDraft[], now: number): EngineState {
  let s = state;
  for (const d of drafts) {
    const event: PosEvent = {
      event_id: 'tick',
      tenant_id: '',
      branch_id: '',
      stream_type: d.stream_type,
      stream_id: d.stream_id,
      event_type: d.event_type,
      schema_version: d.schema_version,
      payload: d.payload as unknown as Record<string, unknown>,
      occurred_at: now,
      recorded_at: now,
      actor_id: null,
      device_id: '',
      seq: 0,
    };
    s = applyEvent(s, event, { strict: false });
  }
  return s;
}

// ---- one read of a state ----------------------------------------------------------------------------------------

// What the steps read of one state, gathered once: the COOKING lines per station (one pass over the lines), the
// planned reservations per station, the live profiles of every station at an instant (one liveProfiles read per
// instant, cached) and the exit predicate per (order, instant). Keeps a pass linear in the lines (§7.1), and the
// nextDueAt search from re-reading every line for every candidate instant.
type Ctx = {
  state: EngineState;
  ids: string[];
  cooking: Map<string, EngineLine[]>;
  reservations: Map<string, Reservation[]>;
  live: Map<number, Record<string, Profile>>;
  memo: Map<number, Map<string, boolean>>;
  step: number | null;
};

function ctxOf(state: EngineState): Ctx {
  const cooking = new Map<string, EngineLine[]>();
  for (const id in state.lines) {
    const l = state.lines[id]!;
    if (l.stage !== 'cooking') continue;
    const list = cooking.get(l.station_id);
    if (list === undefined) cooking.set(l.station_id, [l]);
    else list.push(l);
  }
  const step = state.config?.settings.cascade_step_ms;
  return {
    state,
    ids: Object.keys(state.stations).sort(),
    cooking,
    reservations: new Map(),
    live: new Map(),
    memo: new Map(),
    step: step === undefined || !(step >= 1) ? null : step,
  };
}

function liveAt(c: Ctx, t: number): Record<string, Profile> {
  let v = c.live.get(t);
  if (v === undefined) {
    v = liveProfiles(c.state, c.ids, t);
    c.live.set(t, v);
  }
  return v;
}

function inEngineAt(c: Ctx, order_id: string, t: number): boolean {
  let m = c.memo.get(t);
  if (m === undefined) {
    m = new Map();
    c.memo.set(t, m);
  }
  let v = m.get(order_id);
  if (v === undefined) {
    const order = c.state.orders[order_id];
    v = order !== undefined && orderInEngine(c.state, order, t);
    m.set(order_id, v);
  }
  return v;
}

// The COOKING lines of a station whose order is in the engine at t.
function cookingAt(c: Ctx, station_id: string, t: number): EngineLine[] {
  return (c.cooking.get(station_id) ?? []).filter((l) => inEngineAt(c, l.order_id, t));
}

// A planned (unfired) reservation of the station: a slot line's booking or a load's, in start order.
type Reservation = { key: string; ids: string[]; booked: Booking };

function reservationsOf(c: Ctx, station: StationRuntime): Reservation[] {
  const cached = c.reservations.get(station.station_id);
  if (cached !== undefined) return cached;
  const out: Reservation[] = [];
  for (const id of station.unfired) {
    const line = c.state.lines[id];
    if (line !== undefined && line.booked !== null && loadOf(station, line) === undefined) out.push({ key: id, ids: [id], booked: line.booked });
  }
  for (const load of Object.values(station.loads)) out.push({ key: load.load_id, ids: [...load.order_item_ids].sort(byId), booked: load.booked });
  out.sort((a, b) => a.booked.start - b.booked.start || a.booked.end - b.booked.end || byId(a.key, b.key));
  c.reservations.set(station.station_id, out);
  return out;
}

// ---- step 2: auto-fill (D16) -------------------------------------------------------------------------------------

// Units in use at the instant x.
function unitsAt(p: Profile, x: number): number {
  let lo = 0;
  let hi = p.t.length - 1;
  let u = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (p.t[mid]! <= x) {
      u = p.u[mid]!;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return u;
}

// A slot station auto-fill may use: not FIFO (FIFO fires at once, §3.6.1), a valid capacity.
function fills(state: EngineState, station: StationRuntime): boolean {
  return station.type === 'slot' && stationPolicy(state, station.station_id).policy !== 'fifo' && effectiveCapacity(station) >= 1;
}

// The auto-fill candidates of a slot station at now: placed (booked), not yet due, eligible at now ≥ d − max_early_ms.
function fillCandidates(state: EngineState, station: StationRuntime, now: number): EngineLine[] {
  const out: EngineLine[] = [];
  for (const id of station.unfired) {
    const line = state.lines[id];
    if (!ready(state, line) || line.booked === null || line.fire_ms! <= now) continue;
    if (now >= line.deadline_ms - line.max_early_ms) out.push(line);
  }
  return out;
}

// §3.6.1 item 2 order: frozen before hidden; Waada Guard — slack (d − fire) ≤ keep first by d, then the larger
// w × waiting (waiting = now − placed_at, as pass 1's ties, §3.5.4); EDF — by d; ties by order_item_id.
function fillOrder(state: EngineState, lines: EngineLine[], now: number, pol: ReturnType<typeof stationPolicy>): EngineLine[] {
  const key = (l: EngineLine) => {
    const frozen = l.fire_ms! <= now + pol.freeze_ms ? 0 : 1;
    if (pol.policy === 'edf') return { frozen, urgent: 0, d: l.deadline_ms, w: 0 };
    const urgent = l.deadline_ms - l.fire_ms! <= pol.keep_ms ? 0 : 1;
    const waited = now - (state.orders[l.order_id]?.placed_at ?? now);
    return { frozen, urgent, d: urgent === 0 ? l.deadline_ms : 0, w: urgent === 0 ? 0 : -weightOf(state, l) * waited };
  };
  const keys = new Map(lines.map((l) => [l.order_item_id, key(l)]));
  return [...lines].sort((a, b) => {
    const x = keys.get(a.order_item_id)!;
    const y = keys.get(b.order_item_id)!;
    return x.frozen - y.frozen || x.urgent - y.urgent || x.d - y.d || x.w - y.w || byId(a.order_item_id, b.order_item_id);
  });
}

// The lines auto-fill fires on one station at now, against W = the station's live profile at now (planned bookings
// plus the in-flight lines' live intervals, §3.3 — the occupancy placement reads) after step 1. A candidate fits when,
// with its own planned booking taken off, its occupancy from now [now + prep, now + prep + cook) fits within effective
// capacity; it is then booked there in W for the next candidate. "Idle units now": stops once every unit is in use at
// now. Proposed (implementer, overnight) A1: the fit is checked against the other lines' planned bookings too, so an
// early fill never takes a unit a frozen or hidden line is booked on (no over-booking; the line keeps its own
// booking's capacity only).
function fillStation(c: Ctx, station: StationRuntime, now: number): EngineLine[] {
  if (!fills(c.state, station)) return [];
  const cands = fillCandidates(c.state, station, now);
  if (cands.length === 0) return [];
  const cap = effectiveCapacity(station);
  let W = liveAt(c, now)[station.station_id]!;
  if (unitsAt(W, now) >= cap) return [];
  const out: EngineLine[] = [];
  for (const line of fillOrder(c.state, cands, now, stationPolicy(c.state, station.station_id))) {
    if (unitsAt(W, now) >= cap) break;
    const booked = line.booked!;
    const without = removeInterval(W, booked, booked.units, () => {});
    if (earliestFit(without, now, line.prep_ms, line.cook_ms, line.units, cap) !== now) continue;
    const b = bookingAt(line, cap, now);
    W = addInterval(without, b, b.units);
    out.push(line);
  }
  return out;
}

function autoFill(c: Ctx, now: number): Fire[] {
  const out: Fire[] = [];
  for (const sid of c.ids) {
    const byDue = new Map<number, string[]>();
    for (const l of fillStation(c, c.state.stations[sid]!, now)) byDue.set(l.fire_ms!, [...(byDue.get(l.fire_ms!) ?? []), l.order_item_id]);
    for (const due_at of [...byDue.keys()].sort((a, b) => a - b)) out.push({ station_id: sid, ids: byDue.get(due_at)!.sort(byId), load_id: null, due_at, reason: 'early_fill' });
  }
  return out;
}

// ---- steps 3–4: inferred completion (D60) ------------------------------------------------------------------------

function completionMode(state: EngineState, station_id: string): StationCfg['completion_mode'] {
  return configOf(state, station_id)?.completion_mode ?? 'two_tap';
}

// The cook a COOKING line occupies its station for at effective capacity (live.ts: AD-4 rounds on a slot station; a
// batch line as its whole load, max(units, cap)).
function occupancyCook(station: StationRuntime, line: EngineLine): number {
  const cap = Math.max(1, effectiveCapacity(station));
  return station.type === 'batch' ? occupancy(Math.max(line.units, cap), cap, line.cook_ms).cook_ms : occupancy(line.units, cap, line.cook_ms).cook_ms;
}

// The planned end of a COOKING line: started_at + prep + cook (F §4.7 D60 doneAt; D33 planned_endsAt).
function plannedEnd(state: EngineState, line: EngineLine): number | null {
  const station = state.stations[line.station_id];
  if (station === undefined || line.started_at === null) return null;
  return line.started_at + line.prep_ms + occupancyCook(station, line);
}

function inferredStarts(state: EngineState, fired: readonly Fire[], now: number): Array<ItemStartedDraft | StockConsumedDraft> {
  const out: Array<ItemStartedDraft | StockConsumedDraft> = [];
  for (const f of fired) {
    if (completionMode(state, f.station_id) !== 'single_tap') continue;
    for (const id of f.ids) {
      const line = state.lines[id];
      if (line === undefined) continue;
      // Proposed (implementer, overnight) I1: started_at = the dispatch time, the pass's now (F §4.7 completion table:
      // "inferred when FireDispatched is committed (started_at = dispatch time)"; the TickIntent sketch's
      // `startedAt: dueAt` would start a missed fire in the past, and the fold takes min(started_at, recorded_at)).
      const draft: ItemStartedDraft = {
        stream_type: 'order',
        stream_id: line.order_id,
        event_type: 'ItemStarted',
        schema_version: 1,
        payload: { order_item_id: id, started_at: now, source: 'inferred' },
      };
      // §3.7 consume (P-5): "appended with the start (… the tick's inferred start)", one per draw with reserved > 0.
      const consumes = stockEffects(state, { event_type: 'ItemStarted', payload: draft.payload as unknown as Record<string, unknown>, occurred_at: now });
      out.push(draft, ...(consumes as StockConsumedDraft[]));
    }
  }
  return out;
}

// An auto_done COOKING line's inferred Done time (its planned end), when its order is in the engine at max(t, end).
function doneDue(c: Ctx, line: EngineLine, t: number): number | null {
  if (line.stage !== 'cooking' || completionMode(c.state, line.station_id) !== 'auto_done') return null;
  const end = plannedEnd(c.state, line);
  if (end === null || !inEngineAt(c, line.order_id, Math.max(t, end))) return null;
  return end;
}

function inferredDones(c: Ctx, now: number): ItemDoneDraft[] {
  const due: Array<{ line: EngineLine; end: number }> = [];
  for (const list of c.cooking.values()) {
    for (const line of list) {
      const end = doneDue(c, line, now);
      if (end !== null && end <= now) due.push({ line, end });
    }
  }
  due.sort((a, b) => a.end - b.end || byId(a.line.order_item_id, b.line.order_item_id));
  return due.map(({ line, end }) => ({
    stream_type: 'order',
    stream_id: line.order_id,
    event_type: 'ItemDone',
    schema_version: 1,
    payload: { order_item_id: line.order_item_id, done_at: end, source: 'inferred' },
  }));
}

// ---- step 5: overrun cascade (F §4.7 D42) ------------------------------------------------------------------------

// F §4.7 D42 at t on one station: active only while a COOKING line overruns (t > its planned end; live end
// max(planned end, t), D33). Base = the in-flight lines' live intervals at t (COOKING lines and the packed
// fired-not-started lines, §3.3 — what every placement reads); then each planned reservation in start order: when it
// no longer fits beside the base and the reservations already taken, it is delayed by the smallest delay that fits,
// rounded up to whole cascade steps (re-checked after the rounding), and the later ones are checked against it. A
// load moves whole (one delay for every member).
// Proposed (implementer, overnight) C1: only unfired reservations (a stored planned booking) are shifted; a fired,
// not started line moves by the packing (F-20, §3.3: "the packing slides with t until ItemStarted fixes each line"),
// so it is never listed — listing it would move it twice once its fold lands.
function cascadeAt(c: Ctx, station: StationRuntime, t: number): ReservationsShiftedPayload['shifts'] {
  const step = c.step;
  if (step === null) return [];
  const cap = effectiveCapacity(station);
  if (!(cap >= 1)) return [];
  if (!cookingAt(c, station.station_id, t).some((l) => t > (plannedEnd(c.state, l) ?? Infinity))) return [];
  const reservations = reservationsOf(c, station);
  if (reservations.length === 0) return [];
  let work = combine(liveAt(c, t)[station.station_id]!, station.profile, -1, () => {});
  const shifts: ReservationsShiftedPayload['shifts'] = [];
  for (const r of reservations) {
    const len = r.booked.end - r.booked.start;
    let by = 0;
    for (;;) {
      const f = earliestFit(work, r.booked.start + by, 0, len, r.booked.units, cap);
      if (f === r.booked.start + by) break;
      by = Math.ceil((f - r.booked.start) / step) * step;
    }
    work = addInterval(work, { start: r.booked.start + by, end: r.booked.end + by }, r.booked.units);
    if (by > 0) for (const id of r.ids) shifts.push({ order_item_id: id, by_ms: by });
  }
  return shifts;
}

function cascades(c: Ctx, now: number): ReservationsShiftedDraft[] {
  const out: ReservationsShiftedDraft[] = [];
  for (const sid of c.ids) {
    const shifts = cascadeAt(c, c.state.stations[sid]!, now);
    if (shifts.length > 0) {
      out.push({ stream_type: 'station', stream_id: sid, event_type: 'ReservationsShifted', schema_version: 1, payload: { station_id: sid, cause: 'overrun', shifts } });
    }
  }
  return out;
}

// ---- step 6: abandoned reservations (§3.3, §3.7) -----------------------------------------------------------------

// §3.3 abandoned at t, through the exit predicate itself with the served rule set aside (an order is abandoned
// whether or not its served clock has also run out).
function abandonedAt(state: EngineState, order: EngineOrder, t: number): boolean {
  return order.awaiting === 0 && !orderInEngine(state, order.last_served_at === null ? order : { ...order, last_served_at: null }, t);
}

function holders(state: EngineState, order: EngineOrder): EngineLine[] {
  const out: EngineLine[] = [];
  for (const id of order.line_ids) {
    const l = state.lines[id];
    if (l !== undefined && l.reserved_seq !== null) out.push(l);
  }
  return out;
}

function abandonReleases(state: EngineState, now: number): StockReleasedDraft[] {
  const out: StockReleasedDraft[] = [];
  for (const oid of Object.keys(state.orders).sort(byId)) {
    const order = state.orders[oid]!;
    const held = holders(state, order);
    if (held.length > 0 && abandonedAt(state, order, now)) for (const l of held) out.push(...lineReleases(l, 'abandoned'));
  }
  return out;
}

// The earliest t at which an order holding a live reservation is abandoned, or null (an unfired line, a listed line
// not seen yet, or no config: never by time alone). AD-13: t ≥ max(last_line_fold_at + order_abandon_ms, latest
// planned land); found from the predicate itself (monotone in t), so there is no second copy of the planned-land rule.
function abandonTime(state: EngineState, order: EngineOrder): number | null {
  const ms = state.config?.settings.order_abandon_ms;
  if (ms === undefined || order.awaiting > 0 || holders(state, order).length === 0) return null;
  for (const id of order.line_ids) {
    const l = state.lines[id];
    if (l !== undefined && l.stage === 'added' && l.fired_at === null) return null;
  }
  const lo = order.last_line_fold_at + ms;
  if (abandonedAt(state, order, lo)) return lo;
  let span = 1;
  while (!abandonedAt(state, order, lo + span)) {
    span *= 2;
    if (span > 2 ** 46) return null;
  }
  let a = lo + span / 2; // not abandoned
  let b = lo + span; // abandoned
  while (b - a > 1) {
    const m = a + Math.floor((b - a) / 2);
    if (abandonedAt(state, order, m)) b = m;
    else a = m;
  }
  return b;
}

// ---- getTickIntents ----------------------------------------------------------------------------------------------

// §3.6.1 / §6.1g: the intents of one `fires` pass at now, in fold order. Pure; the same result for the same
// (state, now) (F test 13). Never fires a fired line (D44): only lines with fired_at null are listed.
export function getTickIntents(state: EngineState, now: number): TickDraft[] {
  const scheduled = scheduledFires(state, now).map(fireDraft);
  const s1 = scheduled.length === 0 ? state : scratch(state, scheduled, now);
  const fills = autoFill(ctxOf(s1), now).map(fireDraft);
  const s2 = fills.length === 0 ? s1 : scratch(s1, fills, now);
  const fired: Fire[] = [...scheduled, ...fills].map((d) => ({
    station_id: d.payload.station_id,
    ids: d.payload.order_item_ids,
    load_id: d.payload.load_id,
    due_at: d.payload.due_at,
    reason: d.payload.reason as Fire['reason'],
  }));
  const starts = inferredStarts(s2, fired, now);
  const s3 = starts.length === 0 ? s2 : scratch(s2, starts.filter((d) => d.event_type === 'ItemStarted'), now);
  const dones = inferredDones(ctxOf(s3), now);
  const s4 = dones.length === 0 ? s3 : scratch(s3, dones, now);
  const shifts = cascades(ctxOf(s4), now);
  return [...scheduled, ...fills, ...starts, ...dones, ...shifts, ...abandonReleases(state, now)];
}

// ---- nextDueAt (BF-5) --------------------------------------------------------------------------------------------

// The exact terms: the earliest planned fire of a fireable line or load, the earliest inferred Done, the earliest
// abandon time of an order holding a live reservation. Each yields an intent at its own value and at every later t
// (a fire stays due until folded; out of the engine is monotone in t).
function exactBound(c: Ctx, t: number): number {
  const state = c.state;
  let bound = Number.POSITIVE_INFINITY;
  for (const sid of c.ids) {
    const station = state.stations[sid]!;
    for (const id of station.unfired) {
      const line = state.lines[id];
      if (!ready(state, line) || line.fire_ms! >= bound) continue;
      const load = loadOf(station, line);
      if (load !== undefined && !loadReady(state, load)) continue;
      bound = load === undefined ? line.fire_ms! : load.fire_ms;
    }
  }
  for (const list of c.cooking.values()) {
    for (const line of list) {
      const end = doneDue(c, line, t);
      if (end !== null && end < bound) bound = end;
    }
  }
  for (const oid in state.orders) {
    const a = abandonTime(state, state.orders[oid]!);
    if (a !== null && a < bound) bound = a;
  }
  return bound;
}

// The instants in [t, before) at which an auto-fill or cascade intent may begin on one station, ascending: t itself;
// an eligibility d − max_early_ms; the end of another planned booking, minus the candidate's prep (a window opens);
// the first ms of an overrun (planned end + 1); the first ms an overrunning or packed fired line's live end passes a
// planned reservation's start (a line packed behind an overrun slides with t). Each is checked with the pass's own
// rules, so a value nextDueAt returns always has an intent.
// Proposed (implementer, overnight) N1: between these instants the in-flight lines slide with t, so a window could in
// principle open at an instant not listed; the fires tick evaluates nextDueAt at every pass's now, which is always a
// candidate, so such an intent is found at the first pass that sees it (≤ 500 ms) and is never missed.
function softCandidates(c: Ctx, station: StationRuntime, t: number, before: number): number[] {
  const state = c.state;
  const out = new Set<number>([t]);
  const add = (x: number): void => {
    if (x > t && x < before) out.add(x);
  };
  const reservations = reservationsOf(c, station);
  if (fills(state, station)) {
    for (const id of station.unfired) {
      const line = state.lines[id];
      if (!ready(state, line) || line.booked === null) continue;
      const e = line.deadline_ms - line.max_early_ms;
      if (e >= line.fire_ms! || line.fire_ms! <= t) continue; // eligible only before its own fire
      add(e);
      for (const r of reservations) if (r.key !== id && r.booked.end - line.prep_ms > e) add(r.booked.end - line.prep_ms);
    }
  }
  if (c.step !== null && reservations.length > 0) {
    const ends = (c.cooking.get(station.station_id) ?? []).map((l) => plannedEnd(state, l)).filter((e): e is number => e !== null);
    if (ends.length > 0) {
      for (const e of ends) add(e + 1);
      for (const r of reservations) add(r.booked.start + 1);
      const first = Math.max(t, Math.min(...ends) + 1);
      if (first < before) {
        const pack = combine(liveAt(c, first)[station.station_id]!, station.profile, -1, () => {});
        for (let i = 1; i < pack.t.length; i++) {
          if (pack.u[i]! >= pack.u[i - 1]!) continue;
          for (const r of reservations) add(first + (r.booked.start - pack.t[i]!) + 1);
        }
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}

// BF-5: the earliest t' at which getTickIntents(state, t') has an intent, or null (an idle kitchen); a value ≤ t means
// due now. The overrun term exists only while an overrunning line's live end pushes into a later unstarted
// reservation (never its planned end, which yields no intent); §3.3: a line of an order out of the engine at the
// term's time counts for nothing. Property (test 62): getTickIntents(state, nextDueAt(state, t)) is non-empty, and
// nextDueAt(state, t) ≤ t exactly when getTickIntents(state, t) is non-empty.
export function nextDueAt(state: EngineState, t: number): number | null {
  const c = ctxOf(state);
  let best = exactBound(c, t);
  if (best <= t) return best;
  // Below the exact bound no line is due to fire or be done and no order is abandoned, so a pass there is auto-fill
  // and the cascade on this state, station by station.
  for (const sid of c.ids) {
    const station = state.stations[sid]!;
    for (const at of softCandidates(c, station, t, best)) {
      if (at >= best) break;
      if (fillStation(c, station, at).length > 0 || cascadeAt(c, station, at).length > 0) {
        best = at;
        break;
      }
    }
  }
  return best === Number.POSITIVE_INFINITY ? null : best;
}

// ---- firesDue (§3.6.3) -------------------------------------------------------------------------------------------

// The `fires` tick's due: intents_due = now ≥ nextDueAt(state, now); crossed = the stations with an unfired line
// whose fire_ms − freeze_ms lies in (last_pass_ms, now] (it entered Next since the last pass), sorted.
export function firesDue(state: EngineState, last_pass_ms: number, now: number): { intents_due: boolean; crossed: string[] } {
  const crossed: string[] = [];
  for (const sid of Object.keys(state.stations).sort()) {
    const station = state.stations[sid]!;
    const freeze = stationPolicy(state, sid).freeze_ms;
    for (const id of station.unfired) {
      const line = state.lines[id];
      if (line === undefined || line.fire_ms === null || line.stage !== 'added' || line.fired_at !== null) continue;
      const x = line.fire_ms - freeze;
      if (x > last_pass_ms && x <= now) {
        crossed.push(sid);
        break;
      }
    }
  }
  const due = nextDueAt(state, now);
  return { intents_due: due !== null && now >= due, crossed };
}
