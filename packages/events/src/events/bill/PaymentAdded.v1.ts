import { PAYMENT_CLASSES } from '@pos/domain';
import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { PositiveMinor, SplitNo } from './parts.js';

// 05 §6.9, §6.29 (stream bill), H1-2, H1-20, B11: `has_reference` only — the reference text is in the hub-only
// `payment_references`, never here. `tendered_minor` only on a cash `in` (H2-28); `change_minor` = tendered − amount
// (cash only); both null otherwise. §5 CHECKs: amount > 0, tendered ≥ amount.
export const PaymentAddedPayload = z
  .object({
    payment_id: z.string(),
    bill_id: z.string(),
    split_no: SplitNo,
    mode_id: z.string(),
    payment_class: z.enum(PAYMENT_CLASSES),
    direction: z.enum(['in', 'out']),
    amount_minor: PositiveMinor,
    tendered_minor: PositiveMinor.nullable(),
    change_minor: z.number().int().nonnegative().nullable(),
    has_reference: z.boolean(),
    taken_by_staff_id: z.string(),
    shift_id: z.string(),
  })
  .strict()
  .refine(
    (p) =>
      p.tendered_minor === null
        ? p.change_minor === null
        : p.payment_class === 'cash' && p.direction === 'in' && p.change_minor === p.tendered_minor - p.amount_minor,
    { message: 'tendered / change only on a cash in; change = tendered − amount', path: ['change_minor'] },
  );
export type PaymentAddedPayload = z.infer<typeof PaymentAddedPayload>;

export const PaymentAdded = defineEvent({ eventType: 'PaymentAdded', version: 1, payload: PaymentAddedPayload });
