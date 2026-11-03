import type { Unit } from '@pos/domain';
import type { EngineConfig, PosEvent } from '@pos/events';
import type { BreachReport, DayDraws, EngineState, StationRuntime } from './state.js';
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

// Pure fold (03a §6.1a). Handles exactly the ENGINE_REPLAY_EVENTS types; any other type returns `state`
// itself (S15). Copies only the touched entry. `report` receives stock invariant breaches (03a task 12).
export function applyEvent(state: EngineState, event: PosEvent, report?: BreachReport): EngineState {
  void report;
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
    // 03a §3.12 types whose folds land in later tasks: unchanged until then.
    case 'OrderPlaced':
    case 'OrderLinesAdded':
    case 'ItemAdded':
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

export function buildEngineState(events: Iterable<PosEvent>, report?: BreachReport): EngineState {
  let state = initialEngineState();
  for (const event of events) state = applyEvent(state, event, report);
  return state;
}
