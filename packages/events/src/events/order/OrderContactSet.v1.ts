import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 02b v1.0.2 §6.19, O17 (stream order, id order_id); audience: cashier kiosks and the placer's sockets.
export const OrderContactSetPayload = z
  .object({
    order_id: z.string(),
    customer_name: z.string().nullable(),
    phone: z.string().nullable(),
  })
  .strict();
export type OrderContactSetPayload = z.infer<typeof OrderContactSetPayload>;

export const OrderContactSet = defineEvent({ eventType: 'OrderContactSet', version: 1, payload: OrderContactSetPayload });
