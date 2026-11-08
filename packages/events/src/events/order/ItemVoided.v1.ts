import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03a §4.2 (04).
export const ItemVoidedPayload = z.object({
  order_item_id: z.string(),
  units: z.number().int().min(1),
});
export type ItemVoidedPayload = z.infer<typeof ItemVoidedPayload>;

export const ItemVoided = defineEvent({ eventType: 'ItemVoided', version: 1, payload: ItemVoidedPayload });
