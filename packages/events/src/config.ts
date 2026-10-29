import { z } from 'zod';
import { DirectorySchema } from './directory.js';

// 01a §4.3: the branch config snapshot. NOT .strict(): within version 1 the
// cloud may add optional fields, which an older hub drops (S28 c).
export const SNAPSHOT_SCHEMA_VERSION = 1;

// 01a §3.4 (01b B19, D-11): the hub's config poll interval; the cloud derives hub_stale_after_ms from it.
export const CONFIG_POLL_INTERVAL_MS = 60_000;

const int = z.number().int();
const unit = z.enum(['piece', 'g', 'ml']);

const AvailabilityWindowSchema = z.object({
  start_ms: int,
  end_ms: int,
});

const FloorsSchema = z.array(
  z.object({
    floor_id: z.string(),
    name: z.string(),
    sort_order: int,
    tables: z.array(
      z.object({
        table_id: z.string(),
        name: z.string(),
        seats: int.nullable(),
        sort_order: int,
      }),
    ),
  }),
);

const StationsSchema = z.array(
  z.object({
    station_id: z.string(),
    name: z.string(),
    location_label: z.string().nullable(),
    station_type: z.enum(['slot', 'batch']),
    capacity: int,
    freshness_window_ms: int.nullable(),
    completion_mode: z.enum(['two_tap', 'single_tap', 'auto_done']),
    is_archived: z.boolean(),
    programs: z.array(
      z.object({
        program_id: z.string(),
        name: z.string(),
        cook_time_ms: int,
        is_archived: z.boolean(),
      }),
    ),
  }),
);

const TaxClassesSchema = z.array(
  z.object({
    tax_class_id: z.string(),
    name: z.string(),
    rate_bp: int,
    is_archived: z.boolean(),
  }),
);

const CategoriesSchema = z.array(
  z.object({
    category_id: z.string(),
    name: z.string(),
    sort_order: int,
    availability_windows: z.array(AvailabilityWindowSchema),
  }),
);

// The top-level fields both schemas share (01c §4.6: "unchanged ... as schema 1").
const sharedTopLevel = {
  config_version: int.min(1),
  branch_id: z.string(),
  currency_code: z.string(),
  tax_enabled: z.boolean(),
  day_stale_after_hours: int.min(1).max(72),
  day_min_gap_hours: int.min(0).max(24),
  floors: FloorsSchema,
  stations: StationsSchema,
  tax_classes: TaxClassesSchema,
  categories: CategoriesSchema,
};

// Seam (01c P-2): schema 1 stays live until task 21 deletes it.
export const BranchConfigSnapshotSchemaV1 = z.object({
  snapshot_schema_version: z.literal(SNAPSHOT_SCHEMA_VERSION),
  ...sharedTopLevel,
  items: z.array(
    z.object({
      item_id: z.string(),
      category_id: z.string(),
      name: z.string(),
      group_label: z.string().nullable(),
      description: z.string().nullable(),
      sort_order: int,
      price_minor: int,
      tax_class_id: z.string().nullable(),
      serve_mode: z.enum(['immediate', 'sync']),
      prep_buffer_ms: int,
      cook_time_ms: int,
      stock_time_ms: int.nullable(),
      out_of_stock_behaviour: z.enum(['cook_fresh', 'sold_out']),
      stock_unit: unit,
      sale_unit: unit,
      stock_per_sale_unit: int,
      low_stock_threshold: int.nullable(),
      carries_over: z.boolean(),
      availability_windows: z.array(AvailabilityWindowSchema),
      station_id: z.string(),
      program_id: z.string().nullable(),
      stock_program_id: z.string().nullable(),
    }),
  ),
});

export type BranchConfigV1 = z.infer<typeof BranchConfigSnapshotSchemaV1>;
export type ConfigItemV1 = BranchConfigV1['items'][number];

// 01a §4.3: slot station + stock_time_ms, or batch station + stock_program_id.
export function isStockTrackedV1(config: BranchConfigV1, item: ConfigItemV1): boolean {
  const station = config.stations.find((s) => s.station_id === item.station_id);
  if (station === undefined) return false;
  return station.station_type === 'slot' ? item.stock_time_ms !== null : item.stock_program_id !== null;
}

// 01c §3.3 limits, applied to the fields 01c adds.
const priceMinor = int.min(0).max(1_000_000_000);

