import { registerAuditAction, registerRequestAction, type AuditEvent } from '@pos/domain';
import { HAND_OVER_UNPAID_KIND } from './commands/request-unpaid-handover.js';

// ⚠️ 02b v1.0.25 §6.12a, §4.5 TK-16 (R2-m-5, R3-m-4), 04 v1.0.9: the audit actions of the unpaid hand-over, U-4. Registered
// at this module's load (orders/index.ts imports it statically), before the `audit` projection seals the registry, as
// billing/audit-map.ts. The request and its answer → unpaid_handover_requested / unpaid_handover_answered;
// UnpaidHandoverApproved → unpaid_handover_approved (subject the named order; the approver; the approved due). Ids and
// amounts only.
registerRequestAction(HAND_OVER_UNPAID_KIND, { requested: 'unpaid_handover_requested', answered: 'unpaid_handover_answered' });

registerAuditAction('UnpaidHandoverApproved', (e: AuditEvent) => {
  const p = e.payload as { order_id: string; alert_id: string; approved_by_staff_id: string; due_minor: number };
  return {
    action: 'unpaid_handover_approved',
    subject_type: 'order',
    subject_id: p.order_id,
    order_id: p.order_id,
    actor_staff_id: e.actor_id,
    approver_staff_id: p.approved_by_staff_id,
    amount_minor: p.due_minor,
    detail: { alert_id: p.alert_id },
  };
});
