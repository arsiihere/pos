// 05 §6.5 `SetSplits`, §3.8, B15 (task 12). Replaces the plan of the bill's **open** splits: `items` (every live unit
// not in a closed split exactly once, a deal whole, an option child with its parent), `amount` (shares of the open
// remainder's default-class total), `equal` (`n` over the open remainder) or `none` (the open remainder as one split).
// Closed splits are never touched and may not be named; a split with live payments keeps its number (G0-4). Later
// rounds need nothing here: the bill view's compute puts new item lines on the highest open split and re-bases the
// last amount share (§3.8, H1-22). Grant first (the pipeline's `take-payment`, 403), the scope last (C8).
// Statements ≤ 5, fixed whatever the number of lines or splits: ensure bill (1), orders of the bill (1), orderLines
// (1), pendingVoids (1), SPLITS_OF_BILL (1; none for a bill opened here). Every read, compute input and view entry is
// the bill view's own export (queries/bill.ts, task 12 plan fix), so the result cannot drift from `GET /queries/bill`.
import { computeBill, DomainError, type ComputePayment, type ComputePlan } from '@pos/domain';
import { BillSplitsSet, BillSplitsSetPayload, draftOf } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import type { LineView } from '../../orders/contracts.js';
import { orderLines } from '../../orders/exports.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { pendingVoids } from '../../voids/exports.js';
import {
  billAccess,
  billComputeBase,
  billLines,
  closedSplitView,
  modeNames,
  ONE_OPEN_SPLIT,
  ORDERS_OF_BILL,
  ordersOfBillParams,
  paymentView,
  planView,
  SPLITS_OF_BILL,
  toTotals,
  type BillViewSplit,
  type PaymentRow,
  type SplitRow,
 splitDues } from '../queries/bill.js';
import { billingAt, BillRef, ensureBill } from './ensure-bill.js';

// ------------------------------------------------------------------------------------------------ payload

/** H16-13: money caps scaled for any currency. */
const MAX_MINOR = Math.min(1e12, Number.MAX_SAFE_INTEGER);

