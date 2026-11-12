// 03c §6.10: the kind registers at this module's load, before boot replays the alerts projection (01d P-8).
import './kinds.js';
import type { FastifyInstance } from 'fastify';
import type { ProjectionRegistry } from '../projections/registry.js';
import type { HubDeps } from '../server.js';
import * as C1 from './lanes/C1.js';
import * as C2 from './lanes/C2.js';
import * as C3 from './lanes/C3.js';
import * as C4 from './lanes/C4.js';

// 03c wiring entry (phase 0 P0.11; G-7): one register file per lane.
const LANES = [C1, C2, C3, C4];

/** Called once from buildHubServer, right after registerKds (G-7). */
export function registerPrint(app: FastifyInstance, deps: HubDeps): void {
  for (const lane of LANES) lane.register(app, deps);
}

/** 03c §3.3: after 03b's registerKdsProjections (boot createDeps and the test hub). */
export function registerPrintProjections(projections: ProjectionRegistry): void {
  for (const lane of LANES) lane.registerProjections(projections);
}
