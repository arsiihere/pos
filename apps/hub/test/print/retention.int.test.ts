import type { EngineState } from '@pos/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readOnlyDb } from '../../src/engine-host/read-only-tx';
import { stationPresence } from '../../src/kds/contracts';
import { kdsPresenceTick } from '../../src/kds/presence';
import { retentionOnce, setMaintenanceHour } from '../../src/auth/session-sweeper';
import { PRINT_RETENTION_MS, purgePrint } from '../../src/print/retention';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { FX, appendOrder, append as kdsAppend, fireLines, openDay, pairKds } from '../kds/fixtures';

// 03c §5 "Retention at 00's maintenance hour" (task c22; G-8: called from the sweeper's purge()): acked / cancelled
// jobs, tickets, ticket lines and resolved skips older than 7 days are deleted, ticket-wise; live rows are kept, and
// so is everything of a station in its current dark outage; unalerted skips go after 30 days (review follow-ups). Tickets and jobs come
// from real fires at a `both` station; their ack / cancel times are then set by hand (the worker is c14's).

const DAY = 86_400_000;
let hub: TestHub;
beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
  openDay(hub);
  const branch = hub.deps.config.provisioned!.branch_id;
  kdsAppend(
    hub,
    [
      { stream_type: 'hub', stream_id: branch, event_type: 'PrinterSaved', payload: { printer_id: 'PR1', name: 'PR1', connection: 'lan', address: '192.168.1.50:9100', paper_width_mm: 80, archived: false } },
      { stream_type: 'hub', stream_id: branch, event_type: 'StationOutputSet', payload: { station_id: FX.station, mode: 'both', printer_id: 'PR1', show_taker: true, show_order_id: true } },
    ],
    { actor: null },
  );
});
afterEach(async () => {
  swapBranchConfig(null);
  await hub.close();
});

const db = () => hub.deps.db;
function fired(id: string): string {
  appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: id, item_id: FX.naan, quantity: 1 }] });
  fireLines(hub, FX.station, [id]);
  return db().prepare('SELECT ticket_id FROM ticket_lines WHERE order_item_id = ?').pluck().get(id) as string;
}
const set = (sql: string, ...args: unknown[]): void => {
  db().prepare(sql).run(...args);
};
const ids = (table: string, col: string): string[] => db().prepare(`SELECT ${col} FROM ${table} ORDER BY ${col}`).pluck().all() as string[];

