import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03a v1.2 §4.2 Q-5 (stock / stock_item_id), written by 02b zone refill; folded as a negative StockAdded (§3.7).
// 01a S44: every stock quantity is an integer in the smallest unit (owner ruling AD-1, 2026-11-08).
export const StockTransferredOutPayload = z.object({
  stock_item_id: z.string(),
  quantity: z.number().int().min(1),
  zone_id: z.string(),
});
export type StockTransferredOutPayload = z.infer<typeof StockTransferredOutPayload>;

export const StockTransferredOut = defineEvent({
  eventType: 'StockTransferredOut',
  version: 1,
  payload: StockTransferredOutPayload,
});
