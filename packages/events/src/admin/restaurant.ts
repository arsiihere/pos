import { z } from 'zod';

// D5, §7.7: the owner admin request bodies and responses, shared by the cloud routes and apps/client
// (browser-safe: zod only).

// §3.3: names 1–60 characters after trimming.
const Name = z.string().trim().min(1).max(60);
// INT column; the spec gives no range, so the column's range keeps a large value from becoming a 500.
export const SortOrder = z.number().int().min(-2_147_483_648).max(2_147_483_647);

export const CreateFloorBody = z.object({
  name: Name,
  sort_order: SortOrder.default(0),
});

export const PatchFloorBody = z
  .object({ name: Name.optional(), sort_order: SortOrder.optional(), archived: z.boolean().optional() })
  .refine((body) => Object.keys(body).length > 0, { message: 'at least one field is required' });

// 01a v2.2 / v2.3 §6.6a, §6.6b (02a A-1, 02b A-1): zone names 1–40 characters after trimming. `routes` and
// `stock_items` are whole lists (each at most 200, one entry per item_id); absent = unchanged on a PATCH, [] = clear.
const ZoneName = z.string().trim().min(1).max(40);
const ZONE_LIST_MAX = 200;
const ZoneRoute = z.object({ item_id: z.string().min(1), station_id: z.string().min(1) });
// threshold: 0 … 5000, default 0 (§5.2 zone_stock_items).
const ZoneStockItem = z.object({ item_id: z.string().min(1), threshold: z.number().int().min(0).max(5000).default(0) });
const uniqueItems = (list: ReadonlyArray<{ item_id: string }>) => new Set(list.map((entry) => entry.item_id)).size === list.length;
const ZoneRoutes = z
  .array(ZoneRoute)
  .max(ZONE_LIST_MAX)
  .refine(uniqueItems, { message: 'at most one entry per item_id' });
const ZoneStockItems = z
  .array(ZoneStockItem)
  .max(ZONE_LIST_MAX)
  .refine(uniqueItems, { message: 'at most one entry per item_id' });

export const CreateZoneBody = z.object({
  floor_id: z.string().min(1),
  name: ZoneName,
  sort_order: SortOrder.default(0),
  routes: ZoneRoutes.optional(),
  stock_items: ZoneStockItems.optional(),
});

export const PatchZoneBody = z
  .object({
    name: ZoneName.optional(),
    sort_order: SortOrder.optional(),
    archived: z.boolean().optional(),
    routes: ZoneRoutes.optional(),
    stock_items: ZoneStockItems.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'at least one field is required' });

// §3.3: seats null or 1 … 100.
const Seats = z.number().int().min(1).max(100).nullable();

export const CreateTableBody = z.object({
  floor_id: z.string().min(1),
  name: Name,
  seats: Seats.default(null),
  sort_order: SortOrder.default(0),
  zone_id: z.string().min(1).nullable().optional(),
});

export const PatchTableBody = z
  .object({
    floor_id: z.string().min(1).optional(),
    name: Name.optional(),
    seats: Seats.optional(),
    sort_order: SortOrder.optional(),
    zone_id: z.string().min(1).nullable().optional(),
    archived: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'at least one field is required' });

// §3.3: capacity 1 … 100; freshness 0 … 3 600 000, batch only (default 0, set by the service).
const StationType = z.enum(['slot', 'batch']);
const Capacity = z.number().int().min(1).max(100);
const Freshness = z.number().int().min(0).max(3_600_000);
const CompletionMode = z.enum(['two_tap', 'single_tap', 'auto_done']);
// The spec gives the label no length; names' 60 characters keep it a label.
const LocationLabel = z.string().trim().min(1).max(60).nullable();

