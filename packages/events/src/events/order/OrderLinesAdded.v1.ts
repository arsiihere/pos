import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { checkGroupIds, OrderGroupPayload, OrderLinePayload, OrderPlacedPayload } from './OrderPlaced.v1.js';

// 03a §4.2 (P-10): OrderPlaced minus the order fields; lines also carry the return link and the
// `fix` cook time copied by 02 (D28, §3.8a; v0.2 pre-G2 #5).
export const OrderLinesAddedLinePayload = OrderLinePayload.extend({
  return_of: z.object({ order_item_id: z.string(), mode: z.enum(['fix', 'remake']) }).nullable(),
  cook_ms_override: z.number().int().nullable(),
});
export type OrderLinesAddedLinePayload = z.infer<typeof OrderLinesAddedLinePayload>;

// 03a v1.2 §3.3 E-4, §4.2 (owner ruling 2026-11-09): the order fields of the order's OrderPlaced, set by 02b on every
// OrderLinesAdded. The engine reads them only for an order it does not hold ("drinks first, food later"). Optional at
// v1: absent, never null (re-check R-4), so every logged OrderLinesAdded still parses.
export const OrderLinesAddedHeader = z.object({
  order_type: OrderPlacedPayload.shape.order_type,
  table_key: z.string(),
  table_id: z.string().nullable(),
  follow_up: z.boolean(),
  pickup_at_ms: z.number().int().nullable(),
  placed_by: z.string().nullable(),
});
export type OrderLinesAddedHeader = z.infer<typeof OrderLinesAddedHeader>;

export const OrderLinesAddedPayload = z
  .object({
    order_id: z.string(),
    order_item_ids: z.array(z.string()),
    groups: z.array(OrderGroupPayload),
    lines: z.array(OrderLinesAddedLinePayload),
    order_header: OrderLinesAddedHeader.optional(),
  })
  .superRefine(checkGroupIds);
export type OrderLinesAddedPayload = z.infer<typeof OrderLinesAddedPayload>;

export const OrderLinesAdded = defineEvent({ eventType: 'OrderLinesAdded', version: 1, payload: OrderLinesAddedPayload });
