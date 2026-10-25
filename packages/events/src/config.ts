import { z } from 'zod';
import { DirectorySchema } from './directory.js';

// 01a §4.3: the branch config snapshot. NOT .strict(): within version 1 the
// cloud may add optional fields, which an older hub drops (S28 c).
export const SNAPSHOT_SCHEMA_VERSION = 1;

const int = z.number().int();
const unit = z.enum(['piece', 'g', 'ml']);

const AvailabilityWindowSchema = z.object({
  start_ms: int,
  end_ms: int,
});

export const BranchConfigSnapshotSchemaV1 = z.object({
  snapshot_schema_version: z.literal(SNAPSHOT_SCHEMA_VERSION),
  config_version: int.min(1),
  branch_id: z.string(),
  currency_code: z.string(),
  tax_enabled: z.boolean(),
  day_stale_after_hours: int.min(1).max(72),
  day_min_gap_hours: int.min(0).max(24),
  floors: z.array(
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
  ),
  stations: z.array(
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
  ),
  tax_classes: z.array(
    z.object({
      tax_class_id: z.string(),
      name: z.string(),
      rate_bp: int,
      is_archived: z.boolean(),
    }),
  ),
  categories: z.array(
    z.object({
      category_id: z.string(),
      name: z.string(),
      sort_order: int,
      availability_windows: z.array(AvailabilityWindowSchema),
    }),
  ),
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

export type BranchConfig = z.infer<typeof BranchConfigSnapshotSchemaV1>;
export type ConfigItem = BranchConfig['items'][number];
export type ConfigCategory = BranchConfig['categories'][number];
export type ConfigStation = BranchConfig['stations'][number];

// §4.3: slot station + stock_time_ms, or batch station + stock_program_id.
export function isStockTracked(config: BranchConfig, item: ConfigItem): boolean {
  const station = config.stations.find((s) => s.station_id === item.station_id);
  if (station === undefined) return false;
  return station.station_type === 'slot' ? item.stock_time_ms !== null : item.stock_program_id !== null;
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
