import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03a §4.2: stage 1 removal (02). 03a v1.2 Q-4: optional `units` (absent = the whole line).
export const ItemRemovedPayload = z.object({
  order_item_id: z.string(),
  units: z.number().int().min(1).optional(),
});
export type ItemRemovedPayload = z.infer<typeof ItemRemovedPayload>;

export const ItemRemoved = defineEvent({ eventType: 'ItemRemoved', version: 1, payload: ItemRemovedPayload });
