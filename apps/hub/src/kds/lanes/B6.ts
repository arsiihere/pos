import type { FastifyInstance } from 'fastify';
import type { ProjectionRegistry } from '../../projections/registry.js';
import type { HubDeps } from '../../server.js';

// 03b lane B6 (b20, b21, b22, b23): this lane's wiring lines go here and only here (phase 0 P0.11). Only lane B6 edits this file.
// register(): commands, queries, catch-ups, audiences, ticks, provideKds(...) — called once per server by registerKds.
// registerProjections(): this lane's projections, in the order kds/index.ts calls the lanes (after 02b's orders).

export function register(app: FastifyInstance, deps: HubDeps): void {
  void app;
  void deps;
}

export function registerProjections(projections: ProjectionRegistry): void {
  void projections;
}
