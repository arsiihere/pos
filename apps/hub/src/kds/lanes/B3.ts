import type { FastifyInstance } from 'fastify';
import type { ProjectionRegistry } from '../../projections/registry.js';
import type { HubDeps } from '../../server.js';
import { provideKds } from '../contracts.js';
import { buildLineDetails, pointOfLine } from '../details.js';

// 03b lane B3 (b11, b18): this lane's wiring lines go here and only here (phase 0 P0.11). Only lane B3 edits this file.
// register(): commands, queries, catch-ups, audiences, ticks, provideKds(...) — called once per server by registerKds.
// registerProjections(): this lane's projections, in the order kds/index.ts calls the lanes (after 02b's orders).

// b11 (§3.1, §4.2): pure reads, the same for every server, so they are provided at module load.
provideKds({ buildLineDetails, pointOfLine });

export function register(app: FastifyInstance, deps: HubDeps): void {
  void app;
  void deps;
}

export function registerProjections(projections: ProjectionRegistry): void {
  void projections;
}
