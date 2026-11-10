import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 02a SG-2 (owner 2026-11-09): stream table (the seating's primary table), no session ids; 05 will own it.
export const BillClosedPayload = z
  .object({
    seating_id: z.string(),
  })
  .strict();
export type BillClosedPayload = z.infer<typeof BillClosedPayload>;

export const BillClosed = defineEvent({ eventType: 'BillClosed', version: 1, payload: BillClosedPayload });
