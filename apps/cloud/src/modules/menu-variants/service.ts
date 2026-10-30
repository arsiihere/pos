import { DomainError } from '@pos/domain';
import { canonicalJson } from '@pos/domain/hash';
import type {
  CreateModifierGroupInput,
  CreateStockItemInput,
  CreateVariantGroupInput,
  ModifierGroupBranchWire,
  ModifierGroupListResponse,
  ModifierGroupWire,
  PatchModifierGroupInput,
  PatchStockItemInput,
  PatchVariantGroupInput,
  PutModifierGroupBranchInput,
  PutStockItemBranchInput,
  StockItemBranchWire,
  StockItemListResponse,
  StockItemWire,
  VariantGroupWire,
} from '@pos/events';
import type { z } from 'zod';
import type pg from 'pg';
import { TenantLevelRepository } from '../../db/tenant-level-repository.js';
import { TenantScopedRepository, type TenantContext } from '../../db/tenant-scoped-repository.js';
import type { Clock } from '../../lib/clock.js';
import { auditActionFor, writeConfigAudit } from '../../lib/config-audit.js';
import { assertTenantWide, bumpConfigVersion, bumpEveryBranch, coversEveryBranch } from '../../lib/config-version.js';
import { inTransaction, withIdempotency, type IdempotentResult } from '../../lib/idempotency.js';
import type { IdGen } from '../../lib/ids.js';
import type { CloudTestHooks } from '../../server.js';
import { insertConfigAuditRows, shareCategory, shareStationsById, shareVariantGroups } from '../restaurant/repository.js';
import type { OwnerRequest } from '../restaurant/service.js';
import { assertEffectiveSetLimit, type EffectiveSetItem, type LinkRow } from './effective-set.js';
import {
  archiveOmittedOptions,
  branchAllowed,
  deleteActiveOptionBranchRows,
  deleteModifierLinks,
  deleteStockItemBranch,
  firstRepeatedName,
  insertModifierGroup,
  insertModifierLinks,
  insertModifierOptions,
  insertOptionBranchRows,
  selectAffectedItems,
  selectLinksOfTargets,
  shareCategoriesById,
  shareItemsById,
  insertStockItem,
  insertVariantGroup,
  lockModifierGroup,
  lockStockItem,
  lockVariantGroup,
  moveMembers,
  selectActiveDrawers,
  selectActiveOptionBranchRows,
  selectActiveOptionIds,
  selectMembers,
  selectModifierGroups,
  selectModifierLinks,
  selectModifierOptions,
  selectOptionBranches,
  selectStockItemBranch,
  selectStockItemBranches,
  selectStockItems,
  updateModifierGroup,
  updateStockItem,
  upsertModifierOptions,
  upsertStockItemBranch,
  updateVariantGroup,
  type MemberRow,
  type ModifierGroupRecord,
  type StockItemBranchRecord,
  type StockItemRecord,
  type VariantGroupRecord,
} from './repository.js';
import {
  modifierGroupBranchVersion,
  stockItemBranchVersion,
  toModifierGroupWire,
  toStockItemWire,
  toVariantGroupWire,
  type ModifierGroupRow,
  type ModifierLinkRow,
  type ModifierOptionRow,
} from './versions.js';

export interface MenuVariantDeps {
  pool: pg.Pool;
  clock: Clock;
  ids: IdGen;
  testHooks?: CloudTestHooks;
}

// §6.1: idempotency key → tenant-wide check (403) → category FOR SHARE (lock order 6) → insert (name index → 409)
// → audit → bump every branch (10).
export async function createVariantGroup(
  deps: MenuVariantDeps,
  req: OwnerRequest,
  body: CreateVariantGroupInput,
): Promise<IdempotentResult<{ variant_group: VariantGroupWire }>> {
  return withIdempotency(
    { pool: deps.pool, clock: deps.clock, tenant: req.tenant, log: req.log, ...hooks(deps) },
    { key: req.idempotencyKey, method: req.method, path: req.path, body },
    async (client) => {
      const level = new TenantLevelRepository(req.tenant, client);
      await assertTenantWide(level, req.ownerUserId);
      assertCategory(await shareCategory(level, body.category_id));
      const group = await nameTaken('variant_groups_active_name', 'variant_group', body.name, () =>
        insertVariantGroup(
          level,
          {
            variant_group_id: deps.ids.next(),
            name: body.name,
            category_id: body.category_id,
            description: body.description,
            sort_order: body.sort_order,
          },
          deps.clock.branchNow(),
        ),
      );
      await writeConfigAudit(
        level,
        {
          actor: { kind: 'owner', ownerUserId: req.ownerUserId },
          entity: 'variant_group',
          entityId: group.variant_group_id,
          branchId: null,
          action: 'create',
          before: null,
          after: group,
        },
        deps,
      );
      await deps.testHooks?.beforeBump?.();
      await bumpEveryBranch(level);
      return { status: 201, body: { variant_group: toVariantGroupWire({ ...group, member_ids: [] }) } };
    },
  );
}

