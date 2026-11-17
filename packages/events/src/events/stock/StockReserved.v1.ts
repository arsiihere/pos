import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03a §4.2 (stock / stock_item_id), 01c V5; quantity in the stock item's unit.
export const StockReservedPayload = z.object({
  stock_item_id: z.string(),
  order_item_id: z.string(),
  quantity: z.number().int().min(1),
  // ⚠️ Changed by 04 (row T-1, 03a v1.2.4 §4.2): stamped by 04's writer inside an approval; never by stockEffects.
  alert_id: z.string().optional(),
});
export type StockReservedPayload = z.infer<typeof StockReservedPayload>;

export const StockReserved = defineEvent({ eventType: 'StockReserved', version: 1, payload: StockReservedPayload });
