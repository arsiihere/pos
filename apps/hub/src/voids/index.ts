// 04 §3.5: the kind registers at this module's load, before boot replays the alerts projection (01d P-8).
import './kind.js';
import type { FastifyInstance } from 'fastify';
import type { HubDeps } from '../server.js';
import { registerMergeGuard } from '../tables/merge-guard.js';
import { voidMergeGuard } from './contracts.js';
import * as V1 from './lanes/V1.js';
import * as V2 from './lanes/V2.js';

// 04 wiring entry (phase 0 P0.7): one register file per lane, so lanes never share a file.
const LANES = [V1, V2];

/** §6.6: called once from buildHubServer, right after registerPrint. */
export function registerVoids(app: FastifyInstance, deps: HubDeps): void {
  // §6.6: the void merge guard (contracts.ts delegates to voids/guards.ts once lanes/V2.ts provides it). The line guard
  // (Q-3) and the day-close guard (A-1) are registered from lanes/V2.ts.
  registerMergeGuard(voidMergeGuard);
  for (const lane of LANES) lane.register(app, deps);
}
