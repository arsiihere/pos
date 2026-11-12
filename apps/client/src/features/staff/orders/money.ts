import { allocateDealMinor } from '@pos/domain';
import { shownRupees } from '../../owner/money';

// 02b §8 Rules (R20; handoff CHANGES Q14): money as "Rs 2,200" — commas in threes, Latin digits, the same text in
// Urdu and English, set LTR (`MONEY_DIR` on the element) so an Urdu line never mirrors it. Amounts are minor units
// (paisa); the hub's numbers are shown, never recomputed, except the §3.4 share rule below.

/** "Rs 3,200" for 320000; "Rs 12.50" for 1250; a negative amount "-Rs 200". */
export function money(minor: number): string {
  if (!Number.isSafeInteger(minor)) throw new Error('money: minor units must be a safe integer');
  const text = `Rs ${shownRupees(Math.abs(minor))}`;
  return minor < 0 ? `-${text}` : text;
}

/** The `dir` of an element that shows money, in both languages. */
export const MONEY_DIR = 'ltr' as const;

/** The §3.4 counters a share needs (a LineView has them). */
export interface ShareLine {
  refundable_minor: number;
  units: number;
  comped_units: number;
  removed_units: number;
  voided_units: number;
}

/**
 * 02b §3.4 ledger (the hub's `lineShares`, orders/ledger.ts): shares = allocateDealMinor(refundable, [1 × units]) —
 * every share floor(refundable / units), the last one the remainder too. Units leave billing in order: the k-th unit
 * (k = comped + removed + voided) takes shares[k]. The amount `n` more units would take now (a comp's value), or
 * null when the line has fewer than `n` free units or no units (a pending weight has units 1, refundable 0 → 0).
 * One line only: a deal's money lives in its parts and a parent's options in their child lines (§3.4 cascades).
 */
export function nextShareMinor(line: ShareLine, n: number): number | null {
  if (!Number.isSafeInteger(n) || n < 0 || !Number.isSafeInteger(line.units) || line.units < 1) return null;
  const out = line.comped_units + line.removed_units + line.voided_units;
  if (out < 0 || out + n > line.units || line.refundable_minor < 0) return null;
  const shares = allocateDealMinor(line.refundable_minor, Array.from({ length: line.units }, () => 1));
  let total = 0;
  for (let k = out; k < out + n; k += 1) total += shares[k] as number;
  return total;
}