// §6.2 (C4; lock order 3 → 4 → 6 → 10): tenant-wide check (403) → group FOR UPDATE (404) → version
// (409 CONFIG_STALE, a stale no-op too) → a category change locks every member FOR UPDATE by item_id, otherwise the members are a plain read →
// a sent category_id FOR SHARE (422) → no-op (200, nothing written) → R1 archive with active members (409),
// R3 a category change re-checks every member's effective set (one links read; 422 too_many_groups),
// R2 name (index → 409) → write; a category change moves every member (M6) → one multi-row audit insert:
// the group, then one menu_item / update per moved member (C5, branch_id null) → bump every branch.
export async function patchVariantGroup(
  deps: MenuVariantDeps,
  req: OwnerRequest,
  variantGroupId: string,
  body: PatchVariantGroupInput,
): Promise<{ variant_group: VariantGroupWire }> {
  return inTransaction(deps.pool, async (client) => {
    const level = new TenantLevelRepository(req.tenant, client);
    await assertTenantWide(level, req.ownerUserId);
    const before = await lockVariantGroup(level, variantGroupId);
    if (before === undefined) throw new DomainError('VARIANT_GROUP_NOT_FOUND', { variant_group_id: variantGroupId });
    // the version input has no member_ids (§5.4), so the compare needs no member read
    if (body.expected_version !== toVariantGroupWire({ ...before, member_ids: [] }).version) {
      throw new DomainError('CONFIG_STALE', { entity: 'variant_group', id: variantGroupId });
    }
    const moving = body.category_id !== undefined && body.category_id !== before.category_id;
    const members = await selectMembers(level, variantGroupId, { lock: moving });
    // C4 step 4: a sent category_id, and on a restore the merged one (sent or stored, AD-7), FOR SHARE (slot 6)
    const restoring = before.archived_at !== null && body.archived === false;
    if (body.category_id !== undefined || restoring) {
      assertCategory(await shareCategory(level, body.category_id ?? before.category_id));
    }
    const now = deps.clock.branchNow();
    const merged: VariantGroupRecord = {
      ...before,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.category_id !== undefined ? { category_id: body.category_id } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.sort_order !== undefined ? { sort_order: body.sort_order } : {}),
      ...(body.archived !== undefined ? { archived_at: body.archived ? (before.archived_at ?? now) : null } : {}),
    };
    if (canonicalJson(before) === canonicalJson(merged)) return { variant_group: wire(before, members) };
    if (before.archived_at === null && merged.archived_at !== null) {
      const ids = members.filter((m) => m.archived_at === null).map((m) => m.item_id);
      if (ids.length > 0) {
        throw new DomainError('CONFIG_IN_USE', { entity: 'variant_group', id: variantGroupId, used_by: { entity: 'menu_item', ids } });
      }
    }
    // R3 (V8, §3.3): a category change re-checks the effective-set limit for every active member under the new
    // category (AD-21 c: an archived member is not sold, as on the group POST)
    const activeMembers = members.filter((m) => m.archived_at === null);
    if (moving && activeMembers.length > 0) {
      await assertItemEffectiveSets(
        level,
        activeMembers.map((m) => ({ item_id: m.item_id, category_id: merged.category_id, variant_group_id: variantGroupId })),
        new Set([...activeMembers.map((m) => m.item_id), merged.category_id, ...(merged.archived_at === null ? [variantGroupId] : [])]),
        'category_id',
      );
    }
    const group = await nameTaken('variant_groups_active_name', 'variant_group', merged.name, () => updateVariantGroup(level, merged, now));
    const moved = moving ? await moveMembers(level, variantGroupId, group.category_id, now) : [];
    const actor = { kind: 'owner' as const, ownerUserId: req.ownerUserId };
    const beforeOf = new Map(members.map((m) => [m.item_id, m.row]));
    await insertConfigAuditRows(
      level,
      [
        {
          actor,
          entity: 'variant_group',
          entityId: variantGroupId,
          branchId: null,
          action: auditActionFor(before, group),
          before,
          after: group,
        },
        ...moved.map((m) => ({
          actor,
          entity: 'menu_item' as const,
          entityId: m.item_id,
          branchId: null,
          action: 'update' as const,
          before: beforeOf.get(m.item_id) ?? null,
          after: m.row,
        })),
      ],
      deps,
    );
    await deps.testHooks?.beforeBump?.();
    await bumpEveryBranch(level);
    return { variant_group: wire(group, members) };
  });
}

// member_ids holds every member, archived ones included (§3.2 rule 4, AD-8), by item_id.
function wire(group: VariantGroupRecord, members: readonly MemberRow[]): VariantGroupWire {
  return toVariantGroupWire({ ...group, member_ids: members.map((m) => m.item_id) });
}

// C4 (01c §6): the tenant-wide 403 runs before the 404, 409, references and the no-op, as in 01b's directoryWrite
// (owner check before fn, whose no-op comes later). One statement; the bump then skips its own owner read.
function assertCategory(row: { archived_at: number | null } | undefined): void {
  const reason = row === undefined ? 'not_found' : row.archived_at !== null ? 'archived' : null;
  if (reason !== null) throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'category_id', reason });
}

function hooks(deps: MenuVariantDeps): { testHooks?: CloudTestHooks } {
  return deps.testHooks !== undefined ? { testHooks: deps.testHooks } : {};
}

