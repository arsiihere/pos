// 05 §6.6 `ApplyDiscount` (approvable) and §6.7 `RemoveDiscount`, B7, §3.5 (2), §3.14 kind `discount` (task 13).
// Whole bill only (OQ-4), set and changed only while no split is closed: PARTLY_PAID → `409 BILL_PARTLY_PAID` before
// "not OPEN" → `409 BILL_NOT_OPEN` (H1-12), in the commands and in the kind's `apply` alike.
// Order (00 §3.7 pipeline, then the handler): Zod (400; `preRead` adds §6.6's Zod item "`reason_code` ∈ the branch's
// discount reasons", which needs the branch config, so it still answers before the grant) → the grant on
// `apply-discount` (403; `requires_approval` passes, both commands are approvable) → ensure bill inside the writer
// transaction (404 / 409 of §6) → state: PARTLY_PAID, then not OPEN → no open `discount` request
// (`409 DISCOUNT_PENDING { alert_id }`) → lines → the amount fits the whole bill's `S` and `max_discount_pct` of it
// (`422 DISCOUNT_TOO_LARGE { max_minor }`) → scope last (C8; `branch` only, 01b) → grant `allowed`: `DiscountApplied`;
// `requires_approval`: the request (dedupe `discount:<bill_id>`).
// Money: the bill's §3.5 compute through the shared `bill.ts` exports (`billComputeBase` → `computeBill`); the amount is
// the compute's own discount (`floor(S × bp / 10 000)` for a percent, §3.5 (2)), recomputed by `apply` at answer time
// (`amount_minor (at apply)`); `S` = the compute's subtotal (§3.1 line bases, pending voids' refunds out). On an OPEN
// bill no split is closed (a reopen opens every split, §3.10), so the open part is the whole bill.
// Statements (00 envelope and 01d's raise excluded): ensure bill (1), the open-request read (1; none for a bill opened
// here), orders of the bill (1), orderLines (1), pendingVoids (1), the note into `bill_texts` (1, with a note): ≤ 6.
// The kind's `apply`: openBillOf, orders, orderLines, pendingVoids (4), read-only. RemoveDiscount: openBillOf (1) +
// the note (1) = 2. Notes: `hashOmit: ['note']` (row H-4, H16-7): never in `payload_hash`; text only in `bill_texts`.
import { computeBill, DomainError } from '@pos/domain';
import { DiscountApplied, DiscountAppliedPayload, DiscountRemoved, DiscountRemovedPayload, draftOf, type AlertDetails, type AlertDisplay, type EventDraft } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AlertApplyCtx, AnswerFacts } from '../../alerts/kinds.js';
import { alerts } from '../../alerts/raise.js';
import { defineCommand, type CommandCtx } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { tableLabel } from '../../kds/details.js';
import { orderLines } from '../../orders/exports.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { pendingVoids } from '../../voids/exports.js';
import { hubBilling } from '../defaults.js';
import { registerBillKindApply } from '../kinds/seam.js';
import type { BillRequestDetails, DiscountValues } from '../kinds/values.js';
import { billComputeBase, billLines, ONE_OPEN_SPLIT, ORDERS_OF_BILL, ordersOfBillParams, toTotals, type Totals } from '../queries/bill.js';
import { billingAt, BillRef, ensureBill, openBillOf, type BillHead } from './ensure-bill.js';

// ------------------------------------------------------------------------------------------------ payloads

/** H16-13: money caps scaled for any currency. */
const MAX_MINOR = Math.min(1e12, Number.MAX_SAFE_INTEGER);
/** §4.4: `note` ≤ 200, required whenever the reason code is `other`. */
const Note = z.string().max(200);
const ReasonCode = z.string().min(1).max(40);

function noteForOther(p: { reason_code: string; note?: string | undefined }, rc: z.RefinementCtx): void {
  if (p.reason_code === 'other' && (p.note === undefined || p.note.trim() === '')) {
    rc.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: "note is required when reason_code is 'other'" });
  }
}

/** §6.6: `amount` ≥ 1 minor unit; `percent` in basis points 1–10 000; no `split_no` (OQ-4). */
export const ApplyDiscountPayload = z
  .object({ bill_ref: BillRef, kind: z.enum(['amount', 'percent']), value: z.number().int().min(1).max(MAX_MINOR), reason_code: ReasonCode, note: Note.optional() })
  .strict()
  .superRefine((p, rc) => {
    if (p.kind === 'percent' && p.value > 10_000) rc.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'percent is 1–10 000 bp' });
    noteForOther(p, rc);
  });
