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
export const HANDOVERS_DUE_SQL = `SELECT handover_id, order_id FROM handovers
  WHERE open_lines > 0 AND handed_at <= ?
    AND EXISTS (SELECT 1 FROM handover_lines l WHERE l.handover_id = handovers.handover_id AND l.settled_at IS NULL)
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
