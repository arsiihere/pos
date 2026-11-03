import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03a §4.2, §3 #12.
export const ItemServedPayload = z.object({
  order_item_ids: z.array(z.string()).min(1),
  source: z.enum(['tap', 'estimated']),
});
export type ItemServedPayload = z.infer<typeof ItemServedPayload>;

export const ItemServed = defineEvent({ eventType: 'ItemServed', version: 1, payload: ItemServedPayload });
