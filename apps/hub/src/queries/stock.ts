import { DEFAULT_DAY_MIN_GAP_HOURS, DEFAULT_DAY_STALE_AFTER_HOURS, DomainError } from '@pos/domain';
import { availableStock, dayUnits, openDayStartMs, stockLevel, stockOf, type EngineState } from '@pos/engine';
import { isStockTracked, type BranchConfig } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Resolution } from '../auth/staff-directory.js';
import type { Clock } from '../lib/clock.js';
import { hubTime } from '../lib/hub-time.js';
import { stockScopeFilter } from '../commands/set-precooked-stock.js';
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
        // 01b B20, §4.4 row 10: under `my_stations` only the items routed to the person's stations; no extra statement.
        const inScope = stockScopeFilter(ctx.directory, ctx.session?.staff_id ?? null, resolution);
        const config = scopedConfig(ctx.branchConfig, inScope);
        const state = ctx.state;
        const start = openDayStartMs(state);
        const metaVersion = `${config?.config_version ?? 0}.${start ?? 0}`;
        const currentStockVersion = stockVersion();
        const time = hubTime(clock);
        const day = state.business_day;
        const staleAfterHours = config?.day_stale_after_hours ?? DEFAULT_DAY_STALE_AFTER_HOURS;
        const metaChanged = q.meta_version !== metaVersion;
        const unchanged = !metaChanged && q.stock_version === String(currentStockVersion);
        return {
          data: {
            unchanged,
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
            items_meta: metaChanged ? itemsMeta(state, config) : null,
            items: unchanged ? null : stockItems(ctx, config, start),
          },
        };
      },
    }),
  );
}

function itemsMeta(state: Readonly<EngineState>, config: BranchConfig | null) {
  if (config === null) return [];
  return config.items.map((item) => {
    // S44: the units frozen for the open day, else the item's own.
    const units = dayUnits(state, item);
    const category = config.categories.find((c) => c.category_id === item.category_id);
    return {
      item_id: item.item_id,
      name: item.name,
      group_label: item.group_label,
      category_id: item.category_id,
      category_name: category?.name ?? item.category_id,
      is_stock_tracked: isStockTracked(config, item),
      out_of_stock_behaviour: item.out_of_stock_behaviour,
      stock_unit: units.stock_unit,
      sale_unit: units.sale_unit,
      stock_per_sale_unit: units.stock_per_sale_unit,
      low_stock_threshold: item.low_stock_threshold,
      carries_over: item.carries_over,
      item_windows: item.availability_windows,
      category_windows: category?.availability_windows ?? [],
    };
  });
}

// S14, S41, S46: numbers and flags only; 1 statement for the availability rows.
// v1.0.2: unit is the open day's frozen unit (else the config's); a count in another unit reads as no count.
function stockItems(ctx: QueryCtx, config: BranchConfig | null, start: number | null) {
  const items = config?.items ?? [];
  const off = offSince(ctx, items.map((item) => item.item_id));
  return items.map((item) => {
    const unit = dayUnits(ctx.state, item).stock_unit;
    const stored = stockOf(ctx.state, item.item_id);
    const entry = stored.unit === unit ? stored : { on_hand: 0, reserved: 0, set_at: null };
    const since = off.get(item.item_id);
    return {
      item_id: item.item_id,
      on_hand: entry.on_hand,
      reserved: entry.reserved,
      unit,
      available: availableStock(ctx.state, item.item_id, start, item),
      level: stockLevel(ctx.state, item.item_id, start, item),
      set_at: entry.set_at,
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

function scopedConfig(config: BranchConfig | null, inScope: (item: BranchConfig['items'][number]) => boolean): BranchConfig | null {
  if (config === null) return null;
  const items = config.items.filter(inScope);
  return items.length === config.items.length ? config : { ...config, items };
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
