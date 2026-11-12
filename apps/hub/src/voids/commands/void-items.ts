// 04 §6.1 VoidItems (task v4: the direct path; v6 adds the approval path, step 7). Permission `void-item`,
// `approvable: true`, not queueable (V15), device session. No table lock (V14). Order of checks: payload (Zod: keyed
// lines C6, notes V12) → readOrder (404) → billed (409) → the two open-request reads → §3.2 per entry (plan.ts) →
// scope `branch` last (C8). Statements: 1 readOrder + 2 listOpen (`alerts_open_kind`) = 3, + direct 2 (lineChangeDrafts
// in `close` mode); the append excluded. Engine state, directory and config in memory.
import { DomainError, VOID_DISPOSITIONS, VOID_REASON_CODES } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { alerts } from '../../alerts/raise.js';
import { defineCommand, type CommandCtx } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { readOrder, type ReadOrderHead } from '../../orders/exports.js';
import { COMP_KIND } from '../../orders/line-change.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { VOID_KIND } from '../contracts.js';
import { planVoidEntries, voidDrafts } from '../plan.js';

const Entry = z.object({
  order_item_id: z.string().min(1),
  units: z.number().int().min(1).optional(),
  disposition: z.enum(VOID_DISPOSITIONS),
});

export const VoidItemsPayload = z
  .object({
    order_id: z.string().min(1),
    reason_code: z.enum(VOID_REASON_CODES),
    note: z.string().max(200).nullable().optional(),
    disposition_note: z.string().max(200).nullable().optional(),
    lines: z
      .array(Entry)
      .min(1)
      .max(40)
      .superRefine((lines, rc) => {
        // C6: keyed entries; a repeated order_item_id → 400 at lines.N.order_item_id, N the repeat.
        const seen = new Set<string>();
        lines.forEach((l, i) => {
          if (seen.has(l.order_item_id)) rc.addIssue({ code: 'custom', path: [i, 'order_item_id'], message: 'duplicate order_item_id' });
          seen.add(l.order_item_id);
        });
      }),
  })
  .superRefine((p, rc) => {
    // V12: a note when the reason is `other`; a disposition note when any entry's disposition is `other`.
    if (p.reason_code === 'other' && (p.note ?? '').trim() === '') rc.addIssue({ code: 'custom', path: ['note'], message: "note is required when reason_code is 'other'" });
    if (p.lines.some((l) => l.disposition === 'other') && (p.disposition_note ?? '').trim() === '') {
      rc.addIssue({ code: 'custom', path: ['disposition_note'], message: "disposition_note is required when a disposition is 'other'" });
    }
  });
type Payload = z.infer<typeof VoidItemsPayload>;

/** §3.14-style scope (C8, last): `void-item` is a `branch` permission (01b catalogue). 0 statements. */
function checkScope(ctx: CommandCtx, order: ReadOrderHead): void {
  const scope = ctx.permission !== null && 'scope' in ctx.permission ? ctx.permission.scope : null;
  if (ctx.actor.staffId === null || scope !== 'branch') throw new DomainError('PERMISSION_DENIED', { reason: 'outside_scope', order_id: order.order_id });
}

function voidItems(ctx: CommandCtx, p: Payload): { events: ReturnType<typeof voidDrafts>['drafts']; result: unknown } {
  // step 2
  const { order, lines } = readOrder(ctx, p.order_id);
  if (order.billed_at !== null) throw new DomainError('ORDER_BILLED', { order_id: order.order_id });
  // step 3: the order's open void and comp requests (rule 6)
  const subject = { stream_type: 'order' as const, stream_id: order.order_id };
  const open_voids = alerts.listOpen(ctx.tx.db, { kind: VOID_KIND, subject });
  const open_comps = alerts.listOpen(ctx.tx.db, { kind: COMP_KIND, subject });
  // step 4: the grant (in memory), then §3.2 per entry against the working copy
  const approval = ctx.permission !== null && ctx.permission.grant === 'requires_approval';
  const staffId = ctx.actor.staffId;
  const planned = planVoidEntries({
    order_id: order.order_id,
    lines,
    state: ctx.state,
    now: ctx.clock.branchNow(),
    zone_undo_ms: branchConfig()?.engine_settings.zone_undo_ms ?? 0,
    entries: p.lines,
    path: approval ? 'approval' : 'direct',
    open_voids,
    open_comps,
    move_granted: staffId !== null && ctx.directory.resolve(staffId, 'move-item-to-stock').grant === 'allowed',
  });
  // step 5
  checkScope(ctx, order);
  if (approval) throw new Error('04 VoidItems approval path: not built (task v6)');
  // step 6: the direct path
  const out = voidDrafts(
    ctx,
    order.order_id,
    planned,
    { reason_code: p.reason_code, note: p.note ?? null, disposition_note: p.disposition_note ?? null, requester_staff_id: staffId!, approver_staff_id: null, alert_id: null },
    { stale_comps: 'close' },
  );
  return { events: out.drafts, result: { voided: out.voided, cancelled: out.cancelled } };
}

export const voidItemsCommand = defineCommand({
  commandType: 'VoidItems',
  payloadSchema: VoidItemsPayload,
  sessionKind: 'device',
  permission: 'void-item',
  approvable: true,
  handle: (ctx, payload) => voidItems(ctx, payload),
});

export function registerVoidItems(app: FastifyInstance): void {
  commandRegistry(app).register(voidItemsCommand);
}
