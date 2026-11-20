import type { FiscalSaleInvoiceFields } from '@pos/domain';
import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { buyerFlagsConsistent, buyerFlagsMessage, invoiceShape } from './invoice-parts.js';

// 05 §6.12 step 6, §6.29 (stream bill), J-1, J-2, H3-8, H9-6: the sale invoice. `discount_line_ids` = the bill's
// lines at the close that takes it from no closed split to one (R-29), else null. Satisfies 5a's
// `FiscalSaleInvoiceFields` (plan PL-16); `fiscal` refuses `required` with adapter `none` (R-8 / G-1).
export const InvoiceIssuedPayload = z
  .object({
    ...invoiceShape,
    series: z.literal('sale'),
    discount_line_ids: z.array(z.string()).nullable(),
  })
  .strict()
  .refine(buyerFlagsConsistent, buyerFlagsMessage()) satisfies z.ZodType<FiscalSaleInvoiceFields>;
export type InvoiceIssuedPayload = z.infer<typeof InvoiceIssuedPayload>;

export const InvoiceIssued = defineEvent({ eventType: 'InvoiceIssued', version: 1, payload: InvoiceIssuedPayload });
