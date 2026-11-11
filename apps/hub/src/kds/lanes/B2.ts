import type { FastifyInstance } from 'fastify';
import type { ProjectionRegistry } from '../../projections/registry.js';
import type { HubDeps } from '../../server.js';
import { registerStartDone } from '../commands/start-done.js';

// 03b lane B2 (b8, b9a): this lane's wiring lines go here and only here (phase 0 P0.11). Only lane B2 edits this file.
// register(): commands, queries, catch-ups, audiences, ticks, provideKds(...) — called once per server by registerKds.
// registerProjections(): this lane's projections, in the order kds/index.ts calls the lanes (after 02b's orders).

export function register(app: FastifyInstance, deps: HubDeps): void {
  void deps;
  registerStartDone(app); // b8: StartItem, DoneItem (§6.1–6.2)
}

export function registerProjections(projections: ProjectionRegistry): void {
  void projections;
}
