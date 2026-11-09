import type {
  BillClosedPayload,
  BillRequestedPayload,
  OrderFoodClearedPayload,
  OrderPlacedPayload,
  PosEvent,
  SeatingSplitPayload,
  TableCleanedPayload,
  TableHolderChangedPayload,
  TableMovedPayload,
  TableOpenedPayload,
  TablesMergedPayload,
} from '@pos/events';
import type Database from 'better-sqlite3';
import type { Projection, ProjectionRegistry } from '../projections/registry.js';
import type { SeatingRow } from './contracts.js';

// 02a §5 / T19: the one projection `tables`. It writes seatings, seating_tables, seating_orders and table_locks,
// so every fold sees all four tables as of that event, live and in catch-up. Times are the envelope recorded_at.
// The lock part (TableLocked / Touched / Released, the lock re-key and delete, the activity refresh, §3.3) is
// task 5's: the lock-only events are listed here and are no-ops until then.

// §6.19: the ten `table` stream events.
const TABLE_EVENTS = [
  'TableOpened',
  'TableLocked',
  'TableLockTouched',
  'TableLockReleased',
  'TableHolderChanged',
  'TableMoved',
  'TablesMerged',
  'SeatingSplit',
  'BillRequested',
  'TableCleaned',
] as const;

// §5 (P-1, P-1c, P-1d): 02b's order events and 05's BillClosed. Not ItemServed (AD-4).
const FOLDED_EVENTS = [
  'OrderPlaced',
  'OrderLinesAdded',
  'ItemRemoved',
  'OrderCancelled',
  'OrderFoodServed',
  'OrderFoodCleared',
  'LineWeightSet',
  'LineComped',
  'BillClosed',
] as const;

export const TABLES_EVENT_TYPES: readonly string[] = [...TABLE_EVENTS, ...FOLDED_EVENTS];

type OpenState = Exclude<SeatingRow['state'], 'CLOSED'>;

/** The facts §3.1's state fold reads for one open seating. Live = `cancelled = 0`; food = `has_food = 1`. */
export interface FoldInput {
  bill_closed: 0 | 1;
  bill_requested_at: number | null;
  live_orders: number;
  live_food_orders: number;
  /** live food orders with served_any = 0 */
  unserved_food_orders: number;
}

/** §3.1 state fold with P-1d (02b v1.0): one function, run after every folded event of an open seating. */
export function foldState(seating: FoldInput): OpenState {
  if (seating.bill_closed === 1) return 'NEEDS_CLEANING';
  if (seating.live_orders === 0) return 'SEATED';
  if (seating.bill_requested_at !== null) return 'BILL_REQUESTED';
  if (seating.unserved_food_orders > 0 || seating.live_food_orders === 0) return 'ORDERED';
  return 'FOOD_ON_TABLE';
}

/** §10 #55: the one line for a `dine_in` OrderPlaced whose table_key names no open seating (live fold only). */
export interface UnknownSeatingLine {
  order_id: string;
  table_key: string;
}

interface LogSlot {
  log: ((line: UnknownSeatingLine) => void) | null;
  pending: UnknownSeatingLine[];
}

// As the alerts projection (projections/alerts.ts): boot replays projections before the server log exists,
// so live lines wait here until bindTablesProjectionLog binds a log.
const slots = new WeakMap<ProjectionRegistry, LogSlot>();

/** Binds the hub log for the #55 line; flushes lines written before. */
export function bindTablesProjectionLog(projections: ProjectionRegistry, log: (line: UnknownSeatingLine) => void): void {
  const slot = slots.get(projections);
  if (slot === undefined) return;
  slot.log = log;
  for (const line of slot.pending.splice(0)) log(line);
}

