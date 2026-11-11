import type { FireDispatchedPayload, ItemDonePayload, ItemDoneUndonePayload, ItemServedPayload, PosEvent } from '@pos/events';
import type Database from 'better-sqlite3';
import type { Projection, ProjectionRegistry } from '../projections/registry.js';

// 03c §3.3 (task c7): projection `kitchen_tickets`, forward-only (no `reset`), registered after 02b's `orders` and
// 03b's projections. `tickets` / `ticket_lines` are written in both modes (INSERT OR IGNORE); `print_jobs` and
// `print_fold_skips` only when mode === 'live', never in 'catchup' (D1: a replay never prints history).
// Total (R8): any unexpected shape or failure → the event's own writes roll back to a savepoint, `print.fold_skipped`
// is logged, and in live mode a station with any printer gets a `print_fold_skips` row. The fold never throws.
// 02b T19 exception (recorded in §3.3): the fold reads `order_lines.order_id` for the fired ids; 02b's projection
// applies first in both modes (registration order).

export interface FoldSkippedLine {
  event_id: string;
  event_type: string;
  station_id: string | null;
  reason: string;
}

interface LogSlot {
  log: ((line: FoldSkippedLine) => void) | null;
  pending: FoldSkippedLine[];
}

// As the tables projection: boot replays projections before the server log exists, so lines wait for bindTicketsLog.
const slots = new WeakMap<ProjectionRegistry, LogSlot>();

/** Binds the hub log for `print.fold_skipped` (ids and reasons only); flushes lines written before. */
export function bindTicketsLog(projections: ProjectionRegistry, log: (line: FoldSkippedLine) => void): void {
  const slot = slots.get(projections);
  if (slot === undefined) return;
  slot.log = log;
  for (const line of slot.pending.splice(0)) log(line);
}

/** A fold refusal: the event is skipped with this reason. */
class FoldSkip extends Error {
  constructor(
    readonly reason: string,
    readonly orderIds: string[] = [],
  ) {
    super(reason);
  }
}

/** Logs a skipped fold and, live, records a `print_fold_skips` row for a station with a printer. Never throws. */
type Skip = (error: unknown, station_id: string | null) => void;

export const TICKETS_EVENT_TYPES = ['FireDispatched', 'ItemDone', 'ItemServed', 'ItemDoneUndone'] as const;

export function ticketsProjection(projections: ProjectionRegistry): Projection {
  const slot: LogSlot = { log: null, pending: [] };
  slots.set(projections, slot);
  const emit = (line: FoldSkippedLine): void => {
    if (slot.log === null) slot.pending.push(line);
    else slot.log(line);
  };
  return {
    name: 'kitchen_tickets',
    eventTypes: [...TICKETS_EVENT_TYPES],
    apply(tx, event, mode) {
      const skip: Skip = (error, station_id) => {
        const reason = error instanceof FoldSkip ? error.reason : 'fold_error';
        emit({ event_id: event.event_id, event_type: event.event_type, station_id, reason });
        if (mode === 'live' && station_id !== null) recordSkip(tx, event, station_id, reason, error instanceof FoldSkip ? error.orderIds : []);
      };
      try {
        // a nested better-sqlite3 transaction is a savepoint: a throw undoes only this event's writes
        tx.transaction(() => applyEvent(tx, event, mode, skip))();
      } catch (error) {
        skip(error, event.event_type === 'FireDispatched' ? stationOf(event) : null);
      }
    },
  };
}

function stationOf(event: PosEvent): string | null {
  const station_id = (event.payload as { station_id?: unknown }).station_id;
  return typeof station_id === 'string' && station_id.length > 0 ? station_id : null;
}

function applyEvent(tx: Database.Database, event: PosEvent, mode: 'live' | 'catchup', skip: Skip): void {
  switch (event.event_type) {
    case 'FireDispatched':
      applyFire(tx, event, mode, skip);
      return;
    case 'ItemDone': {
      const p = event.payload as ItemDonePayload;
      // 03a: the engine uses min(done_at, recorded_at)
      tx.prepare('UPDATE ticket_lines SET done_at = ? WHERE order_item_id = ?').run(Math.min(p.done_at, event.recorded_at), p.order_item_id);
      return;
    }
    case 'ItemServed': {
      const p = event.payload as ItemServedPayload;
      tx.prepare(
        `UPDATE ticket_lines SET done_at = ? WHERE done_at IS NULL AND order_item_id IN (SELECT value FROM json_each(?))`,
      ).run(p.served_at ?? event.recorded_at, JSON.stringify(p.order_item_ids));
      return;
    }
    case 'ItemDoneUndone': {
      const p = event.payload as ItemDoneUndonePayload;
      tx.prepare('UPDATE ticket_lines SET done_at = NULL WHERE order_item_id = ?').run(p.order_item_id);
      return;
    }
  }
}

