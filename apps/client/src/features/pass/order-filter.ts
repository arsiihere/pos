import type { PointOrder } from './contracts';

// 02b-tk C3-4 (03b v1.0.15 §6.15; frame PackerPass): the Pass filter chip by order type. Every `point_view` line carries
// `order_type` (LineDetail); a card with no line left (never sent by the hub) reads its identifier. All and the other
// filters keep the oldest-first order (placed_at, §3.4); Takeaway is sorted by promise (02b §6.16 open-orders
// `promise_ms`), an order whose promise is not known yet after the known ones, oldest first.

export type PassFilter = 'all' | 'dine_in' | 'takeaway' | 'parking';
export type PassOrderType = Exclude<PassFilter, 'all'>;

export const PASS_FILTERS: readonly PassFilter[] = ['all', 'dine_in', 'takeaway', 'parking'];

export function orderTypeOf(order: PointOrder): PassOrderType {
  const first = order.lines[0];
  if (first !== undefined) return first.order_type;
  return order.identifier.kind === 'token' ? 'takeaway' : order.identifier.kind === 'parking' ? 'parking' : 'dine_in';
}

export function typeCounts(orders: readonly PointOrder[]): Record<PassOrderType, number> {
  const counts: Record<PassOrderType, number> = { dine_in: 0, takeaway: 0, parking: 0 };
  for (const o of orders) counts[orderTypeOf(o)] += 1;
  return counts;
}

const byPlaced = (a: PointOrder, b: PointOrder) => a.placed_at - b.placed_at;

/** The cards a filter shows, in its order. `promises` = order_id → promise_ms (takeaway only). */
export function ordersFor(orders: readonly PointOrder[], filter: PassFilter, promises: ReadonlyMap<string, number | null>): PointOrder[] {
  const shown = (filter === 'all' ? [...orders] : orders.filter((o) => orderTypeOf(o) === filter)).sort(byPlaced);
  if (filter !== 'takeaway') return shown;
  const promiseOf = (o: PointOrder) => promises.get(o.order_id) ?? Number.POSITIVE_INFINITY;
  return shown.sort((a, b) => promiseOf(a) - promiseOf(b) || byPlaced(a, b));
}
