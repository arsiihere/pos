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
import { capacityFor, stationPolicy } from './replan.js';
import { checkProgram, deadlineOf, InvalidEvent, isEngineLine, lineShape, lineUnits, planNewLines, replanEnded, type SequenceOptions } from './plan.js';
import { closedOrderIds, exitedOrderIds, isOpen, touchOrder } from './lifecycle.js';
import { removeInterval, type Underflow } from './profile.js';
import { ENGINE_REPLAY_EVENTS } from './replay-events.js';
import type { DayDraws, Diagnostic, EngineLine, EngineOrder, EngineState, Load, StationRuntime, StockEntry } from './state.js';
import { initialEngineState } from './state.js';
import { stockOf } from './stock.js';

// Payloads as validated by the @pos/events schemas (§4.2).
// StockSet / StockAdded v2 (01c V5): keyed by stock_item_id; parseEvent upcasts v1.
interface StockSet { stock_item_id: string; on_hand: number; unit: Unit }
interface StockAdded { stock_item_id: string; quantity: number; unit: Unit }
// StockReserved / StockReleased / StockConsumed v1 (03a §4.2): one draw of one line.
interface StockLine { stock_item_id: string; order_item_id: string; quantity: number }
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

// §3.3, §4.2: an order-stream event is on its order's stream (stream_id = order_id); anything else is a writer bug
// (AD-8: strict throws, non-strict one invalid_event diagnostic and no change).
function checkStream(event: PosEvent, order_id: string, order_item_id: string, station_id?: string): void {
  if (event.stream_id !== order_id) throw new InvalidEvent('stream_id_mismatch', order_item_id, station_id);
}

// §3.5.1, §4.2: the listed lines of an OrderPlaced / OrderLinesAdded. A line of `lines[]` enters `lines` here
// with its OrderPlaced engine fields (the only place they are kept until its ItemAdded) and neutral values
// for the ItemAdded fields, which its ItemAdded fold fills; nothing is placed until awaiting reaches 0.
// line_ids keep order_item_ids order and list only the ids of `lines[]` (a deal line has no entry, §3.2).
// §3.8a: a return line (OrderLinesAdded `return_of` set) is listed as immediate, mark 'return', from_stock false,
// with its `fix` cook_ms_override kept in cook_ms until its ItemAdded; it must be alone in a new group (its own
// group, never the old one re-opened) and a `fix` must carry cook_ms_override — else InvalidEvent (AD-8: the
// event changes nothing when non-strict).
// §3.3 deterministic ids: the event's groups are `order_id:(next_group_index + i)` in order (OrderPlaced 0…n−1, an
// addition from next_group_index), and every lines[] entry is one of order_item_ids — else InvalidEvent (AD-8).
// An OrderLinesAdded re-opens the order (last_served_at null, §3.3 fold order).
type ListedLine = OrderLinePayload & Partial<Pick<OrderLinesAddedLinePayload, 'return_of' | 'cook_ms_override'>>;
function listLines(
  state: EngineState,
  order: EngineOrder,
  p: { order_id: string; order_item_ids: string[]; groups: OrderGroupPayload[]; lines: ListedLine[] },
  recorded_at: number,
): EngineState {
  const groups = { ...order.groups };
  const next = order.next_group_index + p.groups.length;
  const ids = new Set(p.order_item_ids);
  for (const l of p.lines) {
    if (!ids.has(l.order_item_id)) throw new InvalidEvent('line_not_in_order', l.order_item_id, l.station_id);
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
      capped: false,
      routed_station_id: l.station_id,
    };
  }
  p.groups.forEach((g, i) => {
    if (g.group_id !== `${p.order_id}:${order.next_group_index + i}`) throw new InvalidEvent('group_id_invalid', g.order_item_ids[0] ?? '');
  });
  const updated: EngineOrder = {
    ...order,
    line_ids: [...order.line_ids, ...listed],
    awaiting: order.awaiting + p.order_item_ids.length,
    last_served_at: null,
    last_line_fold_at: recorded_at,
    next_group_index: next,
    groups,
  };
  return touchOrder({ ...state, orders: { ...state.orders, [p.order_id]: updated }, lines }, p.order_id, recorded_at);
}

