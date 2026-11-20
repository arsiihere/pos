import { DISCOUNT_KINDS } from '@pos/domain';
import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { NoteId, PositiveMinor } from './parts.js';

// 05 §6.6, §6.29 (stream bill), H2-1, H3-5: approvable (`discount`); whole bill only (OQ-4). `value` = minor units for
// `amount`, basis points 1–10 000 for `percent`; `amount_minor` = the amount at apply. `reason_code` is one of the
// branch's owner-edited discount reasons (a code, not text). Reading: `replaces` (named by §6.6, type not given) is a
// boolean — true when this discount replaces one already on the bill.
export const DiscountAppliedPayload = z
  .object({
    bill_id: z.string(),
    kind: z.enum(DISCOUNT_KINDS),
    value: z.number().int().positive(),
    amount_minor: PositiveMinor,
    reason_code: z.string().min(1),
    has_note: z.boolean(),
    note_id: NoteId,
    requester_staff_id: z.string(),
    approver_staff_id: z.string().nullable(),
    alert_id: z.string().nullable(),
    replaces: z.boolean(),
  })
  .strict()
  .refine((p) => p.kind !== 'percent' || p.value <= 10_000, { message: 'percent value is 1–10 000 bp', path: ['value'] });
export type DiscountAppliedPayload = z.infer<typeof DiscountAppliedPayload>;

export const DiscountApplied = defineEvent({ eventType: 'DiscountApplied', version: 1, payload: DiscountAppliedPayload });
