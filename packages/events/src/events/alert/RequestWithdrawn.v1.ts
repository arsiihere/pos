import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 01d §4.2
export const RequestWithdrawnPayload = z.object({
  alert_id: z.string(),
  by_staff_id: z.string(),
});
export type RequestWithdrawnPayload = z.infer<typeof RequestWithdrawnPayload>;

export const RequestWithdrawn = defineEvent({
  eventType: 'RequestWithdrawn',
  version: 1,
  payload: RequestWithdrawnPayload,
});
