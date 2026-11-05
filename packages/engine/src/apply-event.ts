import type { Unit } from '@pos/domain';
import type {
  EngineConfig,
  FireDispatchedPayload,
  ItemAddedPayload,
  ItemDonePayload,
  ItemReturnedPayload,
  ItemServedPayload,
  ItemStartedPayload,
  ItemVoidedPayload,
  OrderGroupPayload,
  OrderLinePayload,
  OrderLinesAddedLinePayload,
  OrderLinesAddedPayload,
  OrderPlacedPayload,
  PosEvent,
} from '@pos/events';
import { capacityFor } from './replan.js';
import { deadlineOf, InvalidEvent, isEngineLine, lineShape, lineUnits, planNewLines, replanEnded, type SequenceOptions } from './plan.js';
import { removeInterval, type Underflow } from './profile.js';
import type { DayDraws, Diagnostic, EngineLine, EngineOrder, EngineState, StationRuntime } from './state.js';
import { initialEngineState } from './state.js';
import { stockOf } from './stock.js';

// Payloads as validated by the @pos/events schemas (§4.2).
// StockSet / StockAdded v2 (01c V5): keyed by stock_item_id; parseEvent upcasts v1.
interface StockSet { stock_item_id: string; on_hand: number; unit: Unit }
interface StockAdded { stock_item_id: string; quantity: number; unit: Unit }
// BusinessDayOpened v2 (01c §5.3 row 3): parseEvent upcasts v1.
interface BusinessDayOpened { business_date: string; stock_units: Record<string, Unit>; draws: Record<string, DayDraws> }

const EMPTY_PROFILE = (): StationRuntime['profile'] => ({ t: [], u: [] });

// 03a §3.11: store the config; a StationRuntime per station (a new one with an empty profile). An existing
// station keeps capacity_override, paused, profile, unfired and loads; type and capacity come from the payload.
// Copy-on-write (§3.3): an unchanged station keeps its reference.
function applyEngineConfig(state: EngineState, config: EngineConfig): EngineState {
  const stations = { ...state.stations };
  for (const s of config.stations) {
    const prev = stations[s.station_id];
    if (prev === undefined) {
      stations[s.station_id] = {
        station_id: s.station_id,
        type: s.station_type,
        capacity: s.capacity,
        capacity_override: null,
        paused: false,
        profile: EMPTY_PROFILE(),
        unfired: [],
        loads: {},
      };
    } else if (prev.type !== s.station_type || prev.capacity !== s.capacity) {
      stations[s.station_id] = { ...prev, type: s.station_type, capacity: s.capacity };
    }
  }
  return { ...state, config, stations };
}

// §3.3 deterministic ids: group `order_id:n` → n.
function groupIndex(order_id: string, group_id: string): number {
  return Number(group_id.slice(order_id.length + 1));
}

