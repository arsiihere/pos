import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { countShape } from './count.js';

// 05 §6.17, §6.29 (stream shift), Q-2: counts and closes (with ShiftClosed in the same transaction);
// variance = counted − expected. ⚠️ 05 v1.0.7 (R-42 / G-39): `variance_alert_id` = the `shift_variance` request raised
// in the same transaction, null when |variance| ≤ the threshold; the `shifts` fold reads it, never the threshold.
export const ShiftCountedPayload = z
  .object({ ...countShape, variance_alert_id: z.string().nullable() })
  .strict()
  .refine((p) => p.variance_minor === p.counted_minor - p.expected_minor, { message: 'variance = counted − expected', path: ['variance_minor'] });
export type ShiftCountedPayload = z.infer<typeof ShiftCountedPayload>;

export const ShiftCounted = defineEvent({ eventType: 'ShiftCounted', version: 1, payload: ShiftCountedPayload });
