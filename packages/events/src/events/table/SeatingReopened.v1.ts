import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// ⚠️ 02a v1.1.8 §6.19 (05 row T-3 (1), H2-1, H2-27): stream table (the seating's primary table), no session ids (T7).
// Written by 05's full-edit reopen of a CLOSED bill only; `alert_id` present when written by an approval `apply`,
// absent on the direct path.
export const SeatingReopenedPayload = z
  .object({
    seating_id: z.string(),
    bill_id: z.string(),
    alert_id: z.string().optional(),
  })
  .strict();
export type SeatingReopenedPayload = z.infer<typeof SeatingReopenedPayload>;

export const SeatingReopened = defineEvent({ eventType: 'SeatingReopened', version: 1, payload: SeatingReopenedPayload });