// ------------------------------------------------------------------------------------------------ stock items

type StockItemList = z.infer<typeof StockItemListResponse>['data'];

// §6.6: 4 fixed statements (coversEveryBranch, stock items, branch rows = ANY at the JWT's allowed branches,
// drawers joined to active items = ANY). Every allowed branch gets an entry, "no row" as station_id null with the
// no-row version (AD-6), by branch_id.
export async function listStockItems(
  deps: MenuVariantDeps,
  tenant: TenantContext,
  ownerUserId: string,
  query: { status: 'active' | 'archived' },
): Promise<StockItemList> {
  const level = new TenantLevelRepository(tenant, deps.pool);
  const scoped = new TenantScopedRepository(tenant, deps.pool);
  const canEditTenant = await coversEveryBranch(level, ownerUserId);
  const items = await selectStockItems(level, { archived: query.status === 'archived' });
  const ids = items.map((row) => row.stock_item_id);
  const branchRows = await selectStockItemBranches(scoped, ids);
  const drawers = await selectActiveDrawers(level, ids);
  const branchIds = [...tenant.branchIds].sort();
  return {
    can_edit_tenant: canEditTenant,
    stock_items: items.map((row) => ({
      ...toStockItemWire(row),
      branches: branchIds.map((branchId) =>
        stockItemBranchVersion(
          row.stock_item_id,
          branchId,
          branchRows.find((b) => b.stock_item_id === row.stock_item_id && b.branch_id === branchId) ?? null,
        ),
      ),
      drawers: drawers
        .filter((d) => d.stock_item_id === row.stock_item_id)
        .map((d) => ({ item_id: d.item_id, name: d.name, variant_name: d.variant_name, quantity_per_sale_unit: d.quantity_per_sale_unit })),
    })),
  };
}

// §6.7 (lock order 10 only: insert, no lock): idempotency key → tenant-wide check (403) → insert (name index → 409)
// → audit → bump every branch.
export async function createStockItem(
  deps: MenuVariantDeps,
  req: OwnerRequest,
  body: CreateStockItemInput,
): Promise<IdempotentResult<{ stock_item: StockItemWire }>> {
  return withIdempotency(
    { pool: deps.pool, clock: deps.clock, tenant: req.tenant, log: req.log, ...hooks(deps) },
    { key: req.idempotencyKey, method: req.method, path: req.path, body },
    async (client) => {
      const level = new TenantLevelRepository(req.tenant, client);
      await assertTenantWide(level, req.ownerUserId);
      const stockItem = await nameTaken('stock_items_active_name', 'stock_item', body.name, () =>
        insertStockItem(
          level,
          { stock_item_id: deps.ids.next(), name: body.name, stock_unit: body.stock_unit, carries_over: body.carries_over },
          deps.clock.branchNow(),
        ),
      );
      await writeConfigAudit(
        level,
        {
          actor: { kind: 'owner', ownerUserId: req.ownerUserId },
          entity: 'stock_item',
          entityId: stockItem.stock_item_id,
          branchId: null,
          action: 'create',
          before: null,
          after: stockItem,
        },
        deps,
      );
      await deps.testHooks?.beforeBump?.();
      await bumpEveryBranch(level);
      return { status: 201, body: { stock_item: toStockItemWire(stockItem) } };
    },
  );
}

// §6.8 (C4; lock order 5 → 10): tenant-wide check (403) → stock item FOR UPDATE (404) → version (409 CONFIG_STALE,
// a stale no-op too) → no payload references → no-op (200, nothing written) → R2 archive with an active drawer
// (409 CONFIG_IN_USE), then R1 a stock_unit change re-runs the V4 unit rule on every active drawer (422 unit_mismatch);
// R2 before R1 follows §6.5's precedence 400 → 409 → 422 (AD-13; §6.8 states no order): one plain read of the active
// drawers, only when R1 or R2 applies → R3 name (index → 409) → write → audit → bump.
// No cascade: branch rows and draws are untouched.
export async function patchStockItem(
  deps: MenuVariantDeps,
  req: OwnerRequest,
  stockItemId: string,
  body: PatchStockItemInput,
): Promise<{ stock_item: StockItemWire }> {
  return inTransaction(deps.pool, async (client) => {
    const level = new TenantLevelRepository(req.tenant, client);
    await assertTenantWide(level, req.ownerUserId);
    const before = await lockStockItem(level, stockItemId);
    if (before === undefined) throw new DomainError('STOCK_ITEM_NOT_FOUND', { stock_item_id: stockItemId });
    if (body.expected_version !== toStockItemWire(before).version) {
      throw new DomainError('CONFIG_STALE', { entity: 'stock_item', id: stockItemId });
    }
    const now = deps.clock.branchNow();
    const merged: StockItemRecord = {
      ...before,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.stock_unit !== undefined ? { stock_unit: body.stock_unit } : {}),
      ...(body.carries_over !== undefined ? { carries_over: body.carries_over } : {}),
      ...(body.archived !== undefined ? { archived_at: body.archived ? (before.archived_at ?? now) : null } : {}),
    };
    if (canonicalJson(before) === canonicalJson(merged)) return { stock_item: toStockItemWire(before) };
    const unitChanged = merged.stock_unit !== before.stock_unit;
    const archiving = before.archived_at === null && merged.archived_at !== null;
    if (unitChanged || archiving) {
      const drawers = await selectActiveDrawers(level, [stockItemId]);
      // R2 first (AD-13): archive with an active drawer
      if (archiving && drawers.length > 0) {
        const ids = [...new Set(drawers.map((d) => d.item_id))].sort();
        throw new DomainError('CONFIG_IN_USE', { entity: 'stock_item', id: stockItemId, used_by: { entity: 'menu_item', ids } });
      }
      // R1 (V4): equal units → quantity 1; different units → the drawer sells by the piece
      if (unitChanged && drawers.some((d) => !(d.sale_unit === merged.stock_unit ? d.quantity_per_sale_unit === 1 : d.sale_unit === 'piece'))) {
        throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'stock_unit', reason: 'unit_mismatch' });
      }
    }
    const stockItem = await nameTaken('stock_items_active_name', 'stock_item', merged.name, () => updateStockItem(level, merged, now));
    await writeConfigAudit(
      level,
      {
        actor: { kind: 'owner', ownerUserId: req.ownerUserId },
        entity: 'stock_item',
        entityId: stockItemId,
        branchId: null,
        action: auditActionFor(before, stockItem),
        before,
        after: stockItem,
      },
      deps,
    );
    await deps.testHooks?.beforeBump?.();
    await bumpEveryBranch(level);
    return { stock_item: toStockItemWire(stockItem) };
  });
}

