import type {
  FireDispatchedPayload,
  ItemDonePayload,
  ItemDoneUndonePayload,
  ItemRemovedPayload,
  ItemServedPayload,
  ItemsReleasedPayload,
  ItemVoidedPayload,
  OrderBoostedPayload,
  PosEvent,
  TicketReprintedPayload,
} from '@pos/events';
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

export const TICKETS_EVENT_TYPES = [
  'FireDispatched',
  'ItemDone',
  'ItemServed',
  'ItemDoneUndone',
  'ItemRemoved',
  'ItemVoided',
  'OrderBoosted',
  'ItemsReleased',
  'TicketReprinted',
] as const;

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
    // c8: slip and reprint jobs are jobs, so live only (D1)
    case 'ItemRemoved':
    case 'ItemVoided':
      if (mode === 'live') applyCancel(tx, event, skip);
      return;
    case 'OrderBoosted':
    case 'ItemsReleased':
      if (mode === 'live') applyFirst(tx, event, skip);
      return;
    case 'TicketReprinted':
      if (mode === 'live') applyReprint(tx, event, skip);
      return;
  }
}

/**
 * §3.3 "a skip is never silent where paper could be needed": a failed slip / reprint job insert (one statement, so it
 * leaves nothing half-written) is logged and recorded as a `print_fold_skips` row naming the ticket's station; the
 * row is written when that station has a printer (recordSkip). A failure before the station is known logs only.
 */
function insertJobs(skip: Skip, station_id: string | null, insert: () => void): void {
  try {
    insert();
  } catch (error) {
    skip(error, station_id);
  }
}

/** §3.1 "printed": an uncancelled `kitchen` or `reprint` job of the ticket with `sent_at` set (SQL, ticket alias `t`). */
const PRINTED = `EXISTS (SELECT 1 FROM print_jobs j WHERE j.ticket_id = t.ticket_id AND j.kind IN ('kitchen', 'reprint')
                 AND j.cancelled_at IS NULL AND j.sent_at IS NOT NULL)`;

// §3.3 ItemRemoved { order_item_id, units? } / ItemVoided { order_item_id, units } on a not-done line of a printed
// ticket (1 read) → a `cancel` job `{ ticket_id, order_item_id, units: p.units ?? null }` (null = the whole line). Units
// left are rendered at send from order_lines (D2), so the fold never reads order_lines and fold order never changes them.
// v1.0.8 (04 Q-15): a moved void share adds `slip: 'moved'` to the payload (0 extra reads: the field is on the event).
function applyCancel(tx: Database.Database, event: PosEvent, skip: Skip): void {
  const p = event.payload as ItemRemovedPayload | ItemVoidedPayload;
  const ticket = tx
    .prepare(
      `SELECT t.ticket_id, t.station_id, t.order_id FROM ticket_lines tl JOIN tickets t ON t.ticket_id = tl.ticket_id
       WHERE tl.order_item_id = ? AND tl.done_at IS NULL AND ${PRINTED}`,
    )
    .get(p.order_item_id) as { ticket_id: string; station_id: string; order_id: string } | undefined;
  if (ticket === undefined) return;
  // 03c v1.0.8 §3.3 (04 Q-15 b): the share 04 moved to stock (ItemVoided { disposition: 'moved' }) → the same cancel job
  // with slip 'moved' (MOVED TO STOCK, §3.5); every other share and every ItemRemoved → no slip field → CANCELLED.
  const moved = event.event_type === 'ItemVoided' && (p as ItemVoidedPayload).disposition === 'moved';
  insertJobs(skip, ticket.station_id, () =>
    tx
      .prepare(
        `INSERT OR IGNORE INTO print_jobs (job_id, kind, printer_id, station_id, ticket_id, order_id, payload, created_at)
         VALUES (?, 'cancel', NULL, ?, ?, ?, ?, ?)`,
      )
      .run(
        `${event.event_id}:cancel:1`,
        ticket.station_id,
        ticket.ticket_id,
        ticket.order_id,
        JSON.stringify(
          moved
            ? { ticket_id: ticket.ticket_id, order_item_id: p.order_item_id, units: p.units ?? null, slip: 'moved' }
            : { ticket_id: ticket.ticket_id, order_item_id: p.order_item_id, units: p.units ?? null },
        ),
        event.recorded_at,
      ),
  );
}

