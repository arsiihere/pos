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
