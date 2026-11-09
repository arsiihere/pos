import { DomainError, type TableState } from '@pos/domain';
import type { EventDraft } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { alerts } from '../../alerts/index.js';
import type { CommandCtx } from '../../commands/registry.js';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { branchConfig } from '../../sync/branch-config-holder.js';

// 02a §3.13, §6.12 RequestBill, §6.13 CleanTable; both queueable (§8 Offline, P-1f; 00 v1.8 H-1). No lock (D39).
// Neither reads ctx.queuedAt: the spec gives a queued replay no other behaviour; a stale seating_id drops it (T18).

export const RequestBillPayload = z.object({ table_id: z.string().min(1), seating_id: z.string().min(1) });
export const CleanTablePayload = z.object({ table_id: z.string().min(1), seating_id: z.string().min(1) });
type SeatingRef = z.infer<typeof RequestBillPayload>;

interface Seating {
  seating_id: string;
  primary_table_id: string;
  state: TableState;
  holder_staff_id: string;
  /** every table of the seating, ordered as seatingOf orders them */
  table_ids: string[];
  /** live orders = cancelled = 0 (§3.1) */
  live_orders: number;
}

// One statement: the named table's open seating, its tables and its live order count (R-2D-3).
const SEATING = `SELECT s.seating_id AS seating_id, s.primary_table_id AS primary_table_id, s.state AS state,
          s.holder_staff_id AS holder_staff_id, st.table_id AS table_id,
          (SELECT COUNT(*) FROM seating_orders so WHERE so.seating_id = s.seating_id AND so.cancelled = 0) AS live_orders
     FROM seating_tables mine
     JOIN seatings s ON s.seating_id = mine.seating_id
     JOIN seating_tables st ON st.seating_id = s.seating_id
    WHERE mine.table_id = ?
    ORDER BY st.joined_at, st.table_id`;

/** §6 Common rules (T18): no seating, or another one, while a `seating_id` was given → TABLE_SEATING_CHANGED. Shared with CallWaiter (§6.14). */
export function currentSeating(ctx: CommandCtx, ref: SeatingRef): Seating {
  const rows = ctx.tx.db.prepare(SEATING).all(ref.table_id) as Array<Omit<Seating, 'table_ids'> & { table_id: string }>;
  const first = rows[0];
  if (first === undefined || first.seating_id !== ref.seating_id) {
    throw new DomainError('TABLE_SEATING_CHANGED', { table_id: ref.table_id, seating_id: ref.seating_id });
  }
  return {
    seating_id: first.seating_id,
    primary_table_id: first.primary_table_id,
    state: first.state,
    holder_staff_id: first.holder_staff_id,
    table_ids: rows.map((r) => r.table_id),
    live_orders: first.live_orders,
  };
}

/**
 * C8 scope of the registered `take-order` grant (checked last), 0 statements: `branch` always; `my_floors` → the
 * table's floor (branch config) is one of the caller's (an archived table has none, §3.14); `own_tables` → the
 * caller holds the seating (§1.4 T8). Else 403 PERMISSION_DENIED outside_scope. Shared with CallWaiter (§6.14).
 */
export function checkTakeOrderScope(ctx: CommandCtx, table_id: string, holder_staff_id: string): void {
  const staffId = ctx.actor.staffId;
  const scope = ctx.permission !== null && 'scope' in ctx.permission ? ctx.permission.scope : null;
  let covered = false;
  if (staffId !== null) {
    if (scope === 'branch') covered = true;
    else if (scope === 'own_tables') covered = holder_staff_id === staffId;
    else if (scope === 'my_floors') {
      const floor = branchConfig()?.floors.find((f) => f.tables.some((t) => t.table_id === table_id));
      covered = floor !== undefined && ctx.directory.floorsOf(staffId).includes(floor.floor_id);
    }
  }
  if (!covered) throw new DomainError('PERMISSION_DENIED', { reason: 'outside_scope', table_ids: [table_id] });
}

