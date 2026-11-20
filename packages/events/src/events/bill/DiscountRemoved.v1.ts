import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { NoteId } from './parts.js';

// 05 §6.7, §6.29 (stream bill): not approvable. Reading: §6.7 gives no payload; this is the command's
// `{ bill_id, reason_code }` with the note as `has_note` / `note_id` (§6.29: "DiscountRemoved … carry has_note, note_id").
export const DiscountRemovedPayload = z
  .object({
    bill_id: z.string(),
    reason_code: z.string().min(1),
    has_note: z.boolean(),
    note_id: NoteId,
  })
  .strict();
export type DiscountRemovedPayload = z.infer<typeof DiscountRemovedPayload>;

export const DiscountRemoved = defineEvent({ eventType: 'DiscountRemoved', version: 1, payload: DiscountRemovedPayload });
