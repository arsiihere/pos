import { applyEvent, initialEngineState, type EngineState } from '@pos/engine';
import { parseEvent, type PosEvent } from '@pos/events';
import type Database from 'better-sqlite3';
import { registerBootStep } from '../lib/boot.js';
import { loadBranchConfig } from '../projections/branch-config.js';
import { swapBranchConfig } from './branch-config-holder.js';
import { configPoller } from './config-poller.js';
import { setStockVersion, STOCK_VERSION_EVENTS } from './stock-version.js';

interface EventRow {
  event_id: string;
  tenant_id: string;
  branch_id: string;
  stream_type: string;
  stream_id: string;
  event_type: string;
  schema_version: number;
  payload: string;
  occurred_at: number;
  recorded_at: number;
  actor_id: string | null;
  device_id: string;
  seq: number;
}

// S15, S33: the stock stream and the business-day events, folded from initialEngineState().
// The same scan gives stock_version (§6.19), so boot adds no query for it.
export function foldEngineEvents(db: Database.Database, branchId: string): { state: EngineState; stockVersion: number } {
  const rows = db
    .prepare(
      `SELECT event_id, tenant_id, branch_id, stream_type, stream_id, event_type, schema_version,
              payload, occurred_at, recorded_at, actor_id, device_id, seq
       FROM events
       WHERE branch_id = ?
         AND (stream_type = 'stock' OR (stream_type = 'hub' AND event_type IN ('BusinessDayOpened', 'BusinessDayClosed')))
       ORDER BY seq`,
    )
    .iterate(branchId) as IterableIterator<EventRow>;
  let state = initialEngineState();
  let version = 0;
  for (const row of rows) {
    const event = parseEvent({ ...row, payload: JSON.parse(row.payload) as PosEvent['payload'] });
    state = applyEvent(state, event);
    if (STOCK_VERSION_EVENTS.has(event.event_type)) version = event.seq;
  }
  return { state, stockVersion: version };
}

let registered = false;

// S15: called once by main.ts before boot().
export function registerRestaurantBootSteps(): void {
  if (registered) return;
  registered = true;
  registerBootStep('3', (ctx) => {
    const branchId = ctx.config.provisioned?.branch_id;
    if (branchId === undefined) return;
    const { state, stockVersion } = foldEngineEvents(ctx.db, branchId);
    ctx.initialState = state;
    setStockVersion(stockVersion);
  });
  // S15: after step 4's catch-up, so a projection that was behind the log is current first (S5).
  registerBootStep('5', (ctx) => {
    const branchId = ctx.config.provisioned?.branch_id;
    if (branchId === undefined) return;
    const loaded = loadBranchConfig(ctx.db, branchId);
    swapBranchConfig(loaded.state === 'APPLIED' ? loaded.entry : null);
  });
  // §7.2: the 60 s poll timer, stopped when the app closes.
  registerBootStep('6', (ctx) => {
    const app = ctx.app;
    if (app === undefined) return;
    const poller = configPoller(app);
    poller.start();
    app.addHook('onClose', async () => {
      poller.stop();
    });
  });
}
