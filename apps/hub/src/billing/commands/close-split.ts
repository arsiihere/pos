// 05 §6.12 `CloseSplit` (task 17): §3.3 rules 1–9 in order, the gap-free sale number (B13), `InvoiceIssued` and its
// `closed_split_units` (B15), `DiscountFrozen` at the close that takes the bill from no closed split to one (R-41 /
// G-38, R-29), at the last open split 02b `OrdersBilled` and (dine-in) 02a `BillClosed`, the stale request closes
// (H1-23, H6-2), the outbox row (task 7's fold through 28a's `outboxRowFor`, G-10), the `invoice_buyers` row (B19) and
// the receipt job (§3.16, B21). One writer transaction (`BEGIN IMMEDIATE`, the single writer): a refusal or a failed
// COMMIT leaves nothing — no event, invoice, outbox row, buyer row, print job or processed command (#36).
// Grant first (the pipeline's `take-payment`), ensure bill inside the transaction, scope last (C8). The money is the
// bill view's own reading (queries/bill.ts exports) and compute.ts (`computeBill` for the open plan, then
// `computeSplit` / `spreadLineTaxes` on this split, J-2, R-17–R-21). `fiscal.required` per R-46. The buyer object is
// never hashed, logged or echoed (H-4: `hashOmit: ['buyer']`); its ID lives in `invoice_buyers` only, and the receipt
// carries the 03c fill block (row P-5), filled at send by `buyerIdFiller` below.
// Statements (handler; the append and its folds are 00's envelope), fixed whatever the number of lines, splits,
// payments or requests: ensure bill (1), SPLITS_OF_BILL (1; none for a bill opened here), orders of the bill (1),
// orderLines (1), pendingVoids (1), alerts.listOpen (1: every open alert, filtered in memory — the bill's 05 requests
// and the orders' comp / remove_comp requests), the seating's other open bills (1, dine-in last split only), the
// number (1), alerts.closeMany (1 + its request_result raise, only when a request closes), invoice_buyers (1, with a
// buyer), billPrinterFor (1), the post-fold read (1), printDocument (2) + bill_print_jobs (1) — 13 for a dine-in last
// split with a receipt and no request to close. The empty close (§6.12 step 3, `emptyCloseDrafts`): ensure bill,
// splits, orders, the bill's cancelled orders, credits, the seating's other open bills, listOpen — 7 (+ closeMany).
import {
  buildReceiptDoc,
  BUYER_ID_FILL,
  computeBill,
  computeSplit,
  DomainError,
  isFiscalized,
  spreadLineTaxes,
  type ComputePayment,
  type ComputeSplitInput,
  type ComputeSplitLine,
  type DocFiscalState,
  type FiscalSnapshot,
} from '@pos/domain';
import {
  BillClosed,
  BillClosedEmpty,
  BillClosedEmptyPayload,
  BillClosedPayload,
  DiscountFrozen,
  DiscountFrozenPayload,
  draftOf,
  InvoiceIssued,
  InvoiceIssuedPayload,
  OrdersBilled,
  OrdersBilledPayload,
  type BranchConfig,
  type EventDraft,
} from '@pos/events';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { alerts, type CloseItem } from '../../alerts/raise.js';
import type { AlertRecord } from '../../alerts/kinds.js';
import { defineCommand, type CommandCtx } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { hubTime } from '../../lib/hub-time.js';
import { orderLines } from '../../orders/exports.js';
import { customerReadyTimes } from '../print/ready-times.js';
import type { EngineState } from '@pos/engine';
import { billPrinterFor, printDocument } from '../../print/api.js';
import { registerDocumentFiller } from '../../print/worker.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { pendingVoids } from '../../voids/exports.js';
import { ruleInForce, type HubBilling } from '../defaults.js';
import { NONE_ADAPTER_KEY } from '../fiscal/none.js';
import { fiscalAdapterFor } from '../fiscal/port.js';
import { HAND_OVER_UNPAID_KIND } from '../kinds/values.js';
import {
  BILL_REQUEST_KINDS,
  billAccess,
  billComputeBase,
  billLines,
  ONE_OPEN_SPLIT,
  ORDERS_OF_BILL,
  ordersOfBillParams,
  planOf,
  SPLITS_OF_BILL,
  type PaymentRow,
  type SplitRow,
} from '../queries/bill.js';
import { billingAt, BillRef, ensureBill, type BillHead } from './ensure-bill.js';

const MAX_MINOR = Math.min(1e12, Number.MAX_SAFE_INTEGER);

