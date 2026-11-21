import { DomainError } from '@pos/domain';
import type Database from 'better-sqlite3';
import type { LineView } from './contracts.js';
import { billedMinor, liveUnits, type LedgerLine } from './ledger.js';

// 02b v1.0.10 §3.4 "Void lock (line guard)" (⚠️ 04 row Q-3), ⚠️ 02b v1.0.16 §3.4 / §4.2 (05 row Q-3, R-16): an ordered
// list of line guards (04 first, then 05: the order of registration). Every 02b / 04 command that would change a line's
// units or money asks the list ONCE with every line it touches, each entry from its own plan or ledger result:
// RemoveItems (its planRemove lines), CompLine and applyComp (the planComp lines), SetLineWeight (the line itself,
// money_changes: true), and 04's VoidItems and void-preview (05 row V-1, after ORDER_BILLED), each after its own 404 /
// 409 checks and before scope (C8). The first non-null `{ code, details }` is thrown (`requireLineGuard`); later guards
// are not asked. The 02a merge-guard pattern (tables/merge-guard.ts): none registered → never blocked (0 statements);
// each registered guard costs its own statement. registerVoids runs once per server, so a guard already in the list is
// not appended again.

/**
 * §3.4 (05 row Q-3): one touched line, after the caller's planned change. ⚠️ R-33 (02b v1.0.17 row Q-3): an
 * `order_item_id` may repeat in one list (void-preview: one run per judged id, so a deal and one of its parts each give
 * the deal an entry); a guard judges EVERY entry, never the first per id.
 */
export interface LineGuardEntry {
  order_item_id: string;
  /** the planned live units after the change */
  units_after: number;
  /** the planned comped units after the change */
  comped_after: number;
  /** the line's billed_minor (§3.4) after the change */
  base_after_minor: number;
  /** a weight (SetLineWeight) or any price change */
  money_changes: boolean;
}

/** §4.2: `null` = not blocked; 04's guard answers `VOID_PENDING { alert_id, order_item_id }` (unchanged), 05's `LINE_IN_CLOSED_SPLIT`. */
export type LineGuardResult = { code: 'VOID_PENDING' | 'LINE_IN_CLOSED_SPLIT'; details: Record<string, unknown> } | null;

/**
 * §4.2 `registerLineGuard(fn)`: `fn(db, order_id, touched) → { code, details } | null`. `touched` may hold an id more
 * than once (R-33): every entry is judged.
 */
export type LineGuard = (db: Database.Database, order_id: string, touched: readonly LineGuardEntry[]) => LineGuardResult;

const guards: LineGuard[] = [];

/** Startup only: appends `fn` to the list (a guard already in it is ignored). */
export function registerLineGuard(fn: LineGuard): void {
  if (!guards.includes(fn)) guards.push(fn);
}

/** Tests only: back to "no guard registered". */
export function resetLineGuard(): void {
  guards.length = 0;
}

/**
 * Asks the guards in list order; the first non-null result answers and later guards are not asked. None → 0
 * statements. `except` is a guard the caller does not ask: 04's VoidItems and void-preview pass 04's own, whose lock
 * they check themselves (04 §3.2 rule 6 (b), unchanged by row V-1).
 * ⚠️ For the 02b callers (RemoveItems, CompLine / applyComp, SetLineWeight, no `except`) 04's guard must stay FIRST in
 * the list: 05's guard may take a line's billed amount as equal to its base only because 04's guard has already
 * refused any line with an open void request before 05's is reached. Registering 05's before 04's breaks that.
 */
export function checkLineGuard(db: Database.Database, order_id: string, touched: readonly LineGuardEntry[], except?: LineGuard): LineGuardResult {
  for (const guard of guards) {
    if (guard === except) continue;
    const result = guard(db, order_id, touched);
    if (result !== null) return result;
  }
  return null;
}

/** The callers' form of `checkLineGuard`: the first non-null `{ code, details }` is thrown (409). */
export function requireLineGuard(db: Database.Database, order_id: string, touched: readonly LineGuardEntry[], except?: LineGuard): void {
  const hit = checkLineGuard(db, order_id, touched, except);
  if (hit !== null) throw new DomainError(hit.code, hit.details);
}

/** A line as a caller's working copy holds it after its planned change. */
export type GuardLine = LedgerLine & Pick<LineView, 'order_item_id' | 'parent_order_item_id' | 'line_kind' | 'line_total_minor'>;

/**
 * The guard entries of `ids` (in that order) from the caller's working copy after its plan (0 statements):
 * `units_after` = live units, `comped_after` = comped units, `base_after_minor` = §3.4 billed_minor (a deal from its
 * parts in `after`), `money_changes` false (RemoveItems, CompLine, VoidItems change no price).
 * ⚠️ R-33 (02b v1.0.17 row Q-3): a deal_part touched without its deal (its parent not in `ids`) also gives the parent
 * deal's entry, once per call, after the touched entries: units_after and comped_after the deal's (unchanged),
 * base_after_minor folded from its parts after the change, money_changes true.
 */
export function lineGuardEntries(after: ReadonlyMap<string, GuardLine>, ids: Iterable<string>): LineGuardEntry[] {
  const all = [...after.values()];
  const entry = (id: string, money_changes: boolean): LineGuardEntry => {
    const l = after.get(id);
    if (l === undefined) throw new Error(`lineGuardEntries: ${id} is not in the working copy`);
    const parts = l.line_kind === 'deal' ? all.filter((p) => p.parent_order_item_id === id && p.line_kind === 'deal_part') : [];
    return { order_item_id: id, units_after: liveUnits(l), comped_after: l.comped_units, base_after_minor: billedMinor(l, parts), money_changes };
  };
  const touched = [...ids];
  const own = new Set(touched);
  const deals = new Set<string>();
  for (const id of touched) {
    const l = after.get(id);
    if (l?.line_kind === 'deal_part' && l.parent_order_item_id !== null && !own.has(l.parent_order_item_id)) deals.add(l.parent_order_item_id);
  }
  return [...touched.map((id) => entry(id, false)), ...[...deals].map((id) => entry(id, true))];
}

/**
 * The guard entries of planned runs (0 statements), for callers whose planner returns each line's ledger `after`
 * (02b planVoid lines; 04's VoidItems and void-preview, 05 row V-1). Each run is applied in order to its own fresh copy
 * of `lines` (VoidItems: one run, its entries against one working copy; void-preview: one run per judged id, each
 * against the order as read, never one copy shared across runs); a run yields one entry per line it touches
 * (first-touch order, the line as the run leaves it) plus the R-33 parent deal entry of a part voided alone; the runs'
 * entries are concatenated, so an id may repeat (every entry is judged).
 */
export function plannedLineGuardEntries(
  lines: readonly GuardLine[],
  runs: readonly (readonly { order_item_id: string; after: LedgerLine }[])[],
): LineGuardEntry[] {
  return runs.flatMap((run) => {
    const work = new Map(lines.map((l) => [l.order_item_id, { ...l }]));
    const touched = new Set<string>();
    for (const p of run) {
      Object.assign(work.get(p.order_item_id)!, p.after);
      touched.add(p.order_item_id);
    }
    return lineGuardEntries(work, touched);
  });
}