// §6.9 (C4; lock order 5 → 8 on a set → 9 → 10). A branch-scoped write: no tenant-wide check, only that branch
// is bumped. Stock item FOR UPDATE (404; M4: serialises two PUTs on a row that does not exist yet) → C2 branch read
// inside the transaction, among the JWT's allowed branches (404 BRANCH_NOT_FOUND) → stored row read without a lock
// (P3) → version (409 CONFIG_STALE, a stale no-op too) → on a set: the stock item active (422 stock_item_id
// archived), the station FOR SHARE, an active station of this branch (422 not_found / wrong_branch / archived) →
// no-op (200, nothing written) → upsert or delete (the row's own lock, 9) → audit branch_set / branch_removed with
// branch_id → bump that branch (10).
export async function putStockItemBranch(
  deps: MenuVariantDeps,
  req: OwnerRequest,
  stockItemId: string,
  branchId: string,
  body: PutStockItemBranchInput,
): Promise<{ branch: StockItemBranchWire | null }> {
  return inTransaction(deps.pool, async (client) => {
    const level = new TenantLevelRepository(req.tenant, client);
    const scoped = new TenantScopedRepository(req.tenant, client);
    const stockItem = await lockStockItem(level, stockItemId);
    if (stockItem === undefined) throw new DomainError('STOCK_ITEM_NOT_FOUND', { stock_item_id: stockItemId });
    if (!(await branchAllowed(scoped, branchId))) throw new DomainError('BRANCH_NOT_FOUND', { branch_id: branchId });
    const stored = (await selectStockItemBranch(scoped, stockItemId, branchId)) ?? null;
    if (body.expected_version !== stockItemBranchVersion(stockItemId, branchId, stored).version) {
      throw new DomainError('CONFIG_STALE', { entity: 'stock_item_branch', id: stockItemId });
    }
    const before = stored === null ? null : { station_id: stored.station_id, low_stock_threshold: stored.low_stock_threshold };
    const next = body.station_id === null ? null : { station_id: body.station_id, low_stock_threshold: body.low_stock_threshold };
    if (next !== null) {
      if (stockItem.archived_at !== null) {
        throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'stock_item_id', reason: 'archived' });
      }
      const stations = await shareStationsById(scoped, [next.station_id]);
      const station = stations.find((s) => s.branch_id === branchId);
      const reason = station === undefined ? (stations.length > 0 ? 'wrong_branch' : 'not_found') : station.archived_at !== null ? 'archived' : null;
      if (reason !== null) throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'station_id', reason });
    }
    if (canonicalJson(before) === canonicalJson(next)) {
      return { branch: stored === null ? null : stockItemBranchVersion(stockItemId, branchId, stored) };
    }
    let written: StockItemBranchRecord | null = null;
    if (next !== null) {
      written = await upsertStockItemBranch(scoped, { stock_item_id: stockItemId, branch_id: branchId, ...next }, deps.clock.branchNow());
    } else {
      await deleteStockItemBranch(scoped, stockItemId, branchId);
    }
    await writeConfigAudit(
      level,
      {
        actor: { kind: 'owner', ownerUserId: req.ownerUserId },
        entity: 'stock_item_branch',
        entityId: stockItemId,
        branchId,
        action: written === null ? 'branch_removed' : 'branch_set',
        before,
        after: next,
      },
      deps,
    );
    await deps.testHooks?.beforeBump?.();
    await bumpConfigVersion(level, { kind: 'branch', branchId });
    return { branch: written === null ? null : stockItemBranchVersion(stockItemId, branchId, written) };
  });
}