// 01a §5.2a A-3–A-8 (03a v1.0): ranges of one field; the rules across fields (amber < red, lane and reserve units
// within capacity) read the merged row, so the service checks them.
const Policy = z.enum(['waada_guard', 'edf', 'fifo']);
const FreezeMs = z.number().int().min(0).max(900_000);
const MinSlackKeepMs = z.number().int().min(0).max(600_000);
const PromisePaddingMs = z.number().int().min(0).max(1_800_000).nullable();
const PressureWindowMs = z.number().int().min(300_000).max(3_600_000);
const PressureBp = z.number().int().min(1).max(20_000);
const PressureAlertMs = z.number().int().min(60_000).max(3_600_000);
const LaneUnits = z.number().int().min(1).max(100).nullable();
const ReserveUnits = z.number().int().min(0).max(100);

function issueOnRepeat(values: readonly string[], ctx: z.RefinementCtx, path: (string | number)[], message: string): void {
  values.forEach((value, i) => {
    if (values.indexOf(value) !== i) ctx.addIssue({ code: 'custom', message, path: [...path, i] });
  });
}

// A-9: order_types non-empty, home_for_order_types ⊆ order_types; a repeated value is refused, not collapsed.
const OrderType = z.enum(['dine_in', 'takeaway', 'delivery', 'parking']);
const StationAlternate = z.object({
  alternate_station_id: z.string().min(1),
  order_types: z.array(OrderType),
  home_for_order_types: z.array(OrderType),
});
const StationAlternateInput = StationAlternate.extend({ order_types: z.array(OrderType).min(1) }).superRefine((row, ctx) => {
  issueOnRepeat(row.order_types, ctx, ['order_types'], 'repeated order type');
  issueOnRepeat(row.home_for_order_types, ctx, ['home_for_order_types'], 'repeated order type');
  row.home_for_order_types.forEach((type, i) => {
    if (!row.order_types.includes(type)) {
      ctx.addIssue({ code: 'custom', message: 'not one of order_types', path: ['home_for_order_types', i] });
    }
  });
});
// A-9, A-10: nested replace-lists; one row per alternate station, one per point.
const StationAlternates = z.array(StationAlternateInput).superRefine((rows, ctx) =>
  issueOnRepeat(rows.map((row) => row.alternate_station_id), ctx, [], 'repeated alternate station'),
);
const CarryTime = z.object({ point_id: z.string().min(1), carry_ms: z.number().int().min(0).max(600_000) });
const CarryTimes = z.array(CarryTime).superRefine((rows, ctx) =>
  issueOnRepeat(rows.map((row) => row.point_id), ctx, [], 'repeated point'),
);

export const CreateStationBody = z
  .object({
    name: Name,
    location_label: LocationLabel.default(null),
    station_type: StationType,
    capacity: Capacity,
    freshness_window_ms: Freshness.optional(),
    completion_mode: CompletionMode.default('two_tap'),
    point_id: z.string().min(1).optional(),
    policy: Policy.default('waada_guard'),
    freeze_ms: FreezeMs.default(120_000),
    min_slack_keep_ms: MinSlackKeepMs.default(60_000),
    promise_padding_ms: PromisePaddingMs.default(null),
    pressure_window_ms: PressureWindowMs.default(900_000),
    pressure_amber_bp: PressureBp.default(8_000),
    pressure_red_bp: PressureBp.default(10_000),
    pressure_alert_ms: PressureAlertMs.default(300_000),
    pause_enabled: z.boolean().default(false),
    lane_units: LaneUnits.default(null),
    reserve_units: ReserveUnits.default(0),
    alternates: StationAlternates.default([]),
    carry_times: CarryTimes.default([]),
  })
  .refine((body) => body.station_type === 'batch' || body.freshness_window_ms === undefined, {
    message: 'only batch stations have a freshness window',
    path: ['freshness_window_ms'],
  });

