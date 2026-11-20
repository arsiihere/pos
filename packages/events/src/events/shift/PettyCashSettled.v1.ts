import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { NoteId, NonNegativeMinor } from '../bill/parts.js';

// 05 §6.20, §6.29 (stream shift), H4-4: settles an advance; its own `note_id` (never the advance's entry_id row);
// `shift_id` = the caller's money shift, where the returned cash lands.
export const PettyCashSettledPayload = z
  .object({
    entry_id: z.string(),
    shift_id: z.string(),
    spent_minor: NonNegativeMinor,
    returned_minor: NonNegativeMinor,
    has_note: z.boolean(),
    note_id: NoteId,
  })
  .strict();
export type PettyCashSettledPayload = z.infer<typeof PettyCashSettledPayload>;

export const PettyCashSettled = defineEvent({ eventType: 'PettyCashSettled', version: 1, payload: PettyCashSettledPayload });
