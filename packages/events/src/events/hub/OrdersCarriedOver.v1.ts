import { CARRY_OVER_REASONS } from '@pos/domain';
import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { BusinessDate } from '../bill/parts.js';

// 05 §6.24 / §6.29 (stream hub, id branch_id): written by 05's CarryOverOrders; folded by 02b's `orders` projection
// (05 row Q-5, 02b v1.0.16 §3.3). No note text: `has_note` / `note_id` point at 05's `bill_texts`; `note_id` is null when
// there is no note. Integrator ruling S-A (a): lands with 05-plan P0.13; task 5 skips it.
export const OrdersCarriedOverPayload = z
  .object({
    order_ids: z.array(z.string()).min(1),
    business_date: BusinessDate,
    reason_code: z.enum(CARRY_OVER_REASONS),
    has_note: z.boolean(),
    note_id: z.string().nullable(),
  })
  .strict();
export type OrdersCarriedOverPayload = z.infer<typeof OrdersCarriedOverPayload>;

export const OrdersCarriedOver = defineEvent({ eventType: 'OrdersCarriedOver', version: 1, payload: OrdersCarriedOverPayload });
