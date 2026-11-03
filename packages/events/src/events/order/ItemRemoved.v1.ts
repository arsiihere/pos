import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03a §4.2: stage 1 removal (02).
export const ItemRemovedPayload = z.object({
  order_item_id: z.string(),
});
export type ItemRemovedPayload = z.infer<typeof ItemRemovedPayload>;

export const ItemRemoved = defineEvent({ eventType: 'ItemRemoved', version: 1, payload: ItemRemovedPayload });
