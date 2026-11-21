// 05 §6.14 `RemoveComp` (approvable), B27, §3.14 kind `remove_comp` (task 20). Writes 02b's `LineCompRemoved` (row Q-4;
// 02b owns the event and its fold) on an unbilled line; a billed line's comp changes only through a reopen.
// Order (00 §3.7 pipeline, then 02b CompLine's order): Zod (400) → the grant on `remove-comp` (403; `requires_approval`
// passes, approvable) → the line (404 ORDER_NOT_FOUND { order_item_id }, as CompLine) → order not billed
// (`409 ORDER_BILLED`) → not a `deal_part` named alone (owner R-62: `400 VALIDATION_FAILED { path: 'order_item_id' }`)
// → line comped (`409 LINE_NOT_COMPED`) → `units ≤ comped_units` (400) → `planCompRemoval`
// (02b, pure, 0 statements; it yields the touched entries) → the line guard list once with them (02b row Q-3: 04's
// `VOID_PENDING`, 05's `LINE_IN_CLOSED_SPLIT`) → scope (C8, last; `branch` only, 01b) → grant `allowed`: one
// `LineCompRemoved` per line the plan touches (the comp's cascade, 01c §3.4.8; as one `LineComped` per line);
// `requires_approval`: the request, kind `remove_comp`, dedupe `remove_comp:<order_item_id>`.
// The line read is this file's own 1-statement read by `order_item_id` (02b CompLine's READ pattern): §6.14 names
// `readOrder`, which takes an `order_id` the payload does not carry (Readings, task 20).
// Statements: ≤ 4 (§6.14; the 00 envelope and 01d's raise excluded, as 02b CompLine counts them): the line read (1)
// + the line guard list (1 per registered guard) + the note into `bill_texts` (1, only with a note). The kind's
// `apply`: the line read + the guard list, read-only.
// Notes stay out of `payload_hash` (`hashOmit: ['note']`, 00 §3.7 row H-4, H16-7).
import { COMP_REMOVE_REASONS, DomainError } from '@pos/domain';
import { draftOf, LineCompRemoved, LineCompRemovedPayload, type AlertDetails, type AlertDisplay, type EventDraft } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AlertApplyCtx, AnswerFacts } from '../../alerts/kinds.js';
import { alerts } from '../../alerts/raise.js';
import { defineCommand, type CommandCtx } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { tableLabel } from '../../kds/details.js';
import type { LineView } from '../../orders/contracts.js';
import { planCompRemoval, type LedgerParent, type LedgerRef } from '../../orders/ledger.js';
import { lineGuardEntries, requireLineGuard, type GuardLine, type LineGuardEntry } from '../../orders/line-guard.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { registerBillKindApply } from '../kinds/seam.js';
import type { BillRequestDetails, RemoveCompValues } from '../kinds/values.js';

// ------------------------------------------------------------------------------------------------ payload

/** §4.4: `note` ≤ 200, required whenever the reason code is `other`. */
export const RemoveCompPayload = z
  .object({
    order_item_id: z.string().min(1),
    units: z.number().int().min(1).optional(),
    reason_code: z.enum(COMP_REMOVE_REASONS),
    note: z.string().max(200).optional(),
  })
  .strict()
  .superRefine((p, rc) => {
    if (p.reason_code === 'other' && (p.note === undefined || p.note.trim() === '')) {
      rc.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: "note is required when reason_code is 'other'" });
    }
  });
type Payload = z.infer<typeof RemoveCompPayload>;

// ------------------------------------------------------------------------------------------------ the line read

type LineRow = GuardLine & LedgerRef & Pick<LineView, 'order_id' | 'sale_unit'>;
type Row = LineRow & { billed_at: number | null; primary_table_id: string | null };

// One statement: the named line and its children (a deal's parts, an item's option children, each with its
// option_quantity), the order's billed_at and its seating's primary table (02a, read-only join, P-1c) for the display.
const READ = `SELECT l.order_item_id, l.order_id, l.parent_order_item_id, l.line_kind, l.sale_unit, l.units,
       l.comped_units, l.removed_units, l.voided_units, l.refundable_minor, l.comp_minor, l.comp_voided_minor,
       l.removed_minor, l.refund_minor, l.line_total_minor, l.option_quantity, o.billed_at, s.primary_table_id
  FROM order_lines t
  JOIN orders o ON o.order_id = t.order_id
  LEFT JOIN seating_orders so ON so.order_id = o.order_id
  LEFT JOIN seatings s ON s.seating_id = so.seating_id
  JOIN order_lines l ON l.order_id = t.order_id AND (l.order_item_id = t.order_item_id OR l.parent_order_item_id = t.order_item_id)
 WHERE t.order_item_id = ?
 ORDER BY l.added_at, l.rowid`;

