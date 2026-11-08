import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03a §4.2 (04). 03a v1.2 Q-9: the two money fields are additive and optional at v1 (04 fills them).
export const ItemVoidedPayload = z.object({
  order_item_id: z.string(),
  units: z.number().int().min(1),
  refund_minor: z.number().int().optional(),
  comp_voided_minor: z.number().int().optional(),
});
export type ItemVoidedPayload = z.infer<typeof ItemVoidedPayload>;

export const ItemVoided = defineEvent({ eventType: 'ItemVoided', version: 1, payload: ItemVoidedPayload });
