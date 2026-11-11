import type {
  AlertClosedPayload,
  HandoverPayload,
  ItemRemovedPayload,
  ItemReturnedPayload,
  ItemServedPayload,
  ItemVoidedPayload,
  OrderCancelledPayload,
  PosEvent,
  ReadyRetargetedPayload,
  ReadyToServePayload,
  ReadyToServeUndonePayload,
} from '@pos/events';
import type Database from 'better-sqlite3';
import type { Projection, ProjectionRegistry } from '../projections/registry.js';

// 03b §5 projection `pass` (with reset): pass_orders, pass_ready_lines, handovers, handover_lines. §3.5 Settling:
// ItemServed, ItemReturned, OrderCancelled and a whole-line ItemRemoved settle the lines; ItemRemoved { units } /
// ItemVoided { units } settle when the line's live units (`order_lines`: units − removed_units − voided_units, the
// 02b T19 exception) reach 0. Settling touches only rows with settled_at IS NULL, and handovers.open_lines drops by
// the handover_lines rows that statement changed, so a second settle of a line changes nothing. A decrement that
// would break CHECK (open_lines >= 0) logs `kds.fold_skipped` and is skipped: every fold is total (R8). Times are the
// envelope recorded_at. Live and catch-up fold the same way; in catch-up `order_lines` is at the tip (§5 note).

export const PASS_EVENT_TYPES: readonly string[] = [
  'ReadyToServe',
  'ReadyToServeUndone',
  'Handover',
  'ReadyRetargeted',
  'AlertClosed',
  'ItemServed',
  'ItemReturned',
  'ItemRemoved',
  'ItemVoided',
  'OrderCancelled',
];

/** The one `kds.fold_skipped` line (ids and counts only). */
export interface PassFoldSkipped {
  handover_id: string;
  /** handover_lines rows the settle changed (the decrement that was not applied) */
  settled: number;
}

interface LogSlot {
  log: ((line: PassFoldSkipped) => void) | null;
  pending: PassFoldSkipped[];
}

// As the tables projection (tables/projection.ts): boot replays projections before the server log exists, so lines
// wait here until bindPassProjectionLog binds a log (lane B4's register).
const slots = new WeakMap<ProjectionRegistry, LogSlot>();

/** Binds the hub log for `kds.fold_skipped`; flushes lines written before. */
export function bindPassProjectionLog(projections: ProjectionRegistry, log: (line: PassFoldSkipped) => void): void {
  const slot = slots.get(projections);
  if (slot === undefined) return;
  slot.log = log;
  for (const line of slot.pending.splice(0)) log(line);
}

/** §5: the `pass` projection. With `projections`, its skip lines go to that registry's bound log. */
export function passProjection(projections?: ProjectionRegistry): Projection {
  const slot: LogSlot = { log: null, pending: [] };
  if (projections !== undefined) slots.set(projections, slot);
  const emit = (line: PassFoldSkipped): void => {
    if (slot.log === null) slot.pending.push(line);
    else slot.log(line);
  };
  return {
    name: 'pass',
    eventTypes: [...PASS_EVENT_TYPES],
    apply(tx, event) {
      applyPass(tx, event, emit);
    },
    reset(tx) {
      tx.prepare('DELETE FROM pass_orders').run();
      tx.prepare('DELETE FROM pass_ready_lines').run();
      tx.prepare('DELETE FROM handovers').run();
      tx.prepare('DELETE FROM handover_lines').run();
    },
  };
}

type Emit = (line: PassFoldSkipped) => void;

