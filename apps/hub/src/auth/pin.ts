import { DomainError } from '@pos/domain';
import type Database from 'better-sqlite3';
import type { Writer, WriterTx } from '../engine-host/writer.js';
import type { HubConfig } from '../config/schema.js';
import type { Clock } from '../lib/clock.js';
import { Semaphore, SemaphoreTimeoutError } from '../lib/semaphore.js';
import type { StaffDirectory } from './staff-directory.js';

export interface RateSubject {
  type: 'device' | 'ip';
  id: string;
}

interface LockRow {
  failed_count: number;
  window_started_at: number;
  locked_until: number | null;
}

interface LockView {
  count: number;
  windowStarted: number;
  lockedUntil: number | null;
  locked: boolean;
}

const WAIT_MS = 2_000;

export async function checkPin<T>(
  deps: {
    db: Database.Database;
    writer: Writer;
    directory: () => StaffDirectory;
    clock: Clock;
    config: HubConfig;
    semaphore: Semaphore;
    verify: (pinHash: string, pin: string) => Promise<boolean>;
  },
  o: { staffId: string; pin: string; subject: RateSubject; eventDeviceId: string },
  onMatch: (tx: WriterTx) => T,
): Promise<T> {
  const branchId = deps.config.provisioned?.branch_id;
  if (branchId === undefined) throw new DomainError('HUB_NOT_PROVISIONED');
  const subjectCode = o.subject.type === 'ip' ? 'IP_LOCKED_OUT' : 'DEVICE_LOCKED_OUT';
  const subjectWindow = deps.config.auth.device_failure_window_ms;
  const openedAt = deps.clock.branchNow();
  const subjectNow = view(readLock(deps.db, branchId, o.subject.type, o.subject.id), openedAt, subjectWindow);
  if (subjectNow.locked && subjectNow.lockedUntil !== null) {
    throw new DomainError(subjectCode, { retry_after_ms: subjectNow.lockedUntil - openedAt });
  }
  const staffNow = view(readLock(deps.db, branchId, 'staff', o.staffId), openedAt, null);
  if (staffNow.locked && staffNow.lockedUntil !== null) {
    throw new DomainError('PIN_LOCKED_OUT', { retry_after_ms: staffNow.lockedUntil - openedAt });
  }
  const staff = deps.directory().get(o.staffId);
  if (staff === undefined) throw new DomainError('STAFF_NOT_FOUND');

  let release: () => void;
  try {
    release = await deps.semaphore.acquire(WAIT_MS);
  } catch (error) {
    if (error instanceof SemaphoreTimeoutError) throw new DomainError('SERVICE_UNAVAILABLE', { retry_after_ms: 1000 });
    throw error;
  }
  let matched = false;
  try {
    matched = await deps.verify(staff.pin_hash, o.pin);
  } finally {
    release();
  }

  const outcome = deps.writer.run((tx) => {
    const now = deps.clock.branchNow();
    const subject = view(readLock(tx.db, tx.branchId, o.subject.type, o.subject.id), now, subjectWindow);
    if (subject.locked && subject.lockedUntil !== null) {
      throw new DomainError(subjectCode, { retry_after_ms: subject.lockedUntil - now });
    }
    const staffLock = view(readLock(tx.db, tx.branchId, 'staff', o.staffId), now, null);
    if (staffLock.locked && staffLock.lockedUntil !== null) {
      throw new DomainError('PIN_LOCKED_OUT', { retry_after_ms: staffLock.lockedUntil - now });
    }
    if (!matched) {
      const staffCount = recordFailure(tx, 'staff', o.staffId, now, null, deps.config.auth.pin_max_failures, deps.config.auth.pin_lockout_ms, (count, lockedUntil) => ({
        stream_type: 'staff',
        stream_id: o.staffId,
        event_type: 'StaffPinLockedOut',
        schema_version: 1,
        payload: { staff_id: o.staffId, locked_until: lockedUntil, failed_count: count },
        occurred_at: now,
        actor_id: null,
        device_id: o.eventDeviceId,
      }));
      recordFailure(tx, o.subject.type, o.subject.id, now, subjectWindow, deps.config.auth.device_max_failures, deps.config.auth.pin_lockout_ms, (count, lockedUntil) => ({
        stream_type: 'hub',
        stream_id: o.subject.id,
        event_type: 'DevicePinLockedOut',
        schema_version: 1,
        payload: { subject_type: o.subject.type, subject_id: o.subject.id, locked_until: lockedUntil, failed_count: count },
        occurred_at: now,
        actor_id: null,
        device_id: o.eventDeviceId,
      }));
      return { kind: 'mismatch' as const, attemptsRemaining: Math.max(0, deps.config.auth.pin_max_failures - staffCount) };
    }
    tx.db
      .prepare(
        `UPDATE auth_lockouts SET failed_count = 0, locked_until = NULL
         WHERE branch_id = ? AND subject_type = 'staff' AND subject_id = ?`,
      )
      .run(tx.branchId, o.staffId);
    return { kind: 'match' as const, value: onMatch(tx) };
  });
  if (outcome.result.kind === 'mismatch') {
    throw new DomainError('PIN_INVALID', { attempts_remaining: outcome.result.attemptsRemaining });
  }
  return outcome.result.value;
}

function recordFailure(
  tx: WriterTx,
  subjectType: 'staff' | 'device' | 'ip',
  subjectId: string,
  now: number,
  windowMs: number | null,
  threshold: number,
  lockMs: number,
  event: (count: number, lockedUntil: number) => Parameters<WriterTx['append']>[0][number],
): number {
  const state = view(readLock(tx.db, tx.branchId, subjectType, subjectId), now, windowMs);
  const count = state.count + 1;
  const lockedUntil = count >= threshold ? now + lockMs : null;
  tx.db
    .prepare(
      `INSERT INTO auth_lockouts (branch_id, subject_type, subject_id, failed_count, window_started_at, locked_until)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (branch_id, subject_type, subject_id) DO UPDATE SET
         failed_count = excluded.failed_count,
         window_started_at = excluded.window_started_at,
         locked_until = excluded.locked_until`,
    )
    .run(tx.branchId, subjectType, subjectId, count, state.windowStarted, lockedUntil);
  if (lockedUntil !== null) tx.append([event(count, lockedUntil)]);
  return count;
}

function view(row: LockRow | undefined, now: number, windowMs: number | null): LockView {
  if (row === undefined) return { count: 0, windowStarted: now, lockedUntil: null, locked: false };
  if (row.locked_until !== null && row.locked_until > now) {
    return { count: row.failed_count, windowStarted: row.window_started_at, lockedUntil: row.locked_until, locked: true };
  }
  const expired = row.locked_until !== null && row.locked_until <= now;
  const windowElapsed = windowMs !== null && now >= row.window_started_at + windowMs;
  if (expired || windowElapsed) return { count: 0, windowStarted: now, lockedUntil: null, locked: false };
  return { count: row.failed_count, windowStarted: row.window_started_at, lockedUntil: null, locked: false };
}

function readLock(db: Database.Database, branchId: string, subjectType: string, subjectId: string): LockRow | undefined {
  return db
    .prepare(
      `SELECT failed_count, window_started_at, locked_until FROM auth_lockouts
       WHERE branch_id = ? AND subject_type = ? AND subject_id = ?`,
    )
    .get(branchId, subjectType, subjectId) as LockRow | undefined;
}
