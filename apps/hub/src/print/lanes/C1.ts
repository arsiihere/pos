import type { FastifyInstance } from 'fastify';
import type { ProjectionRegistry } from '../../projections/registry.js';
import type { HubDeps } from '../../server.js';
import { registerSavePrinter } from '../commands/printer.js';
import { registerSetStationOutput } from '../commands/station-output.js';
import { printConfigProjection } from '../config-projection.js';
import { bindTicketsLog, ticketsProjection } from '../tickets-projection.js';

// 03c lane C1 (c4, c5, c7, c8, c9): this lane's wiring lines go here and only here (phase 0 P0.11). Only lane C1 edits this file.
// register(): commands, queries, routes, catch-ups, providePrint(...) — called once per server by registerPrint.
// registerProjections(): this lane's projections, in the order print/index.ts calls the lanes (after 03b's).

export function register(app: FastifyInstance, deps: HubDeps): void {
  // c7, 03c §3.3, §7: `print.fold_skipped` (ids and reasons only); boot replays before this log exists
  bindTicketsLog(deps.projections, (line) => app.log.warn(line, 'print.fold_skipped'));
  registerSavePrinter(app); // c5, 03c §6.2
  registerSetStationOutput(app); // c5, 03c §6.3
}

export function registerProjections(projections: ProjectionRegistry): void {
  projections.register(printConfigProjection); // c4, 03c §3.2, §5
  projections.register(ticketsProjection(projections)); // c7, 03c §3.3 (forward-only, after 03b's)
}