/** SG-5: the `tables` projection of one registry (its log slot is that registry's). */
export function tablesProjection(projections: ProjectionRegistry): Projection {
  const slot: LogSlot = { log: null, pending: [] };
  slots.set(projections, slot);
  const emit = (line: UnknownSeatingLine): void => {
    if (slot.log === null) slot.pending.push(line);
    else slot.log(line);
  };
  return {
    name: 'tables',
    eventTypes: [...TABLES_EVENT_TYPES],
    apply(tx, event, mode) {
      applyState(tx, event, mode === 'live' ? emit : () => undefined);
    },
    reset(tx) {
      tx.prepare('DELETE FROM seatings').run();
      tx.prepare('DELETE FROM seating_tables').run();
      tx.prepare('DELETE FROM seating_orders').run();
      tx.prepare('DELETE FROM table_locks').run();
    },
  };
}

// The state part (this task). Lock-only events (TableLocked, TableLockTouched, TableLockReleased) and the
// activity-only order events (ItemRemoved, LineWeightSet, LineComped) change no seating row.
function applyState(tx: Database.Database, event: PosEvent, log: (line: UnknownSeatingLine) => void): void {
  const at = event.recorded_at;
  switch (event.event_type) {
    case 'TableOpened': {
      const p = event.payload as TableOpenedPayload;
      tx.prepare(
        `INSERT INTO seatings (seating_id, primary_table_id, state, holder_staff_id, party_size, opened_at)
         VALUES (?, ?, 'SEATED', ?, ?, ?)`,
      ).run(p.seating_id, p.table_id, p.holder_staff_id, p.party_size, at);
      tx.prepare('INSERT INTO seating_tables (table_id, seating_id, joined_at) VALUES (?, ?, ?)').run(p.table_id, p.seating_id, at);
      return;
    }
    case 'TableHolderChanged': {
      const p = event.payload as TableHolderChangedPayload;
      tx.prepare(`UPDATE seatings SET holder_staff_id = ? WHERE seating_id = ? AND state <> 'CLOSED'`).run(p.to_staff_id, p.seating_id);
      return;
    }
    case 'TableMoved': {
      const p = event.payload as TableMovedPayload;
      tx.prepare(`UPDATE seatings SET primary_table_id = ? WHERE seating_id = ? AND state <> 'CLOSED'`).run(p.to_table_id, p.seating_id);
      tx.prepare('UPDATE seating_tables SET table_id = ? WHERE table_id = ? AND seating_id = ?').run(
        p.to_table_id,
        p.from_table_id,
        p.seating_id,
      );
      return;
    }
    case 'TablesMerged':
      return applyMerged(tx, event.payload as TablesMergedPayload, at);
    case 'SeatingSplit':
      return applySplit(tx, event.payload as SeatingSplitPayload, at);
    case 'BillRequested': {
      const p = event.payload as BillRequestedPayload;
      tx.prepare(`UPDATE seatings SET bill_requested_at = ? WHERE seating_id = ? AND state <> 'CLOSED'`).run(at, p.seating_id);
      refold(tx, p.seating_id);
      return;
    }
    case 'BillClosed': {
      const p = event.payload as BillClosedPayload;
      tx.prepare(`UPDATE seatings SET bill_closed = 1 WHERE seating_id = ? AND state <> 'CLOSED'`).run(p.seating_id);
      refold(tx, p.seating_id);
      return;
    }
    case 'TableCleaned': {
      const p = event.payload as TableCleanedPayload;
      tx.prepare(
        `UPDATE seatings SET state = 'CLOSED', closed_at = ?, close_reason = ? WHERE seating_id = ? AND state <> 'CLOSED'`,
      ).run(at, p.reason, p.seating_id);
      tx.prepare('DELETE FROM seating_tables WHERE seating_id = ?').run(p.seating_id);
      return;
    }
    case 'OrderPlaced':
      return applyPlaced(tx, event, log);
    case 'OrderLinesAdded':
    case 'OrderCancelled':
    case 'OrderFoodServed':
    case 'OrderFoodCleared':
      return applyOrderFold(tx, event);
    default:
      return;
  }
}

