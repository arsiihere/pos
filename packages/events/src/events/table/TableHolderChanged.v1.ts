import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 02a §6.19 (table stream, T7: no session ids).
export const TableHolderChangedPayload = z
  .object({
    table_id: z.string(),
    seating_id: z.string(),
    from_staff_id: z.string(),
    to_staff_id: z.string(),
    reason: z.enum(['take_over', 'handover', 'force_move']),
    by_staff_id: z.string(),
    alert_id: z.string().optional(),
    note: z.string().optional(),
  })
  .strict();
export type TableHolderChangedPayload = z.infer<typeof TableHolderChangedPayload>;

export const TableHolderChanged = defineEvent({ eventType: 'TableHolderChanged', version: 1, payload: TableHolderChangedPayload });
