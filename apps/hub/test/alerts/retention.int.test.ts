import type { EventDraft, PosEvent } from '@pos/events';
import { aBusinessDayClosed, aBusinessDayOpened } from '@pos/events/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALERT_RETENTION_BATCH, CLOSED_ALERTS_KEPT_MS, purgeAlerts } from '../../src/alerts/retention';
import { receiptBufferFor } from '../../src/alerts/receipts';
import { retentionOnce, setMaintenanceHour, startSweeper } from '../../src/auth/session-sweeper';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, type TestHub } from '../helpers/test-hub';

// 01d task 38: retention of the alert projection rows (§5.1, 00 M66, H-8). In the maintenance hour, after 00's
// own purge, in batches of 500, one writer.run per batch, no event written:
//   1. alert_inbox, alert_receipts, request_seen rows of alerts closed before the previous business day;
//   2. closed alerts rows older than 7 days, oldest first: receipts and seen of those ids, then the alerts rows
//      (alert_recipients and any remaining alert_inbox go by ON DELETE CASCADE, foreign_keys = ON).
// Open alerts and their rows are untouched (a personal notice open for 10 days stays, §3.10). AD-88: the receipt
// buffer's recorded and sentVia sets drop an alert's keys on commit of the batch that deletes its rows.

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const BRANCH = 'branch-1';
const STAFF = 'S_CASH';
const DEVICE = 'D_TAB';

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function open(): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  return hub;
}

interface Seed {
  id: string;
  kind?: string;
  state: 'open' | 'closed';
  raised_at: number;
  closed_at?: number;
  /** recipients, inbox, receipts and seen rows (default true) */
  rows?: boolean;
}

/** Raw rows as the projections write them (§5.1); one transaction for the whole seed. */
function seed(hub: TestHub, alerts: Seed[]): void {
  const db = hub.deps.db;
  const alert = db.prepare(
    `INSERT INTO alerts (alert_id, kind, family, subject_stream_type, subject_stream_id, dedupe_key, requester_staff_id,
       raised_device_id, raised_seq, target_json, values_json, display_json, step, state, close_reason, raised_at, closed_at)
     VALUES (@id, @kind, 'info', 'hub', '${BRANCH}', @id, NULL, 'hub', 1, '{"kind":"person"}', '{}', '{}', 0,
       @state, @reason, @raised_at, @closed_at)`,
  );
  const recipient = db.prepare(
    `INSERT INTO alert_recipients (alert_id, staff_id, device_id, for_staff_id, recipient_set, step)
     VALUES (?, ?, NULL, NULL, 'recipient', 0), (?, NULL, ?, NULL, 'recipient', 0)`,
  );
  const inbox = db.prepare(`INSERT INTO alert_inbox (staff_id, alert_id, first_at, moved_to) VALUES (?, ?, ?, NULL)`);
  const receipt = db.prepare(
    `INSERT INTO alert_receipts (alert_id, staff_id, device_id, kind, step, at) VALUES (?, ?, ?, 'delivered', 0, ?)`,
  );
  const seen = db.prepare(`INSERT INTO request_seen (alert_id, staff_id, at) VALUES (?, ?, ?)`);
  db.transaction(() => {
    for (const a of alerts) {
      alert.run({
        id: a.id,
        kind: a.kind ?? 't_info',
        state: a.state,
        reason: a.state === 'closed' ? 'done' : null,
        raised_at: a.raised_at,
        closed_at: a.state === 'closed' ? (a.closed_at ?? a.raised_at) : null,
      });
      if (a.rows === false) continue;
      recipient.run(a.id, STAFF, a.id, DEVICE);
      inbox.run(STAFF, a.id, a.raised_at);
      receipt.run(a.id, STAFF, DEVICE, a.raised_at);
      seen.run(a.id, STAFF, a.raised_at);
    }
  })();
}

function count(hub: TestHub, table: string, alertId?: string): number {
  const where = alertId === undefined ? '' : ' WHERE alert_id = ?';
  const args = alertId === undefined ? [] : [alertId];
  return (hub.deps.db.prepare(`SELECT COUNT(*) AS n FROM ${table}${where}`).get(...args) as { n: number }).n;
}

function rowsOf(hub: TestHub, alertId: string): Record<string, number> {
  return {
    alerts: count(hub, 'alerts', alertId),
    alert_recipients: count(hub, 'alert_recipients', alertId),
    alert_inbox: count(hub, 'alert_inbox', alertId),
    alert_receipts: count(hub, 'alert_receipts', alertId),
    request_seen: count(hub, 'request_seen', alertId),
  };
}

