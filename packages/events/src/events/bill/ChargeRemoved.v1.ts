import { CHARGE_REMOVE_REASONS } from '@pos/domain';
import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { NoteId } from './parts.js';

// 05 §6.8, §6.29 (stream bill), H2-1: approvable (`remove_service_charge`); `alert_id` / `approver_staff_id` null on the
// direct path, the request's on an approval `apply`.
export const ChargeRemovedPayload = z
  .object({
    bill_id: z.string(),
    charge: z.literal('service'),
    reason_code: z.enum(CHARGE_REMOVE_REASONS),
    has_note: z.boolean(),
    note_id: NoteId,
    requester_staff_id: z.string(),
    approver_staff_id: z.string().nullable(),
    alert_id: z.string().nullable(),
  })
  .strict();
export type ChargeRemovedPayload = z.infer<typeof ChargeRemovedPayload>;

export const ChargeRemoved = defineEvent({ eventType: 'ChargeRemoved', version: 1, payload: ChargeRemovedPayload });
