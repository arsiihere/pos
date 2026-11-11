import type { BranchConfig } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registeredTicks, startTickLoop, TICK_MS, unregisterTick } from '../../src/alerts/tick';
import { readOnlyDb } from '../../src/engine-host/read-only-tx';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { TABLE_LOCKS_DUE_SQL, TABLE_LOCKS_RELEASE_SQL, tableLocksTick } from '../../src/tables/tick';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, endSessionNow, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

// 02a v1.1.2 §3.4, §6.5, T14, §10 test 8: the `table_locks` tick on the real 0012 tables. Locks and seatings are seeded with
// SQL (never the `tables` projection, another lane's code): assertions are on the appended events only.
// [02a v1.1.2 §3.4] (owner ruling 2026-11-09): a live session counts only when `s.started_at <= l.last_activity_at`.

const TTL = 900_000;
const WAITER = 'S_WAIT';

function withTtl(ttl: number): void {
  swapBranchConfig({
    config: { engine_settings: { table_lock_ttl_ms: ttl } } as unknown as BranchConfig,
    snapshotHash: 'h',
    configVersion: 1,
    snapshotSchemaVersion: 4,
    appliedAt: 0,
  });
}

interface Released {
  stream_type: string;
  stream_id: string;
  actor_id: string | null;
  device_id: string;
  occurred_at: number;
  payload: Record<string, unknown>;
}

