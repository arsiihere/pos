import type { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { AttemptSentPayload } from './AttemptSent.v1.js';

// 01d §4.2: as AttemptSent, for a step with `escalation: true`.
export const EscalationSteppedPayload = AttemptSentPayload;
export type EscalationSteppedPayload = z.infer<typeof EscalationSteppedPayload>;

export const EscalationStepped = defineEvent({
  eventType: 'EscalationStepped',
  version: 1,
  payload: EscalationSteppedPayload,
});
