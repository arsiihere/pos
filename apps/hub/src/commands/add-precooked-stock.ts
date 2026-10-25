import { applyEvent, countIsValid, dayUnits, openDayStartMs, stockOf } from '@pos/engine';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineCommand } from './registry.js';
import { commandRegistry } from './route.js';
import { stockItems, stockResult, uniqueItemIds } from './set-precooked-stock.js';

const Payload = z.object({
  entries: z
    .array(z.object({ item_id: z.string().min(1), quantity: z.number().int().min(1).max(1_000_000) }))
    .min(1)
    .max(200)
    .superRefine(uniqueItemIds),
});

// §6.17a, S45: an add onto a valid count is a StockAdded; onto an invalid one it is the new count.
export function registerAddPrecookedStock(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'AddPrecookedStock',
      payloadSchema: Payload,
      sessionKind: 'admin',
      permission: 'manage-stock',
      handle(ctx, payload) {
        const items = stockItems(ctx.state, payload.entries);
        const start = openDayStartMs(ctx.state);
        const now = ctx.clock.branchNow();
        const recordedAs: Array<'added' | 'set'> = [];
        const drafts = payload.entries.map((entry, i) => {
          const item = items[i]!;
          const unit = dayUnits(ctx.state, item).stock_unit;
          const valid = countIsValid(stockOf(ctx.state, entry.item_id), start, { carries_over: item.carries_over, stock_unit: unit });
          recordedAs.push(valid ? 'added' : 'set');
          return {
            stream_type: 'stock' as const,
            stream_id: entry.item_id,
            event_type: valid ? 'StockAdded' : 'StockSet',
            schema_version: 1,
            payload: valid
              ? { item_id: entry.item_id, quantity: entry.quantity, unit }
              : { item_id: entry.item_id, on_hand: entry.quantity, unit },
            occurred_at: now,
            actor_id: ctx.actor.staffId,
            device_id: ctx.actor.deviceId,
          };
        });
        const next = ctx.tx.append(drafts).reduce(applyEvent, ctx.state);
        return {
          events: [],
          result: {
            // S45: an add is not a count, so its set_at stays the count's time.
            // An 'added' entry always has a set_at: countIsValid is false when it is null.
            items: payload.entries.map((entry, i) => {
              const setAt = recordedAs[i] === 'added' ? stockOf(next, entry.item_id).set_at! : now;
              return { ...stockResult(next, items[i]!, setAt), recorded_as: recordedAs[i]! };
            }),
          },
        };
      },
    }),
  );
}
