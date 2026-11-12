import { DomainError } from '@pos/domain';
import type Database from 'better-sqlite3';

// 02b v1.0.10 §3.4 "Void lock (line guard)" (⚠️ 04 row Q-3): 04 registers its void guard (04 §6.6); every 02b command
// that would change a line's units or money asks it with the touched ids it PLANNED (the line, its cascaded children /
// parts with ≥ 1 unit): CompLine (every grant), applyComp (the approve), RemoveItems (its planRemove ids) and
// SetLineWeight (the line itself), each after its own 404 / 409 checks and before scope (C8). A hit → the caller throws
// 409 VOID_PENDING { alert_id, order_item_id } (`requireNoVoidPending`). The 02a merge-guard pattern
// (tables/merge-guard.ts): unregistered → never blocks (0 statements); registered → the guard's own statement (1). One
// guard per process (startup only); a later registration replaces the earlier one.

/** §4.2 `registerLineGuard(fn)`: `fn(db, order_id, touched_ids) → { alert_id, order_item_id } | null`. */
export type LineGuard = (
  db: Database.Database,
  order_id: string,
  touched_ids: readonly string[],
) => { alert_id: string; order_item_id: string } | null;

let guard: LineGuard | null = null;

export function registerLineGuard(fn: LineGuard): void {
  guard = fn;
}

/** Tests only: back to "no guard registered". */
export function resetLineGuard(): void {
  guard = null;
}

/** Asks the registered guard; with none, never blocked (0 statements). */
export function checkLineGuard(db: Database.Database, order_id: string, touched_ids: readonly string[]): ReturnType<LineGuard> {
  return guard === null ? null : guard(db, order_id, touched_ids);
}

/** The callers' form of `checkLineGuard`: a hit → 409 VOID_PENDING { alert_id, order_item_id }; 0 / 1 statement. */
export function requireNoVoidPending(db: Database.Database, order_id: string, touched_ids: readonly string[]): void {
  const hit = checkLineGuard(db, order_id, touched_ids);
  if (hit !== null) throw new DomainError('VOID_PENDING', { alert_id: hit.alert_id, order_item_id: hit.order_item_id });
}
