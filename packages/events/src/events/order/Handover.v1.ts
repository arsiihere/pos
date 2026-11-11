import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03b §6.22 (order / order_id): Handover; 1–40 lines (§6.8). The name stays Handover (03a To 03b #1, 02b §3.7, 01d K5).
const Id = z.string().min(1);

export const HandoverPayload = z.object({
  handover_id: Id,
  order_id: Id,
  point_id: Id,
  receiver_staff_id: Id,
  order_item_ids: z.array(Id).min(1).max(40),
  alert_id: Id,
  ready_alert_closed: Id.nullable(),
});
export type HandoverPayload = z.infer<typeof HandoverPayload>;

export const Handover = defineEvent({ eventType: 'Handover', version: 1, payload: HandoverPayload });
