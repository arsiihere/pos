import type Database from 'better-sqlite3';
import type { Writer } from '../engine-host/writer.js';
import { forgetReceiptAlerts } from './receipts.js';

// 01d §5.1 Retention (Q6), run by 00's sweeper in the M66 maintenance hour after 00's own purge (H-8: the
// sweeper's try/catch logs a failed batch; that batch rolls back and the next run continues). Batches of
// ALERT_RETENTION_BATCH, one writer.run per batch; projection rows are deleted directly and no event is
// written (events stay forever).
//   1. alert_inbox, alert_receipts, request_seen rows of alerts closed before the previous business day:
//      per table, ≤ 500 rows per batch.
//   2. closed alerts rows older than CLOSED_ALERTS_KEPT_MS, oldest first, ≤ 500 alerts per batch: their
//      alert_receipts and request_seen rows (no foreign key), then the alerts rows, whose alert_recipients and
//      any remaining alert_inbox rows go by ON DELETE CASCADE (foreign_keys = ON, db/connection.ts).
// Open alerts and their rows are never touched (a personal notice open for 10 days stays, §3.10).
// "The previous business day" is the latest business day that has closed (the day before the open one, or the
// day just closed when none is open); its BusinessDayOpened recorded_at is the cutoff (01a S33: recorded_at is
// the day's start). No business day closed yet → step 1 deletes nothing.
// AD-88: on commit of a batch that deletes an alert's receipts, the receipt buffer drops that alert's
// recorded and sentVia keys (receipts.ts forgetReceiptAlerts).
// Statements: 1 cutoff read; per batch 1 probe (outside the writer) + 1 delete (step 1) or + 4 (step 2:
// ids, receipts, seen, alerts); 1 final probe per kind of batch. Plain db.prepare: not a hot path (AD-125).

export const ALERT_RETENTION_BATCH = 500;
export const CLOSED_ALERTS_KEPT_MS = 7 * 86_400_000;

export interface RetentionDeps {
  db: Database.Database;
  writer: Writer;
}

const PREVIOUS_DAY_START = `SELECT o.recorded_at FROM events o
  WHERE o.stream_type = 'hub' AND o.stream_id = @branch AND o.event_type = 'BusinessDayOpened'
    AND o.seq < (SELECT MAX(c.seq) FROM events c
                 WHERE c.stream_type = 'hub' AND c.stream_id = @branch AND c.event_type = 'BusinessDayClosed')
  ORDER BY o.seq DESC LIMIT 1`;

/** Rows of `table` whose alert closed before `@cutoff`; `rowid`s, so a batch is ≤ 500 rows. */
const closedBefore = (table: string): string =>
  `SELECT t.rowid FROM ${table} t JOIN alerts a ON a.alert_id = t.alert_id
   WHERE a.state = 'closed' AND a.closed_at < @cutoff`;

const STEP_1 = ['alert_inbox', 'alert_receipts', 'request_seen'].map((table) => ({
  table,
  probe: `${closedBefore(table)} LIMIT 1`,
  remove: `DELETE FROM ${table} WHERE rowid IN (${closedBefore(table)} LIMIT ${ALERT_RETENTION_BATCH})${
    table === 'alert_receipts' ? ' RETURNING alert_id' : ''
  }`,
}));

const EXPIRED_PROBE = `SELECT 1 FROM alerts WHERE state = 'closed' AND closed_at < ? LIMIT 1`;
const EXPIRED_IDS = `SELECT alert_id FROM alerts WHERE state = 'closed' AND closed_at < ?
  ORDER BY closed_at, alert_id LIMIT ${ALERT_RETENTION_BATCH}`;
const IN_IDS = `IN (SELECT value FROM json_each(?))`;
const DELETE_RECEIPTS = `DELETE FROM alert_receipts WHERE alert_id ${IN_IDS}`;
const DELETE_SEEN = `DELETE FROM request_seen WHERE alert_id ${IN_IDS}`;
const DELETE_ALERTS = `DELETE FROM alerts WHERE alert_id ${IN_IDS}`;

/** §5.1 retention; returns the rows deleted directly (cascaded rows not counted). Throws a batch's error. */
export function purgeAlerts(deps: RetentionDeps, branchId: string, now: number): number {
  let deleted = 0;
  const cutoff = deps.db.prepare(PREVIOUS_DAY_START).pluck().get({ branch: branchId }) as number | undefined;
  if (cutoff !== undefined) {
    for (const step of STEP_1) {
      while (deps.db.prepare(step.probe).get({ cutoff }) !== undefined) {
        deleted += deps.writer.run((tx) => {
          const statement = tx.db.prepare(step.remove);
          if (step.table !== 'alert_receipts') return statement.run({ cutoff }).changes;
          const ids = statement.pluck().all({ cutoff }) as string[];
          const alertIds = [...new Set(ids)];
          tx.onCommit(() => forgetReceiptAlerts(deps.db, alertIds));
          return ids.length;
        }).result;
      }
    }
  }
  const before = now - CLOSED_ALERTS_KEPT_MS;
  while (deps.db.prepare(EXPIRED_PROBE).get(before) !== undefined) {
    deleted += deps.writer.run((tx) => {
      const alertIds = tx.db.prepare(EXPIRED_IDS).pluck().all(before) as string[];
      const ids = JSON.stringify(alertIds);
      const n =
        tx.db.prepare(DELETE_RECEIPTS).run(ids).changes +
        tx.db.prepare(DELETE_SEEN).run(ids).changes +
        tx.db.prepare(DELETE_ALERTS).run(ids).changes;
      tx.onCommit(() => forgetReceiptAlerts(deps.db, alertIds));
      return n;
    }).result;
  }
  return deleted;
}
