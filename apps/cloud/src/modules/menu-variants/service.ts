import { DomainError } from '@pos/domain';
import { canonicalJson } from '@pos/domain/hash';
import type {
  CreateStockItemInput,
  CreateVariantGroupInput,
  PatchStockItemInput,
  PatchVariantGroupInput,
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
import { insertConfigAuditRows, shareCategory, shareStationsById } from '../restaurant/repository.js';
import type { OwnerRequest } from '../restaurant/service.js';
import {
  branchAllowed,
  deleteStockItemBranch,
  insertStockItem,
  insertVariantGroup,
  lockStockItem,
  lockVariantGroup,
  moveMembers,
  selectActiveDrawers,
  selectMembers,
  selectStockItemBranch,
  selectStockItemBranches,
  selectStockItems,
  updateStockItem,
  upsertStockItemBranch,
  updateVariantGroup,
  type MemberRow,
  type StockItemBranchRecord,
  type StockItemRecord,
  type VariantGroupRecord,
} from './repository.js';
import { stockItemBranchVersion, toStockItemWire, toVariantGroupWire } from './versions.js';

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
      const group = await nameTaken(body.name, () =>
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
    const group = await nameTaken(merged.name, () => updateVariantGroup(level, merged, now));
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
      const stockItem = await stockItemNameTaken(body.name, () =>
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
    const stockItem = await stockItemNameTaken(merged.name, () => updateStockItem(level, merged, now));
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

// R3: pg 23505 on stock_items_active_name → 409 CONFIG_NAME_TAKEN { entity: 'stock_item', name }.
async function stockItemNameTaken<T>(name: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const pgError = error as { code?: string; constraint?: string };
    if (pgError.code === '23505' && pgError.constraint === 'stock_items_active_name') {
      throw new DomainError('CONFIG_NAME_TAKEN', { entity: 'stock_item', name });
    }
    throw error;
  }
}

// R2: pg 23505 on variant_groups_active_name → 409 CONFIG_NAME_TAKEN { entity: 'variant_group', name }.
async function nameTaken<T>(name: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const pgError = error as { code?: string; constraint?: string };
    if (pgError.code === '23505' && pgError.constraint === 'variant_groups_active_name') {
      throw new DomainError('CONFIG_NAME_TAKEN', { entity: 'variant_group', name });
    }
    throw error;
  }
}
