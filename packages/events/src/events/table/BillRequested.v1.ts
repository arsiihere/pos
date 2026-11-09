import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 02a §6.19 (table stream, T7: no session ids).
export const BillRequestedPayload = z
  .object({
    seating_id: z.string(),
    table_id: z.string(),
    by_staff_id: z.string(),
  })
  .strict();
export type BillRequestedPayload = z.infer<typeof BillRequestedPayload>;

export const BillRequested = defineEvent({ eventType: 'BillRequested', version: 1, payload: BillRequestedPayload });