/** §6.12 payload; `buyer` (B19, J-4) is never hashed, stored or echoed (H-4). */
export const CloseSplitPayload = z
  .object({
    bill_ref: BillRef,
    split_no: z.number().int().min(1).max(20),
    expected_total_minor: z.number().int().min(0).max(MAX_MINOR),
    buyer: z
      .object({
        name: z.string().min(1).max(60),
        tax_id: z.object({ type: z.string().min(1).max(20), value: z.string().min(1).max(40) }).strict(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type CloseSplitPayload = z.infer<typeof CloseSplitPayload>;

/** §6.12 step 3 Result of the empty close. */
export interface EmptyCloseResult {
  bill_state: 'closed';
  empty: true;
}

/** §6.12 Result. */
export interface CloseSplitResult {
  invoice_id: string;
  invoice_ref: string;
  total_minor: number;
  change_minor: number;
  bill_state: 'open' | 'partly_paid' | 'closed';
  receipt: { job_id: string | null; printer_name: string | null };
  fiscal_state: 'pending' | 'not_required';
}

type Log = Pick<FastifyInstance['log'], 'info' | 'error'>;
type Rule = NonNullable<ReturnType<typeof ruleInForce>>;

// §3.15 order / §6.12 step 2: the seating's other open bill — a live bills row other than this one, or an order of
// the seating neither billed nor cancelled outside this bill's orders (a projected bill). 1 statement.
const OTHER_OPEN_ON_SEATING = `
SELECT
  (SELECT COUNT(*) FROM bills b WHERE b.seating_id = @seating_id AND b.bill_id <> @bill_id AND b.state <> 'closed' AND b.absorbed_into IS NULL)
  + (SELECT COUNT(*) FROM orders o JOIN seating_orders so ON so.order_id = o.order_id
      WHERE so.seating_id = @seating_id AND o.billed_at IS NULL AND o.cancelled_at IS NULL
        AND o.order_id NOT IN (SELECT value FROM json_each(@order_ids))) AS other_open`;

// After the append: the bill's folded state, the invoice's outbox row state (4b: the Doc's fiscal state comes from
// the row), the receipt printer's name and paper, and (R-91) the ids of the bill's payments added after its latest
// `BillReopened` (every `PaymentAdded` on the bill stream when never reopened; event seq order, `events_stream`).
// 1 statement.
const AFTER_FOLD = `
SELECT b.state AS bill_state, f.state AS fiscal_state, p.name AS printer_name, p.paper_width_mm,
  (SELECT json_group_array(json_extract(e.payload, '$.payment_id')) FROM events e
    WHERE e.stream_type = 'bill' AND e.stream_id = @bill_id AND e.event_type = 'PaymentAdded'
      AND e.seq > COALESCE((SELECT MAX(r.seq) FROM events r
                             WHERE r.stream_type = 'bill' AND r.stream_id = @bill_id AND r.event_type = 'BillReopened'), 0)) AS since_reopen_json
FROM bills b
LEFT JOIN fiscal_outbox f ON f.invoice_id = @invoice_id
LEFT JOIN printers p ON p.printer_id = @printer_id AND p.archived_at IS NULL
WHERE b.bill_id = @bill_id`;

/** The bill / split refusal (§9 `{ bill_id, state }`): a closed or absorbed bill, a closed or unknown split → 'closed'. */
function notOpen(head: Pick<BillHead, 'bill_id' | 'absorbed' | 'state'>, splitClosed: boolean): DomainError {
  return new DomainError('BILL_NOT_OPEN', { bill_id: head.bill_id, state: head.absorbed ? 'absorbed' : splitClosed ? 'closed' : head.state });
}

const blocked = (reason: 'void_pending' | 'weight_pending' | 'tax_unresolved', ids: readonly string[]) =>
  new DomainError('BILL_CLOSE_BLOCKED', { reason, order_item_ids: [...new Set(ids)].slice(0, 40) });

/**
 * §6.12 Validation (J-4): the type is one of the jurisdiction's accepted types and the value, its `strip` characters
 * removed, matches the type's pattern. The message never carries the value. Returns the stored (normalised) value.
 */
function normalisedTaxId(rule: Rule, tax_id: { type: string; value: string }): { type: string; label: string; value: string } {
  const t = rule.buyer_id.accepted_types.find((x) => x.type === tax_id.type);
  if (t === undefined) throw invalid('buyer.tax_id.type', 'not an accepted buyer tax ID type');
  const value = [...tax_id.value].filter((c) => !t.strip.includes(c)).join('');
  let ok: boolean;
  try {
    ok = new RegExp(t.pattern).test(value);
  } catch {
    ok = false; // a pattern the settings PUT let through but RegExp refuses: no value matches it
  }
  if (!ok) throw invalid('buyer.tax_id.value', `does not match the ${t.type} pattern`);
  return { type: t.type, label: t.label, value };
}

const invalid = (path: string, message: string) => new DomainError('VALIDATION_FAILED', { issues: [{ path, message }] });

/** §6.12 step 6: the fiscal snapshot in force at issue (H9-6, H16-2), `required` per R-46, the payment codes (J-5). */
function fiscalSnapshot(o: {
  billing: HubBilling;
  rule: Rule;
  head: BillHead;
  now: number;
  device_id: string;
  rounding: ComputeSplitInput['rules']['rounding'];
  payments: readonly PaymentRow[];
}): FiscalSnapshot {
  const { billing, rule } = o;
  const adapter_key = billing.jurisdiction.adapter_key;
  const adapter = fiscalAdapterFor(adapter_key);
  if (adapter === null) throw new Error(`CloseSplit: fiscal adapter ${adapter_key} is not registered`);
  const f = billing.settings.fiscal;
  // R-46 / G-42: fiscalize ∧ after switched_at ∧ adapter ≠ none; `switched_at` (ISO string on the wire) is turned into
  // epoch ms here only, the one place the close compares it with the issue time
  const afterSwitch = f.switched_at === null || o.now >= Date.parse(f.switched_at);
  const required = f.fiscalize_by_order_type[o.head.order_type] && afterSwitch && adapter_key !== NONE_ADAPTER_KEY;
  const modes = new Map(billing.settings.payment_modes.map((m) => [m.mode_id, m]));
  return {
    adapter_key,
    // R-13 / G-11: the device's mapping, else the default; outboxRowFor's throw stays the invariant
    pos_id: f.device_pos_ids.find((d) => d.device_id === o.device_id)?.pos_id ?? f.default_pos_id,
    required,
    capabilities: { ordering: adapter.capabilities.ordering, credit: adapter.capabilities.credit },
    credit_support: rule.credit_support,
    rounding: { ...o.rounding },
    receipt: {
      fiscal_number_label: rule.receipt.fiscal_number_label,
      tax_reg_labels: rule.receipt.tax_reg_labels.map((x) => ({ code: x.code, label: x.label })),
      show_qr: rule.receipt.show_qr,
      qr_url_template: rule.receipt.qr_url_template,
      buyer_id_on_receipt: rule.receipt.buyer_id_on_receipt,
    },
    seller_registrations: billing.settings.receipt.tax_registrations.map((r) => ({ code: r.code, number: r.number })),
    payment_codes: o.payments.map((p) => ({
      payment_id: p.payment_id,
      authority_code: modes.get(p.mode_id)?.authority_codes.find((c) => c.adapter_key === adapter_key)?.code ?? null,
    })),
  };
}

function closeSplitCommand(log: Log) {
  return defineCommand({
    commandType: 'CloseSplit',
    payloadSchema: CloseSplitPayload,
    sessionKind: 'device',
    permission: 'take-payment',
    hashOmit: ['buyer'],
    handle(ctx, p) {
      const staff_id = ctx.actor.staffId;
      if (staff_id === null) throw new DomainError('PERMISSION_DENIED', { permission: 'take-payment', grant: 'not_granted' });
      const db = ctx.tx.db;
      const { head, events: opening, created } = ensureBill(ctx, p.bill_ref); // 1
      // rule 1: the bill open / partly paid, the split open
      if (head.state === 'closed' || head.absorbed) throw notOpen(head, false);
      const bill_id = head.bill_id as string;
      const config = branchConfig();
      if (config === null || head.business_date === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');
      const rows = created ? [] : (db.prepare(SPLITS_OF_BILL).all(bill_id) as SplitRow[]); // 2
      const splits = rows.length === 0 ? [ONE_OPEN_SPLIT] : rows;
      const split = splits.find((s) => s.split_no === p.split_no);
      if (split === undefined || split.state !== 'open') throw notOpen(head, true);

      const { billing, rules: atDay } = billingAt(config, head.business_date);
      const rule = ruleInForce(billing, head.business_date);
      if (rule === null) throw new Error(`CloseSplit: no jurisdiction rule in force on ${head.business_date}`);
      // §6.12 Validation (before any rule): the buyer's tax ID against the jurisdiction's accepted types
      const buyerId = p.buyer === undefined ? null : normalisedTaxId(rule, p.buyer.tax_id);

      // step 2: orders, lines, pending voids, open requests
      const orders = db.prepare(ORDERS_OF_BILL).all({ ...ordersOfBillParams(head), bill_id: created ? null : bill_id }) as Array<{
        order_id: string;
        placed_by: string;
        token: number | null;
      }>; // 3
      const order_ids = orders.map((o) => o.order_id);
      // §6.12 step 3 (H7-3; integrator ruling S-1 (a): built here, `emptyCloseDrafts` reused by task 19): a bill whose
      // every order is cancelled closes empty (BillClosedEmpty), never with a Rs 0 invoice
      if (order_ids.length === 0) {
        // §6.12 step 3 (H7-3, H8-4): every order cancelled — a bill row only (never a projected one), every split's
        // balance 0 (payments in and out cancel), else the first split that still holds money is BILL_BALANCE_DUE
        if (created) throw new DomainError('BILL_NOT_FOUND', { bill_id: null });
        const { input: emptyBase } = billComputeBase({ head, billing, rules: atDay, lines: [], voids: new Map(), splits });
        const openRows = splits.filter((s) => s.state === 'open');
        const moneyOf = openRows.flatMap((s) =>
          (JSON.parse(s.payments_json) as PaymentRow[]).map((x) => ({ split_no: s.split_no, payment_class: x.payment_class, direction: x.direction, amount_minor: x.amount_minor, tendered_minor: x.tendered_minor })),
        );
        const r = computeBill({ ...emptyBase, plan: planOf(head, openRows), payments: moneyOf });
        const due = r.splits.find((s) => s.balance_minor !== 0);
        if (due !== undefined) throw new DomainError('BILL_BALANCE_DUE', { split_no: due.split_no, balance_minor: due.balance_minor });
        billAccess(ctx.directory, config, staff_id, { seating: head.seating, scope: head.scope, placed_by: [] }, ['take-payment']); // C8: scope last
        const cancelled = db.prepare(CANCELLED_ORDERS_OF_BILL).pluck().all({ bill_id, seating_id: head.seating_id, bill_key: head.bill_key }) as string[]; // 4
        ctx.tx.append(emptyCloseDrafts(ctx, { bill_id, seating: head.seating, order_ids: cancelled }));
        const result: EmptyCloseResult = { bill_state: 'closed', empty: true };
        return { events: [], result };
      }
      const byOrder = orderLines(db, order_ids); // 4
      const voids = pendingVoids(db, order_ids); // 5
      const open = alerts.listOpen(db, {}); // 6
      const lines = billLines(order_ids, byOrder);
      const lineById = new Map(lines.map((l) => [l.order_item_id, l]));

      // step 4 (computed before the rules that need it; pure): the open plan, then this split
      const { input: base } = billComputeBase({ head, billing, rules: atDay, lines, voids, splits });
      const openRows = splits.filter((s) => s.state === 'open');
      const paymentsOf = new Map(openRows.map((s) => [s.split_no, JSON.parse(s.payments_json) as PaymentRow[]]));
      const computePayments: ComputePayment[] = openRows.flatMap((s) =>
        (paymentsOf.get(s.split_no) ?? []).map((x) => ({ split_no: s.split_no, payment_class: x.payment_class, direction: x.direction, amount_minor: x.amount_minor, tendered_minor: x.tendered_minor })),
      );
      const bill = computeBill({ ...base, plan: planOf(head, openRows), payments: computePayments });
      const mine = bill.splits.find((s) => s.split_no === p.split_no);
      if (mine === undefined) throw new Error(`CloseSplit: split ${p.split_no} missing from the compute result`);
      const payments = paymentsOf.get(p.split_no) ?? [];

      // §3.3 rules 2–9, in order (first failure throws; nothing is written)
      // 2: no pending void on the bill's orders
      if (voids.size > 0) {
        const ids: string[] = [];
        for (const list of voids.values()) for (const v of list) ids.push(v.order_item_id, ...v.touched_ids);
        throw blocked('void_pending', ids);
      }
      // 3: no pending weight on a line of the split
      const weightIds = mine.lines.filter((l) => l.units > 0 && lineById.get(l.order_item_id)?.line_total_minor === null).map((l) => l.order_item_id);
      if (weightIds.length > 0) throw blocked('weight_pending', weightIds);
      // 3a: every taxed line's profile (and an applied service charge's, R-1) resolves
      const unresolved = mine.blocks.filter((b) => b.reason === 'tax_unresolved').flatMap((b) => b.ids);
      if (unresolved.length > 0) throw blocked('tax_unresolved', unresolved);
      // 4: no open discount request on the bill
      const onBill = (a: (typeof open)[number]) => a.subject.stream_type === 'bill' && a.subject.stream_id === bill_id;
      const discountReq = open.find((a) => a.kind === 'discount' && onBill(a));
      if (discountReq !== undefined) throw new DomainError('DISCOUNT_PENDING', { alert_id: discountReq.alert_id });
      // 6: buyer tax ID on the whole bill's net (closed invoices + the open remainder at the default class, B19)
      const closedRows = splits.filter((s) => s.state === 'closed');
      const net = closedRows.reduce((a, s) => a + (s.inv_subtotal_minor ?? 0) - (s.inv_discount_minor ?? 0), 0) + bill.totals_default.subtotal_minor - bill.totals_default.discount_minor;
      const threshold = rule.buyer_id.threshold_minor;
      const buyerRequired = threshold !== null && net > threshold;
      if (buyerRequired && buyerId === null && !head.buyer_waived) {
        throw new DomainError('BUYER_ID_REQUIRED', { threshold_minor: threshold, net_minor: net, accepted_types: rule.buyer_id.accepted_types.map((t) => t.type) });
      }
      // 7: the total the screen showed
      const t = mine.totals.as_paid;
      if (p.expected_total_minor !== t.total_minor) throw new DomainError('BILL_TOTAL_CHANGED', { expected_minor: p.expected_total_minor, total_minor: t.total_minor });
      // 8: balance 0
      if (mine.balance_minor !== 0) throw new DomainError('BILL_BALANCE_DUE', { split_no: p.split_no, balance_minor: mine.balance_minor });
      // 8a: an amount plan's re-based last share below 1 minor unit
      if (bill.blocks.some((b) => b.reason === 'shares_sum')) throw new DomainError('BILL_SPLIT_INVALID', { reason: 'shares_sum' });
      // 9: nothing to check (each cash payment's change was fixed at AddPayment, H1-3)

      // H8-3 / R-46: on a fiscalized split every live payment's mode has a code for the branch's adapter
      const now = ctx.clock.branchNow();
      const rules = base.rules;
      const fiscal = fiscalSnapshot({ billing, rule, head, now, device_id: ctx.actor.deviceId, rounding: rules.rounding, payments });
      if (isFiscalized(fiscal)) {
        const missing = fiscal.payment_codes.find((c) => c.authority_code === null);
        if (missing !== undefined) {
          const mode_id = payments.find((x) => x.payment_id === missing.payment_id)!.mode_id;
          throw new DomainError('PAYMENT_MODE_NOT_FISCAL', { mode_id, adapter_key: fiscal.adapter_key });
        }
      }

      // C8: the scope last
      billAccess(ctx.directory, config, staff_id, { seating: head.seating, scope: head.scope, placed_by: orders.map((o) => o.placed_by) }, ['take-payment']);

      // the split's invoice lines (J-2, R-17): compute's lines of this split; amount / equal splits invoice the line's
      // live units (H1-27: the whole line freezes at each such close)
      const wholeUnits = head.split_mode === 'amount' || head.split_mode === 'equal';
      const splitLines: ComputeSplitLine[] = mine.lines
        .filter((l) => l.units > 0 || l.base_minor > 0)
        .map((l) => (wholeUnits ? { ...l, units: lineById.get(l.order_item_id)?.live_units ?? l.units } : l));
      const splitInput: ComputeSplitInput = {
        split_no: p.split_no,
        business_date: head.business_date,
        rules,
        tax_profiles: base.tax_profiles,
        lines: splitLines,
        service_charge: base.service_charge,
        payments: computePayments.filter((x) => x.split_no === p.split_no),
        // §3.8 (owner ruling 2026-11-28): the split's total as the bill allocated it
        total_targets: mine.total_targets,
      };
      const priced = computeSplit(splitInput);
      const spread = spreadLineTaxes(splitInput);
      const pt = priced.totals.as_paid;
      // the pure split recompute is the same money as the bill's (a divergence is a bug, never a silent invoice)
      if (pt.total_minor !== t.total_minor || pt.subtotal_minor !== t.subtotal_minor) throw new Error('CloseSplit: split recompute differs from the bill compute');

      // step 5: the number (B13: MAX + 1 inside the single writer's transaction; `invoices_series_number` unique)
      const number = db.prepare(`SELECT COALESCE(MAX(number), 0) + 1 FROM invoices WHERE series = 'sale'`).pluck().get() as number; // 7
      const invoice_ref = `${billing.settings.receipt.invoice_prefix}S${String(number).padStart(6, '0')}`;

      // step 6: drafts
      const firstClose = splits.every((s) => s.state === 'open');
      const lastOpen = openRows.length === 1;
      const fiscalCategory = new Map(config.tax_classes.map((c) => [c.tax_class_id, c.fiscal_category ?? null]));
      const insClasses = new Set(payments.filter((x) => x.direction === 'in').map((x) => x.payment_class));
      const invoice_id = ctx.ids.next();
      const discount_line_ids = firstClose ? lines.map((l) => l.order_item_id) : null;
      const invoice = InvoiceIssuedPayload.parse({
        invoice_id,
        series: 'sale',
        number,
        invoice_ref,
        bill_id,
        split_no: p.split_no,
        business_date: head.business_date,
        issued_at: now,
        order_type: head.order_type,
        jurisdiction_id: billing.jurisdiction.jurisdiction_id,
        currency_code: billing.jurisdiction.currency_code,
        prices_include_tax: rules.prices_include_tax,
        lines: splitLines.map((l, i) => {
          const v = lineById.get(l.order_item_id);
          return {
            order_item_id: l.order_item_id,
            item_id: v?.item_id ?? null,
            name: v?.name ?? '',
            units: l.units,
            unit_price_minor: l.unit_price_minor,
            base_minor: l.base_minor,
            discount_minor: l.discount_minor,
            tax_profile_id: l.tax_profile_id,
            fiscal_category: l.tax_profile_id === null ? null : (fiscalCategory.get(l.tax_profile_id) ?? null),
            taxes: spread.lines[i]!.taxes,
            // 05 v1.0.33 §6.29 (STAB-5): only a split line's part carries it, so an unsplit invoice is unchanged
            ...(v?.part_of === undefined || v.part_of === null ? {} : { part_of: v.part_of }),
          };
        }),
        service_charge: spread.service_charge,
        subtotal_minor: pt.subtotal_minor,
        discount_minor: pt.discount_minor,
        service_charge_minor: pt.service_charge_minor,
        taxes: pt.taxes.map((x) => ({ ...x })),
        rounding_minor: pt.rounding_minor,
        total_minor: pt.total_minor,
        // G-27: the split's class, or 'mixed' when its live `in` payments are of both classes
        payment_class: insClasses.size > 1 ? 'mixed' : priced.payment_class,
        mixed_rule: priced.mixed_rule,
        payment_ids: payments.map((x) => x.payment_id),
        change_minor: priced.change_minor,
        discount_line_ids,
        fiscal,
        has_buyer_id: buyerId !== null,
        buyer_id_refused: buyerId === null && buyerRequired && head.buyer_waived,
        closed_by: staff_id,
      });
      const env = { occurred_at: now, actor_id: staff_id, device_id: ctx.actor.deviceId };
      const drafts: EventDraft[] = [...opening, draftOf(InvoiceIssued, { stream_type: 'bill', stream_id: bill_id, payload: invoice, ...env })];
      if (firstClose) {
        // R-41: the whole bill's D_bill this close's compute spread (0 with no discount), right after InvoiceIssued
        const frozen = DiscountFrozenPayload.parse({ bill_id, frozen_minor: head.discount === null ? 0 : bill.discount_minor, line_ids: discount_line_ids ?? [] });
        drafts.push(draftOf(DiscountFrozen, { stream_type: 'bill', stream_id: bill_id, payload: frozen, ...env }));
      }
      if (lastOpen) {
        drafts.push(draftOf(OrdersBilled, { stream_type: 'order', stream_id: order_ids[0]!, payload: OrdersBilledPayload.parse({ order_ids, bill_id }), ...env }));
        if (head.scope === 'seating' && head.seating !== null && head.seating.state !== 'CLOSED') {
          const other = db.prepare(OTHER_OPEN_ON_SEATING).get({ seating_id: head.seating.seating_id, bill_id, order_ids: JSON.stringify(order_ids) }) as { other_open: number }; // 8
          if (other.other_open === 0) {
            drafts.push(draftOf(BillClosed, { stream_type: 'table', stream_id: head.seating.primary_table_id, payload: BillClosedPayload.parse({ seating_id: head.seating.seating_id }), ...env }));
          }
        }
      }
      // H1-23, H6-2: comp / remove_comp requests on the units this split invoices; at the last close every one on the
      // bill's orders, ⚠️ run 3 (R3-M-4) every 02b hand_over_unpaid request whose named order is one of the bill's, and
      // every open 05 request on the bill — `obsolete`, note `bill_closed`; one closeMany, none for an empty set
      const invoiced = new Set(invoice.lines.filter((l) => l.units > 0).map((l) => l.order_item_id));
      const orderSet = new Set(order_ids);
      const stale: CloseItem[] = open
        .filter((a) => {
          if ((a.kind === 'comp' || a.kind === 'remove_comp') && a.subject.stream_type === 'order' && orderSet.has(a.subject.stream_id)) {
            const id = (a.values as { order_item_id?: unknown }).order_item_id;
            return lastOpen || (typeof id === 'string' && invoiced.has(id));
          }
          if (a.kind === HAND_OVER_UNPAID_KIND) return lastOpen && a.subject.stream_type === 'order' && orderSet.has(a.subject.stream_id);
          return lastOpen && onBill(a) && (BILL_REQUEST_KINDS as readonly string[]).includes(a.kind);
        })
        .map((a) => ({ alert_id: a.alert_id, reason: 'obsolete' as const, note: 'bill_closed' }));
      if (stale.length > 0) drafts.push(...alerts.closeMany(ctx, stale));

      // step 7: append (00) → the folds (billing: invoice, closed units, outbox row; shifts; 02b billed_at; 02a)
      ctx.tx.append(drafts);
      if (p.buyer !== undefined && buyerId !== null) {
        db.prepare('INSERT INTO invoice_buyers (invoice_id, buyer_name, id_type, id_value) VALUES (?, ?, ?, ?)').run(invoice_id, p.buyer.name, buyerId.type, buyerId.value);
      }
      const printer_id = billPrinterFor(db, { device_id: ctx.actor.deviceId });
      const after = db.prepare(AFTER_FOLD).get({ bill_id, invoice_id, printer_id }) as {
        bill_state: CloseSplitResult['bill_state'];
        fiscal_state: string | null;
        printer_name: string | null;
        paper_width_mm: number | null;
        since_reopen_json: string;
      };
      const fiscal_state: CloseSplitResult['fiscal_state'] = isFiscalized(fiscal) ? 'pending' : 'not_required';
      // R-91 / R-92: the change due now — the result's and the receipt's (the invoice keeps Σ)
      const change_now = changeSinceReopen(payments, after.since_reopen_json);

      const receipt = printReceipt(ctx, log, {
        printer_id: after.printer_name === null ? null : printer_id,
        printer_name: after.printer_name,
        paper_width_mm: after.paper_width_mm,
        row_state: after.fiscal_state,
        invoice,
        bill_id,
        head,
        config,
        billing,
        payments,
        change_minor: change_now,
        orders,
        buyer: buyerId === null ? null : { type_label: buyerId.label, last4: buyerId.value.slice(-4) },
        staff_id,
      });

      const result: CloseSplitResult = {
        invoice_id,
        invoice_ref,
        total_minor: invoice.total_minor,
        change_minor: change_now,
        bill_state: after.bill_state,
        receipt,
        fiscal_state,
      };
      return { events: [], result };
    },
  });
}

/**
 * §6.12 Result (⚠️ 05 v1.0.30, R-91): the change due now — Σ (tendered − amount) of the split's live cash `in`
 * payments added after the bill's latest `BillReopened` (`since_reopen_json`, AFTER_FOLD); on a never-reopened bill
 * every one of them, so it equals `InvoiceIssued.change_minor`. The change of a payment carried across a reopen was
 * given out at the earlier close. The result and (⚠️ 05 v1.0.31, R-92) the receipt's Change line; the invoice, its
 * events, the shift and the Z keep Σ. A Reprint re-derives the same figure (print-docs.ts `PAYMENTS`).
 */
function changeSinceReopen(payments: readonly PaymentRow[], since_reopen_json: string): number {
  const since = new Set(JSON.parse(since_reopen_json) as string[]);
  return payments
    .filter((x) => x.payment_class === 'cash' && x.direction === 'in' && since.has(x.payment_id))
    .reduce((a, x) => a + (x.tendered_minor ?? x.amount_minor) - x.amount_minor, 0);
}

// The bill's orders an empty close names: its own `bill_orders` (a reopened bill) and the cancelled orders of its
// seating / key (a never-closed bill: its orders were never billed). 1 statement. Exported for task 19's empty-close paths.
export const CANCELLED_ORDERS_OF_BILL = `
SELECT o.order_id FROM orders o
WHERE o.order_id IN (SELECT order_id FROM bill_orders WHERE bill_id = @bill_id)
   OR (o.cancelled_at IS NOT NULL AND o.billed_at IS NULL
       AND ((@seating_id IS NOT NULL AND o.order_id IN (SELECT order_id FROM seating_orders WHERE seating_id = @seating_id))
         OR (@bill_key IS NOT NULL AND o.bill_key = @bill_key)))
ORDER BY o.placed_at, o.order_id`;

// The credits of the bill's current reopen cycle: its credit invoices with no sale invoice of the bill issued after
// them (a reopen credits every current sale invoice at once; a never-reopened bill has none). 1 statement.
const CURRENT_CREDITS = `
SELECT c.invoice_id FROM invoices c
WHERE c.bill_id = ? AND c.series = 'credit'
  AND NOT EXISTS (SELECT 1 FROM invoices s WHERE s.bill_id = c.bill_id AND s.series = 'sale' AND s.issued_at > c.issued_at)
ORDER BY c.number`;

/**
 * §6.12 step 3, §3.10, §6.29 (H6-6, H7-3, H8-4, H8-5, H8-10): the drafts of an empty close — `BillClosedEmpty
 * { bill_id, seating_id, credit_invoice_ids }` (`seating_id` only under §6.12's BillClosed rule: dine-in, the seating
 * not CLOSED and holding no other open bill; else null), then the open-request closes of a last close (`obsolete`,
 * note `bill_closed`): every open `comp` / `remove_comp` / ⚠️ run 3 (R3-M-4) 02b `hand_over_unpaid` request on
 * `order_ids` and every open 05 request on the bill.
 * No sale invoice, `OrdersBilled`, fiscal row or receipt. The caller has checked that every order of the bill is
 * cancelled and every split's balance is 0, and appends the drafts in its own transaction. Exported for task 19's
 * order-cancelled hook and `AddPayment { out }` paths (inside an `apply`, the hook stamps `alert_id`, row Q-7).
 * Statements: credits (1), the seating's other open bills (1, dine-in on a not-CLOSED seating), alerts.listOpen (1,
 * unless `open` is given), alerts.closeMany (1 + its request_result raise, only when a request closes).
 */
export function emptyCloseDrafts(
  ctx: CommandCtx,
  o: { bill_id: string; seating: BillHead['seating']; order_ids: readonly string[]; open?: readonly AlertRecord[] },
): EventDraft[] {
  const db = ctx.tx.db;
  const credit_invoice_ids = db.prepare(CURRENT_CREDITS).pluck().all(o.bill_id) as string[];
  let seating_id: string | null = null;
  if (o.seating !== null && o.seating.state !== 'CLOSED') {
    const other = db.prepare(OTHER_OPEN_ON_SEATING).get({ seating_id: o.seating.seating_id, bill_id: o.bill_id, order_ids: JSON.stringify(o.order_ids) }) as { other_open: number };
    if (other.other_open === 0) seating_id = o.seating.seating_id;
  }
  const env = { occurred_at: ctx.clock.branchNow(), actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId };
  const payload = BillClosedEmptyPayload.parse({ bill_id: o.bill_id, seating_id, credit_invoice_ids });
  const drafts: EventDraft[] = [draftOf(BillClosedEmpty, { stream_type: 'bill', stream_id: o.bill_id, payload, ...env })];
  const open = o.open ?? alerts.listOpen(db, {});
  const orders = new Set(o.order_ids);
  const stale: CloseItem[] = open
    .filter(
      (a) =>
        ((a.kind === 'comp' || a.kind === 'remove_comp' || a.kind === HAND_OVER_UNPAID_KIND) && a.subject.stream_type === 'order' && orders.has(a.subject.stream_id)) ||
        (a.subject.stream_type === 'bill' && a.subject.stream_id === o.bill_id && (BILL_REQUEST_KINDS as readonly string[]).includes(a.kind)),
    )
    .map((a) => ({ alert_id: a.alert_id, reason: 'obsolete' as const, note: 'bill_closed' }));
  if (stale.length > 0) drafts.push(...alerts.closeMany(ctx, stale));
  return drafts;
}

/**
 * §6.12 step 7, §3.16, B21, row P-5: the receipt at the device's bill route (→ default). The Doc's fiscal state is the
 * outbox row's (4b); the buyer block is the fill placeholder (last 4 only). A Doc that fails to build, or no printer,
 * never stops the close (R8, 4b): the receipt is skipped and logged with ids only. ≤ 3 statements.
 */
function printReceipt(
  ctx: CommandCtx,
  log: Log,
  o: {
    printer_id: string | null;
    printer_name: string | null;
    paper_width_mm: number | null;
    row_state: string | null;
    invoice: InvoiceIssuedPayload;
    bill_id: string;
    head: BillHead;
    config: BranchConfig;
    billing: HubBilling;
    payments: readonly PaymentRow[];
    /** R-92: the change due now (`changeSinceReopen`), not `invoice.change_minor` (Σ) — a Reprint prints the same. */
    change_minor: number;
    orders: ReadonlyArray<{ token: number | null }>;
    buyer: { type_label: string; last4: string } | null;
    staff_id: string;
  },
): CloseSplitResult['receipt'] {
  const ids = { bill_id: o.bill_id, invoice_id: o.invoice.invoice_id };
  if (o.printer_id === null) {
    log.info({ ...ids, command_type: 'CloseSplit' }, 'receipt skipped: no bill printer routed');
    return { job_id: null, printer_name: null };
  }
  let doc;
  try {
    const modeName = new Map(o.billing.settings.payment_modes.map((m) => [m.mode_id, m.name]));
    const table = o.head.seating === null ? null : (o.config.floors.flatMap((f) => f.tables).find((t) => t.table_id === o.head.seating!.primary_table_id)?.name ?? o.head.seating.primary_table_id);
    const token = o.orders[0]?.token ?? null;
    doc = buildReceiptDoc(
      {
        invoice: o.invoice,
        payments: o.payments.map((x) => ({ mode_name: modeName.get(x.mode_id) ?? x.mode_id, payment_class: x.payment_class, direction: x.direction, amount_minor: x.amount_minor })),
        change_minor: o.change_minor,
        cashier_name: ctx.directory.get(o.staff_id)?.display_name ?? null,
        order_label: o.head.scope === 'key' && token !== null ? `#${token}` : null,
        bill_label: table,
        fiscal: docFiscalState(o.row_state),
        buyer: o.buyer,
        is_reprint: false,
        ready_times: customerReadyTimes(ctx.state as EngineState, o.invoice, hubTime(ctx.clock).utc_offset_ms), // v1.0.33 §3.16 (STAB-5)
      },
      {
        width_cols: o.paper_width_mm === 58 ? 32 : 48,
        currency_exponent: o.billing.jurisdiction.currency_exponent,
        utc_offset_ms: hubTime(ctx.clock).utc_offset_ms,
        branch_name: ctx.config.provisioned?.branch_name ?? '',
        template: o.billing.settings.receipt,
      },
    );
  } catch (err) {
    // 4b: the builders throw on a fiscal-state mismatch (a caller bug); the close commits, the receipt is skipped
    log.error({ ...ids, command_type: 'CloseSplit', error: err instanceof Error ? err.name : 'unknown' }, 'receipt skipped: the Doc failed to build');
    return { job_id: null, printer_name: null };
  }
  const { job_id } = printDocument(ctx.tx, o.printer_id, doc, { kind_label: 'Receipt' }); // 2
  ctx.tx.db.prepare(`INSERT INTO bill_print_jobs (job_id, bill_id, doc_kind, ref_id, created_at) VALUES (?, ?, 'receipt', ?, ?)`).run(job_id, o.bill_id, o.invoice.invoice_id, ctx.clock.branchNow()); // 1
  return { job_id, printer_name: o.printer_name };
}

/** 4b: the outbox row's state as the Doc takes it (the close writes only `pending` / `not_required`). */
function docFiscalState(row_state: string | null): DocFiscalState {
  if (row_state === 'pending') return { state: 'pending' };
  if (row_state === 'not_required') return { state: 'not_required' };
  throw new Error(`CloseSplit: unexpected outbox row state ${String(row_state)}`);
}

/**
 * Row P-5, B19 (4b contract): 03c's worker asks this at send for a `{ fill: 'buyer_id', ref: invoice_id }` block. One
 * read-only SELECT on `invoice_buyers`; `"<name>\n<type label>: <value>"`, or null with no row (→ the block's last 4).
 * The type label from the branch's accepted types (in memory), else the type code. Never logs, never throws with the
 * value.
 */
export function buyerIdFiller(db: Database.Database, ref: string): string | null {
  const r = db.prepare('SELECT buyer_name, id_type, id_value FROM invoice_buyers WHERE invoice_id = ?').get(ref) as
    | { buyer_name: string; id_type: string; id_value: string }
    | undefined;
  if (r === undefined) return null;
  const config = branchConfig();
  const types = config === null ? [] : (config.billing?.jurisdiction.rules ?? []).flatMap((x) => x.buyer_id.accepted_types);
  const label = types.find((x) => x.type === r.id_type)?.label ?? r.id_type;
  return `${r.buyer_name}\n${label}: ${r.id_value}`;
}

export function registerCloseSplit(app: FastifyInstance): void {
  commandRegistry(app).register(closeSplitCommand(app.log));
  // row P-5 (4b): the buyer block's filler (one slot per kind; registering again replaces it)
  registerDocumentFiller(BUYER_ID_FILL, buyerIdFiller);
}

