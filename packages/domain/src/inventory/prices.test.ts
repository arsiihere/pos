import { describe, expect, it } from 'vitest';
import * as root from '../index';
import { displayPer, effectiveMenuPrice, pricePerStockUnit, type PriceRow } from './prices';

// m-12: BIGINT columns reach the service as strings; the row values are built with BigInt(string).
const price = (
  id: string,
  o: { branch?: string | null; kind?: PriceRow['kind']; minor: string; num: string; den?: string; unit?: PriceRow['stock_unit']; at: number; until?: number | null },
): PriceRow => ({
  price_id: id,
  branch_id: o.branch ?? null,
  kind: o.kind ?? 'manual',
  unit_name: 'x',
  price_minor: BigInt(o.minor),
  stock_qty_num: BigInt(o.num),
  stock_qty_den: BigInt(o.den ?? '1'),
  stock_unit: o.unit ?? 'g',
  created_at: o.at,
  valid_until_at: o.until ?? null,
});

const H = 3_600_000;

describe('08a inventory prices', () => {
  it('[08a #3] pricePerStockUnit, exact, from string BIGINT values', () => {
    // Rs 1,500 / kg → 150 000 / 1 000 = 150/1 per g
    expect(pricePerStockUnit(price('p', { minor: '150000', num: '1000', at: 0 }))).toEqual({ num: 150n, den: 1n });
    // Rs 3,600 / peti (12 000 g) → 30/1 per g
    expect(pricePerStockUnit(price('p', { minor: '360000', num: '12000', at: 0 }))).toEqual({ num: 30n, den: 1n });
    // Rs 400 / darjan (12 pieces) → 10 000/3 per piece
    expect(pricePerStockUnit(price('p', { minor: '40000', num: '12', unit: 'piece', at: 0 }))).toEqual({ num: 10000n, den: 3n });
    // Rs 2,300 / l of ghee (920 g) → 250/1 per g
    expect(pricePerStockUnit(price('p', { minor: '230000', num: '920', at: 0 }))).toEqual({ num: 250n, den: 1n });
    // a fractional conversion: Rs 100 per piece of 365/2 g → 20 000 / 365 = 4000/73 per g
    expect(pricePerStockUnit(price('p', { minor: '10000', num: '365', den: '2', at: 0 }))).toEqual({ num: 4000n, den: 73n });
    expect(root.pricePerStockUnit).toBe(pricePerStockUnit);
  });

  it('[08a #4] effectiveMenuPrice: branch set first, latest wins, expiry, kind does not rank, other unit ignored, none → null', () => {
    const now = 100 * H;
    const manualOld = price('p1', { minor: '1000', num: '1', at: 10 * H });
    const marketEvery = price('p2', { kind: 'market_rate', minor: '1200', num: '1', at: 90 * H, until: 90 * H + 24 * H });
    const marketBranch = price('p3', { kind: 'market_rate', branch: 'b1', minor: '1300', num: '1', at: 95 * H, until: 95 * H + 24 * H });
    // branch market rate before every-branch
    expect(effectiveMenuPrice([manualOld, marketEvery, marketBranch], 'b1', now, 'g')).toBe(marketBranch);
    // another branch / no branch: every-branch set only; the newer market rate beats the older manual
    expect(effectiveMenuPrice([manualOld, marketEvery, marketBranch], 'b2', now, 'g')).toBe(marketEvery);
    expect(effectiveMenuPrice([manualOld, marketEvery, marketBranch], null, now, 'g')).toBe(marketEvery);
    // a market rate expired at its valid_until_at (24 h default) falls back to the older manual
    expect(effectiveMenuPrice([manualOld, marketEvery], null, 90 * H + 24 * H, 'g')).toBe(manualOld);
    expect(effectiveMenuPrice([manualOld, marketEvery], null, 90 * H + 24 * H - 1, 'g')).toBe(marketEvery);
    // an entered validity (72 h)
    const market72 = price('p4', { kind: 'market_rate', minor: '1400', num: '1', at: 50 * H, until: 50 * H + 72 * H });
    expect(effectiveMenuPrice([manualOld, market72], null, now, 'g')).toBe(market72);
    // a newer manual beats an older unexpired market rate
    const manualNew = price('p5', { minor: '1100', num: '1', at: 99 * H });
    expect(effectiveMenuPrice([manualOld, marketEvery, manualNew], null, now, 'g')).toBe(manualNew);
    // a branch market rate expires and the branch falls back to the every-branch price
    expect(effectiveMenuPrice([manualOld, marketBranch], 'b1', 95 * H + 24 * H, 'g')).toBe(manualOld);
    // latest created_at, then price_id
    const tieA = price('p7', { minor: '1', num: '1', at: 80 * H });
    const tieB = price('p8', { minor: '2', num: '1', at: 80 * H });
    expect(effectiveMenuPrice([tieB, tieA], null, now, 'g')).toBe(tieB);
    // not yet in effect (created_at > now)
    expect(effectiveMenuPrice([price('p9', { minor: '1', num: '1', at: now + 1 })], null, now, 'g')).toBeNull();
    // rows in another stock unit ignored
    const piece = price('p6', { minor: '5000', num: '1', unit: 'piece', at: 99 * H });
    expect(effectiveMenuPrice([manualOld, piece], null, now, 'g')).toBe(manualOld);
    expect(effectiveMenuPrice([piece], null, now, 'g')).toBeNull();
    // none → null (never 0)
    expect(effectiveMenuPrice([], 'b1', now, 'g')).toBeNull();
  });

  it('[08a #6] displayPer: per kg / l / piece, half up; > 0 never shows 0; exact beyond 2^53', () => {
    // Rs 1,500 / kg on a g item
    expect(displayPer({ num: 150n, den: 1n }, 'g')).toEqual({ unit: 'kg', minor: '150000', below_one_minor: false });
    expect(displayPer({ num: 1n, den: 4n }, 'ml')).toEqual({ unit: 'l', minor: '250', below_one_minor: false });
    // half up: 10 000/3 per piece → 3333.33 → 3333; 5/2 → 3
    expect(displayPer({ num: 10000n, den: 3n }, 'piece')).toEqual({ unit: 'piece', minor: '3333', below_one_minor: false });
    expect(displayPer({ num: 5n, den: 2n }, 'piece')).toEqual({ unit: 'piece', minor: '3', below_one_minor: false });
    // m-1: Rs 3 per peti of 1 000 pieces → 0.3 minor per piece → "1", below_one_minor
    expect(displayPer(pricePerStockUnit(price('p', { minor: '300', num: '1000', unit: 'piece', at: 0 })), 'piece')).toEqual({
      unit: 'piece',
      minor: '1',
      below_one_minor: true,
    });
    // 1e9 minor per unit of 1/1e6 g → 1e15 per g → 1e18 per kg, exact as a string
    expect(displayPer(pricePerStockUnit(price('p', { minor: '1000000000', num: '1', den: '1000000', at: 0 })), 'g')).toEqual({
      unit: 'kg',
      minor: '1000000000000000000',
      below_one_minor: false,
    });
  });
});