export const PatchStationBody = z
  .object({
    name: Name.optional(),
    location_label: LocationLabel.optional(),
    station_type: StationType.optional(),
    capacity: Capacity.optional(),
    freshness_window_ms: Freshness.optional(),
    completion_mode: CompletionMode.optional(),
    archived: z.boolean().optional(),
    point_id: z.string().min(1).optional(),
    policy: Policy.optional(),
    freeze_ms: FreezeMs.optional(),
    min_slack_keep_ms: MinSlackKeepMs.optional(),
    promise_padding_ms: PromisePaddingMs.optional(),
    pressure_window_ms: PressureWindowMs.optional(),
    pressure_amber_bp: PressureBp.optional(),
    pressure_red_bp: PressureBp.optional(),
    pressure_alert_ms: PressureAlertMs.optional(),
    pause_enabled: z.boolean().optional(),
    lane_units: LaneUnits.optional(),
    reserve_units: ReserveUnits.optional(),
    alternates: StationAlternates.optional(),
    carry_times: CarryTimes.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'at least one field is required' });

const Station = z.object({
  station_id: z.string(),
  name: z.string(),
  location_label: z.string().nullable(),
  station_type: StationType,
  capacity: z.number(),
  freshness_window_ms: z.number().nullable(),
  completion_mode: CompletionMode,
  archived_at: z.number().nullable(),
  point_id: z.string(),
  policy: Policy,
  freeze_ms: z.number(),
  min_slack_keep_ms: z.number(),
  promise_padding_ms: z.number().nullable(),
  pressure_window_ms: z.number(),
  pressure_amber_bp: z.number(),
  pressure_red_bp: z.number(),
  pressure_alert_ms: z.number(),
  pause_enabled: z.boolean(),
  lane_units: z.number().nullable(),
  reserve_units: z.number(),
  alternates: z.array(StationAlternate),
  carry_times: z.array(CarryTime),
});

const Point = z.object({
  point_id: z.string(),
  name: z.string(),
  sort_order: z.number(),
  archived_at: z.number().nullable(),
  version: z.string(),
});

const ProgramSummary = z.object({
  program_id: z.string(),
  name: z.string(),
  cook_time_ms: z.number(),
  archived_at: z.number().nullable(),
});

export const StationListResponse = z.object({
  data: z.object({ stations: z.array(Station.extend({ programs: z.array(ProgramSummary) })), points: z.array(Point) }),
});
export const StationResponse = z.object({ data: z.object({ station: Station }) });

// §6.9a, §5.2a A-1: names 1–40 characters after trimming.
const PointName = z.string().trim().min(1).max(40);

export const CreatePointBody = z.object({
  name: PointName,
  sort_order: SortOrder.default(0),
});

// R30, C9: expected_version is required and a body with nothing else is refused.
export const PatchPointBody = z
  .object({
    expected_version: z.string().min(1),
    name: PointName.optional(),
    sort_order: SortOrder.optional(),
    archived: z.boolean().optional(),
  })
  .refine((body) => body.name !== undefined || body.sort_order !== undefined || body.archived !== undefined, {
    message: 'a field besides expected_version is required',
  });

export const PointResponse = z.object({ data: z.object({ point: Point }) });

// §3.3: cook_time_ms 1 … 14 400 000.
const CookTime = z.number().int().min(1).max(14_400_000);

export const CreateProgramBody = z.object({ name: Name, cook_time_ms: CookTime });

export const PatchProgramBody = z
  .object({ name: Name.optional(), cook_time_ms: CookTime.optional(), archived: z.boolean().optional() })
  .refine((body) => Object.keys(body).length > 0, { message: 'at least one field is required' });

export const ProgramResponse = z.object({
  data: z.object({ program: ProgramSummary.extend({ station_id: z.string() }) }),
});

// §3.3: rate_bp 0 … 10 000.
const RateBp = z.number().int().min(0).max(10_000);

export const CreateTaxClassBody = z.object({ name: Name, rate_bp: RateBp });

export const PatchTaxClassBody = z
  .object({ name: Name.optional(), rate_bp: RateBp.optional(), archived: z.boolean().optional() })
  .refine((body) => Object.keys(body).length > 0, { message: 'at least one field is required' });