// §3.1 / P-1d: the order folds, through seating_orders as of this event; an order of no seating is not 02a's.
function applyOrderFold(tx: Database.Database, event: PosEvent): void {
  const orderId = (event.payload as { order_id: string }).order_id;
  const seatingId = orderSeating(tx, orderId);
  if (seatingId === null) return;
  switch (event.event_type) {
    case 'OrderLinesAdded': {
      tx.prepare('UPDATE seating_orders SET served_any = 0 WHERE order_id = ?').run(orderId);
      tx.prepare(`UPDATE seatings SET bill_requested_at = NULL WHERE seating_id = ? AND state <> 'CLOSED'`).run(seatingId);
      refold(tx, seatingId);
      return;
    }
    case 'OrderCancelled': {
      tx.prepare('UPDATE seating_orders SET cancelled = 1 WHERE order_id = ?').run(orderId);
      // §3.1: OrderCancelled clears the bill request when no live order is left.
      tx.prepare(
        `UPDATE seatings SET bill_requested_at = NULL
         WHERE seating_id = ? AND state <> 'CLOSED'
           AND NOT EXISTS (SELECT 1 FROM seating_orders WHERE seating_id = ? AND cancelled = 0)`,
      ).run(seatingId, seatingId);
      refold(tx, seatingId);
      return;
    }
    case 'OrderFoodServed': {
      tx.prepare('UPDATE seating_orders SET served_any = 1, has_food = 1 WHERE order_id = ?').run(orderId);
      refold(tx, seatingId);
      return;
    }
    case 'OrderFoodCleared': {
      const p = event.payload as OrderFoodClearedPayload;
      if (p.food_served) tx.prepare('UPDATE seating_orders SET served_any = 1 WHERE order_id = ?').run(orderId);
      else tx.prepare('UPDATE seating_orders SET has_food = 0 WHERE order_id = ?').run(orderId);
      refold(tx, seatingId);
      return;
    }
    default:
      return;
  }
}

const DINE_IN_PREFIX = 'dine_in:';

// §5 / T21: only `dine_in`; the seating = table_key without its `dine_in:` prefix, if that is an open seating.
function applyPlaced(tx: Database.Database, event: PosEvent, log: (line: UnknownSeatingLine) => void): void {
  const p = event.payload as OrderPlacedPayload;
  if (p.order_type !== 'dine_in') return;
  const seatingId = p.table_key.startsWith(DINE_IN_PREFIX) ? p.table_key.slice(DINE_IN_PREFIX.length) : null;
  const open =
    seatingId !== null &&
    tx.prepare(`SELECT 1 FROM seatings WHERE seating_id = ? AND state <> 'CLOSED'`).get(seatingId) !== undefined;
  if (!open || seatingId === null) {
    log({ order_id: p.order_id, table_key: p.table_key });
    return;
  }
  tx.prepare('INSERT INTO seating_orders (order_id, seating_id, has_food) VALUES (?, ?, ?)').run(
    p.order_id,
    seatingId,
    p.has_food === false ? 0 : 1,
  );
  tx.prepare('UPDATE seatings SET bill_requested_at = NULL WHERE seating_id = ?').run(seatingId);
  refold(tx, seatingId);
}

