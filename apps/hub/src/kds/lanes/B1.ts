import type { FastifyInstance } from 'fastify';
import { hasTargetResolver, registerTargetResolver } from '../../alerts/targets.js';
import type { ProjectionRegistry } from '../../projections/registry.js';
import type { HubDeps } from '../../server.js';
import { registerSetDeviceRole } from '../commands/device-role.js';
import { registerSetStationScreen } from '../commands/screen.js';
import { registerKdsConfigProjection } from '../config-projection.js';
import { provideKds } from '../contracts.js';
import { devicePointOf, deviceRolesProjection, loadDeviceMaps, pointResolver, refreshDeviceMapsAfter } from '../device-roles.js';

// 03b lane B1 (b5, b6, b7, b10): this lane's wiring lines go here and only here (phase 0 P0.11). Only lane B1 edits this file.
// register(): commands, queries, catch-ups, audiences, ticks, provideKds(...) — called once per server by registerKds.
// registerProjections(): this lane's projections, in the order kds/index.ts calls the lanes (after 02b's orders).

export function register(app: FastifyInstance, deps: HubDeps): void {
  // b6, §3.8: memory maps built at server build (after boot's catch-up), refreshed after device commits
  loadDeviceMaps(deps.db);
  deps.writer.addAfterCommit(refreshDeviceMapsAfter(deps.db));
  provideKds({ devicePoint: devicePointOf });
  // b6, G-1: 01d's `point` target; a resolver a test registered first (01d fakes) is left alone (02a SG-6)
  if (!hasTargetResolver('point')) registerTargetResolver('point', pointResolver);
  // b7, §6.9–6.10: admin commands
  registerSetStationScreen(app);
  registerSetDeviceRole(app);
}

export function registerProjections(projections: ProjectionRegistry): void {
  registerKdsConfigProjection(projections); // b5, §3.7 / §3.8 / §5
  projections.register(deviceRolesProjection()); // b6, §3.8 / §5 (forward-only)
}