// §3.3, S47: 0–4 windows; minutes of the day 0 … 86 340 000, multiples of 60 000, start ≠ end.
const TimeOfDayMs = z.number().int().min(0).max(86_340_000).multipleOf(60_000);
export const AvailabilityWindows = z
  .array(
    z
      .object({ start_ms: TimeOfDayMs, end_ms: TimeOfDayMs })
      .refine((w) => w.start_ms !== w.end_ms, { message: 'start_ms and end_ms must differ' }),
  )
  .max(4);

// A-13: one element of a goes_with list; source_kind and source_id come from the path. A target repeated in one list
// → 400 at goes_with.N.target_id (one row per source and target).
const GoesWithKind = z.enum(['category', 'item']);
const ItemGoesWith = z
  .array(
    z.object({
      target_kind: GoesWithKind,
      target_id: z.string().min(1),
      excluded: z.boolean().default(false),
    }),
  )
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((link, i) => {
      const key = `${link.target_kind}:${link.target_id}`;
      if (seen.has(key)) ctx.addIssue({ code: 'custom', path: [i, 'target_id'], message: 'duplicate target' });
      seen.add(key);
    });
  });
// A-13: `excluded` is an item override, so a category's list never carries it.
const CategoryGoesWith = ItemGoesWith.superRefine((list, ctx) => {
  list.forEach((link, i) => {
    if (link.excluded) ctx.addIssue({ code: 'custom', path: [i, 'excluded'], message: 'only an item can exclude' });
  });
});
// The five A-13 fields, the shape the snapshot carries.
const GoesWithLink = z.object({
  source_kind: GoesWithKind,
  source_id: z.string(),
  target_kind: GoesWithKind,
  target_id: z.string(),
  excluded: z.boolean(),
});

export const CreateCategoryBody = z.object({
  name: Name,
  sort_order: SortOrder.default(0),
  availability_windows: AvailabilityWindows.default([]),
});

export const PatchCategoryBody = z
  .object({
    name: Name.optional(),
    sort_order: SortOrder.optional(),
    availability_windows: AvailabilityWindows.optional(),
    goes_with: CategoryGoesWith.optional(),
    archived: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'at least one field is required' });

export const TaxClassResponse = z.object({
  data: z.object({
    tax_class: z.object({
      tax_class_id: z.string(),
      name: z.string(),
      rate_bp: z.number(),
      archived_at: z.number().nullable(),
    }),
  }),
});

export const CategoryResponse = z.object({
  data: z.object({
    category: z.object({
      category_id: z.string(),
      name: z.string(),
      sort_order: z.number(),
      archived_at: z.number().nullable(),
      availability_windows: z.array(z.object({ start_ms: z.number(), end_ms: z.number() })),
      goes_with: z.array(GoesWithLink),
    }),
  }),
});

// §3.3, S46: the menu item's ranges.
const Unit = z.enum(['piece', 'g', 'ml']);
const ServeMode = z.enum(['immediate', 'sync']);
const OutOfStockBehaviour = z.enum(['cook_fresh', 'sold_out']);
export const PriceMinor = z.number().int().min(0).max(1_000_000_000);
const PrepBuffer = z.number().int().min(0).max(3_600_000);
const StockTime = z.number().int().min(0).max(14_400_000).nullable();
export const Description = z.string().max(300).nullable();
// 01c §3.3: variant_name 1–30 after trimming.
const VariantName = z.string().trim().min(1).max(30);
// §5.2a A-11: the item's timing knobs.
const WeightPct = z.number().int().min(10).max(1000);
const MaxEarly = z.number().int().min(0).max(3_600_000);
const MaxCarry = z.number().int().min(0).max(600_000).nullable();
const MaxLate = z.number().int().min(0).max(7_200_000).nullable();
const AdjustTime = z.number().int().min(0).max(3_600_000);

