import type { FastifyInstance } from 'fastify';
import type { ProjectionRegistry } from '../../projections/registry.js';
import type { HubDeps } from '../../server.js';
import { providePrint } from '../contracts.js';
import { renderText } from '../render/text.js';

// 03c lane C2 (c11, c10): this lane's wiring lines go here and only here (phase 0 P0.11). Only lane C2 edits this file.
// register(): commands, queries, routes, catch-ups, providePrint(...) — called once per server by registerPrint.
// registerProjections(): this lane's projections, in the order print/index.ts calls the lanes (after 03b's).

export function register(app: FastifyInstance, deps: HubDeps): void {
  void app;
  void deps;
  providePrint({ renderText }); // c10, §3.6 / §4.2
}

export function registerProjections(projections: ProjectionRegistry): void {
  void projections;
}
