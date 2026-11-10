import { DomainError } from '@pos/domain';
import type { EventDraft, TableHolderChangedPayload, TableLockReleasedPayload } from '@pos/events';
import type Database from 'better-sqlite3';
import { alerts } from '../alerts/raise.js';
import type { AlertApplyCtx, AnswerFacts } from '../alerts/kinds.js';
import type { StaffDirectory } from '../auth/staff-directory.js';
import { branchConfig } from '../sync/branch-config-holder.js';
import type { CloseHandover } from './contracts.js';

// 02a v1.1.3 §3.8 handover with acceptance (the kind's apply), §3.9 closeHandover, §6.7 step 3 receiver checks
// (shared with ForceMoveTable, §6.8).

export const HANDOVER_KIND = 'table_handover';

export const handoverDedupeKey = (seating_id: string): string => `${HANDOVER_KIND}:${seating_id}`;

/** §6.15 values. */
export interface HandoverValues extends Record<string, unknown> {
  table_id: string;
  seating_id: string;
  from_staff_id: string;
}

// ------------------------------------------------------------------------------------------- §3.9 close

/** §3.9: `byDedupeKey` (1 statement) → if found, `alerts.close(…, 'obsolete', note)` drafts for the same transaction. */
export const closeHandover: CloseHandover = (ctx, seating_id, note) => {
  const alertId = alerts.byDedupeKey(ctx.tx.db, HANDOVER_KIND, handoverDedupeKey(seating_id));
  if (alertId === null) return [];
  return alerts.close(ctx, alertId, 'obsolete', note);
};

// ------------------------------------------------------------------------------------------- §6.7 step 3

/** The floor of a table in the branch config (0 statements); null for a table the config does not know. */
export function floorOf(table_id: string): string | null {
  return branchConfig()?.floors.find((f) => f.tables.some((t) => t.table_id === table_id))?.floor_id ?? null;
}

/** A grant's scope covers the table's floor: `branch`, or `my_floors` with the floor among the person's floors. */
export function scopeCoversFloor(directory: StaffDirectory, staff_id: string, scope: string, table_id: string): boolean {
  if (scope === 'branch') return true;
  if (scope !== 'my_floors') return false;
  const floor = floorOf(table_id);
  return floor !== null && directory.floorsOf(staff_id).includes(floor);
}

const LIVE_STAFF_SESSION = `SELECT 1 FROM staff_sessions WHERE staff_id = ? AND kind = 'staff' AND ended_at IS NULL LIMIT 1`;

/**
 * §6.7 step 3 (§6.8 without `is_requester` when `sender` is null): `to` ≠ holder (422 is_holder), ≠ sender
 * (422 is_requester), in the directory (409 inactive), an `allowed` take-order grant (422 no_permission) whose
 * scope covers the table's floor (422 outside_scope), a live staff session (409 not_working; 1 statement).
 */
export function checkReceiver(
  db: Database.Database,
  directory: StaffDirectory,
  q: { table_id: string; holder_staff_id: string; sender_staff_id: string | null; to_staff_id: string },
): void {
  const to = q.to_staff_id;
  if (to === q.holder_staff_id) throw new DomainError('HANDOVER_TARGET_INVALID', { reason: 'is_holder' });
  if (q.sender_staff_id !== null && to === q.sender_staff_id) throw new DomainError('HANDOVER_TARGET_INVALID', { reason: 'is_requester' });
  // the directory holds the branch's active staff: someone absent from it is not active (anymore)
  if (directory.get(to) === undefined) throw new DomainError('HANDOVER_TARGET_UNAVAILABLE', { reason: 'inactive' });
  const takeOrder = directory.resolve(to, 'take-order');
  if (takeOrder.grant !== 'allowed') throw new DomainError('HANDOVER_TARGET_INVALID', { reason: 'no_permission' });
  if (!scopeCoversFloor(directory, to, takeOrder.scope, q.table_id)) {
    throw new DomainError('HANDOVER_TARGET_INVALID', { reason: 'outside_scope' });
  }
  if (db.prepare(LIVE_STAFF_SESSION).get(to) === undefined) {
    throw new DomainError('HANDOVER_TARGET_UNAVAILABLE', { reason: 'not_working' });
  }
}

// ------------------------------------------------------------------------------------------- §3.8 apply

interface ApplyRow {
  primary_table_id: string;
  state: string;
  holder_staff_id: string;
  lock_staff_id: string | null;
}

/**
 * §3.8 / §6.15 `apply`: decline → []; accept → one statement (the seating and its lock by `values.seating_id`);
 * open, not NEEDS_CLEANING and still held by `from_staff_id` → TableHolderChanged { handover } (+ TableLockReleased
 * { holder_changed } when someone other than the receiver holds the lock, T20), every draft with this alert's id;
 * else 409 TABLE_HANDOVER_STALE (the request stays open).
 */
export function applyHandover<D>(ctx: AlertApplyCtx<HandoverValues, D>, answer: AnswerFacts): EventDraft[] {
  if (answer.decision !== 'accept') return [];
  const { alert } = ctx;
  const { seating_id, from_staff_id } = alert.values;
  const row = ctx.tx.db
    .prepare(
      `SELECT s.primary_table_id AS primary_table_id, s.state AS state, s.holder_staff_id AS holder_staff_id,
              l.staff_id AS lock_staff_id
         FROM seatings s
         LEFT JOIN table_locks l ON l.seating_id = s.seating_id
        WHERE s.seating_id = ?`,
    )
    .get(seating_id) as ApplyRow | undefined;
  if (row === undefined || row.state === 'CLOSED' || row.state === 'NEEDS_CLEANING' || row.holder_staff_id !== from_staff_id) {
    throw new DomainError('TABLE_HANDOVER_STALE', { table_id: alert.values.table_id, seating_id });
  }
  const to = answer.answerer_staff_id;
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
    seating_id,
    from_staff_id,
    to_staff_id: to,
    reason: 'handover',
    by_staff_id: to,
    alert_id: alert.alert_id,
  };
  const drafts: EventDraft[] = [{ ...envelope, event_type: 'TableHolderChanged', payload: changed }];
  if (row.lock_staff_id !== null && row.lock_staff_id !== to) {
    const released: TableLockReleasedPayload = {
      table_id: row.primary_table_id,
      seating_id,
      staff_id: row.lock_staff_id,
      reason: 'holder_changed',
      alert_id: alert.alert_id,
    };
    drafts.push({ ...envelope, event_type: 'TableLockReleased', payload: released });
  }
  return drafts;
}
