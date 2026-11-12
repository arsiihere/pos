import { DomainError } from '@pos/domain';
import { TicketReprinted, draftOf } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';

// 03c §3.5, §6.1, §3.10 (task c9): ReprintTicket { ticket_id? , order_id? } (exactly one). A station session reprints
// its own station's tickets (stationScoped; ctx.permission is null and the handler checks the station); a staff
// session needs `reprint-ticket` (Cook by default, 03b B-1). Writes TicketReprinted { order_id, station_id | null,
// ticket_ids } on the order stream; `kitchen_tickets` folds it into `reprint` jobs (live, c8). Statements ≤ 2.

const Payload = z
  .object({ ticket_id: z.string().min(1).optional(), order_id: z.string().min(1).optional() })
  .refine((p) => (p.ticket_id === undefined) !== (p.order_id === undefined), { message: 'exactly one of ticket_id, order_id', path: ['ticket_id'] });

interface TicketRow {
  ticket_id: string;
  station_id: string;
  order_id: string;
  live: number;
  /** the station's current output has a printer (any mode; §6.8 has_printer) */
  has_printer: number;
}

/** Why a ticket was not reprinted (integrator reading): no printer at its station, or no live line. */
type Skipped = { ticket_id: string; reason: 'no_printer' | 'nothing_live' };

/**
 * A ticket's live lines: units left (`units − removed − voided > 0`), done or not, as c10's reprint render prints
 * them (§3.6 "`reprint` prints every live line"); a ticket without one is skipped (§3.5 "Nothing live → result.skipped").
 */
const TICKETS = `SELECT t.ticket_id, t.station_id, t.order_id,
       EXISTS (SELECT 1 FROM ticket_lines tl JOIN order_lines ol ON ol.order_item_id = tl.order_item_id
               WHERE tl.ticket_id = t.ticket_id AND ol.units - ol.removed_units - ol.voided_units > 0) AS live,
       so.printer_id IS NOT NULL AS has_printer
FROM tickets t LEFT JOIN station_outputs so ON so.station_id = t.station_id`;

export const reprintTicketCommand = defineCommand({
  commandType: 'ReprintTicket',
  payloadSchema: Payload,
  sessionKind: 'device',
  permission: 'reprint-ticket',
  stationScoped: true,
  handle(ctx, payload) {
    const db = ctx.tx.db;
    const station = ctx.actor.kind === 'station' ? ctx.actor.stationId : null;
    let tickets: TicketRow[];
    let order_id: string;
    if (payload.ticket_id !== undefined) {
      const ticket = db.prepare(`${TICKETS} WHERE t.ticket_id = ?`).get(payload.ticket_id) as TicketRow | undefined;
      if (ticket === undefined) throw new DomainError('ORDER_NOT_FOUND', { ticket_id: payload.ticket_id });
      if (station !== null && ticket.station_id !== station) {
        throw new DomainError('PERMISSION_DENIED', { permission: 'reprint-ticket', reason: 'outside_scope', station_id: ticket.station_id });
      }
      tickets = [ticket];
      order_id = ticket.order_id;
    } else {
      order_id = payload.order_id!;
      if (db.prepare('SELECT 1 FROM orders WHERE order_id = ?').pluck().get(order_id) === undefined) {
        throw new DomainError('ORDER_NOT_FOUND', { order_id });
      }
      const all = db.prepare(`${TICKETS} WHERE t.order_id = ? ORDER BY t.fired_at, t.ticket_id`).all(order_id) as TicketRow[];
      // a station session: only its station's tickets of that order
      tickets = station === null ? all : all.filter((t) => t.station_id === station);
    }
    // only stations with a printer reprint (the Pass shows Reprint where has_printer, §3.5); then only live tickets
    const ticket_ids = tickets.filter((t) => t.has_printer === 1 && t.live === 1).map((t) => t.ticket_id);
    const skipped: Skipped[] = tickets
      .filter((t) => t.has_printer !== 1 || t.live !== 1)
      .map((t) => ({ ticket_id: t.ticket_id, reason: t.has_printer !== 1 ? 'no_printer' : 'nothing_live' }));
    if (ticket_ids.length === 0) return { events: [], result: { ticket_ids, skipped } };
    const event = draftOf(TicketReprinted, {
      stream_type: 'order',
      stream_id: order_id,
      payload: { order_id, station_id: station, ticket_ids },
      occurred_at: ctx.clock.branchNow(),
      actor_id: ctx.actor.staffId,
      device_id: ctx.actor.deviceId,
    });
    return { events: [event], result: { ticket_ids, skipped } };
  },
});

export function registerReprintTicket(app: FastifyInstance): void {
  commandRegistry(app).register(reprintTicketCommand);
}
