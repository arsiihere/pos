import type { FastifyInstance } from 'fastify';
import { bindAlertProjectionLog } from '../projections/alerts.js';
import type { HubDeps } from '../server.js';

// 01d wiring entry (plan "Wiring"): each 01d task registers what it builds (commands, queries,
// projections, catch-up parts, ticks, timers) here. Called once from buildHubServer.
// Projections are the exception: boot replays them (step 4) before this runs (step 5), so they register
// with the hub's projection registry where it is created (registerAlertProjections, task 14); here the
// `alerts` projection gets the server log for its P-8 unknown-kind line.
export function registerAlerts(app: FastifyInstance, deps: HubDeps): void {
  bindAlertProjectionLog(deps.projections, (line) => {
    app.log.warn(line, 'alerts projection: unknown alert kind');
  });
}
