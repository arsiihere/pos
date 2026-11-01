import type { FastifyInstance } from 'fastify';
import { bindAlertProjectionLog } from '../projections/alerts.js';
import type { HubDeps } from '../server.js';
import { currentDirectory } from '../auth/guards.js';
import { wsHubFor } from '../ws/server.js';
import { bindAlertEnv } from './raise.js';
import { createAlertFrames } from './ws-frames.js';

export { alerts, type AlertCtx, type RaiseInput, type RaiseResult } from './raise.js';

// 01d wiring entry (plan "Wiring"): each 01d task registers what it builds (commands, queries,
// projections, catch-up parts, ticks, timers) here. Called once from buildHubServer.
// Projections are the exception: boot replays them (step 4) before this runs (step 5), so they register
// with the hub's projection registry where it is created (registerAlertProjections, task 14); here the
// `alerts` projection gets the server log for its P-8 unknown-kind line.
export function registerAlerts(app: FastifyInstance, deps: HubDeps): void {
  // raise / raiseMany (task 18): the hub's directory and socket lists, read in memory at each raise
  bindAlertEnv(deps.db, { directory: () => currentDirectory(app), ws: () => wsHubFor(app) });
  bindAlertProjectionLog(deps.projections, (line) => {
    app.log.warn(line, 'alerts projection: unknown alert kind');
  });
  // §6 batch 3 / §3.6 (task 20): alert, alert_closed and alert_seen frames, after commit only
  const frames = createAlertFrames({ db: deps.db, ws: () => wsHubFor(app), directory: () => currentDirectory(app), log: app.log });
  deps.writer.addAfterCommit((appended) => frames.afterCommit(appended));
}
