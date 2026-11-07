import type { FastifyInstance } from 'fastify';
import type { HubDeps } from '../server.js';
import { registerConfigHook } from './config-hook.js';
import { bindFiresAlertsTick, noteAlertFacts } from './fires-alerts-tick.js';
import { bindFiresTick } from './fires-tick.js';
import { afterEngineCommit } from './reducer.js';
import { afterSnapshotCommit, cancelScheduled } from './snapshots.js';
import { bindStationPlans } from './station-plan.js';
// §6.4: the kinds 03a registers (slip_warning, station_overload, engine_line_dropped), at module load.
import './kinds.js';

// P-6: what the host wires into the server; called once from buildHubServer.
export function registerEngineHost(app: FastifyInstance, deps: HubDeps): void {
  deps.writer.addAfterCommit((appended) => {
    // §6.2a, AD-8: before the diagnostics are logged and cleared, so the dropped-line facts are this commit's.
    noteAlertFacts(deps.state.get(), appended);
    afterEngineCommit(deps.state, app.log, appended);
    // §3.12: after the fold's log and clear, so the state read is this commit's.
    afterSnapshotCommit(deps, appended, app.log);
  });
  // §6.2: the fires tick reaches this hub's deps (its checkpoint scheduling, the frame seam) through its connection.
  bindFiresTick(deps, app.log);
  // §6.2a: the fires_alerts tick likewise (its host memory: skipped, red_since, overload_open, the dropped-line queue).
  bindFiresAlertsTick(deps, app.log);
  // §3.11: the config hook and the E() of configStale, here at the server build (boot step 5, before step 6).
  registerConfigHook(app, deps);
  // §3.6.3, §6.4: the station_plan catch-up part and frames (after bindFiresTick: it binds the freeze-entry seam).
  bindStationPlans(app, deps);
  app.addHook('onClose', async () => {
    cancelScheduled(deps);
  });
}
