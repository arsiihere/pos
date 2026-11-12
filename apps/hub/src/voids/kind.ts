import { VOID_DISPOSITIONS, VOID_REASON_CODES, type VoidReasonCode } from '@pos/domain';
import { AlertDetailsBase, type AlertDisplay } from '@pos/events';
import { z } from 'zod';
import { APPROVAL_TIER_STEPS, defineAlertKind } from '../alerts/kinds.js';
import type { RaiseInput } from '../alerts/raise.js';
import type { CommandCtx } from '../commands/registry.js';
import type { ReadOrderHead, ReadOrderLine } from '../orders/exports.js';
import { branchConfig } from '../sync/branch-config-holder.js';
import { VOID_KIND } from './contracts.js';
import { voidIdentifier } from './identifier.js';
import type { PlannedEntry } from './plan.js';

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

/** §3.5 details (G-10): the base's fields plus a kind-local `lines` (≤ 10, `state` an enum); the base stays untouched. */
export const VoidDetails = AlertDetailsBase.pick({ item: true, quantity: true, amount: true, reason: true, identifier: true, disposition: true }).extend({
  lines: z
    .array(z.object({ name: z.string().min(1), quantity: z.number().int().min(1), state: z.enum(['not_started', 'cooking', 'cooked', 'served']) }))
    .max(10),
});
export type VoidDetails = z.infer<typeof VoidDetails>;

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

/** §3.12 lock-safe label, as CompLine sets it — a copy of `orders/commands/comp-line.ts:161` `tableCode` (private there):
 * the primary table's config name (its id when unknown); null without one. */
function tableCode(table_id: string | null): string | null {
  if (table_id === null) return null;
  for (const floor of branchConfig()?.floors ?? []) {
    const table = floor.tables.find((t) => t.table_id === table_id);
    if (table !== undefined) return table.name;
  }
  return table_id;
}

/** The request's own fields of §6.1 (the payload's, shared by every entry). */
export interface VoidRequestMeta {
  reason_code: VoidReasonCode;
  note: string | null;
  disposition_note: string | null;
}

/**
 * §6.1 step 7, §3.5: one raise input per planned entry (the caller passes them all to ONE alerts.raiseMany). values =
 * the raise-time plan; details = the approver card (identifier, disposition label key, lines ≤ 10); display as CompLine.
 * 0 statements (identifier and names from memory).
 */
export function voidRaiseInputs(ctx: CommandCtx, order: ReadOrderHead, lines: readonly ReadOrderLine[], planned: readonly PlannedEntry[], meta: VoidRequestMeta): RaiseInput[] {
  const caller = ctx.actor.staffId!;
  const names = new Map(lines.map((l) => [l.order_item_id, l.name]));
  const identifier = voidIdentifier(ctx.state, order);
  const display: AlertDisplay = {
    kind_label_key: VOID_APPROVAL.labels.lock,
    table_code: order.order_type === 'dine_in' ? tableCode(order.primary_table_id) : null,
    requester_name: ctx.directory.get(caller)?.display_name ?? null,
  };
  const grant = ctx.permission;
  // only VoidItems' requires_approval path raises: never a request with no approver roles
  if (grant === null || grant.grant !== 'requires_approval') throw new Error('04 voidRaiseInputs: the caller\'s void-item grant is not requires_approval');
  const approver_role_ids = grant.approver_role_ids;
  const reason = (meta.note === null ? meta.reason_code : `${meta.reason_code}: ${meta.note}`).slice(0, 200);
  return planned.map((e) => {
    const values: VoidValues = {
      order_id: order.order_id,
      order_item_id: e.order_item_id,
      units: e.units,
      reason_code: meta.reason_code,
      note: meta.note,
      disposition: e.disposition,
      disposition_note: meta.disposition_note,
      touched_ids: e.touched_ids,
      line_dispositions: e.line_dispositions,
      refund_minor: e.refund_minor,
      comp_voided_minor: e.comp_voided_minor,
    };
    // §3.5 (H6-6): moved_partly only for a chosen `moved` with a non-header touched line that is not moved
    const partly = e.disposition === 'moved' && e.touched_ids.some((id) => !e.header_ids.includes(id) && e.line_dispositions[id] !== 'moved');
    const details: VoidDetails = {
      item: names.get(e.order_item_id) ?? e.order_item_id,
      quantity: e.units,
      amount: e.refund_minor,
      reason,
      identifier,
      disposition: `void.disposition.${partly ? 'moved_partly' : e.disposition}`,
      lines: e.lines.slice(0, 10).map((l) => ({ name: names.get(l.order_item_id) ?? l.order_item_id, quantity: l.units, state: e.states[l.order_item_id]! })),
    };
    return {
      kind: VOID_KIND,
      subject: { stream_type: 'order', stream_id: order.order_id },
      target: { kind: 'answerers' },
      values,
      details,
      display,
      dedupe_key: `void:${e.order_item_id}`,
      requester_staff_id: caller,
      request: { approver_role_ids },
    };
  });
}
