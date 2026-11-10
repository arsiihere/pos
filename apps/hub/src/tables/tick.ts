import type { EventDraft } from '@pos/events';
import type { TableLockReleasedPayload } from '@pos/events';
import type { TickDef } from '../alerts/tick.js';
import { cachedPrepare } from '../alerts/statements.js';
import { branchConfig } from '../sync/branch-config-holder.js';

// 02a §3.4, §6.5, T14: the lock tick `table_locks`, a module-level TickDef (ruling R3, as firesTick) registered once
// by registerTables. [02a v1.1.2 §3.4] (owner ruling 2026-11-09): a live session keeps a lock only when it started at
// or before the lock's last activity (`s.started_at <= l.last_activity_at`), so the same staff signing in again on the
// same device does not keep it; a T15 move sets last_activity_at to the move, so the other device's session keeps it.
// - due: the §3.4 statement verbatim, one statement; the inner lookup uses `staff_sessions_active_device`.
// - intents: one read with the same predicate (same `>`), then one TableLockReleased per row on the lock's primary
//   table stream: no live session → `session_expired` (checked first), else `lock_ttl`. 1 read + 1 append per pass.
// - ttl is read per call from branchConfig() (never captured). No applied config → :ttl bound NULL (as firesTick, a
//   missing config turns off only the part that needs it): `:now - x > NULL` is NULL, so only `session_expired` locks
//   are released until a config is applied.
// - Envelope (§6.5): occurred_at = the pass's now, actor_id null, device_id 'hub'.

const LIVE_SESSION = `SELECT 1 FROM staff_sessions s WHERE s.device_id = l.device_id AND s.staff_id = l.staff_id AND s.kind IN ('staff','station') AND s.ended_at IS NULL AND s.started_at <= l.last_activity_at`;

export const TABLE_LOCKS_DUE_SQL = `SELECT 1 FROM table_locks l WHERE NOT EXISTS (${LIVE_SESSION}) OR :now - l.last_activity_at > :ttl LIMIT 1`;

export const TABLE_LOCKS_RELEASE_SQL = `SELECT l.table_id, l.seating_id, l.staff_id, EXISTS (${LIVE_SESSION}) AS live
    FROM table_locks l WHERE NOT EXISTS (${LIVE_SESSION}) OR :now - l.last_activity_at > :ttl
    ORDER BY l.table_id`;

interface ReleaseRow {
  table_id: string;
  seating_id: string;
  staff_id: string;
  live: 0 | 1;
}

function params(now: number): { now: number; ttl: number | null } {
  return { now, ttl: branchConfig()?.engine_settings.table_lock_ttl_ms ?? null };
}

export const tableLocksTick: TickDef = {
  name: 'table_locks',
  due(db, _state, now) {
    return cachedPrepare(db, TABLE_LOCKS_DUE_SQL).get(params(now)) !== undefined;
  },
  intents(tx, _state, now) {
    const rows = cachedPrepare(tx.db, TABLE_LOCKS_RELEASE_SQL).all(params(now)) as ReleaseRow[];
    return rows.map((r): EventDraft => {
      const payload: TableLockReleasedPayload = {
        table_id: r.table_id,
        seating_id: r.seating_id,
        staff_id: r.staff_id,
        reason: r.live === 1 ? 'lock_ttl' : 'session_expired',
      };
      return {
        stream_type: 'table',
        stream_id: r.table_id,
        event_type: 'TableLockReleased',
        schema_version: 1,
        payload,
        occurred_at: now,
        actor_id: null,
        device_id: 'hub',
      };
    });
  },
};
