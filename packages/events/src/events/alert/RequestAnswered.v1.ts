import { z } from 'zod';
import { AnswerMethodSchema, RequestDecisionSchema } from '../../alerts.js';
import { defineEvent } from '../../registry.js';

// 01d §4.2: on_requester_device = device_id equals the alert's raised_device_id. Never carries the PIN.
export const RequestAnsweredPayload = z.object({
  alert_id: z.string(),
  decision: RequestDecisionSchema,
  answerer_staff_id: z.string(),
  method: AnswerMethodSchema,
  device_id: z.string(),
  on_requester_device: z.boolean(),
});
export type RequestAnsweredPayload = z.infer<typeof RequestAnsweredPayload>;

export const RequestAnswered = defineEvent({
  eventType: 'RequestAnswered',
  version: 1,
  payload: RequestAnsweredPayload,
});
