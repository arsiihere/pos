import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 02a §6.19 (table stream, T7: no session ids).
export const TableLockedPayload = z
  .object({
    table_id: z.string(),
    seating_id: z.string(),
    staff_id: z.string(),
    replaced_device_id: z.string().optional(),
  })
  .strict();
export type TableLockedPayload = z.infer<typeof TableLockedPayload>;

export const TableLocked = defineEvent({ eventType: 'TableLocked', version: 1, payload: TableLockedPayload });
