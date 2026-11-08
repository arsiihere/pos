import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03a §4.2, §3.8: fires_alerts tick; stream = the oldest order_id; alert_id from raiseMany (v0.4 G2 #4).
export const SlipWarnedPayload = z.object({
  table_key: z.string(),
  order_ids: z.array(z.string()),
  alert_id: z.string(),
  estimated_land_ms: z.number().int(),
  target_land_ms: z.number().int(),
  promise_ms: z.number().int(),
});
export type SlipWarnedPayload = z.infer<typeof SlipWarnedPayload>;

export const SlipWarned = defineEvent({ eventType: 'SlipWarned', version: 1, payload: SlipWarnedPayload });
