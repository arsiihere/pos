import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 02a §6.19 (table stream, T7: no session ids).
export const TableMovedPayload = z
  .object({
    seating_id: z.string(),
    from_table_id: z.string(),
    to_table_id: z.string(),
    by_staff_id: z.string(),
    note: z.string().optional(),
  })
  .strict();
export type TableMovedPayload = z.infer<typeof TableMovedPayload>;

export const TableMoved = defineEvent({ eventType: 'TableMoved', version: 1, payload: TableMovedPayload });
