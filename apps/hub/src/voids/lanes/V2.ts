import type { FastifyInstance } from 'fastify';
import type { HubDeps } from '../../server.js';

// 04 lane V2: this lane's wiring lines go here and only here (phase 0 P0.7). Only lane V2 edits this file.
// register(): commands, queries, guard registrations, provideVoids(...) — called once per server by registerVoids.

export function register(app: FastifyInstance, deps: HubDeps): void {
  void app;
  void deps;
}
