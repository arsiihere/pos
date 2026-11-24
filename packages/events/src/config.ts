import {
  CREDIT_SUPPORT,
  MIXED_CLASS_RULES,
  PAYMENT_CLASSES,
  ROUNDING_APPLIES_TO,
  ROUNDING_METHODS,
  type MenuLineDeal,
  type MenuLineGroup,
  type MenuLineItem,
} from '@pos/domain';
import { z } from 'zod';
import { BillingSettings } from './admin/billing.js';
import { DirectorySchema } from './directory.js';

// 01a §4.3 (Changed by 03a v1.0, 02a v1.0 A-1, 02b v1.0 A-1), 01c §4.6 (V12): the branch config snapshot is schema 4.
// NOT .strict(): within a version the cloud may add optional fields, which an older hub drops (S28 c).
export const SNAPSHOT_SCHEMA_VERSION = 4;

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
    // ⚠️ R-31 (01a v2.7; 05 row A-1 (1)): optional within schema 4 (R29); the cloud builder always sends it.
    fiscal_category: z.string().nullable().optional(),
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

// 01c §4.6 (V12): the fields of schema 2 that schema 3 keeps; never a wire schema on its own. NOT .strict(): unknown
// keys (01a's group_label, stock_unit, ...) are dropped. modifier_group_ids has no maximum (M5): the 20-group limit
// is write-time only.
const SnapshotBase = z.object({
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

// 01a §4.3 (Changed by 03a v1.0), §5.2a A-1..A-13: snapshot schema 3, schema 2 plus the engine configuration. Names
// and enum values as EngineStationConfig / EngineSettings; reference_cook_ms is not here (the hub derives it, 03a §3.11).
// NOT .strict() (S28 c). Plain ints: ranges are enforced at the write routes. Never a wire schema on its own since
// schema 4 (below) extends it.
const orderType = z.enum(['dine_in', 'takeaway', 'delivery', 'parking']);
const goesWithKind = z.enum(['category', 'item']);

const baseShape = SnapshotBase.shape;

const BranchConfigSnapshotSchemaV3Shape = SnapshotBase.extend({
  snapshot_schema_version: z.literal(SNAPSHOT_SCHEMA_VERSION),
  points: z.array(
    z.object({
      point_id: z.string(),
      name: z.string(),
      sort_order: int,
      is_archived: z.boolean(),
    }),
  ),
  stations: z.array(
    baseShape.stations.element.extend({
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
    baseShape.items.element.extend({
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

// 01a §4.3 (Changed by 02a v1.0 A-1, 02b v1.0 A-1; as built, 02p task 4, AD-10–AD-12): snapshot schema 4, schema 3
// plus floors[].zones[] (archived zones kept with is_archived: true and empty lists, AD-11; routes and stock_items by
// item_id, AD-12), tables[].zone_id (null when the table has no zone or its zone is archived), items[].is_ready_item,
// and the five 02b settings in engine_settings beside the A-12 fields (AD-10). NOT .strict() (S28 c). The only wire
// schema (S28 b).
const v3Shape = BranchConfigSnapshotSchemaV3Shape.shape;

const BranchConfigSnapshotSchemaV4Base = BranchConfigSnapshotSchemaV3Shape.extend({
  // 01a v2.11 BD-3: older snapshots omit the key and hub readers fall back to 04:00.
  business_day_end_local_ms: int.min(0).max(86_340_000).multipleOf(60_000).optional(),
  floors: z.array(
    baseShape.floors.element.extend({
      zones: z.array(
        z.object({
          zone_id: z.string(),
          name: z.string(),
          sort_order: int,
          is_archived: z.boolean(),
          routes: z.array(z.object({ item_id: z.string(), station_id: z.string() })),
          stock_items: z.array(z.object({ item_id: z.string(), threshold: int })),
        }),
      ),
      tables: z.array(baseShape.floors.element.shape.tables.element.extend({ zone_id: z.string().nullable() })),
    }),
  ),
  items: z.array(
    v3Shape.items.element.extend({
      is_ready_item: z.boolean(),
      // 01a v2.7.5 §4.3 MD-5 (STAB-7): optional, no version bump (R29); absent → null / false (itemMaxDelay).
      max_delay_ms: int.nullable().optional(),
      max_delay_unlimited: z.boolean().optional(),
    }),
  ),
  engine_settings: v3Shape.engine_settings.extend({
    queue_auto_send_max_ms: int,
    zone_undo_ms: int,
    slow_item_threshold_ms: int,
    served_estimate_ms: int.nullable(),
    comp_reason_chips: z.array(z.string()),
    // ⚠️ Changed by 03b v1.0.1 A-1 (01a v2.4): two optional keys, no snapshot version bump (R29); absent → the hub
    // default, read as `branchConfig()?.engine_settings.<key> ?? HUB_ENGINE_SETTING_DEFAULTS.<key>`.
    ready_window_ms: int.optional(),
    kds_offline_ms: int.optional(),
    // 01a v2.7.3 §4.3 row PT-3 (STAB-5): optional, no version bump (R29); absent → true (05 v1.0.33 §3.16)
    show_part_times_to_customers: z.boolean().optional(),
    // 01a v2.7.5 §4.3 MD-5 (STAB-7): optional; a MISSING key → 300 000, an explicit null (no limit) stays null
    // (maxDelayDefaultMs; review M-8).
    max_delay_default_ms: int.nullable().optional(),
  }),
});

// ⚠️ Changed by 05 (row A-1 (5), 01a v2.6 §4.3): the optional `billing` key, no snapshot version bump (R29):
// the branch billing settings document (A-1 (3)), `jurisdiction` (every effective_from rule row, the branch
// overrides applied) and `tax_profiles` (per tax class, catalog + rate overrides resolved, every effective_from row;
// under a jurisdiction with no profile rows one tax at the class's rate_bp). Absent → the hub's built-in defaults
// (apps/hub/src/billing/defaults.ts). The rule's `receipt` is the catalog's receipt_fiscal with null mapped
// (G-3). Only `higher_rate` parses (row A-2, H16-10).
const isoDate = z.iso.date();

export const SnapshotBillingRuleSchema = z.object({
  effective_from: isoDate,
  prices_include_tax: z.boolean(),
  rounding_step_minor: int.min(1).nullable(),
  rounding_mode: z.enum(ROUNDING_METHODS),
  rounding_applies_to: z.enum(ROUNDING_APPLIES_TO),
  mixed_class_rule: z.enum(MIXED_CLASS_RULES),
  buyer_id: z.object({
    threshold_minor: int.min(0).nullable(),
    accepted_types: z.array(z.object({ type: z.string(), label: z.string(), pattern: z.string(), strip: z.string() })),
  }),
  receipt: z.object({
    fiscal_number_label: z.string().nullable(),
    tax_reg_labels: z.array(z.object({ code: z.string(), label: z.string() })),
    show_qr: z.boolean(),
    qr_url_template: z.string().nullable(),
    buyer_id_on_receipt: z.boolean(),
  }),
  catch_up_window_ms: int.min(0).nullable(),
  credit_support: z.enum(CREDIT_SUPPORT),
  ref: z.string().nullable(),
});

export const SnapshotBillingSchema = BillingSettings.extend({
  jurisdiction: z.object({
    jurisdiction_id: z.string(),
    adapter_key: z.string(),
    currency_code: z.string(),
    currency_exponent: int.min(0),
    rules: z.array(SnapshotBillingRuleSchema),
  }),
  tax_profiles: z.array(
    z.object({
      tax_class_id: z.string(),
      taxes: z
        .array(
          z.object({
            seq: int.min(1).max(4),
            tax_code: z.string(),
            label: z.string(),
            compound: z.boolean(),
            rates: z.array(
              z.object({
                payment_class: z.enum(PAYMENT_CLASSES),
                integration_status: z.enum(['integrated', 'not_integrated']),
                effective_from: isoDate,
                rate_bp: int.min(0).max(10_000),
                ref: z.string().nullable(),
              }),
            ),
          }),
        )
        .max(4),
    }),
  ),
});

export type SnapshotBillingRule = z.infer<typeof SnapshotBillingRuleSchema>;
export type SnapshotBilling = z.infer<typeof SnapshotBillingSchema>;

// ⚠️ Changed by 08b v1.0 (01a A-3; 08 v1.1 Part B §5.3, B15): the optional `inventory` key. The typed schema is for
// the cloud builder (safeParse + log, N-4) and tests only — never a hub consumer's "configured?" check (T-3). No
// object is .strict() (unknown fields stripped, so 08d may add fields). BIGINT values as decimal strings (m-16).
const decimal = z.string().regex(/^[0-9]+$/);
const signedDecimal = z.string().regex(/^-?[0-9]+$/);
const InventoryItemSchema = z.object({
  stock_item_id: z.string(),
  kind: z.enum(['prepared', 'ingredient', 'packet']),
  name: z.string(),
  code: z.string().nullable(),
  stock_unit: unit,
  cost_category: z.string(),
  is_a_item: z.boolean(),
});
const InventoryUnitSchema = z.object({ stock_item_id: z.string(), unit_name: z.string(), factor_num: decimal, factor_den: decimal });
const InventoryPriceSchema = z.object({
  price_id: z.string(),
  stock_item_id: z.string(),
  branch_id: z.string().nullable(),
  kind: z.enum(['manual', 'market_rate']),
  unit_name: z.string(),
  stock_unit: unit,
  price_minor: decimal,
  stock_qty_num: decimal,
  stock_qty_den: decimal,
  created_at: int,
  valid_until_at: int.nullable(),
});
const InventoryYieldSchema = z.object({ stock_item_id: z.string(), yield_bp: int });
const InventoryRecipeLineSchema = z.object({
  stock_item_id: z.string(),
  stock_qty_num: signedDecimal,
  stock_qty_den: decimal,
  stock_unit: unit,
  qty_basis: z.enum(['AP', 'EP']),
});
const InventoryRecipeSchema = z.object({
  recipe_version_id: z.string(),
  status: z.enum(['published', 'superseded']),
  owner_type: z.enum(['menu_item', 'modifier_option', 'stock_item']),
  owner_id: z.string(),
  basis: z.enum(['per_unit', 'per_measure', 'per_batch']),
  base_qty: int.nullable(),
  measure_unit: z.enum(['g', 'ml']).nullable(),
  recipe_archived: z.boolean(),
  batch_yield_qty: decimal.nullable(),
  batch_stock_unit: unit.nullable(),
  misc_allowance_bp: int,
  published_at: int,
  lines: z.array(InventoryRecipeLineSchema),
});
export const InventorySnapshotSchema = z.object({
  items: z.array(InventoryItemSchema),
  units: z.array(InventoryUnitSchema),
  prices: z.array(InventoryPriceSchema),
  yields: z.array(InventoryYieldSchema),
  recipes: z.array(InventoryRecipeSchema),
});
export type InventorySnapshot = z.infer<typeof InventorySnapshotSchema>;
export type InventorySnapshotItem = z.infer<typeof InventoryItemSchema>;
export type InventorySnapshotPrice = z.infer<typeof InventoryPriceSchema>;
export type InventorySnapshotRecipe = z.infer<typeof InventoryRecipeSchema>;

// t-5: the lenient element set — the same objects, enum-like fields as plain strings — one schema per element kind,
// for an element-by-element parse (a failing element is dropped and counted; an unknown enum value is kept and the
// engine treats it as unknown). @pos/domain's buildCostInputs runs the same checks by hand (AD-12; the domain has
// no zod); `config.test.ts` pins the two together.
// Quantities that divide (factors, price quantities, line quantities, batch yields) must be non-zero: a zero there
// can only come from a broken key, and the element is dropped rather than costed (the DB CHECKs never store one).
const lenientUnit = z.string();
// zod runs a refinement even after the regex fails, so each one re-tests the pattern before BigInt()
const positive = decimal.refine((v) => /^[0-9]+$/.test(v) && BigInt(v) > 0n);
const nonZero = signedDecimal.refine((v) => /^-?[0-9]+$/.test(v) && BigInt(v) !== 0n);
export const InventoryElementsLenient = {
  item: InventoryItemSchema.extend({ kind: z.string(), stock_unit: lenientUnit }),
  unit: InventoryUnitSchema.extend({ factor_num: positive, factor_den: positive }),
  price: InventoryPriceSchema.extend({ kind: z.string(), stock_unit: lenientUnit, stock_qty_num: positive, stock_qty_den: positive }),
  yield: InventoryYieldSchema.extend({ yield_bp: int.min(1).max(50_000) }), // 08a I8 range
  line: InventoryRecipeLineSchema.extend({ stock_unit: lenientUnit, qty_basis: z.string(), stock_qty_num: nonZero, stock_qty_den: positive }),
  recipe: InventoryRecipeSchema.extend({
    status: z.string(),
    owner_type: z.string(),
    basis: z.string(),
    measure_unit: z.string().nullable(),
    batch_yield_qty: positive.nullable(),
    batch_stock_unit: z.string().nullable(),
    misc_allowance_bp: int.min(0).max(5_000), // the DB CHECK range
    lines: z.array(z.unknown()),
  }),
} as const;

export const BranchConfigSnapshotSchemaV4 = BranchConfigSnapshotSchemaV4Base.extend({
  billing: SnapshotBillingSchema.optional(),
  // ⚠️ Changed by 08b v1.0 (01a A-3, B15 c): stored and hashed raw; nothing on the hub reads it until 08c (M-5)
  inventory: z.unknown().optional(),
});

export { BUSINESS_DAY_END_LOCAL_MS_DEFAULT } from '@pos/domain';

// 03b §4.5 A-1: the hub defaults of the optional engine_settings keys (the cloud columns default to the same values).
export const HUB_ENGINE_SETTING_DEFAULTS = Object.freeze({
  ready_window_ms: 60_000,
  kds_offline_ms: 30_000,
} as const);

export type BranchConfigSnapshotV4 = z.infer<typeof BranchConfigSnapshotSchemaV4>;
export type BranchConfig = BranchConfigSnapshotV4;
export type ConfigItem = BranchConfig['items'][number];
export type ConfigStockItem = BranchConfig['stock_items'][number];
export type ConfigVariantGroup = BranchConfig['variant_groups'][number];
export type ConfigModifierGroup = BranchConfig['modifier_groups'][number];
export type ConfigModifierOption = ConfigModifierGroup['options'][number];
export type ConfigDeal = BranchConfig['deals'][number];
export type ConfigCategory = BranchConfig['categories'][number];
export type ConfigStation = BranchConfig['stations'][number];

// 01a v2.7.5 §4.3 MD-5, MD-2 (STAB-7; review M-8): the hub reader of the optional max delay keys. Only a missing
// key gives the default; an explicit null branch default ("No limit") is kept (never `value ?? 300000`).
export const MAX_DELAY_DEFAULT_MS = 300_000;

export function maxDelayDefaultMs(config: Pick<BranchConfig, 'engine_settings'>): number | null {
  const settings = config.engine_settings;
  return 'max_delay_default_ms' in settings && settings.max_delay_default_ms !== undefined
    ? settings.max_delay_default_ms
    : MAX_DELAY_DEFAULT_MS;
}

export function itemMaxDelay(item: Pick<ConfigItem, 'max_delay_ms' | 'max_delay_unlimited'>): {
  max_delay_ms: number | null;
  max_delay_unlimited: boolean;
} {
  return { max_delay_ms: item.max_delay_ms ?? null, max_delay_unlimited: item.max_delay_unlimited ?? false };
}

// 01c §4.2 (V12): the builder lists only tracked draws.
export function isStockTracked(item: Pick<ConfigItem, 'stock_draws'>): boolean {
  return item.stock_draws.length > 0;
}

// §6.1: the snapshot stays a plain record here; the hub hashes the wire JSON
// before it parses it with BranchConfigSnapshotSchemaV4 (S27).
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

// Plan P-7: the snapshot types must stay assignable to the @pos/domain
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
