import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 02a §6.19 (table stream, T7: no session ids).
export const SeatingSplitPayload = z
  .object({
    from_seating_id: z.string(),
    new_seating_id: z.string().nullable(),
    to_table_id: z.string(),
    order_ids: z.array(z.string()),
    by_staff_id: z.string(),
  })
  .strict();
export type SeatingSplitPayload = z.infer<typeof SeatingSplitPayload>;

export const SeatingSplit = defineEvent({ eventType: 'SeatingSplit', version: 1, payload: SeatingSplitPayload });
