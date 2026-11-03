import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03a §4.2, §3.7 (04): stockEffects gives StockReleased { reason: 'moved' } and StockAdded { reason: 'moved' }.
export const ItemMovedToStockPayload = z.object({
  order_item_id: z.string(),
  units: z.number().int().min(1),
});
export type ItemMovedToStockPayload = z.infer<typeof ItemMovedToStockPayload>;

export const ItemMovedToStock = defineEvent({ eventType: 'ItemMovedToStock', version: 1, payload: ItemMovedToStockPayload });
