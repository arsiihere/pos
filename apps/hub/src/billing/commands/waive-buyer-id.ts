// 05 §6.11 `WaiveBuyerId` (approvable), B19, §3.14 kind `close_without_buyer_id` (task 18). The waiver is per bill:
// it holds for every later split and survives a reopen (the billing fold sets `bills.buyer_waived`, and no other
// event clears it), so §3.3 rule 6 lets each close pass without buyer data (`buyer_id_refused = true`).
// Order (00 §3.7 pipeline, then the handler): Zod `.strict()` (400) → the grant on `close-without-buyer-id` (403;
// `requires_approval` passes, approvable) → the bill by `bill_id` (`openBillOf`, 404 BILL_NOT_FOUND; the payload is
// `bill_id` only, so no bill is opened here) → OPEN / PARTLY_PAID (`409 BILL_NOT_OPEN`) → scope (C8: the last
// refusal; the permission takes `branch` only, 01b) → the whole bill's net above the threshold, else
// `{ changed: false, reason: 'not_required' }` → already waived → `{ changed: false }` → grant `allowed`:
// `BuyerIdWaived`; `requires_approval`: the request (dedupe `buyer_waiver:<bill_id>`; a second ask answers the open one).
// Money: B19's net = the closed splits' invoices (subtotal − discount) + the open remainder's default-class
// `subtotal − discount` from the bill's own compute (queries/bill.ts exports, as the bill view and CloseSplit rule 6).
// Statements (00 envelope and 01d's raise excluded), fixed whatever the lines: openBillOf (1), SPLITS_OF_BILL (1),
// orders of the bill (1), orderLines (1), pendingVoids (1), the note into `bill_texts` (1, with a note) — 5 / 6.
// Owner ruling of 2026-11-20 (task 18): WaiveBuyerId statements are ≤ 6 (was ≤ 4; goes into the next spec bump).
// The kind's `apply`: openBillOf (1), read-only.
// Privacy: the command takes no buyer data at all; the note is free text → `hashOmit: ['note']` (row H-4, H16-7),
// its text only in `bill_texts` (H3-5); values / details / the event carry ids, flags and the net only.
import { computeBill, DomainError, type ComputePayment } from '@pos/domain';
import { BuyerIdWaived, BuyerIdWaivedPayload, draftOf, type AlertDetails, type AlertDisplay, type EventDraft } from '@pos/events';
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
import { ruleInForce } from '../defaults.js';
import { registerBillKindApply } from '../kinds/seam.js';
import type { BillRequestDetails, CloseWithoutBuyerIdValues } from '../kinds/values.js';
import { billComputeBase, billLines, ONE_OPEN_SPLIT, ORDERS_OF_BILL, ordersOfBillParams, planOf, SPLITS_OF_BILL, type PaymentRow, type SplitRow } from '../queries/bill.js';
import { billingAt, openBillOf, type BillHead } from './ensure-bill.js';

// ------------------------------------------------------------------------------------------------ payload

/** §6.11 `{ bill_id, note? }`; §4.4: `note` ≤ 200. */
export const WaiveBuyerIdPayload = z.object({ bill_id: z.string().min(1), note: z.string().max(200).optional() }).strict();
type Payload = z.infer<typeof WaiveBuyerIdPayload>;

// ------------------------------------------------------------------------------------------------ shared steps

const LABELS = { lock: 'alert.close_without_buyer_id.lock' } as const;

/** §6.11: OPEN / PARTLY_PAID and not absorbed, else `409 BILL_NOT_OPEN { bill_id, state }`. 0 statements. */
function requireOpen(head: BillHead): string {
  if (head.state === 'closed' || head.absorbed || head.bill_id === null) {
    throw new DomainError('BILL_NOT_OPEN', { bill_id: head.bill_id, state: head.absorbed ? 'absorbed' : head.state });
  }
  return head.bill_id;
}

function readOpen(db: CommandCtx['tx']['db'], bill_id: string, openDay: string | null): BillHead {
  const { head, missing } = openBillOf(db, { bill_id }, openDay); // 1
  if (missing) throw new DomainError('BILL_NOT_FOUND', { bill_id });
  requireOpen(head);
  return head;
}