// The active-name unique indexes (§6.2 R2, §6.8 R3, §3.3): pg 23505 on `index` → 409 CONFIG_NAME_TAKEN { entity, name }.
type NameIndex = 'variant_groups_active_name' | 'stock_items_active_name' | 'modifier_groups_active_name';
async function nameTaken<T>(
  index: NameIndex,
  entity: 'variant_group' | 'stock_item' | 'modifier_group',
  name: string,
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const pgError = error as { code?: string; constraint?: string };
    if (pgError.code === '23505' && pgError.constraint === index) throw new DomainError('CONFIG_NAME_TAKEN', { entity, name });
    throw error;
  }
}

// -------------------------------------------------------------------------------------------- modifier groups

// §6.11 (C4; lock order 3 → 4 → 6 → 10): idempotency key → tenant-wide check (403) → references FOR SHARE and C1
// checks (assertGroupReferences: link variant groups, then the linked and target items together, then link
// categories) → merged group rules (§3.3, in §6.12's order): choices_unsatisfiable,
// defaults_exceed_max, option names (one lower(name) statement, m13; 409 modifier_option), effective-set limit on
// the items the attach links reach (one read; 422 at links) → insert group (name index → 409), options, links
// (multi-row) → one audit row (options and links in after, V15) → bump every branch (10).
export async function createModifierGroup(
  deps: MenuVariantDeps,
  req: OwnerRequest,
  body: CreateModifierGroupInput,
): Promise<IdempotentResult<{ modifier_group: ModifierGroupWire }>> {
  return withIdempotency(
    { pool: deps.pool, clock: deps.clock, tenant: req.tenant, log: req.log, ...hooks(deps) },
    { key: req.idempotencyKey, method: req.method, path: req.path, body },
    async (client) => {
      const level = new TenantLevelRepository(req.tenant, client);
      await assertTenantWide(level, req.ownerUserId);
      await assertGroupReferences(
        level,
        body.options.map((o) => o.linked_item_id),
        body.links.map((link, i) => ({ link, i })),
      );
      if (body.min_choices > body.options.reduce((sum, o) => sum + o.max_quantity, 0)) {
        throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'min_choices', reason: 'choices_unsatisfiable' });
      }
      if (body.options.filter((o) => o.is_default).length > body.max_choices) {
        throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'options', reason: 'defaults_exceed_max' });
      }
      const repeated = await firstRepeatedName(level, body.options.map((o) => o.name));
      if (repeated !== undefined) throw new DomainError('CONFIG_NAME_TAKEN', { entity: 'modifier_option', name: repeated });
      const modifierGroupId = deps.ids.next();
      await assertGroupLinksWithinLimit(level, { modifier_group_id: modifierGroupId, sort_order: body.sort_order }, body.links);
      const now = deps.clock.branchNow();
      const group = await nameTaken('modifier_groups_active_name', 'modifier_group', body.name, () =>
        insertModifierGroup(
          level,
          { modifier_group_id: modifierGroupId, name: body.name, min_choices: body.min_choices, max_choices: body.max_choices, sort_order: body.sort_order },
          now,
        ),
      );
      const options = await insertModifierOptions(
        level,
        modifierGroupId,
        body.options.map((o) => ({
          option_id: deps.ids.next(),
          name: o.name,
          price_minor: o.price_minor,
          max_quantity: o.max_quantity,
          is_default: o.is_default,
          linked_item_id: o.linked_item_id,
          sort_order: o.sort_order,
        })),
      );
      const links = body.links.length > 0 ? await insertModifierLinks(level, modifierGroupId, body.links) : [];
      const wire = toModifierGroupWire({ ...group, options, links }, req.tenant.branchIds, []);
      await writeConfigAudit(
        level,
        {
          actor: { kind: 'owner', ownerUserId: req.ownerUserId },
          entity: 'modifier_group',
          entityId: modifierGroupId,
          branchId: null,
          action: 'create',
          before: null,
          after: modifierGroupAudit(wire),
        },
        deps,
      );
      await deps.testHooks?.beforeBump?.();
      await bumpEveryBranch(level);
      return { status: 201, body: { modifier_group: wire } };
    },
  );
}

// V15: the group's config_audit before / after: the group with its whole active options and links lists.
function modifierGroupAudit(wire: ModifierGroupWire): object {
  return {
    modifier_group_id: wire.modifier_group_id,
    name: wire.name,
    min_choices: wire.min_choices,
    max_choices: wire.max_choices,
    sort_order: wire.sort_order,
    archived_at: wire.archived_at,
    options: wire.options,
    links: wire.links,
  };
}

