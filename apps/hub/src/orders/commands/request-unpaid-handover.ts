// ⚠️ 02b v1.0.25 §6.4a RequestUnpaidHandover, §3.7a Ask (OR-7; run 3 R3-M-2, R3-M-8; D2, D3), U-2. `{ order_id }`;
// permission mark-served, order scope as MarkServed (§3.14); staff session; not queueable; idempotent by command_id.
// Script: the named order (1) → 404 / 400 / { needed: false } → scope (0, from the row) → its key due with keyBalances
// (1, D3) → { needed: false } / an effective approval at this due → { approved: true } → ⚠️ 02b v1.0.27 (owner 2026-11-28
// Q9) the bill's live orders (1) and the open request of the bill (1 targeted read, held by its oldest order): same
// amount and orders → its id and whether the caller asked it; a stale amount → closed `obsolete`
// (note due_changed) before the replacement raise → alerts.raise of kind hand_over_unpaid.
// Result: { needed: false } | { approved: true } | { alert_id, is_requester }.
import { DomainError } from '@pos/domain';
import type { AlertDetails, EventDraft } from '@pos/events';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { alerts } from '../../alerts/raise.js';
import { keyBalances } from '../../billing/queries/key-balances.js';
import { defineCommand, type CommandCtx } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { checkOrderScope } from './mark-served.js';

export const HAND_OVER_UNPAID_KIND = 'hand_over_unpaid';
export const HAND_OVER_UNPAID_LABELS = { card: 'alert.hand_over_unpaid.card', lock: 'alert.hand_over_unpaid.lock' } as const;
/** ⚠️ 02b v1.0.27 §6.12a (owner 2026-11-28 Q10): details.disposition of a request for an addition-only bill */
export const HAND_OVER_UNPAID_ADDITION = 'alert.hand_over_unpaid.addition';
export const dedupeKeyOf = (order_id: string): string => `${HAND_OVER_UNPAID_KIND}:${order_id}`;
/** ⚠️ 02b v1.0.27 (owner 2026-11-28 Q9): one request per bill */
export const billDedupeKeyOf = (bill_key: string): string => `${HAND_OVER_UNPAID_KIND}:bill:${bill_key}`;

/** §6.12a values: one named order (R3-M-2), its token (null for parking) and the due asked about (> 0). */
export const HandOverUnpaidValues = z.object({
  order_id: z.string().min(1),
  token: z.number().int().positive().nullable(),
  due_minor: z.number().int().positive(),
  // ⚠️ 02b v1.0.27 (owner 2026-11-28 Q9): every live order of the request's bill, oldest first (absent on an older alert)
  order_ids: z.array(z.string().min(1)).min(1).optional(),
});
export type HandOverUnpaidValues = z.infer<typeof HandOverUnpaidValues>;

export interface UnpaidOrderRow {
  order_id: string;
  order_type: 'dine_in' | 'takeaway' | 'parking';
  placed_by: string | null;
  token: number | null;
  bill_key: string;
  cancelled_at: number | null;
  billed_at: number | null;
  day_closed_at: number | null;
  unpaid_handover_approved_at: number | null;
  unpaid_handover_approved_due_minor: number | null;
  /** ⚠️ 02b v1.0.28 §6.12a (QA-R2, UX): the customer's name for the manager's card (same statement) */
  customer_name: string | null;
}

/** The named order (1 statement); undefined when unknown. */
export function readUnpaidOrder(db: Database.Database, order_id: string): UnpaidOrderRow | undefined {
  return db
    .prepare(
      `SELECT order_id, order_type, placed_by, token, bill_key, cancelled_at, billed_at, day_closed_at,
              unpaid_handover_approved_at, unpaid_handover_approved_due_minor, customer_name
         FROM orders WHERE order_id = ?`,
    )
    .get(order_id) as UnpaidOrderRow | undefined;
}

/**
 * ⚠️ 02b v1.0.27 (owner 2026-11-28 Q9): the bill's live takeaway / parking orders, oldest first (1 statement). The
 * request of a bill is held by its oldest (the subject) and covers them all.
 */
export function liveOrdersOfBill(db: Database.Database, bill_key: string): UnpaidOrderRow[] {
  return db
    .prepare(
      `SELECT order_id, order_type, placed_by, token, bill_key, cancelled_at, billed_at, day_closed_at,
              unpaid_handover_approved_at, unpaid_handover_approved_due_minor, customer_name
         FROM orders
        WHERE bill_key = ? AND order_type IN ('takeaway', 'parking')
          AND cancelled_at IS NULL AND billed_at IS NULL AND day_closed_at IS NULL
        ORDER BY placed_at, order_id`,
    )
    .all(bill_key) as UnpaidOrderRow[];
}

/** D3: the due of the order's key (Σ of its open split balances; 1 statement). */
export function dueOf(db: Database.Database, o: UnpaidOrderRow): number {
  return keyBalances(db, [o.bill_key]).get(o.bill_key)?.due_minor ?? 0;
}

/** §6.4a: still a live, unbilled, open-day order (cancelled, day-closed or billed → not needed). */
export const isLive = (o: UnpaidOrderRow): boolean => o.cancelled_at === null && o.day_closed_at === null && o.billed_at === null;

