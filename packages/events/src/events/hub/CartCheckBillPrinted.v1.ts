import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { NonNegativeMinor } from '../bill/parts.js';

// ⚠️ 05 v1.0.35 §6.3a, §6.29 (R2-M-4, OWNER default written; run 3 R3-M-7): the paper check bill of an unsent or
// addition takeaway / parking cart. Hub stream, stream id = the branch id; ids and counts only (no bill id, no order id,
// no line text). No printer → nulls. Appended only by PrintCartCheckBill; audit action cart_check_bill_printed (04).
export const CartCheckBillPrintedPayload = z
  .object({
    job_id: z.string().nullable(),
    printer_id: z.string().nullable(),
    line_count: z.number().int().nonnegative(),
    total_default_minor: NonNegativeMinor,
    device_id: z.string(),
  })
  .strict();
export type CartCheckBillPrintedPayload = z.infer<typeof CartCheckBillPrintedPayload>;

export const CartCheckBillPrinted = defineEvent({ eventType: 'CartCheckBillPrinted', version: 1, payload: CartCheckBillPrintedPayload });