// §3.3 effective-set row on a group write that changes links (M5, a plain read): the active items the group's attach
// links reach, with their stored links, plus this group's own links; any item above 20 → 422 at links. A group with
// no attach link reaches no item, so nothing is read.
async function assertGroupLinksWithinLimit(
  repo: TenantLevelRepository,
  group: { modifier_group_id: string; sort_order: number },
  links: ReadonlyArray<Omit<LinkRow, 'modifier_group_id'>>,
): Promise<void> {
  const attached = links.filter((l) => l.mode === 'attach');
  if (attached.length === 0) return;
  const ofKind = (kind: LinkRow['target_kind']) => sortedUnique(attached.filter((l) => l.target_kind === kind).map((l) => l.target_id));
  const affected = await selectAffectedItems(repo, {
    categoryIds: ofKind('category'),
    variantGroupIds: ofKind('variant_group'),
    itemIds: ofKind('item'),
  });
  const own = links.map((l) => ({ ...l, modifier_group_id: group.modifier_group_id }));
  for (const item of affected) {
    const active = new Set([
      item.item_id,
      ...(item.category_active ? [item.category_id] : []),
      ...(item.variant_group_active && item.variant_group_id !== null ? [item.variant_group_id] : []),
    ]);
    assertEffectiveSetLimit([item], [...item.links, ...own], [...groupsOf(item.links), group], active, 'links');
  }
}

// §6.4, §6.5 R3, §6.2 R3 (§3.3 effective-set row, M5): one plain read of the links reaching these items (their
// categories, variant groups and ids, as they will be after the write); any item above 20 → 422 at `field`.
// activeTargets: the ids among them that are active (V8, m15).
export async function assertItemEffectiveSets(
  repo: TenantLevelRepository,
  items: readonly EffectiveSetItem[],
  activeTargets: ReadonlySet<string>,
  field: string,
): Promise<void> {
  const links = await selectLinksOfTargets(repo, {
    categoryIds: sortedUnique(items.map((i) => i.category_id)),
    variantGroupIds: sortedUnique(items.flatMap((i) => (i.variant_group_id === null ? [] : [i.variant_group_id]))),
    itemIds: sortedUnique(items.map((i) => i.item_id)),
  });
  assertEffectiveSetLimit(items, links, groupsOf(links), activeTargets, field);
}

function groupsOf(links: ReadonlyArray<{ modifier_group_id: string; sort_order: number }>): Array<{ modifier_group_id: string; sort_order: number }> {
  return [...new Map(links.map((l) => [l.modifier_group_id, { modifier_group_id: l.modifier_group_id, sort_order: l.sort_order }])).values()];
}

function sortedUnique(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}


// §6.12 (C4; lock order 1 → 3 → 4 → 6 → 10): tenant-wide check (403) → group FOR UPDATE (404) → its options and
// links (plain reads under the group lock) → version (409 CONFIG_STALE, a stale no-op too) → payload checks: each
// sent option_id an option of this group, active or archived (422 not_found at options.N.option_id); references
// FOR SHARE per kind, one = ANY each (variant groups, then items, then categories): the sent options' linked items
// and the targets of added or changed links only (m15) → C1 checks in body order as on create → no-op (200,
// nothing written) → write: the group row (name index → 409), the options (one upsert of the sent rows + one
// archive of the omitted active rows, V14) when sent, the links (delete + multi-row insert) when sent → one audit
// row, whole active lists before / after (V15) → bump every branch (10) → the group's branch rows (response).
// The merged-row rules R1–R6 are task 25's.
export async function patchModifierGroup(
  deps: MenuVariantDeps,
  req: OwnerRequest,
  modifierGroupId: string,
  body: PatchModifierGroupInput,
): Promise<{ modifier_group: ModifierGroupWire }> {
  return inTransaction(deps.pool, async (client) => {
    const level = new TenantLevelRepository(req.tenant, client);
    const scoped = new TenantScopedRepository(req.tenant, client);
    await assertTenantWide(level, req.ownerUserId);
    const group = await lockModifierGroup(level, modifierGroupId);
    if (group === undefined) throw new DomainError('MODIFIER_GROUP_NOT_FOUND', { modifier_group_id: modifierGroupId });
    const storedOptions = await selectModifierOptions(level, [modifierGroupId]);
    const storedLinks = await selectModifierLinks(level, [modifierGroupId]);
    const before = toModifierGroupWire({ ...group, options: storedOptions, links: storedLinks }, req.tenant.branchIds, []);
    if (body.expected_version !== before.version) {
      throw new DomainError('CONFIG_STALE', { entity: 'modifier_group', id: modifierGroupId });
    }
    // C4 step 4: the sent option ids (C1), then the references FOR SHARE per kind in the §6 lock order
    body.options?.forEach((option, i) => {
      if (option.option_id !== undefined && !storedOptions.some((stored) => stored.option_id === option.option_id)) {
        throw new DomainError('CONFIG_REFERENCE_INVALID', { field: `options.${i}.option_id`, reason: 'not_found' });
      }
    });
    const storedLink = (l: ModifierLinkRow) =>
      storedLinks.some((s) => s.target_kind === l.target_kind && s.target_id === l.target_id && s.mode === l.mode);
    const checkedLinks = (body.links ?? []).map((link, i) => ({ link, i })).filter(({ link }) => !storedLink(link));
    await assertGroupReferences(
      level,
      (body.options ?? []).map((o) => o.linked_item_id),
      checkedLinks,
    );
    const now = deps.clock.branchNow();
    const options: ModifierOptionRow[] =
      body.options === undefined
        ? storedOptions
        : [
            ...body.options.map((o) => ({
              option_id: o.option_id ?? deps.ids.next(),
              name: o.name,
              price_minor: o.price_minor,
              max_quantity: o.max_quantity,
              is_default: o.is_default,
              linked_item_id: o.linked_item_id,
              sort_order: o.sort_order,
              archived_at: null,
            })),
            ...storedOptions
              .filter((stored) => !body.options!.some((o) => o.option_id === stored.option_id))
              .map((stored) => ({ ...stored, archived_at: stored.archived_at ?? now })),
          ];
    const merged: ModifierGroupRecord = {
      ...group,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.min_choices !== undefined ? { min_choices: body.min_choices } : {}),
      ...(body.max_choices !== undefined ? { max_choices: body.max_choices } : {}),
      ...(body.sort_order !== undefined ? { sort_order: body.sort_order } : {}),
      ...(body.archived !== undefined ? { archived_at: body.archived ? (group.archived_at ?? now) : null } : {}),
    };
    const links = body.links ?? storedLinks;
    const after = toModifierGroupWire({ ...merged, options, links }, req.tenant.branchIds, []);
    // C4 step 5 (S26): the version input is the whole merged row (fields, active options, links)
    if (after.version === before.version) {
      return { modifier_group: await withBranches(scoped, req, { ...group, options: storedOptions, links: storedLinks }) };
    }
    const written = await nameTaken('modifier_groups_active_name', 'modifier_group', merged.name, () => updateModifierGroup(level, merged, now));
    if (body.options !== undefined) {
      const sent = options.slice(0, body.options.length);
      await upsertModifierOptions(level, modifierGroupId, sent);
      await archiveOmittedOptions(level, modifierGroupId, sent.map((o) => o.option_id), now);
    }
    if (body.links !== undefined) {
      await deleteModifierLinks(level, modifierGroupId);
      if (body.links.length > 0) await insertModifierLinks(level, modifierGroupId, body.links);
    }
    await writeConfigAudit(
      level,
      {
        actor: { kind: 'owner', ownerUserId: req.ownerUserId },
        entity: 'modifier_group',
        entityId: modifierGroupId,
        branchId: null,
        action: auditActionFor(group, written),
        before: modifierGroupAudit(before),
        after: modifierGroupAudit(after),
      },
      deps,
    );
    await deps.testHooks?.beforeBump?.();
    await bumpEveryBranch(level);
    return { modifier_group: await withBranches(scoped, req, { ...written, options, links }) };
  });
}

