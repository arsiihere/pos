import type { Unit } from '@pos/domain';

// 01a S14: all quantities are integers in `unit` (the stock item's stock unit, S44; 01c V5).
export interface StockEntry {
  on_hand: number;
  reserved: number;
  set_at: number | null;
  unit: Unit;
}

// 01c V20: an item's sale unit and draws, frozen for the open day.
export interface DayDraws {
  sale_unit: Unit;
  stock_draws: Array<{ stock_item_id: string; quantity_per_sale_unit: number }>;
}

// 01a S33: opened by BusinessDayOpened, closed by BusinessDayClosed.
// 01c §3.5.3: stock_units by stock_item_id, draws by item_id, frozen at the open.
export interface BusinessDay {
  business_date: string;
  opened_at: number;
  closed_at: number | null;
  stock_units: Record<string, Unit>;
  draws: Record<string, DayDraws>;
}

export interface EngineState {
  stock: Record<string, StockEntry>;
  business_day: BusinessDay | null;
}

export function initialEngineState(): EngineState {
  return { stock: {}, business_day: null };
}
