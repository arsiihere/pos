import type Database from 'better-sqlite3';
import type { TileMarks, TileMarksReader } from '../tables/contracts.js';

// 05 §6.4a (R-30 (b), row T-4): the table-tile marks reader 02a asks through registerTileMarks (registered at startup
// by task 33, §6.30). 02a `seatings` is read-only here (§4.1). Ids and times only: never a total, a name or money.

/**
 * Per asked seating: `reopened` = some open, non-absorbed bill on it has reopen_count ≥ 1 (full edit or corrections);
 * `check_printed_at` = the larger of those bills' check_printed_at and the seating's bill_requested_at (§6.2, H6-9),
 * null when both are null. A seating with neither mark is left out (02a answers false / null). 1 statement for the
 * whole list (`bills_seating` index).
 */
export const billTileMarks: TileMarksReader = (db: Database.Database, seating_ids: string[]): Map<string, TileMarks> => {
  const out = new Map<string, TileMarks>();
  if (seating_ids.length === 0) return out;
  const rows = db
    .prepare(
      `SELECT s.seating_id AS seating_id,
              COALESCE(MAX(b.reopen_count >= 1), 0) AS reopened,
              MAX(b.check_printed_at) AS printed_at,
              s.bill_requested_at AS requested_at
       FROM seatings s
       JOIN (SELECT DISTINCT value AS seating_id FROM json_each(?)) j ON j.seating_id = s.seating_id
       LEFT JOIN bills b ON b.seating_id = s.seating_id AND b.absorbed_into IS NULL AND b.state <> 'closed'
       GROUP BY s.seating_id`,
    )
    .all(JSON.stringify(seating_ids)) as Array<{ seating_id: string; reopened: number; printed_at: number | null; requested_at: number | null }>;
  for (const r of rows) {
    const times = [r.printed_at, r.requested_at].filter((t): t is number => t !== null);
    const marks: TileMarks = { reopened: r.reopened === 1, check_printed_at: times.length === 0 ? null : Math.max(...times) };
    if (marks.reopened || marks.check_printed_at !== null) out.set(r.seating_id, marks);
  }
  return out;
};
