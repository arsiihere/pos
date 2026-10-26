// §4.2 (v1.0): one line's total in minor units. price_minor is per piece, per kg (1 000 g) or per L (1 000 ml) (S44).
// g / ml round half-up to the whole rupee (100 minor units) per line (v1.2, S59). Integer arithmetic only. Browser-safe.
import type { Unit } from './units.js';

// S33: branch settings used before the first config arrives.
export const DEFAULT_DAY_STALE_AFTER_HOURS = 16;
export const DEFAULT_DAY_MIN_GAP_HOURS = 4;

export function lineTotalMinor(priceMinor: number, quantity: number, saleUnit: Unit): number {
  if (!Number.isSafeInteger(priceMinor) || priceMinor < 0) throw new Error('lineTotalMinor: price_minor must be a non-negative integer');
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error('lineTotalMinor: quantity must be a non-negative integer');
  const product = BigInt(priceMinor) * BigInt(quantity);
  // product / 1000 is the exact total in minor units; half-up to a multiple of 100 is (product * 2 + 100 000) / 200 000 × 100.
  const total = Number(saleUnit === 'piece' ? product : ((product * 2n + 100_000n) / 200_000n) * 100n);
  if (!Number.isSafeInteger(total)) throw new Error('lineTotalMinor: total is not a safe integer');
  return total;
}
