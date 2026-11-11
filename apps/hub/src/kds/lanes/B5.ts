import type { FastifyInstance } from 'fastify';
import type { ProjectionRegistry } from '../../projections/registry.js';
import type { HubDeps } from '../../server.js';
import { registeredTicks, registerTick } from '../../alerts/tick.js';
import { passClosuresTick, readyRetargetTick } from '../ticks.js';

// 03b lane B5 (b16, b17, 0e): this lane's wiring lines go here and only here (phase 0 P0.11). Only lane B5 edits this file.
// register(): commands, queries, catch-ups, audiences, ticks, provideKds(...) — called once per server by registerKds.
// registerProjections(): this lane's projections, in the order kds/index.ts calls the lanes (after 02b's orders).

export function register(app: FastifyInstance, deps: HubDeps): void {
  void app;
  void deps;
  // b16 (§6.18, §6.19): the tick list is process-wide and registerTick throws on a second name; every server build gets
  // here. pass_closures first, so a Ready settled in the same pass closes `done` before it could be re-targeted.
  for (const tick of [passClosuresTick, readyRetargetTick]) {
    if (!registeredTicks().some((t) => t.name === tick.name)) registerTick(tick);
  }
}

export function registerProjections(projections: ProjectionRegistry): void {
  void projections;
}