const ALL = { alerts: 1, alert_recipients: 2, alert_inbox: 1, alert_receipts: 1, request_seen: 1 };
const NONE = { alerts: 0, alert_recipients: 0, alert_inbox: 0, alert_receipts: 0, request_seen: 0 };
const STEP_1_DONE = { alerts: 1, alert_recipients: 2, alert_inbox: 0, alert_receipts: 0, request_seen: 0 };

function eventCount(hub: TestHub): number {
  return count(hub, 'events');
}

function draftOf(e: PosEvent, now: number): EventDraft {
  return {
    stream_type: e.stream_type,
    stream_id: BRANCH,
    event_type: e.event_type,
    schema_version: e.schema_version,
    payload: e.payload,
    occurred_at: now,
    actor_id: e.actor_id,
    device_id: e.device_id,
  };
}

function dayEvent(hub: TestHub, e: PosEvent): void {
  hub.deps.writer.run((tx) => tx.append([draftOf(e, hub.clock.branchNow())]));
}

const id = (prefix: string, n: number): string => `${prefix}${String(n).padStart(5, '0')}`;

describe('alert retention (§5.1)', () => {
  it('[01d #38] 1 200 closed alerts older than 7 days with recipients, inbox, receipts and seen rows are deleted in 3 batches of ≤ 500 with foreign keys on, oldest first; open and newer alerts untouched; no event', async () => {
    const hub = await open();
    expect(hub.deps.db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(ALERT_RETENTION_BATCH).toBe(500);
    expect(CLOSED_ALERTS_KEPT_MS).toBe(7 * DAY_MS);
    const now = hub.clock.branchNow();
    const old: Seed[] = [];
    for (let n = 0; n < 1_200; n += 1) old.push({ id: id('old', n), state: 'closed', raised_at: now - 9 * DAY_MS, closed_at: now - 8 * DAY_MS + n });
    seed(hub, [
      ...old,
      { id: 'boundary', state: 'closed', raised_at: now - 8 * DAY_MS, closed_at: now - CLOSED_ALERTS_KEPT_MS },
      { id: 'recent', state: 'closed', raised_at: now - 3 * DAY_MS, closed_at: now - 2 * DAY_MS },
      { id: 'open-old', state: 'open', raised_at: now - 30 * DAY_MS },
      { id: 'notice-10d', kind: 'pin_use_failed', state: 'open', raised_at: now - 10 * DAY_MS },
    ]);
    const events = eventCount(hub);
    const published = hub.published.length;

    const remaining: number[] = [];
    let oldestFirst = true;
    hub.deps.writer.addAfterCommit(() => {
      const left = count(hub, 'alerts') - 4;
      remaining.push(left);
      // the batch that just committed took the 500 oldest of what was left
      const survivors = hub.deps.db.prepare(`SELECT alert_id FROM alerts WHERE alert_id LIKE 'old%' ORDER BY closed_at LIMIT 1`).get() as
        | { alert_id: string }
        | undefined;
      if (survivors !== undefined && survivors.alert_id !== id('old', 1_200 - left)) oldestFirst = false;
    });
    const run = vi.spyOn(hub.deps.writer, 'run');
    const deleted = purgeAlerts(hub.deps, BRANCH, now);

    expect(run).toHaveBeenCalledTimes(3);
    expect(remaining).toEqual([700, 200, 0]);
    expect(oldestFirst).toBe(true);
    // direct deletes: 1 200 alerts + 1 200 receipts + 1 200 seen (recipients and inbox by cascade)
    expect(deleted).toBe(3 * 1_200);
    expect(rowsOf(hub, id('old', 0))).toEqual(NONE);
    expect(rowsOf(hub, id('old', 1_199))).toEqual(NONE);
    expect(count(hub, 'alert_recipients')).toBe(4 * 2);
    expect(count(hub, 'alert_inbox')).toBe(4);
    expect(rowsOf(hub, 'boundary')).toEqual(ALL);
    // no business day has closed yet: step 1 has no "previous business day" and deletes nothing
    expect(rowsOf(hub, 'recent')).toEqual(ALL);
    expect(rowsOf(hub, 'open-old')).toEqual(ALL);
    expect(rowsOf(hub, 'notice-10d')).toEqual(ALL);
    expect(eventCount(hub)).toBe(events);
    expect(hub.published.length).toBe(published);
    expect(hub.deps.db.pragma('foreign_key_check')).toEqual([]);
  });

  it('[01d §5.1; AD-161] a step-2 batch of 500 alerts stays fast with 105 000 inbox rows (alert_inbox_alert serves the cascade)', async () => {
    const hub = await open();
    const now = hub.clock.branchNow();
    const db = hub.deps.db;
    const expired: Seed[] = [];
    for (let n = 0; n < ALERT_RETENTION_BATCH; n += 1)
      expired.push({ id: id('old', n), state: 'closed', raised_at: now - 9 * DAY_MS, closed_at: now - 8 * DAY_MS, rows: false });
    seed(hub, expired);
    // 21 000 open alerts with 5 inbox rows each: the cascade must not scan these once per deleted alert
    const live: Seed[] = [];
    for (let n = 0; n < 21_000; n += 1) live.push({ id: id('live', n), state: 'open', raised_at: now - HOUR_MS, rows: false });
    seed(hub, live);
    const inbox = db.prepare(`INSERT INTO alert_inbox (staff_id, alert_id, first_at) VALUES (?, ?, ?)`);
    db.transaction(() => {
      for (let n = 0; n < 21_000; n += 1) for (let s = 0; s < 5; s += 1) inbox.run(`S${s}`, id('live', n), now);
    })();
    expect(count(hub, 'alert_inbox')).toBe(105_000);
    const run = vi.spyOn(hub.deps.writer, 'run');
    const started = performance.now();
    expect(purgeAlerts(hub.deps, BRANCH, now)).toBe(ALERT_RETENTION_BATCH);
    const ms = performance.now() - started;
    expect(run).toHaveBeenCalledTimes(1);
    expect(count(hub, 'alert_inbox')).toBe(105_000);
    // generous bound: about 5 s without the index, a few ms with it
    expect(ms).toBeLessThan(1_000);
  });

  it('[01d §5.1] statements: 1 day read, then per batch 1 probe + 4 in the writer; nothing to delete opens no transaction', async () => {
    const hub = await open();
    const now = hub.clock.branchNow();
    const old: Seed[] = [];
    for (let n = 0; n < 1_200; n += 1) old.push({ id: id('old', n), state: 'closed', raised_at: now - 9 * DAY_MS, closed_at: now - 8 * DAY_MS });
    seed(hub, old);
    const counter = statementCounter(hub.deps.db);
    purgeAlerts(hub.deps, BRANCH, now);
    expect(counter.count).toBe(1 + 3 * (1 + 4) + 1);

    counter.reset();
    const run = vi.spyOn(hub.deps.writer, 'run');
    expect(purgeAlerts(hub.deps, BRANCH, now)).toBe(0);
    expect(run).not.toHaveBeenCalled();
    expect(counter.count).toBe(1 + 1);
  });

  it('[01d §5.1] step 1 deletes inbox, receipts and seen rows only of alerts closed before the previous business day; the alert and its recipients stay', async () => {
    const hub = await open();
    const t0 = hub.clock.branchNow();
    dayEvent(hub, aBusinessDayOpened()); // day A
    hub.clock.advance(10 * HOUR_MS);
    dayEvent(hub, aBusinessDayClosed());
    hub.clock.advance(14 * HOUR_MS);
    const dayB = hub.clock.branchNow();
    dayEvent(hub, aBusinessDayOpened()); // day B, the previous business day once C opens
    hub.clock.advance(10 * HOUR_MS);
    dayEvent(hub, aBusinessDayClosed());
    hub.clock.advance(14 * HOUR_MS);
    const dayC = hub.clock.branchNow();
    dayEvent(hub, aBusinessDayOpened()); // day C, open
    hub.clock.advance(HOUR_MS);

    seed(hub, [
      { id: 'in-A', state: 'closed', raised_at: t0 + HOUR_MS, closed_at: t0 + 5 * HOUR_MS },
      { id: 'edge-B', state: 'closed', raised_at: t0 + HOUR_MS, closed_at: dayB },
      { id: 'in-B', state: 'closed', raised_at: dayB + HOUR_MS, closed_at: dayB + 5 * HOUR_MS },
      { id: 'in-C', state: 'closed', raised_at: dayC, closed_at: dayC + 10 },
      { id: 'open-A', state: 'open', raised_at: t0 + HOUR_MS },
      { id: 'notice-A', kind: 'pin_use_failed', state: 'open', raised_at: t0 + 2 * HOUR_MS },
    ]);
    const events = eventCount(hub);
    const run = vi.spyOn(hub.deps.writer, 'run');
    expect(purgeAlerts(hub.deps, BRANCH, hub.clock.branchNow())).toBe(3);
    expect(run).toHaveBeenCalledTimes(3); // one batch per table
    expect(rowsOf(hub, 'in-A')).toEqual(STEP_1_DONE);
    expect(rowsOf(hub, 'edge-B')).toEqual(ALL);
    expect(rowsOf(hub, 'in-B')).toEqual(ALL);
    expect(rowsOf(hub, 'in-C')).toEqual(ALL);
    expect(rowsOf(hub, 'open-A')).toEqual(ALL);
    expect(rowsOf(hub, 'notice-A')).toEqual(ALL);
    expect(eventCount(hub)).toBe(events);

    // day C closes: C is now the previous business day, so B's rows go; nothing open is touched
    hub.clock.advance(9 * HOUR_MS);
    dayEvent(hub, aBusinessDayClosed());
    hub.clock.advance(6 * HOUR_MS);
    run.mockClear();
    expect(purgeAlerts(hub.deps, BRANCH, hub.clock.branchNow())).toBe(6);
    expect(run).toHaveBeenCalledTimes(3);
    expect(rowsOf(hub, 'edge-B')).toEqual(STEP_1_DONE);
    expect(rowsOf(hub, 'in-B')).toEqual(STEP_1_DONE);
    expect(rowsOf(hub, 'in-C')).toEqual(ALL);
    expect(rowsOf(hub, 'open-A')).toEqual(ALL);
    expect(rowsOf(hub, 'notice-A')).toEqual(ALL);
  });

  it('[01d §5.1] step 1 runs in batches of 500 rows per table', async () => {
    const hub = await open();
    dayEvent(hub, aBusinessDayOpened());
    const t0 = hub.clock.branchNow();
    hub.clock.advance(10 * HOUR_MS);
    dayEvent(hub, aBusinessDayClosed());
    hub.clock.advance(14 * HOUR_MS);
    dayEvent(hub, aBusinessDayOpened());
    hub.clock.advance(10 * HOUR_MS);
    dayEvent(hub, aBusinessDayClosed());
    hub.clock.advance(HOUR_MS);
    const day0: Seed[] = [];
    for (let n = 0; n < 600; n += 1) day0.push({ id: id('a', n), state: 'closed', raised_at: t0, closed_at: t0 + HOUR_MS });
    seed(hub, day0);
    const run = vi.spyOn(hub.deps.writer, 'run');
    expect(purgeAlerts(hub.deps, BRANCH, hub.clock.branchNow())).toBe(3 * 600);
    expect(run).toHaveBeenCalledTimes(3 * 2);
    expect(count(hub, 'alert_inbox')).toBe(0);
    expect(count(hub, 'alert_receipts')).toBe(0);
    expect(count(hub, 'request_seen')).toBe(0);
    expect(count(hub, 'alerts')).toBe(600);
    expect(count(hub, 'alert_recipients')).toBe(1_200);
  });

  it('[01d §5.1] the sweeper runs the alert batches after 00\'s own purge, in the maintenance hour', async () => {
    const hub = await open();
    const now = hub.clock.branchNow();
    hub.deps.db
      .prepare(
        `INSERT INTO processed_commands (command_id, branch_id, device_id, session_id, command_type, payload_hash, response_json, recorded_at)
         VALUES ('old-cmd', '${BRANCH}', 'dev', NULL, 'TestNoop', 'hash', '{}', ?)`,
      )
      .run(now - 8 * DAY_MS);
    seed(hub, [{ id: 'old', state: 'closed', raised_at: now - 9 * DAY_MS, closed_at: now - 8 * DAY_MS }]);
    const order: string[] = [];
    hub.deps.writer.addAfterCommit(() => {
      order.push(count(hub, 'processed_commands') === 0 && count(hub, 'alerts') === 1 ? '00' : count(hub, 'alerts') === 0 ? '01d' : '?');
    });
    setMaintenanceHour(new Date(now).getHours());
    expect(retentionOnce(hub.deps, now).deleted).toBe(1 + 3);
    expect(order).toEqual(['00', '01d']);
    expect(rowsOf(hub, 'old')).toEqual(NONE);
  });

  it('[01d #38] a batch error rolls that batch back, is caught and logged { timer: sweeper } and the next run deletes it', async () => {
    const hub = await open();
    const now = hub.clock.branchNow();
    seed(hub, [{ id: 'old', state: 'closed', raised_at: now - 9 * DAY_MS, closed_at: now - 8 * DAY_MS }]);
    hub.deps.db.exec(`CREATE TEMP TRIGGER boom BEFORE DELETE ON alerts BEGIN SELECT RAISE(ABORT, 'retention boom'); END`);
    setMaintenanceHour(new Date(now).getHours());
    const errors: Array<Record<string, unknown>> = [];
    vi.useFakeTimers();
    const stop = startSweeper(hub.deps, {
      error(obj) {
        errors.push(obj);
      },
    });
    cleanups.push(stop);
    vi.advanceTimersByTime(15_000);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ timer: 'sweeper' });
    expect(String((errors[0]?.err as Error).message)).toContain('retention boom');
    // rolled back: the receipts and seen rows deleted earlier in that batch are back
    expect(rowsOf(hub, 'old')).toEqual(ALL);

    hub.deps.db.exec('DROP TRIGGER boom');
    vi.advanceTimersByTime(15_000);
    expect(errors).toHaveLength(1);
    expect(rowsOf(hub, 'old')).toEqual(NONE);
  });

  it('[01d §5.1] AD-88: the receipt buffer drops an alert\'s recorded and sentVia keys on commit of the batch that deletes its rows', async () => {
    const hub = await open();
    const t0 = hub.clock.branchNow();
    dayEvent(hub, aBusinessDayOpened());
    hub.clock.advance(10 * HOUR_MS);
    dayEvent(hub, aBusinessDayClosed());
    hub.clock.advance(14 * HOUR_MS);
    dayEvent(hub, aBusinessDayOpened());
    hub.clock.advance(HOUR_MS);
    const now = hub.clock.branchNow();
    seed(hub, [
      { id: 'expired-row', state: 'closed', raised_at: now - 9 * DAY_MS, closed_at: now - 8 * DAY_MS, rows: false },
      // closed before day A (the previous business day) opened at t0: step 1 deletes its receipts
      { id: 'day-old', state: 'closed', raised_at: t0 - 2 * DAY_MS, closed_at: t0 - DAY_MS, rows: false },
      { id: 'still-open', state: 'open', raised_at: t0, rows: false },
    ]);
    const buffer = receiptBufferFor(hub.app);
    const seenBy = (alertId: string) => ({ alert_id: alertId, staff_id: STAFF, device_id: DEVICE, kind: 'seen' as const });
    for (const a of ['expired-row', 'day-old', 'still-open']) {
      buffer.record(seenBy(a));
      buffer.recordSent(DEVICE, a);
    }
    buffer.flush(); // AlertSeen events → alert_receipts rows; keys now recorded
    expect(count(hub, 'alert_receipts')).toBe(3);
    expect(buffer.tracked()).toBe(3);
    for (const a of ['expired-row', 'day-old', 'still-open']) buffer.record(seenBy(a));
    expect(buffer.size()).toBe(0); // deduped by the recorded set

    // a rolled-back batch keeps the keys
    hub.deps.db.exec(`CREATE TEMP TRIGGER boom BEFORE DELETE ON alert_receipts BEGIN SELECT RAISE(ABORT, 'retention boom'); END`);
    expect(() => purgeAlerts(hub.deps, BRANCH, now)).toThrow('retention boom');
    hub.deps.db.exec('DROP TRIGGER boom');
    expect(buffer.tracked()).toBe(3);
    expect(count(hub, 'alert_receipts')).toBe(3);

    const events = eventCount(hub);
    purgeAlerts(hub.deps, BRANCH, now);
    expect(eventCount(hub)).toBe(events);
    expect(buffer.tracked()).toBe(1); // only the open alert is left
    expect(count(hub, 'alerts', 'expired-row')).toBe(0);
    for (const a of ['expired-row', 'day-old', 'still-open']) buffer.record(seenBy(a));
    expect(buffer.size()).toBe(2); // expired-row and day-old are accepted again; still-open stays deduped
    buffer.flush();
    // AD-88: the closed day-old alert's receipt becomes an event again; the deleted alert's does not
    expect(eventCount(hub)).toBe(events + 1);
  });
});
