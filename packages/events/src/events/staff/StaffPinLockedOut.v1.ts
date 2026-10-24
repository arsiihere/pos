import { z } from 'zod';
import { defineEvent } from '../../registry.js';

export const StaffPinLockedOutPayload = z.object({
  staff_id: z.string(),
  locked_until: z.number().int(),
  failed_count: z.number().int(),
});

export const StaffPinLockedOut = defineEvent({
  eventType: 'StaffPinLockedOut',
  version: 1,
  payload: StaffPinLockedOutPayload,
});
