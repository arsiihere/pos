import type { FastifyInstance } from 'fastify';
import type { ProjectionRegistry } from '../../projections/registry.js';
import type { HubDeps } from '../../server.js';
import { registerKdsConfigProjection } from '../config-projection.js';

// 03b lane B1 (b5, b6, b7, b10): this lane's wiring lines go here and only here (phase 0 P0.11). Only lane B1 edits this file.
// register(): commands, queries, catch-ups, audiences, ticks, provideKds(...) — called once per server by registerKds.
// registerProjections(): this lane's projections, in the order kds/index.ts calls the lanes (after 02b's orders).

export function register(app: FastifyInstance, deps: HubDeps): void {
  void app;
  void deps;
}

export function registerProjections(projections: ProjectionRegistry): void {
  registerKdsConfigProjection(projections); // b5, §3.7 / §3.8 / §5
}
