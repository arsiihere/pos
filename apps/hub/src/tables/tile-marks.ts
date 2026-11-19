import type Database from 'better-sqlite3';
import type { TileMarks, TileMarksReader } from './contracts.js';

// ⚠️ 02a v1.1.9 §4.2 (05 row T-4, R-30 (b)): an ordered list of tile-mark readers (the registerMergeGuard pattern).
// 05 registers one reader of its own tables at startup; 02a never reads another module's tables. None registered →
// every seating answers `{ reopened: false, check_printed_at: null }` and no statement runs.

const readers: TileMarksReader[] = [];

export function registerTileMarks(fn: TileMarksReader): void {
  if (!readers.includes(fn)) readers.push(fn);
}

/** Tests only: back to "no reader registered". */
export function resetTileMarks(): void {
  readers.length = 0;
}

const NONE: TileMarks = { reopened: false, check_printed_at: null };

/**
 * Asks every registered reader once with the whole list (registration order) and combines per seating: `reopened` =
 * any true, `check_printed_at` = the largest non-null. A seating absent from every answer → false / null. An empty
 * list asks nothing. 0 statements of its own; 1 per reader (the reader's).
 */
export function tileMarksOf(db: Database.Database, seating_ids: string[]): Map<string, TileMarks> {
  const out = new Map<string, TileMarks>();
  for (const id of seating_ids) out.set(id, { ...NONE });
  if (seating_ids.length === 0) return out;
  for (const reader of readers) {
    for (const [id, marks] of reader(db, seating_ids)) {
      const cur = out.get(id);
      if (cur === undefined) continue;
      if (marks.reopened) cur.reopened = true;
      if (marks.check_printed_at !== null && (cur.check_printed_at === null || marks.check_printed_at > cur.check_printed_at)) {
        cur.check_printed_at = marks.check_printed_at;
      }
    }
  }
  return out;
}
