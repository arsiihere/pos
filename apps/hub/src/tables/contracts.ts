// 02a v1.1.1 contracts (§4.2, §3.9, §3.5, §4.1 row 04, §5). Types only: the wave-1 lanes implement against them.
import type { TableState } from '@pos/domain';
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

/** §4.2: throws TABLE_SEATING_CHANGED / TABLE_NEEDS_CLEANING / TABLE_ALREADY_LOCKED / PERMISSION_DENIED; returns the lock drafts. */
export type RequireLock = (tx: WriterTx, ref: { table_id: string; seating_id: string }, ctx: CommandCtx) => EventDraft[];

/** §3.9: closes the seating's pending table_handover `obsolete`; the drafts go in the same transaction. */
export type CloseHandover = (ctx: CommandCtx, seating_id: string, note: string) => EventDraft[];

/** §4.1 row 04: registered by 04 through registerMergeGuard; unregistered → never blocked. */
export type MergeGuard = (
  db: Database.Database,
  q: { seating_ids: string[]; order_ids?: string[] },
) => { blocked: boolean; order_item_ids: string[] };

/** §3.5: the waiter team W of a seating (A = assignee); waiter alerts go to W ∪ {holder}. */
export type WaiterTeam = (
  seating: { assignee: string | null; holder_staff_id: string },
  liveStaffIds: ReadonlySet<string>,
  directory: StaffDirectory,
) => string[];
