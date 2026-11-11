import { AlertDetailsBase } from '@pos/events';
import { APPROVAL_TIER_STEPS, defineAlertKind } from '../alerts/kinds.js';
import { applyComp, COMP_KIND, COMP_LABELS, CompValues } from './commands/comp-line.js';

// 02b v1.0.3 §6.12: kind `comp` (§3.9). Defined at the top level of this module; orders/index.ts imports it statically
// (server.ts -> orders/index.ts), so the kind exists before boot replays the `alerts` projection (01d §3.5 / P-8).
// Raised by CompLine (orders/commands/comp-line.ts) with { stream_type: 'order', stream_id: order_id }.

/** §6.12 details: item, quantity, amount, reason (signed-in card only, 01d §3.12). */
export const CompDetails = AlertDetailsBase.pick({ item: true, quantity: true, amount: true, reason: true });

export const COMP = defineAlertKind({
  kind: COMP_KIND,
  family: 'action',
  subject: 'order',
  steps: APPROVAL_TIER_STEPS,
  closes_on: 'owner', // 02b closes stale ones 'obsolete' (§3.9); 05 at day close
  values_schema: CompValues, // E0 AC3: 'other' keeps its note
  details_schema: CompDetails,
  lead_fallback: false,
  // §6.12 reads `expires_at_day_close: false`, which 01d's defineAlertKind refuses without closes_on 'seen' (01d §3.5
  // startup errors). The flag has no effect on a request kind (01d §3.5 day close expires non-request alerts only;
  // projections/alerts.ts `request_json IS NULL`), so `true` behaves exactly as §6.12 intends (02a table_handover
  // precedent). Reported to the controller (task 16 report).
  expires_at_day_close: true,
  silent: false,
  labels: { card: COMP_LABELS.card, lock: COMP_LABELS.lock },
  request: {
    answers: ['approve', 'reject'],
    right: { mode: 'approval', base_permission: 'apply-comp' },
    needs_pin: 'always',
    apply: applyComp, // approve: re-check §3.9 → [LineComped { …, alert_id, approver_staff_id }]; reject → []
    onWithdraw: () => [],
  },
});
