import { DomainError } from '@pos/domain';
import { AlertDetailsBase, type EventDraft, type UnpaidHandoverApprovedPayload } from '@pos/events';
import { defineAlertKind, type AlertApplyCtx, type AnswerFacts } from '../alerts/kinds.js';
import {
  dueOf,
  HAND_OVER_UNPAID_KIND,
  HAND_OVER_UNPAID_LABELS,
  HandOverUnpaidValues,
  isLive,
  readUnpaidOrder,
} from './commands/request-unpaid-handover.js';

// ⚠️ 02b v1.0.25 §6.12a kind `hand_over_unpaid` (OR-7; run 3 R3-B-1, R3-M-2, R3-M-8, R3-m-1; D2, D3), U-2. Defined at the
// top level of this module; orders/index.ts imports it statically before boot replays the alerts projection (P-8), as
// comp-kind.ts. Raised by RequestUnpaidHandover. Answerers: the holders of hand-over-unpaid (01b v1.12 B-5; branch
// only), presence-filtered, the requester excluded (01d holders right); listed-only on the device (05a L-1). The raise
// is persisted as AlertRaised v6 (01d v1.3.7 §5.4).

/** §6.12a details: the identifier ('#<token>' or 'PARKING') and the amount (signed-in card only). */
export const HandOverUnpaidDetails = AlertDetailsBase.pick({ identifier: true, amount: true });

/**
 * §6.12a apply (approve), read-only, in 01d's pre-read and again in the answer transaction: the named order (1) and,
 * while it is live, its fresh D3 due (1). Only a live, unbilled order whose positive due equals the card's amount is
 * approved; a stale card → 422 CONFIG_REFERENCE_INVALID { field: 'alert_id', reason: 'unpaid_handover_request_stale' }.
 * Reject → [] (no balance read).
 */
export function applyHandOverUnpaid(ctx: AlertApplyCtx<HandOverUnpaidValues, HandOverUnpaidDetails>, answer: AnswerFacts): EventDraft[] {
  if (answer.decision !== 'approve') return [];
  const v = ctx.alert.values;
  const o = readUnpaidOrder(ctx.tx.db, v.order_id);
  const stale = (): never => {
    throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'alert_id', reason: 'unpaid_handover_request_stale' });
  };
  if (o === undefined || o.order_type === 'dine_in' || !isLive(o)) return stale();
  const due = dueOf(ctx.tx.db, o);
  if (due <= 0 || due !== v.due_minor) return stale();
  const payload: UnpaidHandoverApprovedPayload = { order_id: o.order_id, alert_id: ctx.alert.alert_id, approved_by_staff_id: answer.answerer_staff_id, due_minor: due };
  return [
    {
      stream_type: 'order',
      stream_id: o.order_id,
      event_type: 'UnpaidHandoverApproved',
      schema_version: 1,
      payload,
      occurred_at: ctx.clock.branchNow(),
      actor_id: ctx.actor.staffId,
      device_id: ctx.actor.deviceId,
    },
  ];
}
type HandOverUnpaidDetails = typeof HandOverUnpaidDetails._output;

export const HAND_OVER_UNPAID = defineAlertKind({
  kind: HAND_OVER_UNPAID_KIND,
  family: 'urgent', // TK-Q21 (R3-m-1): urgent with a request part
  subject: 'order',
  steps: [{ at: { ms: 0 }, to: [{ target: { kind: 'answerers' }, set: 'answerer' }] }],
  closes_on: 'owner',
  // No effect on a request kind (01d kinds.ts needs it for closes_on 'owner'); 02b / 05 close the request (§3.7a).
  expires_at_day_close: true,
  silent: false,
  lead_fallback: false,
  values_schema: HandOverUnpaidValues,
  details_schema: HandOverUnpaidDetails,
  labels: { card: HAND_OVER_UNPAID_LABELS.card, lock: HAND_OVER_UNPAID_LABELS.lock },
  request: {
    answers: ['approve', 'reject'],
    right: { mode: 'holders', permission: 'hand-over-unpaid' },
    needs_pin: 'always', // money: food leaves without payment
    apply: applyHandOverUnpaid,
    onWithdraw: () => [],
  },
});
