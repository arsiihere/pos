import type { EventDraft } from '@pos/events';
import type { AlertApplyCtx, AnswerFacts } from '../../alerts/kinds.js';
import type { BillRequestKind, BillRequestKindTypes } from './values.js';

// 05 §3.14 (task 9; PL-5 as ruled by the integrator on the task-9 STOP, option (c)): each request kind's `apply`
// lives in its command's file (tasks 13, 14, 18–22), which registers it here with one line at module load. Until
// then the kind's `apply` throws `not built`. One owner per file: no command file is created by task 9.

export type BillKindApply<K extends BillRequestKind> = (
  ctx: AlertApplyCtx<BillRequestKindTypes[K]['values'], BillRequestKindTypes[K]['details']>,
  answer: AnswerFacts,
) => EventDraft[];

type AnyApply = (ctx: AlertApplyCtx<never, never>, answer: AnswerFacts) => EventDraft[];

const applies = new Map<BillRequestKind, AnyApply>();

/**
 * Call it at the command file's module top level with a module-level function — never a closure created inside
 * `registerX(app, deps)`: a second server would pass a new function, and a different function throws.
 * Registers a kind's `apply`. The same function again is ignored (the repo's guard-list rule: registration may run
 * once per server); a different function for a kind that already has one throws (one owner per kind).
 */
export function registerBillKindApply<K extends BillRequestKind>(kind: K, def: { apply: BillKindApply<K> }): void {
  const fn = def.apply as unknown as AnyApply;
  const had = applies.get(kind);
  if (had === fn) return;
  if (had !== undefined) throw new Error(`registerBillKindApply('${kind}'): another apply is already registered`);
  applies.set(kind, fn);
}

/** Tests only: back to "nothing registered". */
export function resetBillKindApplies(): void {
  applies.clear();
}

/** The kind's `apply` as 01d calls it: the registered function, else `not built`. */
export function seamApply<K extends BillRequestKind>(kind: K): BillKindApply<K> {
  return (ctx, answer) => {
    const fn = applies.get(kind);
    if (fn === undefined) throw new Error(`05 kind '${kind}': apply not built`);
    return fn(ctx as unknown as AlertApplyCtx<never, never>, answer);
  };
}