const PlanLine = z.object({ order_item_id: z.string().min(1), units: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();
const PlanSplit = z
  .object({
    split_no: z.number().int().min(1).max(20),
    lines: z.array(PlanLine).min(1).optional(),
    share_minor: z.number().int().min(1).max(MAX_MINOR).optional(),
  })
  .strict();

/** §6.5: `splits` 2–20 keyed by `split_no`; `lines` keyed by `order_item_id` per split; `n` 2–20 for `equal`. */
export const SetSplitsPayload = z
  .object({
    bill_ref: BillRef,
    mode: z.enum(['items', 'amount', 'equal', 'none']),
    splits: z.array(PlanSplit).min(2).max(20).optional(),
    n: z.number().int().min(2).max(20).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    const planned = p.mode === 'items' || p.mode === 'amount';
    if (planned && p.splits === undefined) issue(['splits'], `splits required for ${p.mode}`);
    if (!planned && p.splits !== undefined) issue(['splits'], `no splits for ${p.mode}`);
    if (p.mode === 'equal' && p.n === undefined) issue(['n'], 'n required for equal');
    if (p.mode !== 'equal' && p.n !== undefined) issue(['n'], 'n only for equal');
    const seen = new Set<number>();
    (p.splits ?? []).forEach((s, i) => {
      if (seen.has(s.split_no)) issue(['splits', i, 'split_no'], 'duplicate split_no');
      seen.add(s.split_no);
      if ((s.lines !== undefined) !== (p.mode === 'items')) issue(['splits', i, 'lines'], 'lines only and always for items');
      if ((s.share_minor !== undefined) !== (p.mode === 'amount')) issue(['splits', i, 'share_minor'], 'share_minor only and always for amount');
      const ids = new Set<string>();
      (s.lines ?? []).forEach((l, j) => {
        if (ids.has(l.order_item_id)) issue(['splits', i, 'lines', j, 'order_item_id'], 'duplicate order_item_id in a split');
        ids.add(l.order_item_id);
      });
    });
  });
export type SetSplitsPayload = z.infer<typeof SetSplitsPayload>;

// ------------------------------------------------------------------------------------------------ validation (pure)

const invalid = (reason: string, extra: Record<string, unknown> = {}): DomainError => new DomainError('BILL_SPLIT_INVALID', { reason, ...extra });

/**
 * §3.8 item plan over the open remainder: per line, Σ planned units = its live units not in a closed split
 * (`units_missing` / `units_exceed`; a named line with none open → `units_exceed`); then a deal part and an option
 * child sit in every split in their parent's proportion (`deal_whole` / `option_with_parent`, the part's id).
 */
function checkItemPlan(lines: readonly LineView[], openUnits: ReadonlyMap<string, number>, splits: ReadonlyArray<{ split_no: number; lines: ReadonlyArray<{ order_item_id: string; units: number }> }>): void {
  const planned = new Map<string, Map<number, number>>();
  for (const s of splits) {
    for (const l of s.lines) {
      const per = planned.get(l.order_item_id) ?? new Map<number, number>();
      per.set(s.split_no, l.units);
      planned.set(l.order_item_id, per);
    }
  }
  const total = (id: string) => [...(planned.get(id)?.values() ?? [])].reduce((a, b) => a + b, 0);
  for (const l of lines) {
    const open = openUnits.get(l.order_item_id) ?? 0;
    const got = total(l.order_item_id);
    if (got < open) throw invalid('units_missing', { order_item_id: l.order_item_id });
    if (got > open) throw invalid('units_exceed', { order_item_id: l.order_item_id });
  }
  for (const id of planned.keys()) {
    if ((openUnits.get(id) ?? 0) === 0) throw invalid('units_exceed', { order_item_id: id });
  }
  for (const l of lines) {
    if (l.parent_order_item_id === null || (l.line_kind !== 'deal_part' && l.line_kind !== 'option_child')) continue;
    const own = openUnits.get(l.order_item_id) ?? 0;
    const parentOpen = openUnits.get(l.parent_order_item_id) ?? 0;
    if (own === 0 || parentOpen === 0) continue;
    const mine = planned.get(l.order_item_id) ?? new Map<number, number>();
    const theirs = planned.get(l.parent_order_item_id) ?? new Map<number, number>();
    const together = splits.every((s) => (mine.get(s.split_no) ?? 0) * parentOpen === (theirs.get(s.split_no) ?? 0) * own);
    if (!together) throw invalid(l.line_kind === 'deal_part' ? 'deal_whole' : 'option_with_parent', { order_item_id: l.order_item_id });
  }
}

// ------------------------------------------------------------------------------------------------ the command

export const SetSplits = defineCommand({
  commandType: 'SetSplits',
  payloadSchema: SetSplitsPayload,
  sessionKind: 'device',
  permission: 'take-payment',
  handle(ctx, p) {
    const { head, events, created } = ensureBill(ctx, p.bill_ref); // 1
    if (head.state === 'closed' || head.absorbed) throw new DomainError('BILL_NOT_OPEN', { bill_id: head.bill_id, state: head.absorbed ? 'absorbed' : head.state });
    const bill_id = head.bill_id as string;
    const db = ctx.tx.db;
    const config = branchConfig();
    if (config === null || head.business_date === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');

    // a bill opened here has no row yet: no own orders, no splits to read
    const orders = db.prepare(ORDERS_OF_BILL).all({ ...ordersOfBillParams(head), bill_id: created ? null : bill_id }) as Array<{ order_id: string; placed_by: string }>; // 2
    const order_ids = orders.map((o) => o.order_id);
    const byOrder = orderLines(db, order_ids); // 3
    const voids = pendingVoids(db, order_ids); // 4
    const rows = created ? [] : (db.prepare(SPLITS_OF_BILL).all(bill_id) as SplitRow[]); // 5
    const splits = rows.length === 0 ? [ONE_OPEN_SPLIT] : rows;

    const lines = billLines(order_ids, byOrder);
    const { billing, rules: atDay } = billingAt(config, head.business_date);
    const { input: computeBase, closedUnits } = billComputeBase({ head, billing, rules: atDay, lines, voids, splits });
    const closedNos = new Set(splits.filter((s) => s.state === 'closed').map((s) => s.split_no));
    const openRows = splits.filter((s) => s.state === 'open');
    const paymentsOf = new Map(splits.map((s) => [s.split_no, JSON.parse(s.payments_json) as PaymentRow[]]));
    const paidNos = openRows.filter((s) => (paymentsOf.get(s.split_no) ?? []).length > 0).map((s) => s.split_no);

    // §6.5 validation over the open remainder, in the script's order
    const planned = [...(p.splits ?? [])].sort((a, b) => a.split_no - b.split_no);
    if (planned.some((s) => closedNos.has(s.split_no))) throw invalid('split_closed');
    const lineOf = new Map(lines.map((l) => [l.order_item_id, l]));
    if (p.mode === 'items') {
      const openUnits = new Map(lines.map((l) => [l.order_item_id, Math.max(0, l.live_units - (closedUnits.get(l.order_item_id)?.units ?? 0))]));
      checkItemPlan(lines, openUnits, planned.map((s) => ({ split_no: s.split_no, lines: s.lines ?? [] })));
    }
    if (p.mode === 'amount') {
      const expected = computeBill({ ...computeBase, plan: { mode: 'none', split_no: openRows[0]!.split_no }, payments: [] }).totals_default.total_minor;
      if (planned.reduce((a, s) => a + (s.share_minor ?? 0), 0) !== expected) throw invalid('shares_sum', { expected_minor: expected });
    }
    const nos = newSplitNos(p, planned, closedNos, openRows, paidNos);
    const dropped = paidNos.filter((n) => !nos.includes(n));
    if (dropped.length > 0 || (p.mode === 'none' && paidNos.length > 1)) throw new DomainError('BILL_HAS_PAYMENTS', { bill_id, split_nos: paidNos.length > 1 && p.mode === 'none' ? paidNos : dropped });

    // C8: the scope last
    const access = billAccess(ctx.directory, config, ctx.actor.staffId, { seating: head.seating, scope: head.scope, placed_by: orders.map((o) => o.placed_by) }, ['take-payment']);

    const payload = BillSplitsSetPayload.parse({
      bill_id,
      mode: p.mode,
      splits: nos.map((split_no) => {
        const s = planned.find((x) => x.split_no === split_no);
        return {
          split_no,
          lines: p.mode === 'items' ? (s?.lines ?? []).map((l) => ({ order_item_id: l.order_item_id, order_id: lineOf.get(l.order_item_id)!.order_id, units: l.units })) : null,
          share_minor: p.mode === 'amount' ? (s?.share_minor ?? null) : null,
        };
      }),
    });
    const env = { occurred_at: ctx.clock.branchNow(), actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId };
    events.push(draftOf(BillSplitsSet, { stream_type: 'bill', stream_id: bill_id, payload, ...env }));

    // the result: the bill view's `splits`, recomputed under the new plan (pure; nothing re-read)
    const plan = computePlanOf(payload);
    const payments: ComputePayment[] = nos.flatMap((n) =>
      (paymentsOf.get(n) ?? []).map((x) => ({ split_no: n, payment_class: x.payment_class, direction: x.direction, amount_minor: x.amount_minor, tendered_minor: x.tendered_minor })),
    );
    const result = computeBill({ ...computeBase, plan, payments });
    const pv = { modeName: modeNames(billing), directory: ctx.directory, full: access === 'full' };
    const splitMode = p.mode === 'none' ? null : p.mode;
    const closedView = splits.filter((s) => s.state === 'closed').map((s) => closedSplitView(s, splitMode, (paymentsOf.get(s.split_no) ?? []).map((x) => paymentView(x, pv))));
    const openView = payload.splits.map((s): BillViewSplit => {
      const r = result.splits.find((x) => x.split_no === s.split_no)!;
      return {
        split_no: s.split_no,
        state: 'open',
        plan: planView(splitMode, foldedRow(payload, s)),
        payments: (paymentsOf.get(s.split_no) ?? []).map((x) => paymentView(x, pv)),
        totals: { cash: toTotals(r.totals.cash), digital: toTotals(r.totals.digital), as_paid: toTotals(r.totals.as_paid) },
        balance_minor: r.balance_minor,
        dues: splitDues(r),
        invoice: null,
      };
    });
    return { events, result: { bill_id, splits: [...closedView, ...openView].sort((a, b) => a.split_no - b.split_no) } };
  },
});

export function registerSetSplits(app: FastifyInstance): void {
  commandRegistry(app).register(SetSplits);
}

/**
 * The open split numbers of the new plan: items / amount → the payload's; equal → the `n` lowest numbers no closed
 * split holds (§3.8: closed numbers are kept); none → the paid open split's, else the lowest open split's.
 */
function newSplitNos(p: SetSplitsPayload, planned: ReadonlyArray<{ split_no: number }>, closed: ReadonlySet<number>, openRows: ReadonlyArray<{ split_no: number }>, paid: readonly number[]): number[] {
  if (p.mode === 'items' || p.mode === 'amount') return planned.map((s) => s.split_no);
  if (p.mode === 'none') return [paid.length === 1 ? paid[0]! : openRows[0]!.split_no];
  const out: number[] = [];
  for (let n = 1; n <= 20 && out.length < (p.n as number); n++) if (!closed.has(n)) out.push(n);
  if (out.length < (p.n as number)) {
    throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'n', message: `at most ${out.length} open splits: split numbers run 1–20 and closed numbers are kept` }] });
  }
  return out;
}