// The group's wire with its difference rows at the owner's allowed branches (one statement, V19).
async function withBranches(scoped: TenantScopedRepository, req: OwnerRequest, row: ModifierGroupRow): Promise<ModifierGroupWire> {
  const branchRows = await selectOptionBranches(scoped, [row.modifier_group_id]);
  return toModifierGroupWire(row, req.tenant.branchIds, branchRows);
}

// §6.11, §6.12 C1 (C4 step 4): the linked items and link targets FOR SHARE per kind in the §6 lock order, one = ANY
// each, ids ascending (variant groups 3, items 4, categories 6; a kind with no id reads nothing), then checked in
// body order: options.N.linked_item_id (not_found / archived / linked_item_not_piece), links.N.target_id
// (not_found / archived). `linkedItemIds` is indexed like the options; `links` carries each link's index as sent.
async function assertGroupReferences(
  level: TenantLevelRepository,
  linkedItemIds: ReadonlyArray<string | null>,
  links: ReadonlyArray<{ link: Omit<LinkRow, 'modifier_group_id'>; i: number }>,
): Promise<void> {
  const targetsOf = (kind: LinkRow['target_kind']) => sortedUnique(links.filter(({ link }) => link.target_kind === kind).map(({ link }) => link.target_id));
  const variantGroupIds = targetsOf('variant_group');
  const itemIds = sortedUnique([...linkedItemIds.flatMap((id) => (id === null ? [] : [id])), ...targetsOf('item')]);
  const categoryIds = targetsOf('category');
  const variantGroups = variantGroupIds.length > 0 ? await shareVariantGroups(level, variantGroupIds) : [];
  const items = itemIds.length > 0 ? await shareItemsById(level, itemIds) : [];
  const categories = categoryIds.length > 0 ? await shareCategoriesById(level, categoryIds) : [];
  linkedItemIds.forEach((itemId, i) => {
    if (itemId === null) return;
    const linked = items.find((row) => row.item_id === itemId);
    const reason =
      linked === undefined
        ? 'not_found'
        : linked.archived_at !== null
          ? 'archived'
          : linked.sale_unit !== 'piece' || linked.requires_weighing
            ? 'linked_item_not_piece'
            : null;
    if (reason !== null) throw new DomainError('CONFIG_REFERENCE_INVALID', { field: `options.${i}.linked_item_id`, reason });
  });
  for (const { link, i } of links) {
    const rows: ReadonlyArray<{ id: string; archived_at: number | null }> =
      link.target_kind === 'variant_group'
        ? variantGroups.map((row) => ({ id: row.variant_group_id, archived_at: row.archived_at }))
        : link.target_kind === 'item'
          ? items.map((row) => ({ id: row.item_id, archived_at: row.archived_at }))
          : categories.map((row) => ({ id: row.category_id, archived_at: row.archived_at }));
    const target = rows.find((row) => row.id === link.target_id);
    const reason = target === undefined ? 'not_found' : target.archived_at !== null ? 'archived' : null;
    if (reason !== null) throw new DomainError('CONFIG_REFERENCE_INVALID', { field: `links.${i}.target_id`, reason });
  }
}

