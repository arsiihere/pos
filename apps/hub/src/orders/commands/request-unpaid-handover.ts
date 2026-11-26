// ⚠️ 02b v1.0.25 §6.4a RequestUnpaidHandover, §3.7a Ask (OR-7; run 3 R3-M-2, R3-M-8; D2, D3), U-2. `{ order_id }`;
// permission mark-served, order scope as MarkServed (§3.14); staff session; not queueable; idempotent by command_id.
// Script: the named order (1) → 404 / 400 / { needed: false } → scope (0, from the row) → its key due with keyBalances
// (1, D3) → { needed: false } / an effective approval at this due → { approved: true } → the open request of the order
// (1 targeted read): same amount → its id and whether the caller asked it; a stale amount → closed `obsolete`
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
export const dedupeKeyOf = (order_id: string): string => `${HAND_OVER_UNPAID_KIND}:${order_id}`;

/** §6.12a values: one named order (R3-M-2), its token (null for parking) and the due asked about (> 0). */
export const HandOverUnpaidValues = z.object({
  order_id: z.string().min(1),
  token: z.number().int().positive().nullable(),
  due_minor: z.number().int().positive(),
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
}

/** The named order (1 statement); undefined when unknown. */
export function readUnpaidOrder(db: Database.Database, order_id: string): UnpaidOrderRow | undefined {
  return db
    .prepare(
      `SELECT order_id, order_type, placed_by, token, bill_key, cancelled_at, billed_at, day_closed_at,
              unpaid_handover_approved_at, unpaid_handover_approved_due_minor
         FROM orders WHERE order_id = ?`,
    )
    .get(order_id) as UnpaidOrderRow | undefined;
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
  const open = alerts.listOpen(db, { kind: HAND_OVER_UNPAID_KIND, subject: { stream_type: 'order', stream_id: o.order_id } });
  const pending = open.find((a) => a.dedupe_key === dedupeKeyOf(o.order_id));
  if (pending !== undefined && (pending.values as HandOverUnpaidValues).due_minor === due) {
    return { events: [], result: { alert_id: pending.alert_id, is_requester: pending.requester_staff_id === caller } };
  }
  // A stale amount: its obsolete close goes in first, so the same dedupe key raises the replacement (§6.4a, §6.19).
  if (pending !== undefined) ctx.tx.append(alerts.closeMany(ctx, [{ alert_id: pending.alert_id, reason: 'obsolete', note: 'due_changed' }]));
  const values: HandOverUnpaidValues = { order_id: o.order_id, token: o.order_type === 'parking' ? null : o.token, due_minor: due };
  const details: AlertDetails = { identifier: identifierOf(o), amount: due };
  const raised = alerts.raise(ctx, {
    kind: HAND_OVER_UNPAID_KIND,
    subject: { stream_type: 'order', stream_id: o.order_id },
    target: { kind: 'answerers' },
    values,
    details,
    display: { kind_label_key: HAND_OVER_UNPAID_LABELS.lock },
    dedupe_key: dedupeKeyOf(o.order_id),
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
