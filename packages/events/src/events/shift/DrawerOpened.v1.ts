import { z } from 'zod';
import { defineEvent } from '../../registry.js';
import { NoteId } from '../bill/parts.js';

// 05 §6.21, §6.29 (stream shift): a no-sale drawer open on a drawer shift's device.
export const DrawerOpenedPayload = z
  .object({
    shift_id: z.string(),
    device_id: z.string(),
    reason_code: z.enum(['change_for_customer', 'check_cash', 'other']),
    has_note: z.boolean(),
    note_id: NoteId,
  })
  .strict();
export type DrawerOpenedPayload = z.infer<typeof DrawerOpenedPayload>;

export const DrawerOpened = defineEvent({ eventType: 'DrawerOpened', version: 1, payload: DrawerOpenedPayload });
