import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 02a §6.19 (table stream, T7: no session ids).
export const TableLockTouchedPayload = z
  .object({
    table_id: z.string(),
    seating_id: z.string(),
  })
  .strict();
export type TableLockTouchedPayload = z.infer<typeof TableLockTouchedPayload>;

export const TableLockTouched = defineEvent({ eventType: 'TableLockTouched', version: 1, payload: TableLockTouchedPayload });
