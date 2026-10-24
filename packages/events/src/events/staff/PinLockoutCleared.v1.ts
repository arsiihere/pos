import { z } from 'zod';
import { defineEvent } from '../../registry.js';

export const PinLockoutClearedPayload = z.object({
  subject_type: z.enum(['staff', 'device', 'ip']),
  subject_id: z.string(),
});

export const PinLockoutCleared = defineEvent({
  eventType: 'PinLockoutCleared',
  version: 1,
  payload: PinLockoutClearedPayload,
});
