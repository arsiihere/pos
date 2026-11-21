import { COMP_REMOVE_REASONS } from '@pos/domain';
import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// ⚠️ Changed by 05 (row Q-4), 02b v1.0.16 §3.9, §6.19 (stream order, id order_id): written only by 05's RemoveComp
// on an unbilled line. No note text: `has_note` / `note_id` point at 05's `bill_texts` (05 v0.4 H2-22, v0.5.1 H4-4).
// `approver_staff_id` / `alert_id` are null on the direct path, set by an approval `apply` (05 §6.14).
export const LineCompRemovedPayload = z
  .object({
    order_item_id: z.string(),
    units: z.number().int().min(1),
    comp_minor: z.number().int().min(0),
    reason_code: z.enum(COMP_REMOVE_REASONS),
    has_note: z.boolean(),
    note_id: z.string().nullable(),
    requester_staff_id: z.string(),
    approver_staff_id: z.string().nullable(),
    alert_id: z.string().nullable(),
  })
  .strict();
export type LineCompRemovedPayload = z.infer<typeof LineCompRemovedPayload>;

export const LineCompRemoved = defineEvent({ eventType: 'LineCompRemoved', version: 1, payload: LineCompRemovedPayload });