/** A `table` stream draft on the seating's primary table (§6.19), shaped as tables/lock.ts drafts. */
function tableDraft(ctx: CommandCtx, seating: Seating, event_type: string, payload: Record<string, unknown>): EventDraft {
  return {
    stream_type: 'table',
    stream_id: seating.primary_table_id,
    event_type,
    schema_version: 1,
    payload,
    occurred_at: ctx.clock.branchNow(),
    actor_id: ctx.actor.staffId,
    device_id: ctx.actor.deviceId,
  };
}

// §3.13 RequestBill: ORDERED / FOOD_ON_TABLE → BillRequested; BILL_REQUESTED → requested: false; SEATED →
// TABLE_NO_ORDERS; NEEDS_CLEANING → TABLE_NEEDS_CLEANING. Scope last (C8).
function requestBill(ctx: CommandCtx, payload: SeatingRef): { events: EventDraft[]; result: { requested: boolean } } {
  const seating = currentSeating(ctx, payload);
  if (seating.state === 'NEEDS_CLEANING') throw new DomainError('TABLE_NEEDS_CLEANING', { table_id: payload.table_id });
  if (seating.state === 'SEATED') throw new DomainError('TABLE_NO_ORDERS', { table_id: payload.table_id });
  checkTakeOrderScope(ctx, payload.table_id, seating.holder_staff_id);
  if (seating.state === 'BILL_REQUESTED') return { events: [], result: { requested: false } };
  const billRequested = tableDraft(ctx, seating, 'BillRequested', {
    seating_id: seating.seating_id,
    table_id: seating.primary_table_id,
    by_staff_id: ctx.actor.staffId,
  });
  return { events: [billRequested], result: { requested: true } };
}

// §3.13 / §6.13 CleanTable: NEEDS_CLEANING → cleaned; SEATED → left_without_order; else TABLE_HAS_OPEN_ORDERS.
// The fold closes the seating; here the pending table_handover and the open call_waiter close `obsolete`.
// Statements: 1 + 2 byDedupeKey + closeMany's bound (nothing to close → none). `clean-table` is branch-only: no scope.
function cleanTable(ctx: CommandCtx, payload: SeatingRef): { events: EventDraft[]; result: { reason: 'cleaned' | 'left_without_order' } } {
  const seating = currentSeating(ctx, payload);
  let reason: 'cleaned' | 'left_without_order';
  if (seating.state === 'NEEDS_CLEANING') reason = 'cleaned';
  else if (seating.state === 'SEATED') reason = 'left_without_order';
  else throw new DomainError('TABLE_HAS_OPEN_ORDERS', { table_id: payload.table_id, order_count: seating.live_orders });

  const cleaned = tableDraft(ctx, seating, 'TableCleaned', {
    seating_id: seating.seating_id,
    table_ids: seating.table_ids,
    reason,
    by_staff_id: ctx.actor.staffId,
  });
  const open = [
    alerts.byDedupeKey(ctx.tx.db, 'table_handover', `table_handover:${seating.seating_id}`),
    alerts.byDedupeKey(ctx.tx.db, 'call_waiter', `call_waiter:${seating.seating_id}`),
  ].filter((id): id is string => id !== null);
  const closed = alerts.closeMany(ctx, open.map((alert_id) => ({ alert_id, reason: 'obsolete' as const })));
  return { events: [cleaned, ...closed], result: { reason } };
}

export const requestBillCommand = defineCommand({
  commandType: 'RequestBill',
  payloadSchema: RequestBillPayload,
  sessionKind: 'device',
  permission: 'take-order',
  queueable: true,
  handle: (ctx, payload) => requestBill(ctx, payload),
});

export const cleanTableCommand = defineCommand({
  commandType: 'CleanTable',
  payloadSchema: CleanTablePayload,
  sessionKind: 'device',
  permission: 'clean-table',
  queueable: true,
  handle: (ctx, payload) => cleanTable(ctx, payload),
});

export function registerBillClean(app: FastifyInstance): void {
  commandRegistry(app).register(requestBillCommand);
  commandRegistry(app).register(cleanTableCommand);
}
