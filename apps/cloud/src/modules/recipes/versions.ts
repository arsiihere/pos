import { canonicalJson, sha256hex } from '@pos/domain/hash';
import type { CostWire, RecipeHistoryEntry, RecipeSummaryWire, RecipeVersionWire } from '@pos/events';
import type { VersionCosts } from './costs.js';
import type { HistoryRecord, LineRecord, ListedOwner, OwnerType, RecipeRecord, RecipeState, StockItemRow, VersionRecord } from './repository.js';

// 08 v1.1 Part B §5.4 (+ AD-16), 01c V13 (as menu-variants/versions.ts): the only place that builds a recipe summary
// or version wire and its `version`. A version input has fixed keys, every BIGINT as a decimal string, nullable
// values null; lines in line_no order. The hash covers the stored content, so a stale tab is told by
// expected_version (409 CONFIG_STALE).

function hash(input: unknown): string {
  return sha256hex(canonicalJson(input));
}

// AD-16: the recipe-level version (§6.6 PATCH expected_version).
export function recipeVersion(recipe: Pick<RecipeRecord, 'recipe_id' | 'owner_type' | 'owner_id' | 'archived_at'>): string {
  return hash({ recipe_id: recipe.recipe_id, owner_type: recipe.owner_type, owner_id: recipe.owner_id, archived: recipe.archived_at !== null });
}

// V13: a recipe version's version (the §6.4 / §6.5 expected_version).
export function versionVersion(v: VersionRecord): string {
  return hash(versionAudit(v));
}

// The stored content of a version as plain JSON (no bigint): the version input and the audit before / after.
export function versionAudit(v: VersionRecord): Record<string, unknown> {
  return {
    recipe_version_id: v.recipe_version_id,
    recipe_id: v.recipe_id,
    version_no: v.version_no,
    status: v.status,
    basis: v.basis,
    base_qty: v.base_qty,
    measure_unit: v.measure_unit,
    batch_yield_qty: v.batch_yield_qty === null ? null : v.batch_yield_qty.toString(),
    batch_stock_unit: v.batch_stock_unit,
    misc_allowance_bp: v.misc_allowance_bp,
    created_by: v.created_by,
    published_by: v.published_by,
    published_at: v.published_at,
    lines: v.lines.map((l) => ({
      line_no: l.line_no,
      stock_item_id: l.stock_item_id,
      unit_name: l.unit_name,
      qty: enteredDecimal(l),
      qty_basis: l.qty_basis,
      stock_qty_num: l.stock_qty_num.toString(),
      stock_qty_den: l.stock_qty_den.toString(),
      stock_unit: l.stock_unit,
    })),
  };
}

// B4: the entered quantity back as the decimal the owner typed (≤ 4 places; the stored fraction is reduced, so its
// den divides 10^4).
export function enteredDecimal(line: Pick<LineRecord, 'entered_num' | 'entered_den'>): string {
  const scale = 10_000n;
  const negative = line.entered_num < 0n;
  const n = ((negative ? -line.entered_num : line.entered_num) * scale) / line.entered_den;
  const whole = (n / scale).toString();
  const frac = (n % scale).toString().padStart(4, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${frac === '' ? '' : `.${frac}`}`;
}

export function recipeAudit(recipe: Pick<RecipeRecord, 'recipe_id' | 'owner_type' | 'owner_id' | 'archived_at'>): Record<string, unknown> {
  return { recipe_id: recipe.recipe_id, owner_type: recipe.owner_type, owner_id: recipe.owner_id, archived_at: recipe.archived_at };
}

export function toRecipeSummaryWire(
  recipe: Pick<RecipeRecord, 'recipe_id' | 'owner_type' | 'owner_id' | 'archived_at'>,
  owner: { name: string; archived: boolean },
  state: { has_draft: boolean; published: { recipe_version_id: string; version_no: number; published_at: number } | null },
  plateCost: CostWire,
): RecipeSummaryWire {
  return {
    recipe_id: recipe.recipe_id,
    owner_type: recipe.owner_type as OwnerType,
    owner_id: recipe.owner_id,
    owner_name: owner.name,
    owner_archived: owner.archived,
    archived: recipe.archived_at !== null,
    has_draft: state.has_draft,
    published: state.published,
    plate_cost: plateCost,
    version: recipeVersion(recipe),
  };
}

// §5.4 RecipeVersionWire. `stockItems`: name and kind of each line's stock item (the locked rows on a write).
export function toRecipeVersionWire(
  v: VersionRecord,
  costs: VersionCosts,
  names: ReadonlyMap<string, string>,
  stockItems: ReadonlyMap<string, Pick<StockItemRow, 'name' | 'kind'>>,
): RecipeVersionWire {
  return {
    recipe_version_id: v.recipe_version_id,
    version_no: v.version_no,
    status: v.status,
    basis: v.basis,
    base_qty: v.base_qty,
    measure_unit: v.measure_unit,
    batch_yield_qty: v.batch_yield_qty === null ? null : v.batch_yield_qty.toString(),
    batch_stock_unit: v.batch_stock_unit,
    misc_allowance_bp: v.misc_allowance_bp,
    lines: v.lines.map((l) => ({
      line_no: l.line_no,
      stock_item_id: l.stock_item_id,
      stock_item_name: stockItems.get(l.stock_item_id)?.name ?? '',
      kind: stockItems.get(l.stock_item_id)?.kind ?? '',
      unit_name: l.unit_name,
      qty: enteredDecimal(l),
      qty_basis: l.qty_basis,
      line_cost: costs.lineCosts.get(l.line_no) ?? { status: 'partial', minor: null, unknown_items: [l.stock_item_id] },
    })),
    cost: costs.cost,
    warnings: costs.warnings,
    created_by_name: names.get(v.created_by) ?? '',
    published_by_name: v.published_by === null ? null : (names.get(v.published_by) ?? ''),
    published_at: v.published_at,
    version: versionVersion(v),
  };
}

// ============================================================================================ §6.1 / §6.2 reads (r4)

// §6.1 / §6.2 row: an owner with its recipe (toRecipeSummaryWire), or without one (AD-16: recipe_id / version null).
export function toListedSummaryWire(owner: ListedOwner, state: RecipeState | undefined, plateCost: CostWire): RecipeSummaryWire {
  if (state !== undefined) {
    return toRecipeSummaryWire(state, { name: owner.name, archived: owner.archived }, { has_draft: state.has_draft, published: state.published }, plateCost);
  }
  return {
    recipe_id: null,
    owner_type: owner.owner_type,
    owner_id: owner.owner_id,
    owner_name: owner.name,
    owner_archived: owner.archived,
    archived: false,
    has_draft: false,
    published: null,
    plate_cost: plateCost,
    version: null,
  };
}

// §6.2 history entry.
export function toHistoryEntry(h: HistoryRecord, names: ReadonlyMap<string, string>): RecipeHistoryEntry {
  return {
    recipe_version_id: h.recipe_version_id,
    version_no: h.version_no,
    status: h.status,
    published_at: h.published_at,
    published_by_name: h.published_by === null ? null : (names.get(h.published_by) ?? ''),
  };
}
