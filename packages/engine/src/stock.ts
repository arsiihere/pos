import type { Unit } from '@pos/domain';
import type { ConfigItem, ConfigStockItem } from '@pos/events';
import type { DayDraws, EngineState, StockEntry } from './state.js';

const NO_ENTRY: StockEntry = { on_hand: 0, reserved: 0, set_at: null, unit: 'piece' };

// 01a S14 (01c V5): a stock item with no entry reads as { 0, 0, null, 'piece' } (E1 stock AC6).
export function stockOf(state: EngineState, stockItemId: string): StockEntry {
  return state.stock[stockItemId] ?? { ...NO_ENTRY };
}

// 01a S33: the open day's start, the businessDayStartMs every caller passes.
export function openDayStartMs(state: EngineState): number | null {
  const day = state.business_day;
  return day !== null && day.closed_at === null ? day.opened_at : null;
}

// 01a S44 (01c §3.5.3): the stock unit frozen for the open day; else the stock item's own.
export function dayStockUnit(state: EngineState, stockItem: Pick<ConfigStockItem, 'stock_item_id' | 'stock_unit'>): Unit {
  const frozen = openDayStartMs(state) !== null ? state.business_day?.stock_units[stockItem.stock_item_id] : undefined;
  return frozen ?? stockItem.stock_unit;
}

// 01c V20: the sale unit and draws frozen for the open day. Fallback (m14, plan P-6): an item with no
// frozen entry uses the config's draws, except a draw whose stock item's frozen unit differs from its
// config unit (configStockUnits); that draw is not used until the next day open.
export function dayDraws(
  state: EngineState,
  item: Pick<ConfigItem, 'item_id' | 'sale_unit' | 'stock_draws'>,
  configStockUnits: Readonly<Record<string, Unit>>,
): DayDraws {
  const day = openDayStartMs(state) !== null ? state.business_day : null;
  const frozen = day?.draws[item.item_id];
  if (frozen !== undefined) {
    return { sale_unit: frozen.sale_unit, stock_draws: frozen.stock_draws.map((draw) => ({ ...draw })) };
  }
  const stockDraws = item.stock_draws.filter((draw) => {
    const frozenUnit = day?.stock_units[draw.stock_item_id];
    return frozenUnit === undefined || frozenUnit === configStockUnits[draw.stock_item_id];
  });
  return { sale_unit: item.sale_unit, stock_draws: stockDraws.map((draw) => ({ ...draw })) };
}

// 01a S41 (01c §3.5.1): the only place the validity rule lives; carries_over and the day's unit of the stock item.
export function countIsValid(
  entry: StockEntry,
  businessDayStartMs: number | null,
  stockItem: { carries_over: boolean; stock_unit: Unit },
): boolean {
  if (entry.set_at === null) return false;
  if (entry.unit !== stockItem.stock_unit) return false;
  if (!stockItem.carries_over && (businessDayStartMs === null || entry.set_at < businessDayStartMs)) return false;
  return true;
}

// 01a S41 (01c V5, §3.5.1): 0 when the count is not valid, else max(0, on_hand − reserved).
export function availableStock(
  state: EngineState,
  stockItemId: string,
  businessDayStartMs: number | null,
  stockItem: ConfigStockItem,
): number {
  const entry = stockOf(state, stockItemId);
  const valid = countIsValid(entry, businessDayStartMs, {
    carries_over: stockItem.carries_over,
    stock_unit: dayStockUnit(state, { stock_item_id: stockItemId, stock_unit: stockItem.stock_unit }),
  });
  return valid ? Math.max(0, entry.on_hand - entry.reserved) : 0;
}

// 01a S46 (01c §3.5.1): derived, no event. The threshold (stock_item_branches) is in the stock item's own
// stock_unit, so it applies only while the open day's frozen unit is that unit; otherwise no low until the next open.
export function stockLevel(
  state: EngineState,
  stockItemId: string,
  businessDayStartMs: number | null,
  stockItem: ConfigStockItem,
): 'not_counted' | 'out' | 'low' | 'ok' {
  const dayUnit = dayStockUnit(state, { stock_item_id: stockItemId, stock_unit: stockItem.stock_unit });
  const valid = countIsValid(stockOf(state, stockItemId), businessDayStartMs, {
    carries_over: stockItem.carries_over,
    stock_unit: dayUnit,
  });
  if (!valid) return 'not_counted';
  const available = availableStock(state, stockItemId, businessDayStartMs, stockItem);
  if (available === 0) return 'out';
  const threshold = dayUnit === stockItem.stock_unit ? stockItem.low_stock_threshold : null;
  if (threshold !== null && available <= threshold) return 'low';
  return 'ok';
}

// 01a S44: whole sale units the available stock covers.
export function saleUnitsAvailable(available: number, quantityPerSaleUnit: number): number {
  return Math.floor(available / quantityPerSaleUnit);
}

// 01a S14 (review 2 S-1; 01c §3.5.2 per draw): served from stock only when the whole line fits.
export function canServeFromStock(available: number, quantity: number, quantityPerSaleUnit: number): boolean {
  return available >= quantity * quantityPerSaleUnit;
}
