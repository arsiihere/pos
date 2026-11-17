// 04 §6.4 `GET /queries/pending-voids?order_ids=…` (1–40) or `?seating_id=` (task v9). `take-order` or `void-item` or
// `approve-void` (any grant). `pendingVoids` with the engine state: 1 statement (the seating form resolves through
// `seating_orders` in the same statement); `blocked` from engine state in memory (OQ-D). Only orders that have an open
// request are listed, oldest request first. Lane V2 owns this file.
import { DomainError, type Permission } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineQuery, queryRegistry, type QueryCtx } from '../../queries/registry.js';
import type { PendingVoid } from '../contracts.js';
import { pendingVoids, pendingVoidsOfSeating } from '../exports.js';

const issue = (path: string, message: string) => ({ path: [path], message });

/** §6.4 query string: exactly one of `order_ids` (comma list, de-duplicated, 1–40) and `seating_id`. */
export const PendingVoidsQuery = z
  .object({
    order_ids: z.string().transform((s) => [...new Set(s.split(','))]).optional(),
    seating_id: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((q, rc) => {
    if ((q.order_ids === undefined) === (q.seating_id === undefined)) rc.addIssue({ code: 'custom', ...issue('order_ids', 'exactly one of order_ids and seating_id') });
    if (q.order_ids === undefined) return;
    if (q.order_ids.some((id) => id === '')) rc.addIssue({ code: 'custom', ...issue('order_ids', 'empty id') });
    else if (q.order_ids.length > 40) rc.addIssue({ code: 'custom', ...issue('order_ids', 'at most 40 ids') });
  });
type PendingVoidsQuery = z.infer<typeof PendingVoidsQuery>;

const READERS: readonly Permission[] = ['take-order', 'void-item', 'approve-void'];

function pendingVoidsQuery(ctx: QueryCtx, q: PendingVoidsQuery): { orders: Array<{ order_id: string; voids: PendingVoid[] }> } {
  const staffId = ctx.session?.staff_id ?? null;
  const granted = staffId !== null && READERS.some((p) => {
    const g = ctx.directory.resolve(staffId, p).grant;
    return g === 'allowed' || g === 'requires_approval';
  });
  if (!granted) throw new DomainError('PERMISSION_DENIED', { permissions: [...READERS] });
  const map = q.seating_id !== undefined ? pendingVoidsOfSeating(ctx.db, q.seating_id, ctx.state) : pendingVoids(ctx.db, q.order_ids!, ctx.state);
  return { orders: [...map].map(([order_id, voids]) => ({ order_id, voids })) };
}

export function registerPendingVoidsQuery(app: FastifyInstance): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'pending-voids',
      sessionKind: 'device',
      session: 'required',
      querySchema: PendingVoidsQuery,
      handle: (ctx, q) => ({ data: pendingVoidsQuery(ctx, q) }),
    }),
  );
}
