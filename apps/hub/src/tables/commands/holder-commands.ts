import { DomainError } from '@pos/domain';
import type { EventDraft, TableHolderChangedPayload, TableLockReleasedPayload } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Resolution } from '../../auth/staff-directory.js';
import { defineCommand, type CommandCtx } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { checkReceiver, closeHandover, scopeCoversFloor } from '../handover.js';

// 02a v1.1.3 §3.7 / §6.6 TakeOverTable, §6.8 ForceMoveTable (T5, T6, T10, T18, T20, §3.9, §3.15).
// Statements: TakeOverTable 1 (seating + lock) + 1 byDedupeKey + the alerts.close bound;
// ForceMoveTable the same + 1 (the receiver's live session).

export const TakeOverTablePayload = z.object({
  table_id: z.string().min(1),
  seating_id: z.string().min(1),
});
export type TakeOverTablePayload = z.infer<typeof TakeOverTablePayload>;

export const ForceMoveTablePayload = z.object({
  table_id: z.string().min(1),
  seating_id: z.string().min(1),
  to_staff_id: z.string().min(1),
  reason: z.string().min(1).max(120),
});
export type ForceMoveTablePayload = z.infer<typeof ForceMoveTablePayload>;

interface SeatingLockRow {
  seating_id: string;
  primary_table_id: string;
  state: string;
  holder_staff_id: string;
  lock_staff_id: string | null;
}

// One statement: the named table's open seating and its lock (stored under the primary table, §3.2).
const READ_SEATING_LOCK = `SELECT s.seating_id AS seating_id, s.primary_table_id AS primary_table_id, s.state AS state,
       s.holder_staff_id AS holder_staff_id, l.staff_id AS lock_staff_id
  FROM seating_tables st
  JOIN seatings s ON s.seating_id = st.seating_id
  LEFT JOIN table_locks l ON l.table_id = s.primary_table_id
 WHERE st.table_id = ?`;

/** Seating checks (T18; a FREE table with a `seating_id` given is "changed", §6 common rules); NEEDS_CLEANING → 409. */
function readSeating(ctx: CommandCtx, table_id: string, seating_id: string): SeatingLockRow {
  const row = ctx.tx.db.prepare(READ_SEATING_LOCK).get(table_id) as SeatingLockRow | undefined;
  if (row === undefined || row.seating_id !== seating_id) throw new DomainError('TABLE_SEATING_CHANGED', { table_id, seating_id });
  if (row.state === 'NEEDS_CLEANING') throw new DomainError('TABLE_NEEDS_CLEANING', { table_id });
  return row;
}

/**
 * The holder change (T20): TableHolderChanged, + TableLockReleased { holder_changed } when the lock is held by
 * anyone other than the new holder (his own lock, any device, is kept), + closeHandover (§3.9) — one transaction.
 */
function holderChange(
  ctx: CommandCtx,
  row: SeatingLockRow,
  change: Pick<TableHolderChangedPayload, 'to_staff_id' | 'reason' | 'by_staff_id' | 'note'>,
): EventDraft[] {
  const envelope = {
    stream_type: 'table' as const,
    stream_id: row.primary_table_id,
    schema_version: 1,
    occurred_at: ctx.clock.branchNow(),
    actor_id: ctx.actor.staffId,
    device_id: ctx.actor.deviceId,
  };
  const changed: TableHolderChangedPayload = {
    table_id: row.primary_table_id,
    seating_id: row.seating_id,
    from_staff_id: row.holder_staff_id,
    to_staff_id: change.to_staff_id,
    reason: change.reason,
    by_staff_id: change.by_staff_id,
    ...(change.note === undefined ? {} : { note: change.note }),
  };
  const drafts: EventDraft[] = [{ ...envelope, event_type: 'TableHolderChanged', payload: changed }];
  if (row.lock_staff_id !== null && row.lock_staff_id !== change.to_staff_id) {
    const released: TableLockReleasedPayload = {
      table_id: row.primary_table_id,
      seating_id: row.seating_id,
      staff_id: row.lock_staff_id,
      reason: 'holder_changed',
    };
    drafts.push({ ...envelope, event_type: 'TableLockReleased', payload: released });
  }
  drafts.push(...closeHandover(ctx, row.seating_id, change.reason));
  return drafts;
}

