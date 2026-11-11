import type { FastifyInstance } from 'fastify';
import type { ProjectionRegistry } from '../../projections/registry.js';
import type { HubDeps } from '../../server.js';

// 03c lane C4 (c17, c18, c19, c20, c21, c22): this lane's wiring lines go here and only here (phase 0 P0.11). Only lane C4 edits this file.
// register(): commands, queries, routes, catch-ups, providePrint(...) — called once per server by registerPrint.
// registerProjections(): this lane's projections, in the order print/index.ts calls the lanes (after 03b's).

export function register(app: FastifyInstance, deps: HubDeps): void {
  void app;
  void deps;
}

export function registerProjections(projections: ProjectionRegistry): void {
  void projections;
}
