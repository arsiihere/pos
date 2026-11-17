import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03a §4.2, §3.7 (stock / stock_item_id): 'moved' replaces 'moved_to_stock' (v0.2); 'unit_changed' dropped
// (v0.4 G2 #21); 'abandoned' is written by the fires tick (v0.6 G4-2 #2).
export const StockReleasedPayload = z.object({
  stock_item_id: z.string(),
  order_item_id: z.string(),
  quantity: z.number().int().min(1),
  reason: z.enum(['removed', 'voided', 'moved', 'recount', 'day_closed', 'abandoned']),
  // ⚠️ Changed by 04 (row T-1, 03a v1.2.4 §4.2): stamped by 04's writer inside an approval; never by stockEffects.
  alert_id: z.string().optional(),
});
export type StockReleasedPayload = z.infer<typeof StockReleasedPayload>;

export const StockReleased = defineEvent({ eventType: 'StockReleased', version: 1, payload: StockReleasedPayload });
