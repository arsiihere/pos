import { activeYield, BUILTIN_UNITS, DomainError, effectiveMenuPrice, reduceFraction, resolveUnit, yieldBpFromTest, type BuiltinUnitName, type Unit } from '@pos/domain';
import type {
  CreateItemPriceInput,
  CreateItemUnitInput,
  CreateYieldInput,
  InventoryDetail,
  ItemPriceCreated,
  ItemPriceWire,
  ItemUnitCreated,
  ItemUnitWire,
  YieldProfileCreated,
  YieldProfileWire,
} from '@pos/events';
import type pg from 'pg';
import { TenantLevelRepository } from '../../db/tenant-level-repository.js';
import type { TenantContext } from '../../db/tenant-scoped-repository.js';
import type { Clock } from '../../lib/clock.js';
import { writeConfigAudit } from '../../lib/config-audit.js';
import { assertTenantWide, coversEveryBranch } from '../../lib/config-version.js';
import type { IdGen } from '../../lib/ids.js';
import { withIdempotency, type IdempotentResult } from '../../lib/idempotency.js';
import type { CloudTestHooks } from '../../server.js';
import { assertBranchAllowed, type OwnerRequest } from '../restaurant/service.js';
import { toStockItemWire } from '../menu-variants/versions.js';
import {
  branchExists,
  insertItemPrice,
  selectItemUnits,
  selectItemUnitsNamed,
  selectOwnerNames,
  selectPriceCandidates,
  selectPriceHistory,
  selectStockItem,
  selectYieldProfiles,
  shareStockItem,
  insertItemUnit,
  insertYieldProfile,
  type StockItemRecord,
} from './repository.js';
import { builtinUnitWires, currentUnitRowIds, itemPriceWire, itemUnitWire, menuCostWire, yieldProfileWire } from './wires.js';

// 08a §6: owner routes. Reads are owner-level; the §6.5–§6.7 POSTs are tenant-level writes (I10, assertTenantWide),
// append-only, audited, no bump (I11).

export interface InventoryDeps {
  pool: pg.Pool;
  clock: Clock;
  ids: IdGen;
  testHooks?: CloudTestHooks;
}

// ------------------------------------------------------------------------------------------ §6.4 detail GET

// 7 fixed statements (M-3): coversEveryBranch, stock item, units, price history (100), price candidates (I7 input,
// independent of the history LIMIT), yields (20), owner names. `branch_id` is C2-checked before any SQL.
export async function getInventoryDetail(
  deps: InventoryDeps,
  tenant: TenantContext,
  ownerUserId: string,
  stockItemId: string,
  query: { branch_id?: string | undefined },
): Promise<InventoryDetail> {
  const branchId = query.branch_id ?? null;
  if (branchId !== null) assertBranchAllowed(tenant, branchId);
  const level = new TenantLevelRepository(tenant, deps.pool);
  const canEditTenant = await coversEveryBranch(level, ownerUserId);
  const item = await selectStockItem(level, stockItemId);
  if (item === undefined) throw new DomainError('STOCK_ITEM_NOT_FOUND', { stock_item_id: stockItemId });
  const now = deps.clock.branchNow();
  const units = await selectItemUnits(level, stockItemId);
  const prices = await selectPriceHistory(level, stockItemId);
  const candidates = await selectPriceCandidates(level, [stockItemId], branchId, now);
  const yields = await selectYieldProfiles(level, stockItemId);
  const names = await selectOwnerNames(level, [...units, ...prices, ...yields].map((row) => row.recorded_by));

  const current = currentUnitRowIds(units, item.stock_unit);
  const active = activeYield(yields);
  return {
    can_edit_tenant: canEditTenant,
    stock_item: toStockItemWire(item),
    builtin_units: builtinUnitWires(item.stock_unit),
    units: units.map((row) => itemUnitWire(row, current.has(row.unit_row_id), names)),
    prices: prices.map((row) => itemPriceWire(row, names)),
    menu_cost: menuCostWire(effectiveMenuPrice(candidates, branchId, now, item.stock_unit), item.stock_unit),
    yields: yields.map((row) => yieldProfileWire(row, names)),
    active_yield: active === null ? null : yieldProfileWire(active, names),
  };
}

// ------------------------------------------------------------------------------------------- §6.5 units POST

function hooks(deps: InventoryDeps): { testHooks?: CloudTestHooks } {
  return deps.testHooks !== undefined ? { testHooks: deps.testHooks } : {};
}

// §3.3 / §9: a business-rule 400 after body validation has the shared VALIDATION_FAILED shape.
function invalid(path: string, message: string): DomainError {
  return new DomainError('VALIDATION_FAILED', { issues: [{ path, message }] });
}

