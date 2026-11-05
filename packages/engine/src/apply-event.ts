import type { Unit } from '@pos/domain';
import type {
  EngineConfig,
  ItemAddedPayload,
  OrderGroupPayload,
  OrderLinePayload,
  OrderLinesAddedPayload,
  OrderPlacedPayload,
  PosEvent,
} from '@pos/events';
import { deadlineOf, InvalidEvent, isEngineLine, lineCookTimes, lineUnits, planNewLines } from './plan.js';
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
function listLines(
  state: EngineState,
  order: EngineOrder,
  p: { order_id: string; order_item_ids: string[]; groups: OrderGroupPayload[]; lines: OrderLinePayload[] },
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
    lines[id] = {
      order_item_id: id,
      order_id: p.order_id,
      group_id: group.group_id,
      serve_mode: 'sync',
      station_id: l.station_id,
      alternates: l.alternates.map((a) => ({ ...a })),
      point_id: l.point_id,
      carry_ms: l.carry_ms,
      units: 0,
      prep_ms: 0,
      cook_ms: 0,
      full_cook_ms: 0,
      from_stock: l.from_stock,
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
      mark: null,
      return_of: null,
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
function fillLine(state: EngineState, order: EngineOrder, listed: EngineLine, p: ItemAddedPayload): EngineLine {
  const id = p.order_item_id;
  const station = state.stations[listed.station_id];
  if (station === undefined) throw new InvalidEvent('station_missing', id, listed.station_id);
  if (p.serve_mode === null) throw new InvalidEvent('serve_mode_null', id, listed.station_id);
  try {
    const filled: EngineLine = {
      ...listed,
      serve_mode: p.serve_mode,
      units: lineUnits(p),
      prep_ms: p.prep_buffer_ms ?? 0,
      ...lineCookTimes(p, station.type, listed.from_stock),
      program_id: p.program_id,
      stock_program_id: p.stock_program_id,
      draws: p.stock_draws.map((d) => ({ stock_item_id: d.stock_item_id, quantity: d.quantity, reserved: 0 })),
    };
    return { ...filled, deadline_ms: deadlineOf(filled, order.groups[listed.group_id]!.target_land_ms) };
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
function foldItemAdded(state: EngineState, event: PosEvent, strict: boolean): EngineState {
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
  return updated.awaiting === 0 ? planNewLines(next, p.order_id, event.recorded_at, event.event_id) : next;
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
export type ApplyOptions = { strict?: boolean };

// AD-6: copy-on-write append for non-strict folds (a removeInterval underflow callback becomes a
// 'profile_underflow' with station_id / event_id; task 12's stock folds add 'stock_breach').
export function addDiagnostic(state: EngineState, d: Diagnostic): EngineState {
  return { ...state, diagnostics: [...state.diagnostics, d] };
}

// Pure fold (03a §6.1a, AD-6 opts). Handles exactly the ENGINE_REPLAY_EVENTS types; any other type returns
// `state` itself (S15). Copies only the touched entry. AD-6: a writer bug an order fold finds (InvalidEvent)
// throws when strict; non-strict returns the state unchanged but for one 'invalid_event' diagnostic. Other
// throws (OrderLinesAdded on an absent order, §3.3) throw in both modes.
export function applyEvent(state: EngineState, event: PosEvent, opts?: ApplyOptions): EngineState {
  const strict = opts?.strict ?? true;
  try {
    return fold(state, event, strict);
  } catch (e) {
    if (strict || !(e instanceof InvalidEvent)) throw e;
    // AD-6: non-strict never stops on a writer bug: the event changes nothing but the diagnostics.
    return addDiagnostic(state, invalidEventDiagnostic(event, e));
  }
}

function fold(state: EngineState, event: PosEvent, strict: boolean): EngineState {
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
      return foldItemAdded(state, event, strict);
    // 03a §3.12 types whose folds land in later tasks: unchanged until then.
    case 'ItemStarted':
    case 'ItemDone':
    case 'ItemDoneUndone':
    case 'ItemServed':
    case 'ItemRemoved':
    case 'ItemVoided':
    case 'ItemMovedToStock':
    case 'ItemReturned':
    case 'OrderBoosted':
    case 'ItemsReleased':
    case 'SlipWarned':
    case 'AlertClosed':
    case 'FireDispatched':
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
