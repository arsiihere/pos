import { z } from 'zod';

// D5, §7.7: the owner admin request bodies and responses, shared by the cloud routes and apps/client
// (browser-safe: zod only).

// §3.3: names 1–60 characters after trimming.
const Name = z.string().trim().min(1).max(60);
// INT column; the spec gives no range, so the column's range keeps a large value from becoming a 500.
const SortOrder = z.number().int().min(-2_147_483_648).max(2_147_483_647);

export const CreateFloorBody = z.object({
  name: Name,
  sort_order: SortOrder.default(0),
});

export const PatchFloorBody = z
  .object({ name: Name.optional(), sort_order: SortOrder.optional(), archived: z.boolean().optional() })
  .refine((body) => Object.keys(body).length > 0, { message: 'at least one field is required' });

// §3.3: seats null or 1 … 100.
const Seats = z.number().int().min(1).max(100).nullable();

export const CreateTableBody = z.object({
  floor_id: z.string().min(1),
  name: Name,
  seats: Seats.default(null),
  sort_order: SortOrder.default(0),
});

export const PatchTableBody = z
  .object({
    floor_id: z.string().min(1).optional(),
    name: Name.optional(),
    seats: Seats.optional(),
    sort_order: SortOrder.optional(),
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

export const CreateStationBody = z
  .object({
    name: Name,
    location_label: LocationLabel.default(null),
    station_type: StationType,
    capacity: Capacity,
    freshness_window_ms: Freshness.optional(),
    completion_mode: CompletionMode.default('two_tap'),
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
});

const ProgramSummary = z.object({
  program_id: z.string(),
  name: z.string(),
  cook_time_ms: z.number(),
  archived_at: z.number().nullable(),
});

export const StationListResponse = z.object({
  data: z.object({ stations: z.array(Station.extend({ programs: z.array(ProgramSummary) })) }),
});
export const StationResponse = z.object({ data: z.object({ station: Station }) });

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
const AvailabilityWindows = z
  .array(
    z
      .object({ start_ms: TimeOfDayMs, end_ms: TimeOfDayMs })
      .refine((w) => w.start_ms !== w.end_ms, { message: 'start_ms and end_ms must differ' }),
  )
  .max(4);

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
    }),
  }),
});

// §3.3, S44, S46: the menu item's ranges. The units rule (equal → 1; different → sale_unit 'piece') is the
// service's, so it can name the field.
const Unit = z.enum(['piece', 'g', 'ml']);
const ServeMode = z.enum(['immediate', 'sync']);
const OutOfStockBehaviour = z.enum(['cook_fresh', 'sold_out']);
const PriceMinor = z.number().int().min(0).max(1_000_000_000);
const PrepBuffer = z.number().int().min(0).max(3_600_000);
const StockTime = z.number().int().min(0).max(14_400_000).nullable();
const StockPerSaleUnit = z.number().int().min(1).max(1_000_000);
const LowStockThreshold = z.number().int().min(0).max(1_000_000).nullable();
// The spec gives the label no length; names' 60 characters keep it a label (S12).
const GroupLabel = z.string().trim().min(1).max(60).nullable();
const Description = z.string().max(300).nullable();

const RouteInput = z.object({
  branch_id: z.string().min(1),
  station_id: z.string().min(1),
  program_id: z.string().min(1).nullable().default(null),
  stock_program_id: z.string().min(1).nullable().default(null),
  // S57: this branch's own price; null = the item's price_minor.
  price_minor_override: PriceMinor.nullable().default(null),
});

// §6.14: tax_class_id is a required key (null = never taxed, S34); at most one route per branch.
export const CreateMenuItemBody = z.object({
  category_id: z.string().min(1),
  tax_class_id: z.string().min(1).nullable(),
  name: Name,
  group_label: GroupLabel.default(null),
  description: Description.default(null),
  sort_order: SortOrder.default(0),
  price_minor: PriceMinor,
  serve_mode: ServeMode,
  prep_buffer_ms: PrepBuffer.default(0),
  cook_time_ms: CookTime,
  stock_time_ms: StockTime.default(null),
  out_of_stock_behaviour: OutOfStockBehaviour.default('cook_fresh'),
  stock_unit: Unit.default('piece'),
  sale_unit: Unit.default('piece'),
  stock_per_sale_unit: StockPerSaleUnit.default(1),
  low_stock_threshold: LowStockThreshold.default(null),
  carries_over: z.boolean().default(false),
  availability_windows: AvailabilityWindows.default([]),
  routes: z
    .array(RouteInput)
    .default([])
    .refine((routes) => new Set(routes.map((r) => r.branch_id)).size === routes.length, {
      message: 'at most one route per branch',
    }),
});

