import { BUILTIN_UNITS, displayPer, pricePerStockUnit, type Unit } from '@pos/domain';
import type { BuiltinUnitWire, ItemPriceWire, ItemUnitWire, MenuCostWire, YieldProfileWire } from '@pos/events';
import type { ItemPriceRecord, ItemUnitRecord, YieldProfileRecord } from './repository.js';

// 08a §5.3: record → wire mappers, shared by the §6.4 detail and the §6.5–§6.7 POSTs. BIGINT values leave as
// decimal strings where §5.3 says so; `names` maps recorded_by to the owner's display_name.

export type OwnerNames = ReadonlyMap<string, string>;

function nameOf(names: OwnerNames, userId: string): string {
  const name = names.get(userId);
  // recorded_by has a FK to owner_users (§5.1, N-2), so the name read always finds it
  if (name === undefined) throw new Error(`owner user ${userId} has no display name`);
  return name;
}

// is_current (N-1): the row is the latest of its name among the rows whose base_unit = the item's current stock
// unit (the I5 step 2 set); the caller decides it (currentUnitRowIds).
export function itemUnitWire(row: ItemUnitRecord, isCurrent: boolean, names: OwnerNames): ItemUnitWire {
  return {
    unit_row_id: row.unit_row_id,
    unit_name: row.unit_name,
    base_unit: row.base_unit,
    factor_num: row.factor_num.toString(),
    factor_den: Number(row.factor_den), // ≤ 1 000 000 (INT column)
    is_current: isCurrent,
    note: row.note,
    recorded_by: row.recorded_by,
    recorded_by_name: nameOf(names, row.recorded_by),
    created_at: row.created_at,
  };
}

// N-1: the ids of the current rows — per name, the latest (created_at, then id) with base_unit = stockUnit.
export function currentUnitRowIds(rows: readonly ItemUnitRecord[], stockUnit: Unit): Set<string> {
  const latest = new Map<string, ItemUnitRecord>();
  for (const row of rows) {
    if (row.base_unit !== stockUnit) continue;
    const seen = latest.get(row.unit_name);
    if (seen === undefined || row.created_at > seen.created_at || (row.created_at === seen.created_at && row.unit_row_id > seen.unit_row_id)) {
      latest.set(row.unit_name, row);
    }
  }
  return new Set([...latest.values()].map((row) => row.unit_row_id));
}

export function itemPriceWire(row: ItemPriceRecord, names: OwnerNames): ItemPriceWire {
  return {
    price_id: row.price_id,
    branch_id: row.branch_id,
    kind: row.kind,
    unit_name: row.unit_name,
    price_minor: Number(row.price_minor), // ≤ 1 000 000 000 (CHECK), a safe integer
    stock_qty_num: row.stock_qty_num.toString(),
    stock_qty_den: row.stock_qty_den.toString(),
    stock_unit: row.stock_unit,
    created_at: row.created_at,
    valid_until_at: row.valid_until_at,
    note: row.note,
    recorded_by: row.recorded_by,
    recorded_by_name: nameOf(names, row.recorded_by),
  };
}

// §5.3 MenuCostWire for the I7-chosen price (null = no price, never 0); branch_id is that price's scope.
export function menuCostWire(row: ItemPriceRecord | null, stockUnit: Unit): MenuCostWire | null {
  if (row === null) return null;
  const per = pricePerStockUnit(row);
  return {
    branch_id: row.branch_id,
    price_id: row.price_id,
    per_stock_unit: { num: per.num.toString(), den: per.den.toString() },
    display_per: displayPer(per, stockUnit),
  };
}

export function yieldProfileWire(row: YieldProfileRecord, names: OwnerNames): YieldProfileWire {
  return {
    yield_profile_id: row.yield_profile_id,
    yield_bp: row.yield_bp,
    test_ap_qty: row.test_ap_qty === null ? null : row.test_ap_qty.toString(),
    test_ep_qty: row.test_ep_qty === null ? null : row.test_ep_qty.toString(),
    test_unit: row.test_unit,
    note: row.note,
    recorded_by: row.recorded_by,
    recorded_by_name: nameOf(names, row.recorded_by),
    created_at: row.created_at,
  };
}

// §6.4 builtin_units: the I3 built-ins whose base is the item's stock unit (they resolve by I5 step 3).
export function builtinUnitWires(stockUnit: Unit): BuiltinUnitWire[] {
  return Object.entries(BUILTIN_UNITS)
    .filter(([, unit]) => unit.base === stockUnit)
    .map(([unitName, unit]) => ({ unit_name: unitName, base: unit.base, num: Number(unit.num), den: Number(unit.den) }));
}
