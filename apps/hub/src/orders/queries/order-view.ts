import { DomainError } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineQuery, queryRegistry, type QueryCtx } from '../../queries/registry.js';
import { orderCovered } from '../commands/mark-served.js';
import type { OrderView } from '../contracts.js';
import { orderLines } from '../exports.js';
import { pendingComps, toSeatingOrder, type PendingCompLog, type SeatingOrder } from './seating-orders.js';

// ⚠️ 02b v1.0.11 §6.18a GET /queries/order-view (owner ruling 2026-11-12, Q-8; scope Q-27, §12.3 Q6): `{ order_id }` →
// one order in the §6.15 SeatingOrder shape (the shared builder `toSeatingOrder`), for the takeaway / parking token view.
// Staff session; countsAsActivity false. Statements: 2 (the order row, its lines through orderLines) + 1 (the open comp
// requests of `pending_comp`, ⚠️ Q-11, as §6.15) = 3.
// Order: order (unknown → 404 ORDER_NOT_FOUND) → scope (C8, last):
// - takeaway / parking: as MarkServed (§3.14), from placed_by — the caller's `mark-served` right through the shared
//   pure rule `orderCovered` (branch → any; own_tables / my_floors → placed by the caller); 0 statements. orderCovered
//   checks the scope only, so a right that is not `allowed` covers nothing (MarkServed itself would refuse it).
//   Outside → 403 PERMISSION_DENIED { reason: 'outside_scope', order_ids }, as checkOrderScope.
// - dine-in: any staff session, as seating-orders (Q-27).

const ORDER = `SELECT o.order_id, o.order_type, o.table_key, o.business_date, o.token, o.car_number, o.car_type, o.order_note,
       o.placed_by, o.placed_at, o.follow_up, o.cancelled_at, o.billed_at, o.day_closed_at, o.sent_after_reconnect,
       o.phone IS NOT NULL AS has_phone
  FROM orders o
 WHERE o.order_id = ?`;

type OrderRow = Omit<OrderView, 'follow_up' | 'cancelled' | 'billed' | 'sent_after_reconnect' | 'has_phone' | 'lines'> & {
  follow_up: number;
  sent_after_reconnect: number;
  has_phone: number;
};

export function orderViewBody(ctx: QueryCtx, order_id: string, log: PendingCompLog): SeatingOrder {
  const r = ctx.db.prepare(ORDER).get(order_id) as OrderRow | undefined;
  if (r === undefined) throw new DomainError('ORDER_NOT_FOUND', { order_id });
  if (r.order_type !== 'dine_in') {
    const staffId = ctx.session?.staff_id ?? null;
    const right = staffId === null ? null : ctx.directory.resolve(staffId, 'mark-served');
    const scoped = { order_id, order_type: r.order_type, placed_by: r.placed_by, holder_staff_id: null };
    const who = { staffId, resolution: right !== null && right.grant === 'allowed' ? right : null };
    if (!orderCovered(scoped, who, null, (id) => ctx.directory.floorsOf(id))) {
      throw new DomainError('PERMISSION_DENIED', { reason: 'outside_scope', order_ids: [order_id] });
    }
  }
  const order: OrderView = {
    ...r,
    follow_up: r.follow_up === 1,
    cancelled: r.cancelled_at !== null,
    billed: r.billed_at !== null,
    sent_after_reconnect: r.sent_after_reconnect === 1,
    has_phone: r.has_phone === 1,
    lines: orderLines(ctx.db, [order_id]).get(order_id)!,
  };
  return toSeatingOrder(ctx.state, ctx.directory, order, ctx.now, pendingComps(ctx.db, log));
}

export function registerOrderViewQuery(app: FastifyInstance): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'order-view',
      sessionKind: 'device',
      session: 'required',
      countsAsActivity: false,
      querySchema: z.object({ order_id: z.string().min(1) }),
      handle: (ctx, q) => ({ data: orderViewBody(ctx, q.order_id, app.log) }),
    }),
  );
}
