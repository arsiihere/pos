import { PAYMENT_CLASSES } from '@pos/domain';
import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { NonNegativeMinor, PositiveMinor, SplitNo } from './parts.js';

// 05 §6.10, §6.29 (stream bill), H3-5: the note (if any) is in `bill_texts` under `payment_id`, so no `note_id`.
// ⚠️ 05 v1.0.7 (R-44 / G-39): + `shift_id`, `mode_id`, `payment_class`, `direction`, `amount_minor`, `change_minor`,
// `taken_by_staff_id`, copied from the removed payment as its `PaymentAdded` wrote them (`change_minor` 0 when it had
// no tender), so the `shifts` fold reverses the payment from the event alone. Ids and amounts only, no reference text.
export const PaymentRemovedPayload = z
  .object({
    payment_id: z.string(),
    bill_id: z.string(),
    split_no: SplitNo,
    reason_code: z.enum(['wrong_mode', 'wrong_amount', 'customer_changed', 'other']),
    has_note: z.boolean(),
    shift_id: z.string(),
    mode_id: z.string(),
    payment_class: z.enum(PAYMENT_CLASSES),
    direction: z.enum(['in', 'out']),
    amount_minor: PositiveMinor,
    change_minor: NonNegativeMinor,
    taken_by_staff_id: z.string(),
  })
  .strict();
export type PaymentRemovedPayload = z.infer<typeof PaymentRemovedPayload>;

export const PaymentRemoved = defineEvent({ eventType: 'PaymentRemoved', version: 1, payload: PaymentRemovedPayload });
