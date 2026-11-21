import { DomainError } from '@pos/domain';
import type { EventDraft } from '@pos/events';
import type { CommandCtx } from '../commands/registry.js';
import { branchConfig } from '../sync/branch-config-holder.js';
import type { RequireLock } from './contracts.js';

// 02a v1.1.1 §4.2 requireLock (+ P-1b), §2 (holder-only re-acquire, G4-3 #2, N-3), §3.15, T15, T18.
// One statement: the named table's open seating and its lock (stored under the primary table, §3.2).
// ⚠️ R-39 (2026-11-20): `requireLockHolder` below is the authorisation half alone (holder / take-order-anywhere / scope).
// ⚠️ 02a v1.1.8 (05 row T-3 (3), H2-13): `{ allowBillClosed: true }` — passed by SubmitOrder only — lets a live call
// (`ctx.queuedAt === null`) through a NEEDS_CLEANING seating; a queued replay keeps TABLE_NEEDS_CLEANING. A cleaned
// seating has no seating_tables row, so it stays TABLE_SEATING_CHANGED (T18, H2-14: no new code).

interface SeatingLockRow {
  seating_id: string;
  primary_table_id: string;
  state: string;
  holder_staff_id: string;
  lock_staff_id: string | null;
  lock_device_id: string | null;
}

export const requireLock: RequireLock = (tx, ref, ctx, opts) => {
  const row = tx.db
    .prepare(
      `SELECT s.seating_id AS seating_id, s.primary_table_id AS primary_table_id, s.state AS state,
              s.holder_staff_id AS holder_staff_id, l.staff_id AS lock_staff_id, l.device_id AS lock_device_id
         FROM seating_tables st
         JOIN seatings s ON s.seating_id = st.seating_id
         LEFT JOIN table_locks l ON l.table_id = s.primary_table_id
        WHERE st.table_id = ?`,
    )
    .get(ref.table_id) as SeatingLockRow | undefined;
  // T18: no seating, or another one.
  if (row === undefined || row.seating_id !== ref.seating_id) {
    throw new DomainError('TABLE_SEATING_CHANGED', { table_id: ref.table_id, seating_id: ref.seating_id });
  }
  // P-1b (AD-1) + owner AD-8: a queued replay never takes AND never moves a lock; the submit proceeds without it.
  const queued = ctx.queuedAt !== null;
  if (row.state === 'NEEDS_CLEANING' && !(opts?.allowBillClosed === true && !queued)) {
    throw new DomainError('TABLE_NEEDS_CLEANING', { table_id: ref.table_id });
  }

  const actor = ctx.actor.staffId;
  const device = ctx.actor.deviceId;
  const heldByMe = row.lock_staff_id === actor && row.lock_device_id === device;

  if (actor !== null && row.holder_staff_id === actor) {
    if (heldByMe) return [];
    if (row.lock_staff_id === null) return queued ? [] : [tableLocked(ctx, actor, row)];
    if (row.lock_staff_id === actor) return queued ? [] : [tableLocked(ctx, actor, row, row.lock_device_id ?? undefined)]; // T15
    throw alreadyLocked(ctx, ref.table_id, row.lock_staff_id);
  }

  // Holder ≠ actor: take-order-anywhere (§3.15: only an `allowed` grant counts); a free lock is never taken (G4-3 #2).
  const grant = anywhereGrant(ctx, actor, ref.table_id, row.holder_staff_id);
  let drafts: EventDraft[] = [];
  if (row.lock_staff_id === actor && !heldByMe) {
    if (!queued) drafts = [tableLocked(ctx, grant.actor, row, row.lock_device_id ?? undefined)]; // R1: moves (T15); never queued (AD-8)
  } else if (row.lock_staff_id !== null && !heldByMe) {
    throw alreadyLocked(ctx, ref.table_id, row.lock_staff_id);
  }
  // Scope last (C8, §3.15): the grant's scope must cover the table named.
  checkAnywhereScope(ctx, grant, ref.table_id);
  return drafts;
};

/**
 * ⚠️ Owner ruling R-39 (2026-11-20; 05 row T-3 (4)): requireLock's authorisation alone — holder, else an `allowed`
 * take-order-anywhere (`403 not_holder`) whose scope covers the table (`403 outside_scope`) — for a seating with no lock
 * to take (RemoveItems on a CLOSED seating). No lock check, no drafts, 0 statements: the caller passes the seating's
 * holder it already read (readOrder) and the table to judge (its primary table).
 */
export function requireLockHolder(ctx: CommandCtx, ref: { table_id: string; holder_staff_id: string }): void {
  const actor = ctx.actor.staffId;
  if (actor !== null && ref.holder_staff_id === actor) return;
  checkAnywhereScope(ctx, anywhereGrant(ctx, actor, ref.table_id, ref.holder_staff_id), ref.table_id);
}

/** §3.15: a non-holder needs an `allowed` take-order-anywhere, else `403 not_holder`. */
function anywhereGrant(ctx: CommandCtx, actor: string | null, table_id: string, holder_staff_id: string): { actor: string; scope: string } {
  const grant = actor === null ? null : ctx.directory.resolve(actor, 'take-order-anywhere');
  if (actor === null || grant === null || grant.grant !== 'allowed') {
    throw new DomainError('PERMISSION_DENIED', {
      reason: 'not_holder',
      table_id,
      assigned_staff_id: ctx.directory.assignedOrderTaker(table_id),
      holder_staff_id,
    });
  }
  return { actor, scope: grant.scope };
}

/** C8, §3.15: the take-order-anywhere grant's scope must cover the table named, else `403 outside_scope`. */
function checkAnywhereScope(ctx: CommandCtx, grant: { actor: string; scope: string }, table_id: string): void {
  if (grant.scope !== 'branch' && !coversFloor(ctx, grant.actor, table_id)) {
    throw new DomainError('PERMISSION_DENIED', { reason: 'outside_scope', table_ids: [table_id] });
  }
}

function tableLocked(ctx: CommandCtx, staff_id: string, row: SeatingLockRow, replaced_device_id?: string): EventDraft {
  return {
    stream_type: 'table',
    stream_id: row.primary_table_id,
    event_type: 'TableLocked',
    schema_version: 1,
    payload: {
      table_id: row.primary_table_id,
      seating_id: row.seating_id,
      staff_id,
      ...(replaced_device_id === undefined ? {} : { replaced_device_id }),
    },
    occurred_at: ctx.clock.branchNow(),
    actor_id: staff_id,
    device_id: ctx.actor.deviceId,
  };
}

// The locker can be missing from the directory (removed by a 01b apply while his lock waits for the tick): name null.
function alreadyLocked(ctx: CommandCtx, table_id: string, locked_by_staff_id: string): DomainError {
  return new DomainError('TABLE_ALREADY_LOCKED', {
    table_id,
    locked_by_staff_id,
    locked_by_name: ctx.directory.get(locked_by_staff_id)?.display_name ?? null,
  });
}

// `take-order-anywhere` offers `branch` and `my_floors` only (01b PERMISSION_SCOPES); 0 statements (config in memory).
function coversFloor(ctx: CommandCtx, staffId: string, table_id: string): boolean {
  const floor = branchConfig()?.floors.find((f) => f.tables.some((t) => t.table_id === table_id));
  return floor !== undefined && ctx.directory.floorsOf(staffId).includes(floor.floor_id);
}
