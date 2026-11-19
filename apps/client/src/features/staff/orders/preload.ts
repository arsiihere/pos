import type { Preload } from '../../alerts/deeplink-check';
import { matchStaffRoute } from '../shell/routes';
import type { OrderViewBody, ZoneStockBody } from './contracts';

// 01d v1.3 §3.13.3 "Reads per tap" (m3), 02b v1.0.15 §8: the read the deep-link tap made for its open check is
// handed to the screen it opens, so that screen's first render makes no second read. Integrator ruling (a), cp6.
// A one-shot handover:
// - a screen mounting on its route takes it once (OrderView for that takeaway / parking order, ZoneStock for #/zones);
// - a screen already mounted on that route (the tap landed where the person already was) is told and applies it;
// - it is only ever served on its own route (the hash at the time of the take);
// - it is dropped at the first hash change to another route, and in any case HANDOVER_MS after the tap, so a later
//   visit, or a remount after a sign-out and sign-in, always reads fresh. `dropHandover()` drops it at once.

type Held = { kind: 'order_view'; body: OrderViewBody } | { kind: 'zone_stock'; body: ZoneStockBody[] };

/** How long a handover waits for its screen: the tap's own arrival window (deeplink-tap.ts ARRIVAL_MS). */
export const HANDOVER_MS = 4_000;

let held: Held | null = null;
let expiry: ReturnType<typeof setTimeout> | null = null;
let listening = false;
const mounted = new Set<() => void>();

/** Whether the hash now is the route the held read is for (the device type does not matter for these two routes). */
function isHere(h: Held): boolean {
  const route = matchStaffRoute(window.location.hash.replace(/^#/, ''), 'tablet');
  return h.kind === 'order_view' ? route.name === 'order_view' && route.order_id === h.body.order_id : route.name === 'zones';
}

export function dropHandover(): void {
  held = null;
  if (expiry !== null) clearTimeout(expiry);
  expiry = null;
}

function onHashChange(): void {
  if (held !== null && !isHere(held)) dropHandover();
}

/** The tap, right before it navigates (deeplink-tap.ts `case 'open'`). */
export function handOver(preload: Preload): void {
  dropHandover();
  held = 'order_view' in preload ? { kind: 'order_view', body: preload.order_view } : { kind: 'zone_stock', body: preload.zone_stock };
  expiry = setTimeout(dropHandover, HANDOVER_MS);
  if (!listening) {
    window.addEventListener('hashchange', onHashChange);
    listening = true;
  }
  // a screen already on that route: it applies the handover now (its hash only gains `focus`)
  for (const tell of [...mounted]) tell();
}

/** The held order-view body for this order on its route, without taking it (a pure first render). */
export function peekOrderView(order_id: string): OrderViewBody | null {
  return held?.kind === 'order_view' && held.body.order_id === order_id && isHere(held) ? held.body : null;
}

/** The held zone-stock result on #/zones, without taking it (a pure first render). */
export function peekZoneStock(): ZoneStockBody[] | null {
  return held?.kind === 'zone_stock' && isHere(held) ? held.body : null;
}

/** OrderView: the tap's `order-view` body for this order, once, on this order's route; else null (read as before). */
export function takeOrderView(order_id: string): OrderViewBody | null {
  if (held?.kind !== 'order_view' || held.body.order_id !== order_id || !isHere(held)) return null;
  const body = held.body;
  dropHandover();
  return body;
}

/** ZoneStock: the tap's `zone-stock` result, once, on #/zones; else null (read as before). */
export function takeZoneStock(): ZoneStockBody[] | null {
  if (held?.kind !== 'zone_stock' || !isHere(held)) return null;
  const body = held.body;
  dropHandover();
  return body;
}

/** A mounted screen is told of each new handover (it then tries its take). Returns the unsubscribe. */
export function onHandover(tell: () => void): () => void {
  mounted.add(tell);
  return () => {
    mounted.delete(tell);
  };
}
