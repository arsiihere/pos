import { activeYield, DomainError, effectiveMenuPrice } from '@pos/domain';
import type { InventoryDetail } from '@pos/events';
import type pg from 'pg';
import { TenantLevelRepository } from '../../db/tenant-level-repository.js';
import type { TenantContext } from '../../db/tenant-scoped-repository.js';
import type { Clock } from '../../lib/clock.js';
import { coversEveryBranch } from '../../lib/config-version.js';
import type { IdGen } from '../../lib/ids.js';
import type { CloudTestHooks } from '../../server.js';
import { assertBranchAllowed } from '../restaurant/service.js';
import { toStockItemWire } from '../menu-variants/versions.js';
import {
  selectItemUnits,
  selectOwnerNames,
  selectPriceCandidates,
  selectPriceHistory,
  selectStockItem,
  selectYieldProfiles,
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

// ------------------------------------------------------------------------------------------ §6.6 prices POST

// ------------------------------------------------------------------------------------------ §6.7 yields POST