type ApplyPayload = z.infer<typeof ApplyDiscountPayload>;

/** §6.7: `{ bill_id, reason_code, note? }`. */
export const RemoveDiscountPayload = z.object({ bill_id: z.string().min(1), reason_code: ReasonCode, note: Note.optional() }).strict().superRefine(noteForOther);
type RemovePayload = z.infer<typeof RemoveDiscountPayload>;

// ------------------------------------------------------------------------------------------------ shared steps

const LABELS = { lock: 'alert.discount.lock' } as const;

/** §6.6 / §6.7 / H1-12: PARTLY_PAID first, then not OPEN (closed or absorbed). 0 statements. */
function requireOpen(head: BillHead): string {
  if (head.state === 'partly_paid' && !head.absorbed) throw new DomainError('BILL_PARTLY_PAID', { bill_id: head.bill_id });
  if (head.state !== 'open' || head.absorbed || head.bill_id === null) {
    throw new DomainError('BILL_NOT_OPEN', { bill_id: head.bill_id, state: head.absorbed ? 'absorbed' : head.state });
  }
  return head.bill_id;
}

/** C8, last: `apply-discount` takes `branch` only (01b PERMISSION_SCOPES). 0 statements. */
function requireScope(ctx: CommandCtx, head: BillHead): void {
  const scope = ctx.permission !== null && 'scope' in ctx.permission ? ctx.permission.scope : null;
  if (ctx.actor.staffId === null || scope !== 'branch') {
    throw new DomainError('PERMISSION_DENIED', { reason: 'outside_scope', ...(head.seating === null ? {} : { table_ids: [head.seating.primary_table_id] }) });
  }
}

/**
 * §6.6 Zod item: `reason_code` ∈ the branch's discount reasons (owner-edited, §4.4); else 400 at `reason_code`. Run as
 * `preRead` (after Zod, before the grant, 00 §3.7); 0 statements, the config is in memory.
 */
function requireReason(reason_code: string): void {
  const config = branchConfig();
  const codes = config === null ? [] : hubBilling(config).settings.discount_reasons.map((r) => r.code);
  if (!codes.includes(reason_code)) {
    throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'reason_code', message: "not one of the branch's discount reasons" }] });
  }
}

function noteOf(ctx: CommandCtx, note: string | undefined): { note_id: string | null; has_note: boolean; text: string | null } {
  if (note === undefined || note.trim() === '') return { note_id: null, has_note: false, text: null };
  return { note_id: ctx.ids.next(), has_note: true, text: note };
}

/** 1 statement (hub state, never synced): `bill_texts (subject_id = note_id, field 'note')`. */
function writeNote(ctx: CommandCtx, n: { note_id: string | null; text: string | null }): void {
  if (n.note_id === null || n.text === null) return;
  ctx.tx.db.prepare(`INSERT INTO bill_texts (subject_id, field, text) VALUES (?, 'note', ?)`).run(n.note_id, n.text);
}

const envelopeOf = (ctx: CommandCtx) => ({ occurred_at: ctx.clock.branchNow(), actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId });

function tableCodeOf(head: BillHead): string | null {
  const table = head.seating?.primary_table_id;
  if (table === undefined || head.scope !== 'seating') return null;
  const name = branchConfig()?.floors.flatMap((f) => f.tables).find((t) => t.table_id === table)?.name ?? table;
  return tableLabel(name).slice(0, 40);
}

interface Priced {
  amount_minor: number;
  /** the whole bill's default-class totals with this discount (§6.6 `applied`) */
  totals: Totals;
}

/**
 * §6.6 / §3.5 (2): the amount of `{ kind, value }` on the bill now and its check — ≤ `S` and ≤ `max_discount_pct` of
 * `S` (`422 DISCOUNT_TOO_LARGE { max_minor }`); a percent that comes to 0 minor units is refused at `value` (Reading
 * R13-a: `DiscountApplied.amount_minor` is positive). Reads orders, orderLines, pendingVoids (3); compute is pure.
 */