// 01c §3.3, V4: 0–1 draws (pilot), quantity 1 … 1 000 000; one per stock_item_id (C6: the repeat → 400 at
// stock_draws.N.stock_item_id). The unit rule needs the stock item, so it is the service's (422 unit_mismatch).
const StockDraws = z
  .array(
    z.object({
      stock_item_id: z.string().min(1),
      quantity_per_sale_unit: z.number().int().min(1).max(1_000_000),
    }),
  )
  // before max(1): zod skips a refinement once the value has an issue
  .superRefine((draws, ctx) => {
    const seen = new Set<string>();
    draws.forEach((draw, i) => {
      if (seen.has(draw.stock_item_id)) ctx.addIssue({ code: 'custom', path: [i, 'stock_item_id'], message: 'duplicate stock_item_id' });
      seen.add(draw.stock_item_id);
    });
  })
  .max(1);

const RouteInput = z.object({
  branch_id: z.string().min(1),
  station_id: z.string().min(1),
  program_id: z.string().min(1).nullable().default(null),
  stock_program_id: z.string().min(1).nullable().default(null),
  // S57: this branch's own price; null = the item's price_minor.
  price_minor_override: PriceMinor.nullable().default(null),
});

// §6.14 (01c §6.4): tax_class_id is a required key (null = never taxed, S34); at most one route per branch.
// variant_group_id and variant_name go together (§3.3); requires_weighing only with sale_unit g or ml (V18).
// The deprecated fields (group_label, stock_unit, stock_per_sale_unit, low_stock_threshold, carries_over) are
// dropped by the schema (not .strict()).
export const CreateMenuItemBody = z
  .object({
    category_id: z.string().min(1),
    tax_class_id: z.string().min(1).nullable(),
    name: Name,
    variant_group_id: z.string().min(1).nullable().default(null),
    variant_name: VariantName.nullable().default(null),
    description: Description.default(null),
    sort_order: SortOrder.default(0),
    price_minor: PriceMinor,
    serve_mode: ServeMode,
    prep_buffer_ms: PrepBuffer.default(0),
    cook_time_ms: CookTime,
    stock_time_ms: StockTime.default(null),
    out_of_stock_behaviour: OutOfStockBehaviour.default('cook_fresh'),
    sale_unit: Unit.default('piece'),
    requires_weighing: z.boolean().default(false),
    is_ready_item: z.boolean().default(false),
    stock_draws: StockDraws.default([]),
    availability_windows: AvailabilityWindows.default([]),
    weight_pct: WeightPct.default(100),
    max_early_ms: MaxEarly.default(60_000),
    max_carry_ms: MaxCarry.default(null),
    max_late_ms: MaxLate.default(null),
    adjust_time_ms: AdjustTime.default(180_000),
    routes: z
      .array(RouteInput)
      .default([])
      .refine((routes) => new Set(routes.map((r) => r.branch_id)).size === routes.length, {
        message: 'at most one route per branch',
      }),
  })
  .superRefine((body, ctx) => {
    if (body.variant_group_id !== null && body.variant_name === null) {
      ctx.addIssue({ code: 'custom', path: ['variant_name'], message: 'required with variant_group_id' });
    }
    if (body.variant_group_id === null && body.variant_name !== null) {
      ctx.addIssue({ code: 'custom', path: ['variant_group_id'], message: 'required with variant_name' });
    }
    if (body.requires_weighing && body.sale_unit === 'piece') {
      ctx.addIssue({ code: 'custom', path: ['requires_weighing'], message: "needs sale_unit 'g' or 'ml'" });
    }
  });

