import type { CostWire, CoverageWire, StockUnit } from '../../../api/cloud-admin';
import { en, fill } from '../../../i18n/en';
import { t, type MessageKey } from '../../../i18n';
import { rupeesText } from '../stock-items/inventory';
import { unitWord } from '../stock-items/stock';

// 08 v1.1 Part B §8: the Recipes page's and editor's pure texts and the editor's live cost. Exact integers only
// (bigint fractions), rounded once at the edge, half away from zero (B9). Labels per 08a I12: "Menu cost",
// "Plate cost (menu cost)"; never "today's cost".

export function recipeHref(recipeId: string): string {
  return `#/recipes/${encodeURIComponent(recipeId)}`;
}

// "Rs 412" (a known 0 is a real cost: "Rs 0"); a negative cost (a removal option) keeps its sign.
function rs(minor: string): string {
  return fill(t('recipes.cost_rs'), { amount: minor.startsWith('-') ? `-${rupeesText(minor.slice(1))}` : rupeesText(minor) });
}

// §8.1 Plate cost (menu cost): "Rs 412", "Rs 380 · partial", "No cost yet · partial" (minor null, t-6), "No recipe".
// Never "Rs 0" for a missing cost (D9).
export function costText(cost: Pick<CostWire, 'status' | 'minor'>): string {
  if (cost.status === 'no_recipe') return t('recipes.no_recipe');
  if (cost.minor === null) return t(cost.status === 'partial' ? 'recipes.cost_none_partial' : 'recipes.cost_none');
  return cost.status === 'partial' ? fill(t('recipes.cost_partial'), { cost: rs(cost.minor) }) : rs(cost.minor);
}

// A line's cost: unknown reads "No cost yet" (the plate cost carries the "partial").
export function lineCostText(cost: Pick<CostWire, 'status' | 'minor'>): string {
  return cost.minor === null ? t('recipes.cost_none') : rs(cost.minor);
}

// "38 of 52 items have a recipe — 73 %" (pct_bp / 100, whole percent, rounded half up).
export function coverageText(c: CoverageWire): string {
  return fill(t('recipes.coverage'), {
    n: String(c.items_with_recipe),
    m: String(c.items_total),
    pct: String(Math.floor((c.pct_bp + 50) / 100)),
  });
}

// B3 / T-2: a per_measure recipe reads "per kg" / "per litre" from its measure unit; another base_qty "per 500 g".
export function measureText(measureUnit: 'g' | 'ml' | null, baseQty: number | null): string {
  const unit = measureUnit ?? 'g';
  if (baseQty === null || baseQty === 1000) return t(unit === 'g' ? 'recipe.per_kg' : 'recipe.per_litre');
  return fill(t('recipe.per_base'), { qty: String(baseQty), unit: t(`stock_unit.${unit}`) });
}

// §8.2: "makes 160 piece" — the batch yield in the owner's stock unit (frozen as batch_stock_unit).
export function makesText(qty: string, unit: StockUnit): string {
  return fill(t('recipe.makes'), { qty, unit: t(`stock_unit.${unit}`) });
}

export { unitWord };

// §6.4 / §6.5 / §6.6 refusals (§3.3): one owner text per reason; an unknown reason → the generic reference text.
export function reasonText(reason: unknown): string {
  const key = `recipe.reason.${String(reason)}`;
  return typeof reason === 'string' && Object.hasOwn(en, key) ? t(key as MessageKey) : t('errors.CONFIG_REFERENCE_INVALID');
}

// §6.6 restore refusal (N-1, T-1): the reason inside "This old version can't come back: …" — basis_mismatch and
// unit_changed have their own wording (no "Save the draft again"); the rest as reasonText.
export function restoreReasonText(reason: unknown): string {
  if (reason === 'basis_mismatch') return t('recipes.restore_reason.basis_mismatch');
  if (reason === 'unit_changed') return t('recipes.restore_reason.unit_changed');
  return reasonText(reason);
}

// The refusal mappings and the live cost (pure, i18n-free; the cloud contract test imports the same modules).
export * from './refusals';
export * from './live-cost';
