import { DomainError } from '@pos/domain';
import type { CostWire, RecipeDetailData, RecipeListData, RecipeListQueryInput, RecipeSummaryWire } from '@pos/events';
import { TenantLevelRepository } from '../../db/tenant-level-repository.js';
import type { TenantContext } from '../../db/tenant-scoped-repository.js';
import { coversEveryBranch } from '../../lib/config-version.js';
import { assertBranchAllowed } from '../restaurant/service.js';
import { costingElements, costInputs, ownerPlateCost, versionCosts } from './costs.js';
import {
  selectCostContext,
  selectDetailNames,
  selectDraftAndPublished,
  selectListedMenuItems,
  selectListedOptions,
  selectOwnerRow,
  selectRecipeState,
  selectRecipeStates,
  selectVersionHistory,
  type ListedOwner,
  type OwnerType,
  type RecipeState,
  type VersionRecord,
} from './repository.js';
import type { RecipeDeps } from './service.js';
import { toHistoryEntry, toListedSummaryWire, toRecipeVersionWire } from './versions.js';

// 08 v1.1 Part B §6.1 / §6.2: the recipe reads. Owner-level (a branch-limited owner reads, can_edit_tenant false);
// `branch_id?` C2-checked before any SQL (foreign → 404 BRANCH_NOT_FOUND); absent = every-branch prices only.
// Costs come from the cost context (5 reads, selectCostContext, 08a selectPriceCandidates at now; B12: the owner
// picks the branch) through @pos/domain's engine, rounded once. Fixed statement counts (no N+1).

export const LIST_ROUTE = 'GET /v1/admin/recipes';
export const DETAIL_ROUTE = 'GET /v1/admin/recipes/:recipe_id';

const KIND_ORDER: Record<OwnerType, number> = { menu_item: 0, modifier_option: 1, stock_item: 2 };
const codePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const ownerKey = (ownerType: string, ownerId: string) => `${ownerType}:${ownerId}`;

// §6.1 order: owner kind (menu items, options, stock items), then lower(name), then owner id (code points).
function compareOwners(a: ListedOwner, b: ListedOwner): number {
  return KIND_ORDER[a.owner_type] - KIND_ORDER[b.owner_type] || codePoint(a.name.toLowerCase(), b.name.toLowerCase()) || codePoint(a.owner_id, b.owner_id);
}

const passes = (filter: RecipeListQueryInput['filter'], cost: CostWire) =>
  filter === 'all' || (filter === 'missing' ? cost.status === 'no_recipe' : cost.status === 'partial');

// §6.1, 9 fixed statements: coversEveryBranch, menu items, plain options, recipes (all, with draft / published flags)
// + cost context 5 (its stock-items read is the prepared-owner list, archived prepared owners included, n-3).
// Rows: every active menu item (each variant), active plain option and active prepared stock item, with or without
// a recipe (AD-16), plus archived owners that have one. Coverage by count (B14): active menu items with a
// non-archived published recipe ÷ active menu items, over every row whatever the filter; pct_bp rounded down.
export async function listRecipes(deps: RecipeDeps, tenant: TenantContext, ownerUserId: string, query: RecipeListQueryInput): Promise<RecipeListData> {
  const branchId = query.branch_id ?? null;
  if (branchId !== null) assertBranchAllowed(tenant, branchId); // C2, before any SQL
  const level = new TenantLevelRepository(tenant, deps.pool);
  const canEditTenant = await coversEveryBranch(level, ownerUserId);
  const menuItems = await selectListedMenuItems(level);
  const options = await selectListedOptions(level);
  const states = await selectRecipeStates(level);
  const now = deps.clock.branchNow();
  const context = await selectCostContext(level, branchId, now);

  const stateByOwner = new Map(states.map((s) => [ownerKey(s.owner_type, s.owner_id), s]));
  const stockOwners: ListedOwner[] = context.stockItems
    .filter((s) => (s.kind === 'prepared' && s.archived_at === null) || stateByOwner.has(ownerKey('stock_item', s.stock_item_id)))
    .map((s) => ({ owner_type: 'stock_item', owner_id: s.stock_item_id, name: s.name, archived: s.archived_at !== null, sale_unit: null }));
  const owners = [...menuItems, ...options, ...stockOwners].sort(compareOwners);

  const inputs = costInputs(context.rows, []);
  const rows: RecipeSummaryWire[] = owners.map((o) =>
    toListedSummaryWire(o, stateByOwner.get(ownerKey(o.owner_type, o.owner_id)), ownerPlateCost(inputs, o, branchId, now)),
  );

  const active = menuItems.filter((m) => !m.archived);
  const covered = active.filter((m) => {
    const s = stateByOwner.get(ownerKey('menu_item', m.owner_id));
    return s !== undefined && s.archived_at === null && s.published !== null;
  }).length;
  return {
    can_edit_tenant: canEditTenant,
    coverage: { items_total: active.length, items_with_recipe: covered, pct_bp: active.length === 0 ? 0 : Math.floor((covered * 10_000) / active.length) },
    rows: rows.filter((r) => passes(query.filter, r.plate_cost)),
  };
}

