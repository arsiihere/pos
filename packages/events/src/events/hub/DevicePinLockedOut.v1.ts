import { z } from 'zod';
import { defineEvent } from '../../registry.js';

export const DevicePinLockedOutPayload = z.object({
  subject_type: z.enum(['device', 'ip']),
  subject_id: z.string(),
  locked_until: z.number().int(),
  failed_count: z.number().int(),
});

export const DevicePinLockedOut = defineEvent({
  eventType: 'DevicePinLockedOut',
  version: 1,
  payload: DevicePinLockedOutPayload,
});
