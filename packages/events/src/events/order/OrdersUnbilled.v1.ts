import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// ⚠️ Changed by 05 (row Q-2), 02b v1.0.16 §3.3, §6.19 (stream order, id = first order_id): written by 05's reopen;
// `alert_id` present on an approval (never null). Fold: billed_at = NULL and day_closed_at = NULL for those orders.
export const OrdersUnbilledPayload = z
  .object({
    order_ids: z.array(z.string()).min(1),
    bill_id: z.string(),
    alert_id: z.string().optional(),
  })
  .strict();
export type OrdersUnbilledPayload = z.infer<typeof OrdersUnbilledPayload>;

export const OrdersUnbilled = defineEvent({ eventType: 'OrdersUnbilled', version: 1, payload: OrdersUnbilledPayload });
