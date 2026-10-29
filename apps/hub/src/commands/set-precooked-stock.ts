import { DomainError, type Unit } from '@pos/domain';
import { applyEvent, availableStock, dayStockUnit, openDayStartMs, stockLevel, stockOf, type EngineState } from '@pos/engine';
import { isStockTrackedV1, type BranchConfig, type BranchConfigV1, type ConfigItemV1, type ConfigStockItem } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Resolution, StaffDirectory } from '../auth/staff-directory.js';
import { branchConfig } from '../sync/branch-config-holder.js';
import { branchConfigV2 } from '../sync/config-v2-view.js';
import { defineCommand, type CommandCtx } from './registry.js';
import { commandRegistry } from './route.js';

const Payload = z.object({
  entries: z
    .array(z.object({ item_id: z.string().min(1), on_hand: z.number().int().min(0).max(1_000_000) }))
    .min(1)
    .max(200)
    .superRefine(uniqueItemIds),
});

// §6.17: one StockSet (v2, 01c §6.18) per entry, even when on_hand equals the current value (S41).
export function registerSetPrecookedStock(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'SetPrecookedStock',
      payloadSchema: Payload,
      sessionKind: 'admin',
      permission: 'manage-stock',
      handle(ctx, payload) {
        const items = stockItems(ctx.state, payload.entries);
        requireItemsInScope(ctx, items);
        const now = ctx.clock.branchNow();
        const config = branchConfigV2();
        const appended = ctx.tx.append(
          payload.entries.map((entry, i) => ({
            stream_type: 'stock' as const,
            stream_id: entry.item_id,
            event_type: 'StockSet',
            schema_version: 2,
            payload: { stock_item_id: entry.item_id, on_hand: entry.on_hand, unit: dayStockUnitOf(ctx.state, config, items[i]!) },
            occurred_at: now,
            actor_id: ctx.actor.staffId,
            device_id: ctx.actor.deviceId,
          })),
        );
        const next = appended.reduce(applyEvent, ctx.state);
        return {
          events: [],
          result: { items: items.map((item) => stockResult(next, viewStockItem(config, item.item_id), now)) },
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
export function stockItems(state: Readonly<EngineState>, entries: ReadonlyArray<{ item_id: string }>): ConfigItemV1[] {
  const config = branchConfig();
  if (config === null) throw new DomainError('MENU_ITEM_NOT_FOUND', { item_id: entries[0]!.item_id });
  if (openDayStartMs(state) === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');
  return entries.map((entry) => trackedItem(config, entry.item_id));
}

// 01b B20, §4.4 row 9: under `manage-stock` scope `my_stations` the items must be routed at this branch to one
// of the person's count_stock stations; checked after the 01a checks, before any event is written.
export function requireItemsInScope(ctx: CommandCtx, items: ReadonlyArray<Pick<ConfigItemV1, 'item_id' | 'station_id'>>): void {
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
): (item: Pick<ConfigItemV1, 'station_id'>) => boolean {
  if (manageStockScope(resolution) === 'branch') return () => true;
  const stations = new Set(staffId === null ? [] : directory.stationsOf(staffId, 'count_stock'));
  return (item) => stations.has(item.station_id);
}

function trackedItem(config: BranchConfigV1, itemId: string): ConfigItemV1 {
  const item = config.items.find((candidate) => candidate.item_id === itemId);
  if (item === undefined) throw new DomainError('MENU_ITEM_NOT_FOUND', { item_id: itemId });
  if (!isStockTrackedV1(config, item)) throw new DomainError('STOCK_NOT_TRACKED', { item_id: itemId });
  return item;
}

// 01a S44 through the V2 view (01c §3.5.3, P-2): the open day's frozen unit of the item's stock item
// (same id as the item, §5.1); an item with no stock item keeps its own unit.
export function dayStockUnitOf(
  state: Readonly<EngineState>,
  config: BranchConfig | null,
  item: Pick<ConfigItemV1, 'item_id' | 'stock_unit'>,
): Unit {
  const stockItem = config?.stock_items.find((candidate) => candidate.stock_item_id === item.item_id);
  return dayStockUnit(state, stockItem ?? { stock_item_id: item.item_id, stock_unit: item.stock_unit });
}

// 01c V5 through the V2 view (P-2): a tracked item's stock item has the item's id (§5.1). Called only after
// the item passed 01a's tracked check, so a miss is the same rule failing (STOCK_NOT_TRACKED).
export function viewStockItem(config: BranchConfig | null, itemId: string): ConfigStockItem {
  const stockItem = config?.stock_items.find((candidate) => candidate.stock_item_id === itemId);
  if (stockItem === undefined) throw new DomainError('STOCK_NOT_TRACKED', { item_id: itemId });
  return stockItem;
}

// S40 N8: set_at is the command's clock reading; the stock query is the truth.
// 01c V5, §3.5.1: the numbers and level of the stock item (same id as the item through the view).
export function stockResult(state: EngineState, stockItem: ConfigStockItem, setAt: number) {
  const entry = stockOf(state, stockItem.stock_item_id);
  const start = openDayStartMs(state);
  return {
    item_id: stockItem.stock_item_id,
    on_hand: entry.on_hand,
    reserved: entry.reserved,
    unit: entry.unit,
    available: availableStock(state, stockItem.stock_item_id, start, stockItem),
    level: stockLevel(state, stockItem.stock_item_id, start, stockItem),
    set_at: setAt,
  };
}
