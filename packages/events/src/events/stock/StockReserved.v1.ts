import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03a §4.2 (stock / stock_item_id), 01c V5; quantity in the stock item's unit.
export const StockReservedPayload = z.object({
  stock_item_id: z.string(),
  order_item_id: z.string(),
  quantity: z.number().int().min(1),
});
export type StockReservedPayload = z.infer<typeof StockReservedPayload>;

export const StockReserved = defineEvent({ eventType: 'StockReserved', version: 1, payload: StockReservedPayload });
