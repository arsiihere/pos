// 08a I3–I5: built-in units, unit names, unit resolution. Exact integer ratios (bigint), no floats.
// Browser-safe: no node:* import.
import type { Unit } from '../units.js';

export type BuiltinUnitName = 'kg' | 'pao' | 'maund' | 'l' | 'darjan';

export interface Fraction {
  num: bigint;
  den: bigint;
}

// I3: physical or trade facts, the same for every tenant (no table, no seed).
export const BUILTIN_UNITS: Readonly<Record<BuiltinUnitName, Readonly<{ base: Unit; num: bigint; den: bigint }>>> = Object.freeze({
  kg: Object.freeze({ base: 'g' as Unit, num: 1000n, den: 1n }),
  pao: Object.freeze({ base: 'g' as Unit, num: 250n, den: 1n }),
  maund: Object.freeze({ base: 'g' as Unit, num: 40000n, den: 1n }),
  l: Object.freeze({ base: 'ml' as Unit, num: 1000n, den: 1n }),
  darjan: Object.freeze({ base: 'piece' as Unit, num: 12n, den: 1n }),
});

// I4: one item unit row ("1 unit_name = factor_num / factor_den base_unit"). BIGINT values as bigint (m-12).
export interface ItemUnitRow {
  unit_row_id: string;
  unit_name: string;
  base_unit: Unit;
  factor_num: bigint;
  factor_den: bigint;
  created_at: number;
}

// I3 / I4: names are case-insensitive and stored lowercase, trimmed.
export function normaliseUnitName(s: string): string {
  return s.trim().toLowerCase();
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

// I4: stored reduced by the gcd. Needs num ≥ 0 and den > 0, else throws RangeError (08a inputs are validated positive).
export function reduceFraction(num: bigint, den: bigint): Fraction {
  if (den <= 0n || num < 0n) throw new RangeError('fraction needs num >= 0 and den > 0');
  if (num === 0n) return { num: 0n, den: 1n };
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
}

function builtin(name: string): Readonly<{ base: Unit; num: bigint; den: bigint }> | undefined {
  return Object.prototype.hasOwnProperty.call(BUILTIN_UNITS, name) ? BUILTIN_UNITS[name as BuiltinUnitName] : undefined;
}

// I5: direct only, no chains: (1) the stock unit itself → 1/1; (2) the latest item unit of that name whose
// base_unit is the item's current stock_unit (created_at, then id); (3) a built-in on that base; else null.
export function resolveUnit(item: { stock_unit: Unit }, unitName: string, itemUnits: readonly ItemUnitRow[]): Fraction | null {
  const name = normaliseUnitName(unitName);
  if (name === item.stock_unit) return { num: 1n, den: 1n };
  let latest: ItemUnitRow | undefined;
  for (const row of itemUnits) {
    if (row.unit_name !== name || row.base_unit !== item.stock_unit) continue;
    if (latest === undefined || row.created_at > latest.created_at || (row.created_at === latest.created_at && row.unit_row_id > latest.unit_row_id)) {
      latest = row;
    }
  }
  if (latest !== undefined) return { num: latest.factor_num, den: latest.factor_den };
  const b = builtin(name);
  return b !== undefined && b.base === item.stock_unit ? { num: b.num, den: b.den } : null;
}

// qty of a unit → stock units, exact.
export function toStockUnits(qty: bigint, conv: Fraction): Fraction {
  return reduceFraction(qty * conv.num, conv.den);
}
