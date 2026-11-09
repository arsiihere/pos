import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 02a §6.19 (table stream, T7: no session ids).
export const TableCleanedPayload = z
  .object({
    seating_id: z.string(),
    table_ids: z.array(z.string()),
    reason: z.enum(['cleaned', 'left_without_order']),
    by_staff_id: z.string(),
  })
  .strict();
export type TableCleanedPayload = z.infer<typeof TableCleanedPayload>;

export const TableCleaned = defineEvent({ eventType: 'TableCleaned', version: 1, payload: TableCleanedPayload });
