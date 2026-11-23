import { buildCostInputs, DomainError, resolveUnit, type Unit } from '@pos/domain';
import type { CreateRecipeInput, DraftSaved, RecipeCreated, SaveDraftInput } from '@pos/events';
import type pg from 'pg';
import { TenantLevelRepository } from '../../db/tenant-level-repository.js';
import type { Clock } from '../../lib/clock.js';
import { assertTenantWide } from '../../lib/config-version.js';
import type { IdGen } from '../../lib/ids.js';
import { inTransaction, withIdempotency, type IdempotentResult } from '../../lib/idempotency.js';
import type { CloudTestHooks } from '../../server.js';
import { assertBranchAllowed, type OwnerRequest } from '../restaurant/service.js';
import { costingElements, costInputs, NO_RECIPE_COST, versionCosts } from './costs.js';
import {
  deleteDraftLines,
  insertFirstDraft,
  insertLines,
  insertRecipe,
  insertRecipeAudit,
  lockRecipe,
  selectActiveYieldsOf,
  selectCostContext,
  selectDraft,
  selectNamesWithOwner,
  selectRecipeIdByOwner,
  selectUnitsOf,
  shareMenuItemOwner,
  shareOptionOwner,
  shareStockItems,
  upsertDraft,
  type Basis,
  type LineRecord,
  type OwnerType,
  type RecipeOwner,
  type RecipeRecord,
  type StockItemRow,
  type StockUnit,
  type VersionRecord,
} from './repository.js';
import { recipeAudit, toRecipeSummaryWire, toRecipeVersionWire, versionAudit, versionVersion } from './versions.js';

// 08 v1.1 Part B §6: owner routes, tenant-wide (assertTenantWide; one owner covers every branch, 01b B8, 08a I10).
// Writes are one transaction each, audited (one row per entity, one insert), lock order kinds 0 → 0.5 → 1 → 4 → 5
// → 10 (§6). Costs come from the cost context (5 reads) and @pos/domain's engine.

export interface RecipeDeps {
  pool: pg.Pool;
  clock: Clock;
  ids: IdGen;
  testHooks?: CloudTestHooks;
}

export const CREATE_ROUTE = 'POST /v1/admin/recipes';
export const DRAFT_ROUTE = 'PUT /v1/admin/recipes/:recipe_id/draft';

export const MISC_ALLOWANCE_DEFAULT_BP = 500; // B5
export const PER_MEASURE_BASE_DEFAULT = 1000; // B3: per kg / per litre at create (f-4)
const STOCK_QTY_MAX = 10n ** 15n; // B4 (m-8)

const refused = (field: string, reason: string) => new DomainError('CONFIG_REFERENCE_INVALID', { field, reason });

// ---------------------------------------------------------------------------------------------- owners

// §6 kinds 1 / 4 / 5: the owner row FOR SHARE (an option under its group). undefined = not in the tenant.
async function shareOwner(db: TenantLevelRepository, ownerType: OwnerType, ownerId: string): Promise<RecipeOwner | undefined> {
  if (ownerType === 'menu_item') return shareMenuItemOwner(db, ownerId);
  if (ownerType === 'modifier_option') return shareOptionOwner(db, ownerId);
  const item = (await shareStockItems(db, [ownerId])).get(ownerId);
  return item === undefined ? undefined : { owner_type: 'stock_item', owner_id: ownerId, ...item };
}

interface DerivedBasis {
  basis: Basis;
  measure_unit: 'g' | 'ml' | null;
  stock_unit: StockUnit | null; // a stock-item owner's stock_unit (batch_stock_unit when a batch yield is set)
}

// B3 (T-1, T-2): basis, measure_unit and batch_stock_unit follow the locked owner row.
function deriveBasis(owner: RecipeOwner): DerivedBasis {
  if (owner.owner_type === 'menu_item') {
    return owner.sale_unit === 'piece' ? { basis: 'per_unit', measure_unit: null, stock_unit: null } : { basis: 'per_measure', measure_unit: owner.sale_unit, stock_unit: null };
  }
  if (owner.owner_type === 'modifier_option') return { basis: 'per_unit', measure_unit: null, stock_unit: null };
  return { basis: 'per_batch', measure_unit: null, stock_unit: owner.stock_unit };
}