// §6.15 (01c §6.5): any item field plus archived; routes use §6.16. stock_draws replaces the item's draws (0–1,
// C6 keyed). The rules run on the merged row (service: the V4 unit rule R2, the V18 weighing rule R7). The
// deprecated fields (group_label, stock_unit, stock_per_sale_unit, low_stock_threshold, carries_over) are dropped
// by the schema (not .strict()).
export const PatchMenuItemBody = z
  .object({
    category_id: z.string().min(1).optional(),
    tax_class_id: z.string().min(1).nullable().optional(),
    name: Name.optional(),
    variant_group_id: z.string().min(1).nullable().optional(),
    variant_name: VariantName.nullable().optional(),
    description: Description.optional(),
    sort_order: SortOrder.optional(),
    price_minor: PriceMinor.optional(),
    serve_mode: ServeMode.optional(),
    prep_buffer_ms: PrepBuffer.optional(),
    cook_time_ms: CookTime.optional(),
    stock_time_ms: StockTime.optional(),
    out_of_stock_behaviour: OutOfStockBehaviour.optional(),
    sale_unit: Unit.optional(),
    requires_weighing: z.boolean().optional(),
    is_ready_item: z.boolean().optional(),
    stock_draws: StockDraws.optional(),
    availability_windows: AvailabilityWindows.optional(),
    weight_pct: WeightPct.optional(),
    max_early_ms: MaxEarly.optional(),
    max_carry_ms: MaxCarry.optional(),
    max_late_ms: MaxLate.optional(),
    adjust_time_ms: AdjustTime.optional(),
    goes_with: ItemGoesWith.optional(),
    archived: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'at least one field is required' })
  // 01c §6.5: leaving a group sends both null; one of them null alone → 400 (the merged-row pair is the service's)
  .superRefine((body, ctx) => {
    if (body.variant_group_id === null && body.variant_name !== null) {
      ctx.addIssue({ code: 'custom', path: ['variant_name'], message: 'must be null with variant_group_id null' });
    }
    if (body.variant_name === null && body.variant_group_id !== null) {
      ctx.addIssue({ code: 'custom', path: ['variant_group_id'], message: 'must be null with variant_name null' });
    }
  });

// §6.16: { station_id, program_id?, stock_program_id?, price_minor_override? } sets the branch's route;
// { station_id: null } removes it.
export const PutItemRouteBody = z
  .object({
    station_id: z.string().min(1).nullable(),
    program_id: z.string().min(1).nullable().default(null),
    stock_program_id: z.string().min(1).nullable().default(null),
    price_minor_override: PriceMinor.nullable().default(null),
  })
  .refine(
    (body) =>
      body.station_id !== null ||
      (body.program_id === null && body.stock_program_id === null && body.price_minor_override === null),
    { message: 'a removed route has no programs and no price', path: ['station_id'] },
  );

const Route = z.object({
  branch_id: z.string(),
  station_id: z.string(),
  program_id: z.string().nullable(),
  stock_program_id: z.string().nullable(),
  price_minor_override: z.number().nullable(),
});

const Window = z.object({ start_ms: z.number(), end_ms: z.number() });

// 01c §6.3: the item wire adds variant_group_id, variant_name, stock_draws and requires_weighing (§5.4); the
// deprecated columns are not on it.
const MenuItem = z.object({
  item_id: z.string(),
  category_id: z.string(),
  tax_class_id: z.string().nullable(),
  name: z.string(),
  variant_group_id: z.string().nullable(),
  variant_name: z.string().nullable(),
  description: z.string().nullable(),
  sort_order: z.number(),
  price_minor: z.number(),
  serve_mode: ServeMode,
  prep_buffer_ms: z.number(),
  cook_time_ms: z.number(),
  stock_time_ms: z.number().nullable(),
  out_of_stock_behaviour: OutOfStockBehaviour,
  sale_unit: Unit,
  requires_weighing: z.boolean(),
  is_ready_item: z.boolean(),
  stock_draws: z.array(z.object({ stock_item_id: z.string(), quantity_per_sale_unit: z.number() })),
  availability_windows: z.array(Window),
  weight_pct: z.number(),
  max_early_ms: z.number(),
  max_carry_ms: z.number().nullable(),
  max_late_ms: z.number().nullable(),
  adjust_time_ms: z.number(),
  goes_with: z.array(GoesWithLink),
  archived_at: z.number().nullable(),
  routes: z.array(Route),
});

