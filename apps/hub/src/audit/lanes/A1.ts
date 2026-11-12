import type { FastifyInstance } from 'fastify';
import type { ProjectionRegistry } from '../../projections/registry.js';
import type { HubDeps } from '../../server.js';
import { auditProjection } from '../projection.js';

// 04 lane A1: this lane's wiring lines go here and only here (phase 0 P0.7). Only lane A1 edits this file.
// register(): queries — called once per server by registerAudit.
// registerProjections(): the `audit` fold (a2), called inside registerHubProjections by registerAuditProjections.

export function register(app: FastifyInstance, deps: HubDeps): void {
  void app;
  void deps;
}

export function registerProjections(projections: ProjectionRegistry): void {
  // §6.6, §3.6, §5: projection `audit` (events only, with reset).
  projections.register(auditProjection());
}