// §6.15: any item field plus archived; routes use §6.16. The rules run on the merged row (service).
export const PatchMenuItemBody = z
  .object({
    category_id: z.string().min(1).optional(),
    tax_class_id: z.string().min(1).nullable().optional(),
    name: Name.optional(),
    group_label: GroupLabel.optional(),
    description: Description.optional(),
    sort_order: SortOrder.optional(),
    price_minor: PriceMinor.optional(),
    serve_mode: ServeMode.optional(),
    prep_buffer_ms: PrepBuffer.optional(),
    cook_time_ms: CookTime.optional(),
    stock_time_ms: StockTime.optional(),
    out_of_stock_behaviour: OutOfStockBehaviour.optional(),
    stock_unit: Unit.optional(),
    sale_unit: Unit.optional(),
    stock_per_sale_unit: StockPerSaleUnit.optional(),
    low_stock_threshold: LowStockThreshold.optional(),
    carries_over: z.boolean().optional(),
    availability_windows: AvailabilityWindows.optional(),
    archived: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'at least one field is required' });

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

const MenuItem = z.object({
  item_id: z.string(),
  category_id: z.string(),
  tax_class_id: z.string().nullable(),
  name: z.string(),
  group_label: z.string().nullable(),
  description: z.string().nullable(),
  sort_order: z.number(),
  price_minor: z.number(),
  serve_mode: ServeMode,
  prep_buffer_ms: z.number(),
  cook_time_ms: z.number(),
  stock_time_ms: z.number().nullable(),
  out_of_stock_behaviour: OutOfStockBehaviour,
  stock_unit: Unit,
  sale_unit: Unit,
  stock_per_sale_unit: z.number(),
  low_stock_threshold: z.number().nullable(),
  carries_over: z.boolean(),
  availability_windows: z.array(Window),
  archived_at: z.number().nullable(),
  routes: z.array(Route),
});

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
      }),
    ),
    items: z.array(MenuItem),
    next_cursor: z.string().nullable(),
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
  archived_at: z.number().nullable(),
});

export const FloorListResponse = z.object({
  data: z.object({ floors: z.array(Floor.extend({ tables: z.array(Table) })) }),
});

export const FloorResponse = z.object({ data: z.object({ floor: Floor }) });
export const TableResponse = z.object({ data: z.object({ table: Table.extend({ floor_id: z.string() }) }) });

// Parsed bodies (defaults filled), for the cloud services.
export type CreateFloorInput = z.infer<typeof CreateFloorBody>;
export type PatchFloorInput = z.infer<typeof PatchFloorBody>;
export type CreateTableInput = z.infer<typeof CreateTableBody>;
export type PatchTableInput = z.infer<typeof PatchTableBody>;
export type CreateStationInput = z.infer<typeof CreateStationBody>;
export type PatchStationInput = z.infer<typeof PatchStationBody>;
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
export type CreateTableRequest = z.input<typeof CreateTableBody>;
export type PatchTableRequest = z.input<typeof PatchTableBody>;
export type CreateStationRequest = z.input<typeof CreateStationBody>;
export type PatchStationRequest = z.input<typeof PatchStationBody>;
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
export type AdminFloorList = z.infer<typeof FloorListResponse>['data'];
export type AdminFloor = z.infer<typeof Floor>;
export type AdminTable = z.infer<typeof Table>;
export type AdminStationList = z.infer<typeof StationListResponse>['data'];
export type AdminStation = z.infer<typeof Station>;
export type AdminProgram = z.infer<typeof ProgramSummary>;
export type AdminTaxClass = z.infer<typeof TaxClassResponse>['data']['tax_class'];
export type AdminCategory = z.infer<typeof CategoryResponse>['data']['category'];
export type AdminRoute = z.infer<typeof Route>;
export type AdminMenuItem = z.infer<typeof MenuItem>;
export type AdminMenuPage = z.infer<typeof MenuResponse>['data'];
export type AdminWindow = z.infer<typeof Window>;
