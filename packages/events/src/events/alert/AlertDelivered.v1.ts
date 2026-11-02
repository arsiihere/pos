import { z } from 'zod';
import { StreamTypeSchema } from '../../envelope.js';
import { defineEvent } from '../../registry.js';

// 01d §4.2, §3.6: on `audit` / alert_id. staff_id = the device's bound person for an alert-mode receipt.
export const AlertDeliveredPayload = z.object({
  alert_id: z.string(),
  subject_stream_type: StreamTypeSchema,
  subject_stream_id: z.string(),
  staff_id: z.string().nullable(),
  device_id: z.string(),
  route: z.string().min(1),
  step: z.number().int().min(0),
});
export type AlertDeliveredPayload = z.infer<typeof AlertDeliveredPayload>;

export const AlertDelivered = defineEvent({
  eventType: 'AlertDelivered',
  version: 1,
  payload: AlertDeliveredPayload,
});
