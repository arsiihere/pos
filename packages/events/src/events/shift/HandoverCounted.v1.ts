import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { countShape } from './count.js';

// 05 §6.19, §6.29 (stream shift): a drawer handover count; the shift stays open.
export const HandoverCountedPayload = z
  .object(countShape)
  .strict()
  .refine((p) => p.variance_minor === p.counted_minor - p.expected_minor, { message: 'variance = counted − expected', path: ['variance_minor'] });
export type HandoverCountedPayload = z.infer<typeof HandoverCountedPayload>;

export const HandoverCounted = defineEvent({ eventType: 'HandoverCounted', version: 1, payload: HandoverCountedPayload });
