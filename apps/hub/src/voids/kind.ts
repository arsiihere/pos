import { VOID_DISPOSITIONS, VOID_REASON_CODES } from '@pos/domain';
import { AlertDetailsBase } from '@pos/events';
import { z } from 'zod';
import { APPROVAL_TIER_STEPS, defineAlertKind } from '../alerts/kinds.js';
import { VOID_KIND } from './contracts.js';

// 04 §3.5: kind `void_approval`. Defined at the top level of this module; voids/index.ts imports it statically
// (server.ts -> voids/index.ts), so the kind exists before boot replays the `alerts` projection (01d §3.5 / P-8).
// Phase 0 (P0.7): nothing raises it until v6; `apply` throws "not built" until v7. Lane V1 owns this file (v6, v7).

/** §3.5 values: the raise-time plan (`pendingVoids` reads them from `values_json`). */
export const VoidValues = z.object({
  order_id: z.string().min(1),
  order_item_id: z.string().min(1),
  units: z.number().int().min(1),
  reason_code: z.enum(VOID_REASON_CODES),
  note: z.string().max(200).nullable(),
  disposition: z.enum(VOID_DISPOSITIONS),
  disposition_note: z.string().max(200).nullable(),
  touched_ids: z.array(z.string().min(1)).min(1).max(40),
  line_dispositions: z.record(z.string().min(1), z.enum(VOID_DISPOSITIONS).nullable()),
  refund_minor: z.number().int().min(0),
  comp_voided_minor: z.number().int().min(0),
});
export type VoidValues = z.infer<typeof VoidValues>;

/** §3.5 details — phase 0 placeholder; v6 adds `disposition` and `lines` (G-10). */
export const VoidDetails = AlertDetailsBase.pick({ item: true, quantity: true, amount: true, reason: true, identifier: true });

export const VOID_APPROVAL = defineAlertKind({
  kind: VOID_KIND,
  family: 'urgent',
  subject: 'order',
  steps: APPROVAL_TIER_STEPS,
  closes_on: 'owner',
  values_schema: VoidValues,
  details_schema: VoidDetails,
  lead_fallback: false,
  expires_at_day_close: true, // no effect on requests (02b `comp` precedent)
  silent: false,
  labels: { card: 'alert.void_approval.card', lock: 'alert.void_approval.lock' },
  request: {
    answers: ['approve', 'reject'],
    right: { mode: 'approval', base_permission: 'void-item', range_permission: 'approve-void' },
    needs_pin: 'always',
    apply: () => {
      throw new Error('04 void_approval apply: not built (task v7)');
    },
    onWithdraw: () => [], // §6.2
    // result_also_to (row D-2): added by v7 once u7 adds it to 01d's AlertRequestDef
  },
});
