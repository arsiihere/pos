import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 02b v1.0.2 §6.19 (stream order, id order_id); folded by 02a (P-1d), 02a SG-2.
export const OrderFoodServedPayload = z
  .object({
    order_id: z.string(),
  })
  .strict();
export type OrderFoodServedPayload = z.infer<typeof OrderFoodServedPayload>;

export const OrderFoodServed = defineEvent({ eventType: 'OrderFoodServed', version: 1, payload: OrderFoodServedPayload });
