import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03c v1.0.13 §6.11, §3.2 (hub / branch_id; 05 row P-1, R-22): SetBillRoute. One route per (scope, ref_id): a save
// replaces it, `printer_id: null` removes it. `ref_id` is '' (branch level) for `report` and `default`, the entity's id
// for `zone` | `floor` | `device`; the command checks that (§6.13), the event keeps what was stored.
export const BillRouteSetPayload = z.object({
  scope: z.enum(['zone', 'floor', 'device', 'report', 'default']),
  ref_id: z.string(),
  printer_id: z.string().min(1).nullable(),
});
export type BillRouteSetPayload = z.infer<typeof BillRouteSetPayload>;

export const BillRouteSet = defineEvent({ eventType: 'BillRouteSet', version: 1, payload: BillRouteSetPayload });
