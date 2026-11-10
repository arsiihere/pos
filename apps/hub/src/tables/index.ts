import type { FastifyInstance } from 'fastify';
import { currentDirectory } from '../auth/guards.js';
import { registerSlipReaders } from '../engine-host/index.js';
import { slipReaders } from '../engine-host/slip-readers.js';
import type { ProjectionRegistry } from '../projections/registry.js';
import type { HubDeps } from '../server.js';
import { bindTablesProjectionLog, tablesProjection } from './projection.js';
import { bindZoneDirectory, currentTableOf, holdersOfOrders } from './reads.js';
import { hasTargetResolver, registerTargetResolver } from '../alerts/targets.js';
import { tableTeam, zoneOrderTaker } from './resolvers.js';
import { registeredTicks, registerTick } from '../alerts/tick.js';
import { tableLocksTick } from './tick.js';
import { registerOpenTable } from './commands/open-table.js';
import './kinds.js'; // §11 step 12 (AD-5): the kinds are defined at this module's load, before boot replays projections
import { registerRequestTableHandover } from './commands/request-table-handover.js';
import { registerHolderCommands } from './commands/holder-commands.js';
import { registerMoveTable } from './commands/move-table.js';
import { registerMergeTables } from './commands/merge-tables.js';
import { registerSplitSeating } from './commands/split-seating.js';
import { registerBillClean } from './commands/bill-clean.js';
import './call-waiter-kind.js'; // §6.14 kind call_waiter, top level (AD-5): exists before boot replay
import { registerCallWaiter } from './commands/call-waiter.js';

// 02a wiring entry (plan "02a exports"): commands, queries, catch-up, audiences, tick and hooks (SG-6).
// Called once from buildHubServer. Each lane appends its lines under its own marker (and its own import lines
// above), so the lanes' commits stay additive. The `void` lines stay: they keep no-unused-vars on.
export function registerTables(app: FastifyInstance, deps: HubDeps): void {
  void app;
  void deps;
  // wave 1 lane A (tables projection log, #55)
  bindTablesProjectionLog(deps.projections, (line) => {
    app.log.warn(line, 'tables projection: dine_in order names no open seating');
  });
  // wave 1 lane B (SG-6 slip readers)
  bindZoneDirectory(() => currentDirectory(app)); // AD-6: a getter, never the directory object
  if (slipReaders() === null) registerSlipReaders({ holdersOfOrders, currentTableOf }); // SG-6: never replace a test's readers

  // wave 1 lane C (resolvers, tick)
  // SG-6: a kind a test registered first (01d fakes) is left alone
  if (!hasTargetResolver('table_team')) registerTargetResolver('table_team', tableTeam);
  if (!hasTargetResolver('zone_order_taker')) registerTargetResolver('zone_order_taker', zoneOrderTaker);
  // §3.4 (R3): the tick list is process-wide and registerTick throws on a second name; every server build gets here
  if (!registeredTicks().some((t) => t.name === 'table_locks')) registerTick(tableLocksTick);

  // wave 2 lane A (OpenTable, lock commands)
  registerOpenTable(app);

  // wave 2 lane B (table_handover kind, handover, holder commands)
  registerRequestTableHandover(app);
  registerHolderCommands(app);

  // wave 2 lane C (move, merge, split)
  registerMoveTable(app);
  registerMergeTables(app);
  registerSplitSeating(app);

  // wave 2 lane D (bill, clean, call_waiter)
  registerBillClean(app); // §6.12, §6.13 (queueable, P-1f)
  registerCallWaiter(app); // §6.14 (not queueable, P-1f)
}

// SG-5: the `tables` projection (T19), registered where the hub's projection registry is created (boot, test hub).
// The lane appends its lines under its marker; the `void` line stays.
export function registerTablesProjection(projections: ProjectionRegistry): void {
  void projections;
  // wave 1 lane A (tables projection)
  projections.register(tablesProjection(projections));
}