interface Read {
  line: LineRow & LedgerParent;
  children: LineRow[];
  billed_at: number | null;
  primary_table_id: string | null;
}

function readLine(db: CommandCtx['tx']['db'], order_item_id: string): Read {
  const rows = db.prepare(READ).all(order_item_id) as Row[];
  const line = rows.find((r) => r.order_item_id === order_item_id);
  if (line === undefined) throw new DomainError('ORDER_NOT_FOUND', { order_item_id });
  // §3.4 cascade children, as the comp took them (02b CompLine): a deal's parts, an item's option children
  const childKind = line.line_kind === 'deal' ? 'deal_part' : line.line_kind === 'item' ? 'option_child' : null;
  const children = rows.filter((r) => r !== line && r.parent_order_item_id === order_item_id && r.line_kind === childKind);
  return { line, children, billed_at: line.billed_at, primary_table_id: line.primary_table_id };
}

// ------------------------------------------------------------------------------------------------ shared steps

/**
 * §6.14 / §3.14 re-check, shared by the command and the kind's `apply` (0 statements beyond the read): not billed,
 * comped, units ≤ comped; then `planCompRemoval` and the line guard list once with the plan's touched entries.
 */
function planned(db: CommandCtx['tx']['db'], r: Read, asked: number | undefined): { plan: ReturnType<typeof planCompRemoval>; touched: LineGuardEntry[] } {
  const l = r.line;
  if (r.billed_at !== null) throw new DomainError('ORDER_BILLED', { order_id: l.order_id });
  // owner R-62: a deal_part named on its own is refused (existing code); the comp is removed from the whole deal
  if (l.line_kind === 'deal_part') {
    throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'order_item_id', message: 'a deal part alone: remove the comp from the deal' }] });
  }
  if (l.comped_units === 0) throw new DomainError('LINE_NOT_COMPED', { order_item_id: l.order_item_id });
  const units = asked ?? l.comped_units;
  if (units > l.comped_units) {
    throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'units', message: 'units > comped_units' }] });
  }
  const plan = planCompRemoval(l, units, r.children);
  // ⚠️ 05 row Q-3: each touched line as the plan leaves it (units_after, comped_after, base_after_minor)
  const after = new Map<string, GuardLine>([l, ...r.children].map((x) => [x.order_item_id, x]));
  for (const p of plan.lines) after.set(p.order_item_id, { ...after.get(p.order_item_id)!, ...p.after });
  const touched = lineGuardEntries(after, plan.lines.map((p) => p.order_item_id));
  requireLineGuard(db, l.order_id, touched); // 1 per registered guard
  return { plan, touched };
}

/** C8, last: `remove-comp` takes `branch` only (01b PERMISSION_SCOPES); anything else is outside scope. 0 statements. */
function requireScope(ctx: CommandCtx, order_id: string): void {
  const scope = ctx.permission !== null && 'scope' in ctx.permission ? ctx.permission.scope : null;
  if (ctx.actor.staffId === null || scope !== 'branch') throw new DomainError('PERMISSION_DENIED', { reason: 'outside_scope', order_id });
}

/** H3-5: the note's id (minted here) and its text, written to `bill_texts` by `writeNote`; the event carries the id only. */
function noteOf(ctx: CommandCtx, note: string | undefined): { note_id: string | null; has_note: boolean; text: string | null } {
  if (note === undefined || note.trim() === '') return { note_id: null, has_note: false, text: null };
  return { note_id: ctx.ids.next(), has_note: true, text: note };
}

/** 1 statement (hub state, never synced): `bill_texts (subject_id = note_id, field 'note')`. */
function writeNote(ctx: CommandCtx, n: { note_id: string | null; text: string | null }): void {
  if (n.note_id === null || n.text === null) return;
  ctx.tx.db.prepare(`INSERT INTO bill_texts (subject_id, field, text) VALUES (?, 'note', ?)`).run(n.note_id, n.text);
}

type Meta = Pick<LineCompRemovedPayload, 'reason_code' | 'has_note' | 'note_id' | 'requester_staff_id' | 'approver_staff_id' | 'alert_id'>;

/** Row Q-4: one `LineCompRemoved` per planned line, each its own units and comp share; stream `order`. */
function removedDrafts(ctx: CommandCtx, order_id: string, plan: ReturnType<typeof planCompRemoval>, meta: Meta): EventDraft[] {
  const envelope = { occurred_at: ctx.clock.branchNow(), actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId };
  return plan.lines.map((p) =>
    draftOf(LineCompRemoved, { stream_type: 'order', stream_id: order_id, payload: LineCompRemovedPayload.parse({ ...p.payload, ...meta }), ...envelope }),
  );
}