function priceOf(ctx: CommandCtx, head: BillHead, created: boolean, d: { kind: 'amount' | 'percent'; value: number }): Priced {
  const db = ctx.tx.db;
  const config = branchConfig();
  if (config === null || head.business_date === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');
  const orders = db.prepare(ORDERS_OF_BILL).all({ ...ordersOfBillParams(head), bill_id: created ? null : head.bill_id }) as Array<{ order_id: string }>; // 1
  const order_ids = orders.map((o) => o.order_id);
  const byOrder = orderLines(db, order_ids); // 1
  const voids = pendingVoids(db, order_ids); // 1
  const { billing, rules } = billingAt(config, head.business_date);
  const withDiscount: BillHead = { ...head, discount: { kind: d.kind, value: d.value, reason_code: '', alert_id: null, frozen_minor: null } };
  const { input } = billComputeBase({ head: withDiscount, billing, rules, lines: billLines(order_ids, byOrder), voids, splits: [ONE_OPEN_SPLIT] });
  const result = computeBill({ ...input, plan: { mode: 'none', split_no: ONE_OPEN_SPLIT.split_no }, payments: [] });
  // the compute caps its spread at S; an amount above it is caught here by comparing the asked value
  const s = BigInt(result.totals_default.subtotal_minor);
  const amount = d.kind === 'amount' ? BigInt(d.value) : BigInt(result.discount_minor);
  const max = (s * BigInt(billing.settings.max_discount_pct)) / 100n;
  const maxMinor = max < s ? max : s;
  if (amount > maxMinor) throw new DomainError('DISCOUNT_TOO_LARGE', { max_minor: Number(maxMinor) });
  if (amount === 0n) throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'value', message: 'the discount comes to 0 minor units on this bill' }] });
  return { amount_minor: Number(amount), totals: toTotals(result.totals_default) };
}

function appliedDraft(ctx: CommandCtx, p: DiscountAppliedPayload): EventDraft {
  return draftOf(DiscountApplied, { stream_type: 'bill', stream_id: p.bill_id, payload: DiscountAppliedPayload.parse(p), ...envelopeOf(ctx) });
}

// ------------------------------------------------------------------------------------------------ ApplyDiscount

function applyDiscount(ctx: CommandCtx, p: ApplyPayload): { events: EventDraft[]; result: unknown } {
  const { head, events, created } = ensureBill(ctx, p.bill_ref); // 1
  const bill_id = requireOpen(head);
  if (!created) {
    const open = alerts.byDedupeKey(ctx.tx.db, 'discount', `discount:${bill_id}`); // 1
    if (open !== null) throw new DomainError('DISCOUNT_PENDING', { alert_id: open });
  }
  const priced = priceOf(ctx, head, created, p); // 3
  requireScope(ctx, head);
  const requester = ctx.actor.staffId as string; // requireScope refused a session with no staff
  const note = noteOf(ctx, p.note);

  if (ctx.permission !== null && ctx.permission.grant === 'requires_approval') {
    // §3.14: values ids / codes / amounts only (H3-5, H4-4); details in AlertDetailsBase keys (H2-6)
    const values: DiscountValues = { bill_id, kind: p.kind, value: p.value, reason_code: p.reason_code, note_id: note.note_id, has_note: note.has_note };
    const table_code = tableCodeOf(head);
    const details: BillRequestDetails = { amount: priced.amount_minor, reason: p.reason_code, ...(table_code === null ? {} : { identifier: table_code }) };
    const display: AlertDisplay = { kind_label_key: LABELS.lock, table_code, point_code: null, requester_name: ctx.directory.get(requester)?.display_name ?? null, device_name: null };
    const raised = alerts.raise(ctx, {
      kind: 'discount',
      subject: { stream_type: 'bill', stream_id: bill_id },
      target: { kind: 'answerers' },
      values,
      details: details as AlertDetails,
      display,
      dedupe_key: `discount:${bill_id}`,
      requester_staff_id: requester,
      request: { approver_role_ids: ctx.permission.approver_role_ids },
    });
    if (!raised.deduped) writeNote(ctx, note); // the text is written at raise (H3-5)
    return { events: [...events, ...raised.events], result: { bill_id, pending: { alert_id: raised.alert_id } } };
  }

  writeNote(ctx, note);
  events.push(
    appliedDraft(ctx, {
      bill_id,
      kind: p.kind,
      value: p.value,
      amount_minor: priced.amount_minor,
      reason_code: p.reason_code,
      has_note: note.has_note,
      note_id: note.note_id,
      requester_staff_id: requester,
      approver_staff_id: null,
      alert_id: null,
      replaces: head.discount !== null,
    }),
  );
  return { events, result: { bill_id, applied: priced.totals } };
}