// §3.5.1, §4.2: the listed lines of an OrderPlaced / OrderLinesAdded. A line of `lines[]` enters `lines` here
// with its OrderPlaced engine fields (the only place they are kept until its ItemAdded) and neutral values
// for the ItemAdded fields, which its ItemAdded fold fills; nothing is placed until awaiting reaches 0.
// line_ids keep order_item_ids order and list only the ids of `lines[]` (a deal line has no entry, §3.2).
// §3.8a: a return line (OrderLinesAdded `return_of` set) is listed as immediate, mark 'return', from_stock false,
// with its `fix` cook_ms_override kept in cook_ms until its ItemAdded; it must be alone in a new group (its own
// group, never the old one re-opened) and a `fix` must carry cook_ms_override — else InvalidEvent (AD-8: the
// event changes nothing when non-strict).
type ListedLine = OrderLinePayload & Partial<Pick<OrderLinesAddedLinePayload, 'return_of' | 'cook_ms_override'>>;
function listLines(
  state: EngineState,
  order: EngineOrder,
  p: { order_id: string; order_item_ids: string[]; groups: OrderGroupPayload[]; lines: ListedLine[] },
  recorded_at: number,
): EngineState {
  const groups = { ...order.groups };
  let next = order.next_group_index;
  for (const g of p.groups) {
    next = Math.max(next, groupIndex(p.order_id, g.group_id) + 1);
  }
  const byId = new Map(p.lines.map((l) => [l.order_item_id, l]));
  // A group lists only engine lines: an id with no lines[] entry (a deal, no station) is left out here, and a
  // listed id whose ItemAdded is not a line is removed by its ItemAdded fold.
  for (const g of p.groups) {
    groups[g.group_id] = { target_land_ms: g.target_land_ms, line_ids: g.order_item_ids.filter((id) => byId.has(id)) };
  }
  const listed = p.order_item_ids.filter((id) => byId.has(id));
  const lines = { ...state.lines };
  for (const id of listed) {
    const l = byId.get(id)!;
    const group = p.groups.find((g) => g.order_item_ids.includes(id));
    if (group === undefined) throw new InvalidEvent('line_in_no_group', id, l.station_id);
    const return_of = l.return_of ?? null;
    if (return_of !== null) {
      if (group.order_item_ids.length !== 1 || order.groups[group.group_id] !== undefined) throw new InvalidEvent('return_group_invalid', id, l.station_id);
      if (return_of.mode === 'fix' && (l.cook_ms_override ?? null) === null) throw new InvalidEvent('cook_ms_override_null', id, l.station_id);
    }
    lines[id] = {
      order_item_id: id,
      order_id: p.order_id,
      group_id: group.group_id,
      serve_mode: return_of === null ? 'sync' : 'immediate',
      station_id: l.station_id,
      alternates: l.alternates.map((a) => ({ ...a })),
      point_id: l.point_id,
      carry_ms: l.carry_ms,
      units: 0,
      prep_ms: 0,
      cook_ms: return_of?.mode === 'fix' ? l.cook_ms_override! : 0,
      full_cook_ms: 0,
      from_stock: return_of === null ? l.from_stock : false,
      program_id: null,
      stock_cook_ms: null,
      stock_program_id: null,
      draws: [],
      reserved_seq: null,
      weight_pct: l.weight_pct,
      max_early_ms: l.max_early_ms,
      max_late_ms: l.max_late_ms,
      max_carry_ms: l.max_carry_ms,
      stage: 'added',
      fire_ms: null,
      deadline_ms: group.target_land_ms,
      fired_at: null,
      started_at: null,
      done_at: null,
      mark: return_of === null ? null : 'return',
      return_of: return_of === null ? null : { ...return_of },
      load_id: null,
      booked: null,
    };
  }
  const updated: EngineOrder = {
    ...order,
    line_ids: [...order.line_ids, ...listed],
    awaiting: order.awaiting + p.order_item_ids.length,
    last_line_fold_at: recorded_at,
    next_group_index: next,
    groups,
  };
  return { ...state, orders: { ...state.orders, [p.order_id]: updated }, lines };
}

// §3.3, §4.2: placed_by = actor_id, placed_at = recorded_at; T and P per group copied, never recomputed
// (§3.5.1 step 6, P-2). The order's own target / promise are its latest group's (F §4.7: the order lands
// with its last item); an order with no group (no plannable line) takes recorded_at.
function foldOrderPlaced(state: EngineState, event: PosEvent): EngineState {
  const p = event.payload as unknown as OrderPlacedPayload;
  const at = event.recorded_at;
  const order: EngineOrder = {
    order_id: p.order_id,
    order_type: p.order_type,
    table_key: p.table_key,
    table_id: p.table_id,
    follow_up: p.follow_up,
    pickup_at_ms: p.pickup_at_ms,
    placed_at: at,
    placed_by: event.actor_id,
    target_land_ms: p.groups.length === 0 ? at : Math.max(...p.groups.map((g) => g.target_land_ms)),
    promise_ms: p.groups.length === 0 ? at : Math.max(...p.groups.map((g) => g.promise_ms)),
    boosted: false,
    line_ids: [],
    awaiting: 0,
    last_served_at: null,
    last_line_fold_at: at,
    next_group_index: 0,
    groups: {},
  };
  return listLines(state, order, p, at);
}

