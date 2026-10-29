// Seam (01c plan P-2): removed by task 21
import { isStockTrackedV1, type BranchConfig, type BranchConfigV1, type ConfigItem, type ConfigStockItem } from '@pos/events';
import { branchConfig } from './branch-config-holder.js';

const views = new WeakMap<BranchConfigV1, BranchConfig>();

// 01c §5.1 backfill rule, applied to the held schema-1 snapshot: a stock-tracked item (01a's rule) becomes a
// stock item with the same id, counted at its route station, with one draw of its old factor.
export function toConfigV2(v1: BranchConfigV1): BranchConfig {
  const known = views.get(v1);
  if (known !== undefined) return known;
  const stockItems: ConfigStockItem[] = [];
  const items: ConfigItem[] = v1.items.map((item) => {
    const tracked = isStockTrackedV1(v1, item);
    if (tracked) {
      stockItems.push({
        stock_item_id: item.item_id,
        name: item.name,
        stock_unit: item.stock_unit,
        carries_over: item.carries_over,
        station_id: item.station_id,
        low_stock_threshold: item.low_stock_threshold,
      });
    }
    return {
      item_id: item.item_id,
      category_id: item.category_id,
      variant_group_id: null,
      variant_name: null,
      name: item.name,
      description: item.description,
      sort_order: item.sort_order,
      price_minor: item.price_minor,
      tax_class_id: item.tax_class_id,
      serve_mode: item.serve_mode,
      prep_buffer_ms: item.prep_buffer_ms,
      cook_time_ms: item.cook_time_ms,
      stock_time_ms: item.stock_time_ms,
      out_of_stock_behaviour: item.out_of_stock_behaviour,
      sale_unit: item.sale_unit,
      requires_weighing: false,
      stock_draws: tracked ? [{ stock_item_id: item.item_id, quantity_per_sale_unit: item.stock_per_sale_unit }] : [],
      availability_windows: item.availability_windows,
      station_id: item.station_id,
      program_id: item.program_id,
      stock_program_id: item.stock_program_id,
      modifier_group_ids: [],
    };
  });
  // §4.6: stock items by toLowerCase() name, then id, in JavaScript string order.
  stockItems.sort((a, b) => compare(a.name.toLowerCase(), b.name.toLowerCase()) || compare(a.stock_item_id, b.stock_item_id));
  const view: BranchConfig = {
    snapshot_schema_version: 2,
    config_version: v1.config_version,
    branch_id: v1.branch_id,
    currency_code: v1.currency_code,
    tax_enabled: v1.tax_enabled,
    day_stale_after_hours: v1.day_stale_after_hours,
    day_min_gap_hours: v1.day_min_gap_hours,
    floors: v1.floors,
    stations: v1.stations,
    tax_classes: v1.tax_classes,
    categories: v1.categories,
    variant_groups: [],
    stock_items: stockItems,
    modifier_groups: [],
    items,
    deals: [],
  };
  views.set(v1, view);
  return view;
}

// The held snapshot as schema 2; null before the first apply (01a §4.2 branchConfig()).
export function branchConfigV2(): BranchConfig | null {
  const v1 = branchConfig();
  return v1 === null ? null : toConfigV2(v1);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
