import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { StockAddedPayload } from './StockAdded.v1.js';

// 01c V5, §5.3: keyed by stock_item_id; a v1 item id is the stock item's id (same ULID, §5.1).
export const StockAddedPayloadV2 = z.object({
  stock_item_id: z.string(),
  quantity: z.number().int().min(1).max(1_000_000),
  unit: z.enum(['piece', 'g', 'ml']),
  // 03a §4.5 A-19: additive within v2; absent = a manual add (S45), 'moved' = a portion moved to stock (§3.7).
  reason: z.literal('moved').optional(),
  // ⚠️ Changed by 04 (row T-1, 03a v1.2.4 §4.2): stamped by 04's writer inside an approval; never by stockEffects.
  alert_id: z.string().optional(),
});
export type StockAddedPayloadV2 = z.infer<typeof StockAddedPayloadV2>;

export const StockAddedV2 = defineEvent({
  eventType: 'StockAdded',
  version: 2,
  payload: StockAddedPayloadV2,
  upcastFromPrevious: (prev) => {
    const p = prev as z.infer<typeof StockAddedPayload>;
    return { stock_item_id: p.item_id, quantity: p.quantity, unit: p.unit };
  },
});
