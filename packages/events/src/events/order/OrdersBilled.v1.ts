import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 02b v1.0.2 §6.19 (stream order, id = first order_id); bill_id from 05.
export const OrdersBilledPayload = z
  .object({
    order_ids: z.array(z.string()).min(1),
    bill_id: z.string(),
  })
  .strict();
export type OrdersBilledPayload = z.infer<typeof OrdersBilledPayload>;

export const OrdersBilled = defineEvent({ eventType: 'OrdersBilled', version: 1, payload: OrdersBilledPayload });