/** C8, last: `close-without-buyer-id` takes `branch` only (01b PERMISSION_SCOPES). 0 statements. */
function requireScope(ctx: CommandCtx, head: BillHead): void {
  const scope = ctx.permission !== null && 'scope' in ctx.permission ? ctx.permission.scope : null;
  if (ctx.actor.staffId === null || scope !== 'branch') {
    throw new DomainError('PERMISSION_DENIED', { reason: 'outside_scope', ...(head.seating === null ? {} : { table_ids: [head.seating.primary_table_id] }) });
  }
}

/**
 * B19 / §3.3 rule 6: is the buyer ID required on this bill now — the whole bill's pre-tax net after discount (the
 * closed splits' invoices + the open remainder at the default class) above the jurisdiction's threshold (`null` =
 * never). Reads SPLITS_OF_BILL, orders, orderLines, pendingVoids (4); compute is pure.
 */
function buyerRule(ctx: CommandCtx, head: BillHead): { required: boolean; net_minor: number } {
  const db = ctx.tx.db;
  const config = branchConfig();
  if (config === null || head.business_date === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');
  const bill_id = head.bill_id as string;
  const rows = db.prepare(SPLITS_OF_BILL).all(bill_id) as SplitRow[]; // 1
  const splits = rows.length === 0 ? [ONE_OPEN_SPLIT] : rows;
  const orders = db.prepare(ORDERS_OF_BILL).all({ ...ordersOfBillParams(head), bill_id }) as Array<{ order_id: string }>; // 1
  const order_ids = orders.map((o) => o.order_id);
  const byOrder = orderLines(db, order_ids); // 1
  const voids = pendingVoids(db, order_ids); // 1
  const { billing, rules } = billingAt(config, head.business_date);
  const { input } = billComputeBase({ head, billing, rules, lines: billLines(order_ids, byOrder), voids, splits });
  const openRows = splits.filter((s) => s.state === 'open');
  const closedNet = splits.filter((s) => s.state === 'closed').reduce((a, s) => a + (s.inv_subtotal_minor ?? 0) - (s.inv_discount_minor ?? 0), 0);
  let openNet = 0;
  if (openRows.length > 0) {
    const payments: ComputePayment[] = openRows.flatMap((s) =>
      (JSON.parse(s.payments_json) as PaymentRow[]).map((x) => ({ split_no: s.split_no, payment_class: x.payment_class, direction: x.direction, amount_minor: x.amount_minor, tendered_minor: x.tendered_minor })),
    );
    const t = computeBill({ ...input, plan: planOf(head, openRows), payments }).totals_default;
    openNet = t.subtotal_minor - t.discount_minor;
  }
  const net_minor = closedNet + openNet;
  const threshold = ruleInForce(billing, head.business_date)?.buyer_id.threshold_minor ?? null;
  return { required: threshold !== null && net_minor > threshold, net_minor };
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

function waivedDraft(ctx: CommandCtx, p: BuyerIdWaivedPayload): EventDraft {
  const envelope = { occurred_at: ctx.clock.branchNow(), actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId };
  return draftOf(BuyerIdWaived, { stream_type: 'bill', stream_id: p.bill_id, payload: BuyerIdWaivedPayload.parse(p), ...envelope });
}

/** §3.12 lock-safe label: the seating's primary table by its config name (02b comp precedent); a key bill has none. */
function tableCodeOf(head: BillHead): string | null {
  const table = head.seating?.primary_table_id;
  if (table === undefined || head.scope !== 'seating') return null;
  const name = branchConfig()?.floors.flatMap((f) => f.tables).find((t) => t.table_id === table)?.name ?? table;
  return tableLabel(name).slice(0, 40);
}

// ------------------------------------------------------------------------------------------------ WaiveBuyerId

function waiveBuyerId(ctx: CommandCtx, p: Payload): { events: EventDraft[]; result: unknown } {
  const head = readOpen(ctx.tx.db, p.bill_id, ctx.state.business_day?.business_date ?? null); // 1
  const bill_id = p.bill_id;
  requireScope(ctx, head); // the last refusal (C8); "not required" / "already waived" below are answers
  const rule = buyerRule(ctx, head); // 4
  if (!rule.required) return { events: [], result: { bill_id, changed: false, reason: 'not_required' } };
  if (head.buyer_waived) return { events: [], result: { bill_id, changed: false } };
  const requester = ctx.actor.staffId as string; // requireScope refused a session with no staff
  // the request's values carry note_id, and the dedupe hit is known only after raise: knowing it earlier would cost a
  // byDedupeKey read (+1 statement), so a dedupe hit leaves one unused ULID and writes no note
  const note = noteOf(ctx, p.note);

  if (ctx.permission !== null && ctx.permission.grant === 'requires_approval') {
    // §3.14: values ids only (H3-5, H4-4); details in AlertDetailsBase keys (H2-6): the net and the table, never buyer data
    const values: CloseWithoutBuyerIdValues = { bill_id, note_id: note.note_id, has_note: note.has_note };
    const table_code = tableCodeOf(head);
    const details: BillRequestDetails = { amount: rule.net_minor, ...(table_code === null ? {} : { identifier: table_code }) };
    const display: AlertDisplay = { kind_label_key: LABELS.lock, table_code, point_code: null, requester_name: ctx.directory.get(requester)?.display_name ?? null, device_name: null };
    const raised = alerts.raise(ctx, {
      kind: 'close_without_buyer_id',
      subject: { stream_type: 'bill', stream_id: bill_id },
      target: { kind: 'answerers' },
      values,
      details: details as AlertDetails,
      display,
      dedupe_key: `buyer_waiver:${bill_id}`,
      requester_staff_id: requester,
      request: { approver_role_ids: ctx.permission.approver_role_ids },
    });
    // owner R-59 pattern: a second ask answers 200 with the request already open; a dedupe hit writes no note
    if (!raised.deduped) writeNote(ctx, note);
    return { events: raised.events, result: { bill_id, pending: { alert_id: raised.alert_id } } };
  }

  writeNote(ctx, note);
  const waived = waivedDraft(ctx, { bill_id, has_note: note.has_note, note_id: note.note_id, requester_staff_id: requester, approver_staff_id: null, alert_id: null });
  return { events: [waived], result: { bill_id, changed: true } };
}

/**
 * §3.14 `apply` (approve only, H6-2 / H7-5): re-checks, read-only, the bill is OPEN / PARTLY_PAID (1 statement,
 * openBillOf), else throws and the answer is refused; then `BuyerIdWaived` with the request's note, its requester,
 * this alert's id and the answerer as approver (01d: never `actor_id`). Reject → [] (0 statements).
 */
export function applyCloseWithoutBuyerId(ctx: AlertApplyCtx<CloseWithoutBuyerIdValues, BillRequestDetails>, answer: AnswerFacts): EventDraft[] {
  if (answer.decision !== 'approve') return [];
  const v = ctx.alert.values;
  const requester = ctx.alert.requester_staff_id;
  if (requester === null) throw new Error(`close_without_buyer_id ${ctx.alert.alert_id}: a request always has a requester`);
  readOpen(ctx.tx.db, v.bill_id, ctx.state.business_day?.business_date ?? null); // 1
  return [
    waivedDraft(ctx, {
      bill_id: v.bill_id,
      has_note: v.has_note,
      note_id: v.note_id,
      requester_staff_id: requester,
      approver_staff_id: answer.answerer_staff_id,
      alert_id: ctx.alert.alert_id,
    }),
  ];
}

// 05 §3.14, PL-5 seam (task 9 reviewers' rule): module top level, a module-level function, never a closure.
registerBillKindApply('close_without_buyer_id', { apply: applyCloseWithoutBuyerId });

export const WaiveBuyerId = defineCommand({
  commandType: 'WaiveBuyerId',
  payloadSchema: WaiveBuyerIdPayload,
  sessionKind: 'device',
  permission: 'close-without-buyer-id',
  approvable: true,
  hashOmit: ['note'], // row H-4, H16-7: the note never reaches payload_hash
  handle: (ctx, p) => waiveBuyerId(ctx, p),
});

export function registerWaiveBuyerId(app: FastifyInstance): void {
  commandRegistry(app).register(WaiveBuyerId);
}