// §3.3, §4.2 (P-10): an addition to an order in the engine; an absent order is a bug and throws. The
// presence rules (removal step, last_served_at re-open) and return lines land in tasks 8b and 8a.
function foldOrderLinesAdded(state: EngineState, event: PosEvent): EngineState {
  const p = event.payload as unknown as OrderLinesAddedPayload;
  const order = state.orders[p.order_id];
  if (order === undefined) throw new Error(`OrderLinesAdded for order ${p.order_id}, which is not in the engine`);
  return listLines(state, order, p, event.recorded_at);
}

// AD-8: a placeholder from listLines not yet filled by its ItemAdded (a filled line has units ≥ 1).
function isPlaceholder(line: EngineLine): boolean {
  return line.units === 0 && line.fire_ms === null && line.booked === null;
}

// Removes a listed placeholder from lines, line_ids and its group (a deal / no-station ItemAdded, or a
// listed writer-bug line dropped when non-strict).
function dropListed(state: EngineState, order: EngineOrder, line: EngineLine): { state: EngineState; order: EngineOrder } {
  const lines = { ...state.lines };
  delete lines[line.order_item_id];
  const groups = { ...order.groups };
  const g = groups[line.group_id];
  if (g !== undefined) groups[line.group_id] = { ...g, line_ids: g.line_ids.filter((x) => x !== line.order_item_id) };
  return {
    state: { ...state, lines },
    order: { ...order, line_ids: order.line_ids.filter((x) => x !== line.order_item_id), groups },
  };
}

// The listed placeholder filled from its ItemAdded (§3.2 units, cook time, copies; §3.2 deadline from the
// stored group T). Throws InvalidEvent for a writer bug.
// §3.8a: a return line takes from ItemAdded only units, prep and the program copies; it stays immediate, never
// from stock, with no draw (draws []), cook = lineShape's; its return_of must name a served line of the order.
function fillLine(state: EngineState, order: EngineOrder, listed: EngineLine, p: ItemAddedPayload): EngineLine {
  const id = p.order_item_id;
  const station = state.stations[listed.station_id];
  if (station === undefined) throw new InvalidEvent('station_missing', id, listed.station_id);
  const ret = listed.return_of;
  if (ret !== null) {
    const served = state.lines[ret.order_item_id];
    if (served === undefined || served.order_id !== listed.order_id || served.stage !== 'served') {
      throw new InvalidEvent('return_of_not_served', id, listed.station_id);
    }
  }
  try {
    const shape = lineShape(p, { return_of: ret, cook_ms_override: ret?.mode === 'fix' ? listed.cook_ms : null }, station.type, listed.from_stock);
    const filled: EngineLine = {
      ...listed,
      ...shape,
      units: lineUnits(p),
      prep_ms: p.prep_buffer_ms ?? 0,
      program_id: p.program_id,
      stock_program_id: p.stock_program_id,
      draws: ret !== null ? [] : p.stock_draws.map((d) => ({ stock_item_id: d.stock_item_id, quantity: d.quantity, reserved: 0 })),
    };
    // The unqueued deadline (AD-4 occupancy); the placement at awaiting = 0 replaces it with the queued one (AD-12).
    return { ...filled, deadline_ms: deadlineOf(filled, order.groups[listed.group_id]!.target_land_ms, capacityFor(station, id)) };
  } catch (e) {
    if (e instanceof InvalidEvent) throw new InvalidEvent(e.reason, id, listed.station_id);
    throw e;
  }
}

