import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 02a §6.19 (table stream, T7: no session ids).
export const TableLockReleasedPayload = z
  .object({
    table_id: z.string(),
    seating_id: z.string(),
    staff_id: z.string(),
    reason: z.enum(['released', 'force', 'session_expired', 'lock_ttl', 'holder_changed']),
    by_staff_id: z.string().optional(),
    note: z.string().optional(),
    alert_id: z.string().optional(),
  })
  .strict();
export type TableLockReleasedPayload = z.infer<typeof TableLockReleasedPayload>;

export const TableLockReleased = defineEvent({ eventType: 'TableLockReleased', version: 1, payload: TableLockReleasedPayload });
