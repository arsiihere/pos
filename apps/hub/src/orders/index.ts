// 02b §6.13 (AD-5 pattern of 02a): the zone stock kinds register at module load, before boot replays the alerts projection.
import './zone-kinds.js';
import type { FastifyInstance } from 'fastify';
import type { ProjectionRegistry } from '../projections/registry.js';
import { ordersProjection } from './projection.js';
import { registerSubmitOrder } from './commands/submit-order.js';
import { registerEtaPreviewQuery } from './queries/eta-preview.js';
import { registerZoneStock } from './commands/zone-stock.js';
import type { HubDeps } from '../server.js';
import { registerRemoveItems } from './commands/remove-items.js';
import { registerSetLineWeight } from './commands/set-line-weight.js';

// 02b wiring entry (§4.2; plan "02b exports and contracts"): commands, kinds, queries, catch-up, audiences.
// Called once from buildHubServer. Each lane appends its lines under its own marker (and its own import lines
// above), so the lanes' commits stay additive. The `void` lines stay: they keep no-unused-vars on.
export function registerOrders(app: FastifyInstance, deps: HubDeps): void {
  void app;
  void deps;
  // wave 1 lane A (projection orders, exports seatingTotals / orderLines / ordersOf)

  // wave 1 lane B (ledger lineShares, food rules foodDrafts)

  // wave 1 lane C (buildSubmit, zone routing)

  // wave 2 lane A (SubmitOrder, zone-served submit, eta-preview)
  registerSubmitOrder(app); // §6.1 (queueable, §3.12)
  registerEtaPreviewQuery(app, deps.writer, deps.clock); // §6.14 (countsAsActivity false)

  // wave 2 lane B (RemoveItems + lineChangeDrafts, SetLineWeight, CompLine, comp kind)
  registerRemoveItems(app); // §6.2 (not queueable, §3.12)
  registerSetLineWeight(app); // §6.3 (not queueable, §3.12)

  // wave 2 lane C (MarkServed, ReleaseItems, BoostOrder, ReturnToKitchen)

  // wave 2 lane D (AddZoneStock, SetZoneStock)
  registerZoneStock(app);

  // wave 3 lane A (queries, catch-up, audiences)

  // wave 3 lane B (queued replays)

  // wave 3 lane C (handover card amount, G-1)
}

// G-3: the `orders` projection (§5), registered where the hub's projection registry is created (boot, test hub).
// The lane appends its lines under its marker; the `void` line stays.
export function registerOrdersProjection(projections: ProjectionRegistry): void {
  void projections;
  // wave 1 lane A (projection orders)
  projections.register(ordersProjection());
}
