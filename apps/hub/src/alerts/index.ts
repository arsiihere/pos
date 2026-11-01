import type { FastifyInstance } from 'fastify';
import type { HubDeps } from '../server.js';

// 01d wiring entry (plan "Wiring"): each 01d task registers what it builds (commands, queries,
// projections, catch-up parts, ticks, timers) here. Called once from buildHubServer.
// Task 13 builds no part yet; the body grows with each task (and then takes `app, deps`).
export const registerAlerts: (app: FastifyInstance, deps: HubDeps) => void = () => {};
