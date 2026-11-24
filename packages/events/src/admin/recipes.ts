import { z } from 'zod';
// 08 v1.1 Part B §5.4, §6.1–§6.6: recipe wires and bodies, shared by the cloud routes and apps/client (browser-safe:
// zod only). BIGINT values travel as decimal strings (m-16); money is integer minor units, rounded once (B9).

const Id = z.string().min(1);
const Version = z.string().min(1);
const Unit = z.enum(['piece', 'g', 'ml']);
const DecimalString = z.string().regex(/^-?[0-9]+$/);

export const RecipeOwnerType = z.enum(['menu_item', 'modifier_option', 'stock_item']);
export type RecipeOwnerType = z.infer<typeof RecipeOwnerType>;
export const RecipeBasis = z.enum(['per_unit', 'per_measure', 'per_batch']);
export type RecipeBasis = z.infer<typeof RecipeBasis>;
export const RecipeVersionStatus = z.enum(['draft', 'published', 'superseded']);
export type RecipeVersionStatus = z.infer<typeof RecipeVersionStatus>;
export const QtyBasis = z.enum(['AP', 'EP']);
export type QtyBasis = z.infer<typeof QtyBasis>;

// §3.3 limits
export const RECIPE_MAX_LINES = 60;
export const RECIPE_QTY_PATTERN = /^-?\d{1,6}(\.\d{1,4})?$/; // B4 (m-8)

// B6 warnings (non-blocking). AD-15: B6 names no_yield_defaulted_ap and main_line_off; the other three are named here.
export const RecipeWarningCode = z.enum([
  'ep_in_batch', // EP line inside a per_batch recipe (D7)
  'no_yield_defaulted_ap', // M-7: ingredient line defaulted to AP, the item has no active yield
  'ep_no_yield', // explicit EP on an ingredient with no active yield (cost partial, D9)
  'no_menu_cost', // a line with no menu cost (cost partial)
  'main_line_off', // per_measure with no AP line within ± 20 % of base_qty (R7: a warning only)
]);
export type RecipeWarningCode = z.infer<typeof RecipeWarningCode>;

// ------------------------------------------------------------------------------------------------------- wires

// `minor` rounded once, half away from zero; null for no_recipe or when nothing is known (t-6) — never "0" for a
// missing cost (D9). unknown_items: stock item ids whose cost is unknown.
export const CostWire = z.object({
  status: z.enum(['costed', 'partial', 'no_recipe']),
  minor: DecimalString.nullable(),
  unknown_items: z.array(z.string()),
});
export type CostWire = z.infer<typeof CostWire>;

export const CoverageWire = z.object({ items_total: z.number().int(), items_with_recipe: z.number().int(), pct_bp: z.number().int() });
export type CoverageWire = z.infer<typeof CoverageWire>;

// §5.4. AD-16: §6.1 lists owners with no recipe yet, so recipe_id / version are null on such a row; `version` is the
// recipe-level version the §6.6 PATCH sends as expected_version (V13).
export const RecipeSummaryWire = z.object({
  recipe_id: z.string().nullable(),
  owner_type: RecipeOwnerType,
  owner_id: z.string(),
  owner_name: z.string(),
  owner_archived: z.boolean(),
  archived: z.boolean(),
  has_draft: z.boolean(),
  published: z.object({ recipe_version_id: z.string(), version_no: z.number().int(), published_at: z.number() }).nullable(),
  plate_cost: CostWire,
  version: z.string().nullable(),
});
export type RecipeSummaryWire = z.infer<typeof RecipeSummaryWire>;

export const RecipeLineWire = z.object({
  line_no: z.number().int(),
  stock_item_id: z.string(),
  stock_item_name: z.string(),
  kind: z.string(),
  unit_name: z.string(),
  qty: z.string(), // as entered, decimal (B4)
  qty_basis: QtyBasis,
  line_cost: CostWire,
});
export type RecipeLineWire = z.infer<typeof RecipeLineWire>;

export const RecipeWarningWire = z.object({ code: RecipeWarningCode, line_no: z.number().int().optional() });
export type RecipeWarningWire = z.infer<typeof RecipeWarningWire>;

export const RecipeVersionWire = z.object({
  recipe_version_id: z.string(),
  version_no: z.number().int(),
  status: RecipeVersionStatus,
  basis: RecipeBasis,
  base_qty: z.number().int().nullable(),
  measure_unit: z.enum(['g', 'ml']).nullable(), // T-2
  batch_yield_qty: z.string().nullable(),
  batch_stock_unit: Unit.nullable(),
  misc_allowance_bp: z.number().int(),
  lines: z.array(RecipeLineWire),
  cost: CostWire,
  warnings: z.array(RecipeWarningWire),
  created_by_name: z.string(),
  published_by_name: z.string().nullable(),
  published_at: z.number().nullable(),
  version: z.string(), // V13: expected_version for the next draft save / publish
});
export type RecipeVersionWire = z.infer<typeof RecipeVersionWire>;

