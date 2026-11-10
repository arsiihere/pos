import type Database from 'better-sqlite3';
import type { MergeGuard } from './contracts.js';

// 02a v1.1.3 §4.1 row 04: 04 registers its void guard; merge (§3.11) and split (§3.12) ask it.
// Unregistered → never blocked. One guard per process; a later registration replaces the earlier one.

let guard: MergeGuard | null = null;

export function registerMergeGuard(fn: MergeGuard): void {
  guard = fn;
}

/** Tests only: back to "no guard registered". */
export function resetMergeGuard(): void {
  guard = null;
}

/** Asks the registered guard; with none, never blocked (0 statements). */
export function checkMergeGuard(db: Database.Database, q: { seating_ids: string[]; order_ids?: string[] }): ReturnType<MergeGuard> {
  return guard === null ? { blocked: false, order_item_ids: [] } : guard(db, q);
}
