import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { NoteId, RateBp } from './parts.js';

// 05 §6.8, §6.29 (stream bill): the service charge (re-)applied by rule or by hand; never after a removal by a read (B8).
// A rule charge has rate_bp ≥ 1: the ensure-bill step appends none when `service_charge_bp[order_type]` is 0 (§6.2).
export const ChargeAppliedPayload = z
  .object({
    bill_id: z.string(),
    charge: z.literal('service'),
    rate_bp: RateBp,
    source: z.enum(['rule', 'manual']),
    has_note: z.boolean(),
    note_id: NoteId,
  })
  .strict()
  .refine((p) => p.source !== 'rule' || p.rate_bp >= 1, { message: 'a rule charge has rate_bp ≥ 1 (0 → no event)', path: ['rate_bp'] });
export type ChargeAppliedPayload = z.infer<typeof ChargeAppliedPayload>;

export const ChargeApplied = defineEvent({ eventType: 'ChargeApplied', version: 1, payload: ChargeAppliedPayload });
