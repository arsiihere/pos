import type { PointLine, PointOrder } from './contracts';
import { orderTypeOf } from './order-filter';
import { isPickup, notCollectedMin, pickupReady, readiness, type Readiness } from './cards/readiness';
import { pendingLines } from './actions/ReadySheet';

// ⚠️ 03b v1.0.17 §3.4 (owner ruling 2026-11-28 "Pass bag = token"; QA BUG-8): the Pass shows ONE card per takeaway /
// parking token. A token's orders are its root and its additions (05 #44a: an addition is its own order and keeps the
// root's token); they share the card, oldest first. The card is Ready only when every order of it is ready (an
// addition drops it back to Cooking), its amber needs every open order's bag epoch, and its actions (Bag ready,
// Handed to customer, Undo) act on every order, one command per order (the kitchen side stays per order). A dine-in
// order, a parking order and a token-less order stay one card per order. Pure.

export interface PassBag {
  /** `token:<date>:<n>` for a token's bag, else the order id */
  key: string;
  /** the token's orders on this point, oldest first; [0] = the root */
  orders: PointOrder[];
  /** what the card draws: the root's id, identifier and time; every order's lines and station-less lines */
  card: PointOrder;
}

/** The bag key of an order: a takeaway token groups by business date and number; anything else is its own bag. */
export function bagKey(o: PointOrder): string {
  const id = o.identifier;
  if (id.kind === 'token' && orderTypeOf(o) === 'takeaway') return `token:${id.date ?? ''}:${id.token}`;
  return o.order_id;
}

const latest = (xs: ReadonlyArray<number | null | undefined>): number | null => {
  let v: number | null = null;
  for (const x of xs) if (x != null && (v === null || x > v)) v = x;
  return v;
};

function merged(orders: PointOrder[]): PointOrder {
  const root = orders[0]!;
  if (orders.length === 1) return root;
  const pickups = orders.map((o) => o.pickup_at_ms ?? null);
  const counter = orders.flatMap((o) => o.no_station_lines ?? []);
  return {
    ...root,
    lines: orders.flatMap((o) => o.lines),
    // the card's own `ready` is never read for a bag (bagState / the band read the orders)
    ready: null,
    pickup_at_ms: latest(pickups),
    boosted: orders.every((o) => o.pickup_at_ms == null || o.boosted === true),
    no_station_lines: counter,
  };
}

/**
 * The cards of a list of orders, in the order the list first names each bag (the caller's sort: oldest first, or by
 * promise under the Takeaway filter).
 */
export function bagsOf(orders: readonly PointOrder[]): PassBag[] {
  const byKey = new Map<string, PointOrder[]>();
  for (const o of orders) {
    const key = bagKey(o);
    const list = byKey.get(key);
    if (list === undefined) byKey.set(key, [o]);
    else list.push(o);
  }
  return [...byKey].map(([key, list]) => {
    const sorted = [...list].sort((a, b) => a.placed_at - b.placed_at);
    return { key, orders: sorted, card: merged(sorted) };
  });
}

/**
 * The bag's readiness: every order not yet handed over in full counts. Cooking / HOLD when any order is; Ready when
 * every order is ready or already marked ready and one of them is not marked yet; `sent` when every one is marked.
 */
export function bagState(bag: PassBag, nowMs: number): Readiness {
  const each = bag.orders.map((o) => readiness(o, nowMs)).filter((r) => r.state !== 'none');
  const held = new Set<string>();
  for (const r of each) for (const id of r.held) held.add(id);
  if (each.length === 0) return { state: 'none', held };
  if (each.some((r) => r.state === 'cooking')) return { state: 'cooking', held };
  if (each.some((r) => r.state === 'hold')) return { state: 'hold', held };
  if (each.every((r) => r.state === 'sent')) return { state: 'sent', held };
  return { state: 'ready', held };
}

/** Amber "not collected" (03b §3.4 R3-M-9) for the whole bag: every open order past its window; the shortest wait. */
export function bagLate(bag: PassBag, nowMs: number): number | null {
  const open = bag.orders.filter((o) => o.lines.some((l) => !l.handed_over));
  if (open.length === 0) return null;
  let min: number | null = null;
  for (const o of open) {
    const n = notCollectedMin(o, nowMs);
    if (n === null) return null;
    min = min === null ? n : Math.min(min, n);
  }
  return min;
}

/** A pickup order's whole-order readiness (R3-M-5) holds for every pickup order of the bag. */
export function bagPickupOk(bag: PassBag, nowMs: number): boolean {
  return bag.orders.every((o) => !isPickup(o) || pickupReady(o, nowMs) || o.lines.every((l) => l.handed_over));
}

/** Each order's lines a Bag ready can still take (ReadySheet.pendingLines), orders with none left out. */
export function bagPending(bag: PassBag): Array<{ order: PointOrder; lines: PointLine[] }> {
  return bag.orders.map((order) => ({ order, lines: pendingLines(order) })).filter((p) => p.lines.length > 0);
}

/** The order a line of the bag belongs to. */
export function orderOfLine(bag: PassBag, order_item_id: string): PointOrder | undefined {
  return bag.orders.find((o) => o.lines.some((l) => l.order_item_id === order_item_id));
}
