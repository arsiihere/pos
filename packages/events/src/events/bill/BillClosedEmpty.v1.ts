import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 05 §6.29 (stream bill), H6-6, H7-3, H8-5, H8-6: the one payload. `seating_id` only under §6.12's BillClosed rule,
// else null; `alert_id` present only inside an approval `apply` (absent, never null, on the direct path).
export const BillClosedEmptyPayload = z
  .object({
    bill_id: z.string(),
    seating_id: z.string().nullable(),
    credit_invoice_ids: z.array(z.string()),
    alert_id: z.string().optional(),
  })
  .strict();
export type BillClosedEmptyPayload = z.infer<typeof BillClosedEmptyPayload>;

export const BillClosedEmpty = defineEvent({ eventType: 'BillClosedEmpty', version: 1, payload: BillClosedEmptyPayload });
