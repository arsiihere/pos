import type { FastifyInstance } from 'fastify';
import type { ProjectionRegistry } from '../../projections/registry.js';
import type { HubDeps } from '../../server.js';
import { printConfigProjection } from '../config-projection.js';

// 03c lane C1 (c4, c5, c7, c8, c9): this lane's wiring lines go here and only here (phase 0 P0.11). Only lane C1 edits this file.
// register(): commands, queries, routes, catch-ups, providePrint(...) — called once per server by registerPrint.
// registerProjections(): this lane's projections, in the order print/index.ts calls the lanes (after 03b's).

export function register(app: FastifyInstance, deps: HubDeps): void {
  void app;
  void deps;
}

export function registerProjections(projections: ProjectionRegistry): void {
  projections.register(printConfigProjection); // c4, 03c §3.2, §5
}