describe('02a tick table_locks (§3.4, §6.5, T14)', () => {
  let h: TestHub;
  beforeEach(async () => {
    h = await createTestHub();
    await seedDirectory(h);
    withTtl(TTL);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    swapBranchConfig(null);
    await h.close();
  });

  function device(): string {
    return pairDevice(h, { type: 'tablet' }).deviceId;
  }
  function signIn(deviceId: string, staffId = WAITER): string {
    return openSession(h, { kind: 'staff', staffId, deviceId }).sessionId;
  }
  function seedLock(tableId: string, staffId: string, deviceId: string, lastActivityAt = h.clock.branchNow()): string {
    const seatingId = `SEAT-${tableId}`;
    h.deps.db
      .prepare(`INSERT INTO seatings (seating_id, primary_table_id, state, holder_staff_id, opened_at) VALUES (?, ?, 'SEATED', ?, ?)`)
      .run(seatingId, tableId, staffId, lastActivityAt);
    h.deps.db.prepare('INSERT INTO seating_tables (table_id, seating_id, joined_at) VALUES (?, ?, ?)').run(tableId, seatingId, lastActivityAt);
    h.deps.db
      .prepare(
        `INSERT INTO table_locks (table_id, seating_id, staff_id, device_id, locked_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(tableId, seatingId, staffId, deviceId, lastActivityAt, lastActivityAt);
    return seatingId;
  }
  const due = (): boolean => tableLocksTick.due(readOnlyDb(h.deps.db), h.deps.state.get(), h.clock.branchNow());
  /** One tick pass as the loop runs it: `due`, then (only if due) its own writer.run with the intents appended. */
  function pass(): void {
    const now = h.clock.branchNow();
    if (!tableLocksTick.due(readOnlyDb(h.deps.db), h.deps.state.get(), now)) return;
    h.deps.writer.run((tx) => tx.append(tableLocksTick.intents(tx, h.deps.state.get(), now)));
  }
  function released(): Released[] {
    return (
      h.deps.db
        .prepare(
          `SELECT stream_type, stream_id, actor_id, device_id, occurred_at, payload FROM events WHERE event_type = 'TableLockReleased' ORDER BY seq`,
        )
        .all() as Array<Omit<Released, 'payload'> & { payload: string }>
    ).map((r) => ({ ...r, payload: JSON.parse(r.payload) as Record<string, unknown> }));
  }

  it('[02a §3.4] registered by registerTables once, guarded (a second test hub does not throw)', async () => {
    expect(registeredTicks().filter((t) => t.name === 'table_locks')).toEqual([tableLocksTick]);
    const second = await createTestHub();
    await second.close();
    expect(registeredTicks().filter((t) => t.name === 'table_locks')).toHaveLength(1);
  });

  it('[02a #8] TTL passed → TableLockReleased { lock_ttl } on the primary table stream; actor_id null, device_id hub', () => {
    const dev = device();
    signIn(dev);
    const seatingId = seedLock('T-1', WAITER, dev);
    h.clock.advance(TTL + 1);
    expect(due()).toBe(true);
    pass();
    expect(released()).toEqual([
      {
        stream_type: 'table',
        stream_id: 'T-1',
        actor_id: null,
        device_id: 'hub',
        occurred_at: h.clock.branchNow(),
        payload: { table_id: 'T-1', seating_id: seatingId, staff_id: WAITER, reason: 'lock_ttl' },
      },
    ]);
  });

  it('[02a #8] session ended → session_expired (checked before the TTL)', () => {
    const dev = device();
    const session = signIn(dev);
    seedLock('T-1', WAITER, dev);
    endSessionNow(h, session, 'logout');
    expect(due()).toBe(true);
    pass();
    const out = released();
    expect(out.map((e) => e.payload.reason)).toEqual(['session_expired']);
    expect(out[0]).toMatchObject({ actor_id: null, device_id: 'hub' });
  });

  it('[02a #8] session ended and TTL also passed → still session_expired (the session check wins)', () => {
    const dev = device();
    const session = signIn(dev);
    seedLock('T-1', WAITER, dev);
    endSessionNow(h, session, 'logout');
    h.clock.advance(TTL + 1);
    pass();
    expect(released().map((e) => e.payload.reason)).toEqual(['session_expired']);
  });

  it('[02a #8] a released lock is folded away: due() is false and the next pass appends nothing', () => {
    const dev = device();
    signIn(dev);
    seedLock('T-1', WAITER, dev);
    h.clock.advance(TTL + 1);
    expect(due()).toBe(true);
    pass();
    expect(released()).toHaveLength(1);
    expect(h.deps.db.prepare('SELECT COUNT(*) AS n FROM table_locks').get()).toEqual({ n: 0 });
    expect(due()).toBe(false);
    pass();
    expect(released()).toHaveLength(1);
  });

  it('[02a #8] at exactly ttl neither due nor a write; one ms later due', () => {
    const dev = device();
    signIn(dev);
    seedLock('T-1', WAITER, dev);
    h.clock.advance(TTL);
    expect(due()).toBe(false);
    const run = vi.spyOn(h.deps.writer, 'run');
    pass();
    expect(run).not.toHaveBeenCalled();
    // intents inside a transaction at exactly ttl: the same `>` → nothing
    run.mockRestore();
    const drafts = h.deps.writer.run((tx) => tableLocksTick.intents(tx, h.deps.state.get(), h.clock.branchNow())).result;
    expect(drafts).toEqual([]);
    expect(released()).toEqual([]);
    h.clock.advance(1);
    expect(due()).toBe(true);
  });

  function setSessionStart(sessionId: string, startedAt: number): void {
    h.deps.db.prepare('UPDATE staff_sessions SET started_at = ? WHERE session_id = ?').run(startedAt, sessionId);
  }

  it('[02a #8] v1.1.2 boundary: session started_at = lock last_activity_at → kept', () => {
    const dev = device();
    const session = signIn(dev);
    const at = h.clock.branchNow();
    setSessionStart(session, at);
    seedLock('T-1', WAITER, dev, at); // started_at === last_activity_at, clock well inside the TTL
    expect(due()).toBe(false);
    const run = vi.spyOn(h.deps.writer, 'run');
    pass();
    expect(run).not.toHaveBeenCalled();
    run.mockRestore();
    expect(released()).toEqual([]);
    expect(h.deps.db.prepare('SELECT COUNT(*) AS n FROM table_locks').get()).toEqual({ n: 1 });
  });

  it('[02a #8] v1.1.2 boundary: session started 1 ms before last_activity_at → kept', () => {
    const dev = device();
    const session = signIn(dev);
    const at = h.clock.branchNow();
    setSessionStart(session, at - 1);
    seedLock('T-1', WAITER, dev, at); // started_at < last_activity_at, clock inside the TTL
    expect(due()).toBe(false);
    const run = vi.spyOn(h.deps.writer, 'run');
    pass();
    expect(run).not.toHaveBeenCalled();
    run.mockRestore();
    expect(released()).toEqual([]);
  });

  it('[02a #8] v1.1.2 boundary: session started 1 ms after last_activity_at → session_expired', () => {
    const dev = device();
    const session = signIn(dev);
    const at = h.clock.branchNow();
    setSessionStart(session, at);
    seedLock('T-1', WAITER, dev, at - 1); // session started 1 ms after the lock's last activity, TTL not elapsed
    expect(due()).toBe(true);
    pass();
    expect(released().map((e) => e.payload.reason)).toEqual(['session_expired']);
  });

  it('[02a #8] idle → one statement, no writer.run (through the tick loop)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const dev = device();
      signIn(dev);
      seedLock('T-1', WAITER, dev);
      const counter = statementCounter(h.deps.db);
      expect(due()).toBe(false);
      expect(counter.count).toBe(1);
      // the loop: only table_locks and the alerts tick are registered; no dirty alert flag
      for (const name of ['pass_closures', 'ready_retarget', 'served_estimate']) unregisterTick(name); // 03b §6.18–6.19 (b16), 02b §6.11 (0e): lane B5 adds these to every test hub too
      h.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();
      const run = vi.spyOn(h.deps.writer, 'run');
      const log = { error: vi.fn() };
      const stop = startTickLoop(h.deps, log);
      counter.reset();
      await vi.advanceTimersByTimeAsync(TICK_MS);
      stop();
      expect(registeredTicks().map((t) => t.name)).toContain('table_locks');
      expect(counter.count).toBe(registeredTicks().length); // one statement per registered tick (alerts + table_locks)
      expect(run).not.toHaveBeenCalled();
      expect(log.error).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('[02a #8] a pass with work = 1 read + 1 append; due = 1 statement', () => {
    const devA = device();
    const devB = device();
    signIn(devA);
    const sessionB = signIn(devB, 'S_CASH');
    seedLock('T-1', WAITER, devA);
    seedLock('T-2', 'S_CASH', devB);
    endSessionNow(h, sessionB);
    h.clock.advance(TTL + 1);
    const counter = statementCounter(h.deps.db);
    expect(due()).toBe(true);
    expect(counter.count).toBe(1);
    counter.reset();
    let inside = -1;
    const now = h.clock.branchNow();
    h.deps.writer.run((tx) => {
      const before = counter.count;
      const drafts = tableLocksTick.intents(tx, h.deps.state.get(), now);
      inside = counter.count - before;
      tx.append(drafts);
    });
    expect(inside).toBe(1); // the one read; the append is one tx.append call
    expect(
      released()
        .map((e) => [e.stream_id, e.payload.reason])
        .sort(),
    ).toEqual([
      ['T-1', 'lock_ttl'],
      ['T-2', 'session_expired'],
    ]);
  });

  it('[02a #8] EXPLAIN QUERY PLAN: the inner live-session lookup uses staff_sessions_active_device (due and intents); due is the v1.1.2 §3.4 text', () => {
    expect(TABLE_LOCKS_DUE_SQL).toBe(tableLocksDueSql());
    for (const sql of [TABLE_LOCKS_DUE_SQL, TABLE_LOCKS_RELEASE_SQL]) {
      const plan = h.deps.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all({ now: 0, ttl: TTL }) as Array<{ detail: string }>;
      const detail = plan.map((r) => r.detail).join('\n');
      expect(detail).not.toMatch(/SCAN s\b/);
      expect(detail).toMatch(/SEARCH s USING (COVERING )?INDEX staff_sessions_active_device \(device_id=\?\)/);
    }
  });

  it('[02a §3.4] a new sign-in by the same staff on the same device does not keep the lock → session_expired', () => {
    const dev = device();
    const old = signIn(dev);
    seedLock('T-1', WAITER, dev);
    h.clock.advance(1_000);
    // the shape of staff-session.ts re-sign-in: the old session ends 'replaced', a new one starts after the lock's activity
    endSessionNow(h, old, 'replaced');
    signIn(dev);
    expect(due()).toBe(true);
    pass();
    expect(released().map((e) => e.payload.reason)).toEqual(['session_expired']);
  });

  it('[02a §3.4] T15 lock moved to the same staff’s other device (activity at/after that session start) is kept', () => {
    const devA = device();
    const devB = device();
    signIn(devA);
    h.clock.advance(1_000);
    signIn(devB);
    // TableLocked { replaced_device_id } moved the lock to devB at this time (= devB's session start)
    seedLock('T-1', WAITER, devB);
    expect(due()).toBe(false);
    h.clock.advance(1_000);
    expect(due()).toBe(false);
    const run = vi.spyOn(h.deps.writer, 'run');
    pass();
    expect(run).not.toHaveBeenCalled();
    expect(released()).toEqual([]);
  });

  it('[02a §3.4] no branch config → ttl bound NULL: only session_expired releases, no lock_ttl', () => {
    swapBranchConfig(null);
    const devA = device();
    const devB = device();
    signIn(devA);
    const sessionB = signIn(devB, 'S_CASH');
    seedLock('T-1', WAITER, devA);
    seedLock('T-2', 'S_CASH', devB);
    h.clock.advance(TTL * 10);
    expect(due()).toBe(false);
    endSessionNow(h, sessionB);
    expect(due()).toBe(true);
    pass();
    expect(released().map((e) => [e.stream_id, e.payload.reason])).toEqual([['T-2', 'session_expired']]);
  });
});

// [02a v1.1.2 §3.4] the `due` statement, verbatim.
function tableLocksDueSql(): string {
  return `SELECT 1 FROM table_locks l WHERE NOT EXISTS (SELECT 1 FROM staff_sessions s WHERE s.device_id = l.device_id AND s.staff_id = l.staff_id AND s.kind IN ('staff','station') AND s.ended_at IS NULL AND s.started_at <= l.last_activity_at) OR :now - l.last_activity_at > :ttl LIMIT 1`;
}
