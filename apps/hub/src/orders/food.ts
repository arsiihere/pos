// 02b §3.3 (P-1d, owner Q5) with §3.5, §3.7, §3.8: the food rules behind table state, pure (0 statements).
// AD-10: drafts without time / actor / device; the caller adds the envelope. AD-13: a serve names the lines it served.
import { isEngineLine } from '@pos/engine';
import type { ItemAddedPayload, OrderFoodClearedPayload, OrderFoodServedPayload } from '@pos/events';
import type { FoodDrafts, LineView } from './contracts.js';

type FoodLineInput = Pick<ItemAddedPayload, 'station_id' | 'line_kind' | 'served_from_zone_id' | 'is_ready_item'>;

/**
 * §3.3 food line (the stored `order_lines.is_food`): an engine line (03a `isEngineLine`: a station, not a `deal`;
 * owner 2026-11-11 AD-22) that is not zone-served and whose item is not a ready item.
 */
export function isFoodLine(l: FoodLineInput): boolean {
  return isEngineLine(l) && l.served_from_zone_id === null && !l.is_ready_item;
}

/** §3.4 deal headers: a `deal` line's live state is derived from its parts, so "live line" looks at parts only. */
const isLive = (l: LineView): boolean => l.line_kind !== 'deal' && l.live_units > 0;
/** §3.3 "live unserved food line". */
const isLiveUnservedFood = (l: LineView): boolean => l.is_food && isLive(l) && l.served_at === null;

type FoodDraft = ReturnType<FoodDrafts>[number];

const served = (order_id: string): FoodDraft => {
  const payload: OrderFoodServedPayload = { order_id };
  return { stream_type: 'order', stream_id: order_id, event_type: 'OrderFoodServed', schema_version: 1, payload };
};

const cleared = (order_id: string, food_served: boolean): FoodDraft => {
  const payload: OrderFoodClearedPayload = { order_id, food_served };
  return { stream_type: 'order', stream_id: order_id, event_type: 'OrderFoodCleared', schema_version: 1, payload };
};

/**
 * §3.3 / §3.5: `OrderFoodCleared` when the order keeps a live line but no live unserved food line. No live line → none
 * (the caller appends `OrderCancelled`, §3.5). `food_served` = a food line of the order has been served (`served_at`
 * set), counted from every row: a remade original, a served replacement, a line voided after its serve.
 */
function clearedIfNoUnservedFood(order_id: string, lines: readonly LineView[]): FoodDraft[] {
  if (!lines.some(isLive) || lines.some(isLiveUnservedFood)) return [];
  return [cleared(order_id, lines.some((l) => l.is_food && l.served_at !== null))];
}

export const foodDrafts: FoodDrafts = (order_id, lines, after) => {
  if (after === 'change') return clearedIfNoUnservedFood(order_id, lines);
  if (after === 'return') {
    // §3.3 / §3.8: only a non-food return clears; the open return's replacement is the live unserved line with return_of
    const byId = new Map(lines.map((l) => [l.order_item_id, l]));
    const returnedFood = lines.some((l) => l.return_of !== null && isLive(l) && l.served_at === null && byId.get(l.return_of)?.is_food === true);
    return returnedFood ? [] : clearedIfNoUnservedFood(order_id, lines);
  }
  // §3.7 / AD-13: OrderFoodServed only when this ItemServed served at least one food line
  const ids = new Set(after.order_item_ids);
  return lines.some((l) => ids.has(l.order_item_id) && l.is_food) ? [served(order_id)] : [];
};
