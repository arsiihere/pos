import { DomainError } from '@pos/domain';
import { applyEvent, availableStock, dayStockUnit, openDayStartMs, stockLevel, stockOf, type EngineState } from '@pos/engine';
import type { ConfigItem, ConfigStockItem } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Resolution, StaffDirectory } from '../auth/staff-directory.js';
import { branchConfig } from '../sync/branch-config-holder.js';
import { defineCommand, type CommandCtx } from './registry.js';
import { commandRegistry } from './route.js';

const Payload = z.object({
  entries: z
    .array(z.object({ stock_item_id: z.string().min(1), on_hand: z.number().int().min(0).max(1_000_000) }))
    .min(1)
    .max(200)
    .superRefine(uniqueStockItemIds),
});

// 01c §6.18 (01a §6.17): one StockSet v2 per entry, even when on_hand equals the current value (S41).
export function registerSetPrecookedStock(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'SetPrecookedStock',
      payloadSchema: Payload,
      sessionKind: 'admin',
      permission: 'manage-stock',
      handle(ctx, payload) {
        const stockItems = stockItemsOf(ctx.state, payload.entries);
        requireStockItemsInScope(ctx, stockItems);
        const now = ctx.clock.branchNow();
        const appended = ctx.tx.append(
          payload.entries.map((entry, i) => ({
            stream_type: 'stock' as const,
            stream_id: entry.stock_item_id,
            event_type: 'StockSet',
            schema_version: 2,
            payload: { stock_item_id: entry.stock_item_id, on_hand: entry.on_hand, unit: dayStockUnit(ctx.state, stockItems[i]!) },
            occurred_at: now,
            actor_id: ctx.actor.staffId,
            device_id: ctx.actor.deviceId,
          })),
        );
        const next = appended.reduce((s, e) => applyEvent(s, e, { strict: false }), ctx.state);
        return { events: [], result: { stock_items: stockItems.map((stockItem) => stockItemResult(next, stockItem, now)) } };
      },
    }),
  );
}

// 01c §6.18, C6: a repeated stock_item_id → 400 at entries.N.stock_item_id, N the repeat.
export function uniqueStockItemIds(entries: ReadonlyArray<{ stock_item_id: string }>, rc: z.RefinementCtx): void {
  const seen = new Set<string>();
  entries.forEach((entry, i) => {
    if (seen.has(entry.stock_item_id)) rc.addIssue({ code: 'custom', path: [i, 'stock_item_id'], message: 'duplicate stock_item_id' });
    seen.add(entry.stock_item_id);
  });
}

// 01c §6.18 order (01a §6.17): config present → a business day is open → each entry a stock item of this
// branch's config (else 404 for the first such entry); every entry is checked before any event is written.
export function stockItemsOf(state: Readonly<EngineState>, entries: ReadonlyArray<{ stock_item_id: string }>): ConfigStockItem[] {
  const config = branchConfig();
  if (config === null) throw new DomainError('STOCK_ITEM_NOT_FOUND', { stock_item_id: entries[0]!.stock_item_id });
  if (openDayStartMs(state) === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');
  return entries.map((entry) => {
    const stockItem = config.stock_items.find((candidate) => candidate.stock_item_id === entry.stock_item_id);
    if (stockItem === undefined) throw new DomainError('STOCK_ITEM_NOT_FOUND', { stock_item_id: entry.stock_item_id });
    return stockItem;
  });
}

// 01c §6.18, C8, 01b B1 / B20: under manage-stock scope my_stations each stock item's station must be one of
// the person's count_stock stations; checked after the 404 / 409 checks, before any event is written.
export function requireStockItemsInScope(ctx: CommandCtx, stockItems: ReadonlyArray<ConfigStockItem>): void {
  const inScope = stockItemScopeFilter(ctx.directory, ctx.actor.staffId, ctx.permission);
  const outside = stockItems.filter((stockItem) => !inScope(stockItem)).map((stockItem) => stockItem.stock_item_id);
  if (outside.length > 0) {
    throw new DomainError('PERMISSION_DENIED', { permission: 'manage-stock', reason: 'outside_scope', stock_item_ids: outside });
  }
}

// 01b B20, §4.4 row 9: under `manage-stock` scope `my_stations` the items must be routed at this branch to one
// of the person's count_stock stations (SetItemAvailability); checked after the 01a checks.
export function requireItemsInScope(ctx: CommandCtx, items: ReadonlyArray<Pick<ConfigItem, 'item_id' | 'station_id'>>): void {
  const inScope = stockScopeFilter(ctx.directory, ctx.actor.staffId, ctx.permission);
  const outside = items.filter((item) => !inScope(item)).map((item) => item.item_id);
  if (outside.length > 0) {
    throw new DomainError('PERMISSION_DENIED', { permission: 'manage-stock', reason: 'outside_scope', item_ids: outside });
  }
}

// 01b D-6, §4.4 row 12: day open and close act on the whole branch; checked right after the manage-stock step.
export function requireBranchScope(ctx: CommandCtx): void {
  if (manageStockScope(ctx.permission) === 'branch') return;
  throw new DomainError('PERMISSION_DENIED', { permission: 'manage-stock', reason: 'outside_scope', required_scope: 'branch' });
}

// 01b §4.4 row 13: the session's manage-stock scope; anything but `my_stations` behaves as `branch`.
export function manageStockScope(resolution: Resolution | null): 'branch' | 'my_stations' {
  return resolution !== null && 'scope' in resolution && resolution.scope === 'my_stations' ? 'my_stations' : 'branch';
}

// 01b B20: scope `branch` keeps every item; `my_stations` keeps the items routed to the person's stations.
export function stockScopeFilter(
  directory: StaffDirectory,
  staffId: string | null,
  resolution: Resolution | null,
): (item: Pick<ConfigItem, 'station_id'>) => boolean {
  if (manageStockScope(resolution) === 'branch') return () => true;
  const stations = new Set(staffId === null ? [] : directory.stationsOf(staffId, 'count_stock'));
  return (item) => stations.has(item.station_id);
}

// 01c §6.18, 01b B1: scope `branch` keeps every stock item; `my_stations` keeps those whose own station_id is
// one of the person's count_stock stations.
export function stockItemScopeFilter(
  directory: StaffDirectory,
  staffId: string | null,
  resolution: Resolution | null,
): (stockItem: Pick<ConfigStockItem, 'station_id'>) => boolean {
  if (manageStockScope(resolution) === 'branch') return () => true;
  const stations = new Set(staffId === null ? [] : directory.stationsOf(staffId, 'count_stock'));
  return (stockItem) => stations.has(stockItem.station_id);
}

// S40 N8: set_at is the command's clock reading; the stock query is the truth.
// 01c §6.18, V5, §3.5.1: the numbers and level of the stock item.
export function stockItemResult(state: EngineState, stockItem: ConfigStockItem, setAt: number) {
  const entry = stockOf(state, stockItem.stock_item_id);
  const start = openDayStartMs(state);
  return {
    stock_item_id: stockItem.stock_item_id,
    on_hand: entry.on_hand,
    reserved: entry.reserved,
    unit: entry.unit,
    available: availableStock(state, stockItem.stock_item_id, start, stockItem),
    level: stockLevel(state, stockItem.stock_item_id, start, stockItem),
    set_at: setAt,
  };
}
