import { z } from 'zod';

// §3.3: names 1–60 characters after trimming.
export const Name = z.string().trim().min(1).max(60);
// INT column; the spec gives no range, so the column's range keeps a large value from becoming a 500.
const SortOrder = z.number().int().min(-2_147_483_648).max(2_147_483_647);

export const BranchParams = z.object({ branch_id: z.string().min(1) });

export const CreateFloorBody = z.object({
  name: Name,
  sort_order: SortOrder.default(0),
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

export type CreateFloorInput = z.infer<typeof CreateFloorBody>;
