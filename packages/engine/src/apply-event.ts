import type { Unit } from '@pos/domain';
import type { PosEvent } from '@pos/events';
import type { DayUnits, EngineState } from './state.js';
import { initialEngineState } from './state.js';
import { stockOf } from './stock.js';

// Payloads as validated by the @pos/events schemas (§4.2).
interface StockSet { item_id: string; on_hand: number; unit: Unit }
interface StockAdded { item_id: string; quantity: number; unit: Unit }
interface BusinessDayOpened { business_date: string; units: Record<string, DayUnits> }

// Pure fold. Copies only the touched entry; unknown events return `state` itself (S15).
export function applyEvent(state: EngineState, event: PosEvent): EngineState {
  switch (event.event_type) {
    case 'StockSet': {
      const p = event.payload as unknown as StockSet;
      const prev = stockOf(state, p.item_id);
      return {
        ...state,
        stock: {
          ...state.stock,
          [p.item_id]: { on_hand: p.on_hand, reserved: prev.reserved, set_at: event.recorded_at, unit: p.unit },
        },
      };
    }
    case 'StockAdded': {
      const p = event.payload as unknown as StockAdded;
      const prev = stockOf(state, p.item_id);
      if (prev.unit !== p.unit) throw new Error('StockAdded unit mismatch');
      return {
        ...state,
        stock: { ...state.stock, [p.item_id]: { ...prev, on_hand: prev.on_hand + p.quantity } },
      };
    }
    // 01a S33: recorded_at is the day's start and end.
    case 'BusinessDayOpened': {
      const p = event.payload as unknown as BusinessDayOpened;
      return {
        ...state,
        business_day: { business_date: p.business_date, opened_at: event.recorded_at, closed_at: null, units: p.units },
      };
    }
    case 'BusinessDayClosed': {
      const day = state.business_day;
      if (day === null || day.closed_at !== null) return state;
      return { ...state, business_day: { ...day, closed_at: event.recorded_at } };
    }
    default:
      return state;
  }
}

export function buildEngineState(events: readonly PosEvent[]): EngineState {
  return events.reduce(applyEvent, initialEngineState());
}