// §6 lock order, kind 5: stock item FOR SHARE → the afterStockItemLock test hook (§10.3 N-5) → 404 → active
// (422 archived). Every later rule reads this locked row.
async function lockActiveStockItem(deps: InventoryDeps, level: TenantLevelRepository, stockItemId: string, route: string): Promise<StockItemRecord> {
  const item = await shareStockItem(level, stockItemId);
  await deps.testHooks?.afterStockItemLock?.(route); // right after the lock, before the 404, as patchStockItem (every path that reaches the lock)
  if (item === undefined) throw new DomainError('STOCK_ITEM_NOT_FOUND', { stock_item_id: stockItemId });
  if (item.archived_at !== null) throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'stock_item_id', reason: 'archived' });
  return item;
}

export const UNITS_ROUTE = 'POST /v1/admin/stock-items/:stock_item_id/units';

// I4 on the locked stock unit: not the item's own stock unit, not a built-in whose base is the stock unit (it already
// resolves, I5 step 3). A built-in name on another base is allowed (M-4: l on ghee in g, kg on a piece item).
function assertUnitName(unitName: string, stockUnit: Unit): void {
  if (unitName === stockUnit) throw invalid('unit_name', 'the stock unit itself needs no unit');
  const builtin = Object.prototype.hasOwnProperty.call(BUILTIN_UNITS, unitName) ? BUILTIN_UNITS[unitName as BuiltinUnitName] : undefined;
  if (builtin !== undefined && builtin.base === stockUnit) throw invalid('unit_name', 'a built-in unit of the stock unit already converts');
}

// §6.5, 7 fixed statements (m-2): key → tenant-wide (403) → stock item FOR SHARE (404) → active (422 archived) →
// I4 name rules on the locked stock unit (400) → reduce by gcd → insert (base_unit = the locked stock unit) →
// audit stock_item_unit / create → key response → prune. No bump (I11).
export async function createItemUnit(
  deps: InventoryDeps,
  req: OwnerRequest,
  stockItemId: string,
  body: CreateItemUnitInput,
): Promise<IdempotentResult<ItemUnitCreated>> {
  return withIdempotency(
    { pool: deps.pool, clock: deps.clock, tenant: req.tenant, log: req.log, ...hooks(deps) },
    { key: req.idempotencyKey, method: req.method, path: req.path, body },
    async (client) => {
      const level = new TenantLevelRepository(req.tenant, client);
      await assertTenantWide(level, req.ownerUserId);
      const item = await lockActiveStockItem(deps, level, stockItemId, UNITS_ROUTE);
      assertUnitName(body.unit_name, item.stock_unit);
      const factor = reduceFraction(BigInt(body.factor_num), BigInt(body.factor_den));
      const { unit, recordedByName } = await insertItemUnit(level, {
        unit_row_id: deps.ids.next(),
        stock_item_id: stockItemId,
        unit_name: body.unit_name,
        base_unit: item.stock_unit,
        factor_num: factor.num,
        factor_den: factor.den,
        note: body.note,
        recorded_by: req.ownerUserId,
        created_at: deps.clock.branchNow(),
      });
      // the newest row of its name on the current stock unit (N-1): current by construction
      const wire = itemUnitWire(unit, true, new Map([[unit.recorded_by, recordedByName]]));
      await writeConfigAudit(
        level,
        {
          actor: { kind: 'owner', ownerUserId: req.ownerUserId },
          entity: 'stock_item_unit',
          entityId: unit.unit_row_id,
          branchId: null,
          action: 'create',
          before: null,
          after: auditAfter(stockItemId, wire),
        },
        deps,
      );
      return { status: 201, body: { unit: wire } };
    },
  );
}

// The audit row's `after`: the stored row as the wire shows it (decimal strings, no bigint), without the
// display-only fields (recorded_by_name, is_current).
function auditAfter(stockItemId: string, wire: ItemUnitWire | ItemPriceWire | YieldProfileWire): object {
  const after: Record<string, unknown> = { stock_item_id: stockItemId, ...wire };
  delete after.recorded_by_name;
  delete after.is_current;
  return after;
}

// ------------------------------------------------------------------------------------------ §6.6 prices POST

export const PRICES_ROUTE = 'POST /v1/admin/stock-items/:stock_item_id/prices';

