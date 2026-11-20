import type { FiscalCreditInvoiceFields } from '@pos/domain';
import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { buyerFlagsConsistent, buyerFlagsMessage, invoiceShape } from './invoice-parts.js';

// 05 §6.13, §6.29 (stream bill), H2-1, H6-1, H9-6, B5: one credit per current sale invoice of a reopened bill. Its own
// id, number (credit series), `invoice_ref` ('C'), `business_date` (today) and `issued_at`; everything else — amounts,
// jurisdiction, currency, price mode, lines, tax rows, the `fiscal` snapshot — copied from the original, never re-read.
// Reading (5a's, `fiscal-snapshot.ts`): the credit carries every sale-invoice field except `discount_line_ids`
// (a first-close fact). `alert_id` null on the direct path. Satisfies `FiscalCreditInvoiceFields`.
export const InvoiceCreditedPayload = z
  .object({
    ...invoiceShape,
    series: z.literal('credit'),
    ref_invoice_id: z.string(),
    ref_invoice_ref: z.string().min(1),
    alert_id: z.string().nullable(),
  })
  .strict()
  .refine(buyerFlagsConsistent, buyerFlagsMessage()) satisfies z.ZodType<FiscalCreditInvoiceFields>;
export type InvoiceCreditedPayload = z.infer<typeof InvoiceCreditedPayload>;

export const InvoiceCredited = defineEvent({ eventType: 'InvoiceCredited', version: 1, payload: InvoiceCreditedPayload });
