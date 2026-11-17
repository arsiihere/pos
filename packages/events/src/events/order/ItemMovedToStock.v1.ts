import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03a §4.2, §3.7 (04): stockEffects gives StockReleased { reason: 'moved' } and StockAdded { reason: 'moved' }.
export const ItemMovedToStockPayload = z.object({
  order_item_id: z.string(),
  units: z.number().int().min(1),
  // ⚠️ Changed by 04 (row T-1, 03a v1.2.4 §4.2): stamped by 04's writer inside an approval; never by stockEffects.
  alert_id: z.string().optional(),
});
export type ItemMovedToStockPayload = z.infer<typeof ItemMovedToStockPayload>;

export const ItemMovedToStock = defineEvent({ eventType: 'ItemMovedToStock', version: 1, payload: ItemMovedToStockPayload });