// §3.3, §4.2: placed_by = actor_id, placed_at = recorded_at; T and P per group copied, never recomputed
// (§3.5.1 step 6, P-2). The order's own target / promise are its latest group's (F §4.7: the order lands
// with its last item); an order with no group (no plannable line) takes recorded_at.
function foldOrderPlaced(state: EngineState, event: PosEvent): EngineState {
  const p = event.payload as unknown as OrderPlacedPayload;
  checkStream(event, p.order_id, p.order_item_ids[0] ?? '');
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

// §3.3, §4.2 (P-10): an addition to an order in the engine. The removal step has skipped this order (applyEvent),
// so a present order is re-opened even when recorded_at is past its window by the append gap; an absent order is a
// bug (it was removed at a listed event at or after its deadline) and throws in both modes.
function foldOrderLinesAdded(state: EngineState, event: PosEvent): EngineState {
  const p = event.payload as unknown as OrderLinesAddedPayload;
  checkStream(event, p.order_id, p.order_item_ids[0] ?? '');
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
      // §4.2 / D25: ItemAdded.station_id is the routed (home) station; the line's station_id stays the engine's.
      routed_station_id: p.station_id ?? listed.station_id,
      draws: ret !== null ? [] : p.stock_draws.map((d) => ({ stock_item_id: d.stock_item_id, quantity: d.quantity, reserved: 0 })),
    };
    checkProgram(filled, station);
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
  const id = p.order_item_id;
  checkStream(event, p.order_id, id);
  const order = state.orders[p.order_id];
  if (order === undefined) return state;
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
  } else if (listed !== undefined) {
    // 01c §3.4.7: a deal line (or a line with no station) is never a line, even when lines[] listed it.
    ({ state: next, order: updated } = dropListed(state, order, listed));
  } else if (order.awaiting - unfilledCount(state, order) <= 0) {
    // AD-8 (8b): a non-engine id with no placeholder is consumed only while awaiting exceeds the order's unfilled
    // placeholders, so a duplicate (or unlisted) deal ItemAdded never takes an engine line's count.
    throw new InvalidEvent('line_not_listed', id);
  }
  updated = { ...updated, awaiting: order.awaiting - 1, last_line_fold_at: event.recorded_at };
  next = { ...next, orders: { ...next.orders, [p.order_id]: updated } };
  // §3.5.3: the one re-plan per station of the batch runs here (pass 1 → immediate → sync), at recorded_at.
  if (updated.awaiting === 0) next = planNewLines(next, p.order_id, event.recorded_at, event.event_id, o);
  return touchOrder(next, p.order_id, event.recorded_at);
}