/** §3.12 lock-safe label: the seating's primary table by its config name (02b comp precedent); a takeaway has none. */
function tableCodeOf(table_id: string | null): string | null {
  if (table_id === null) return null;
  const name = branchConfig()?.floors.flatMap((f) => f.tables).find((t) => t.table_id === table_id)?.name ?? table_id;
  return tableLabel(name).slice(0, 40);
}

// ------------------------------------------------------------------------------------------------ RemoveComp

function removeComp(ctx: CommandCtx, p: Payload): { events: EventDraft[]; result: unknown } {
  const r = readLine(ctx.tx.db, p.order_item_id); // 1
  const { plan } = planned(ctx.tx.db, r, p.units); // + the guard list
  const order_id = r.line.order_id;
  requireScope(ctx, order_id);
  const requester = ctx.actor.staffId as string; // requireScope refused a session with no staff
  const note = noteOf(ctx, p.note);

  if (ctx.permission !== null && ctx.permission.grant === 'requires_approval') {
    // §3.14: values ids / codes only (H3-5, H4-4); `units` resolved now; details in AlertDetailsBase keys (H2-6)
    const values: RemoveCompValues = { order_id, order_item_id: p.order_item_id, units: plan.units, reason_code: p.reason_code, note_id: note.note_id, has_note: note.has_note };
    const table_code = tableCodeOf(r.primary_table_id);
    const details: BillRequestDetails = { amount: plan.comp_minor, reason: p.reason_code, ...(table_code === null ? {} : { identifier: table_code }) };
    const display: AlertDisplay = { kind_label_key: 'alert.remove_comp.lock', table_code, point_code: null, requester_name: ctx.directory.get(requester)?.display_name ?? null, device_name: null };
    const raised = alerts.raise(ctx, {
      kind: 'remove_comp',
      subject: { stream_type: 'order', stream_id: order_id },
      target: { kind: 'answerers' },
      values,
      details: details as AlertDetails,
      display,
      dedupe_key: `remove_comp:${p.order_item_id}`,
      requester_staff_id: requester,
      request: { approver_role_ids: ctx.permission.approver_role_ids },
    });
    // a second ask answers 200 with the request already open (task 14 / owner R-59 pattern); a dedupe hit writes no note
    if (!raised.deduped) writeNote(ctx, note);
    return { events: raised.events, result: { pending: { alert_id: raised.alert_id } } };
  }

  writeNote(ctx, note);
  const events = removedDrafts(ctx, order_id, plan, {
    reason_code: p.reason_code,
    has_note: note.has_note,
    note_id: note.note_id,
    requester_staff_id: requester,
    approver_staff_id: null,
    alert_id: null,
  });
  return { events, result: { removed: { units: plan.units, comp_minor: plan.comp_minor } } };
}

/**
 * §3.14 `apply` (approve only, H6-2 / H7-5): re-checks §6.14 read-only on the current ledger — order not billed,
 * `comped_units ≥ units`, the line guard list (incl. `LINE_IN_CLOSED_SPLIT`) — else throws and the answer is refused;
 * then `LineCompRemoved` per line with the request's reason and note, its requester, this alert's id and the answerer
 * as approver (01d: never `actor_id`). Reject → [] (0 statements).
 */
export function applyRemoveComp(ctx: AlertApplyCtx<RemoveCompValues, BillRequestDetails>, answer: AnswerFacts): EventDraft[] {
  if (answer.decision !== 'approve') return [];
  const v = ctx.alert.values;
  const requester = ctx.alert.requester_staff_id;
  if (requester === null) throw new Error(`remove_comp ${ctx.alert.alert_id}: a request always has a requester`);
  const r = readLine(ctx.tx.db, v.order_item_id); // 1
  const { plan } = planned(ctx.tx.db, r, v.units);
  return removedDrafts(ctx, r.line.order_id, plan, {
    reason_code: v.reason_code,
    has_note: v.has_note,
    note_id: v.note_id,
    requester_staff_id: requester,
    approver_staff_id: answer.answerer_staff_id,
    alert_id: ctx.alert.alert_id,
  });
}

// 05 §3.14, PL-5 seam (task 9 reviewers' rule): module top level, a module-level function, never a closure.
registerBillKindApply('remove_comp', { apply: applyRemoveComp });

export const RemoveComp = defineCommand({
  commandType: 'RemoveComp',
  payloadSchema: RemoveCompPayload,
  sessionKind: 'device',
  permission: 'remove-comp',
  approvable: true,
  hashOmit: ['note'], // row H-4, H16-7: the note never reaches payload_hash
  handle: (ctx, p) => removeComp(ctx, p),
});

export function registerRemoveComp(app: FastifyInstance): void {
  commandRegistry(app).register(RemoveComp);
}