// §3.3 OrderBoosted / ItemsReleased { expedite } → a `first` job per printed ticket with a not-done affected line, at a
// `printer` station only (1 read). Boost affects every line of the order; a release only its `expedite` ids (a pull is a
// FireDispatched of an unfired line, so it never yields FIRST, P9).
function applyFirst(tx: Database.Database, event: PosEvent, skip: Skip): void {
  const boost = event.event_type === 'OrderBoosted';
  const p = event.payload as OrderBoostedPayload | ItemsReleasedPayload;
  const expedite = boost ? null : (p as ItemsReleasedPayload).expedite;
  if (expedite !== null && expedite.length === 0) return;
  const tickets = tx
    .prepare(
      `SELECT t.ticket_id, t.station_id, t.order_id, json_group_array(tl.order_item_id) AS order_item_ids
       FROM tickets t
       JOIN ticket_lines tl ON tl.ticket_id = t.ticket_id AND tl.done_at IS NULL
       JOIN station_outputs so ON so.station_id = t.station_id AND so.mode = 'printer'
       WHERE t.order_id = ? AND (? IS NULL OR tl.order_item_id IN (SELECT value FROM json_each(?))) AND ${PRINTED}
       GROUP BY t.ticket_id ORDER BY t.ticket_id`,
    )
    .all(p.order_id, expedite === null ? null : 1, JSON.stringify(expedite ?? [])) as Array<{
    ticket_id: string;
    station_id: string;
    order_id: string;
    order_item_ids: string;
  }>;
  if (tickets.length === 0) return;
  const reason = boost ? 'boost' : 'expedite';
  const jobs = tickets.map((t, i) => ({
    job_id: `${event.event_id}:first:${i + 1}`,
    station_id: t.station_id,
    ticket_id: t.ticket_id,
    order_id: t.order_id,
    payload: JSON.stringify({ ticket_id: t.ticket_id, order_item_ids: (JSON.parse(t.order_item_ids) as string[]).sort(), reason }),
  }));
  insertJobs(skip, tickets[0]!.station_id, () =>
    tx
      .prepare(
        `INSERT OR IGNORE INTO print_jobs (job_id, kind, printer_id, station_id, ticket_id, order_id, payload, created_at)
         SELECT json_extract(value, '$.job_id'), 'first', NULL, json_extract(value, '$.station_id'), json_extract(value, '$.ticket_id'),
                json_extract(value, '$.order_id'), json_extract(value, '$.payload'), ?
         FROM json_each(?)`,
      )
      .run(event.recorded_at, JSON.stringify(jobs)),
  );
}

// §3.3 TicketReprinted { ticket_ids } → a `reprint` job per known ticket (1 multi-row insert), id event_id:reprint:n in
// payload order. ReprintTicket (c9) only names existing tickets; an unknown id is passed over.
function applyReprint(tx: Database.Database, event: PosEvent, skip: Skip): void {
  const p = event.payload as TicketReprintedPayload;
  try {
    tx.prepare(
      `INSERT OR IGNORE INTO print_jobs (job_id, kind, printer_id, station_id, ticket_id, order_id, payload, created_at)
       SELECT ? || ':reprint:' || (CAST(r.key AS INTEGER) + 1), 'reprint', NULL, t.station_id, t.ticket_id, t.order_id,
              json_object('ticket_id', t.ticket_id), ?
       FROM json_each(?) r JOIN tickets t ON t.ticket_id = r.value
       ORDER BY r.key`,
    ).run(event.event_id, event.recorded_at, JSON.stringify(p.ticket_ids));
  } catch (error) {
    // the station of the first named ticket (failure path only; the happy path stays 1 statement)
    let station_id: string | null = p.station_id ?? null;
    try {
      station_id ??= (tx
        .prepare('SELECT t.station_id FROM json_each(?) r JOIN tickets t ON t.ticket_id = r.value ORDER BY r.key LIMIT 1')
        .pluck()
        .get(JSON.stringify(p.ticket_ids)) ?? null) as string | null;
    } catch {
      station_id = null;
    }
    skip(error, station_id);
  }
}

/**
 * §3.3 re-creating a kitchen job (paper fallback, c17): the unique index counts only uncancelled kitchen jobs; a new one
 * after a cancel takes `ticket_id:kitchen:n` (n = earlier kitchen jobs + 1; the first is `ticket_id:kitchen`).
 * INSERT OR IGNORE, 1 statement; returns the job id, or null when the ticket still has a live kitchen job.
 */
export function queueKitchenJob(tx: Database.Database, ticket: { ticket_id: string; station_id: string; order_id: string }, at: number): string | null {
  const row = tx
    .prepare(
      `INSERT OR IGNORE INTO print_jobs (job_id, kind, printer_id, station_id, ticket_id, order_id, payload, created_at)
       SELECT CASE WHEN n = 0 THEN @ticket_id || ':kitchen' ELSE @ticket_id || ':kitchen:' || (n + 1) END, 'kitchen', NULL,
              @station_id, @ticket_id, @order_id, json_object('ticket_id', @ticket_id), @at
       FROM (SELECT COUNT(*) AS n FROM print_jobs WHERE ticket_id = @ticket_id AND kind = 'kitchen')
       RETURNING job_id`,
    )
    .get({ ticket_id: ticket.ticket_id, station_id: ticket.station_id, order_id: ticket.order_id, at }) as { job_id: string } | undefined;
  return row?.job_id ?? null;
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
