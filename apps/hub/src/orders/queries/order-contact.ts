import { DomainError } from '@pos/domain';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { CommandCtx } from '../../commands/registry.js';
import { defineQuery, queryRegistry, type QueryCtx } from '../../queries/registry.js';
import { checkOrderScope, type ScopedOrder } from '../commands/mark-served.js';

// 02b v1.0.3 §6.18 GET /queries/order-contact, O17, §7 Privacy: `view-customer-contact` with the order's scope "as
// MarkServed" (§3.14; the shared check of commands/mark-served.ts), countsAsActivity true (a deliberate tap). Logged
// `info { order_id, staff_id }`, never the values. Statements: 1 (the order, its contact and its open seating's holder;
// `my_floors` on a dine-in order adds 02a currentTableOf, as for MarkServed). Order: permission → order → scope (C8).

const ORDER_CONTACT = `SELECT o.order_id AS order_id, o.order_type AS order_type, o.placed_by AS placed_by,
       s.holder_staff_id AS holder_staff_id, o.customer_name AS customer_name, o.phone AS phone
  FROM orders o
  LEFT JOIN seating_orders so ON so.order_id = o.order_id
  LEFT JOIN seatings s ON s.seating_id = so.seating_id AND s.state <> 'CLOSED'
 WHERE o.order_id = ?`;

type ContactRow = ScopedOrder & { customer_name: string | null; phone: string | null };

function orderContact(ctx: QueryCtx, order_id: string, log: FastifyInstance['log']): { customer_name: string | null; phone: string | null } {
  const staffId = ctx.session?.staff_id ?? null;
  const permission = staffId === null ? null : ctx.directory.resolve(staffId, 'view-customer-contact');
  if (permission === null || permission.grant !== 'allowed') {
    throw new DomainError('PERMISSION_DENIED', { permission: 'view-customer-contact', grant: permission?.grant ?? 'not_granted' });
  }
  const row = ctx.db.prepare(ORDER_CONTACT).get(order_id) as ContactRow | undefined;
  if (row === undefined) throw new DomainError('ORDER_NOT_FOUND', { order_id });
  // checkOrderScope reads only the actor, the resolved permission, the directory and (my_floors) the db.
  checkOrderScope(scopeCtx(ctx.db, ctx, staffId, permission), [row]);
  log.info({ order_id, staff_id: staffId }, 'order contact viewed');
  return { customer_name: row.customer_name, phone: row.phone };
}

function scopeCtx(db: Database.Database, ctx: QueryCtx, staffId: string | null, permission: CommandCtx['permission']): CommandCtx {
  return { actor: { staffId }, permission, directory: ctx.directory, tx: { db } } as unknown as CommandCtx;
}

export function registerOrderContactQuery(app: FastifyInstance): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'order-contact',
      sessionKind: 'device',
      session: 'required',
      countsAsActivity: true,
      querySchema: z.object({ order_id: z.string().min(1) }),
      handle: (ctx, q) => ({ data: orderContact(ctx, q.order_id, app.log) }),
    }),
  );
}
