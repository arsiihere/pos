import type { Unit } from '@pos/domain';
import type { ConfigItem } from '@pos/events';
import type { DayUnits, EngineState, StockEntry } from './state.js';

const NO_ENTRY: StockEntry = { on_hand: 0, reserved: 0, set_at: null, unit: 'piece' };

// 01a S14: an item with no entry reads as { 0, 0, null, 'piece' } (E1 stock AC6).
export function stockOf(state: EngineState, itemId: string): StockEntry {
  return state.stock[itemId] ?? { ...NO_ENTRY };
}

// 01a S44: the units in force for the item.
export function dayUnits(_state: EngineState, item: ConfigItem): DayUnits {
  return {
    stock_unit: item.stock_unit,
    sale_unit: item.sale_unit,
    stock_per_sale_unit: item.stock_per_sale_unit,
  };
}

// 01a S41: the only place the validity rule lives.
export function countIsValid(
  entry: StockEntry,
  businessDayStartMs: number | null,
  item: { carries_over: boolean; stock_unit: Unit },
): boolean {
  if (entry.set_at === null) return false;
  if (entry.unit !== item.stock_unit) return false;
  if (!item.carries_over && (businessDayStartMs === null || entry.set_at < businessDayStartMs)) return false;
  return true;
}

export function availableStock(
  state: EngineState,
  itemId: string,
  businessDayStartMs: number | null,
  item: ConfigItem,
): number {
  const entry = stockOf(state, itemId);
  const valid = countIsValid(entry, businessDayStartMs, {
    carries_over: item.carries_over,
    stock_unit: dayUnits(state, item).stock_unit,
  });
  return valid ? Math.max(0, entry.on_hand - entry.reserved) : 0;
}

// 01a S44: whole sale units the available stock covers.
export function saleUnitsAvailable(available: number, stockPerSaleUnit: number): number {
  return Math.floor(available / stockPerSaleUnit);
}

// 01a S14 (review 2 S-1): served from stock only when the whole line fits.
export function canServeFromStock(available: number, quantity: number, stockPerSaleUnit: number): boolean {
  return available >= quantity * stockPerSaleUnit;
}