// §3.2, §3.5.1: fills the listed line from its ItemAdded, or drops a deal / no-station entry; decrements
// awaiting; at 0 the batch's lines are placed (planNewLines). An absent order is a no-op (§3.3 absent ids).
// AD-6 (task 6 review ruling): an ItemAdded that is not listed (no placeholder: unknown id, a duplicate of a
// filled line, or awaiting already 0) throws line_not_listed. A listed line that is a writer bug throws when
// strict; non-strict it is dropped, still counts against awaiting and gets one invalid_event diagnostic, so
// the order's other lines are still planned.
function foldItemAdded(state: EngineState, event: PosEvent, o: SequenceOptions): EngineState {
  const strict = o.strict;
  const p = event.payload as unknown as ItemAddedPayload;
  const order = state.orders[p.order_id];
  if (order === undefined) return state;
  const id = p.order_item_id;
  const found = state.lines[id];
  const listed = found !== undefined && found.order_id === p.order_id && isPlaceholder(found) ? found : undefined;
  let next: EngineState = state;
  let updated: EngineOrder = order;
  if (isEngineLine(p)) {
    if (listed === undefined || order.awaiting === 0) throw new InvalidEvent('line_not_listed', id);
    try {
      next = { ...state, lines: { ...state.lines, [id]: fillLine(state, order, listed, p) } };
    } catch (e) {
      if (strict || !(e instanceof InvalidEvent)) throw e;
      ({ state: next, order: updated } = dropListed(state, order, listed));
      next = addDiagnostic(next, invalidEventDiagnostic(event, e));
    }
  } else {
    if (order.awaiting === 0) return state;
    // 01c §3.4.7: a deal line (or a line with no station) is never a line, even when lines[] listed it.
    if (listed !== undefined) ({ state: next, order: updated } = dropListed(state, order, listed));
  }
  updated = { ...updated, awaiting: order.awaiting - 1, last_line_fold_at: event.recorded_at };
  next = { ...next, orders: { ...next.orders, [p.order_id]: updated } };
  // §3.5.3: the one re-plan per station of the batch runs here (pass 1 → immediate → sync), at recorded_at.
  return updated.awaiting === 0 ? planNewLines(next, p.order_id, event.recorded_at, event.event_id, o) : next;
}

// ---- §3.4 stage folds (stage only; their stock effects are task 12) -------------------------------------------

// The line a stage event names, or undefined when it is not in the state or is still a placeholder (§3.3 absent
// ids: a no-op; AD-8 reader rule: a placeholder is not yet a line).
function lineOf(state: EngineState, order_item_id: string): EngineLine | undefined {
  const line = state.lines[order_item_id];
  return line === undefined || isPlaceholder(line) ? undefined : line;
}

// AD-7: takes a line off its station's planned profile, removing exactly `booked` and clearing it, and drops it
// from `unfired`. AD-6: strict → removeInterval throws on an underflow; non-strict → it clamps and the fold
// appends a 'profile_underflow' diagnostic. A line with nothing booked and not in unfired returns state itself.
function unbook(state: EngineState, line: EngineLine, event: PosEvent, strict: boolean): EngineState {
  const station = state.stations[line.station_id];
  if (station === undefined) return state;
  const id = line.order_item_id;
  const inUnfired = station.unfired.includes(id);
  if (line.booked === null && !inUnfired) return state;
  let underflow: Underflow | null = null;
  let profile = station.profile;
  if (line.booked !== null) {
    profile = strict
      ? removeInterval(profile, line.booked, line.booked.units)
      : removeInterval(profile, line.booked, line.booked.units, (u) => {
          underflow = u;
        });
  }
  const next: EngineState = {
    ...state,
    stations: { ...state.stations, [station.station_id]: { ...station, profile, unfired: inUnfired ? station.unfired.filter((x) => x !== id) : station.unfired } },
    lines: { ...state.lines, [id]: { ...line, booked: null } },
  };
  if (underflow === null) return next;
  const { at, deficit } = underflow as Underflow;
  return addDiagnostic(next, { kind: 'profile_underflow', event_id: event.event_id, station_id: station.station_id, detail: { order_item_id: id, at, deficit } });
}

function patchLine(state: EngineState, id: string, patch: Partial<EngineLine>): EngineState {
  return { ...state, lines: { ...state.lines, [id]: { ...state.lines[id]!, ...patch } } };
}