function unfilledCount(state: EngineState, order: EngineOrder): number {
  let n = 0;
  for (const id of order.line_ids) {
    const l = state.lines[id];
    if (l !== undefined && isPlaceholder(l)) n++;
  }
  return n;
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
  const load = line.load_id === null ? undefined : station.loads[line.load_id];
  if (load !== undefined && load.order_item_ids.includes(id)) return leaveLoad(state, station, load, line, event, strict);
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

// Task 13 (AD-7 for loads): an unfired member leaves its load and `unfired`. The load keeps its name and booking
// while it has members (§3.3: a name, not membership; its fire is kept, the next re-plan of a hidden load re-forms
// it); the last member's leaving removes exactly the load's booking (AD-6 as unbook) and the load.
function leaveLoad(state: EngineState, station: StationRuntime, load: Load, line: EngineLine, event: PosEvent, strict: boolean): EngineState {
  const id = line.order_item_id;
  const rest = load.order_item_ids.filter((x) => x !== id);
  const loads = { ...station.loads };
  let profile = station.profile;
  let underflow: Underflow | null = null;
  if (rest.length > 0) {
    loads[load.load_id] = { ...load, order_item_ids: rest };
  } else {
    delete loads[load.load_id];
    profile = strict
      ? removeInterval(profile, load.booked, load.booked.units)
      : removeInterval(profile, load.booked, load.booked.units, (u) => {
          underflow = u;
        });
  }
  const next: EngineState = {
    ...state,
    stations: { ...state.stations, [station.station_id]: { ...station, profile, loads, unfired: station.unfired.filter((x) => x !== id) } },
    lines: { ...state.lines, [id]: { ...line, booked: null } },
  };
  if (underflow === null) return next;
  const { at, deficit } = underflow as Underflow;
  return addDiagnostic(next, { kind: 'profile_underflow', event_id: event.event_id, station_id: station.station_id, detail: { load_id: load.load_id, order_item_id: id, at, deficit } });
}

function patchLine(state: EngineState, id: string, patch: Partial<EngineLine>): EngineState {
  return { ...state, lines: { ...state.lines, [id]: { ...state.lines[id]!, ...patch } } };
}

// A line leaves the planned profile and takes `stage` (and the other fields of `patch`).
function moveLine(state: EngineState, line: EngineLine, event: PosEvent, strict: boolean, patch: Partial<EngineLine>): EngineState {
  return patchLine(unbook(state, line, event, strict), line.order_item_id, patch);
}

// §3.4 FireDispatched: each listed line that is unfired gets fired_at = recorded_at and the event's load_id
// (§3.3: the load name is fixed here) and fire_ms = min(fire_ms, recorded_at) (AD-9); its planned booking leaves the
// profile and it leaves unfired, so from now on it occupies its packed live interval (§3.3). A fired line is never
// fired twice: a listed line already fired, started or ended is left as it is (before any check: once lines can
// change station, §3.5.5, a re-listed line may sit on another station by now); a listed id not in the state is
// skipped. AD-8 (8b): a line about to fire that is on another station than payload.station_id, or of an order
// still awaiting lines, is a writer bug — strict throws; non-strict that line is left untouched with one
// invalid_event diagnostic and the other lines fire. §3.3: the fold refreshes last_line_fold_at of each order it
// fires a line of.
// Task 13 (§3.6.1 item 1, §4.2): a FireDispatched naming an unfired load of its station fires every member of the
// load as well as the listed lines (a pulled-in line leaves its own load); the load leaves `loads` with its last
// member, its booking removed exactly once, and every fired line carries the event's load_id.
function foldFireDispatched(state: EngineState, event: PosEvent, strict: boolean): EngineState {
  const p = event.payload as unknown as FireDispatchedPayload;
  let next = state;
  const load = p.load_id === null ? undefined : state.stations[p.station_id]?.loads[p.load_id];
  const ids = load === undefined ? p.order_item_ids : [...new Set([...p.order_item_ids, ...load.order_item_ids])];
  for (const id of ids) {
    const line = lineOf(next, id);
    if (line === undefined || line.stage !== 'added' || line.fired_at !== null) continue;
    const bug =
      line.station_id !== p.station_id ? 'station_mismatch' : (next.orders[line.order_id]?.awaiting ?? 0) > 0 ? 'order_awaiting' : null;
    if (bug !== null) {
      const e = new InvalidEvent(bug, id, line.station_id);
      if (strict) throw e;
      next = addDiagnostic(next, invalidEventDiagnostic(event, e));
      continue;
    }
    // AD-9: a pulled / early_fill line packs from its actual dispatch and sorts by it (the planned fire stays in
    // the event's due_at); a scheduled or missed fire (recorded_at ≥ fire_ms) keeps fire_ms.
    const fire_ms = Math.min(line.fire_ms ?? event.recorded_at, event.recorded_at);
    next = moveLine(next, line, event, strict, { fired_at: event.recorded_at, load_id: p.load_id, fire_ms });
    next = touchOrder(next, line.order_id, event.recorded_at);
  }
  return next;
}

// The line an order-stream stage event names (§3.3 absent ids: undefined → the fold is a no-op), checked to be on
// its order's stream (AD-8).
function stageLine(state: EngineState, event: PosEvent, order_item_id: string): EngineLine | undefined {
  const line = lineOf(state, order_item_id);
  if (line !== undefined) checkStream(event, line.order_id, order_item_id, line.station_id);
  return line;
}

// §3.4 ItemStarted: ADDED → COOKING, started_at = min(started_at, recorded_at) (§3.3, §4.2). A Start on a line
// that was never fired also takes its planned booking off the profile. Any other stage: no change (AD-10).
function foldItemStarted(state: EngineState, event: PosEvent, strict: boolean): EngineState {
  const p = event.payload as unknown as ItemStartedPayload;
  const line = stageLine(state, event, p.order_item_id);
  if (line === undefined || line.stage !== 'added') return state;
  const next = moveLine(state, line, event, strict, { stage: 'cooking', started_at: Math.min(p.started_at, event.recorded_at) });
  return touchOrder(next, line.order_id, event.recorded_at);
}

// §3.4 ItemDone: COOKING (or a line never started) → DONE, done_at = min(done_at, recorded_at) (§4.2). A done
// line occupies nothing (F §4.7 test 4: Done early frees capacity).
function foldItemDone(state: EngineState, event: PosEvent, strict: boolean): EngineState {
  const p = event.payload as unknown as ItemDonePayload;
  const line = stageLine(state, event, p.order_item_id);
  if (line === undefined || (line.stage !== 'added' && line.stage !== 'cooking')) return state;
  const next = moveLine(state, line, event, strict, { stage: 'done', done_at: Math.min(p.done_at, event.recorded_at) });
  return touchOrder(next, line.order_id, event.recorded_at);
}

// §3.4, D16 ItemDoneUndone: DONE → COOKING; done_at cleared, so liveInterval gives it its COOKING occupancy
// again (test 51). A line done without a Start keeps its done time as the latest possible Start.
function foldItemDoneUndone(state: EngineState, event: PosEvent): EngineState {
  const p = event.payload as unknown as { order_item_id: string };
  const line = stageLine(state, event, p.order_item_id);
  if (line === undefined || line.stage !== 'done') return state;
  const next = patchLine(state, line.order_item_id, { stage: 'cooking', done_at: null, started_at: line.started_at ?? line.done_at });
  return touchOrder(next, line.order_id, event.recorded_at);
}

// §3.8a, §4.2 ItemReturned (remake only, written by 02 with the return batch): the served line goes `returned`,
// which exits it for the engine as `voided` does (§3.3: a closed stage that occupies nothing). A served line holds
// no booking, so nothing leaves the profile (moveLine keeps AD-7 anyway) and no re-plan runs (not a §3.5.3
// trigger; the old group's T and slip are untouched). §3.3 absent ids: an order or line not in the state is a
// no-op. A writer bug — the line is not served, or replacement_order_item_id is not its remake line — throws
// InvalidEvent (AD-8: strict throws, non-strict one invalid_event diagnostic). Refreshes last_line_fold_at (§3.3).
function foldItemReturned(state: EngineState, event: PosEvent, strict: boolean): EngineState {
  const p = event.payload as unknown as ItemReturnedPayload;
  const line = stageLine(state, event, p.order_item_id);
  if (line === undefined || state.orders[line.order_id] === undefined) return state;
  if (line.stage !== 'served') throw new InvalidEvent('item_returned_not_served', line.order_item_id, line.station_id);
  const r = lineOf(state, p.replacement_order_item_id);
  if (r === undefined || r.order_id !== line.order_id || r.return_of?.order_item_id !== line.order_item_id || r.return_of.mode !== 'remake') {
    throw new InvalidEvent('item_returned_replacement_invalid', line.order_item_id, line.station_id);
  }
  return touchOrder(moveLine(state, line, event, strict, { stage: 'returned' }), line.order_id, event.recorded_at);
}

// §3.4 ItemServed: every listed open line → SERVED; absent ids are skipped (§3.3). The serve that leaves no line
// open sets last_served_at (touchOrder).
function foldItemServed(state: EngineState, event: PosEvent, strict: boolean): EngineState {
  const p = event.payload as unknown as ItemServedPayload;
  let next = state;
  for (const id of p.order_item_ids) {
    const line = stageLine(next, event, id);
    if (line === undefined || !isOpen(line)) continue;
    next = touchOrder(moveLine(next, line, event, strict, { stage: 'served' }), line.order_id, event.recorded_at);
  }
  return next;
}

// §3.4 ItemRemoved / ItemVoided: any stage before served → removed / voided. BF-12: a partial ItemVoided
// (units < the line's units) is partialVoid below; a void of the whole line ends it. §3.5.3 triggers (D13): the
// line's station is re-planned at recorded_at and its group's T may move earlier, never later (replanEnded, test
// 89). The end that leaves no line open sets last_served_at (§3.3).
// Proposed (implementer, overnight): a whole void keeps the line's units and draws[].quantity (BF-12 "voided only
// when no unit is left": the stage says no unit is left; units 0 would read as an AD-8 placeholder); its releases
// then take every draw's reserved to 0.
function foldItemEnded(state: EngineState, event: PosEvent, o: SequenceOptions, stage: 'removed' | 'voided'): EngineState {
  const strict = o.strict;
  const p = event.payload as unknown as { order_item_id: string } & Partial<Pick<ItemVoidedPayload, 'units'>>;
  const line = stageLine(state, event, p.order_item_id);
  if (line === undefined || !isOpen(line)) return state;
  if (stage === 'voided' && p.units! < line.units) return touchOrder(partialVoid(state, line, p.units!, event, o), line.order_id, event.recorded_at);
  const ended = moveLine(state, line, event, strict, { stage });
  return touchOrder(replanEnded(ended, ended.lines[line.order_item_id]!, event.recorded_at, event.event_id, o), line.order_id, event.recorded_at);
}

// BF-12 (§3.7 partial-void share, v0.6.2 G4-3 #2): the cause's fold lowers the line's units by the voided units and
// every draws[].quantity by its share = quantity × voided ÷ units (an exact integer: a piece line's draw is units ×
// quantity_per_sale_unit, 01c §3.5.2; a share that is not whole is a writer bug, AD-8). draws[].reserved, from_stock,
// cook_ms, the program and reserved_seq are kept: the StockReleased of each share follows ("the cause, then its
// releases") and lowers only reserved. Between the two, a draw's reserved may exceed its quantity; the §3.7
// invariant holds at the batch boundary. A line with no draw lowers units only.
// §3.5.3 (D13; task 12 review: a partial void re-plans like a void, AD-11): replanEnded with the line kept in its
// group — its station's pass 1 re-books it when hidden with its remaining units (AD-7: exactly its old `booked`
// leaves the profile; a hidden batch load is re-formed), then the group loop over its hidden lines on all their
// stations: T' = min(T, loop), the promise never moves. A frozen line keeps its booking and a fired / COOKING line
// packs with its remaining units (§3.3); a frozen batch load is not re-formed.
function partialVoid(state: EngineState, line: EngineLine, voidedUnits: number, event: PosEvent, o: SequenceOptions): EngineState {
  const id = line.order_item_id;
  const draws = line.draws.map((d) => {
    const share = (d.quantity * voidedUnits) / line.units;
    if (!Number.isInteger(share)) throw new InvalidEvent('void_share_not_integer', id, line.station_id);
    return { ...d, quantity: d.quantity - share };
  });
  const next = patchLine(state, id, { units: line.units - voidedUnits, draws });
  return replanEnded(next, next.lines[id]!, event.recorded_at, event.event_id, o, true);
}

// ---- 03a §3.7 stock folds (AD-6: strict throws on a breach; non-strict clamps and appends 'stock_breach') ------

// AD-6 (developer ruling; replaces §3.7 / §6.1a `report`): a stock invariant breach — on_hand, reserved or a
// draw's reserved would go below 0, a StockSet excess not held by frozen or fired lines, a StockAdded in another
// unit, a StockReserved past its draw. Strict (tests) throws; non-strict (the hub) keeps the clamped result and
// appends one diagnostic per event with the entry's values before the fold. The result never depends on it.
function stockBreach(
  state: EngineState,
  event: PosEvent,
  strict: boolean,
  stock_item_id: string,
  before: StockEntry,
  what: string,
  detail: Record<string, number | string | null>,
): EngineState {
  if (strict) throw new Error(`stock invariant breach: ${what} (event ${event.event_id}, stock item ${stock_item_id})`);
  return addDiagnostic(state, {
    kind: 'stock_breach',
    event_id: event.event_id,
    stock_item_id,
    detail: { event_type: event.event_type, ...detail, on_hand: before.on_hand, reserved: before.reserved },
  });
}

function withEntry(state: EngineState, stock_item_id: string, entry: StockEntry): EngineState {
  return { ...state, stock: { ...state.stock, [stock_item_id]: entry } };
}

// The line a stock-line event names and the index of its draw on that stock item. §3.3 absent ids: a line not in the
// state (or a placeholder) → line undefined. A present line with no draw on the stock item is a writer bug (AD-8:
// InvalidEvent, strict throws, non-strict the event changes nothing but one invalid_event diagnostic).
function drawOf(state: EngineState, p: StockLine): { line: EngineLine | undefined; i: number } {
  const line = lineOf(state, p.order_item_id);
  if (line === undefined) return { line, i: -1 };
  const i = line.draws.findIndex((d) => d.stock_item_id === p.stock_item_id);
  if (i < 0) throw new InvalidEvent('draw_not_on_line', p.order_item_id, line.station_id);
  return { line, i };
}

// §3.7 StockReserved: reserved += quantity on the entry and on the line's draw; reserved_seq = the event's seq.
// A line not in the state — absent, or dropped by a non-strict ItemAdded fold (AD-8) — is a no-op returning state
// itself, stock untouched (§3.3 absent ids). Proposed (implementer, overnight): unlike a release or consume, nothing
// could ever release or consume a reservation of a line the state does not hold (stockEffects drafts from
// line.draws), so adding it would keep `reserved` held for good and lower `available` for every later order.
// A reservation past the draw's quantity is clamped to it (a breach). The from_stock false → true flip (stock cook
// time, stock program, re-plan of the line's station) is task 12b (§3.7 StockAdded, test 87); a submit's own
// reservation flips nothing (OrderPlaced already marked the line from_stock).
function foldStockReserved(state: EngineState, event: PosEvent, strict: boolean): EngineState {
  const p = event.payload as unknown as StockLine;
  const { line, i } = drawOf(state, p);
  if (line === undefined) return state;
  const draw = line.draws[i]!;
  const take = Math.min(p.quantity, Math.max(0, draw.quantity - draw.reserved));
  const prev = stockOf(state, p.stock_item_id);
  const draws = line.draws.map((d, j) => (j === i ? { ...d, reserved: d.reserved + take } : d));
  let next = withEntry(state, p.stock_item_id, { ...prev, reserved: prev.reserved + take });
  next = patchLine(next, line.order_item_id, { draws, reserved_seq: take > 0 ? event.seq : line.reserved_seq });
  if (take === p.quantity) return next;
  return stockBreach(next, event, strict, p.stock_item_id, prev, 'StockReserved past the draw', {
    order_item_id: p.order_item_id,
    quantity: p.quantity,
    draw_quantity: draw.quantity,
    draw_reserved: draw.reserved,
  });
}

// §3.7 StockReleased (bookkeeping only, never a re-plan): the entry's reserved −= quantity and the draw's reserved
// −= quantity, each clamped at 0 (a breach). When no draw of the line holds any unit any more, the line goes fresh:
// from_stock false, cook_ms = full_cook_ms, reserved_seq null; a batch line's program follows (currentProgram, BF-1:
// program_id is the ItemAdded copy). BF-12: units and draws[].quantity are the cause's (partialVoid), never changed
// here. A line not in the state still lowers the entry: e.g. the abandon release (§3.6.1) or a close release of an
// exited order, whose fold's removal step (§3.3) took the order out just before (drafted while it held the units).
function foldStockReleased(state: EngineState, event: PosEvent, strict: boolean): EngineState {
  const p = event.payload as unknown as StockLine;
  const { line, i } = drawOf(state, p);
  const prev = stockOf(state, p.stock_item_id);
  let short = prev.reserved < p.quantity;
  let next = withEntry(state, p.stock_item_id, { ...prev, reserved: Math.max(0, prev.reserved - p.quantity) });
  if (line !== undefined) {
    short = short || line.draws[i]!.reserved < p.quantity;
    const draws = line.draws.map((d, j) => (j === i ? { ...d, reserved: Math.max(0, d.reserved - p.quantity) } : d));
    const fresh = draws.every((d) => d.reserved === 0);
    next = patchLine(next, line.order_item_id, fresh ? { draws, from_stock: false, cook_ms: line.full_cook_ms, reserved_seq: null } : { draws });
  }
  if (!short) return next;
  const reason = (event.payload as { reason?: unknown }).reason;
  return stockBreach(next, event, strict, p.stock_item_id, prev, 'StockReleased below 0', {
    order_item_id: p.order_item_id,
    quantity: p.quantity,
    reason: typeof reason === 'string' ? reason : null,
  });
}

// §3.7 consume (P-5, A-18): on_hand = max(0, on_hand − quantity), reserved = max(0, reserved − quantity), the draw's
// reserved = 0, reserved_seq null when no draw holds any; from_stock stays true (the plate was taken from the pot).
// A clamp (or a draw holding less than quantity) is a breach: after a recount below reserved the pot was already
// known to be short, so the Start commits (non-strict). A line not in the state still moves the entry (as a release).
function foldStockConsumed(state: EngineState, event: PosEvent, strict: boolean): EngineState {
  const p = event.payload as unknown as StockLine;
  const { line, i } = drawOf(state, p);
  const prev = stockOf(state, p.stock_item_id);
  let short = prev.on_hand < p.quantity || prev.reserved < p.quantity;
  let next = withEntry(state, p.stock_item_id, {
    ...prev,
    on_hand: Math.max(0, prev.on_hand - p.quantity),
    reserved: Math.max(0, prev.reserved - p.quantity),
  });
  if (line !== undefined) {
    short = short || line.draws[i]!.reserved < p.quantity;
    const draws = line.draws.map((d, j) => (j === i ? { ...d, reserved: 0 } : d));
    next = patchLine(next, line.order_item_id, draws.every((d) => d.reserved === 0) ? { draws, reserved_seq: null } : { draws });
  }
  if (!short) return next;
  return stockBreach(next, event, strict, p.stock_item_id, prev, 'StockConsumed below 0', { order_item_id: p.order_item_id, quantity: p.quantity });
}

// §3.7 (v0.6.2, G4-3 #3): the units of `stock_item_id` reserved for frozen or fired lines at t — a line on the
// chef's Next list (unfired, fire_ms ≤ t + freeze_ms; a batch member by its load's fire) or fired and not started.
// O(lines); read only when a count falls below reserved.
function heldByFrozenOrFired(state: EngineState, stock_item_id: string, t: number): number {
  let held = 0;
  for (const id in state.lines) {
    const l = state.lines[id]!;
    if (l.reserved_seq === null || l.stage !== 'added') continue;
    const frozen = l.fired_at !== null || (l.fire_ms !== null && l.fire_ms <= t + stationPolicy(state, l.station_id).freeze_ms);
    if (!frozen) continue;
    for (const d of l.draws) if (d.stock_item_id === stock_item_id) held += d.reserved;
  }
  return held;
}

// 01a S14 StockSet: on_hand = count, unit = the event's, set_at = recorded_at, reserved unchanged. §3.7: a count
// below reserved is allowed only by the units reserved for frozen or fired lines (their releases never come; the
// hidden lines' releases precede the StockSet, stockEffects, task 12b). Any other excess folds as counted and is a
// breach. The re-plan of a recount is task 12b (§3.5.3).
function foldStockSet(state: EngineState, event: PosEvent, strict: boolean): EngineState {
  const p = event.payload as unknown as StockSet;
  const prev = stockOf(state, p.stock_item_id);
  const next = withEntry(state, p.stock_item_id, { on_hand: p.on_hand, reserved: prev.reserved, set_at: event.recorded_at, unit: p.unit });
  if (p.on_hand >= prev.reserved) return next;
  const held = heldByFrozenOrFired(state, p.stock_item_id, event.recorded_at);
  if (prev.reserved - held <= p.on_hand) return next;
  return stockBreach(next, event, strict, p.stock_item_id, prev, 'StockSet below reserved not held by frozen or fired lines', { count: p.on_hand, held });
}

// 01a S14 / S45 StockAdded: on_hand += quantity, set_at and unit unchanged. BF-13 / A-20: a unit other than the
// entry's leaves the entry unchanged and is a breach (was a throw). The waiting-line reserve is task 12b.
function foldStockAdded(state: EngineState, event: PosEvent, strict: boolean): EngineState {
  const p = event.payload as unknown as StockAdded;
  const prev = stockOf(state, p.stock_item_id);
  if (prev.unit !== p.unit) {
    return stockBreach(state, event, strict, p.stock_item_id, prev, 'StockAdded unit mismatch', { quantity: p.quantity, unit: p.unit, entry_unit: prev.unit });
  }
  return withEntry(state, p.stock_item_id, { ...prev, on_hand: prev.on_hand + p.quantity });
}

// §3.3 last_line_fold_at for the order folds whose effects land in later tasks (ItemMovedToStock 12, OrderBoosted
// 9, ItemsReleased 15b): an event that names a present order (or an open line of one) refreshes its clock.
function foldNamesOrder(state: EngineState, event: PosEvent): EngineState {
  const p = event.payload as { order_id: string };
  checkStream(event, p.order_id, '');
  return touchOrder(state, p.order_id, event.recorded_at);
}

function foldItemMovedToStock(state: EngineState, event: PosEvent): EngineState {
  const p = event.payload as unknown as { order_item_id: string };
  const line = stageLine(state, event, p.order_item_id);
  if (line === undefined || !isOpen(line)) return state;
  return touchOrder(state, line.order_id, event.recorded_at);
}

// §3.3 removal: the given orders and their lines leave the state; each line first leaves its station (exactly
// `booked`, and `unfired`; AD-7, AD-6 via unbook), so a removed order occupies nothing.
function removeOrders(state: EngineState, ids: readonly string[], event: PosEvent, strict: boolean): EngineState {
  if (ids.length === 0) return state;
  let next = state;
  for (const id of ids) {
    for (const lid of next.orders[id]!.line_ids) {
      const line = next.lines[lid];
      if (line !== undefined) next = unbook(next, line, event, strict);
    }
  }
  const orders = { ...next.orders };
  const lines = { ...next.lines };
  for (const id of ids) {
    for (const lid of orders[id]!.line_ids) delete lines[lid];
    delete orders[id];
  }
  return { ...next, orders, lines };
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

const HANDLED: ReadonlySet<string> = new Set([
  ...ENGINE_REPLAY_EVENTS.order,
  ...ENGINE_REPLAY_EVENTS.station,
  ...ENGINE_REPLAY_EVENTS.stock,
  ...ENGINE_REPLAY_EVENTS.hub,
]);

// Pure fold (03a §6.1a, AD-6 opts). Handles exactly the ENGINE_REPLAY_EVENTS types; any other type returns
// `state` itself (S15) and removes nothing. Copies only the touched entry. §3.3 removal step: before every handled
// fold, at its recorded_at, the orders out of the engine by the predicate leave the state (OrderLinesAdded skips its
// own order, which it re-opens); with nothing to remove the state is not copied, so an absent-id no-op still returns
// `state` itself. AD-6 / AD-8(c): a writer bug an order fold finds (InvalidEvent) throws when strict. Non-strict, a
// listed bad line is dropped and still decrements awaiting (foldItemAdded), and an unlisted one changes nothing
// but the removal step (caught here); either way one 'invalid_event' diagnostic is appended. Other throws
// (OrderLinesAdded on an absent order, §3.3) throw in both modes.
export function applyEvent(state: EngineState, event: PosEvent, opts?: ApplyOptions): EngineState {
  if (!HANDLED.has(event.event_type)) return state;
  const strict = opts?.strict ?? true;
  const skip = event.event_type === 'OrderLinesAdded' ? (event.payload as { order_id?: string }).order_id : undefined;
  const base = removeOrders(state, exitedOrderIds(state, event.recorded_at, skip), event, strict);
  try {
    return fold(base, event, { strict, prune: opts?.prune ?? true });
  } catch (e) {
    if (strict || !(e instanceof InvalidEvent)) throw e;
    // AD-6: non-strict never stops on a writer bug: the event changes nothing but the diagnostics.
    return addDiagnostic(base, invalidEventDiagnostic(event, e));
  }
}

function fold(state: EngineState, event: PosEvent, o: SequenceOptions): EngineState {
  const strict = o.strict;
  switch (event.event_type) {
    case 'StockSet':
      return foldStockSet(state, event, strict);
    case 'StockAdded':
      return foldStockAdded(state, event, strict);
    case 'StockReserved':
      return foldStockReserved(state, event, strict);
    case 'StockReleased':
      return foldStockReleased(state, event, strict);
    case 'StockConsumed':
      return foldStockConsumed(state, event, strict);
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
      // §3.3 (v0.5.1, Q13): every order whose lines are all served / voided / removed / returned exits at the close;
      // an order with any unserved line stays and exits later by the predicate. Slips: task 15b.
      const exited = removeOrders(state, closedOrderIds(state), event, strict);
      return { ...exited, business_day: { ...day, closed_at: event.recorded_at } };
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
    // 03a §3.12 types whose folds land in later tasks: only the §3.3 last_line_fold_at refresh until then.
    case 'ItemMovedToStock':
      return foldItemMovedToStock(state, event);
    case 'OrderBoosted':
    case 'ItemsReleased':
      return foldNamesOrder(state, event);
    // Unchanged until their tasks (SlipWarned never refreshes the clock, §3.3).
    case 'SlipWarned':
    case 'AlertClosed':
    case 'ReservationsShifted':
    case 'StationCapacitySet':
    case 'StationPauseSet':
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
