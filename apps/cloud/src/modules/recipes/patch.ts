import { DomainError } from '@pos/domain';
import type { PatchRecipeInput, RecipePatched } from '@pos/events';
import { TenantLevelRepository } from '../../db/tenant-level-repository.js';
import { assertTenantWide, bumpEveryBranch, type TenantSql } from '../../lib/config-version.js';
import { inTransaction } from '../../lib/idempotency.js';
import type { OwnerRequest } from '../restaurant/service.js';
import { checkVersion, graphShape } from './publish.js';
import {
  insertRecipeAudit,
  shareMenuItemOwner,
  shareOptionOwner,
  shareStockItems,
  takePublishLock,
  versionRecord,
  type OwnerType,
  type RecipeOwner,
  type RecipeRecord,
  type StockItemRow,
  type VersionRecord,
} from './repository.js';
import type { RecipeDeps } from './service.js';
import { recipeAudit, recipeVersion } from './versions.js';

// 08 v1.1 Part B §6.6 (r3): PATCH /v1/admin/recipes/:recipe_id { expected_version, archived } — archive (no publish
// lock: removing a node never breaks the graph) and restore (N-2: the publish lock, kind 0, FIRST on every
// `archived: false`, before the recipe lock; N-1: with a published version, every B6 check on the locked current
// owner and lines plus the whole-graph cycle / depth check; a refusal is 422 { field: 'archived', reason, hint:
// 'new_draft' }, T-1). Bump every branch only when the recipe has a published version (B16). Response AD-17.

export const PATCH_ROUTE = 'PATCH /v1/admin/recipes/:recipe_id';

type Big = string | number | bigint;

interface LockedRecipe extends RecipeRecord {
  has_published: boolean;
}

// §6 kind 0.5: the target recipe FOR UPDATE, with whether it has a published version (one statement; the counts of
// §6.6 leave no room for a separate read). Under READ COMMITTED a statement that waited on the row lock re-fetches
// only the locked row; its EXISTS keeps the statement's ORIGINAL snapshot. So `has_published` here is trusted only
// under kind 0 (restore: no publish can commit in between) to decide whether the B6 checks run; the bump decision
// on every path comes from the write's RETURNING (a later statement, a fresh snapshot). undefined = unknown or
// another tenant's.
async function lockRecipeForPatch(db: TenantSql, recipeId: string): Promise<LockedRecipe | undefined> {
  const rows = await db.query<{ recipe_id: string; owner_type: OwnerType; owner_id: string; archived_at: Big | null; has_published: boolean }>(
    `SELECT r.recipe_id, r.owner_type, r.owner_id, r.archived_at,
            EXISTS (SELECT 1 FROM recipe_versions v WHERE v.tenant_id = r.tenant_id AND v.recipe_id = r.recipe_id AND v.status = 'published') AS has_published
       FROM recipes r WHERE r.tenant_id = $1 AND r.recipe_id = $2 FOR UPDATE OF r`,
    [recipeId],
  );
  const row = rows[0];
  if (row === undefined) return undefined;
  return { ...row, archived_at: row.archived_at === null ? null : Number(BigInt(String(row.archived_at))) };
}

// §6.6 write: archived_at set (archive) or cleared (restore). One statement; it returns whether the recipe has a
// published version NOW (its own snapshot, taken after the recipe lock was granted): an archive that waited behind a
// first publish of the same recipe sees that publish and bumps (B16).
async function setArchived(db: TenantSql, recipeId: string, archivedAt: number | null, now: number): Promise<boolean> {
  const rows = await db.query<{ has_published: boolean }>(
    `UPDATE recipes r SET archived_at = $3::bigint, updated_at = $4::bigint WHERE r.tenant_id = $1 AND r.recipe_id = $2
     RETURNING EXISTS (SELECT 1 FROM recipe_versions v WHERE v.tenant_id = r.tenant_id AND v.recipe_id = r.recipe_id AND v.status = 'published') AS has_published`,
    [recipeId, archivedAt, now],
  );
  if (rows[0] === undefined) throw new DomainError('INTERNAL_ERROR', { reason: 'recipe_not_written' }); // under the recipe lock; invariant
  return rows[0].has_published;
}

interface PatchGraphVersion {
  version: VersionRecord;
  owner_type: OwnerType;
  owner_id: string;
  lineKinds: Map<string, string | null>;
}

// §6.6 restore graph read (one statement, under kind 0): the tenant's non-archived published graph PLUS this
// recipe's own published version, each with its lines and each line stock item's current kind.
async function selectRestoreGraph(db: TenantSql, recipeId: string): Promise<PatchGraphVersion[]> {
  const rows = await db.query<Record<string, unknown> & { owner_type: OwnerType; owner_id: string; kinds: Array<{ stock_item_id: string; kind: string | null }> }>(
    `SELECT v.recipe_version_id, v.recipe_id, v.version_no, v.status, v.basis, v.base_qty, v.batch_yield_qty, v.batch_stock_unit, v.measure_unit,
            v.misc_allowance_bp, v.created_by, v.created_at, v.published_by, v.published_at, r.owner_type, r.owner_id,
            COALESCE((SELECT json_agg(json_build_object(
                        'line_no', l.line_no, 'stock_item_id', l.stock_item_id, 'unit_name', l.unit_name,
                        'entered_num', l.entered_num::text, 'entered_den', l.entered_den::text,
                        'stock_qty_num', l.stock_qty_num::text, 'stock_qty_den', l.stock_qty_den::text,
                        'stock_unit', l.stock_unit, 'qty_basis', l.qty_basis) ORDER BY l.line_no)
                        FROM recipe_lines l WHERE l.tenant_id = v.tenant_id AND l.recipe_version_id = v.recipe_version_id), '[]'::json) AS lines,
            COALESCE((SELECT json_agg(json_build_object('stock_item_id', l.stock_item_id, 'kind', s.kind))
                        FROM recipe_lines l
                        LEFT JOIN stock_items s ON s.tenant_id = l.tenant_id AND s.stock_item_id = l.stock_item_id
                       WHERE l.tenant_id = v.tenant_id AND l.recipe_version_id = v.recipe_version_id), '[]'::json) AS kinds
       FROM recipe_versions v
       JOIN recipes r ON r.tenant_id = v.tenant_id AND r.recipe_id = v.recipe_id
      WHERE v.tenant_id = $1 AND v.status = 'published' AND (r.archived_at IS NULL OR r.recipe_id = $2)
      ORDER BY v.recipe_version_id`,
    [recipeId],
  );
  return rows.map(({ kinds, owner_type, owner_id, ...row }) => ({
    version: versionRecord(row as unknown as Parameters<typeof versionRecord>[0]),
    owner_type,
    owner_id,
    lineKinds: new Map(kinds.map((k) => [k.stock_item_id, k.kind])),
  }));
}

