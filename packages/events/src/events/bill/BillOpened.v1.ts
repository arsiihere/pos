import { ROUNDING_APPLIES_TO, ROUNDING_METHODS } from '@pos/domain';
import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { OrderType } from './parts.js';

// 05 §6.29 (stream bill, id bill_id), H2-16, H9-9, H16-2: `bill_key` non-null for scope `key`; the price mode and
// the rounding rule in force at open are frozen for the bill. §5 CHECKs: scope seating ⇔ seating_id, key ⇔ bill_key.
export const BillOpenedPayload = z
  .object({
    bill_id: z.string(),
    scope: z.enum(['seating', 'key']),
    seating_id: z.string().nullable(),
    bill_key: z.string().nullable(),
    order_type: OrderType,
    prices_include_tax: z.boolean(),
    rounding: z
      .object({
        step_minor: z.number().int().positive().nullable(),
        mode: z.enum(ROUNDING_METHODS),
        applies_to: z.enum(ROUNDING_APPLIES_TO),
      })
      .strict(),
  })
  .strict()
  .refine((p) => (p.scope === 'seating') === (p.seating_id !== null) && (p.scope === 'key') === (p.bill_key !== null), {
    message: 'scope seating needs seating_id only; scope key needs bill_key only',
  });
export type BillOpenedPayload = z.infer<typeof BillOpenedPayload>;

export const BillOpened = defineEvent({ eventType: 'BillOpened', version: 1, payload: BillOpenedPayload });
