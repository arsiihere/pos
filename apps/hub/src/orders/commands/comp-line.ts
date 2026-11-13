import { DomainError } from '@pos/domain';
import type { AlertDetails, AlertDisplay, EventDraft, LineCompedPayload } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AlertApplyCtx, AnswerFacts } from '../../alerts/kinds.js';
import { alerts } from '../../alerts/raise.js';
import { defineCommand, type CommandCtx } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import type { LineView } from '../contracts.js';
import { liveUnits, planComp, type CompMeta, type LedgerParent, type LedgerRef } from '../ledger.js';
import { COMP_KIND, staleCompCloses } from '../line-change.js';

// 02b §6.8 CompLine, §3.9 (rules, value, approval, stale requests), §3.4 (comp takes the next free shares; deal actions;
// cascades capped; one LineComped per line), §3.14 (scope `branch`). `approvable: true` (00 :470); online only (§3.12).
// Order of checks: payload (Zod; 'other' needs a note) → line (404) → billed → COMP_NOT_ALLOWED → pending weight →
// units ≤ live − comped → scope last (C8). Then: grant `allowed` → LineComped per line + stale request closes;
// `requires_approval` → alerts.raise of kind `comp` (deduped → 409 COMP_PENDING).
// Statements: 1 (the line, its order, its current table, its children) + 1 open comp requests of the order
// (alerts.listOpen, on the `allowed` path, where the comp is written); 01d's own bounds (raise, closeMany) and the
// append excluded. The kind's `apply` (orders/comp-kind.ts) re-runs the same read and checks, read-only.

/** §6.12 labels (the kind itself is defined in orders/comp-kind.ts; its name is line-change.ts COMP_KIND). */
export const COMP_LABELS = { card: 'alert.comp.card', lock: 'alert.comp.lock' } as const;

export const CompLinePayload = z
  .object({
    order_item_id: z.string().min(1),
    units: z.number().int().min(1),
    reason_code: z.string().min(1),
    note: z.string().max(120).optional(),
  })
  .superRefine((p, rc) => {
    // §3.9 / E0 AC3: a reason is required; reason_code 'other' carries it in the note.
    if (p.reason_code === 'other' && (p.note === undefined || p.note.trim() === '')) {
      rc.addIssue({ code: 'custom', path: ['note'], message: "note is required when reason_code is 'other'" });
    }
  });
type Payload = z.infer<typeof CompLinePayload>;

/** §6.12 values_schema. */
export const CompValues = z.object({
  order_id: z.string().min(1),
  order_item_id: z.string().min(1),
  units: z.number().int().min(1),
  reason_code: z.string().min(1),
  note: z.string().max(120).nullable(),
});
export type CompValues = z.infer<typeof CompValues>;

type LineRow = Pick<
  LineView,
  | 'order_item_id'
  | 'order_id'
  | 'parent_order_item_id'
  | 'line_kind'
  | 'name'
  | 'sale_unit'
  | 'quantity'
  | 'units'
  | 'comped_units'
  | 'removed_units'
  | 'voided_units'
  | 'refundable_minor'
  | 'comp_minor'
  | 'comp_voided_minor'
  | 'removed_minor'
  | 'refund_minor'
  | 'return_of'
  | 'served_from_zone_id'
  | 'added_at'
>;
type Row = LineRow & { billed_at: number | null; primary_table_id: string | null };

// One statement: the named line and its children (a deal's parts, an item's option children), with the order's
// billed_at and its current table (02a seating_orders → seatings, read-only join, P-1c) for the request's display.
const READ = `SELECT l.order_item_id, l.order_id, l.parent_order_item_id, l.line_kind, l.name, l.sale_unit, l.quantity, l.units,
       l.comped_units, l.removed_units, l.voided_units, l.refundable_minor, l.comp_minor, l.comp_voided_minor,
       l.removed_minor, l.refund_minor, l.return_of, l.served_from_zone_id, l.added_at,
       o.billed_at, s.primary_table_id
  FROM order_lines t
  JOIN orders o ON o.order_id = t.order_id
  LEFT JOIN seating_orders so ON so.order_id = o.order_id
  LEFT JOIN seatings s ON s.seating_id = so.seating_id
  JOIN order_lines l ON l.order_id = t.order_id AND (l.order_item_id = t.order_item_id OR l.parent_order_item_id = t.order_item_id)
 WHERE t.order_item_id = ?
 ORDER BY l.added_at, l.rowid`;

