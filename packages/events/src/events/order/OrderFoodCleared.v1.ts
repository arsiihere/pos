import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 02b v1.0.2 §6.19 (stream order, id order_id); folded by 02a (P-1d), 02a SG-2.
export const OrderFoodClearedPayload = z
  .object({
    order_id: z.string(),
    food_served: z.boolean(),
  })
  .strict();
export type OrderFoodClearedPayload = z.infer<typeof OrderFoodClearedPayload>;

export const OrderFoodCleared = defineEvent({ eventType: 'OrderFoodCleared', version: 1, payload: OrderFoodClearedPayload });
