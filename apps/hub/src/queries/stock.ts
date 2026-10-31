import { createHash } from 'node:crypto';
import { DEFAULT_DAY_MIN_GAP_HOURS, DEFAULT_DAY_STALE_AFTER_HOURS, DomainError } from '@pos/domain';
import type { Unit } from '@pos/domain';
import { availableStock, dayDraws, dayStockUnit, openDayStartMs, stockLevel, stockOf, type DayDraws, type EngineState } from '@pos/engine';
import { isStockTracked, type BranchConfig, type ConfigItem, type ConfigStockItem } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Resolution } from '../auth/staff-directory.js';
import type { Clock } from '../lib/clock.js';
import { hubTime } from '../lib/hub-time.js';
import { manageStockScope, stockItemScopeFilter, stockScopeFilter } from '../commands/set-precooked-stock.js';
import { stockVersion } from '../sync/stock-version.js';
import { defineQuery, queryRegistry, type QueryCtx } from './registry.js';

const Query = z.object({ meta_version: z.string().optional(), stock_version: z.string().optional() });

// §6.19 (review 2 S-5): a config part and a stock part, each sent only when its version moved.
export function registerStockQuery(app: FastifyInstance, clock: Clock): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'stock',
      sessionKind: 'admin',
      session: 'none',
      countsAsActivity: false,
      querySchema: Query,
      handle(ctx, q) {
        const resolution = requireManageStock(ctx);
        const staffId = ctx.session?.staff_id ?? null;
        // 01b B20, §4.4 row 10: under `my_stations` only the items routed to the person's stations; no extra statement.
        const inScope = stockScopeFilter(ctx.directory, staffId, resolution);
        const config = scopedConfig(ctx.branchConfig, inScope);
        const state = ctx.state;
        const full = ctx.branchConfig;
        // 01c §6.21, 01b B1: the stock rows by the stock item's own station.
        const inStockScope = stockItemScopeFilter(ctx.directory, staffId, resolution);
        const allStockItems = full?.stock_items ?? [];
        const stockItems = allStockItems.filter(inStockScope);
        const start = openDayStartMs(state);
        // R-2: a scoped stock item or item list also keys the meta part, so a directory change (stations, scope)
        // reaches the page.
        const scoped = config !== ctx.branchConfig || stockItems.length !== allStockItems.length;
        const metaVersion = `${config?.config_version ?? 0}.${start ?? 0}${scoped ? `.${scopeKey(stockItems, config)}` : ''}`;
        const currentStockVersion = stockVersion();
        const time = hubTime(clock);
        const day = state.business_day;
        const staleAfterHours = config?.day_stale_after_hours ?? DEFAULT_DAY_STALE_AFTER_HOURS;
        const metaChanged = q.meta_version !== metaVersion;
        const unchanged = !metaChanged && q.stock_version === String(currentStockVersion);
        return {
          data: {
            unchanged,
            manage_stock_scope: manageStockScope(resolution),
            config_version: config?.config_version ?? null,
            meta_version: metaVersion,
            stock_version: currentStockVersion,
            hub_time: time,
            hub_local_date: localDate(time.now_ms),
            business_day: day === null ? null : { business_date: day.business_date, opened_at: day.opened_at, closed_at: day.closed_at },
            business_day_started_at: start,
            day_stale: start !== null && time.now_ms - start > staleAfterHours * 3_600_000,
            day_stale_after_hours: staleAfterHours,
            day_min_gap_hours: config?.day_min_gap_hours ?? DEFAULT_DAY_MIN_GAP_HOURS,
            stock_items_meta: metaChanged ? stockItemsMeta(state, stockItems, full) : null,
            stock: unchanged ? null : stockRows(state, stockItems, start),
            items_meta: metaChanged ? itemsMeta(state, config, full) : null,
            items: unchanged ? null : itemRows(ctx, config, full),
          },
        };
      },
    }),
  );
}

// 01c §6.21: per stock item, the day's stock_unit and its drawers with the day's quantity_per_sale_unit
// (dayDraws, V20); has_tracked_drawers when an item of this branch's config draws from it (F4).
function stockItemsMeta(state: Readonly<EngineState>, stockItems: readonly ConfigStockItem[], full: BranchConfig | null) {
  const draws = itemDraws(state, full);
  return stockItems.map((stockItem) => {
    const drawers = (full?.items ?? []).flatMap((item) => {
      const day = draws.get(item.item_id)!;
      const draw = day.stock_draws.find((candidate) => candidate.stock_item_id === stockItem.stock_item_id);
      if (draw === undefined) return [];
      return [{ item_id: item.item_id, name: item.name, variant_name: item.variant_name, sale_unit: day.sale_unit, quantity_per_sale_unit: draw.quantity_per_sale_unit }];
    });
    return {
      stock_item_id: stockItem.stock_item_id,
      name: stockItem.name,
      stock_unit: dayStockUnit(state, stockItem),
      carries_over: stockItem.carries_over,
      station_id: stockItem.station_id,
      low_stock_threshold: stockItem.low_stock_threshold,
      has_tracked_drawers: drawers.length > 0,
      drawers,
    };
  });
}

