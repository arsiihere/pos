// 04 §6.3 `GET /queries/void-preview?order_id&order_item_ids&units?` (task v9). `void-item` (any grant). Runs §3.2
// without writing, each id as its own entry against the order as read (no working copy across ids), through the same
// planner VoidItems uses (plan.ts). Only malformed input, an unknown order (404), a billed order (409 ORDER_BILLED) and a
// foreign id (rule 1, 400) fail the call; rule 4 is `group`, rule 5 (`units`, single id only) a 400, rules 6–7 are
// `pending` / `comp_pending` (approval path only) / `dispositions`. Statements: 3 (readOrder + the two listOpen by kind) for any number of
// ids; the planning is pure. Lane V2 owns this file.
import { DomainError, VOID_DISPOSITIONS, type VoidBlock, type VoidDisposition } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { alerts } from '../../alerts/raise.js';
import type { CommandCtx } from '../../commands/registry.js';
import { readOrder, type ReadOrderLine } from '../../orders/exports.js';
import { COMP_KIND } from '../../orders/line-change.js';
import { defineQuery, queryRegistry, type QueryCtx } from '../../queries/registry.js';
import { VOID_KIND } from '../contracts.js';
import { planVoidEntries, type PlanInput, type PlannedEntry, type VoidLineState } from '../plan.js';

const issue = (path: string, message: string) => ({ path: [path], message });

/** §6.3 query string: `order_item_ids` a comma list, de-duplicated, 1–40; `units` digits, only with a single id. */
export const VoidPreviewQuery = z
  .object({
    order_id: z.string().min(1),
    order_item_ids: z.string().transform((s) => [...new Set(s.split(','))]),
    units: z.string().regex(/^\d+$/).transform(Number).optional(),
  })
  .strict()
  .superRefine((q, rc) => {
    if (q.order_item_ids.some((id) => id === '')) rc.addIssue({ code: 'custom', ...issue('order_item_ids', 'empty id') });
    else if (q.order_item_ids.length > 40) rc.addIssue({ code: 'custom', ...issue('order_item_ids', 'at most 40 ids') });
    if (q.units !== undefined && q.order_item_ids.length !== 1) rc.addIssue({ code: 'custom', ...issue('units', 'units only with a single id') });
  });
type VoidPreviewQuery = z.infer<typeof VoidPreviewQuery>;

export interface VoidPreview {
  order_item_id: string;
  group: 'remove' | 'void';
  refund_minor: number;
  comp_voided_minor: number;
  touched: Array<{ order_item_id: string; name: string; units: number; stage: VoidLineState; refund_minor: number; comp_voided_minor: number }>;
  stage: VoidLineState;
  dispositions: Array<{ disposition: VoidDisposition; enabled: boolean; block: VoidBlock | null; line_dispositions: Record<string, VoidDisposition | null> }>;
  needs_approval: boolean;
  pending: { alert_id: string } | null;
  comp_pending: { alert_id: string } | null;
}

const invalid = (path: string, message: string): DomainError => new DomainError('VALIDATION_FAILED', { issues: [{ path, message }] });
const isCode = (e: unknown, code: string): e is DomainError => e instanceof DomainError && e.code === code;

/** readOrder reads only `ctx.tx.db` (02b orders/exports.ts); a query has no command ctx (order-contact.ts precedent). */
const readCtx = (ctx: QueryCtx): CommandCtx => ({ tx: { db: ctx.db } }) as unknown as CommandCtx;