// §3.11: join (FREE tables) or absorb (S2's orders and tables move to S, S2 closes `merged`); S's bill request
// is cleared when S2 brings an order (order_ids non-empty). S's holder and primary stay.
function applyMerged(tx: Database.Database, p: TablesMergedPayload, at: number): void {
  if (p.absorbed_seating_id !== null) {
    tx.prepare('UPDATE seating_tables SET seating_id = ?, joined_at = ? WHERE seating_id = ?').run(
      p.into_seating_id,
      at,
      p.absorbed_seating_id,
    );
    tx.prepare(
      `UPDATE seatings SET state = 'CLOSED', closed_at = ?, close_reason = 'merged' WHERE seating_id = ? AND state <> 'CLOSED'`,
    ).run(at, p.absorbed_seating_id);
  }
  const join = tx.prepare(
    `INSERT INTO seating_tables (table_id, seating_id, joined_at) VALUES (?, ?, ?)
     ON CONFLICT (table_id) DO UPDATE SET seating_id = excluded.seating_id, joined_at = excluded.joined_at`,
  );
  for (const tableId of p.table_ids) join.run(tableId, p.into_seating_id, at);
  if (p.order_ids.length > 0) {
    tx.prepare('UPDATE seating_orders SET seating_id = ? WHERE order_id IN (SELECT value FROM json_each(?)) AND seating_id = ?').run(
      p.into_seating_id,
      JSON.stringify(p.order_ids),
      p.absorbed_seating_id,
    );
    tx.prepare(`UPDATE seatings SET bill_requested_at = NULL WHERE seating_id = ? AND state <> 'CLOSED'`).run(p.into_seating_id);
  }
  refold(tx, p.into_seating_id);
}

// §3.12: a new seating on to_table_id with the listed whole orders of S (holder = S's), or detach (new_seating_id null).
// A from seating that is not open writes nothing.
function applySplit(tx: Database.Database, p: SeatingSplitPayload, at: number): void {
  if (tx.prepare(`SELECT 1 FROM seatings WHERE seating_id = ? AND state <> 'CLOSED'`).get(p.from_seating_id) === undefined) return;
  if (p.new_seating_id === null) {
    tx.prepare('DELETE FROM seating_tables WHERE table_id = ? AND seating_id = ?').run(p.to_table_id, p.from_seating_id);
    refold(tx, p.from_seating_id);
    return;
  }
  tx.prepare(
    `INSERT INTO seatings (seating_id, primary_table_id, state, holder_staff_id, party_size, opened_at)
     SELECT ?, ?, 'SEATED', holder_staff_id, NULL, ? FROM seatings WHERE seating_id = ?`,
  ).run(p.new_seating_id, p.to_table_id, at, p.from_seating_id);
  tx.prepare(
    `INSERT INTO seating_tables (table_id, seating_id, joined_at) VALUES (?, ?, ?)
     ON CONFLICT (table_id) DO UPDATE SET seating_id = excluded.seating_id, joined_at = excluded.joined_at`,
  ).run(p.to_table_id, p.new_seating_id, at);
  tx.prepare('UPDATE seating_orders SET seating_id = ? WHERE order_id IN (SELECT value FROM json_each(?)) AND seating_id = ?').run(
    p.new_seating_id,
    JSON.stringify(p.order_ids),
    p.from_seating_id,
  );
  refold(tx, p.from_seating_id);
  refold(tx, p.new_seating_id);
}

function orderSeating(tx: Database.Database, orderId: string): string | null {
  const row = tx.prepare('SELECT seating_id FROM seating_orders WHERE order_id = ?').get(orderId) as { seating_id: string } | undefined;
  return row?.seating_id ?? null;
}

// Runs foldState over one open seating (a CLOSED seating is never re-folded): one read, at most one write.
function refold(tx: Database.Database, seatingId: string): void {
  const row = tx
    .prepare(
      `SELECT s.state, s.bill_closed, s.bill_requested_at,
              COALESCE(SUM(o.cancelled = 0), 0) AS live_orders,
              COALESCE(SUM(o.cancelled = 0 AND o.has_food = 1), 0) AS live_food_orders,
              COALESCE(SUM(o.cancelled = 0 AND o.has_food = 1 AND o.served_any = 0), 0) AS unserved_food_orders
       FROM seatings s LEFT JOIN seating_orders o ON o.seating_id = s.seating_id
       WHERE s.seating_id = ? AND s.state <> 'CLOSED'
       GROUP BY s.seating_id`,
    )
    .get(seatingId) as (FoldInput & { state: OpenState }) | undefined;
  if (row === undefined) return;
  const next = foldState(row);
  if (next !== row.state) tx.prepare('UPDATE seatings SET state = ? WHERE seating_id = ?').run(next, seatingId);
}
