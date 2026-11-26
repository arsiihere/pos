// 03b §4.2 `handoversDue(db, now, older_than_ms)` (b17), for 02b's `served_estimate` tick (task 0e, §4.3).
// Hand-overs with unsettled lines (`handovers_unsettled`: open_lines > 0) handed at or before `now − older_than_ms`,
// oldest first, LIMIT 200; each with only its UNSETTLED lines (`handover_lines.settled_at IS NULL`), in the order the
// Handover listed them (insertion order). Keyed on the lines, not on the card: a Served card expired at day close
// still has its unsettled lines here (§3.5 Day close). 2 statements (1 when nothing is due).
import type Database from 'better-sqlite3';
import type { HandoverDue } from './contracts.js';

export const HANDOVERS_DUE_LIMIT = 200;

// Only hand-overs that still have an unsettled line row count toward the LIMIT (open_lines > 0 with none cannot be
// built by the pass fold; such a row would take a slot and serve nothing).
// ⚠️ 02b v1.0.25 §3.7 (run 1 M-2, row TK-9; owner 2026-11-26): a takeaway's hand-over is Pass → counter, never to the
// customer, so 02b's served_estimate tick skips it; filtered here (0 extra statements) so takeaway hand-overs, which
// stay unsettled until the counter's MarkServed, never fill the LIMIT ahead of dine-in / parking ones.
export const HANDOVERS_DUE_SQL = `SELECT handover_id, order_id FROM handovers
  WHERE open_lines > 0 AND handed_at <= ?
    AND EXISTS (SELECT 1 FROM handover_lines l WHERE l.handover_id = handovers.handover_id AND l.settled_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_id = handovers.order_id AND o.order_type = 'takeaway')
  ORDER BY handed_at, handover_id LIMIT ${HANDOVERS_DUE_LIMIT}`;

export const HANDOVERS_DUE_LINES_SQL = `SELECT handover_id, order_item_id FROM handover_lines
  WHERE settled_at IS NULL AND handover_id IN (SELECT value FROM json_each(?)) ORDER BY rowid`;

/** §4.2; 2 statements, LIMIT 200. */
export function handoversDue(db: Database.Database, now: number, older_than_ms: number): HandoverDue[] {
  const rows = db.prepare(HANDOVERS_DUE_SQL).all(now - older_than_ms) as Array<{ handover_id: string; order_id: string }>;
  if (rows.length === 0) return [];
  const lines = db.prepare(HANDOVERS_DUE_LINES_SQL).all(JSON.stringify(rows.map((r) => r.handover_id))) as Array<{ handover_id: string; order_item_id: string }>;
  const byHandover = new Map<string, string[]>(rows.map((r) => [r.handover_id, []]));
  for (const l of lines) byHandover.get(l.handover_id)?.push(l.order_item_id);
  return rows.map((r) => ({ handover_id: r.handover_id, order_id: r.order_id, order_item_ids: byHandover.get(r.handover_id)! }));
}

// 03b v1.0.16 §4.2 `readyAtOf` (02b-tk R8; hostile run 1 M-3, m-10): per order, the largest `pass_orders.ready_at`
// over its points. `ready_at` is the recorded_at of the latest ReadyToServe at the point (Handover's own Ready
// included) and is cleared only by ReadyToServeUndone, so it survives the Ready's alert closing or expiring (a carried
// order keeps its time). 02b's open-orders reads it (TK-3). 1 statement, 0 for [].
export const READY_AT_OF_SQL = `SELECT order_id, MAX(ready_at) AS ready_at FROM pass_orders
  WHERE ready_at IS NOT NULL AND order_id IN (SELECT value FROM json_each(?)) GROUP BY order_id`;

/** §4.2; 1 statement (0 for an empty list). */
export function readyAtOf(db: Database.Database, order_ids: readonly string[]): Map<string, number> {
  if (order_ids.length === 0) return new Map();
  const rows = db.prepare(READY_AT_OF_SQL).all(JSON.stringify(order_ids)) as Array<{ order_id: string; ready_at: number }>;
  return new Map(rows.map((r) => [r.order_id, r.ready_at]));
}

// ⚠️ 03b v1.0.16 §4.2 (run 3 R3-M-9): the R8 epoch of each order (pass_bag_ready, §5). A missing row = no active R8
// clock. 1 statement, 0 for [].
export const BAG_READY_AT_OF_SQL = `SELECT order_id, bag_ready_since, bag_ready_window_ms FROM pass_bag_ready
  WHERE order_id IN (SELECT value FROM json_each(?))`;

/** §4.2 `bagReadyAtOf`; 1 statement (0 for an empty list). */
export function bagReadyAtOf(db: Database.Database, order_ids: readonly string[]): Map<string, { bag_ready_since: number; bag_ready_window_ms: number }> {
  if (order_ids.length === 0) return new Map();
  const rows = db.prepare(BAG_READY_AT_OF_SQL).all(JSON.stringify(order_ids)) as Array<{ order_id: string; bag_ready_since: number; bag_ready_window_ms: number }>;
  return new Map(rows.map((r) => [r.order_id, { bag_ready_since: r.bag_ready_since, bag_ready_window_ms: r.bag_ready_window_ms }]));
}

/** §4.2 `passReadyTimesOf`: the historical point time (readyAtOf) and the R8 pair together, per requested order. */
export interface PassReadyTimes {
  ready_at: number | null;
  bag_ready_since: number | null;
  bag_ready_window_ms: number | null;
}

// keyed by the batched order ids, left-joined to the historical aggregate and the epoch row (1 statement)
export const PASS_READY_TIMES_OF_SQL = `SELECT j.value AS order_id,
       (SELECT MAX(p.ready_at) FROM pass_orders p WHERE p.order_id = j.value AND p.ready_at IS NOT NULL) AS ready_at,
       b.bag_ready_since AS bag_ready_since, b.bag_ready_window_ms AS bag_ready_window_ms
  FROM json_each(?) j LEFT JOIN pass_bag_ready b ON b.order_id = j.value`;

/** §4.2 `passReadyTimesOf`; 1 statement (0 for an empty list); every requested id is a key. */
export function passReadyTimesOf(db: Database.Database, order_ids: readonly string[]): Map<string, PassReadyTimes> {
  if (order_ids.length === 0) return new Map();
  const rows = db.prepare(PASS_READY_TIMES_OF_SQL).all(JSON.stringify([...new Set(order_ids)])) as Array<PassReadyTimes & { order_id: string }>;
  return new Map(rows.map(({ order_id, ...t }) => [order_id, t]));
}
