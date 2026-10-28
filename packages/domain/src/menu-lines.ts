// 01c §3.4, §4.2: order-line quantities, charges, deal allocation and line totals, called by 02, 04 and 05.
// Integer arithmetic only (BigInt inside); a non-safe input or result throws, like lineTotalMinor. Browser-safe.
import { lineTotalMinor } from './line-total.js';
import type { Unit } from './units.js';

export type LineKind = 'item' | 'option_child' | 'deal' | 'deal_part';

// §3.4.4. A deal's parts[].quantity is the part quantity per deal; part option charges come pre-computed (§3.4.3).
export type LineTotalInput =
  | { line_kind: 'item'; price_minor: number; quantity: number | null; sale_unit: Unit; option_charges_minor: number[] }
  | { line_kind: 'option_child'; price_minor: number; quantity: number; option_charges_minor: number[] }
  | {
      line_kind: 'deal';
      price_minor: number;
      quantity: number;
      parts: Array<{ sale_unit: Unit; quantity: number; extra_price_minor: number; option_charges_minor: number[] }>;
    }
  | { line_kind: 'deal_part' };

function nonNegative(fn: string, name: string, n: number): bigint {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${fn}: ${name} must be a non-negative integer`);
  return BigInt(n);
}

function safe(fn: string, name: string, n: bigint): number {
  const out = Number(n);
  if (!Number.isSafeInteger(out)) throw new Error(`${fn}: ${name} is not a safe integer`);
  return out;
}

// §3.4.2: piece parent → option qty × parent qty; g/ml parent → option qty (a 1.25 kg karahi with 3 naan → 3 naan).
export function childQuantity(optionQty: number, parentQty: number, parentSaleUnit: Unit): number {
  const opt = nonNegative('childQuantity', 'option quantity', optionQty);
  const parent = nonNegative('childQuantity', 'parent quantity', parentQty);
  return safe('childQuantity', 'quantity', parentSaleUnit === 'piece' ? opt * parent : opt);
}

// §3.4.3: piece parent → price × option qty × parent qty; g/ml parent → price × option qty, once per line, never per gram.
// A deal part passes part qty × deal qty (piece part) or the deal qty with 'piece' (g/ml part, B2).
export function optionChargeMinor(priceMinor: number, optionQty: number, parentQty: number, parentSaleUnit: Unit): number {
  const price = nonNegative('optionChargeMinor', 'price_minor', priceMinor);
  const opt = nonNegative('optionChargeMinor', 'option quantity', optionQty);
  const parent = nonNegative('optionChargeMinor', 'parent quantity', parentQty);
  return safe('optionChargeMinor', 'charge', price * opt * (parentSaleUnit === 'piece' ? parent : 1n));
}

// V11 c (m1, M8): pro rata by weight, floor for every share but the last, the remainder to the last, so the shares sum to the total.
// A zero weight gets 0; the split is equal only when every weight is 0. Also the per-unit void split (weights all 1, §3.4.8).
export function allocateDealMinor(totalMinor: number, weightsMinor: readonly number[]): number[] {
  const total = nonNegative('allocateDealMinor', 'total', totalMinor);
  if (weightsMinor.length === 0) throw new Error('allocateDealMinor: weights must not be empty');
  const weights = weightsMinor.map((w) => nonNegative('allocateDealMinor', 'weight', w));
  const weightSum = weights.reduce((a, b) => a + b, 0n);
  const shares =
    weightSum === 0n ? weights.map(() => total / BigInt(weights.length)) : weights.map((w) => (total * w) / weightSum);
  const head = shares.slice(0, -1);
  const last = total - head.reduce((a, b) => a + b, 0n);
  return [...head, last].map((s) => safe('allocateDealMinor', 'share', s));
}

// §3.4.4, V11 a, V18: the billed total of one order line; null while a weighed line's weight is pending.
export function orderLineTotalMinor(line: LineTotalInput): number | null {
  const fn = 'orderLineTotalMinor';
  const charges = (xs: readonly number[]): bigint => xs.reduce((a, x) => a + nonNegative(fn, 'option charge', x), 0n);
  switch (line.line_kind) {
    case 'item':
      if (line.quantity === null) return null;
      return safe(fn, 'total', BigInt(lineTotalMinor(line.price_minor, line.quantity, line.sale_unit)) + charges(line.option_charges_minor));
    case 'option_child':
      return safe(fn, 'total', BigInt(lineTotalMinor(line.price_minor, line.quantity, 'piece')) + charges(line.option_charges_minor));
    case 'deal': {
      const dealQty = nonNegative(fn, 'quantity', line.quantity);
      let total = nonNegative(fn, 'price_minor', line.price_minor) * dealQty;
      for (const part of line.parts) {
        // B2: piece part extra × part qty × deal qty; g/ml part extra × deal qty.
        const extra = nonNegative(fn, 'extra_price_minor', part.extra_price_minor);
        const partQty = nonNegative(fn, 'part quantity', part.quantity);
        total += extra * (part.sale_unit === 'piece' ? partQty : 1n) * dealQty + charges(part.option_charges_minor);
      }
      return safe(fn, 'total', total);
    }
    case 'deal_part':
      return 0;
  }
}
