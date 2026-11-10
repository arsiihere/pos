import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 02a §6.19 (table stream, T7: no session ids).
export const TableOpenedPayload = z
  .object({
    table_id: z.string(),
    seating_id: z.string(),
    holder_staff_id: z.string(),
    party_size: z.number().int().nullable(),
  })
  .strict();
export type TableOpenedPayload = z.infer<typeof TableOpenedPayload>;

export const TableOpened = defineEvent({ eventType: 'TableOpened', version: 1, payload: TableOpenedPayload });
