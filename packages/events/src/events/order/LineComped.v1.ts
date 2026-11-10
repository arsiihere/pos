import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 02b v1.0.2 §6.19 (stream order, id order_id); folded by 02a (P-1d), 02a SG-2.
export const LineCompedPayload = z
  .object({
    order_item_id: z.string(),
    units: z.number().int().min(1),
    value_minor: z.number().int(),
    reason_code: z.string(),
    note: z.string().nullable(),
    requester_staff_id: z.string(),
    alert_id: z.string().nullable(),
    approver_staff_id: z.string().nullable(),
  })
  .strict();
export type LineCompedPayload = z.infer<typeof LineCompedPayload>;

export const LineComped = defineEvent({ eventType: 'LineComped', version: 1, payload: LineCompedPayload });
