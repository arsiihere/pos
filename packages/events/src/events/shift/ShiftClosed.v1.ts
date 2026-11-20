import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { NoteId } from '../bill/parts.js';

// 05 §6.17 / §6.18, §6.29 (stream shift), H2-1, H4-4: `closed_by` = the staff id who closed it.
export const ShiftClosedPayload = z
  .object({
    shift_id: z.string(),
    closed_by: z.string(),
    has_note: z.boolean(),
    note_id: NoteId,
    alert_id: z.string().nullable(),
    approver_staff_id: z.string().nullable(),
  })
  .strict();
export type ShiftClosedPayload = z.infer<typeof ShiftClosedPayload>;

export const ShiftClosed = defineEvent({ eventType: 'ShiftClosed', version: 1, payload: ShiftClosedPayload });
