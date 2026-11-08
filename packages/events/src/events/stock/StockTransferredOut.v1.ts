import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03a v1.2 §4.2 Q-5 (stock / stock_item_id), written by 02b zone refill; folded as a negative StockAdded (§3.7).
export const StockTransferredOutPayload = z.object({
  stock_item_id: z.string(),
  quantity: z.number().positive(),
  zone_id: z.string(),
});
export type StockTransferredOutPayload = z.infer<typeof StockTransferredOutPayload>;

export const StockTransferredOut = defineEvent({
  eventType: 'StockTransferredOut',
  version: 1,
  payload: StockTransferredOutPayload,
});
