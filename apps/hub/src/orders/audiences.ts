import type { FastifyInstance } from 'fastify';
import { currentDirectory } from '../auth/guards.js';
import { registerEventAudience } from '../ws/audience.js';
import { seesContact } from './catch-up.js';

// 02b v1.0.3 §6.19 Audiences (no catch-all on `order`, 01d To 02). Never to KDS station sockets: they get 03a / 03b
// station frames only. The fixed audiences register once per process at this module's load (like tables/audiences.ts);
// LineComped needs the hub's staff directory, so it registers per server (registerLineCompedAudience, removed on close).

/** Every other `order` event 02b's screens show → staff sockets and cashier kiosks (one body per event, run 3 #14). */
export const ORDER_EVENT_TYPES = [
  'OrderPlaced', // carries no contact (has_phone only, O17)
  'ItemAdded',
  'OrderLinesAdded',
  'ItemRemoved',
  'ItemVoided',
  'ItemServed',
  'ItemReturned',
  'ItemsReleased',
  'OrderBoosted',
  'OrderCancelled',
  'OrderFoodServed',
  'OrderFoodCleared',
  'OrdersBilled',
  'LineWeightSet',
] as const;

/** Stream table / 'zone:' + zone_id; counts are not secret (run 4 M-3). 02a's readers select by event type (AD-6). */
export const ZONE_EVENT_TYPES = ['ZoneStockAdded', 'ZoneStockSet'] as const;

/**
 * 02b v1.0.11 §6.19 (Q-6): kitchen progress → staff sockets and cashier kiosks, so open views refetch on stage changes.
 * OR-ed with 03b's station / point sets (ws/kds-audiences.ts, G-10); KDS station sockets still get them only from 03b.
 */
export const KITCHEN_PROGRESS_EVENT_TYPES = ['ItemStarted', 'ItemDone', 'ItemDoneUndone', 'FireDispatched'] as const;

for (const eventType of [...ORDER_EVENT_TYPES, ...ZONE_EVENT_TYPES, ...KITCHEN_PROGRESS_EVENT_TYPES]) {
  registerEventAudience(eventType, (_event, socket) => socket.kind === 'staff' || socket.deviceType === 'cashier_kiosk');
}

// O17: cashier kiosks and the placer's sockets only. OrderContactSet is appended in the submit batch (§3.2 step 10),
// so its envelope actor_id is the OrderPlaced actor_id (placed_by).
registerEventAudience('OrderContactSet', (event, socket) => event.actor_id !== null && seesContact(socket, event.actor_id));

/**
 * LineComped → cashier kiosks and sockets whose staff hold `apply-comp` (granted, with or without approval), resolved
 * through the hub's StaffDirectory in memory. Returns the unregister function.
 */
export function registerLineCompedAudience(app: FastifyInstance): () => void {
  return registerEventAudience('LineComped', (_event, socket) => {
    if (socket.deviceType === 'cashier_kiosk') return true;
    if (socket.kind !== 'staff' || socket.staffId === null) return false;
    const grant = currentDirectory(app).resolve(socket.staffId, 'apply-comp').grant;
    return grant === 'allowed' || grant === 'requires_approval';
  });
}
