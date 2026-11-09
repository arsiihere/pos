import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 02a §6.19 (table stream, T7: no session ids).
export const TablesMergedPayload = z
  .object({
    into_seating_id: z.string(),
    into_table_id: z.string(),
    table_ids: z.array(z.string()),
    absorbed_seating_id: z.string().nullable(),
    order_ids: z.array(z.string()),
    by_staff_id: z.string(),
  })
  .strict();
export type TablesMergedPayload = z.infer<typeof TablesMergedPayload>;

export const TablesMerged = defineEvent({ eventType: 'TablesMerged', version: 1, payload: TablesMergedPayload });