// A line leaves the planned profile and takes `stage` (and the other fields of `patch`).
function moveLine(state: EngineState, line: EngineLine, event: PosEvent, strict: boolean, patch: Partial<EngineLine>): EngineState {
  return patchLine(unbook(state, line, event, strict), line.order_item_id, patch);
}

// §3.4 FireDispatched: each listed line that is unfired gets fired_at = recorded_at and the event's load_id
// (§3.3: the load name is fixed here) and fire_ms = min(fire_ms, recorded_at) (AD-9); its planned booking leaves the profile and it leaves unfired, so from
// now on it occupies its packed live interval (§3.3). A fired line is never fired twice: a listed line already
// fired, started or ended is left as it is; a listed id not in the state is skipped.
function foldFireDispatched(state: EngineState, event: PosEvent, strict: boolean): EngineState {
  const p = event.payload as unknown as FireDispatchedPayload;
  let next = state;
  for (const id of p.order_item_ids) {
    const line = lineOf(next, id);
    if (line === undefined || line.stage !== 'added' || line.fired_at !== null) continue;
    // AD-9: a pulled / early_fill line packs from its actual dispatch and sorts by it (the planned fire stays in
    // the event's due_at); a scheduled or missed fire (recorded_at ≥ fire_ms) keeps fire_ms.
    const fire_ms = Math.min(line.fire_ms ?? event.recorded_at, event.recorded_at);
    next = moveLine(next, line, event, strict, { fired_at: event.recorded_at, load_id: p.load_id, fire_ms });
  }
  return next;
}

// §3.4 ItemStarted: ADDED → COOKING, started_at = min(started_at, recorded_at) (§3.3, §4.2). A Start on a line
// that was never fired also takes its planned booking off the profile. Any other stage: no change.
function foldItemStarted(state: EngineState, event: PosEvent, strict: boolean): EngineState {
  const p = event.payload as unknown as ItemStartedPayload;
  const line = lineOf(state, p.order_item_id);
  if (line === undefined || line.stage !== 'added') return state;
  return moveLine(state, line, event, strict, { stage: 'cooking', started_at: Math.min(p.started_at, event.recorded_at) });
}

// §3.4 ItemDone: COOKING (or a line never started) → DONE, done_at = min(done_at, recorded_at) (§4.2). A done
// line occupies nothing (F §4.7 test 4: Done early frees capacity).
function foldItemDone(state: EngineState, event: PosEvent, strict: boolean): EngineState {
  const p = event.payload as unknown as ItemDonePayload;
  const line = lineOf(state, p.order_item_id);
  if (line === undefined || (line.stage !== 'added' && line.stage !== 'cooking')) return state;
  return moveLine(state, line, event, strict, { stage: 'done', done_at: Math.min(p.done_at, event.recorded_at) });
}

// §3.4, D16 ItemDoneUndone: DONE → COOKING; done_at cleared, so liveInterval gives it its COOKING occupancy
// again (test 51). A line done without a Start keeps its done time as the latest possible Start.
function foldItemDoneUndone(state: EngineState, event: PosEvent): EngineState {
  const p = event.payload as unknown as { order_item_id: string };
  const line = lineOf(state, p.order_item_id);
  if (line === undefined || line.stage !== 'done') return state;
  return patchLine(state, line.order_item_id, { stage: 'cooking', done_at: null, started_at: line.started_at ?? line.done_at });
}

const OPEN_STAGES: ReadonlySet<EngineLine['stage']> = new Set(['added', 'cooking', 'done']);