interface Read {
  line: LineRow & LedgerParent;
  children: (LineRow & LedgerRef)[];
  billed_at: number | null;
  primary_table_id: string | null;
}

function readLine(ctx: CommandCtx, order_item_id: string): Read {
  const rows = ctx.tx.db.prepare(READ).all(order_item_id) as Row[];
  const line = rows.find((r) => r.order_item_id === order_item_id);
  // Unknown line → 404 ORDER_NOT_FOUND { order_item_id } (as SetLineWeight; the command names a line, not an order).
  if (line === undefined) throw new DomainError('ORDER_NOT_FOUND', { order_item_id });
  // §3.4 cascade children: a deal's parts, an item's option children.
  const childKind = line.line_kind === 'deal' ? 'deal_part' : line.line_kind === 'item' ? 'option_child' : null;
  const children = rows.filter((r) => r !== line && r.parent_order_item_id === order_item_id && r.line_kind === childKind);
  return { line, children, billed_at: line.billed_at, primary_table_id: line.primary_table_id };
}

const notAllowed = (reason: 'not_live' | 'return_line' | 'deal_part' | 'zone_line'): DomainError => new DomainError('COMP_NOT_ALLOWED', { reason });

/** §3.9 rules, shared by the command and the kind's `apply` re-check (0 statements; branch config in memory). */
function check(ctx: CommandCtx, r: Read, units: number): void {
  const l = r.line;
  if (r.billed_at !== null) throw new DomainError('ORDER_BILLED', { order_id: l.order_id });
  // O13: a submitted live line (O20: remade lines included — returned_units never counts here).
  if (liveUnits(l) === 0) throw notAllowed('not_live');
  if (l.return_of !== null) throw notAllowed('return_line');
  // §3.4: a part alone is never comped (comp the deal unit).
  if (l.line_kind === 'deal_part') throw notAllowed('deal_part');
  // §3.5 zone rule: a zone-served line may still be undone within zone_undo_ms of its ItemAdded.
  if (l.served_from_zone_id !== null) {
    const undoMs = branchConfig()?.engine_settings.zone_undo_ms ?? 0;
    if (ctx.clock.branchNow() - l.added_at <= undoMs) throw notAllowed('zone_line');
  }
  // §3.6: quantity NULL while a weight is pending.
  if (l.quantity === null) throw new DomainError('LINE_WEIGHT_PENDING', { order_item_id: l.order_item_id });
  // §3.9: units ≤ live_units − comped_units (AD-17: the spec's "422 VALIDATION_FAILED" is the foundation's 400).
  if (units > liveUnits(l) - l.comped_units) {
    throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'units', message: 'units > live_units − comped_units' }] });
  }
}

/** §3.14 CompLine scope `branch` (C8, last), 0 statements. */
function checkScope(ctx: CommandCtx, order_id: string): void {
  const scope = ctx.permission !== null && 'scope' in ctx.permission ? ctx.permission.scope : null;
  if (ctx.actor.staffId === null || scope !== 'branch') throw new DomainError('PERMISSION_DENIED', { reason: 'outside_scope', order_id });
}

/** §3.4 / §3.9: LineComped per touched line (each its own share) and value_minor = the sum over every line touched. */
function compDrafts(ctx: CommandCtx, r: Read, units: number, meta: CompMeta): { events: EventDraft[]; value_minor: number; after: Map<string, LineRow> } {
  const plan = planComp(r.line, r.children, units, meta);
  const envelope = { occurred_at: ctx.clock.branchNow(), actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId };
  const events: EventDraft[] = plan.lines.map((p) => {
    const payload: LineCompedPayload = p.payload;
    return { stream_type: 'order', stream_id: r.line.order_id, event_type: 'LineComped', schema_version: 1, payload, ...envelope };
  });
  const after = new Map<string, LineRow>([r.line, ...r.children].map((l) => [l.order_item_id, l]));
  for (const p of plan.lines) after.set(p.order_item_id, { ...after.get(p.order_item_id)!, ...p.after });
  return { events, value_minor: plan.value_minor, after };
}

