// 03b §6.21: the kinds register at this module's load, before boot replays the alerts projection (01d P-8).
import './kinds.js';
import type { FastifyInstance } from 'fastify';
import type { ProjectionRegistry } from '../projections/registry.js';
import type { HubDeps } from '../server.js';
import * as B1 from './lanes/B1.js';
import * as B2 from './lanes/B2.js';
import * as B3 from './lanes/B3.js';
import * as B4 from './lanes/B4.js';
import * as B5 from './lanes/B5.js';
import * as B6 from './lanes/B6.js';

// 03b wiring entry (phase 0 P0.11; 03b §5 note): one register file per lane, so lanes never share a file.
const LANES = [B1, B2, B3, B4, B5, B6];

/** Called once from buildHubServer, right after registerOrders (G-7). */
export function registerKds(app: FastifyInstance, deps: HubDeps): void {
  for (const lane of LANES) lane.register(app, deps);
}

/** 03b §5: after 02b's registerOrdersProjection, before 03c's (boot createDeps and the test hub). */
export function registerKdsProjections(projections: ProjectionRegistry): void {
  for (const lane of LANES) lane.registerProjections(projections);
}
