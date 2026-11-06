import { z } from 'zod';

// D5: the request bodies and responses the owner app shares live in @pos/events (admin/restaurant.ts);
// the path params and the menu query stay here.

export const BranchParams = z.object({ branch_id: z.string().min(1) });
export const FloorParams = BranchParams.extend({ floor_id: z.string().min(1) });
export const TableParams = BranchParams.extend({ table_id: z.string().min(1) });
export const StationParams = BranchParams.extend({ station_id: z.string().min(1) });
export const PointParams = BranchParams.extend({ point_id: z.string().min(1) });
export const ProgramParams = StationParams.extend({ program_id: z.string().min(1) });
export const TaxClassParams = z.object({ tax_class_id: z.string().min(1) });
export const CategoryParams = z.object({ category_id: z.string().min(1) });
export const MenuItemParams = z.object({ item_id: z.string().min(1) });
// §6.16: { station_id, program_id?, stock_program_id? } sets the branch's route; { station_id: null } removes it.
export const ItemRouteParams = MenuItemParams.extend({ branch_id: z.string().min(1) });

// §6.11, S48: search, filters and a keyset cursor (decoded by the service).
export const MenuQuery = z.object({
  q: z.string().min(1).max(60).optional(),
  category_id: z.string().min(1).optional(),
  status: z.enum(['active', 'archived']).default('active'),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type MenuQueryInput = z.infer<typeof MenuQuery>;
