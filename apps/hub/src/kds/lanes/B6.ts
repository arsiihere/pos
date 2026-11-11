import type { FastifyInstance } from 'fastify';
import { registeredTicks, registerTick } from '../../alerts/tick.js';
import type { ProjectionRegistry } from '../../projections/registry.js';
import type { HubDeps } from '../../server.js';
import { provideKds } from '../contracts.js';
import { bindPresence, KDS_PRESENCE_TICK, kdsPresenceTick, stationPresenceOf } from '../presence.js';

// 03b lane B6 (b20, b21, b22, b23): this lane's wiring lines go here and only here (phase 0 P0.11). Only lane B6 edits this file.
// register(): commands, queries, catch-ups, audiences, ticks, provideKds(...) — called once per server by registerKds.
// registerProjections(): this lane's projections, in the order kds/index.ts calls the lanes (after 02b's orders).

export function register(app: FastifyInstance, deps: HubDeps): void {
  // b20 (§3.6, §6.20; G-13): the per-db presence host, the tick (process-wide, registered once), stationPresence()
  bindPresence(app, deps);
  if (!registeredTicks().some((t) => t.name === KDS_PRESENCE_TICK)) registerTick(kdsPresenceTick);
  provideKds({ stationPresence: () => stationPresenceOf(deps.db) }); // this hub's host, by its db
}

export function registerProjections(projections: ProjectionRegistry): void {
  void projections;
}
