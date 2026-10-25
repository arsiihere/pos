import { DomainError } from '@pos/domain';
import { applyEvent, availableStock, dayUnits, openDayStartMs, stockLevel, stockOf, type EngineState } from '@pos/engine';
import { isStockTracked, type BranchConfig, type ConfigItem } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { branchConfig } from '../sync/branch-config-holder.js';
import { defineCommand } from './registry.js';
import { commandRegistry } from './route.js';

const Payload = z.object({
  entries: z
    .array(z.object({ item_id: z.string().min(1), on_hand: z.number().int().min(0).max(1_000_000) }))
    .min(1)
    .max(200)
    .superRefine(uniqueItemIds),
});

// §6.17: one StockSet per entry, even when on_hand equals the current value (S41).
export function registerSetPrecookedStock(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'SetPrecookedStock',
      payloadSchema: Payload,
      sessionKind: 'admin',
      permission: 'manage-stock',
      handle(ctx, payload) {
        const items = stockItems(ctx.state, payload.entries);
        const now = ctx.clock.branchNow();
        const appended = ctx.tx.append(
          payload.entries.map((entry, i) => ({
            stream_type: 'stock' as const,
            stream_id: entry.item_id,
            event_type: 'StockSet',
            schema_version: 1,
            payload: { item_id: entry.item_id, on_hand: entry.on_hand, unit: dayUnits(ctx.state, items[i]!).stock_unit },
            occurred_at: now,
            actor_id: ctx.actor.staffId,
            device_id: ctx.actor.deviceId,
          })),
        );
        const next = appended.reduce(applyEvent, ctx.state);
        return {
          events: [],
          result: { items: payload.entries.map((entry, i) => stockResult(next, items[i]!, now)) },
        };
      },
    }),
  );
}

export function uniqueItemIds(entries: ReadonlyArray<{ item_id: string }>, rc: z.RefinementCtx): void {
  const seen = new Set<string>();
  entries.forEach((entry, i) => {
    if (seen.has(entry.item_id)) rc.addIssue({ code: 'custom', path: [i, 'item_id'], message: 'duplicate item_id' });
    seen.add(entry.item_id);
  });
}

// §6.17 order: config present → a business day is open → each entry in config and stock-tracked;
// every entry is checked before any event is written.
export function stockItems(state: Readonly<EngineState>, entries: ReadonlyArray<{ item_id: string }>): ConfigItem[] {
  const config = branchConfig();
  if (config === null) throw new DomainError('MENU_ITEM_NOT_FOUND', { item_id: entries[0]!.item_id });
  if (openDayStartMs(state) === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');
  return entries.map((entry) => trackedItem(config, entry.item_id));
}

function trackedItem(config: BranchConfig, itemId: string): ConfigItem {
  const item = config.items.find((candidate) => candidate.item_id === itemId);
  if (item === undefined) throw new DomainError('MENU_ITEM_NOT_FOUND', { item_id: itemId });
  if (!isStockTracked(config, item)) throw new DomainError('STOCK_NOT_TRACKED', { item_id: itemId });
  return item;
}

// S40 N8: set_at is the command's clock reading; the stock query is the truth.
export function stockResult(state: EngineState, item: ConfigItem, setAt: number) {
  const entry = stockOf(state, item.item_id);
  const start = openDayStartMs(state);
  return {
    item_id: item.item_id,
    on_hand: entry.on_hand,
    reserved: entry.reserved,
    unit: entry.unit,
    available: availableStock(state, item.item_id, start, item),
    level: stockLevel(state, item.item_id, start, item),
    set_at: setAt,
  };
}
