import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 02b v1.0.2 §6.19 (stream order, id order_id); folded by 02a (P-1d), 02a SG-2.
export const OrderFoodClearedPayload = z
  .object({
    order_id: z.string(),
    food_served: z.boolean(),
    // ⚠️ Changed by 04 (row Q-1, 02b v1.0.10 §6.19): set inside a void approval; folds ignore it.
    alert_id: z.string().optional(),
  })
  .strict();
export type OrderFoodClearedPayload = z.infer<typeof OrderFoodClearedPayload>;

export const OrderFoodCleared = defineEvent({ eventType: 'OrderFoodCleared', version: 1, payload: OrderFoodClearedPayload });