export const RecipeHistoryEntry = z.object({
  recipe_version_id: z.string(),
  version_no: z.number().int(),
  status: RecipeVersionStatus,
  published_at: z.number().nullable(),
  published_by_name: z.string().nullable(),
});
export type RecipeHistoryEntry = z.infer<typeof RecipeHistoryEntry>;

// ----------------------------------------------------------------------------------------------- §6.1, §6.2 reads

export const RecipeListQuery = z.object({
  branch_id: Id.optional(),
  filter: z.enum(['all', 'missing', 'partial']).default('all'),
});
export type RecipeListQueryInput = z.infer<typeof RecipeListQuery>;

export const RecipeListResponse = z.object({
  data: z.object({ can_edit_tenant: z.boolean(), coverage: CoverageWire, rows: z.array(RecipeSummaryWire) }),
});
export type RecipeListData = z.infer<typeof RecipeListResponse>['data'];

export const RecipeDetailQuery = z.object({ branch_id: Id.optional() });
export type RecipeDetailQueryInput = z.infer<typeof RecipeDetailQuery>;

export const RecipeDetailResponse = z.object({
  data: z.object({
    can_edit_tenant: z.boolean(),
    recipe: RecipeSummaryWire,
    draft: RecipeVersionWire.nullable(),
    published: RecipeVersionWire.nullable(),
    history: z.array(RecipeHistoryEntry).max(50),
  }),
});
export type RecipeDetailData = z.infer<typeof RecipeDetailResponse>['data'];

// ----------------------------------------------------------------------------------------------- §6.3 create

export const CreateRecipeBody = z.object({ owner_type: RecipeOwnerType, owner_id: Id });
export type CreateRecipeInput = z.infer<typeof CreateRecipeBody>;
export const CreateRecipeResponse = z.object({ data: z.object({ recipe: RecipeSummaryWire, draft: RecipeVersionWire }) });
export type RecipeCreated = z.infer<typeof CreateRecipeResponse>['data'];

// ----------------------------------------------------------------------------------------------- §6.4 draft

export const RecipeLineInput = z.object({
  stock_item_id: Id,
  unit_name: z.string(), // resolution (and normalisation) is the route's: unresolvable → 422 not_convertible (§3.3)
  qty: z
    .string()
    .regex(RECIPE_QTY_PATTERN)
    .refine((q) => !/^-?0+(\.0+)?$/.test(q), { message: 'qty must not be 0' }),
  qty_basis: QtyBasis.optional(), // derived at save when absent (B4, M-7)
});
export type RecipeLineInput = z.infer<typeof RecipeLineInput>;

// §3.3: ≤ 60 lines, each stock item once, ranges → 400; basis fit is the route's 422 (after the owner read)
export const SaveDraftBody = z
  .object({
    expected_version: Version.nullable(), // null = no draft exists; creates version max + 1
    base_qty: z.number().int().min(1).max(1_000_000).optional(),
    batch_yield_qty: z.number().int().min(1).max(1_000_000_000).optional(),
    misc_allowance_bp: z.number().int().min(0).max(5_000).optional(),
    lines: z.array(RecipeLineInput).max(RECIPE_MAX_LINES),
  })
  .refine((b) => new Set(b.lines.map((l) => l.stock_item_id)).size === b.lines.length, { message: 'a stock item once per recipe', path: ['lines'] });
export type SaveDraftInput = z.infer<typeof SaveDraftBody>;
export type SaveDraftRequest = z.input<typeof SaveDraftBody>;
export const SaveDraftResponse = z.object({ data: z.object({ draft: RecipeVersionWire }) });
export type DraftSaved = z.infer<typeof SaveDraftResponse>['data'];

// ----------------------------------------------------------------------------------------------- §6.5 publish

export const PublishRecipeBody = z.object({ expected_version: Version });
export type PublishRecipeInput = z.infer<typeof PublishRecipeBody>;
export const PublishRecipeResponse = z.object({ data: z.object({ published: RecipeVersionWire }) });
export type RecipePublished = z.infer<typeof PublishRecipeResponse>['data'];

// ----------------------------------------------------------------------------------------------- §6.6 archive / restore

export const PatchRecipeBody = z.object({ expected_version: Version, archived: z.boolean() });
export type PatchRecipeInput = z.infer<typeof PatchRecipeBody>;
// AD-17: §6.6 names no response body and its counts leave no room for a cost read, so the answer is the recipe's
// own state: id, archived, and its new recipe-level version.
export const PatchRecipeResponse = z.object({ data: z.object({ recipe: z.object({ recipe_id: z.string(), archived: z.boolean(), version: z.string() }) }) });
export type RecipePatched = z.infer<typeof PatchRecipeResponse>['data'];
