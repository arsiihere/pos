import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { NoteId } from './parts.js';

// 05 §6.11, §6.29 (stream bill), H4-4: approvable (`close_without_buyer_id`); no buyer field, ever (B19).
export const BuyerIdWaivedPayload = z
  .object({
    bill_id: z.string(),
    has_note: z.boolean(),
    note_id: NoteId,
    requester_staff_id: z.string(),
    approver_staff_id: z.string().nullable(),
    alert_id: z.string().nullable(),
  })
  .strict();
export type BuyerIdWaivedPayload = z.infer<typeof BuyerIdWaivedPayload>;

export const BuyerIdWaived = defineEvent({ eventType: 'BuyerIdWaived', version: 1, payload: BuyerIdWaivedPayload });
