import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03b §6.22 (order / order_id): tick ready_retarget (the Ready alert follows a table move).
const Id = z.string().min(1);

export const ReadyRetargetedPayload = z.object({
  order_id: Id,
  point_id: Id,
  table_id: Id,
  alert_id: Id,
  previous_alert_id: Id,
});
export type ReadyRetargetedPayload = z.infer<typeof ReadyRetargetedPayload>;

export const ReadyRetargeted = defineEvent({ eventType: 'ReadyRetargeted', version: 1, payload: ReadyRetargetedPayload });
