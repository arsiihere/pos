import type { ErrorCode } from '@pos/domain';
import type { EngineState } from '@pos/engine';
import type Database from 'better-sqlite3';
import type { MergeGuard } from '../tables/contracts.js';

// 04 §4.2 (phase 0 P0.7): every export other modules and lanes code against. Each function throws "not built" until
// its task provides it with provideVoids() from the lane's register file (voids/lanes/<L>.ts); the guards are no-ops
// until then, so registering them changes nothing. Callers import from here, never from the lane's own file.
// toAuditEntry, AuditEntry, AUDIT_ACTIONS and registerAuditAction are browser-safe and live in @pos/domain (task a1).

/** §4.2: the kind name (05 day close: `alerts.listOpen({ kind: VOID_KIND })`). */
export const VOID_KIND = 'void_approval';

/** §4.2: one open `void_approval` request; amounts from its `values`. */
export interface PendingVoid {
  alert_id: string;
  order_item_id: string;
  units: number;
  touched_ids: string[];
  refund_minor: number;
  comp_voided_minor: number;
  requester_staff_id: string;
  raised_at: number;
  /** a stored `moved` line no longer at cooking / done (engine state in memory); `null` without `state` */
  blocked: 'not_movable_stage' | null;
}

/** 02b v1.0.10 §3.4 (row Q-3) line guard shape; registered by v8 once u3's `registerLineGuard` exists. */
export type VoidLineGuard = (
  db: Database.Database,
  order_id: string,
  touched_ids: readonly string[],
) => { alert_id: string; order_item_id: string } | null;

/** 01a v2.5 §6.18b (row A-1) day-close guard shape; registered by v8 once u8's `registerDayCloseGuard` exists. */
export type VoidDayCloseGuard = (
  db: Database.Database,
  state: EngineState,
) => { code: ErrorCode; details: Record<string, unknown> } | null;

export interface VoidsContracts {
  /** §4.2 (v8); 1 statement (`alerts_open_kind`). Map key = order_id. */
  pendingVoids(db: Database.Database, order_ids: readonly string[], state?: EngineState): Map<string, PendingVoid[]>;
  /** §6.6 (v8); 1 statement. */
  mergeGuard: MergeGuard;
  /** §6.6, row Q-3 (v8); 1 statement. */
  lineGuard: VoidLineGuard;
  /** row A-1 (v8); 1 statement. */
  dayCloseGuard: VoidDayCloseGuard;
}

const TASK: Record<keyof VoidsContracts, string> = {
  pendingVoids: 'v8',
  mergeGuard: 'v8',
  lineGuard: 'v8',
  dayCloseGuard: 'v8',
};

let built: Partial<VoidsContracts> = {};

/** Called by a lane's register file when its task lands (e.g. `provideVoids({ pendingVoids })`). */
export function provideVoids(part: Partial<VoidsContracts>): void {
  built = { ...built, ...part };
}

export function pendingVoids(db: Database.Database, order_ids: readonly string[], state?: EngineState): Map<string, PendingVoid[]> {
  const fn = built.pendingVoids;
  if (fn === undefined) throw new Error(`04 pendingVoids: not built (task ${TASK.pendingVoids})`);
  return fn(db, order_ids, state);
}

/** §6.6: registered by registerVoids (voids/index.ts); never blocks until v8 provides it (0 statements). */
export const voidMergeGuard: MergeGuard = (db, q) => {
  const fn = built.mergeGuard;
  return fn === undefined ? { blocked: false, order_item_ids: [] } : fn(db, q);
};

/** Row Q-3: never blocks until v8 provides it (0 statements). */
export const voidLineGuard: VoidLineGuard = (db, order_id, touched_ids) => {
  const fn = built.lineGuard;
  return fn === undefined ? null : fn(db, order_id, touched_ids);
};

/** Row A-1: never blocks until v8 provides it (0 statements). */
export const voidDayCloseGuard: VoidDayCloseGuard = (db, state) => {
  const fn = built.dayCloseGuard;
  return fn === undefined ? null : fn(db, state);
};
