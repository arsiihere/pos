import { z } from 'zod';
import { OWNER_CLOSE_REASONS } from '@pos/domain';
import { defineEvent } from '../../registry.js';

// 01d §4.2: the owner's reasons (§3.3) plus the tick's `expired` (§3.2).
export const AlertClosedPayload = z.object({
  alert_id: z.string(),
  reason: z.enum([...OWNER_CLOSE_REASONS, 'expired']),
  by_staff_id: z.string().nullable(),
  note: z.string().nullable(),
});
export type AlertClosedPayload = z.infer<typeof AlertClosedPayload>;

export const AlertClosed = defineEvent({
  eventType: 'AlertClosed',
  version: 1,
  payload: AlertClosedPayload,
});
