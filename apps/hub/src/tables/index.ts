import type { FastifyInstance } from 'fastify';
import type { ProjectionRegistry } from '../projections/registry.js';
import type { HubDeps } from '../server.js';

// 02a wiring entry (plan "02a exports"): commands, queries, catch-up, audiences, tick and hooks (SG-6) register
// here as their tasks land. Called once from buildHubServer. Typed consts until then: an empty body takes no
// parameters, so no-unused-vars stays on (the first task to fill one turns it into a function).
export const registerTables: (app: FastifyInstance, deps: HubDeps) => void = () => {};

// SG-5: the `tables` projection (T19), registered where the hub's projection registry is created (boot, test hub).
export const registerTablesProjection: (projections: ProjectionRegistry) => void = () => {};