const restoreRefused = (reason: string) => new DomainError('CONFIG_REFERENCE_INVALID', { field: 'archived', reason, hint: 'new_draft' });

// §6.6. Statements:
// - archive: tenant-wide, recipe FOR UPDATE (0.5) → no-op 2 → write, audit → 4; + bump 2 with a published version = 6.
// - restore: tenant-wide, publish lock (kind 0, always first) → afterPublishLock → recipe FOR UPDATE → no-op 3 → no
//   published version: write, audit = 5 → with one: graph read (+ this recipe), owner row FOR SHARE (kind 1 / 4;
//   none for a stock-item owner), stock items FOR SHARE (kind 5, owner + lines, one statement), B6 checks, write,
//   audit, bump 2 = 10 (9 for a stock-item owner).
export async function patchRecipe(deps: RecipeDeps, req: OwnerRequest, recipeId: string, body: PatchRecipeInput): Promise<RecipePatched> {
  return inTransaction(deps.pool, async (client) => {
    const level = new TenantLevelRepository(req.tenant, client);
    await assertTenantWide(level, req.ownerUserId);
    if (!body.archived) {
      // N-2: before the recipe lock, whatever the row turns out to be (reading it under 0.5 first would invert 0 → 0.5)
      await takePublishLock(level);
      await deps.testHooks?.afterPublishLock?.(PATCH_ROUTE);
    }
    const recipe = await lockRecipeForPatch(level, recipeId);
    await deps.testHooks?.afterRecipeLock?.(PATCH_ROUTE); // §10.4 races (t1), as the draft save's
    if (recipe === undefined) throw new DomainError('RECIPE_NOT_FOUND', { recipe_id: recipeId });
    if (recipeVersion(recipe) !== body.expected_version) throw new DomainError('CONFIG_STALE', { entity: 'recipe', id: recipeId });
    const answer = (archived_at: number | null): RecipePatched => {
      const next = { ...recipe, archived_at };
      return { recipe: { recipe_id: recipeId, archived: archived_at !== null, version: recipeVersion(next) } };
    };
    if ((recipe.archived_at !== null) === body.archived) return answer(recipe.archived_at); // no-op: no audit, no bump

    if (body.archived === false && recipe.has_published) await restoreChecks(level, recipe);

    const now = deps.clock.branchNow();
    const archivedAt = body.archived ? now : null;
    const hasPublished = await setArchived(level, recipeId, archivedAt, now);
    await insertRecipeAudit(
      level,
      req.ownerUserId,
      [{ entity: 'recipe', entityId: recipeId, action: body.archived ? 'archive' : 'restore', before: recipeAudit(recipe), after: recipeAudit({ ...recipe, archived_at: archivedAt }) }],
      deps,
    );
    if (hasPublished) await bumpEveryBranch(level); // B16 (from the write's own snapshot): kind 10, the last lock
    return answer(archivedAt);
  });
}

// §6.6 restore with a published version (N-1): every B6 check, on rows locked here, and the graph with the recipe
// back. Any refusal → 422 { field: 'archived', reason, hint: 'new_draft' }, nothing written.
async function restoreChecks(level: TenantLevelRepository, recipe: LockedRecipe): Promise<void> {
  const graph = await selectRestoreGraph(level, recipe.recipe_id);
  const own = graph.find((g) => g.version.recipe_id === recipe.recipe_id);
  if (own === undefined) throw new DomainError('INTERNAL_ERROR', { reason: 'published_version_not_read' }); // under kind 0 + the recipe lock; invariant
  const lineIds = own.version.lines.map((l) => l.stock_item_id);
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
  if (owner === undefined) throw restoreRefused('not_found'); // owners are never deleted; defensive
  try {
    checkVersion(own.version, owner, stock); // §6.5's B6 list: owner kind, basis / measure_unit, batch unit, lines
  } catch (error) {
    if (error instanceof DomainError && error.code === 'CONFIG_REFERENCE_INVALID') {
      throw restoreRefused(String(error.details.reason));
    }
    throw error;
  }
  const shape = graphShape(
    graph.map((g) => ({
      owner_type: g.owner_type,
      owner_id: g.owner_id,
      lines: g.version.lines.map((l) => ({
        id: l.stock_item_id,
        kind: g === own ? (stock.get(l.stock_item_id)?.kind ?? null) : (g.lineKinds.get(l.stock_item_id) ?? null),
      })),
    })),
  );
  if (shape !== null) throw restoreRefused(shape);
}
