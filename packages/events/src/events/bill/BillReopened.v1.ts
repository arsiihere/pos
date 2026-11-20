import { BILL_REOPEN_REASONS } from '@pos/domain';
import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { NoteId } from './parts.js';

// 05 §6.13, §6.29 (stream bill), H2-1, H3-2, H4-1: approvable (`reopen_bill`); first draft of the reopen, so its
// fold fills `bill_orders` (INSERT OR IGNORE) before any later read. The payload is §6.13's list, plus `mode`
// (owner ruling R-40, 05 v1.0.7): the §3.10 mode decided in the transaction, folded into `bills.reopen_mode`.
export const BillReopenedPayload = z
  .object({
    bill_id: z.string(),
    order_ids: z.array(z.string()).min(1),
    mode: z.enum(['full', 'corrections']),
    reason_code: z.enum(BILL_REOPEN_REASONS),
    has_note: z.boolean(),
    note_id: NoteId,
    requester_staff_id: z.string(),
    approver_staff_id: z.string().nullable(),
    alert_id: z.string().nullable(),
  })
  .strict();
export type BillReopenedPayload = z.infer<typeof BillReopenedPayload>;

export const BillReopened = defineEvent({ eventType: 'BillReopened', version: 1, payload: BillReopenedPayload });
