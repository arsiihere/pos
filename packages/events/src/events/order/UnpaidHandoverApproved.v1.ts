import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { PositiveMinor } from '../bill/parts.js';

// ⚠️ 02b v1.0.25 §3.7a Approve, §6.19 (OR-7; run 3 R3-M-2, R3-M-5, R3-M-8; D2): order stream, stream id = order_id.
// The approval covers only the named order and the due verified at approval time (due_minor, positive). The orders
// fold sets unpaid_handover_approved_at = recorded_at and the approved due; the event stays for audit and replay.
export const UnpaidHandoverApprovedPayload = z
  .object({
    order_id: z.string(),
    alert_id: z.string(),
    approved_by_staff_id: z.string(),
    due_minor: PositiveMinor,
  })
  .strict();
export type UnpaidHandoverApprovedPayload = z.infer<typeof UnpaidHandoverApprovedPayload>;

export const UnpaidHandoverApproved = defineEvent({ eventType: 'UnpaidHandoverApproved', version: 1, payload: UnpaidHandoverApprovedPayload });