/** §3.12 lock-safe label: the primary table's config name (its id when the config does not know it). */
function tableCode(table_id: string | null): string | null {
  if (table_id === null) return null;
  for (const floor of branchConfig()?.floors ?? []) {
    const table = floor.tables.find((t) => t.table_id === table_id);
    if (table !== undefined) return table.name;
  }
  return table_id;
}

function compLine(ctx: CommandCtx, p: Payload): { events: EventDraft[]; result: unknown } {
  const r = readLine(ctx, p.order_item_id);
  check(ctx, r, p.units);
  checkScope(ctx, r.line.order_id);
  const caller = ctx.actor.staffId!; // checkScope: a staff session
  const note = p.note ?? null;
  const meta: CompMeta = { reason_code: p.reason_code, note, requester_staff_id: caller, alert_id: null, approver_staff_id: null };
  const comp = compDrafts(ctx, r, p.units, meta);

  if (ctx.permission !== null && ctx.permission.grant === 'requires_approval') {
    // §3.9: the request; its amount is the value the comp would have now (the approve re-computes it).
    const values: CompValues = { order_id: r.line.order_id, order_item_id: p.order_item_id, units: p.units, reason_code: p.reason_code, note };
    const reason = (note === null ? p.reason_code : `${p.reason_code}: ${note}`).slice(0, 200);
    const details: AlertDetails = { item: r.line.name, quantity: p.units, amount: comp.value_minor, reason };
    const display: AlertDisplay = {
      kind_label_key: COMP_LABELS.lock,
      table_code: tableCode(r.primary_table_id),
      requester_name: ctx.directory.get(caller)?.display_name ?? null,
    };
    const raised = alerts.raise(ctx, {
      kind: COMP_KIND,
      subject: { stream_type: 'order', stream_id: r.line.order_id },
      target: { kind: 'answerers' },
      values,
      details,
      display,
      dedupe_key: `comp:${p.order_item_id}`,
      requester_staff_id: caller,
      request: { approver_role_ids: ctx.permission.approver_role_ids },
    });
    if (raised.deduped) throw new DomainError('COMP_PENDING', { alert_id: raised.alert_id });
    // ⚠️ 02b v1.0.11 §6.8 (Q-11): the pending result carries the request's amount (details.amount), 0 statements.
    return { events: raised.events, result: { alert_id: raised.alert_id, pending: true, value_minor: comp.value_minor } };
  }

  // Grant `allowed`: the comp now, then the requests it leaves stale (§3.9).
  // §3.9 (line-change.ts staleCompCloses): only the lines this comp touched are judged; others keep what they had.
  const stale = staleCompCloses(ctx, r.line.order_id, (id) => {
    const line = comp.after.get(id);
    return line === undefined ? undefined : liveUnits(line) - line.comped_units;
  });
  const events = [...comp.events, ...stale.drafts];
  return { events, result: { comped: true, value_minor: comp.value_minor } };
}

/**
 * §6.12 `apply` (approve): a read-only re-check of §3.9 on the current ledger (1 statement), then LineComped per line
 * with `value_minor` recomputed now, the request's note and requester, this alert's id and the answerer as approver
 * (01d: never `actor_id`, which is the requester for an in-person answer). Reject → []. A failed re-check throws its
 * error code and the answer is refused.
 */
export function applyComp(ctx: AlertApplyCtx<CompValues, AlertDetails>, answer: AnswerFacts): EventDraft[] {
  if (answer.decision !== 'approve') return [];
  const v = ctx.alert.values;
  const requester = ctx.alert.requester_staff_id;
  if (requester === null) throw new Error(`comp ${ctx.alert.alert_id}: a comp request always has a requester`);
  const r = readLine(ctx, v.order_item_id);
  check(ctx, r, v.units);
  const meta: CompMeta = { reason_code: v.reason_code, note: v.note, requester_staff_id: requester, alert_id: ctx.alert.alert_id, approver_staff_id: answer.answerer_staff_id };
  return compDrafts(ctx, r, v.units, meta).events;
}

export const compLineCommand = defineCommand({
  commandType: 'CompLine',
  payloadSchema: CompLinePayload,
  sessionKind: 'device',
  permission: 'apply-comp',
  approvable: true,
  handle: (ctx, payload) => compLine(ctx, payload),
});

export function registerCompLine(app: FastifyInstance): void {
  commandRegistry(app).register(compLineCommand);
}
