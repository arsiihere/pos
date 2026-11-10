import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 02b v1.0.2 §6.19, AD-6 (stream table, id 'zone:' + zone_id); fold: count =.
export const ZoneStockSetPayload = z
  .object({
    zone_id: z.string(),
    item_id: z.string(),
    on_hand: z.number().int(),
    previous: z.number().int(),
  })
  .strict();
export type ZoneStockSetPayload = z.infer<typeof ZoneStockSetPayload>;

export const ZoneStockSet = defineEvent({ eventType: 'ZoneStockSet', version: 1, payload: ZoneStockSetPayload });