// §3.3 FireDispatched: group by order (1 read); one `tickets` row per order, one `ticket_lines` row per id (multi-row
// inserts); live with output `both` / `printer` (1 read) → a `kitchen` job per ticket, `job_id = ticket_id + ':kitchen'`.
// Only a bad payload or a missing line skips the tickets: the live-only job part runs in its own savepoint, so a bad
// output skips the jobs and keeps the ticket rows (live = rebuild, D1). A line already on an earlier ticket (a fire
// re-listing it) is left there: only new lines make tickets, and a fire with none makes no ticket and no job.
function applyFire(tx: Database.Database, event: PosEvent, mode: 'live' | 'catchup', skip: Skip): void {
  const p = event.payload as FireDispatchedPayload;
  if (typeof p.station_id !== 'string' || p.station_id.length === 0 || !Array.isArray(p.order_item_ids) || p.order_item_ids.length === 0) {
    throw new FoldSkip('bad_payload');
  }
  const rows = tx
    .prepare(
      `SELECT j.value AS order_item_id, ol.order_id, tl.ticket_id AS existing
       FROM json_each(?) j
       LEFT JOIN order_lines ol ON ol.order_item_id = j.value
       LEFT JOIN ticket_lines tl ON tl.order_item_id = j.value`,
    )
    .all(JSON.stringify(p.order_item_ids)) as Array<{ order_item_id: string; order_id: string | null; existing: string | null }>;
  const orderIds = [...new Set(rows.flatMap((r) => (r.order_id === null ? [] : [r.order_id])))];
  if (rows.some((r) => r.order_id === null)) throw new FoldSkip('line_missing', orderIds);
  const fresh = rows.filter((r) => r.existing === null);
  if (fresh.length === 0) return;
  const tickets = [...new Set(fresh.map((r) => r.order_id!))].map((order_id) => ({ ticket_id: `${event.event_id}:${order_id}`, order_id }));
  tx.prepare(
    `INSERT OR IGNORE INTO tickets (ticket_id, station_id, order_id, fire_event_id, fired_at, reason)
     SELECT json_extract(value, '$.ticket_id'), ?, json_extract(value, '$.order_id'), ?, ?, ? FROM json_each(?)`,
  ).run(p.station_id, event.event_id, event.recorded_at, p.reason, JSON.stringify(tickets));
  const lines = fresh.map((r) => ({ order_item_id: r.order_item_id, ticket_id: `${event.event_id}:${r.order_id!}` }));
  tx.prepare(
    `INSERT OR IGNORE INTO ticket_lines (order_item_id, ticket_id, station_id, done_at)
     SELECT json_extract(value, '$.order_item_id'), json_extract(value, '$.ticket_id'), ?, NULL FROM json_each(?)`,
  ).run(p.station_id, JSON.stringify(lines));
  if (mode !== 'live') return;
  try {
    tx.transaction(() => queueFireJobs(tx, event, p.station_id, tickets))();
  } catch (error) {
    skip(error instanceof FoldSkip ? error : new FoldSkip('fold_error', tickets.map((t) => t.order_id)), p.station_id);
  }
}

function queueFireJobs(tx: Database.Database, event: PosEvent, station_id: string, tickets: Array<{ ticket_id: string; order_id: string }>): void {
  const orderIds = tickets.map((t) => t.order_id);
  const output = tx.prepare('SELECT mode, printer_id FROM station_outputs WHERE station_id = ?').get(station_id) as
    | { mode: string; printer_id: string | null }
    | undefined;
  if (output !== undefined && !['screen', 'both', 'printer'].includes(output.mode)) throw new FoldSkip('bad_output', orderIds);
  if (output === undefined || output.mode === 'screen') return;
  if (output.printer_id === null) throw new FoldSkip('bad_output', orderIds);
  // printer_id NULL: a station job follows the station's current printer at send (§3.2)
  tx.prepare(
    `INSERT OR IGNORE INTO print_jobs (job_id, kind, printer_id, station_id, ticket_id, order_id, payload, created_at)
     SELECT json_extract(value, '$.ticket_id') || ':kitchen', 'kitchen', NULL, ?, json_extract(value, '$.ticket_id'),
            json_extract(value, '$.order_id'), json_object('ticket_id', json_extract(value, '$.ticket_id')), ?
     FROM json_each(?)`,
  ).run(station_id, event.recorded_at, JSON.stringify(tickets));
}

// §3.3: a skip row only when the station has any printer (`both`, `printer`, or `screen` with a fallback printer). An
// output that cannot be read counts as one: a skip is never silent where paper could be needed. Never throws.
function recordSkip(tx: Database.Database, event: PosEvent, station_id: string, reason: string, orderIds: string[]): void {
  try {
    let hasPrinter = true;
    try {
      const row = tx.prepare('SELECT printer_id FROM station_outputs WHERE station_id = ?').get(station_id) as { printer_id: unknown } | undefined;
      hasPrinter = row !== undefined && row.printer_id !== null;
    } catch {
      hasPrinter = true;
    }
    if (!hasPrinter) return;
    tx.prepare('INSERT OR IGNORE INTO print_fold_skips (event_id, station_id, order_ids, reason, at) VALUES (?, ?, ?, ?, ?)').run(
      event.event_id,
      station_id,
      JSON.stringify(orderIds),
      reason,
      event.recorded_at,
    );
  } catch {
    // R8: the fire commits even when the skip row cannot be written; the log line above still names it
  }
}
