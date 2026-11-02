import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 01d §4.2, §3.5: `superseded` (several steps due at once, A8) or `shortcut` (G1-9d).
export const StepSkippedPayload = z.object({
  alert_id: z.string(),
  step: z.number().int().min(0),
  reason: z.enum(['superseded', 'shortcut']),
});
export type StepSkippedPayload = z.infer<typeof StepSkippedPayload>;

export const StepSkipped = defineEvent({
  eventType: 'StepSkipped',
  version: 1,
  payload: StepSkippedPayload,
});
