import { z } from 'zod';
import { RecipientSetSchema } from '../../alerts.js';
import { defineEvent } from '../../registry.js';

// 01d §4.2: one step sent, on the subject's stream. `route`: 'screen' | 'alert_connection' | a registered route.
export const AttemptSentPayload = z.object({
  alert_id: z.string(),
  step: z.number().int().min(0),
  recipients: z.array(
    z.object({
      staff_id: z.string().nullable(),
      device_id: z.string().nullable(),
      for_staff_id: z.string().nullable(),
      set: RecipientSetSchema,
    }),
  ),
  routes: z.array(
    z.object({
      staff_id: z.string().nullable(),
      route: z.string().min(1),
      ref: z.string(),
    }),
  ),
});
export type AttemptSentPayload = z.infer<typeof AttemptSentPayload>;

export const AttemptSent = defineEvent({
  eventType: 'AttemptSent',
  version: 1,
  payload: AttemptSentPayload,
});
