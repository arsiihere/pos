// 02a v1.1.1 contracts (§4.2, §3.9, §3.5, §4.1 row 04, §5). Types only: the wave-1 lanes implement against them.
import type { ErrorCode, TableState } from '@pos/domain';
import type { EventDraft } from '@pos/events';
import type Database from 'better-sqlite3';
import type { StaffDirectory } from '../auth/staff-directory.js';
import type { CommandCtx } from '../commands/registry.js';
import type { WriterTx } from '../engine-host/writer.js';

// §4.2 holdersOfOrders / currentTableOf: 03a v1.2 §4.4's reader pair types, unchanged.
export type { CurrentTableOf, HoldersOfOrders } from '../engine-host/index.js';

/** §5 `seatings` row. `state` is the column's CHECK: an open seating's TableState (never FREE) or CLOSED. */
export interface SeatingRow {
  seating_id: string;
  primary_table_id: string;
  state: Exclude<TableState, 'FREE'> | 'CLOSED';
  holder_staff_id: string;
  party_size: number | null;
  opened_at: number;
  bill_requested_at: number | null;
  /** sticky NEEDS_CLEANING */
  bill_closed: 0 | 1;
  closed_at: number | null;
  close_reason: 'cleaned' | 'left_without_order' | 'merged' | null;
}

/** §5 `table_locks` row: one per seating, keyed by its primary table. */
export interface LockRow {
  table_id: string;
  seating_id: string;
  staff_id: string;
  device_id: string;
  locked_at: number;
  last_activity_at: number;
  /** NULL until the first TableLockTouched (D61) */
  last_touch_at: number | null;
}

/** §4.2: Map<table_id, staff_id> = holder of the table's open seating; 1 statement. */
export type TableOwners = (db: Database.Database, table_ids: readonly string[]) => Map<string, string>;

/** §4.2: the table's open seating, or null; 1 statement. */
export type SeatingOf = (
  db: Database.Database,
  table_id: string,
) => { seating_id: string; primary_table_id: string; table_ids: string[]; state: TableState; holder_staff_id: string } | null;

/** §4.2: 0 statements; zone_order_taker_staff_id = directory.assignedOrderTaker(table_id) (SG-1). */
export type ZoneOf = (table_id: string) => { floor_id: string; zone_id: string | null; zone_order_taker_staff_id: string | null };

/**
 * §4.2: throws TABLE_SEATING_CHANGED / TABLE_NEEDS_CLEANING / TABLE_ALREADY_LOCKED / PERMISSION_DENIED; returns the lock
 * drafts. ⚠️ 02a v1.1.8 (05 row T-3 (3)): `allowBillClosed` (SubmitOrder only) lets a **live** call (`ctx.queuedAt ===
 * null`, 05 H2-13) through a NEEDS_CLEANING seating; a queued replay keeps TABLE_NEEDS_CLEANING.
 */
export type RequireLock = (
  tx: WriterTx,
  ref: { table_id: string; seating_id: string },
  ctx: CommandCtx,
  opts?: { allowBillClosed?: boolean },
) => EventDraft[];

/** §3.9: closes the seating's pending table_handover `obsolete`; the drafts go in the same transaction. */
export type CloseHandover = (ctx: CommandCtx, seating_id: string, note: string) => EventDraft[];

/**
 * §4.1 row 04, ⚠️ 02a v1.1.8 (05 row T-1): one guard of the ordered list registerMergeGuard appends to (04 first, then
 * 05). `null` = not blocked; else the `{ code, details }` merge / split throws (04's: MERGE_BLOCKED_BY_VOID
 * { order_item_ids }). None registered → never blocked.
 */
export type MergeGuard = (
  db: Database.Database,
  q: { seating_ids: string[]; order_ids?: string[] },
) => { code: ErrorCode; details: Record<string, unknown> } | null;

/**
 * §4.2, ⚠️ 02a v1.1.9 (05 row T-4): the two marks of one open seating's tile. The meaning and the source are the
 * registering module's (05 §6.4a); 02a shows them only. `check_printed_at` is Unix ms, like `bill_requested_at`.
 */
export interface TileMarks {
  reopened: boolean;
  check_printed_at: number | null;
}

/**
 * §4.2, ⚠️ 02a v1.1.9 (05 row T-4): one reader of the ordered list registerTileMarks appends to. Answers the whole
 * list of open seating ids in 1 statement; a seating it leaves out has no marks.
 */
export type TileMarksReader = (db: Database.Database, seating_ids: string[]) => Map<string, TileMarks>;

/** §3.5: the waiter team W of a seating (A = assignee); waiter alerts go to W ∪ {holder}. */
export type WaiterTeam = (
  seating: { assignee: string | null; holder_staff_id: string },
  liveStaffIds: ReadonlySet<string>,
  directory: StaffDirectory,
) => string[];