// 01c §5.4, §6.3: the variant group wire (§6.1, §6.2 responses and the menu read's variant_groups, whole, archived
// included; member_ids lists every member, archived included). Defined here because the menu read needs it and
// menu-variants.ts imports this file; menu-variants.ts re-exports it.
export const VariantGroupWire = z.object({
  variant_group_id: z.string(),
  name: z.string(),
  category_id: z.string(),
  description: z.string().nullable(),
  sort_order: z.number(),
  archived_at: z.number().nullable(),
  member_ids: z.array(z.string()),
  version: z.string(),
});
export type VariantGroupWire = z.infer<typeof VariantGroupWire>;

export const MenuItemResponse = z.object({ data: z.object({ item: MenuItem }) });
export const ItemRouteResponse = z.object({ data: z.object({ route: Route.nullable() }) });

export const MenuResponse = z.object({
  data: z.object({
    can_edit_tenant: z.boolean(),
    tax_classes: z.array(
      z.object({ tax_class_id: z.string(), name: z.string(), rate_bp: z.number(), archived_at: z.number().nullable() }),
    ),
    categories: z.array(
      z.object({
        category_id: z.string(),
        name: z.string(),
        sort_order: z.number(),
        archived_at: z.number().nullable(),
        availability_windows: z.array(Window),
        goes_with: z.array(GoesWithLink),
      }),
    ),
    variant_groups: z.array(VariantGroupWire),
    items: z.array(MenuItem),
    next_cursor: z.string().nullable(),
  }),
});

// §6.7b (v1.2, S58): the owner's branches, for their names; v1.3 (01b B19, D-11) with the hub's times.
export const BranchListResponse = z.object({
  data: z.object({
    branches: z.array(
      z.object({
        branch_id: z.string(),
        name: z.string(),
        status: z.enum(['pending_hub', 'active']),
        hub_last_seen_at: z.number().int().nullable(),
        hub_synced_at: z.number().int().nullable(),
      }),
    ),
    hub_stale_after_ms: z.number().int(),
  }),
});

const Floor = z.object({
  floor_id: z.string(),
  name: z.string(),
  sort_order: z.number(),
  archived_at: z.number().nullable(),
});

const Table = z.object({
  table_id: z.string(),
  name: z.string(),
  seats: z.number().nullable(),
  sort_order: z.number(),
  zone_id: z.string().nullable(),
  archived_at: z.number().nullable(),
});

// §6.2 (02a A-1; AD-16): the floors list carries each floor's zones with both their lists, by item_id.
const ZoneSummary = z.object({
  zone_id: z.string(),
  name: z.string(),
  sort_order: z.number(),
  archived_at: z.number().nullable(),
  routes: z.array(z.object({ item_id: z.string(), station_id: z.string() })),
  stock_items: z.array(z.object({ item_id: z.string(), threshold: z.number() })),
});

// §6.6a, §6.6b: the zone with both its lists and its floor.
const Zone = ZoneSummary.extend({ floor_id: z.string() });

export const FloorListResponse = z.object({
  data: z.object({ floors: z.array(Floor.extend({ zones: z.array(ZoneSummary), tables: z.array(Table) })) }),
});

export const ZoneResponse = z.object({ data: z.object({ zone: Zone }) });

export const FloorResponse = z.object({ data: z.object({ floor: Floor }) });
export const TableResponse = z.object({ data: z.object({ table: Table.extend({ floor_id: z.string() }) }) });

