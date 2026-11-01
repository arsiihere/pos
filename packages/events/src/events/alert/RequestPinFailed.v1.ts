import { z } from 'zod';
import { StreamTypeSchema } from '../../envelope.js';
import { defineEvent } from '../../registry.js';

// 01d §4.2, §3.3 rule 4: on `audit` / alert_id. Never the PIN, never whether it matched: strict, so a
// stray key (a `pin`) is refused rather than stored.
export const RequestPinFailedPayload = z
  .object({
    alert_id: z.string(),
    subject_stream_type: StreamTypeSchema,
    subject_stream_id: z.string(),
    answerer_staff_id: z.string(),
    method: z.enum(['pin', 'in_person']),
    device_id: z.string(),
    requester_staff_id: z.string(),
    outcome: z.enum(['pin_invalid', 'answer_failed']),
    error_code: z.string().min(1), // PIN_INVALID or the prepare error's code
  })
  .strict();
export type RequestPinFailedPayload = z.infer<typeof RequestPinFailedPayload>;

export const RequestPinFailed = defineEvent({
  eventType: 'RequestPinFailed',
  version: 1,
  payload: RequestPinFailedPayload,
});