/** D2: an approval covers the due at approval time; it is effective while the due has not risen above it. */
export const isApproved = (o: UnpaidOrderRow, due: number): boolean =>
  o.unpaid_handover_approved_at !== null && o.unpaid_handover_approved_due_minor !== null && due <= o.unpaid_handover_approved_due_minor;

export const identifierOf = (o: UnpaidOrderRow): string => (o.order_type === 'parking' || o.token === null ? 'PARKING' : `#${o.token}`);

const Payload = z.object({ order_id: z.string().min(1) }).strict();

type Result = { needed: false } | { approved: true } | { alert_id: string; is_requester: boolean };

function requestUnpaidHandover(ctx: CommandCtx, p: z.infer<typeof Payload>): { events: EventDraft[]; result: Result } {
  const db = ctx.tx.db;
  const o = readUnpaidOrder(db, p.order_id);
  if (o === undefined) throw new DomainError('ORDER_NOT_FOUND', { order_id: p.order_id });
  if (o.order_type === 'dine_in') throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'order_id', message: 'takeaway_or_parking_only' }] });
  if (!isLive(o)) return { events: [], result: { needed: false } };
  checkOrderScope(ctx, [{ order_id: o.order_id, order_type: o.order_type, placed_by: o.placed_by ?? '', holder_staff_id: null }]); // takeaway / parking: placed_by, no read
  const due = dueOf(db, o);
  if (due <= 0) return { events: [], result: { needed: false } };
  if (isApproved(o, due)) return { events: [], result: { approved: true } };

  const caller = ctx.actor.staffId!;
  // ⚠️ 02b v1.0.27 (owner 2026-11-28 Q9): one request per bill — held by the bill's oldest live order, covering them all
  const bill = liveOrdersOfBill(db, o.bill_key);
  const subject = bill[0] ?? o;
  const order_ids = bill.length > 0 ? bill.map((b) => b.order_id) : [o.order_id];
  const open = alerts.listOpen(db, { kind: HAND_OVER_UNPAID_KIND, subject: { stream_type: 'order', stream_id: subject.order_id } });
  const pending = open.find((a) => a.dedupe_key === billDedupeKeyOf(o.bill_key) || a.dedupe_key === dedupeKeyOf(subject.order_id));
  const pv = pending?.values as HandOverUnpaidValues | undefined;
  const sameOrders = (pv?.order_ids ?? [pv?.order_id]).join(' ') === order_ids.join(' ');
  if (pending !== undefined && pv!.due_minor === due && sameOrders) {
    return { events: [], result: { alert_id: pending.alert_id, is_requester: pending.requester_staff_id === caller } };
  }
  // A stale amount (or another set of orders): its obsolete close goes in first, so the same key raises the replacement.
  if (pending !== undefined) ctx.tx.append(alerts.closeMany(ctx, [{ alert_id: pending.alert_id, reason: 'obsolete', note: 'due_changed' }]));
  const values: HandOverUnpaidValues = { order_id: subject.order_id, token: subject.order_type === 'parking' ? null : subject.token, due_minor: due, order_ids };
  // ⚠️ 02b v1.0.27 §6.12a (owner 2026-11-28 Q10): a takeaway bill whose live orders are additions only (its key names the
  // root, `takeaway:<root>`, and the root is no longer on it) → the manager's card says "(addition)"
  const additionOnly = subject.order_type === 'takeaway' && o.bill_key.startsWith('takeaway:') && o.bill_key !== `takeaway:${subject.order_id}`;
  // ⚠️ 02b v1.0.28 §6.12a (owner 2026-11-28 QA-R2, UX): the card names the customer beside the token (≤ 40)
  const customer = (subject.customer_name ?? '').trim();
  const identifier = (customer === '' ? identifierOf(subject) : `${identifierOf(subject)} · ${customer}`).slice(0, 40);
  const details: AlertDetails = { identifier, amount: due, ...(additionOnly ? { disposition: HAND_OVER_UNPAID_ADDITION } : {}) };
  const raised = alerts.raise(ctx, {
    kind: HAND_OVER_UNPAID_KIND,
    subject: { stream_type: 'order', stream_id: subject.order_id },
    target: { kind: 'answerers' },
    values,
    details,
    // ⚠️ 02b v1.0.28 §6.12a (QA-R2, UX): who asked, the card's "from {name}" line
    display: { kind_label_key: HAND_OVER_UNPAID_LABELS.lock, requester_name: ctx.directory.get(caller)?.display_name ?? null },
    dedupe_key: billDedupeKeyOf(o.bill_key),
    requester_staff_id: caller,
  });
  return { events: raised.events, result: { alert_id: raised.alert_id, is_requester: !raised.deduped || pending?.requester_staff_id === caller } };
}

export const requestUnpaidHandoverCommand = defineCommand({
  commandType: 'RequestUnpaidHandover',
  payloadSchema: Payload,
  sessionKind: 'device',
  permission: 'mark-served',
  handle: (ctx, payload) => requestUnpaidHandover(ctx, payload),
});

export function registerRequestUnpaidHandover(app: FastifyInstance): void {
  commandRegistry(app).register(requestUnpaidHandoverCommand);
}