// 01c §6.21 (01a S41, S46, v1.0.2): the numbers per stock item; a count in another unit than the day's reads as no count.
function stockRows(state: Readonly<EngineState>, stockItems: readonly ConfigStockItem[], start: number | null) {
  return stockItems.map((stockItem) => {
    const unit = dayStockUnit(state, stockItem);
    const entry = countIn(state, stockItem.stock_item_id, unit);
    return {
      stock_item_id: stockItem.stock_item_id,
      on_hand: entry.on_hand,
      reserved: entry.reserved,
      unit,
      available: availableStock(state, stockItem.stock_item_id, start, stockItem),
      level: stockLevel(state, stockItem.stock_item_id, start, stockItem),
      set_at: entry.set_at,
    };
  });
}

// S44 (01c §3.5.3, V20): each item's draws frozen for the open day, else its config draws (with the m14 fallback).
function itemDraws(state: Readonly<EngineState>, full: BranchConfig | null): Map<string, DayDraws> {
  const configStockUnits = Object.fromEntries((full?.stock_items ?? []).map((s) => [s.stock_item_id, s.stock_unit]));
  return new Map((full?.items ?? []).map((item: ConfigItem) => [item.item_id, dayDraws(state, item, configStockUnits)]));
}

// 01c §6.21: the stock items of this branch's config an item draws from today.
function stockItemIdsOf(draws: DayDraws | undefined, known: ReadonlySet<string>): string[] {
  return (draws?.stock_draws ?? []).map((draw) => draw.stock_item_id).filter((id) => known.has(id));
}

function countIn(state: Readonly<EngineState>, stockItemId: string, unit: Unit) {
  const stored = stockOf(state, stockItemId);
  return stored.unit === unit ? stored : { on_hand: 0, reserved: 0, set_at: null };
}

// The items are the scoped config's; draws and stock items come from the full config (drawers are unscoped).
function itemsMeta(state: Readonly<EngineState>, config: BranchConfig | null, full: BranchConfig | null) {
  if (config === null) return [];
  const draws = itemDraws(state, full);
  const known = new Set((full?.stock_items ?? []).map((s) => s.stock_item_id));
  return config.items.map((item) => {
    const category = config.categories.find((c) => c.category_id === item.category_id);
    // 01a A1: group_label is replaced by the variant group; the label is the group's name.
    const group = config.variant_groups.find((g) => g.variant_group_id === item.variant_group_id);
    return {
      item_id: item.item_id,
      name: item.name,
      group_label: group?.name ?? null,
      category_id: item.category_id,
      category_name: category?.name ?? item.category_id,
      is_stock_tracked: isStockTracked(item),
      out_of_stock_behaviour: item.out_of_stock_behaviour,
      // 01c §6.21: the stock items it draws from today (no unit fields).
      stock_item_ids: stockItemIdsOf(draws.get(item.item_id), known),
      item_windows: item.availability_windows,
      category_windows: category?.availability_windows ?? [],
    };
  });
}

// S14, S30 (01c §6.21): the availability rows per menu item (the numbers are per stock item); 1 statement for them.
function itemRows(ctx: QueryCtx, config: BranchConfig | null, full: BranchConfig | null) {
  const items = config?.items ?? [];
  const off = offSince(ctx, items.map((item) => item.item_id));
  const draws = itemDraws(ctx.state, full);
  const known = new Set((full?.stock_items ?? []).map((s) => s.stock_item_id));
  return items.map((item) => {
    const since = off.get(item.item_id);
    return {
      item_id: item.item_id,
      stock_item_ids: stockItemIdsOf(draws.get(item.item_id), known),
      is_available: since === undefined,
      unavailable_since: since ?? null,
    };
  });
}

function requireManageStock(ctx: QueryCtx): Resolution {
  const staffId = ctx.session?.staff_id ?? null;
  const resolution: Resolution = staffId === null ? { grant: 'not_granted' } : ctx.directory.resolve(staffId, 'manage-stock');
  if (resolution.grant !== 'allowed') throw new DomainError('PERMISSION_DENIED', { permission: 'manage-stock', grant: resolution.grant });
  return resolution;
}

function scopedConfig(config: BranchConfig | null, inScope: (item: ConfigItem) => boolean): BranchConfig | null {
  if (config === null) return null;
  const items = config.items.filter(inScope);
  return items.length === config.items.length ? config : { ...config, items };
}

// R-2 (01c §6.21): the in-scope stock item ids, then the in-scope item ids (item rows stay per route station, B20).
function scopeKey(stockItems: readonly ConfigStockItem[], config: BranchConfig | null): string {
  const ids = `${stockItems.map((s) => s.stock_item_id).join(',')}|${(config?.items ?? []).map((item) => item.item_id).join(',')}`;
  return createHash('sha256').update(ids).digest('hex').slice(0, 12);
}

// S30: changed_at of the items that are off; 1 statement, none with no items.
function offSince(ctx: QueryCtx, itemIds: readonly string[]): Map<string, number> {
  if (itemIds.length === 0) return new Map();
  const rows = ctx.db
    .prepare(
      `SELECT item_id, changed_at FROM item_availability
       WHERE is_available = 0 AND item_id IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(itemIds)) as Array<{ item_id: string; changed_at: number }>;
  return new Map(rows.map((row) => [row.item_id, row.changed_at]));
}

function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
