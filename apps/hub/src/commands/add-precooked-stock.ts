import { applyEvent, countIsValid, dayStockUnit, openDayStartMs, stockOf } from '@pos/engine';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineCommand } from './registry.js';
import { commandRegistry } from './route.js';
import { requireStockItemsInScope, stockItemResult, stockItemsOf, uniqueStockItemIds } from './set-precooked-stock.js';

const Payload = z.object({
  entries: z
    .array(z.object({ stock_item_id: z.string().min(1), quantity: z.number().int().min(1).max(1_000_000) }))
    .min(1)
    .max(200)
    .superRefine(uniqueStockItemIds),
});

// 01c §6.19 (01a §6.17a), S45: an add onto a valid count is a StockAdded v2; onto an invalid one it is the new count.
export function registerAddPrecookedStock(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'AddPrecookedStock',
      payloadSchema: Payload,
      sessionKind: 'admin',
      permission: 'manage-stock',
      handle(ctx, payload) {
        const stockItems = stockItemsOf(ctx.state, payload.entries);
        requireStockItemsInScope(ctx, stockItems);
        const start = openDayStartMs(ctx.state);
        const now = ctx.clock.branchNow();
        const recordedAs: Array<'added' | 'set'> = [];
        const drafts = payload.entries.map((entry, i) => {
          const stockItem = stockItems[i]!;
          const unit = dayStockUnit(ctx.state, stockItem);
          const valid = countIsValid(stockOf(ctx.state, entry.stock_item_id), start, { carries_over: stockItem.carries_over, stock_unit: unit });
          recordedAs.push(valid ? 'added' : 'set');
          return {
            stream_type: 'stock' as const,
            stream_id: entry.stock_item_id,
            event_type: valid ? 'StockAdded' : 'StockSet',
            schema_version: 2,
            payload: valid
              ? { stock_item_id: entry.stock_item_id, quantity: entry.quantity, unit }
              : { stock_item_id: entry.stock_item_id, on_hand: entry.quantity, unit },
            occurred_at: now,
            actor_id: ctx.actor.staffId,
            device_id: ctx.actor.deviceId,
          };
        });
        const next = ctx.tx.append(drafts).reduce((s, e) => applyEvent(s, e, { strict: false }), ctx.state);
        return {
          events: [],
          result: {
            // S45: an add is not a count, so its set_at stays the count's time.
            // An 'added' entry always has a set_at: countIsValid is false when it is null.
            stock_items: payload.entries.map((entry, i) => {
              const setAt = recordedAs[i] === 'added' ? stockOf(next, entry.stock_item_id).set_at! : now;
              return { ...stockItemResult(next, stockItems[i]!, setAt), recorded_as: recordedAs[i]! };
            }),
          },
        };
      },
    }),
  );
}