/** The compute plan of the event (the fold's reading of it, §5). */
function computePlanOf(e: BillSplitsSetPayload): ComputePlan {
  if (e.mode === 'none') return { mode: 'none', split_no: e.splits[0]!.split_no };
  if (e.mode === 'items') return { mode: 'items', splits: e.splits.map((s) => ({ split_no: s.split_no, lines: (s.lines ?? []).map((l) => ({ order_item_id: l.order_item_id, units: l.units })) })) };
  if (e.mode === 'amount') return { mode: 'amount', splits: e.splits.map((s) => ({ split_no: s.split_no, share_minor: s.share_minor as number })) };
  return { mode: 'equal', splits: e.splits.map((s) => ({ split_no: s.split_no })) };
}

/**
 * The `bill_splits` / `bill_split_lines` reading of one open split of `e` as the fold writes it (§5), for the shared
 * `planView`: amount `{ share_minor }`; equal `{ n, k }` with k = the split's rank by split_no among the listed ones
 * (as the fold computes it); items → its rows by order_item_id (SPLITS_OF_BILL's ORDER BY); none → null.
 */
function foldedRow(e: BillSplitsSetPayload, s: BillSplitsSetPayload['splits'][number]): Pick<SplitRow, 'state' | 'plan_json' | 'plan_lines_json'> {
  const k = e.splits.filter((x) => x.split_no <= s.split_no).length;
  const plan_json = e.mode === 'amount' ? JSON.stringify({ share_minor: s.share_minor }) : e.mode === 'equal' ? JSON.stringify({ n: e.splits.length, k }) : null;
  const rows = (s.lines ?? []).map((l) => ({ order_item_id: l.order_item_id, units: l.units })).sort((a, b) => (a.order_item_id < b.order_item_id ? -1 : a.order_item_id > b.order_item_id ? 1 : 0));
  return { state: 'open', plan_json, plan_lines_json: JSON.stringify(rows) };
}