// 9 fixed statements, 10 with branch_id (S7, I11): key → tenant-wide (403) → stock item FOR SHARE (404, kind 5) →
// active (422) → [branch, C1] → units of that name → resolveUnit with the locked stock_unit (422) → insert with
// the frozen conversion (I6) → candidates (I7 for the price's branch_id) → audit → key response → prune. No bump.
// The body is validated by CreateItemPriceBody (400: manual + branch_id / valid_for_hours, ranges, kind).
export async function createItemPrice(
  deps: InventoryDeps,
  req: OwnerRequest,
  stockItemId: string,
  body: CreateItemPriceInput,
): Promise<IdempotentResult<ItemPriceCreated>> {
  return withIdempotency(
    { pool: deps.pool, clock: deps.clock, tenant: req.tenant, log: req.log, ...hooks(deps) },
    { key: req.idempotencyKey, method: req.method, path: req.path, body },
    async (client) => {
      const level = new TenantLevelRepository(req.tenant, client);
      await assertTenantWide(level, req.ownerUserId);
      const item = await lockActiveStockItem(deps, level, stockItemId, PRICES_ROUTE);
      if (body.branch_id !== null && !(await branchExists(level, body.branch_id))) {
        throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'branch_id', reason: 'not_found' });
      }
      const units = await selectItemUnitsNamed(level, stockItemId, body.unit_name);
      const conversion = resolveUnit(item, body.unit_name, units);
      if (conversion === null) throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'unit_name', reason: 'not_convertible' });

      const now = deps.clock.branchNow();
      const { price, recordedByName } = await insertItemPrice(level, {
        price_id: deps.ids.next(),
        stock_item_id: stockItemId,
        branch_id: body.branch_id,
        kind: body.kind,
        unit_name: body.unit_name,
        price_minor: BigInt(body.price_minor),
        stock_qty_num: conversion.num,
        stock_qty_den: conversion.den,
        stock_unit: item.stock_unit,
        created_at: now,
        valid_until_at: body.valid_for_hours === null ? null : now + body.valid_for_hours * 3_600_000,
        note: body.note,
        recorded_by: req.ownerUserId,
      });
      const candidates = await selectPriceCandidates(level, [stockItemId], price.branch_id, now);
      const wire = itemPriceWire(price, new Map([[price.recorded_by, recordedByName]]));
      await writeConfigAudit(
        level,
        {
          actor: { kind: 'owner', ownerUserId: req.ownerUserId },
          entity: 'item_price',
          entityId: price.price_id,
          branchId: price.branch_id, // §6.0: the price's scope, not the writer's
          action: 'create',
          before: null,
          after: auditAfter(stockItemId, wire),
        },
        deps,
      );
      return {
        status: 201,
        body: {
          price: wire,
          menu_cost: menuCostWire(effectiveMenuPrice(candidates, price.branch_id, now, item.stock_unit), item.stock_unit),
        },
      };
    },
  );
}

// ------------------------------------------------------------------------------------------ §6.7 yields POST

export const YIELDS_ROUTE = 'POST /v1/admin/stock-items/:stock_item_id/yields';

// §6.7, 7 fixed statements: key → tenant-wide (403) → stock item FOR SHARE (404) → active (422 archived) →
// kind = ingredient (422 wrong_kind, I8) → insert (yield_bp sent or yieldBpFromTest; test_unit = the locked stock
// unit) → audit yield_profile / create → key response → prune. No bump (I11).
export async function createYieldProfile(
  deps: InventoryDeps,
  req: OwnerRequest,
  stockItemId: string,
  body: CreateYieldInput,
): Promise<IdempotentResult<YieldProfileCreated>> {
  return withIdempotency(
    { pool: deps.pool, clock: deps.clock, tenant: req.tenant, log: req.log, ...hooks(deps) },
    { key: req.idempotencyKey, method: req.method, path: req.path, body },
    async (client) => {
      const level = new TenantLevelRepository(req.tenant, client);
      await assertTenantWide(level, req.ownerUserId);
      const item = await lockActiveStockItem(deps, level, stockItemId, YIELDS_ROUTE);
      if (item.kind !== 'ingredient') throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'stock_item_id', reason: 'wrong_kind' });
      const test = body.test_ap_qty !== undefined && body.test_ep_qty !== undefined ? { ap: body.test_ap_qty, ep: body.test_ep_qty } : null;
      // the body schema admits exactly one form, and only a test whose yield is in range (I8)
      const yieldBp = test === null ? body.yield_bp! : yieldBpFromTest(test.ap, test.ep);
      const { profile, recordedByName } = await insertYieldProfile(level, {
        yield_profile_id: deps.ids.next(),
        stock_item_id: stockItemId,
        yield_bp: yieldBp,
        test_ap_qty: test === null ? null : BigInt(test.ap),
        test_ep_qty: test === null ? null : BigInt(test.ep),
        test_unit: test === null ? null : item.stock_unit,
        note: body.note,
        recorded_by: req.ownerUserId,
        created_at: deps.clock.branchNow(),
      });
      const wire = yieldProfileWire(profile, new Map([[profile.recorded_by, recordedByName]]));
      await writeConfigAudit(
        level,
        {
          actor: { kind: 'owner', ownerUserId: req.ownerUserId },
          entity: 'yield_profile',
          entityId: profile.yield_profile_id,
          branchId: null,
          action: 'create',
          before: null,
          after: auditAfter(stockItemId, wire),
        },
        deps,
      );
      return { status: 201, body: { yield: wire } };
    },
  );
}
