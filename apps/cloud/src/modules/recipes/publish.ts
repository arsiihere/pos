import { DomainError } from '@pos/domain';
import type { PublishRecipeInput, RecipePublished } from '@pos/events';
import { TenantLevelRepository } from '../../db/tenant-level-repository.js';
import { assertTenantWide, bumpEveryBranch } from '../../lib/config-version.js';
import { inTransaction } from '../../lib/idempotency.js';
import { assertBranchAllowed, type OwnerRequest } from '../restaurant/service.js';
import { costingElements, costInputs, versionCosts } from './costs.js';
import {
  costVersionElement,
  insertRecipeAudit,
  lockRecipe,
  publishDraft,
  selectCostContext,
  selectNamesWithOwner,
  selectPublishGraph,
  selectPublishVersions,
  shareMenuItemOwner,
  shareOptionOwner,
  shareStockItems,
  supersedeVersion,
  takePublishLock,
  unarchiveRecipe,
  type RecipeAuditRow,
  type RecipeOwner,
  type StockItemRow,
  type VersionRecord,
} from './repository.js';
import { deriveBasis, type RecipeDeps } from './service.js';
import { recipeAudit, toRecipeVersionWire, versionAudit, versionVersion } from './versions.js';

// 08 v1.1 Part B §6.5 (r2): POST /v1/admin/recipes/:recipe_id/publish — the publish lock (kind 0) first, every B6
// check on the locked current owner and lines, the whole-graph cycle / depth check (B-1, M-3, n-5), an archived
// recipe's draft publishes and un-archives it (T-1), bump every branch (B16).

export const PUBLISH_ROUTE = 'POST /v1/admin/recipes/:recipe_id/publish';

const MAX_PREPARED_DEPTH = 3; // B6: no chain of prepared recipes longer than 3 levels, anywhere in the graph

const refused = (field: string, reason: string) => new DomainError('CONFIG_REFERENCE_INVALID', { field, reason });

// §6.5. Statements (exact): write = tenant-wide, publish lock (kind 0), recipe FOR UPDATE (0.5), draft + published
// with lines, owner row FOR SHARE (kind 1 group + option / 4; none for a stock-item owner, read with the lines),
// stock items FOR SHARE (kind 5, one = ANY, id order), graph read, [supersede], publish, [un-archive], audit (one
// insert), bump 2 (kind 10, last); response = owner names (+ the owner's sale_unit) + cost context reads 1–4 (its
// read 5 is the graph read, with this publish applied) → 17 / 16 (stock-item owner); 16 / 15 with no published
// version; +1 when the recipe was archived (18 / 17 / 17 / 16).
export async function publishRecipe(
  deps: RecipeDeps,
  req: OwnerRequest,
  recipeId: string,
  body: PublishRecipeInput,
  query: { branch_id?: string | undefined },
): Promise<RecipePublished> {
  const branchId = query.branch_id ?? null;
  if (branchId !== null) assertBranchAllowed(req.tenant, branchId); // C2, before any SQL
  return inTransaction(deps.pool, async (client) => {
    const level = new TenantLevelRepository(req.tenant, client);
    await assertTenantWide(level, req.ownerUserId);
    await takePublishLock(level); // kind 0, before every row lock and the graph read
    await deps.testHooks?.afterPublishLock?.(PUBLISH_ROUTE);
    const recipe = await lockRecipe(level, recipeId); // kind 0.5; an archived recipe is accepted (T-1)
    if (recipe === undefined) throw new DomainError('RECIPE_NOT_FOUND', { recipe_id: recipeId });
    const { draft, published: previous } = await selectPublishVersions(level, recipeId);
    if (draft === undefined) throw new DomainError('CONFIG_STALE', { entity: 'recipe', id: recipeId });
    if (versionVersion(draft) !== body.expected_version) throw new DomainError('CONFIG_STALE', { entity: 'recipe_version', id: draft.recipe_version_id });

    // kinds 1 / 4 → 5: the owner row, then the owner (if a stock item) + the line stock items in one statement
    const lineIds = draft.lines.map((l) => l.stock_item_id);
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
    checkVersion(draft, owner, stock); // owner / line B6 checks before the graph read: a refusal saves a statement; success counts as §6.5

    // B6 graph (B-1, M-3): the tenant's non-archived published graph with this version in place of the owner's
    // published one — placed in whether the recipe was archived or not
    const graph = (await selectPublishGraph(level)).filter((g) => g.version.recipe_id !== recipeId);
    const shape = graphShape([
      ...graph.map((g) => ({ owner_type: g.owner_type, owner_id: g.owner_id, lines: g.version.lines.map((l) => ({ id: l.stock_item_id, kind: g.lineKinds.get(l.stock_item_id) ?? null })) })),
      { owner_type: recipe.owner_type, owner_id: recipe.owner_id, lines: draft.lines.map((l) => ({ id: l.stock_item_id, kind: stock.get(l.stock_item_id)?.kind ?? null })) },
    ]);
    if (shape !== null) throw refused('lines', shape);

    const now = deps.clock.branchNow();
    if (previous !== undefined) await supersedeVersion(level, previous.recipe_version_id); // before: one published per recipe
    const live = await publishDraft(level, draft, req.ownerUserId, now);
    const wasArchived = recipe.archived_at !== null;
    if (wasArchived) await unarchiveRecipe(level, recipeId, now); // T-1
    const audit: RecipeAuditRow[] = [{ entity: 'recipe_version', entityId: live.recipe_version_id, action: 'publish', before: versionAudit(draft), after: versionAudit(live) }];
    if (previous !== undefined) {
      audit.push({
        entity: 'recipe_version',
        entityId: previous.recipe_version_id,
        action: 'update',
        before: versionAudit(previous),
        after: versionAudit({ ...previous, status: 'superseded' }),
      });
    }
    if (wasArchived) audit.push({ entity: 'recipe', entityId: recipeId, action: 'restore', before: recipeAudit(recipe), after: recipeAudit({ ...recipe, archived_at: null }) });
    await insertRecipeAudit(level, req.ownerUserId, audit, deps);
    await bumpEveryBranch(level); // B16: kind 10, the last lock

    // response: names + owner sale_unit (1), cost context reads 1–4; read 5 = the graph read with this publish applied
    const { names, saleUnit } = await selectNamesWithOwner(level, [live.created_by, req.ownerUserId], recipe);
    const elements = [...graph.map((g) => costVersionElement(g.version, g.owner_type, g.owner_id)), costVersionElement(live, recipe.owner_type, recipe.owner_id)];
    const context = await selectCostContext(level, branchId, now, elements);
    const inputs = costInputs(context.rows, costingElements(live, recipe, true));
    const costs = versionCosts(inputs, live, saleUnit, branchId, now);
    return { published: toRecipeVersionWire(live, costs, names, stock) };
  });
}

