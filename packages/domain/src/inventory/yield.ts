// 08a I8: yield in basis points from a test cut, and the active profile. Browser-safe: no node:* import.

export const YIELD_BP_MIN = 1;
export const YIELD_BP_MAX = 50_000;

export interface YieldRow {
  yield_profile_id: string;
  yield_bp: number;
  created_at: number;
}

// round_half_up(ep × 10 000 / ap); the 1 … 1e9 quantity bounds are the route's (§6.7). Throws outside 1 … 50 000 or on a non-positive / non-integer quantity.
export function yieldBpFromTest(ap: number, ep: number): number {
  if (!Number.isSafeInteger(ap) || !Number.isSafeInteger(ep) || ap < 1 || ep < 1) throw new RangeError('test quantities must be positive integers');
  const a = BigInt(ap);
  const bp = Number((2n * BigInt(ep) * 10_000n + a) / (2n * a));
  if (bp < YIELD_BP_MIN || bp > YIELD_BP_MAX) throw new RangeError('yield out of range');
  return bp;
}

// The latest row (created_at, then id); none → null.
export function activeYield<T extends YieldRow>(rows: readonly T[]): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (best === null || row.created_at > best.created_at || (row.created_at === best.created_at && row.yield_profile_id > best.yield_profile_id)) best = row;
  }
  return best;
}