function applyPass(tx: Database.Database, event: PosEvent, emit: Emit): void {
  const at = event.recorded_at;
  switch (event.event_type) {
    case 'ReadyToServe':
      return applyReady(tx, event, event.payload as ReadyToServePayload);
    case 'ReadyToServeUndone': {
      // §3.5 UndoReadyToServe / §3.2 step 5: the Ready is gone (its alert closes `undone` by its own AlertClosed).
      const p = event.payload as ReadyToServeUndonePayload;
      tx.prepare(
        `UPDATE pass_orders SET ready_at = NULL, ready_by = NULL, ready_alert_id = NULL, ready_table_id = NULL
         WHERE order_id = ? AND point_id = ?`,
      ).run(p.order_id, p.point_id);
      tx.prepare('DELETE FROM pass_ready_lines WHERE order_id = ? AND point_id = ?').run(p.order_id, p.point_id);
      return;
    }
    case 'ReadyRetargeted': {
      // §3.5 Re-target (§6.18): the open Ready follows the new primary table under its new alert.
      const p = event.payload as ReadyRetargetedPayload;
      tx.prepare('UPDATE pass_orders SET ready_alert_id = ?, ready_table_id = ? WHERE order_id = ? AND point_id = ? AND ready_at IS NOT NULL').run(
        p.alert_id,
        p.table_id,
        p.order_id,
        p.point_id,
      );
      return;
    }
    case 'Handover':
      return applyHandover(tx, at, event.payload as HandoverPayload);
    case 'AlertClosed': {
      // A closed Ready alert leaves pass_orders_open (ready_at / ready_by stay); a closed Served card gets card_closed_at.
      const p = event.payload as AlertClosedPayload;
      tx.prepare('UPDATE pass_orders SET ready_alert_id = NULL WHERE ready_alert_id = ?').run(p.alert_id);
      tx.prepare(
        `UPDATE handovers SET card_closed_at = ?
         WHERE served_card_alert_id = ? AND served_card_alert_id IS NOT NULL AND card_closed_at IS NULL`,
      ).run(at, p.alert_id);
      return;
    }
    case 'ItemServed':
      return settleLines(tx, at, (event.payload as ItemServedPayload).order_item_ids, emit);
    case 'ItemReturned':
      return settleLines(tx, at, [(event.payload as ItemReturnedPayload).order_item_id], emit);
    case 'ItemRemoved': {
      const p = event.payload as ItemRemovedPayload;
      if (p.units === undefined) settleLines(tx, at, [p.order_item_id], emit);
      else settleAtZero(tx, at, p.order_item_id, emit);
      return;
    }
    case 'ItemVoided':
      return settleAtZero(tx, at, (event.payload as ItemVoidedPayload).order_item_id, emit);
    case 'OrderCancelled':
      return settleOrder(tx, at, (event.payload as OrderCancelledPayload).order_id, emit);
    default:
      return;
  }
}

// §3.5 MarkReadyToServe step 6 / Handover step 5: the Ready of (order, point) with its own lines; a later Ready
// replaces the lines of an earlier one (only its own lines keep it open, §3.5 Closing).
function applyReady(tx: Database.Database, event: PosEvent, p: ReadyToServePayload): void {
  tx.prepare(
    `INSERT INTO pass_orders (order_id, point_id, ready_at, ready_by, ready_alert_id, ready_table_id)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (order_id, point_id) DO UPDATE SET
       ready_at = excluded.ready_at, ready_by = excluded.ready_by,
       ready_alert_id = excluded.ready_alert_id, ready_table_id = excluded.ready_table_id`,
  ).run(p.order_id, p.point_id, event.recorded_at, event.actor_id, p.alert_id, p.table_id);
  tx.prepare('DELETE FROM pass_ready_lines WHERE order_id = ? AND point_id = ?').run(p.order_id, p.point_id);
  tx.prepare(
    `INSERT OR IGNORE INTO pass_ready_lines (order_item_id, order_id, point_id, settled_at)
     SELECT value, ?, ?, NULL FROM json_each(?)`,
  ).run(p.order_id, p.point_id, JSON.stringify(p.order_item_ids));
}

