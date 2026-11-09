import type { FastifyInstance } from 'fastify';
import type { ProjectionRegistry } from '../projections/registry.js';
import type { HubDeps } from '../server.js';
import { bindTablesProjectionLog, tablesProjection } from './projection.js';

// 02a wiring entry (plan "02a exports"): commands, queries, catch-up, audiences, tick and hooks (SG-6).
// Called once from buildHubServer. Each lane appends its lines under its own marker (and its own import lines
// above), so the lanes' commits stay additive. The `void` lines stay: they keep no-unused-vars on.
export function registerTables(app: FastifyInstance, deps: HubDeps): void {
  void app;
  void deps;
  // wave 1 lane A (tables projection log, #55)
  bindTablesProjectionLog(deps.projections, (line) => {
    app.log.warn(line, 'tables projection: dine_in order names no open seating');
  });
  // wave 1 lane B (SG-6 slip readers)

  // wave 1 lane C (resolvers, tick)

  // wave 2 lane A (OpenTable, lock commands)

  // wave 2 lane B (table_handover kind, handover, holder commands)

  // wave 2 lane C (move, merge, split)

  // wave 2 lane D (bill, clean, call_waiter)
}

// SG-5: the `tables` projection (T19), registered where the hub's projection registry is created (boot, test hub).
// The lane appends its lines under its marker; the `void` line stays.
export function registerTablesProjection(projections: ProjectionRegistry): void {
  void projections;
  // wave 1 lane A (tables projection)
  projections.register(tablesProjection(projections));
}
