import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03a §4.2, §3.9 (02, permission boost-order).
export const OrderBoostedPayload = z.object({
  order_id: z.string(),
});
export type OrderBoostedPayload = z.infer<typeof OrderBoostedPayload>;

export const OrderBoosted = defineEvent({ eventType: 'OrderBoosted', version: 1, payload: OrderBoostedPayload });