// §3.5 Handover step 8: the card and its lines; open_lines = the lines this hand-over took. A replayed handover_id
// (or a line already in a hand-over) changes nothing.
function applyHandover(tx: Database.Database, at: number, p: HandoverPayload): void {
  const inserted = tx
    .prepare(
      `INSERT INTO handovers (handover_id, order_id, point_id, receiver_staff_id, handed_at, open_lines, served_card_alert_id, card_closed_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, NULL)
       ON CONFLICT (handover_id) DO NOTHING`,
    )
    .run(p.handover_id, p.order_id, p.point_id, p.receiver_staff_id, at, p.alert_id);
  if (inserted.changes === 0) return;
  const lines = tx
    .prepare(
      `INSERT INTO handover_lines (order_item_id, handover_id, settled_at)
       SELECT DISTINCT value, ?, NULL FROM json_each(?) WHERE true
       ON CONFLICT (order_item_id) DO NOTHING`,
    )
    .run(p.handover_id, JSON.stringify(p.order_item_ids));
  tx.prepare('UPDATE handovers SET open_lines = ? WHERE handover_id = ?').run(lines.changes, p.handover_id);
}

// §7: every settle is a fixed 3 statements (pass_ready_lines, handover_lines RETURNING, one handovers decrement),
// whatever the number of lines or hand-overs.
//
// settled_at (pass_ready_lines, handover_lines) is NOT stable across a rebuild: catch-up reads order_lines at the tip,
// so a line removed to 0 in two partial events settles at the first one (R-3, §5 note). Read it only as
// `settled_at IS NULL` / `IS NOT NULL`, never its value.

function settleLines(tx: Database.Database, at: number, order_item_ids: readonly string[], emit: Emit): void {
  const ids = JSON.stringify(order_item_ids);
  const inIds = 'order_item_id IN (SELECT value FROM json_each(?))';
  settle(tx, at, emit, { sql: inIds, args: [ids] }, { sql: inIds, args: [ids] });
}

/** §5 note: a partial ItemRemoved / ItemVoided settles when the line's live units in `order_lines` (units −
 * removed_units − voided_units, 02b T19 exception) reach 0; no `order_lines` row → NULL → never settled by units. */
function settleAtZero(tx: Database.Database, at: number, order_item_id: string, emit: Emit): void {
  const where = {
    sql: `order_item_id = ? AND (SELECT o.units - o.removed_units - o.voided_units FROM order_lines o WHERE o.order_item_id = ?) <= 0`,
    args: [order_item_id, order_item_id],
  };
  settle(tx, at, emit, where, where);
}

// OrderCancelled: every line of the order. Hand-overs of the order with open lines through handovers_unsettled.
function settleOrder(tx: Database.Database, at: number, order_id: string, emit: Emit): void {
  settle(
    tx,
    at,
    emit,
    { sql: 'order_id = ?', args: [order_id] },
    { sql: 'handover_id IN (SELECT handover_id FROM handovers WHERE open_lines > 0 AND order_id = ?)', args: [order_id] },
  );
}

interface Where {
  sql: string;
  args: unknown[];
}

/**
 * Settles the unsettled rows matching `ready` / `handed`; open_lines −= the handover_lines rows that statement changed,
 * per hand-over, in one statement. A decrement that would go below 0 is not applied: logged `kds.fold_skipped`.
 */
function settle(tx: Database.Database, at: number, emit: Emit, ready: Where, handed: Where): void {
  tx.prepare(`UPDATE pass_ready_lines SET settled_at = ? WHERE settled_at IS NULL AND ${ready.sql}`).run(at, ...ready.args);
  const changed = tx
    .prepare(`UPDATE handover_lines SET settled_at = ? WHERE settled_at IS NULL AND ${handed.sql} RETURNING handover_id`)
    .all(at, ...handed.args) as Array<{ handover_id: string }>;
  const counts = new Map<string, number>();
  for (const { handover_id } of changed) counts.set(handover_id, (counts.get(handover_id) ?? 0) + 1);
  const applied = tx
    .prepare(
      `UPDATE handovers SET open_lines = open_lines - c.n
       FROM (SELECT key AS handover_id, value AS n FROM json_each(?)) AS c
       WHERE handovers.handover_id = c.handover_id AND handovers.open_lines >= c.n
       RETURNING handovers.handover_id AS handover_id`,
    )
    .all(JSON.stringify(Object.fromEntries(counts))) as Array<{ handover_id: string }>;
  if (applied.length === counts.size) return;
  const done = new Set(applied.map((r) => r.handover_id));
  for (const [handover_id, settled] of counts) if (!done.has(handover_id)) emit({ handover_id, settled });
}
