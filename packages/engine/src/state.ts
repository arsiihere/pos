import type { Unit } from '@pos/domain';

// 01a S14: all quantities are integers in `unit` (the item's stock unit, S44).
export interface StockEntry {
  on_hand: number;
  reserved: number;
  set_at: number | null;
  unit: Unit;
}

export interface DayUnits {
  stock_unit: Unit;
  sale_unit: Unit;
  stock_per_sale_unit: number;
}

// 01a S33: opened by BusinessDayOpened, closed by BusinessDayClosed.
export interface BusinessDay {
  business_date: string;
  opened_at: number;
  closed_at: number | null;
  units: Record<string, DayUnits>;
}

export interface EngineState {
  stock: Record<string, StockEntry>;
  business_day: BusinessDay | null;
}

export function initialEngineState(): EngineState {
  return { stock: {}, business_day: null };
}
