import type { Unit } from '@pos/domain';
import type { ConfigItem, ConfigStockItem, StockReservedPayload } from '@pos/events';
import { isEngineLine, type ProposedLine, type ProposedOrder } from './plan.js';
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

// ---- 03a §3.7 reserve at submit (§6.1e) ------------------------------------------------------------------------

// 03a §6.1e / interfaces.md `EventDraft<'StockReserved'>`. Proposed (implementer, overnight): @pos/events'
// EventDraft is not generic and carries envelope fields the engine does not know (occurred_at, actor_id,
// device_id); the engine drafts the event-specific part and the host stamps the envelope, as it does for the
// command's own drafts.
export type StockReservedDraft = {
  stream_type: 'stock';
  stream_id: string;
  event_type: 'StockReserved';
  schema_version: 1;
  payload: StockReservedPayload;
};

// 03a §6.1f: the context a StockAdded / ItemMovedToStock / StockSet draft needs (task 12b), as reserveStock takes it.
export type StockCtx = {
  dayStartMs: number;
  stockItems: ReadonlyArray<ConfigStockItem>;
  configStockUnits: Readonly<Record<string, Unit>>;
};

// 01c V12: a line is stock-tracked when it has a draw and a stock cook time on its station (slot: stock_time_ms;
// batch: the copied stock_program_cook_time_ms). A return line never draws (§3.8a, [03a #75]); a line that is not an
// engine line (a deal, no station, §3.2) is never reserved.
function isTracked(state: EngineState, line: ProposedLine): boolean {
  if (!isEngineLine(line) || line.return_of !== null || line.stock_draws.length === 0) return false;
  const batch = state.stations[line.station_id!]?.type === 'batch';
  return (batch ? line.stock_program_cook_time_ms : line.stock_time_ms) !== null;
}

// 03a §3.7 reserve at submit (F §5.9 step 5, F-9; 01c §3.5.2), pure. Lines in listing order; a line is served from
// stock only when every draw fits the available stock after the units already claimed by earlier lines of this
// command; then one StockReserved per draw (quantity = the draw on the line) and its draws are claimed. Otherwise
// it is not from stock (cook_fresh, the 01a S32 default when null) or refused (sold_out).
// The draws are the line's own `stock_draws` (ItemAdded.stock_draws, 01c §4.3: the whole line's quantity, i.e.
// units × quantity_per_sale_unit, built by 02 with dayDraws), so a StockReserved always equals the EngineLine.draws
// entry the fold copies (G4-1 #9); canServeFromStock(available, 1, draw) is therefore the S14 rule for the whole
// line. configStockUnits (§6.1e) is what dayDraws needs; proposed (implementer, overnight): the submit path reads
// the line's draws, not dayDraws, so it is accepted and not read here.
// Proposed (implementer, overnight): a sold_out line that does not fit is refused also when 0 < available < needed
// (§3.7 states the available-0 case; a sold_out item cannot be cooked fresh in time, 01a S32). A draw on a stock
// item that stockItems does not list reads as available 0. from_stock lists every proposed line (false unless
// reserved); refused lists the refused lines' order_item_ids in listing order.
export function reserveStock(
  state: EngineState,
  proposed: ProposedOrder,
  dayStartMs: number,
  stockItems: StockCtx['stockItems'],
  configStockUnits: StockCtx['configStockUnits'],
): { drafts: StockReservedDraft[]; from_stock: Record<string, boolean>; refused: string[] } {
  void configStockUnits;
  const items = new Map(stockItems.map((s) => [s.stock_item_id, s]));
  const claimed = new Map<string, number>();
  const drafts: StockReservedDraft[] = [];
  const from_stock: Record<string, boolean> = {};
  const refused: string[] = [];
  for (const line of proposed.lines) {
    from_stock[line.order_item_id] = false;
    if (!isTracked(state, line)) continue;
    const fits = line.stock_draws.every((d) => {
      const stockItem = items.get(d.stock_item_id);
      const available = stockItem === undefined ? 0 : availableStock(state, d.stock_item_id, dayStartMs, stockItem);
      return canServeFromStock(available - (claimed.get(d.stock_item_id) ?? 0), 1, d.quantity);
    });
    if (!fits) {
      if (line.out_of_stock_behaviour === 'sold_out') refused.push(line.order_item_id);
      continue;
    }
    from_stock[line.order_item_id] = true;
    for (const d of line.stock_draws) {
      claimed.set(d.stock_item_id, (claimed.get(d.stock_item_id) ?? 0) + d.quantity);
      drafts.push({
        stream_type: 'stock',
        stream_id: d.stock_item_id,
        event_type: 'StockReserved',
        schema_version: 1,
        payload: { stock_item_id: d.stock_item_id, order_item_id: line.order_item_id, quantity: d.quantity },
      });
    }
  }
  return { drafts, from_stock, refused };
}
