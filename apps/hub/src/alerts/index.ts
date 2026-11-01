import type { FastifyInstance } from 'fastify';
import { bindAlertProjectionLog } from '../projections/alerts.js';
import type { HubDeps } from '../server.js';
import { currentDirectory } from '../auth/guards.js';
import { wsHubFor } from '../ws/server.js';
import { bindAlertEnv } from './raise.js';
import { bindReceiptBuffer, createReceiptBuffer, unbindReceiptBuffer } from './receipts.js';
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
  // §3.6 / A11 (task 21): the receipt buffer. The recorded set is seeded here, in buildHubServer (boot step 5),
  // before the WS server accepts sockets (listen is boot step 7). Its flush timer is armed only by a buffered
  // receipt, so nothing runs before sockets do; on close it stops and flushes what is buffered.
  const receipts = createReceiptBuffer({ db: deps.db, writer: deps.writer, clock: deps.clock, log: app.log });
  receipts.seed();
  bindReceiptBuffer(app, receipts);
  wsHubFor(app).onReceipt((from, msg) => receipts.fromSocket(from, msg));
  app.addHook('onClose', async () => {
    receipts.stop();
    unbindReceiptBuffer(receipts);
  });
}
