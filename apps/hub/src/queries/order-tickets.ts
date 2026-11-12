import { DomainError } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineQuery, queryRegistry } from './registry.js';

// 03c §6.8, §3.5, §3.10 (task c9): GET /queries/order-tickets?order_id — staff session with `reprint-ticket` (checked
// here: queries have no permission field, gap sweep §1). `has_printer` = the station's current output has a printer
// (any mode; a `screen` station's fallback printer counts). Statements 2 (tickets with `printed`, then the outputs).

const Query = z.object({ order_id: z.string().min(1) });

export function registerOrderTicketsQuery(app: FastifyInstance): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'order-tickets',
      sessionKind: 'device',
      session: 'required',
      querySchema: Query,
      handle(ctx, q) {
        const staffId = ctx.session?.staff_id ?? null;
        const resolution = staffId === null ? { grant: 'not_granted' as const } : ctx.directory.resolve(staffId, 'reprint-ticket');
        if (resolution.grant !== 'allowed') throw new DomainError('PERMISSION_DENIED', { permission: 'reprint-ticket', grant: resolution.grant });
        // §3.1 printed: an uncancelled kitchen or reprint job with sent_at set
        const rows = ctx.db
          .prepare(
            `SELECT t.ticket_id, t.station_id, t.fired_at,
                    EXISTS (SELECT 1 FROM print_jobs j WHERE j.ticket_id = t.ticket_id AND j.kind IN ('kitchen', 'reprint')
                            AND j.cancelled_at IS NULL AND j.sent_at IS NOT NULL) AS printed
             FROM tickets t WHERE t.order_id = ? ORDER BY t.fired_at, t.ticket_id`,
          )
          .all(q.order_id) as Array<{ ticket_id: string; station_id: string; fired_at: number; printed: number }>;
        if (rows.length === 0) return { data: { tickets: [] } };
        const stationIds = [...new Set(rows.map((r) => r.station_id))];
        const withPrinter = new Set(
          ctx.db
            .prepare('SELECT station_id FROM station_outputs WHERE printer_id IS NOT NULL AND station_id IN (SELECT value FROM json_each(?))')
            .pluck()
            .all(JSON.stringify(stationIds)) as string[],
        );
        const names = new Map((ctx.branchConfig?.stations ?? []).map((s) => [s.station_id, s.name]));
        return {
          data: {
            tickets: rows.map((r) => ({
              ticket_id: r.ticket_id,
              station_id: r.station_id,
              station_name: names.get(r.station_id) ?? r.station_id,
              fired_at: r.fired_at,
              printed: r.printed === 1,
              has_printer: withPrinter.has(r.station_id),
            })),
          },
        };
      },
    }),
  );
}
