// 02b §6.13 (AD-5 pattern of 02a): the zone stock kinds register at module load, before boot replays the alerts projection.
import './zone-kinds.js';
// 02b §6.12: kind `comp`, the same way (top level, before the boot replay).
import './comp-kind.js';
import type { FastifyInstance } from 'fastify';
import type { ProjectionRegistry } from '../projections/registry.js';
import { registerMarkServed } from './commands/mark-served.js';
import { registerReleaseBoost } from './commands/release-boost.js';
import { registerReturnToKitchen } from './commands/return-to-kitchen.js';
import { ordersProjection } from './projection.js';
import { registerSubmitOrder } from './commands/submit-order.js';
import { registerEtaPreviewQuery } from './queries/eta-preview.js';
import { registerZoneStock } from './commands/zone-stock.js';
import type { HubDeps } from '../server.js';
import { registerRemoveItems } from './commands/remove-items.js';
import { registerSetLineWeight } from './commands/set-line-weight.js';
import { registerSeatingTotals } from '../tables/handover.js';
import { seatingTotals } from './exports.js';
import { registerCompLine } from './commands/comp-line.js';
import { registerLineCompedAudience } from './audiences.js'; // §6.19: its fixed audiences register at this module's load
import { registerOrdersCatchUp } from './catch-up.js';
import { registerOpenOrdersQuery } from './queries/open-orders.js';
import { registerOrderContactQuery } from './queries/order-contact.js';
import { registerSeatingOrdersQuery } from './queries/seating-orders.js';
import { registerZoneStockQuery } from './queries/zone-stock.js';
import { registeredTicks, registerTick } from '../alerts/tick.js';
import { servedEstimateTick } from './served-estimate-tick.js';

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
  registerCompLine(app); // §6.8 (approvable; online only, §3.12); kind `comp` (§6.12) registers at module load

  // wave 2 lane C (MarkServed, ReleaseItems, BoostOrder, ReturnToKitchen)
  registerMarkServed(app);
  registerReleaseBoost(app);
  registerReturnToKitchen(app);

  // wave 2 lane D (AddZoneStock, SetZoneStock)
  registerZoneStock(app);

  // wave 3 lane A (queries, catch-up, audiences)
  registerSeatingOrdersQuery(app); // §6.15
  registerOpenOrdersQuery(app); // §6.16
  registerZoneStockQuery(app); // §6.17
  registerOrderContactQuery(app); // §6.18 (countsAsActivity true)
  const stopOrdersCatchUp = registerOrdersCatchUp(); // catch-up part `orders`; removed when this server closes
  const stopCompAudience = registerLineCompedAudience(app); // §6.19 LineComped (directory per server)
  app.addHook('onClose', async () => {
    stopOrdersCatchUp();
    stopCompAudience();
  });

  // wave 3 lane B (queued replays)

  // wave 3 lane C (handover card amount, G-1)
  registerSeatingTotals(seatingTotals);

  // 03b task 0e (G-2; §3.7, §6.11): tick served_estimate over 03b's handoversDue. The tick list is process-wide and
  // registerTick throws on a second name; every server build gets here (before 03b's pass ticks: registerKds runs after).
  if (!registeredTicks().some((t) => t.name === servedEstimateTick.name)) registerTick(servedEstimateTick);
}

// G-3: the `orders` projection (§5), registered where the hub's projection registry is created (boot, test hub).
// The lane appends its lines under its marker; the `void` line stays.
export function registerOrdersProjection(projections: ProjectionRegistry): void {
  void projections;
  // wave 1 lane A (projection orders)
  projections.register(ordersProjection());
}
