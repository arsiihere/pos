// 02b §6.5 ReleaseItems, §6.6 BoostOrder; §3.8, O18, §3.14 (scope "as MarkServed"). No lock (O9).
import { DomainError } from '@pos/domain';
import { isOrderInEngine, planRelease } from '@pos/engine';
import type { EventDraft, OrderBoostedPayload } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { alerts } from '../../alerts/raise.js';
import type { CommandCtx } from '../../commands/registry.js';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { checkOrderScope, scopedOrders } from './mark-served.js';

// ------------------------------------------------------------------------------------------- §6.5 ReleaseItems

// Sets (README C1): a repeated id is dropped, not refused.
export const ReleaseItemsPayload = z.object({
  order_ids: z.array(z.string().min(1)).min(1),
  released: z.array(z.string().min(1)),
  expedite: z.array(z.string().min(1)),
});
type ReleasePayload = z.infer<typeof ReleaseItemsPayload>;

/**
 * §3.8 / §6.5. Statements: 1 orders (+ holder, `scopedOrders`), + `currentTableOf` for a `my_floors` dine-in; no
 * extra read (#24): `planRelease` fills each group's `alert_id` from memory. Every order must be in the engine, else
 * 409 ORDER_NOT_IN_ENGINE (an unknown order included). Scope last (C8). Batch: `ItemsReleased` per order with work
 * (`planRelease`; the client's goes-with pre-ticks arrive in `expedite`), then one `alerts.closeMany` closing `done`
 * every distinct non-null `alert_id` (03a To 02 #7; on a joined table one call closes each warning, O18).
 */
function releaseItems(ctx: CommandCtx, payload: ReleasePayload): { events: EventDraft[]; result: { alerts_closed: number } } {
  const now = ctx.clock.branchNow();
  const orderIds = [...new Set(payload.order_ids)];
  const orders = scopedOrders(ctx.tx.db, orderIds);
  for (const order_id of orderIds) {
    if (!orders.has(order_id) || !isOrderInEngine(ctx.state, order_id, now)) throw new DomainError('ORDER_NOT_IN_ENGINE', { order_id });
  }

  checkOrderScope(ctx, orderIds.map((id) => orders.get(id)!));

  const envelope = { occurred_at: now, actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId };
  const released = planRelease(ctx.state, orderIds, { released: [...new Set(payload.released)], expedite: [...new Set(payload.expedite)] }).map(
    (d): EventDraft => ({ ...d, ...envelope }),
  );
  const alertIds = [...new Set(released.map((d) => (d.payload as { alert_id: string | null }).alert_id).filter((id): id is string => id !== null))];
  const closed = alertIds.length === 0 ? [] : alerts.closeMany(ctx, alertIds.map((alert_id) => ({ alert_id, reason: 'done' as const })));
  return { events: [...released, ...closed], result: { alerts_closed: closed.filter((d) => d.event_type === 'AlertClosed').length } };
}

export const releaseItemsCommand = defineCommand({
  commandType: 'ReleaseItems',
  payloadSchema: ReleaseItemsPayload,
  sessionKind: 'device',
  permission: 'mark-served',
  handle: (ctx, payload) => releaseItems(ctx, payload),
});

// ------------------------------------------------------------------------------------------- §6.6 BoostOrder

export const BoostOrderPayload = z.object({ order_id: z.string().min(1) });
type BoostPayload = z.infer<typeof BoostOrderPayload>;

/**
 * §3.8 / §6.6. Statements: 1 order (+ holder, `scopedOrders`), + `currentTableOf` for a `my_floors` dine-in. Unknown
 * → 404 ORDER_NOT_FOUND; not in the engine → 409 ORDER_NOT_IN_ENGINE; scope last (C8). Batch: `OrderBoosted`.
 */
function boostOrder(ctx: CommandCtx, payload: BoostPayload): { events: EventDraft[]; result: Record<string, never> } {
  const now = ctx.clock.branchNow();
  const order = scopedOrders(ctx.tx.db, [payload.order_id]).get(payload.order_id);
  if (order === undefined) throw new DomainError('ORDER_NOT_FOUND', { order_id: payload.order_id });
  if (!isOrderInEngine(ctx.state, payload.order_id, now)) throw new DomainError('ORDER_NOT_IN_ENGINE', { order_id: payload.order_id });

  checkOrderScope(ctx, [order]);

  const p: OrderBoostedPayload = { order_id: payload.order_id };
  const event: EventDraft = {
    stream_type: 'order',
    stream_id: payload.order_id,
    event_type: 'OrderBoosted',
    schema_version: 1,
    payload: p,
    occurred_at: now,
    actor_id: ctx.actor.staffId,
    device_id: ctx.actor.deviceId,
  };
  return { events: [event], result: {} };
}

export const boostOrderCommand = defineCommand({
  commandType: 'BoostOrder',
  payloadSchema: BoostOrderPayload,
  sessionKind: 'device',
  permission: 'boost-order',
  handle: (ctx, payload) => boostOrder(ctx, payload),
});

export function registerReleaseBoost(app: FastifyInstance): void {
  commandRegistry(app).register(releaseItemsCommand);
  commandRegistry(app).register(boostOrderCommand);
}
