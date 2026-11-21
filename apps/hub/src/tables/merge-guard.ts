import type Database from 'better-sqlite3';
import type { MergeGuard } from './contracts.js';

// 02a v1.1.3 §4.1 row 04, ⚠️ 02a v1.1.8 (05 row T-1): an ordered list of merge guards (04 first, then 05: the order
// of registration); merge (§3.11) and split (§3.12) throw the first non-null `{ code, details }`. None registered →
// never blocked. registerVoids runs once per server, so a guard already in the list is not appended again.

const guards: MergeGuard[] = [];

export function registerMergeGuard(fn: MergeGuard): void {
  if (!guards.includes(fn)) guards.push(fn);
}

/** Tests only: back to "no guard registered". */
export function resetMergeGuard(): void {
  guards.length = 0;
}

/** Asks the guards in list order; the first non-null result answers and later guards are not asked. None → 0 statements. */
export function checkMergeGuard(db: Database.Database, q: { seating_ids: string[]; order_ids?: string[] }): ReturnType<MergeGuard> {
  for (const guard of guards) {
    const result = guard(db, q);
    if (result !== null) return result;
  }
  return null;
}