/** Scope last (C8, §3.15: only an `allowed` grant counts); `own_tables` covers only a seating the caller holds (T8). */
function requireScope(ctx: CommandCtx, grant: Resolution | null, caller: string, table_id: string, holds: boolean): void {
  const covered =
    grant !== null &&
    grant.grant === 'allowed' &&
    ((holds && grant.scope === 'own_tables') || scopeCoversFloor(ctx.directory, caller, grant.scope ?? '', table_id));
  if (!covered) throw new DomainError('PERMISSION_DENIED', { reason: 'outside_scope', table_ids: [table_id] });
}

// ------------------------------------------------------------------------------------------- §6.6

function takeOver(ctx: CommandCtx, payload: TakeOverTablePayload): { events: EventDraft[]; result: { changed: boolean } } {
  const { table_id, seating_id } = payload;
  // 1. seating checks
  const row = readSeating(ctx, table_id, seating_id);
  // 2. the seating's assignee = its primary table's (T10; config, 0 statements, G4-1 #24)
  const caller = ctx.actor.staffId;
  const assignee = ctx.directory.assignedOrderTaker(row.primary_table_id);
  if (caller === null || assignee !== caller) {
    throw new DomainError('PERMISSION_DENIED', {
      reason: 'not_assigned',
      table_id,
      assigned_staff_id: assignee,
      holder_staff_id: row.holder_staff_id,
    });
  }
  // 3. already the holder → no event
  const holds = row.holder_staff_id === caller;
  // 4–5. the holder change and closeHandover
  const events = holds ? [] : holderChange(ctx, row, { to_staff_id: caller, reason: 'take_over', by_staff_id: caller });
  // 6. scope on the caller's take-order grant
  requireScope(ctx, ctx.permission, caller, table_id, holds);
  return { events, result: { changed: !holds } };
}

// ------------------------------------------------------------------------------------------- §6.8

function forceMove(ctx: CommandCtx, payload: ForceMoveTablePayload): { events: EventDraft[]; result: { changed: boolean } } {
  const { table_id, seating_id, to_staff_id, reason } = payload;
  const caller = ctx.actor.staffId;
  // unreachable: the pipeline's permission check needs a staff on the session; kept for the type
  if (caller === null) throw new DomainError('PERMISSION_DENIED', { reason: 'outside_scope', table_ids: [table_id] });
  const row = readSeating(ctx, table_id, seating_id);
  const unchanged = to_staff_id === row.holder_staff_id;
  let events: EventDraft[] = [];
  if (!unchanged) {
    // §6.7 step 3 without is_requester (a manager may move a table to himself)
    checkReceiver(ctx.tx.db, ctx.directory, { table_id, holder_staff_id: row.holder_staff_id, sender_staff_id: null, to_staff_id });
    events = holderChange(ctx, row, { to_staff_id, reason: 'force_move', by_staff_id: caller, note: reason });
  }
  // scope last on the caller's force-release-table-lock grant (the registered permission)
  requireScope(ctx, ctx.permission, caller, table_id, false);
  return { events, result: { changed: !unchanged } };
}

export function registerHolderCommands(app: FastifyInstance): void {
  const registry = commandRegistry(app);
  registry.register(
    defineCommand({
      commandType: 'TakeOverTable',
      payloadSchema: TakeOverTablePayload,
      sessionKind: 'device',
      permission: 'take-order',
      handle: (ctx, payload) => takeOver(ctx, payload),
    }),
  );
  registry.register(
    defineCommand({
      commandType: 'ForceMoveTable',
      payloadSchema: ForceMoveTablePayload,
      sessionKind: 'device',
      permission: 'force-release-table-lock',
      handle: (ctx, payload) => forceMove(ctx, payload),
    }),
  );
}
