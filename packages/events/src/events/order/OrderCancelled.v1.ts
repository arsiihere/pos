import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 02b v1.0.2 §6.19 (stream order, id order_id); folded by 02a (P-1d), 02a SG-2.
export const OrderCancelledPayload = z
  .object({
    order_id: z.string(),
    // ⚠️ Changed by 04 (row Q-1, 02b v1.0.10 §6.19): set inside a void approval; folds ignore it.
    alert_id: z.string().optional(),
  })
  .strict();
export type OrderCancelledPayload = z.infer<typeof OrderCancelledPayload>;

export const OrderCancelled = defineEvent({ eventType: 'OrderCancelled', version: 1, payload: OrderCancelledPayload });
