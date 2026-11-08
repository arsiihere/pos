import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { checkGroupIds, OrderGroupPayload, OrderLinePayload } from './OrderPlaced.v1.js';

// 03a §4.2 (P-10): OrderPlaced minus the order fields; lines also carry the return link and the
// `fix` cook time copied by 02 (D28, §3.8a; v0.2 pre-G2 #5).
export const OrderLinesAddedLinePayload = OrderLinePayload.extend({
  return_of: z.object({ order_item_id: z.string(), mode: z.enum(['fix', 'remake']) }).nullable(),
  cook_ms_override: z.number().int().nullable(),
});
export type OrderLinesAddedLinePayload = z.infer<typeof OrderLinesAddedLinePayload>;

export const OrderLinesAddedPayload = z
  .object({
    order_id: z.string(),
    order_item_ids: z.array(z.string()),
    groups: z.array(OrderGroupPayload),
    lines: z.array(OrderLinesAddedLinePayload),
  })
  .superRefine(checkGroupIds);
export type OrderLinesAddedPayload = z.infer<typeof OrderLinesAddedPayload>;

export const OrderLinesAdded = defineEvent({ eventType: 'OrderLinesAdded', version: 1, payload: OrderLinesAddedPayload });
