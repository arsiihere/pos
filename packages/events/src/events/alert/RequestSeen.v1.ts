import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 01d §4.2, §3.6
export const RequestSeenPayload = z.object({
  alert_id: z.string(),
  staff_id: z.string(),
  device_id: z.string(),
});
export type RequestSeenPayload = z.infer<typeof RequestSeenPayload>;

export const RequestSeen = defineEvent({
  eventType: 'RequestSeen',
  version: 1,
  payload: RequestSeenPayload,
});
