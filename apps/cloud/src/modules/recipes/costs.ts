import { buildCostInputs, recipeCost, roundMinor, stockItemUnitCost, type CloudCostRows, type CostInputs, type Fraction } from '@pos/domain';
import type { CostWire, RecipeWarningWire } from '@pos/events';
import { costVersionElement, type OwnerType, type StockUnit, type VersionRecord } from './repository.js';

// 08 v1.1 Part B §5.4, §6, B6, B9: costs of the recipes module's responses, from the cost context (5 reads,
// selectCostContext) through @pos/domain's engine — never computed here. One buildCostInputs per response: the
// caller adds the versions it costs that the context does not hold (a draft) plus one single-line pseudo version per
// line (`costingElements`), so a line's cost is the engine's own (yield, frozen unit, sub-recipe), never re-derived.

export const NO_RECIPE_COST: CostWire = Object.freeze({ status: 'no_recipe', minor: null, unknown_items: [] }) as CostWire;

// §5.4 CostWire (t-6): `minor` rounded once (half away from zero), null when nothing is known.
export function costWire(result: { value: Fraction; status: 'costed' | 'partial'; unknown: string[]; known: boolean }): CostWire {
  return { status: result.status, minor: result.known ? roundMinor(result.value).toString() : null, unknown_items: result.unknown };
}

const lineVersionId = (versionId: string, lineNo: number) => `${versionId}#line-${lineNo}`;

// The version (as CloudCostRows recipes elements) plus one pseudo version per line: same owner (so a stock-item
// owner's own id guards a cycle), basis per_unit and misc 0 (a line cost is never a top recipe, B5).
export function costingElements(version: VersionRecord, owner: { owner_type: OwnerType; owner_id: string }, inContext: boolean): Record<string, unknown>[] {
  const main = costVersionElement(version, owner.owner_type, owner.owner_id);
  const lines = version.lines.map((line, i) => ({
    ...main,
    recipe_version_id: lineVersionId(version.recipe_version_id, line.line_no),
    status: 'draft',
    basis: 'per_unit',
    base_qty: null,
    measure_unit: null,
    batch_yield_qty: null,
    batch_stock_unit: null,
    misc_allowance_bp: 0,
    lines: [(main.lines as unknown[])[i]],
  }));
  return inContext ? lines : [main, ...lines];
}

// AD-18: the context rows plus extra version elements, through the engine's element-wise parse.
export function costInputs(rows: CloudCostRows, extra: readonly Record<string, unknown>[]): CostInputs {
  return buildCostInputs({ ...rows, recipes: [...rows.recipes, ...extra] });
}

export interface VersionCosts {
  cost: CostWire;
  lineCosts: Map<number, CostWire>;
  warnings: RecipeWarningWire[];
}

// One version's cost (top recipe: misc applied, B5), each line's cost, and its B6 warnings (AD-15 codes).
// `ownerSaleUnit`: the owner menu item's sale_unit (n-4), null for other owners.
export function versionCosts(
  inputs: CostInputs,
  version: VersionRecord,
  ownerSaleUnit: StockUnit | null,
  branchId: string | null,
  nowMs: number,
): VersionCosts {
  // D9 / §3.2: only an option's empty recipe is a known 0 ("Spicy"); an empty menu-item or batch version (refused
  // at publish) has no cost yet — partial, no value, never "costed 0"
  const ownerType = inputs.versions.get(version.recipe_version_id)?.owner_type;
  const cost =
    version.lines.length === 0 && ownerType !== 'modifier_option'
      ? ({ status: 'partial', minor: null, unknown_items: [] } satisfies CostWire)
      : costWire(recipeCost(inputs, version.recipe_version_id, branchId, nowMs, { top: true }));
  const lineCosts = new Map<number, CostWire>();
  const warnings: RecipeWarningWire[] = [];
  for (const line of version.lines) {
    lineCosts.set(line.line_no, costWire(recipeCost(inputs, lineVersionId(version.recipe_version_id, line.line_no), branchId, nowMs, { top: false })));
    const item = inputs.items.get(line.stock_item_id);
    const hasYield = inputs.yields.has(line.stock_item_id);
    if (version.basis === 'per_batch' && line.qty_basis === 'EP') warnings.push({ code: 'ep_in_batch', line_no: line.line_no });
    // M-7 (n-4): an ingredient line costed as purchased because the item has no active yield
    if (version.basis !== 'per_batch' && item?.kind === 'ingredient' && line.qty_basis === 'AP' && !hasYield) {
      warnings.push({ code: 'no_yield_defaulted_ap', line_no: line.line_no });
    }
    if (item?.kind === 'ingredient' && line.qty_basis === 'EP' && !hasYield) warnings.push({ code: 'ep_no_yield', line_no: line.line_no });
    if (stockItemUnitCost(inputs, line.stock_item_id, branchId, nowMs) === null) warnings.push({ code: 'no_menu_cost', line_no: line.line_no });
  }
  if (mainLineOff(inputs, version, ownerSaleUnit)) warnings.push({ code: 'main_line_off' });
  return { cost, lineCosts, warnings };
}

// B6 main_line_off (R7 / m-11, n-4): a per_measure version whose AP ingredient lines in the owner's sale unit — the
// only ones checked — have none within ± 20 % of base_qty. No such line → nothing to compare, no warning.
function mainLineOff(inputs: CostInputs, version: VersionRecord, ownerSaleUnit: StockUnit | null): boolean {
  if (version.basis !== 'per_measure' || version.base_qty === null || ownerSaleUnit === null) return false;
  const base = BigInt(version.base_qty);
  const checked = version.lines.filter(
    (line) => line.qty_basis === 'AP' && line.stock_unit === ownerSaleUnit && inputs.items.get(line.stock_item_id)?.kind === 'ingredient',
  );
  if (checked.length === 0) return false;
  // 0.8 × base ≤ num / den ≤ 1.2 × base, in integers: 4 × base × den ≤ 5 × num ≤ 6 × base × den
  return !checked.some((line) => 4n * base * line.stock_qty_den <= 5n * line.stock_qty_num && 5n * line.stock_qty_num <= 6n * base * line.stock_qty_den);
}