// §3.8a, §4.2 ItemReturned (remake only, written by 02 with the return batch): the served line goes `returned`,
// which exits it for the engine as `voided` does (§3.3: a closed stage that occupies nothing). A served line holds
// no booking, so nothing leaves the profile (moveLine keeps AD-7 anyway) and no re-plan runs (not a §3.5.3
// trigger; the old group's T and slip are untouched). §3.3 absent ids: an order or line not in the state is a
// no-op. A writer bug — the line is not served, or replacement_order_item_id is not its remake line — throws
// InvalidEvent (AD-8: strict throws, non-strict one invalid_event diagnostic).
function foldItemReturned(state: EngineState, event: PosEvent, strict: boolean): EngineState {
  const p = event.payload as unknown as ItemReturnedPayload;
  const line = lineOf(state, p.order_item_id);
  if (line === undefined || state.orders[line.order_id] === undefined) return state;
  if (line.stage !== 'served') throw new InvalidEvent('item_returned_not_served', line.order_item_id, line.station_id);
  const r = lineOf(state, p.replacement_order_item_id);
  if (r === undefined || r.order_id !== line.order_id || r.return_of?.order_item_id !== line.order_item_id || r.return_of.mode !== 'remake') {
    throw new InvalidEvent('item_returned_replacement_invalid', line.order_item_id, line.station_id);
  }
  return moveLine(state, line, event, strict, { stage: 'returned' });
}

// §3.4 ItemServed: every listed open line → SERVED; absent ids are skipped (§3.3).
function foldItemServed(state: EngineState, event: PosEvent, strict: boolean): EngineState {
  const p = event.payload as unknown as ItemServedPayload;
  let next = state;
  for (const id of p.order_item_ids) {
    const line = lineOf(next, id);
    if (line === undefined || !OPEN_STAGES.has(line.stage)) continue;
    next = moveLine(next, line, event, strict, { stage: 'served' });
  }
  return next;
}

// §3.4 ItemRemoved / ItemVoided: any stage before served → removed / voided. BF-12: a partial ItemVoided
// (units < the line's units) lowers units and draws in task 12; here only a void of the whole line ends it.
// §3.5.3 triggers (D13): the line's station is re-planned at recorded_at and its group's T may move earlier,
// never later (replanEnded, test 89).
function foldItemEnded(state: EngineState, event: PosEvent, o: SequenceOptions, stage: 'removed' | 'voided'): EngineState {
  const strict = o.strict;
  const p = event.payload as unknown as { order_item_id: string } & Partial<Pick<ItemVoidedPayload, 'units'>>;
  const line = lineOf(state, p.order_item_id);
  if (line === undefined || !OPEN_STAGES.has(line.stage)) return state;
  if (stage === 'voided' && p.units! < line.units) return state;
  const ended = moveLine(state, line, event, strict, { stage });
  return replanEnded(ended, ended.lines[line.order_item_id]!, event.recorded_at, event.event_id, o);
}

function invalidEventDiagnostic(event: PosEvent, e: InvalidEvent): Diagnostic {
  const p = event.payload as { order_id?: unknown };
  return {
    kind: 'invalid_event',
    event_id: event.event_id,
    ...(e.station_id === undefined ? {} : { station_id: e.station_id }),
    detail: {
      event_type: event.event_type,
      order_id: typeof p.order_id === 'string' ? p.order_id : null,
      order_item_id: e.order_item_id,
      reason: e.reason,
    },
  };
}

// AD-6: strict (the default, used by tests) throws on a profile underflow or a stock invariant breach;
// non-strict (the hub, live and replay) clamps at 0 and appends a Diagnostic instead.
// prune (default true): the D25 prune of the §3.5.3 re-plan; false only for the unpruned comparison of test 23
// and the §10.6 simulator (`runDay(day, { prune })`).
export type ApplyOptions = { strict?: boolean; prune?: boolean };

// AD-6: copy-on-write append for non-strict folds (a removeInterval underflow callback becomes a
// 'profile_underflow' with station_id / event_id; task 12's stock folds add 'stock_breach').
export function addDiagnostic(state: EngineState, d: Diagnostic): EngineState {
  return { ...state, diagnostics: [...state.diagnostics, d] };
}