describe('[03c §5] print retention (c22)', () => {
  it('[03c §5] old acked / cancelled jobs, their tickets, ticket lines and resolved skips go; live rows stay', () => {
    const now = hub.clock.branchNow() + 8 * DAY;
    const old = now - PRINT_RETENTION_MS - 1;
    const recent = now - DAY;
    expect(PRINT_RETENTION_MS).toBe(7 * DAY);
    const acked = fired('A1'); // old, acked → job, ticket, line go
    const cancelled = fired('B1'); // old, cancelled → go
    const pending = fired('C1'); // old ticket, job still pending → all kept
    const reprinted = fired('D1'); // old ticket, a recent acked reprint → the whole ticket (both jobs) kept
    const suspect = fired('E1'); // old acked, suspect not resolved → kept
    const resolved = fired('F1'); // old acked, suspect resolved → go
    set('UPDATE tickets SET fired_at = ?', old);
    set(`UPDATE print_jobs SET sent_at = ?, acked_at = ? WHERE ticket_id IN (?, ?, ?, ?)`, old, old, acked, reprinted, suspect, resolved);
    set('UPDATE print_jobs SET cancelled_at = ? WHERE ticket_id = ?', old, cancelled);
    set(`INSERT INTO print_jobs (job_id, kind, station_id, ticket_id, payload, created_at, sent_at, acked_at) VALUES ('RP', 'reprint', ?, ?, '{}', ?, ?, ?)`, FX.station, reprinted, recent, recent, recent);
    set('UPDATE print_jobs SET suspect_at = ? WHERE ticket_id IN (?, ?)', old, suspect, resolved);
    set('UPDATE print_jobs SET suspect_resolved_at = ? WHERE ticket_id = ?', old, resolved);
    set(`INSERT INTO print_jobs (job_id, kind, printer_id, payload, created_at, acked_at) VALUES ('DOC_NEW', 'document', 'PR1', '{}', ?, ?)`, recent, recent);
    set(`INSERT INTO print_jobs (job_id, kind, printer_id, payload, created_at, cancelled_at) VALUES ('DOC_OLD', 'document', 'PR1', '{}', ?, ?)`, old, old);
    const skip = db().prepare('INSERT INTO print_fold_skips (event_id, station_id, order_ids, reason, at, alerted_at) VALUES (?, ?, ?, ?, ?, ?)');
    skip.run('SK_OLD_DONE', FX.station, '[]', 'line_missing', old, old);
    skip.run('SK_OLD_OPEN', FX.station, '[]', 'line_missing', old, null);
    skip.run('SK_ANCIENT_OPEN', FX.station, '[]', 'line_missing', now - 31 * DAY, null); // unalerted, > 30 days
    skip.run('SK_NEW_DONE', FX.station, '[]', 'line_missing', recent, recent);

    const deleted = purgePrint({ db: db(), writer: hub.deps.writer }, hub.deps.config.provisioned!.branch_id, now);

    // ticket-wise: a ticket goes with all its jobs, or nothing of it goes
    expect(ids('print_jobs', 'job_id')).toEqual(['DOC_NEW', 'RP', `${pending}:kitchen`, `${reprinted}:kitchen`, `${suspect}:kitchen`].sort());
    expect(ids('tickets', 'ticket_id')).toEqual([pending, reprinted, suspect].sort());
    expect(ids('ticket_lines', 'order_item_id')).toEqual(['C1', 'D1', 'E1']);
    expect(ids('print_fold_skips', 'event_id')).toEqual(['SK_NEW_DONE', 'SK_OLD_OPEN']);
    // jobs A, B, F, DOC_OLD = 4; tickets A, B, F = 3; their lines 3; skips SK_OLD_DONE, SK_ANCIENT_OPEN = 2
    expect(deleted).toBe(4 + 3 + 3 + 2);
    expect(purgePrint({ db: db(), writer: hub.deps.writer }, 'any', now)).toBe(0);
  });

  it('[03c §5, §3.4] a station in its current dark outage keeps its tickets and station jobs (no second COMING UP mid-outage)', () => {
    pairKds(hub, { stationId: FX.station }); // S1 has a screen, never connected
    const old = fired('A1');
    fired('B1');
    const now = hub.clock.branchNow() + 8 * DAY;
    set('UPDATE tickets SET fired_at = 1 WHERE ticket_id = ?', old);
    set('UPDATE print_jobs SET sent_at = 1, acked_at = 1 WHERE ticket_id = ?', old);
    set(`INSERT INTO print_jobs (job_id, kind, station_id, payload, created_at, sent_at, acked_at) VALUES ('S1:coming_up:1', 'coming_up', ?, '{}', 1, 1, 1)`, FX.station);
    const t = hub.clock.branchNow();
    kdsPresenceTick.due(readOnlyDb(db()), hub.deps.state.get() as EngineState, t);
    kdsPresenceTick.due(readOnlyDb(db()), hub.deps.state.get() as EngineState, t + 30_000);
    expect(stationPresence().get(FX.station)?.dark).toBe(true);
    expect(purgePrint({ db: db(), writer: hub.deps.writer }, 'any', now)).toBe(0);
    expect(ids('print_jobs', 'job_id')).toContain('S1:coming_up:1');
    expect(ids('tickets', 'ticket_id')).toContain(old);
    // the same rows go once the station is not dark (presence given directly: screen back)
    const back = () => new Map([[FX.station, { screenless: false, connected: true, offline_since: null, dark: false }]]);
    expect(purgePrint({ db: db(), writer: hub.deps.writer, presence: back }, 'any', now)).toBe(1 + 1 + 1 + 1); // ticket job, line, ticket, coming_up
  });

  it('[03c §5] more rows than one batch are all deleted (batches of 500)', () => {
    const now = hub.clock.branchNow() + 8 * DAY;
    const insert = db().prepare('INSERT INTO print_fold_skips (event_id, station_id, order_ids, reason, at, alerted_at) VALUES (?, ?, ?, ?, ?, ?)');
    db().transaction(() => {
      for (let i = 0; i < 1_201; i += 1) insert.run(`SK${i}`, FX.station, '[]', 'line_missing', 1, 1);
    })();
    expect(purgePrint({ db: db(), writer: hub.deps.writer }, 'any', now)).toBe(1_201);
    expect(ids('print_fold_skips', 'event_id')).toEqual([]);
  });

  it('[03c §5, G-8] runs from the sweeper\'s retentionOnce at the maintenance hour', () => {
    const now = hub.clock.branchNow() + 8 * DAY;
    const t = fired('A1');
    set('UPDATE tickets SET fired_at = 1');
    set('UPDATE print_jobs SET sent_at = 1, acked_at = 1 WHERE ticket_id = ?', t);
    setMaintenanceHour(new Date(now).getHours());
    expect(retentionOnce(hub.deps, now).deleted).toBeGreaterThanOrEqual(3);
    expect(ids('tickets', 'ticket_id')).toEqual([]);
  });
});
