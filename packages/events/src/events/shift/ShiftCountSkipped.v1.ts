import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 05 §6.18, §6.29 (stream shift): the no-count close, always followed by ShiftClosed (which carries who closed it
// and the note). Reading: §6.18 gives no payload; this event carries the shift id alone.
export const ShiftCountSkippedPayload = z.object({ shift_id: z.string() }).strict();
export type ShiftCountSkippedPayload = z.infer<typeof ShiftCountSkippedPayload>;

export const ShiftCountSkipped = defineEvent({ eventType: 'ShiftCountSkipped', version: 1, payload: ShiftCountSkippedPayload });
