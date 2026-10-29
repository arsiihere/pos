import type { Unit } from '@pos/domain';
import type { ConfigItem, ConfigItemV1, ConfigStockItem } from '@pos/events';
import type { DayDraws, EngineState, StockEntry } from './state.js';

const NO_ENTRY: StockEntry = { on_hand: 0, reserved: 0, set_at: null, unit: 'piece' };

// 01a S14: an item with no entry reads as { 0, 0, null, 'piece' } (E1 stock AC6).
export function stockOf(state: EngineState, itemId: string): StockEntry {
  return state.stock[itemId] ?? { ...NO_ENTRY };
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
  item: ConfigItemV1,
): number {
  const entry = stockOf(state, itemId);
  const valid = countIsValid(entry, businessDayStartMs, {
    carries_over: item.carries_over,
    stock_unit: dayStockUnit(state, { stock_item_id: itemId, stock_unit: item.stock_unit }),
  });
  return valid ? Math.max(0, entry.on_hand - entry.reserved) : 0;
}

// 01a S46: derived, no event. v1.0.2: the threshold is in the item's own stock_unit, so it applies only
// while the open day's frozen unit is that unit; otherwise no low until the next day open.
export function stockLevel(
  state: EngineState,
  itemId: string,
  businessDayStartMs: number | null,
  item: ConfigItemV1,
): 'not_counted' | 'out' | 'low' | 'ok' {
  const dayUnit = dayStockUnit(state, { stock_item_id: itemId, stock_unit: item.stock_unit });
  const valid = countIsValid(stockOf(state, itemId), businessDayStartMs, {
    carries_over: item.carries_over,
    stock_unit: dayUnit,
  });
  if (!valid) return 'not_counted';
  const available = availableStock(state, itemId, businessDayStartMs, item);
  if (available === 0) return 'out';
  const threshold = dayUnit === item.stock_unit ? item.low_stock_threshold : null;
  if (threshold !== null && available <= threshold) return 'low';
  return 'ok';
}

// 01a S44: whole sale units the available stock covers.
export function saleUnitsAvailable(available: number, stockPerSaleUnit: number): number {
  return Math.floor(available / stockPerSaleUnit);
}

// 01a S14 (review 2 S-1): served from stock only when the whole line fits.
export function canServeFromStock(available: number, quantity: number, stockPerSaleUnit: number): boolean {
  return available >= quantity * stockPerSaleUnit;
}