type ModifierGroupList = z.infer<typeof ModifierGroupListResponse>['data'];

// §6.10: 5 fixed statements (coversEveryBranch, groups, options = ANY, links = ANY, branch rows at the JWT's allowed
// branches = ANY); by sort_order, then id; each group's branches list every allowed branch (V19).
export async function listModifierGroups(
  deps: MenuVariantDeps,
  tenant: TenantContext,
  ownerUserId: string,
  query: { status: 'active' | 'archived' },
): Promise<ModifierGroupList> {
  const level = new TenantLevelRepository(tenant, deps.pool);
  const scoped = new TenantScopedRepository(tenant, deps.pool);
  const canEditTenant = await coversEveryBranch(level, ownerUserId);
  const groups = await selectModifierGroups(level, { archived: query.status === 'archived' });
  const ids = groups.map((group) => group.modifier_group_id);
  const options = await selectModifierOptions(level, ids);
  const links = await selectModifierLinks(level, ids);
  const branchRows = await selectOptionBranches(scoped, ids);
  return {
    can_edit_tenant: canEditTenant,
    modifier_groups: groups.map((group) => {
      const id = group.modifier_group_id;
      return toModifierGroupWire(
        { ...group, options: options.filter((o) => o.modifier_group_id === id), links: links.filter((l) => l.modifier_group_id === id) },
        tenant.branchIds,
        branchRows.filter((row) => row.modifier_group_id === id),
      );
    }),
  };
}

// §6.12a (C4; lock order 1 → 9 → 10). A branch-scoped write: no tenant-wide check, only that branch is bumped.
// Group FOR UPDATE (404; serialises with §6.12 and other branch PUTs on the group) → C2 branch read inside the
// transaction, among the JWT's allowed branches (404 BRANCH_NOT_FOUND) → the stored rows of the group's active
// options at the branch, read without a lock → version (409 CONFIG_STALE modifier_group_branch, a stale no-op too)
// → the group active (422 modifier_group_id archived) → each option_id an active option of this group (one = ANY;
// 422 options.N.option_id not_found) → normalise (default entries dropped, V19) → no-op (200, nothing written) →
// delete the rows of the group's active options at the branch (rows of archived options stay, m4) + one multi-row
// insert → audit modifier_group / branch_set with branch_id, the difference lists before / after → bump that branch.
export async function putModifierGroupBranch(
  deps: MenuVariantDeps,
  req: OwnerRequest,
  modifierGroupId: string,
  branchId: string,
  body: PutModifierGroupBranchInput,
): Promise<{ branch: ModifierGroupBranchWire }> {
  return inTransaction(deps.pool, async (client) => {
    const level = new TenantLevelRepository(req.tenant, client);
    const scoped = new TenantScopedRepository(req.tenant, client);
    const group = await lockModifierGroup(level, modifierGroupId);
    if (group === undefined) throw new DomainError('MODIFIER_GROUP_NOT_FOUND', { modifier_group_id: modifierGroupId });
    if (!(await branchAllowed(scoped, branchId))) throw new DomainError('BRANCH_NOT_FOUND', { branch_id: branchId });
    const stored = await selectActiveOptionBranchRows(scoped, modifierGroupId, branchId);
    const before = modifierGroupBranchVersion(modifierGroupId, branchId, stored, new Set(stored.map((row) => row.option_id)));
    if (body.expected_version !== before.version) {
      throw new DomainError('CONFIG_STALE', { entity: 'modifier_group_branch', id: modifierGroupId });
    }
    if (group.archived_at !== null) throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'modifier_group_id', reason: 'archived' });
    if (body.options.length > 0) {
      const active = new Set(await selectActiveOptionIds(level, modifierGroupId, body.options.map((o) => o.option_id)));
      body.options.forEach((option, i) => {
        if (!active.has(option.option_id)) {
          throw new DomainError('CONFIG_REFERENCE_INVALID', { field: `options.${i}.option_id`, reason: 'not_found' });
        }
      });
    }
    const normalised = body.options.filter((o) => !(o.is_offered && o.price_minor_override === null));
    const after = modifierGroupBranchVersion(modifierGroupId, branchId, normalised, new Set(normalised.map((row) => row.option_id)));
    if (after.version === before.version) return { branch: before };
    await deleteActiveOptionBranchRows(scoped, modifierGroupId, branchId);
    if (normalised.length > 0) await insertOptionBranchRows(scoped, branchId, normalised, deps.clock.branchNow());
    await writeConfigAudit(
      level,
      {
        actor: { kind: 'owner', ownerUserId: req.ownerUserId },
        entity: 'modifier_group',
        entityId: modifierGroupId,
        branchId,
        action: 'branch_set',
        before: before.options,
        after: after.options,
      },
      deps,
    );
    await deps.testHooks?.beforeBump?.();
    await bumpConfigVersion(level, { kind: 'branch', branchId });
    return { branch: after };
  });
}
