import { z } from 'zod';

// §3.3: names 1–60 characters after trimming.
export const Name = z.string().trim().min(1).max(60);
// INT column; the spec gives no range, so the column's range keeps a large value from becoming a 500.
const SortOrder = z.number().int().min(-2_147_483_648).max(2_147_483_647);

export const BranchParams = z.object({ branch_id: z.string().min(1) });
export const FloorParams = BranchParams.extend({ floor_id: z.string().min(1) });
export const TableParams = BranchParams.extend({ table_id: z.string().min(1) });

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

export const StationParams = BranchParams.extend({ station_id: z.string().min(1) });

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

export type CreateFloorInput = z.infer<typeof CreateFloorBody>;
export type PatchFloorInput = z.infer<typeof PatchFloorBody>;
export type CreateTableInput = z.infer<typeof CreateTableBody>;
export type PatchTableInput = z.infer<typeof PatchTableBody>;
export type CreateStationInput = z.infer<typeof CreateStationBody>;
export type PatchStationInput = z.infer<typeof PatchStationBody>;
