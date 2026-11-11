import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 02b v1.0.2 §6.19, AD-6 (stream table, id 'zone:' + zone_id); fold: count +.
export const ZoneStockAddedPayload = z
  .object({
    zone_id: z.string(),
    item_id: z.string(),
    quantity: z.number().int(),
    transfers: z.array(z.object({ stock_item_id: z.string(), quantity: z.number().int() }).strict()),
  })
  .strict();
export type ZoneStockAddedPayload = z.infer<typeof ZoneStockAddedPayload>;

export const ZoneStockAdded = defineEvent({ eventType: 'ZoneStockAdded', version: 1, payload: ZoneStockAddedPayload });