// B6 on the locked current rows (T-1, T-2, N-1), in this order: owner kind (linked_option / wrong_kind), basis and
// measure_unit vs the owner (basis_mismatch), the batch yield and its frozen unit, the lines (archived /
// unit_changed), at least one line except for an option owner (empty).
function checkVersion(draft: VersionRecord, owner: RecipeOwner, stock: ReadonlyMap<string, StockItemRow>): void {
  if (owner.owner_type === 'modifier_option' && owner.linked_item_id !== null) throw refused('owner_id', 'linked_option');
  if (owner.owner_type === 'stock_item' && owner.kind !== 'prepared') throw refused('owner_id', 'wrong_kind');
  const derived = deriveBasis(owner);
  if (draft.basis !== derived.basis || draft.measure_unit !== derived.measure_unit) throw refused('basis', 'basis_mismatch');
  if (draft.basis === 'per_batch') {
    if (draft.batch_yield_qty === null) throw refused('batch_yield_qty', 'batch_yield_missing');
    if (draft.batch_stock_unit !== derived.stock_unit) throw refused('batch_yield_qty', 'unit_changed');
  }
  for (const line of draft.lines) {
    const field = `lines.${line.line_no - 1}.stock_item_id`; // the index the draft save took them at (§6.4)
    const item = stock.get(line.stock_item_id);
    if (item === undefined) throw refused(field, 'not_found');
    if (item.archived_at !== null) throw refused(field, 'archived');
    if (item.stock_unit !== line.stock_unit) throw refused(field, 'unit_changed');
  }
  if (draft.lines.length === 0 && owner.owner_type !== 'modifier_option') throw refused('lines', 'empty');
}

export interface GraphRecipe {
  owner_type: string;
  owner_id: string;
  lines: ReadonlyArray<{ id: string; kind: string | null }>;
}

// B6 graph check (pure): the nodes are prepared stock items; a stock-item recipe's line is an edge to it when the
// line's item is `prepared` or itself owns a recipe. A cycle anywhere → 'cycle'; any chain of more than 3 prepared
// items (a recipe-less prepared item at the end counts as a level, as the engine's explosion depth does) →
// 'too_deep' — prepared-only chains no menu item uses included (n-5). Menu-item and option recipes are roots and add
// no level (their prepared lines start a chain the stock-item recipes already cover).
export function graphShape(recipes: readonly GraphRecipe[]): 'cycle' | 'too_deep' | null {
  const nodes = new Map<string, string[]>();
  for (const r of recipes) if (r.owner_type === 'stock_item') nodes.set(r.owner_id, []);
  for (const r of recipes) {
    if (r.owner_type !== 'stock_item') continue;
    nodes.get(r.owner_id)!.push(...r.lines.filter((l) => l.kind === 'prepared' || nodes.has(l.id)).map((l) => l.id));
  }
  const depth = new Map<string, number>();
  const onPath = new Set<string>();
  let cycle = false;
  const visit = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (onPath.has(id)) {
      cycle = true;
      return 0;
    }
    const children = nodes.get(id) ?? [];
    onPath.add(id);
    let below = 0;
    for (const child of children) {
      below = Math.max(below, visit(child));
      if (cycle) return 0;
    }
    onPath.delete(id);
    depth.set(id, below + 1);
    return below + 1;
  };
  let deepest = 0;
  for (const id of nodes.keys()) {
    deepest = Math.max(deepest, visit(id));
    if (cycle) return 'cycle';
  }
  return deepest > MAX_PREPARED_DEPTH ? 'too_deep' : null;
}
