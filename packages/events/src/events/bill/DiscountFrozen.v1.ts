import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { NonNegativeMinor } from './parts.js';

// 05 v1.0.7 §6.29, §6.12 step 6, §5 (owner ruling R-41 / G-38; stream bill): appended by `CloseSplit` right after
// `InvoiceIssued` at the close that takes the bill from no closed split to one (R-29). `frozen_minor` = the whole bill's
// discount frozen at that close (B7, §3.5 (2); 0 with no discount); `line_ids` = the set folded into `bill_discount_lines`
// (= that `InvoiceIssued.discount_line_ids`). The only source of `bills.discount_json.frozen_minor`; a `BillReopened`
// clears the freeze. No audit action of its own (the close audits `invoice_issued`).
export const DiscountFrozenPayload = z
  .object({
    bill_id: z.string(),
    frozen_minor: NonNegativeMinor,
    line_ids: z.array(z.string()),
  })
  .strict();
export type DiscountFrozenPayload = z.infer<typeof DiscountFrozenPayload>;

export const DiscountFrozen = defineEvent({ eventType: 'DiscountFrozen', version: 1, payload: DiscountFrozenPayload });