// Parsed bodies (defaults filled), for the cloud services.
export type CreateFloorInput = z.infer<typeof CreateFloorBody>;
export type PatchFloorInput = z.infer<typeof PatchFloorBody>;
export type CreateZoneInput = z.infer<typeof CreateZoneBody>;
export type PatchZoneInput = z.infer<typeof PatchZoneBody>;
export type CreateTableInput = z.infer<typeof CreateTableBody>;
export type PatchTableInput = z.infer<typeof PatchTableBody>;
export type CreateStationInput = z.infer<typeof CreateStationBody>;
export type PatchStationInput = z.infer<typeof PatchStationBody>;
export type CreatePointInput = z.infer<typeof CreatePointBody>;
export type PatchPointInput = z.infer<typeof PatchPointBody>;
export type CreateProgramInput = z.infer<typeof CreateProgramBody>;
export type PatchProgramInput = z.infer<typeof PatchProgramBody>;
export type CreateTaxClassInput = z.infer<typeof CreateTaxClassBody>;
export type PatchTaxClassInput = z.infer<typeof PatchTaxClassBody>;
export type CreateCategoryInput = z.infer<typeof CreateCategoryBody>;
export type PatchCategoryInput = z.infer<typeof PatchCategoryBody>;
export type CreateMenuItemInput = z.infer<typeof CreateMenuItemBody>;
export type PatchMenuItemInput = z.infer<typeof PatchMenuItemBody>;
export type PutItemRouteInput = z.infer<typeof PutItemRouteBody>;

// Request types as the client sends them (defaults optional), for apps/client.
export type CreateFloorRequest = z.input<typeof CreateFloorBody>;
export type PatchFloorRequest = z.input<typeof PatchFloorBody>;
export type CreateZoneRequest = z.input<typeof CreateZoneBody>;
export type PatchZoneRequest = z.input<typeof PatchZoneBody>;
export type CreateTableRequest = z.input<typeof CreateTableBody>;
export type PatchTableRequest = z.input<typeof PatchTableBody>;
export type CreateStationRequest = z.input<typeof CreateStationBody>;
export type PatchStationRequest = z.input<typeof PatchStationBody>;
export type CreatePointRequest = z.input<typeof CreatePointBody>;
export type PatchPointRequest = z.input<typeof PatchPointBody>;
export type CreateProgramRequest = z.input<typeof CreateProgramBody>;
export type PatchProgramRequest = z.input<typeof PatchProgramBody>;
export type CreateTaxClassRequest = z.input<typeof CreateTaxClassBody>;
export type PatchTaxClassRequest = z.input<typeof PatchTaxClassBody>;
export type CreateCategoryRequest = z.input<typeof CreateCategoryBody>;
export type PatchCategoryRequest = z.input<typeof PatchCategoryBody>;
export type CreateMenuItemRequest = z.input<typeof CreateMenuItemBody>;
export type PatchMenuItemRequest = z.input<typeof PatchMenuItemBody>;
export type PutItemRouteRequest = z.input<typeof PutItemRouteBody>;

// Response data types, for apps/client.
export type AdminBranch = z.infer<typeof BranchListResponse>['data']['branches'][number];
export type AdminFloorList = z.infer<typeof FloorListResponse>['data'];
export type AdminFloor = z.infer<typeof Floor>;
export type AdminTable = z.infer<typeof Table>;
export type AdminZone = z.infer<typeof Zone>;
export type AdminStationList = z.infer<typeof StationListResponse>['data'];
export type AdminStation = z.infer<typeof Station>;
export type AdminPoint = z.infer<typeof Point>;
export type AdminProgram = z.infer<typeof ProgramSummary>;
export type AdminTaxClass = z.infer<typeof TaxClassResponse>['data']['tax_class'];
export type AdminGoesWithLink = z.infer<typeof GoesWithLink>;
export type AdminCategory = z.infer<typeof CategoryResponse>['data']['category'];
export type AdminRoute = z.infer<typeof Route>;
export type AdminMenuItem = z.infer<typeof MenuItem>;
export type AdminMenuPage = z.infer<typeof MenuResponse>['data'];
export type AdminWindow = z.infer<typeof Window>;
