import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// ⚠️ 02a v1.1.9 §6.19 (05 row T-4, R-30 (b)): stream table (the seating's primary table), written by 05 when a tile mark
// of an open seating may have changed. Ids only: no totals, no mark values. No fold effect: the `tables` projection
// skips it; clients re-read `table-map`. ⚠️ 02a v1.1.11 §6.19 (05 row T-4, R-43): `alert_id` optional and never null (like
// SeatingReopened), present when 05's `reopen_bill` approval `apply` writes it, so its drafts pass 01d `checkAlertIds`.
export const TableMarksChangedPayload = z
  .object({
    seating_id: z.string(),
    alert_id: z.string().optional(),
  })
  .strict();
export type TableMarksChangedPayload = z.infer<typeof TableMarksChangedPayload>;

export const TableMarksChanged = defineEvent({ eventType: 'TableMarksChanged', version: 1, payload: TableMarksChangedPayload });
