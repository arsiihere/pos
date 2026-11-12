import type { FastifyInstance } from 'fastify';
import type { ProjectionRegistry } from '../../projections/registry.js';
import type { HubDeps } from '../../server.js';
import { registerDismissPrintSkip } from '../commands/dismiss-skip.js';
import { registerPrintConfigHook } from '../config-hook.js';

// 03c lane C3 (c12, c13, c14, c15, c16): this lane's wiring lines go here and only here (phase 0 P0.11). Only lane C3 edits this file.
// register(): commands, queries, routes, catch-ups, providePrint(...) — called once per server by registerPrint.
// registerProjections(): this lane's projections, in the order print/index.ts calls the lanes (after 03b's).

export function register(app: FastifyInstance, deps: HubDeps): void {
  registerDismissPrintSkip(app); // P0.22, 03c v1.0.6 §6.12 (Q-14)
  registerPrintConfigHook(app, deps); // P0.22, 03c v1.0.6 §3.2 (Q-18), §3.8 (Q-20)
}

export function registerProjections(projections: ProjectionRegistry): void {
  void projections;
}
