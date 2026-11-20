import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { BusinessDate } from '../bill/parts.js';

// 05 §6.29 (stream shift), Q-2, H8-1: written only by the `shift_variance` request's apply, so `alert_id` and
// `approver_staff_id` (= AnswerFacts.answerer_staff_id) are always set. ⚠️ 05 v1.0.7 (R-44 / G-39): `business_date` = the
// open business day in the answer transaction (not the shift's own day), copied into `shift_signoffs.business_date`.
export const ShiftVarianceSignedOffPayload = z
  .object({
    shift_id: z.string(),
    outcome: z.enum(['approved', 'disputed']),
    alert_id: z.string(),
    approver_staff_id: z.string(),
    business_date: BusinessDate,
  })
  .strict();
export type ShiftVarianceSignedOffPayload = z.infer<typeof ShiftVarianceSignedOffPayload>;

export const ShiftVarianceSignedOff = defineEvent({ eventType: 'ShiftVarianceSignedOff', version: 1, payload: ShiftVarianceSignedOffPayload });