function previewOne(base: Omit<PlanInput, 'entries' | 'path'>, line: ReadOrderLine, units: number | undefined, needs_approval: boolean, names: ReadonlyMap<string, string>, opens: { voids: PlanInput['open_voids']; comps: PlanInput['open_comps'] }): VoidPreview {
  const id = line.order_item_id;
  const plan = (disposition: VoidDisposition, o: Partial<PlanInput> = {}): PlannedEntry =>
    planVoidEntries({ ...base, entries: [units === undefined ? { order_item_id: id, disposition } : { order_item_id: id, units, disposition }], path: 'direct', ...o })[0]!;
  let wastage: PlannedEntry;
  try {
    wastage = plan('wastage'); // rules 1, 4, 5 (no rule 6: the opens are judged below; no rule 7 for wastage)
  } catch (e) {
    // rule 4 → group remove (a return line at stage 1 too, Q-R1); the other fields empty
    if (isCode(e, 'ITEM_WRONG_STAGE')) {
      return { order_item_id: id, group: 'remove', refund_minor: 0, comp_voided_minor: 0, touched: [], stage: 'not_started', dispositions: [], needs_approval, pending: null, comp_pending: null };
    }
    // rule 5 → the query's `units` (a 400 for the whole call)
    if (isCode(e, 'VALIDATION_FAILED')) throw invalid('units', ((e.details.issues as Array<{ message: string }> | undefined)?.[0]?.message ?? 'units').slice(0, 40));
    throw e;
  }
  // rule 6 (b): a touched line locked by an open void request (both paths)
  let pending: VoidPreview['pending'] = null;
  try {
    plan('wastage', { open_voids: opens.voids });
  } catch (e) {
    if (!isCode(e, 'VOID_PENDING')) throw e;
    pending = { alert_id: e.details.alert_id as string };
  }
  // rule 6 (c) is "approval path only" (§3.2): a caller whose void-item is allowed is never refused by a comp request
  let comp_pending: VoidPreview['comp_pending'] = null;
  if (needs_approval) {
    try {
      plan('wastage', { path: 'approval', open_comps: opens.comps });
    } catch (e) {
      if (!isCode(e, 'COMP_PENDING')) throw e;
      comp_pending = { alert_id: e.details.alert_id as string };
    }
  }
  // rule 7 per disposition: `moved` blocked by stage / stock / day / grant (the planner's own order of checks)
  const dispositions = VOID_DISPOSITIONS.map((disposition) => {
    try {
      return { disposition, enabled: true, block: null, line_dispositions: plan(disposition).line_dispositions };
    } catch (e) {
      if (isCode(e, 'VOID_NOT_ALLOWED')) return { disposition, enabled: false, block: e.details.reason as VoidBlock, line_dispositions: {} };
      if (isCode(e, 'PERMISSION_DENIED') && e.details.reason === 'move_not_granted') return { disposition, enabled: false, block: 'move_not_granted' as const, line_dispositions: {} };
      throw e;
    }
  });
  return {
    order_item_id: id,
    group: 'void',
    refund_minor: wastage.refund_minor,
    comp_voided_minor: wastage.comp_voided_minor,
    touched: wastage.lines.map((l) => ({
      order_item_id: l.order_item_id,
      name: names.get(l.order_item_id) ?? l.order_item_id,
      units: l.units,
      stage: wastage.states[l.order_item_id]!,
      refund_minor: l.payload.refund_minor ?? 0,
      comp_voided_minor: l.payload.comp_voided_minor ?? 0,
    })),
    stage: wastage.states[id]!,
    dispositions,
    needs_approval,
    pending,
    comp_pending,
  };
}

function voidPreview(ctx: QueryCtx, q: VoidPreviewQuery): { previews: VoidPreview[] } {
  const staffId = ctx.session?.staff_id ?? null;
  const grant = staffId === null ? 'not_granted' : ctx.directory.resolve(staffId, 'void-item').grant;
  if (grant !== 'allowed' && grant !== 'requires_approval') throw new DomainError('PERMISSION_DENIED', { permission: 'void-item', grant });
  const { order, lines } = readOrder(readCtx(ctx), q.order_id); // 404 ORDER_NOT_FOUND
  if (order.billed_at !== null) throw new DomainError('ORDER_BILLED', { order_id: order.order_id });
  const subject = { stream_type: 'order' as const, stream_id: order.order_id };
  const opens = { voids: alerts.listOpen(ctx.db, { kind: VOID_KIND, subject }), comps: alerts.listOpen(ctx.db, { kind: COMP_KIND, subject }) };
  const byId = new Map(lines.map((l) => [l.order_item_id, l]));
  // rule 1 fails the call
  const foreign = q.order_item_ids.find((id) => !byId.has(id));
  if (foreign !== undefined) throw invalid('order_item_ids', 'not a line of this order');
  const base: Omit<PlanInput, 'entries' | 'path'> = {
    order_id: order.order_id,
    lines,
    state: ctx.state,
    now: ctx.now,
    zone_undo_ms: ctx.branchConfig?.engine_settings.zone_undo_ms ?? 0, // VoidItems' default (void-items.ts)
    open_voids: [],
    open_comps: [],
    move_granted: ctx.directory.resolve(staffId!, 'move-item-to-stock').grant === 'allowed', // B-2: allowed only
  };
  const names = new Map(lines.map((l) => [l.order_item_id, l.name]));
  return { previews: q.order_item_ids.map((id) => previewOne(base, byId.get(id)!, q.units, grant === 'requires_approval', names, opens)) };
}

export function registerVoidPreviewQuery(app: FastifyInstance): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'void-preview',
      sessionKind: 'device',
      session: 'required',
      querySchema: VoidPreviewQuery,
      handle: (ctx, q) => ({ data: voidPreview(ctx, q) }),
    }),
  );
}
