import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// ⚠️ 02b v1.0.25 §6.19 (run 3 R3-M-3, R3-M-5, R3-M-8; D2, D3): order stream, stream id = the first affected order id.
// Appended once, batched, by the billing transaction whose money change moved a takeaway / parking bill's due. Both
// lists are unique, `order_ids` is nonempty and `approval_cleared_order_ids` is a subset of it (the orders whose
// effective unpaid hand-over approval this change ended, decided in the writer so replay reads no billing). No amounts
// or contact are broadcast. The orders fold clears both approval columns for the cleared subset.
const OrderIds = z.array(z.string().min(1)).refine((ids) => new Set(ids).size === ids.length, { message: 'order ids must be unique' });

export const OpenOrderBillChangedPayload = z
  .object({
    order_ids: OrderIds.refine((ids) => ids.length > 0, { message: 'at least one order id' }),
    approval_cleared_order_ids: OrderIds,
  })
  .strict()
  .refine((p) => p.approval_cleared_order_ids.every((id) => p.order_ids.includes(id)), {
    message: 'approval_cleared_order_ids must be a subset of order_ids',
    path: ['approval_cleared_order_ids'],
  });
export type OpenOrderBillChangedPayload = z.infer<typeof OpenOrderBillChangedPayload>;

export const OpenOrderBillChanged = defineEvent({ eventType: 'OpenOrderBillChanged', version: 1, payload: OpenOrderBillChangedPayload });
