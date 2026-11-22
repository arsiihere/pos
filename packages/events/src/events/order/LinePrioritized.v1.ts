import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03a v1.2.10 §4.2, §3.5.7 PR-3 (STAB-7): fires_alerts writes one per due group; stream = order_id.
// order_item_ids = the group's lines not yet started, in listing order. delay_ms / at_ms are display and audit only:
// the fold reads recorded_at and the state (review m-4).
export const LinePrioritizedPayload = z.object({
  order_id: z.string(),
  group_id: z.string(),
  order_item_ids: z.array(z.string()).min(1),
  delay_ms: z.number().int(),
  at_ms: z.number().int(),
});
export type LinePrioritizedPayload = z.infer<typeof LinePrioritizedPayload>;

export const LinePrioritized = defineEvent({ eventType: 'LinePrioritized', version: 1, payload: LinePrioritizedPayload });