const ownerSummary = (owner: RecipeOwner) => ({ name: owner.name, archived: owner.archived_at !== null });

// ---------------------------------------------------------------------------------------------- §6.3 create

type CreateOutcome = RecipeCreated | { error: { code: 'CONFIG_IN_USE'; message: 'CONFIG_IN_USE'; details: Record<string, unknown> } };

// §6.3, 8 statements: key → tenant-wide (403) → owner FOR SHARE (kind 1 group for an option, 4, or 5) → B2 (422
// not_found / linked_option / wrong_kind) → INSERT recipes … ON CONFLICT DO NOTHING RETURNING → draft v1 (basis,
// base_qty 1 000 and measure_unit from the owner row, B3, f-4; no lines) → audit recipe / create + recipe_version /
// create (one insert) → key response → prune. Conflict path, 7 (t-2): the insert returns 0 rows → the existing id
// is read → 409 CONFIG_IN_USE stored as the key response (no draft, no audit). No bump (B16).
export async function createRecipe(deps: RecipeDeps, req: OwnerRequest, body: CreateRecipeInput): Promise<IdempotentResult<CreateOutcome>> {
  return withIdempotency<CreateOutcome>(
    { pool: deps.pool, clock: deps.clock, tenant: req.tenant, log: req.log, ...(deps.testHooks !== undefined ? { testHooks: deps.testHooks } : {}) },
    { key: req.idempotencyKey, method: req.method, path: req.path, body },
    async (client) => {
      const level = new TenantLevelRepository(req.tenant, client);
      await assertTenantWide(level, req.ownerUserId);
      const owner = await shareOwner(level, body.owner_type, body.owner_id);
      if (owner === undefined) throw refused('owner_id', 'not_found');
      if (owner.owner_type === 'modifier_option' && owner.linked_item_id !== null) throw refused('owner_id', 'linked_option'); // B2
      if (owner.owner_type === 'stock_item' && owner.kind !== 'prepared') throw refused('owner_id', 'wrong_kind'); // B2, R7

      const now = deps.clock.branchNow();
      const recipeId = await insertRecipe(level, { recipe_id: deps.ids.next(), owner_type: body.owner_type, owner_id: body.owner_id, now });
      if (recipeId === null) {
        const existing = await selectRecipeIdByOwner(level, body.owner_type, body.owner_id);
        return {
          status: 409,
          body: { error: { code: 'CONFIG_IN_USE', message: 'CONFIG_IN_USE', details: { used_by: { entity: 'recipe', ids: [existing] } } } },
        };
      }
      const derived = deriveBasis(owner);
      const { version, createdByName } = await insertFirstDraft(level, {
        recipe_version_id: deps.ids.next(),
        recipe_id: recipeId,
        basis: derived.basis,
        base_qty: derived.basis === 'per_measure' ? PER_MEASURE_BASE_DEFAULT : null,
        batch_yield_qty: null, // set by a draft save (B3); batch_stock_unit is frozen with it
        batch_stock_unit: null,
        measure_unit: derived.measure_unit,
        misc_allowance_bp: MISC_ALLOWANCE_DEFAULT_BP,
        created_by: req.ownerUserId,
        now,
      });
      const recipe: RecipeRecord = { recipe_id: recipeId, owner_type: body.owner_type, owner_id: body.owner_id, archived_at: null };
      await insertRecipeAudit(
        level,
        req.ownerUserId,
        [
          { entity: 'recipe', entityId: recipeId, action: 'create', before: null, after: recipeAudit(recipe) },
          { entity: 'recipe_version', entityId: version.recipe_version_id, action: 'create', before: null, after: versionAudit(version) },
        ],
        deps,
      );
      // no cost context on create (8 statements): the new draft has no lines, so the engine needs no other row (an
      // empty option recipe is costed 0, t-6; any other empty version is partial with no value, versionCosts)
      const inputs = buildCostInputs({ source: 'cloud', items: [], units: [], prices: [], yields: [], recipes: costingElements(version, recipe, false) });
      const costs = versionCosts(inputs, version, owner.owner_type === 'menu_item' ? owner.sale_unit : null, null, now);
      return {
        status: 201,
        body: {
          recipe: toRecipeSummaryWire(recipe, ownerSummary(owner), { has_draft: true, published: null }, NO_RECIPE_COST),
          draft: toRecipeVersionWire(version, costs, new Map([[version.created_by, createdByName]]), new Map()),
        },
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------- §6.4 draft

// B4: "-12.5" → { num: -25, den: 2 } (the pattern is the body schema's), reduced.
function parseDecimal(qty: string): { num: bigint; den: bigint } {
  const negative = qty.startsWith('-');
  const [whole, frac = ''] = (negative ? qty.slice(1) : qty).split('.');
  const num = BigInt(`${whole}${frac}`) * (negative ? -1n : 1n);
  return reduceSigned(num, 10n ** BigInt(frac.length));
}

function reduceSigned(num: bigint, den: bigint): { num: bigint; den: bigint } {
  let a = num < 0n ? -num : num;
  let b = den;
  while (b !== 0n) [a, b] = [b, a % b];
  return { num: num / a, den: den / a };
}

// §6.4. 17 statements (16 for a stock-item owner, T-1 / t-4): validate (400, the body schema) → BEGIN → tenant-wide
// (403) → recipe FOR UPDATE (kind 0.5; 404; an archived recipe is accepted, T-1) → afterRecipeLock → draft read
// (409 CONFIG_STALE) → the owner row FOR SHARE (kind 1 group for an option, kind 4 for a menu item) → the owner (if
// a stock item) + the line stock items FOR SHARE (kind 5, one = ANY, id order; 422 not_found / archived) → basis,
// measure_unit, batch_stock_unit from the locked owner (B3) → basis / negative checks (422) → their item units →
// their active yields (M-7) → resolveUnit on the locked stock_unit, freeze, |num| ≤ 10^15 (422) → upsert draft →
// delete draft lines → insert lines (one statement) → audit recipe_version / create | update → response: names
// joined with the owner row (sale_unit, n-4) + cost context 5 → COMMIT. No bump (B16).
export async function saveDraft(
  deps: RecipeDeps,
  req: OwnerRequest,
  recipeId: string,
  body: SaveDraftInput,
  query: { branch_id?: string | undefined },
): Promise<DraftSaved> {
  const branchId = query.branch_id ?? null;
  if (branchId !== null) assertBranchAllowed(req.tenant, branchId); // C2, before any SQL
  return inTransaction(deps.pool, async (client) => {
    const level = new TenantLevelRepository(req.tenant, client);
    await assertTenantWide(level, req.ownerUserId);
    const recipe = await lockRecipe(level, recipeId);
    await deps.testHooks?.afterRecipeLock?.(DRAFT_ROUTE); // §10.4: right after the recipe lock, every path that reaches it
    if (recipe === undefined) throw new DomainError('RECIPE_NOT_FOUND', { recipe_id: recipeId });
    const before = await selectDraft(level, recipeId);
    const stale = body.expected_version === null ? before !== undefined : before === undefined || versionVersion(before) !== body.expected_version;
    if (stale) {
      throw new DomainError('CONFIG_STALE', before === undefined ? { entity: 'recipe', id: recipeId } : { entity: 'recipe_version', id: before.recipe_version_id });
    }

    // t-4 / T-1: the owner row before the line stock items (kind 1 / 4 → 5); a stock-item owner is read with them
    const lineIds = body.lines.map((l) => l.stock_item_id);
    let owner: RecipeOwner | undefined;
    let stock: Map<string, StockItemRow>;
    if (recipe.owner_type === 'stock_item') {
      stock = await shareStockItems(level, [recipe.owner_id, ...lineIds]);
      const item = stock.get(recipe.owner_id);
      owner = item === undefined ? undefined : { owner_type: 'stock_item', owner_id: recipe.owner_id, ...item };
    } else {
      owner = recipe.owner_type === 'menu_item' ? await shareMenuItemOwner(level, recipe.owner_id) : await shareOptionOwner(level, recipe.owner_id);
      stock = await shareStockItems(level, lineIds);
    }
    if (owner === undefined) throw refused('owner_id', 'not_found'); // owners are never deleted; defensive
    body.lines.forEach((line, i) => {
      const item = stock.get(line.stock_item_id);
      if (item === undefined) throw refused(`lines.${i}.stock_item_id`, 'not_found');
      if (item.archived_at !== null) throw refused(`lines.${i}.stock_item_id`, 'archived');
    });

    // B3 from the locked owner; §3.3 n-1: a field the basis does not take, or one it needs and lacks → 422
    const derived = deriveBasis(owner);
    if (body.base_qty !== undefined && derived.basis !== 'per_measure') throw refused('base_qty', 'basis_mismatch');
    if (body.base_qty === undefined && derived.basis === 'per_measure') throw refused('base_qty', 'basis_mismatch');
    if (body.batch_yield_qty !== undefined && derived.basis !== 'per_batch') throw refused('batch_yield_qty', 'basis_mismatch');
    if (recipe.owner_type !== 'modifier_option') {
      body.lines.forEach((line, i) => {
        if (line.qty.startsWith('-')) throw refused(`lines.${i}.qty`, 'negative_not_option'); // B4 (m-7)
      });
    }

    const units = await selectUnitsOf(level, lineIds);
    const yields = await selectActiveYieldsOf(level, lineIds);
    const lines: LineRecord[] = body.lines.map((line, i) => {
      const item = stock.get(line.stock_item_id)!;
      const conversion = resolveUnit(
        { stock_unit: item.stock_unit as Unit },
        line.unit_name,
        units.filter((u) => u.stock_item_id === line.stock_item_id),
      );
      if (conversion === null) throw refused(`lines.${i}.unit_name`, 'not_convertible');
      const entered = parseDecimal(line.qty);
      const frozen = reduceSigned(entered.num * conversion.num, entered.den * conversion.den);
      if ((frozen.num < 0n ? -frozen.num : frozen.num) > STOCK_QTY_MAX) throw refused(`lines.${i}.qty`, 'qty_out_of_range');
      return {
        line_no: i + 1,
        stock_item_id: line.stock_item_id,
        unit_name: line.unit_name.trim().toLowerCase(), // 08a I3: stored normalised
        entered_num: entered.num,
        entered_den: entered.den,
        stock_qty_num: frozen.num,
        stock_qty_den: frozen.den,
        stock_unit: item.stock_unit,
        qty_basis: line.qty_basis ?? defaultQtyBasis(derived.basis, item, yields),
      };
    });

    const now = deps.clock.branchNow();
    const batchYield = body.batch_yield_qty === undefined ? null : BigInt(body.batch_yield_qty);
    const stored = await upsertDraft(level, before, {
      recipe_version_id: deps.ids.next(),
      recipe_id: recipeId,
      basis: derived.basis,
      base_qty: body.base_qty ?? null,
      batch_yield_qty: batchYield,
      batch_stock_unit: batchYield === null ? null : derived.stock_unit, // T-2 / N-1: frozen with the yield
      measure_unit: derived.measure_unit,
      misc_allowance_bp: body.misc_allowance_bp ?? MISC_ALLOWANCE_DEFAULT_BP,
      created_by: req.ownerUserId,
      now,
    });
    await deleteDraftLines(level, stored.recipe_version_id);
    await insertLines(level, stored.recipe_version_id, lines);
    const draft: VersionRecord = { ...stored, lines };
    await insertRecipeAudit(
      level,
      req.ownerUserId,
      [
        {
          entity: 'recipe_version',
          entityId: draft.recipe_version_id,
          action: before === undefined ? 'create' : 'update',
          before: before === undefined ? null : versionAudit(before),
          after: versionAudit(draft),
        },
      ],
      deps,
    );

    // response: 6 statements (names + owner sale_unit, cost context 5)
    const { names, saleUnit } = await selectNamesWithOwner(level, [draft.created_by], recipe);
    const context = await selectCostContext(level, branchId, now);
    const inputs = costInputs(context.rows, costingElements(draft, recipe, false));
    const costs = versionCosts(inputs, draft, saleUnit, branchId, now);
    return { draft: toRecipeVersionWire(draft, costs, names, stock) };
  });
}

// B4 / M-7 on the locked data: per_batch → AP (D7); per_unit / per_measure → an ingredient with an active yield EP,
// without one AP (warning no_yield_defaulted_ap); packet / prepared lines AP (no yield applies).
function defaultQtyBasis(basis: Basis, item: StockItemRow, yields: ReadonlyMap<string, number>): 'AP' | 'EP' {
  if (basis === 'per_batch') return 'AP';
  return item.kind === 'ingredient' && yields.has(item.stock_item_id) ? 'EP' : 'AP';
}