// 01c §4.6 (V12): snapshot schema 2. NOT .strict(): unknown keys (01a's
// group_label, stock_unit, ...) are dropped. modifier_group_ids has no
// maximum (M5): the 20-group limit is write-time only.
export const BranchConfigSnapshotSchemaV2 = z.object({
  snapshot_schema_version: z.literal(2),
  ...sharedTopLevel,
  variant_groups: z.array(
    z.object({
      variant_group_id: z.string(),
      category_id: z.string(),
      name: z.string().min(1).max(60),
      description: z.string().nullable(),
      sort_order: int,
    }),
  ),
  stock_items: z.array(
    z.object({
      stock_item_id: z.string(),
      name: z.string().min(1).max(60),
      stock_unit: unit,
      carries_over: z.boolean(),
      station_id: z.string(),
      low_stock_threshold: int.min(0).max(1_000_000).nullable(),
    }),
  ),
  modifier_groups: z.array(
    z.object({
      modifier_group_id: z.string(),
      name: z.string().min(1).max(40),
      min_choices: int.min(0).max(50),
      max_choices: int.min(1).max(50),
      sort_order: int,
      has_plain_options: z.boolean(),
      // F1: a required group left with no options at this branch is kept with options: [].
      options: z
        .array(
          z.object({
            option_id: z.string(),
            name: z.string().min(1).max(40),
            price_minor: priceMinor,
            max_quantity: int.min(1).max(20),
            is_default: z.boolean(),
            linked_item_id: z.string().nullable(),
            sort_order: int,
          }),
        )
        .max(50),
    }),
  ),
  items: z.array(
    z.object({
      item_id: z.string(),
      category_id: z.string(),
      variant_group_id: z.string().nullable(),
      variant_name: z.string().min(1).max(30).nullable(),
      name: z.string(),
      description: z.string().nullable(),
      sort_order: int,
      price_minor: int,
      tax_class_id: z.string().nullable(),
      serve_mode: z.enum(['immediate', 'sync']),
      prep_buffer_ms: int,
      cook_time_ms: int,
      stock_time_ms: int.nullable(),
      out_of_stock_behaviour: z.enum(['cook_fresh', 'sold_out']),
      sale_unit: unit,
      requires_weighing: z.boolean(),
      stock_draws: z
        .array(
          z.object({
            stock_item_id: z.string(),
            quantity_per_sale_unit: int.min(1).max(1_000_000),
          }),
        )
        .max(1),
      availability_windows: z.array(AvailabilityWindowSchema),
      station_id: z.string(),
      program_id: z.string().nullable(),
      stock_program_id: z.string().nullable(),
      modifier_group_ids: z.array(z.string()),
    }),
  ),
  deals: z.array(
    z.object({
      deal_id: z.string(),
      category_id: z.string(),
      name: z.string().min(1).max(60),
      description: z.string().nullable(),
      sort_order: int,
      price_minor: priceMinor,
      tax_class_id: z.string().nullable(),
      availability_windows: z.array(AvailabilityWindowSchema),
      parts: z
        .array(
          z.object({
            deal_part_id: z.string(),
            quantity: int.min(1).max(1_000_000),
            sort_order: int,
            choices: z
              .array(
                z.object({
                  item_id: z.string(),
                  extra_price_minor: priceMinor,
                  sort_order: int,
                }),
              )
              .min(1)
              .max(20),
          }),
        )
        .min(1)
        .max(10),
    }),
  ),
});

export type BranchConfig = z.infer<typeof BranchConfigSnapshotSchemaV2>;
export type ConfigItem = BranchConfig['items'][number];
export type ConfigStockItem = BranchConfig['stock_items'][number];
export type ConfigVariantGroup = BranchConfig['variant_groups'][number];
export type ConfigModifierGroup = BranchConfig['modifier_groups'][number];
export type ConfigModifierOption = ConfigModifierGroup['options'][number];
export type ConfigDeal = BranchConfig['deals'][number];
export type ConfigCategory = BranchConfig['categories'][number];
export type ConfigStation = BranchConfig['stations'][number];

// 01c §4.2 (V12): the builder lists only tracked draws.
export function isStockTracked(item: Pick<ConfigItem, 'stock_draws'>): boolean {
  return item.stock_draws.length > 0;
}

// §6.1: the snapshot stays a plain record here; the hub hashes the wire JSON
// before it parses it with BranchConfigSnapshotSchemaV1 (S27).
export const SyncConfigEnvelopeSchema = z.object({
  data: z.object({
    config: z
      .object({
        snapshot_hash: z.string(),
        snapshot: z.record(z.string(), z.unknown()),
      })
      .nullable(),
    directory: DirectorySchema.nullable(),
  }),
});
