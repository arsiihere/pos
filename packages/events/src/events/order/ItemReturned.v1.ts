import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03a §4.2, §3.8a: written by 02 ReturnToKitchen for a remake only; fix writes none (D28).
export const ItemReturnedPayload = z.object({
  order_item_id: z.string(),
  mode: z.literal('remake'),
  replacement_order_item_id: z.string(),
});
export type ItemReturnedPayload = z.infer<typeof ItemReturnedPayload>;

export const ItemReturned = defineEvent({ eventType: 'ItemReturned', version: 1, payload: ItemReturnedPayload });