/**
 * §3.14 `apply` (approve only, H7-5): re-checks, read-only, in §6.6's order — PARTLY_PAID, not OPEN, the amount still
 * fits (recomputed now) — else throws and the answer is refused; then `DiscountApplied` with the request's values, its
 * requester, this alert's id and the answerer as approver (01d: never `actor_id`). Reject → [] (0 statements).
 */
export function applyDiscountRequest(ctx: AlertApplyCtx<DiscountValues, BillRequestDetails>, answer: AnswerFacts): EventDraft[] {
  if (answer.decision !== 'approve') return [];
  const v = ctx.alert.values;
  const requester = ctx.alert.requester_staff_id;
  if (requester === null) throw new Error(`discount ${ctx.alert.alert_id}: a request always has a requester`);
  const { head, missing } = openBillOf(ctx.tx.db, { bill_id: v.bill_id }, ctx.state.business_day?.business_date ?? null); // 1
  if (missing) throw new DomainError('BILL_NOT_FOUND', { bill_id: v.bill_id });
  requireOpen(head);
  const priced = priceOf(ctx, head, false, v); // 3
  return [
    appliedDraft(ctx, {
      bill_id: v.bill_id,
      kind: v.kind,
      value: v.value,
      amount_minor: priced.amount_minor,
      reason_code: v.reason_code,
      has_note: v.has_note,
      note_id: v.note_id,
      requester_staff_id: requester,
      approver_staff_id: answer.answerer_staff_id,
      alert_id: ctx.alert.alert_id,
      replaces: head.discount !== null,
    }),
  ];
}

// 05 §3.14, PL-5 seam (task 9 reviewers' rule): module top level, a module-level function, never a closure.
registerBillKindApply('discount', { apply: applyDiscountRequest });

export const ApplyDiscount = defineCommand({
  commandType: 'ApplyDiscount',
  payloadSchema: ApplyDiscountPayload,
  sessionKind: 'device',
  permission: 'apply-discount',
  approvable: true,
  hashOmit: ['note'], // row H-4, H16-7: the note never reaches payload_hash
  preRead: (_db, p) => requireReason(p.reason_code),
  handle: (ctx, p) => applyDiscount(ctx, p),
});

// ------------------------------------------------------------------------------------------------ RemoveDiscount

/**
 * §6.7: `apply-discount` `allowed` or `requires_approval` both remove directly (removal raises the price): the command
 * is `approvable` only so the pipeline lets a `requires_approval` grant through; it never raises a request.
 * PARTLY_PAID → not OPEN → no discount → `{ changed: false }` → scope → `DiscountRemoved { bill_id, reason_code,
 * has_note, note_id }` (§6.29: nothing else).
 */
function removeDiscount(ctx: CommandCtx, p: RemovePayload): { events: EventDraft[]; result: unknown } {
  const { head, missing } = openBillOf(ctx.tx.db, { bill_id: p.bill_id }, ctx.state.business_day?.business_date ?? null); // 1
  if (missing) throw new DomainError('BILL_NOT_FOUND', { bill_id: p.bill_id });
  const bill_id = requireOpen(head);
  requireScope(ctx, head);
  if (head.discount === null) return { events: [], result: { bill_id, changed: false } };
  const note = noteOf(ctx, p.note);
  writeNote(ctx, note);
  const payload = DiscountRemovedPayload.parse({ bill_id, reason_code: p.reason_code, has_note: note.has_note, note_id: note.note_id });
  return { events: [draftOf(DiscountRemoved, { stream_type: 'bill', stream_id: bill_id, payload, ...envelopeOf(ctx) })], result: { bill_id, changed: true } };
}

export const RemoveDiscount = defineCommand({
  commandType: 'RemoveDiscount',
  payloadSchema: RemoveDiscountPayload,
  sessionKind: 'device',
  permission: 'apply-discount',
  approvable: true,
  hashOmit: ['note'], // row H-4, H16-7
  preRead: (_db, p) => requireReason(p.reason_code),
  handle: (ctx, p) => removeDiscount(ctx, p),
});

export function registerDiscount(app: FastifyInstance): void {
  commandRegistry(app).register(ApplyDiscount);
  commandRegistry(app).register(RemoveDiscount);
}