// Pure fold (03a §6.1a, AD-6 opts). Handles exactly the ENGINE_REPLAY_EVENTS types; any other type returns
// `state` itself (S15). Copies only the touched entry. AD-6 / AD-8(c): a writer bug an order fold finds
// (InvalidEvent) throws when strict. Non-strict, a listed bad line is dropped and still decrements awaiting
// (foldItemAdded), and an unlisted one changes nothing (caught here); either way one 'invalid_event'
// diagnostic is appended. Other throws (OrderLinesAdded on an absent order, §3.3) throw in both modes.
export function applyEvent(state: EngineState, event: PosEvent, opts?: ApplyOptions): EngineState {
  const strict = opts?.strict ?? true;
  try {
    return fold(state, event, { strict, prune: opts?.prune ?? true });
  } catch (e) {
    if (strict || !(e instanceof InvalidEvent)) throw e;
    // AD-6: non-strict never stops on a writer bug: the event changes nothing but the diagnostics.
    return addDiagnostic(state, invalidEventDiagnostic(event, e));
  }
}

function fold(state: EngineState, event: PosEvent, o: SequenceOptions): EngineState {
  const strict = o.strict;
  switch (event.event_type) {
    case 'StockSet': {
      const p = event.payload as unknown as StockSet;
      const prev = stockOf(state, p.stock_item_id);
      return {
        ...state,
        stock: {
          ...state.stock,
          [p.stock_item_id]: { on_hand: p.on_hand, reserved: prev.reserved, set_at: event.recorded_at, unit: p.unit },
        },
      };
    }
    case 'StockAdded': {
      const p = event.payload as unknown as StockAdded;
      const prev = stockOf(state, p.stock_item_id);
      if (prev.unit !== p.unit) throw new Error('StockAdded unit mismatch');
      return {
        ...state,
        stock: { ...state.stock, [p.stock_item_id]: { ...prev, on_hand: prev.on_hand + p.quantity } },
      };
    }
    // 01a S33: recorded_at is the day's start and end.
    case 'BusinessDayOpened': {
      const p = event.payload as unknown as BusinessDayOpened;
      return {
        ...state,
        business_day: {
          business_date: p.business_date,
          opened_at: event.recorded_at,
          closed_at: null,
          stock_units: p.stock_units,
          draws: p.draws,
        },
      };
    }
    case 'BusinessDayClosed': {
      const day = state.business_day;
      if (day === null || day.closed_at !== null) return state;
      return { ...state, business_day: { ...day, closed_at: event.recorded_at } };
    }
    case 'EngineConfigApplied':
      return applyEngineConfig(state, event.payload as unknown as EngineConfig);
    case 'OrderPlaced':
      return foldOrderPlaced(state, event);
    case 'OrderLinesAdded':
      return foldOrderLinesAdded(state, event);
    case 'ItemAdded':
      return foldItemAdded(state, event, o);
    case 'FireDispatched':
      return foldFireDispatched(state, event, strict);
    case 'ItemStarted':
      return foldItemStarted(state, event, strict);
    case 'ItemDone':
      return foldItemDone(state, event, strict);
    case 'ItemDoneUndone':
      return foldItemDoneUndone(state, event);
    case 'ItemServed':
      return foldItemServed(state, event, strict);
    case 'ItemRemoved':
      return foldItemEnded(state, event, o, 'removed');
    case 'ItemVoided':
      return foldItemEnded(state, event, o, 'voided');
    case 'ItemReturned':
      return foldItemReturned(state, event, strict);
    // 03a §3.12 types whose folds land in later tasks: unchanged until then.
    case 'ItemMovedToStock':
    case 'OrderBoosted':
    case 'ItemsReleased':
    case 'SlipWarned':
    case 'AlertClosed':
    case 'ReservationsShifted':
    case 'StationCapacitySet':
    case 'StationPauseSet':
    case 'StockReserved':
    case 'StockReleased':
    case 'StockConsumed':
      return state;
    default:
      return state;
  }
}

export function buildEngineState(events: Iterable<PosEvent>, opts?: ApplyOptions): EngineState {
  let state = initialEngineState();
  for (const event of events) state = applyEvent(state, event, opts);
  return state;
}