// A version of this recipe as extra cost-context elements (costingElements: the version + one pseudo version per
// line). A published version of a non-archived recipe is already in the context (only its line pseudo versions are
// added); an archived recipe's is not, so it is added marked recipe_archived — kept by id, never in
// publishedByOwner (no other recipe is costed through it).
function detailElements(v: VersionRecord, recipe: RecipeState): Record<string, unknown>[] {
  const archived = recipe.archived_at !== null;
  const elements = costingElements(v, recipe, v.status === 'published' && !archived);
  return archived ? elements.map((e) => ({ ...e, recipe_archived: true })) : elements;
}

// §6.2, 11 fixed statements: coversEveryBranch, recipe (404 RECIPE_NOT_FOUND), owner row, versions (≤ 50), draft
// and published with lines (json_agg), owner names (= ANY; + the line stock items' names) + cost context 5.
export async function getRecipeDetail(
  deps: RecipeDeps,
  tenant: TenantContext,
  ownerUserId: string,
  recipeId: string,
  query: { branch_id?: string | undefined },
): Promise<RecipeDetailData> {
  const branchId = query.branch_id ?? null;
  if (branchId !== null) assertBranchAllowed(tenant, branchId); // C2, before any SQL
  const level = new TenantLevelRepository(tenant, deps.pool);
  const canEditTenant = await coversEveryBranch(level, ownerUserId);
  const recipe = await selectRecipeState(level, recipeId);
  if (recipe === undefined) throw new DomainError('RECIPE_NOT_FOUND', { recipe_id: recipeId });
  const owner = await selectOwnerRow(level, recipe.owner_type, recipe.owner_id);
  if (owner === undefined) throw new DomainError('RECIPE_NOT_FOUND', { recipe_id: recipeId }); // owners are never deleted; defensive
  const history = await selectVersionHistory(level, recipeId);
  const { draft, published } = await selectDraftAndPublished(level, recipeId);
  const versions = [draft, published].filter((v): v is VersionRecord => v !== null);
  const names = await selectDetailNames(
    level,
    [...versions.flatMap((v) => [v.created_by, v.published_by]), ...history.map((h) => h.published_by)].filter((id): id is string => id !== null),
    versions.flatMap((v) => v.lines.map((l) => l.stock_item_id)),
  );
  const now = deps.clock.branchNow();
  const context = await selectCostContext(level, branchId, now);

  const inputs = costInputs(
    context.rows,
    versions.flatMap((v) => detailElements(v, recipe)),
  );
  const wire = (v: VersionRecord | null) =>
    v === null ? null : toRecipeVersionWire(v, versionCosts(inputs, v, owner.sale_unit, branchId, now), names.users, names.stockItems);
  return {
    can_edit_tenant: canEditTenant,
    recipe: toListedSummaryWire(owner, recipe, ownerPlateCost(inputs, owner, branchId, now)),
    draft: wire(draft),
    published: wire(published),
    history: history.map((h) => toHistoryEntry(h, names.users)),
  };
}
