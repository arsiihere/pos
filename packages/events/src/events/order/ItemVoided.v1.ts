import { VOID_DISPOSITIONS, VOID_REASON_CODES } from '@pos/domain';
import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03a §4.2 (04). 03a v1.2 Q-9: the two money fields are additive and optional at v1 (04 fills them).
export const ItemVoidedPayload = z.object({
  order_item_id: z.string(),
  units: z.number().int().min(1),
  refund_minor: z.number().int().optional(),
  comp_voided_minor: z.number().int().optional(),
  // ⚠️ Changed by 04 (row T-1, 03a v1.2.4 §4.2): additive, no version bump (R29); declared so they are not stripped.
  alert_id: z.string().nullable().optional(),
  approver_staff_id: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  disposition_note: z.string().nullable().optional(),
  requester_staff_id: z.string().optional(),
  reason_code: z.enum(VOID_REASON_CODES).optional(),
  disposition: z.enum(VOID_DISPOSITIONS).nullable().optional(),
});
export type ItemVoidedPayload = z.infer<typeof ItemVoidedPayload>;

export const ItemVoided = defineEvent({ eventType: 'ItemVoided', version: 1, payload: ItemVoidedPayload });
