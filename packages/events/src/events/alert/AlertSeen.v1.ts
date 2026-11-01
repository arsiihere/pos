import type { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { AlertDeliveredPayload } from './AlertDelivered.v1.js';

// 01d §4.2, §3.6: on `audit` / alert_id; as AlertDelivered, without `step`.
export const AlertSeenPayload = AlertDeliveredPayload.omit({ step: true });
export type AlertSeenPayload = z.infer<typeof AlertSeenPayload>;

export const AlertSeen = defineEvent({
  eventType: 'AlertSeen',
  version: 1,
  payload: AlertSeenPayload,
});
