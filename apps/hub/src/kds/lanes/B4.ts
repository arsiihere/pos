import type { FastifyInstance } from 'fastify';
import type { ProjectionRegistry } from '../../projections/registry.js';
import type { HubDeps } from '../../server.js';
import { registerReadyCommands } from '../commands/ready.js';
import { bindPassProjectionLog, passProjection } from '../pass-projection.js';

// 03b lane B4 (b13, b14, b15, b9b): this lane's wiring lines go here and only here (phase 0 P0.11). Only lane B4 edits this file.
// register(): commands, queries, catch-ups, audiences, ticks, provideKds(...) — called once per server by registerKds.
// registerProjections(): this lane's projections, in the order kds/index.ts calls the lanes (after 02b's orders).

export function register(app: FastifyInstance, deps: HubDeps): void {
  void app;
  void deps;
  // b13 (§5, §7 logging): the pass projection's `kds.fold_skipped` line (ids and counts only)
  bindPassProjectionLog(deps.projections, (line) => {
    app.log.warn(line, 'kds.fold_skipped');
  });
  // b14 (§6.6, §6.7): MarkReadyToServe, UndoReadyToServe
  registerReadyCommands(app);
}

export function registerProjections(projections: ProjectionRegistry): void {
  void projections;
  // b13 (§5): projection `pass` (with reset)
  projections.register(passProjection(projections));
}
