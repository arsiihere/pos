// 03b §6.11 GET /queries/pass-receivers?order_id — `run-pass`, checked inside the handler (queries have no permission
// field; pattern queries/stock.ts). `{ receivers: [{ staff_id, name, table_team }] }`: staff with an open staff session
// whose `mark-served` covers the order (§3.5 step 2: `allowed` + 02b's `orderCovered`, the same rule as Handover),
// table team first. Statements 3: the scoped order row, one shared `currentTableOf` (dine-in), the open staff sessions.
// ⚠️ 03b v1.0.1 (G-3): coverage per candidate is memory only, over the one shared table read (no read per candidate).
import { DomainError } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { passScopedOrders, receiverCovers } from '../kds/commands/handover.js';
import { currentTableOf } from '../tables/reads.js';
import { waiterTeam } from '../tables/team.js';
import { defineQuery, queryRegistry, type QueryCtx } from './registry.js';

export interface PassReceiver {
  staff_id: string;
  name: string;
  /** in the order's table team (02a W ∪ {holder} of its open seating) */
  table_team: boolean;
}

function passReceivers(ctx: QueryCtx, order_id: string): { receivers: PassReceiver[] } {
  const staffId = ctx.session?.staff_id ?? null;
  const right = staffId === null ? null : ctx.directory.resolve(staffId, 'run-pass');
  if (right === null || right.grant !== 'allowed') throw new DomainError('PERMISSION_DENIED', { permission: 'run-pass', grant: right?.grant ?? 'not_granted' });

  const order = passScopedOrders(ctx.db, [order_id]).get(order_id);
  if (order === undefined) throw new DomainError('ORDER_NOT_FOUND', { order_id });
  const tables = order.order_type === 'dine_in' ? currentTableOf(ctx.db, [order_id]) : null;
  const live = new Set(
    (ctx.db.prepare(`SELECT DISTINCT staff_id FROM staff_sessions WHERE ended_at IS NULL AND kind = 'staff' AND staff_id IS NOT NULL`).all() as Array<{ staff_id: string }>).map(
      (r) => r.staff_id,
    ),
  );

  const seating = tables?.get(order_id);
  const team =
    order.holder_staff_id === null
      ? new Set<string>()
      : new Set(
          waiterTeam(
            { assignee: seating === undefined ? null : ctx.directory.assignedOrderTaker(seating.primary_table_id), holder_staff_id: order.holder_staff_id },
            live,
            ctx.directory,
          ),
        );
  const receivers: PassReceiver[] = [];
  for (const id of live) {
    if (!receiverCovers(ctx.directory, id, order, tables)) continue;
    receivers.push({ staff_id: id, name: ctx.directory.get(id)?.display_name ?? id, table_team: team.has(id) });
  }
  receivers.sort((a, b) => Number(b.table_team) - Number(a.table_team) || a.name.localeCompare(b.name) || a.staff_id.localeCompare(b.staff_id));
  return { receivers };
}

export function registerPassReceiversQuery(app: FastifyInstance): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'pass-receivers',
      sessionKind: 'device',
      session: 'required',
      querySchema: z.object({ order_id: z.string().min(1) }),
      handle: (ctx, q) => ({ data: passReceivers(ctx, q.order_id) }),
    }),
  );
}
