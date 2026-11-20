import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { NonNegativeMinor } from './parts.js';

// 05 §6.3, §6.29 (stream bill), B17: a print, not a money event — ids and counts only. No printer → nulls.
// `source`: §6.3 names only 'manual' (the BillRequested print is a live-only fold and writes no event, §6.4).
export const CheckBillPrintedPayload = z
  .object({
    bill_id: z.string(),
    total_default_minor: NonNegativeMinor,
    line_count: z.number().int().nonnegative(),
    printer_id: z.string().nullable(),
    job_id: z.string().nullable(),
    source: z.enum(['manual']),
  })
  .strict();
export type CheckBillPrintedPayload = z.infer<typeof CheckBillPrintedPayload>;

export const CheckBillPrinted = defineEvent({ eventType: 'CheckBillPrinted', version: 1, payload: CheckBillPrintedPayload });
