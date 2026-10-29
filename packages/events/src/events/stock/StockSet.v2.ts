import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { StockSetPayload } from './StockSet.v1.js';

// 01c V5, §5.3: keyed by stock_item_id; a v1 item id is the stock item's id (same ULID, §5.1).
export const StockSetPayloadV2 = z.object({
  stock_item_id: z.string(),
  on_hand: z.number().int().min(0).max(1_000_000),
  unit: z.enum(['piece', 'g', 'ml']),
});
export type StockSetPayloadV2 = z.infer<typeof StockSetPayloadV2>;

export const StockSetV2 = defineEvent({
  eventType: 'StockSet',
  version: 2,
  payload: StockSetPayloadV2,
  upcastFromPrevious: (prev) => {
    const p = prev as z.infer<typeof StockSetPayload>;
    return { stock_item_id: p.item_id, on_hand: p.on_hand, unit: p.unit };
  },
});
