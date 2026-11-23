// 08a I6, I7: price per stock unit and the effective menu price. Exact (bigint), never rounded or stored;
// displayPer is display only (§5.3 MenuCostWire.display_per).
import type { Unit } from '../units.js';
import { reduceFraction, type Fraction } from './conversions.js';

// One item_prices row; BIGINT money / quantity values as bigint (m-12: built with BigInt(string)).
export interface PriceRow {
  price_id: string;
  branch_id: string | null;
  kind: 'manual' | 'market_rate';
  unit_name: string;
  price_minor: bigint;
  stock_qty_num: bigint;
  stock_qty_den: bigint;
  stock_unit: Unit;
  created_at: number;
  valid_until_at: number | null;
}

// I6: price_minor × stock_qty_den / stock_qty_num minor units per stock unit.
export function pricePerStockUnit(row: Pick<PriceRow, 'price_minor' | 'stock_qty_num' | 'stock_qty_den'>): Fraction {
  return reduceFraction(row.price_minor * row.stock_qty_den, row.stock_qty_num);
}

function later<T extends PriceRow>(a: T, b: T): boolean {
  return a.created_at > b.created_at || (a.created_at === b.created_at && a.price_id > b.price_id);
}

// I7: candidates in the item's current stock unit, in effect at now (created_at ≤ now < valid_until_at). The
// branch's set if it has any candidate, else the every-branch set; the latest wins (created_at, then price_id);
// kind does not rank. No candidate → null (no price; never 0).
export function effectiveMenuPrice<T extends PriceRow>(rows: readonly T[], branchId: string | null, nowMs: number, stockUnit: Unit): T | null {
  let branchBest: T | null = null;
  let everyBest: T | null = null;
  for (const row of rows) {
    if (row.stock_unit !== stockUnit || row.created_at > nowMs) continue;
    if (row.valid_until_at !== null && nowMs >= row.valid_until_at) continue;
    if (row.branch_id === null) {
      if (everyBest === null || later(row, everyBest)) everyBest = row;
    } else if (branchId !== null && row.branch_id === branchId) {
      if (branchBest === null || later(row, branchBest)) branchBest = row;
    }
  }
  return branchBest ?? everyBest;
}

const DISPLAY: Record<Unit, { unit: 'kg' | 'l' | 'piece'; factor: bigint }> = {
  g: { unit: 'kg', factor: 1000n },
  ml: { unit: 'l', factor: 1000n },
  piece: { unit: 'piece', factor: 1n },
};

// §5.3 display_per: the price of 1 kg / 1 L / 1 piece, half up to the minor unit, as a decimal string. A value
// above 0 that rounds to 0 shows as "1" with below_one_minor (m-1): a real price never reads Rs 0.
export function displayPer(perStockUnit: Fraction, stockUnit: Unit): { unit: 'kg' | 'l' | 'piece'; minor: string; below_one_minor: boolean } {
  const { unit, factor } = DISPLAY[stockUnit];
  const num = perStockUnit.num * factor;
  const rounded = (2n * num + perStockUnit.den) / (2n * perStockUnit.den);
  if (rounded === 0n && num > 0n) return { unit, minor: '1', below_one_minor: true };
  return { unit, minor: rounded.toString(), below_one_minor: false };
}
