import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03a §4.2, §3.7 (stock / stock_item_id).
export const StockConsumedPayload = z.object({
  stock_item_id: z.string(),
  order_item_id: z.string(),
  quantity: z.number().int().min(1),
});
export type StockConsumedPayload = z.infer<typeof StockConsumedPayload>;

export const StockConsumed = defineEvent({ eventType: 'StockConsumed', version: 1, payload: StockConsumedPayload });
