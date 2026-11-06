import type { MenuLineDeal, MenuLineGroup, MenuLineItem } from '@pos/domain';
import { z } from 'zod';
import { DirectorySchema } from './directory.js';

// 01a §4.3, 01c §4.6 (V12): the branch config snapshot is schema 2. NOT .strict(): within a version the
// cloud may add optional fields, which an older hub drops (S28 c).
export const SNAPSHOT_SCHEMA_VERSION = 2;

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

// 01c §4.6: the top-level fields unchanged from schema 1.
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

// 01c §3.3 limits, applied to the fields 01c adds.
const priceMinor = int.min(0).max(1_000_000_000);

// 01c §4.6 (V12): snapshot schema 2. NOT .strict(): unknown keys (01a's
// group_label, stock_unit, ...) are dropped. modifier_group_ids has no
// maximum (M5): the 20-group limit is write-time only.
export const BranchConfigSnapshotSchemaV2 = z.object({
  snapshot_schema_version: z.literal(SNAPSHOT_SCHEMA_VERSION),
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

// 01a §4.3 (Changed by 03a v1.0), §5.2a A-1..A-13: snapshot schema 3, schema 2 plus the engine configuration. Names
// and enum values as EngineStationConfig / EngineSettings; reference_cook_ms is not here (the hub derives it, 03a §3.11).
// NOT .strict() (S28 c). Plain ints: ranges are enforced at the write routes.
// Additive for now: SNAPSHOT_SCHEMA_VERSION and the types above stay on schema 2 until the hub and cloud move over.
const orderType = z.enum(['dine_in', 'takeaway', 'delivery', 'parking']);
const goesWithKind = z.enum(['category', 'item']);

const v2Shape = BranchConfigSnapshotSchemaV2.shape;

export const BranchConfigSnapshotSchemaV3 = BranchConfigSnapshotSchemaV2.extend({
  snapshot_schema_version: z.literal(3),
  points: z.array(
    z.object({
      point_id: z.string(),
      name: z.string(),
      sort_order: int,
      is_archived: z.boolean(),
    }),
  ),
  stations: z.array(
    v2Shape.stations.element.extend({
      point_id: z.string(),
      policy: z.enum(['waada_guard', 'edf', 'fifo']),
      freeze_ms: int,
      min_slack_keep_ms: int,
      promise_padding_ms: int.nullable(),
      pressure_window_ms: int,
      pressure_amber_bp: int,
      pressure_red_bp: int,
      pressure_alert_ms: int,
      pause_enabled: z.boolean(),
      lane_units: int.nullable(),
      reserve_units: int,
      alternates: z.array(
        z.object({
          station_id: z.string(),
          order_types: z.array(orderType),
          home_for_order_types: z.array(orderType),
        }),
      ),
      carry_times: z.array(z.object({ point_id: z.string(), carry_ms: int })),
    }),
  ),
  items: z.array(
    v2Shape.items.element.extend({
      weight_pct: int,
      max_early_ms: int,
      max_carry_ms: int.nullable(),
      max_late_ms: int.nullable(),
      adjust_time_ms: int,
    }),
  ),
  // A-12: every EngineSettings key, plus 02's table_lock_ttl_ms (not an engine field, not in EngineConfigApplied).
  engine_settings: z.object({
    weight_dine_in_pct: int,
    weight_takeaway_pct: int,
    weight_delivery_pct: int,
    weight_parking_pct: int,
    weight_follow_up_pct: int,
    promise_padding_dine_in_ms: int,
    promise_padding_takeaway_ms: int,
    promise_padding_delivery_ms: int,
    promise_padding_parking_ms: int,
    slip_threshold_ms: int,
    slip_escalate_ms: int,
    cascade_step_ms: int,
    min_gain_ms: int,
    returns_boost: z.boolean(),
    order_abandon_ms: int,
    table_lock_ttl_ms: int,
  }),
  goes_with: z.array(
    z.object({
      source_kind: goesWithKind,
      source_id: z.string(),
      target_kind: goesWithKind,
      target_id: z.string(),
      excluded: z.boolean(),
    }),
  ),
});

export type BranchConfigSnapshotV3 = z.infer<typeof BranchConfigSnapshotSchemaV3>;

// 01c §4.2 (V12): the builder lists only tracked draws.
export function isStockTracked(item: Pick<ConfigItem, 'stock_draws'>): boolean {
  return item.stock_draws.length > 0;
}

// §6.1: the snapshot stays a plain record here; the hub hashes the wire JSON
// before it parses it with BranchConfigSnapshotSchemaV2 (S27).
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

// Plan P-7: the schema-2 types must stay assignable to the @pos/domain
// menu-line inputs. Checked here in src, because the package typecheck
// excludes *.test.ts (the expectTypeOf test in config.test.ts is not compiled).
type AssertTrue<T extends true> = T;
type Extends<A, B> = [A] extends [B] ? true : false;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- compile-time check only, never referenced
type P7Assignability = [
  AssertTrue<Extends<ConfigItem, MenuLineItem>>,
  AssertTrue<Extends<ConfigModifierGroup, MenuLineGroup>>,
  AssertTrue<Extends<ConfigDeal, MenuLineDeal>>,
];
