import { describe, expect, it } from 'vitest';
import * as root from './index';
import { lineTotalMinor } from './line-total';
import { allocateDealMinor, childQuantity, optionChargeMinor, orderLineTotalMinor } from './menu-lines';

// Deterministic 64-bit LCG (Knuth MMIX constants); no Math.random (F §6.7). Returns an integer in [0, max].
function makeRng(seed: bigint): (max: number) => number {
  let s = seed;
  return (max: number) => {
    s = (s * 6364136223846793005n + 1442695040888963407n) & 0xffff_ffff_ffff_ffffn;
    return Number((s >> 8n) % (BigInt(max) + 1n));
  };
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

describe('menu-lines: child quantity and plain option charge (§3.4.2, §3.4.3)', () => {
  it('[01c #1] childQuantity(3, 2, piece) = 6 (piece parent × 2)', () => {
    expect(childQuantity(3, 2, 'piece')).toBe(6);
  });

  it('[01c #2] childQuantity(3, 1250, g) = 3 (weighted parent)', () => {
    expect(childQuantity(3, 1250, 'g')).toBe(3);
    expect(childQuantity(3, 1500, 'ml')).toBe(3);
  });

  it('[01c #3] optionChargeMinor(8000, 1, 2, piece) = 16 000', () => {
    expect(optionChargeMinor(8000, 1, 2, 'piece')).toBe(16_000);
  });

  it('[01c #4] optionChargeMinor(8000, 1, 1250, g) = 8 000 (once per line)', () => {
    expect(optionChargeMinor(8000, 1, 1250, 'g')).toBe(8_000);
  });

  it('[01c §3.4.3] non-integer or negative inputs and non-safe results throw', () => {
    expect(() => childQuantity(1.5, 2, 'piece')).toThrow();
    expect(() => childQuantity(1, -1, 'piece')).toThrow();
    expect(() => optionChargeMinor(-1, 1, 1, 'piece')).toThrow();
    expect(() => optionChargeMinor(1_000_000_000, 20, 1_000_000, 'piece')).toThrow('optionChargeMinor: charge is not a safe integer');
  });
});

describe('menu-lines: deal allocation (V11 c)', () => {
  it('[01c #5] allocateDealMinor(1000, [600, 400]) = [600, 400] (exact)', () => {
    expect(allocateDealMinor(1000, [600, 400])).toEqual([600, 400]);
  });

  it('[01c #6] allocateDealMinor(1000, [1, 1, 1]) = [333, 333, 334]; sum always equals total over 1 000 random cases', () => {
    expect(allocateDealMinor(1000, [1, 1, 1])).toEqual([333, 333, 334]);
    // #104: totals across 0 … 1 000 000 000, weights up to lineTotalMinor's largest result (Number.MAX_SAFE_INTEGER).
    const rng = makeRng(20261029n);
    for (let i = 0; i < 1000; i++) {
      const total = rng(1_000_000_000);
      const n = 1 + rng(9);
      const scale = [9, 1000, 1_000_000_000, Number.MAX_SAFE_INTEGER][rng(3)] as number;
      const weights = Array.from({ length: n }, () => (rng(4) === 0 ? 0 : rng(scale)));
      const shares = allocateDealMinor(total, weights);
      expect(shares).toHaveLength(n);
      expect(shares.reduce((a, b) => a + BigInt(b), 0n)).toBe(BigInt(total));
      for (const s of shares) {
        expect(Number.isSafeInteger(s)).toBe(true);
        expect(s).toBeGreaterThanOrEqual(0);
      }
      if (weights.some((w) => w > 0)) {
        weights.forEach((w, k) => {
          if (w === 0 && k < n - 1) expect(shares[k]).toBe(0);
        });
      }
    }
  });

  it('[01c #7] zero-price part gets 0; equal split only when every weight is 0', () => {
    expect(allocateDealMinor(1000, [0, 500])).toEqual([0, 1000]);
    expect(allocateDealMinor(1000, [0, 0])).toEqual([500, 500]);
    expect(allocateDealMinor(1000, [0, 0, 0])).toEqual([333, 333, 334]);
  });

  it('[01c #8] Family karahi deal: [229315, 12508, 78177] whichever naan is chosen; Roghni ×4 naan part = 24 508', () => {
    // Weights from each part's reference choice (first by sort_order): Full karahi 220 000 × 1, plain Naan 3 000 × 4, Lassi jug 75 000 × 1.
    const reference = { karahi: 220_000, naan: 3_000, lassi: 75_000 };
    // The weights never look at the chosen naan, so both picks build the same inputs.
    const referenceWeights = (): number[] => [
      lineTotalMinor(reference.karahi, 1, 'piece'),
      lineTotalMinor(reference.naan, 4 * 1, 'piece'),
      lineTotalMinor(reference.lassi, 1, 'piece'),
    ];
    const plain = allocateDealMinor(320_000 * 1, referenceWeights()); // plain Naan chosen
    const roghni = allocateDealMinor(320_000 * 1, referenceWeights()); // Roghni chosen
    expect(plain).toEqual([229_315, 12_508, 78_177]);
    expect(roghni).toEqual(plain);
    // Roghni extra +3 000 per piece × part qty 4 × deal qty 1, added on top to the naan part only.
    const roghniExtra = 3_000 * 4 * 1;
    expect((roghni[1] as number) + roghniExtra).toBe(24_508);
  });

  it('[01c #102] per-unit void split: [39088, 39089] and [3127, 3127, 3127, 3127]; sum equals the input', () => {
    const a = allocateDealMinor(78_177, [1, 1]);
    expect(a).toEqual([39_088, 39_089]);
    expect(sum(a)).toBe(78_177);
    const b = allocateDealMinor(12_508, [1, 1, 1, 1]);
    expect(b).toEqual([3_127, 3_127, 3_127, 3_127]);
    expect(sum(b)).toBe(12_508);
  });

  it('[01c #103] allocation by the reference choice equals for both picks; chosen-item weighting would give [220689, 24075, 75236]', () => {
    const byReference = allocateDealMinor(320_000, [220_000, lineTotalMinor(3_000, 4, 'piece'), 75_000]);
    expect(byReference).toEqual([229_315, 12_508, 78_177]);
    const byChosenRoghni = allocateDealMinor(320_000, [220_000, lineTotalMinor(6_000, 4, 'piece'), 75_000]);
    expect(byChosenRoghni).toEqual([220_689, 24_075, 75_236]);
    expect(byChosenRoghni).not.toEqual(byReference);
  });

  it('[01c #104] BigInt allocation [47_960_821, 47_960_821]; float floor gives [47_960_820, 47_960_822]; non-safe total throws', () => {
    const w = 199_714_492_077_708;
    expect(allocateDealMinor(95_921_642, [w, w])).toEqual([47_960_821, 47_960_821]);
    const floatFirst = Math.floor((95_921_642 * w) / (w + w));
    expect([floatFirst, 95_921_642 - floatFirst]).toEqual([47_960_820, 47_960_822]);
    expect(() => allocateDealMinor(Number.MAX_SAFE_INTEGER + 1, [1, 1])).toThrow();
    expect(() => allocateDealMinor(1.5, [1, 1])).toThrow();
    expect(() => allocateDealMinor(100, [1, -1])).toThrow();
    expect(() => allocateDealMinor(100, [1, Number.MAX_SAFE_INTEGER + 1])).toThrow();
    expect(() => allocateDealMinor(100, [])).toThrow();
  });
});

describe('menu-lines: order-line totals (§3.4.4, V11 a, V18)', () => {
  it('[01c #9] item lines: 1.25 kg karahi + raita = 283 000; 2 × Half + raita = 246 000', () => {
    expect(
      orderLineTotalMinor({ line_kind: 'item', price_minor: 220_000, quantity: 1250, sale_unit: 'g', option_charges_minor: [optionChargeMinor(8000, 1, 1250, 'g')] }),
    ).toBe(275_000 + 8_000);
    expect(
      orderLineTotalMinor({ line_kind: 'item', price_minor: 115_000, quantity: 2, sale_unit: 'piece', option_charges_minor: [optionChargeMinor(8000, 1, 2, 'piece')] }),
    ).toBe(230_000 + 16_000);
  });

  it('[01c #10] Deal ×2 with a piece part extra 3 000 × part qty 4 → 640 000 + 24 000', () => {
    expect(
      orderLineTotalMinor({
        line_kind: 'deal',
        price_minor: 320_000,
        quantity: 2,
        parts: [
          { sale_unit: 'piece', quantity: 1, extra_price_minor: 0, option_charges_minor: [] },
          { sale_unit: 'piece', quantity: 4, extra_price_minor: 3_000, option_charges_minor: [] },
          { sale_unit: 'piece', quantity: 1, extra_price_minor: 0, option_charges_minor: [] },
        ],
      }),
    ).toBe(640_000 + 24_000);
  });

  it('[01c #87] weighed line with quantity null → null; 1 250 g at 220 000 per kg + option 8 000 → 283 000', () => {
    expect(orderLineTotalMinor({ line_kind: 'item', price_minor: 220_000, quantity: null, sale_unit: 'g', option_charges_minor: [8_000] })).toBeNull();
    expect(orderLineTotalMinor({ line_kind: 'item', price_minor: 220_000, quantity: 1250, sale_unit: 'g', option_charges_minor: [8_000] })).toBe(283_000);
  });

  it('[01c #94] Deal Rs 1 500 × 2, 500 g Mutton part +50 000, naan × 2 → 400 000; plus a piece part 3 000 × 4 × 2 → +24 000', () => {
    const karahi = { sale_unit: 'g' as const, quantity: 500, extra_price_minor: 50_000, option_charges_minor: [] };
    const naan = { sale_unit: 'piece' as const, quantity: 2, extra_price_minor: 0, option_charges_minor: [] };
    expect(orderLineTotalMinor({ line_kind: 'deal', price_minor: 150_000, quantity: 2, parts: [karahi, naan] })).toBe(400_000);
    const extraPiece = { sale_unit: 'piece' as const, quantity: 4, extra_price_minor: 3_000, option_charges_minor: [] };
    expect(orderLineTotalMinor({ line_kind: 'deal', price_minor: 150_000, quantity: 2, parts: [karahi, naan, extraPiece] })).toBe(424_000);
  });

  it('[01c #95] Extra raita 8 000 on the 500 g karahi part: deal qty 2 → 16 000; deal qty 1 → 8 000', () => {
    expect(optionChargeMinor(8000, 1, 2, 'piece')).toBe(16_000);
    expect(optionChargeMinor(8000, 1, 1, 'piece')).toBe(8_000);
    const part = (dealQty: number) => ({ sale_unit: 'g' as const, quantity: 500, extra_price_minor: 0, option_charges_minor: [optionChargeMinor(8000, 1, dealQty, 'piece')] });
    expect(orderLineTotalMinor({ line_kind: 'deal', price_minor: 150_000, quantity: 2, parts: [part(2)] })).toBe(300_000 + 16_000);
    expect(orderLineTotalMinor({ line_kind: 'deal', price_minor: 150_000, quantity: 1, parts: [part(1)] })).toBe(150_000 + 8_000);
  });

  it('[01c §3.4.4] option_child priced per piece plus its charges; deal_part billed 0; root exports', () => {
    expect(orderLineTotalMinor({ line_kind: 'option_child', price_minor: 3_000, quantity: 6, option_charges_minor: [500] })).toBe(18_500);
    expect(orderLineTotalMinor({ line_kind: 'deal_part' })).toBe(0);
    expect(() => orderLineTotalMinor({ line_kind: 'item', price_minor: 1, quantity: 1, sale_unit: 'piece', option_charges_minor: [Number.MAX_SAFE_INTEGER] })).toThrow();
    expect(root.childQuantity).toBe(childQuantity);
    expect(root.optionChargeMinor).toBe(optionChargeMinor);
    expect(root.allocateDealMinor).toBe(allocateDealMinor);
    expect(root.orderLineTotalMinor).toBe(orderLineTotalMinor);
  });
});
