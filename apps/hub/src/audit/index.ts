import type { FastifyInstance } from 'fastify';
import type { ProjectionRegistry } from '../projections/registry.js';
import type { HubDeps } from '../server.js';
import * as A1 from './lanes/A1.js';

// 04 wiring entry for the audit log (phase 0 P0.7): one register file per lane.
const LANES = [A1];

/** §6.6: called once from buildHubServer, right after registerVoids. */
export function registerAudit(app: FastifyInstance, deps: HubDeps): void {
  for (const lane of LANES) lane.register(app, deps);
}

/** §5, §6.6: inside registerHubProjections, after 03c's print (events only, so the order does not matter). */
export function registerAuditProjections(projections: ProjectionRegistry): void {
  for (const lane of LANES) lane.registerProjections(projections);
}
