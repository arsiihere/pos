// 04 lane A1 test helpers (a2, a3): a minimal void `apply` swapped into the real kind (v7 builds the real one, as the
// spike does) and the audit tests' directory. Real events only, through 01d's AnswerRequest.
import type { DirectoryInput, EventDraft } from '@pos/events';
import type { AlertApplyCtx, AnswerFacts } from '../../src/alerts/kinds';
import { openDayStockCtx, withStockEffects } from '../../src/commands/set-precooked-stock';
import { VOID_APPROVAL, type VoidValues } from '../../src/voids/kind';
import { voidsDirectory, VX } from '../voids/fixtures';

/**
 * A minimal approve of the named line only (§3.3 steps 2, 3, 5): ItemMovedToStock when its stored disposition is
 * `moved`, then the ItemVoided with §6.7's fields; one withStockEffects; alert_id on every payload. Reject → [].
 */
export function testApply(ctx: AlertApplyCtx<VoidValues, never>, ans: AnswerFacts): EventDraft[] {
  if (ans.decision !== 'approve') return [];
  const v = ctx.alert.values;
  const moved = v.line_dispositions[v.order_item_id] === 'moved';
  const env = { stream_type: 'order' as const, stream_id: v.order_id, schema_version: 1, occurred_at: ctx.clock.branchNow(), actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId };
  const causes: EventDraft[] = [
    ...(moved ? [{ ...env, event_type: 'ItemMovedToStock', payload: { order_item_id: v.order_item_id, units: v.units } }] : []),
    {
      stream_type: 'order',
      stream_id: v.order_id,
      event_type: 'ItemVoided',
      schema_version: 1,
      occurred_at: ctx.clock.branchNow(),
      actor_id: ctx.actor.staffId,
      device_id: ctx.actor.deviceId,
      payload: {
        order_item_id: v.order_item_id,
        units: v.units,
        refund_minor: v.refund_minor,
        comp_voided_minor: v.comp_voided_minor,
        disposition: v.line_dispositions[v.order_item_id] ?? null,
        reason_code: v.reason_code,
        note: v.note,
        disposition_note: v.disposition_note,
        requester_staff_id: ctx.alert.requester_staff_id!,
        approver_staff_id: ans.answerer_staff_id,
        alert_id: ctx.alert.alert_id,
      },
    },
  ];
  const drafts = withStockEffects(ctx, causes, moved ? openDayStockCtx(ctx.state) : undefined);
  return drafts.map((d) => ({ ...d, payload: { ...d.payload, alert_id: ctx.alert.alert_id } }));
}

/** voidsDirectory() plus 02b's comp grant: Cashier `apply-comp` requires approval by Manager (Manager holds it allowed). */
export async function auditDirectory(): Promise<DirectoryInput> {
  const base = await voidsDirectory();
  const askComp = { permission: 'apply-comp' as const, grant_type: 'requires_approval' as const, approver_role_id: VX.managerRole, approver_role_ids: [VX.managerRole], scope: 'branch' as const };
  return { ...base, roles: base.roles.map((r) => (r.role_id === 'R_CASH' ? { ...r, permissions: [...r.permissions, askComp] } : r)) };
}

export async function withTestApply<T>(body: () => Promise<T>): Promise<T> {
  const request = VOID_APPROVAL.request!;
  const original = request.apply;
  request.apply = testApply;
  try {
    return await body();
  } finally {
    request.apply = original;
  }
}
