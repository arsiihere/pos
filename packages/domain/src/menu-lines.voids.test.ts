// 01c §3.4.8 (N1, P4, Q4): void-refund conformance. 04 implements the rules; this test-only reference model pins them now.
// Every share comes from the exported allocateDealMinor; the model never reimplements the split.
import { describe, expect, it } from 'vitest';
import { lineTotalMinor } from './line-total';
import { allocateDealMinor, orderLineTotalMinor } from './menu-lines';
import type { Unit } from './units';

// Deterministic 64-bit LCG (Knuth MMIX constants), as in menu-lines.test.ts; no Math.random (F §6.7). Integer in [0, max].
function makeRng(seed: bigint): (max: number) => number {
  let s = seed;
  return (max: number) => {
    s = (s * 6364136223846793005n + 1442695040888963407n) & 0xffff_ffff_ffff_ffffn;
    return Number((s >> 8n) % (BigInt(max) + 1n));
  };
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

// ---- Reference model (§3.4.8, §4.4 04: per line the refundable amount, units, units voided, refunded so far) ----

interface Line {
  refundable: number;
  units: number;
  voided: number;
  refunded: number;
}

const line = (refundable: number, units: number): Line => ({ refundable, units, voided: 0, refunded: 0 });
const remaining = (l: Line): number => l.units - l.voided;

// Per-unit voids in void order: the k-th unit gets share k of allocateDealMinor(refundable, [1 × n]); the last remaining
// unit gets the remainder (refundable − refunded so far). Returns the refund of this void.
function voidUnits(l: Line, count: number): number {
  if (!Number.isSafeInteger(count) || count < 1 || count > remaining(l)) throw new Error('voidUnits: bad count');
  const shares = allocateDealMinor(l.refundable, Array.from({ length: l.units }, () => 1));
  let refund = 0;
  for (let i = 0; i < count; i++) {
    const share = l.voided === l.units - 1 ? l.refundable - l.refunded : (shares[l.voided] as number);
    l.voided += 1;
    l.refunded += share;
    refund += share;
  }
  return refund;
}

// A cascade voids every remaining unit and refunds only what is left.
function voidRest(l: Line): number {
  const refund = l.refundable - l.refunded;
  l.voided = l.units;
  l.refunded = l.refundable;
  return refund;
}

interface Child {
  line: Line;
  optionQuantity: number | null; // §4.3 Q4: set when placed in the parent's SubmitOrder, null when added later
}
interface Parent {
  line: Line;
  saleUnit: Unit; // piece: one unit per piece; g/ml: one unit, voided whole only
  children: Child[];
}

function voidParentWhole(p: Parent): { parent: number; children: number[] } {
  return { parent: voidRest(p.line), children: p.children.map((c) => voidRest(c.line)) };
}

// P4, Q4: k units of a piece parent void k × option_quantity units of each child with option_quantity set (clamped);
// children with null are untouched; the parent's last unit voids every remaining child unit.
function voidParentUnits(p: Parent, k: number): { parent: number; children: number[] } {
  if (p.saleUnit !== 'piece') throw new Error('voidParentUnits: a g/ml parent is voided whole only');
  const parent = voidUnits(p.line, k);
  const children = p.children.map((c) => {
    if (remaining(p.line) === 0) return voidRest(c.line);
    if (c.optionQuantity === null || remaining(c.line) === 0) return 0;
    return voidUnits(c.line, Math.min(k * c.optionQuantity, remaining(c.line)));
  });
  return { parent, children };
}

interface Deal {
  lineTotal: number;
  parts: Line[]; // refundable = allocated_price_minor + its charges; unit = one deal portion
  voided: boolean;
}

// Voiding the deal voids every remaining part unit and refunds the line total minus every refund already made on its parts.
function voidDeal(d: Deal): number {
  const refund = d.lineTotal - sum(d.parts.map((p) => p.refunded));
  const perPart = sum(d.parts.map((p) => voidRest(p)));
  expect(perPart).toBe(refund);
  d.voided = true;
  return refund;
}

const dealRefunded = (d: Deal): number => sum(d.parts.map((p) => p.refunded));

// ---- Tests ----

describe('menu-lines: void refunds never exceed what was billed (§3.4.8, N1)', () => {
  it('[01c #117] family karahi deal ×1: void 2 of 4 naan → 3 127 + 3 127; void the deal → 313 746; total 320 000', () => {
    expect(allocateDealMinor(12508, [1, 1, 1, 1])).toEqual([3127, 3127, 3127, 3127]);
    const naan = line(12508, 4);
    // The other parts carry the rest of the deal line; their split does not change the deal refund.
    const rest = line(320000 - 12508, 1);
    const deal: Deal = { lineTotal: 320000, parts: [rest, naan], voided: false };

    expect(voidUnits(naan, 1)).toBe(3127);
    expect(voidUnits(naan, 1)).toBe(3127);
    expect(naan.refunded).toBe(6254);
    expect(naan.voided).toBe(2);

    expect(voidDeal(deal)).toBe(313746);
    expect(dealRefunded(deal)).toBe(320000);
    expect(naan.refunded).toBe(12508);
    expect(naan.voided).toBe(4);
  });

  it('[01c #118] g/ml part voided per deal portion: 192 241 × 2 = 384 482; void the deal → 15 518; total 400 000', () => {
    // Test 94's deal Rs 1 500 × 2: weights 220 000 / 12 000 over 300 000 → 284 482 / 15 518.
    expect(allocateDealMinor(300000, [220000, 12000])).toEqual([284482, 15518]);
    const partA = line(284482 + 50000 * 2, 2); // 500 g Mutton (+50 000 per deal): 2 units, one per deal, never per gram
    const partB = line(15518, 2 * 2); // naan × 2 per deal
    const deal: Deal = { lineTotal: 400000, parts: [partA, partB], voided: false };
    expect(partA.refundable).toBe(384482);

    expect(voidUnits(partA, 1)).toBe(192241);
    expect(voidUnits(partA, 1)).toBe(192241);
    expect(partA.refunded).toBe(384482);

    expect(voidDeal(deal)).toBe(15518);
    expect(dealRefunded(deal)).toBe(400000);
    expect(partB.refunded).toBe(15518);
  });

  it('[01c #126] partial parent voids cascade k × option_quantity into placed children; later children wait for the last unit', () => {
    const naanTotal = orderLineTotalMinor({ line_kind: 'option_child', price_minor: 3000, quantity: 6, option_charges_minor: [] });
    expect(naanTotal).toBe(18000);
    expect(allocateDealMinor(18000, [1, 1, 1, 1, 1, 1])).toEqual([3000, 3000, 3000, 3000, 3000, 3000]);
    // Karahi 220 000 per piece is an invented price for this test (deferred minor: no spec example fixes it).
    const karahi = (): Line => line(440000, 2);

    // Karahi × 2, Naan option_quantity 3 (child line 6 naan, 18 000).
    const a: Parent = { line: karahi(), saleUnit: 'piece', children: [{ line: line(18000, 6), optionQuantity: 3 }] };
    expect(voidParentUnits(a, 1)).toEqual({ parent: 220000, children: [9000] });
    expect(a.children[0]?.line.voided).toBe(3);
    expect(voidParentUnits(a, 1)).toEqual({ parent: 220000, children: [9000] });
    expect(a.children[0]?.line.refunded).toBe(18000);
    expect(a.children[0]?.line.voided).toBe(6);

    // Variant: 2 naan on their own first, then 1 karahi → 3 more naan; the last karahi → the last 1 naan.
    const b: Parent = { line: karahi(), saleUnit: 'piece', children: [{ line: line(18000, 6), optionQuantity: 3 }] };
    const bNaan = b.children[0]?.line as Line;
    expect(voidUnits(bNaan, 2)).toBe(6000);
    expect(voidParentUnits(b, 1)).toEqual({ parent: 220000, children: [9000] });
    expect(bNaan.voided).toBe(5);
    expect(voidParentUnits(b, 1)).toEqual({ parent: 220000, children: [3000] });
    expect(bNaan.voided).toBe(6);
    expect(bNaan.refunded).toBe(18000);

    // Clamp case: a non-last parent unit whose cascade (k × option_quantity) exceeds the child's remaining units.
    // Karahi × 3 (660 000 → 220 000 per unit), Naan option_quantity 2 → child line 6 naan, 18 000 (3 000 each).
    const e: Parent = { line: line(660000, 3), saleUnit: 'piece', children: [{ line: line(18000, 6), optionQuantity: 2 }] };
    const eNaan = e.children[0]?.line as Line;
    expect(voidUnits(eNaan, 5)).toBe(15000);
    expect(remaining(eNaan)).toBe(1);
    expect(voidParentUnits(e, 1)).toEqual({ parent: 220000, children: [3000] }); // wants 2 naan, clamped to the 1 left
    expect(eNaan.voided).toBe(6);
    expect(eNaan.refunded).toBe(18000);
    expect(voidParentUnits(e, 2)).toEqual({ parent: 440000, children: [0] });
    expect(e.line.refunded).toBe(660000);
    expect(eNaan.refunded).toBe(18000);

    // A 1.25 kg karahi (g) with 3 naan: voided whole only (one unit); its naan follow.
    const gTotal = lineTotalMinor(220000, 1250, 'g');
    expect(gTotal).toBe(275000);
    const c: Parent = { line: line(gTotal, 1), saleUnit: 'g', children: [{ line: line(9000, 3), optionQuantity: 3 }] };
    expect(() => voidParentUnits(c, 1)).toThrow('voided whole only');
    expect(voidParentWhole(c)).toEqual({ parent: 275000, children: [9000] });
    expect(c.children[0]?.line.voided).toBe(3);

    // Q4: a naan added later (quantity 1, option_quantity null, 3 000) is untouched until the last karahi.
    const d: Parent = {
      line: karahi(),
      saleUnit: 'piece',
      children: [
        { line: line(18000, 6), optionQuantity: 3 },
        { line: line(3000, 1), optionQuantity: null },
      ],
    };
    expect(voidParentUnits(d, 1)).toEqual({ parent: 220000, children: [9000, 0] });
    expect(d.children[1]?.line.voided).toBe(0);
    expect(voidParentUnits(d, 1)).toEqual({ parent: 220000, children: [9000, 3000] });
    expect(d.children.map((ch) => ch.line.refunded)).toEqual([18000, 3000]);
  });

  it('[01c #119] 1 000 random deals and void sequences: refunds within bounds after every step, exact once all voided', () => {
    const rng = makeRng(20261029119n);
    let steps = 0;
    for (let i = 0; i < 1000; i++) {
      // Deal: price × qty allocated over parts by weight; each part adds its extras and option charges (§3.4.4, B2).
      // The deal line total comes from orderLineTotalMinor over the generator's numbers, never from the parts' refundable
      // amounts, so the exact-refund checks below hold only if allocateDealMinor sums to its input.
      const dealQty = 1 + rng(4);
      const dealPrice = rng(1_000_000);
      const nParts = 1 + rng(9);
      const specs = Array.from({ length: nParts }, () => {
        const piece = rng(1) === 0;
        return {
          sale_unit: (piece ? 'piece' : 'g') as Unit,
          quantity: piece ? 1 + rng(5) : 100 + rng(1_900),
          extra_price_minor: rng(2) === 0 ? rng(10_000) : 0,
          option_charges_minor: rng(2) === 0 ? [rng(50_000)] : [],
        };
      });
      const lineTotal = orderLineTotalMinor({ line_kind: 'deal', price_minor: dealPrice, quantity: dealQty, parts: specs }) as number;
      const allocated = allocateDealMinor(
        dealPrice * dealQty,
        Array.from({ length: nParts }, () => (rng(4) === 0 ? 0 : rng(1_000_000))),
      );
      const parts = specs.map((sp, k) => {
        const piece = sp.sale_unit === 'piece';
        const extras = sp.extra_price_minor * (piece ? sp.quantity : 1) * dealQty + sum(sp.option_charges_minor);
        // piece part: part qty × deal qty units; g/ml part: one unit per deal portion.
        return line((allocated[k] as number) + extras, piece ? sp.quantity * dealQty : dealQty);
      });
      const deal: Deal = { lineTotal, parts, voided: false };

      // Parent item lines with placed children (option_quantity set) and some later-added children (null).
      const parents: Parent[] = Array.from({ length: rng(3) }, () => {
        const piece = rng(2) !== 0;
        const qty = piece ? 1 + rng(4) : 1;
        const children: Child[] = Array.from({ length: rng(3) }, () => {
          const optQty = 1 + rng(3);
          return { line: line(rng(3) === 0 ? rng(5) : rng(1_000_000), piece ? optQty * qty : optQty), optionQuantity: optQty };
        });
        for (let n = rng(2); n > 0; n--) children.push({ line: line(rng(1_000_000), 1 + rng(2)), optionQuantity: null });
        return { line: line(rng(3) === 0 ? rng(3) : rng(5_000_000), qty), saleUnit: piece ? 'piece' : 'g', children };
      });
      const allLines = [...parts, ...parents.flatMap((p) => [p.line, ...p.children.map((c) => c.line)])];

      // Bounds after every step, collected and asserted once per step (an expect per line is too slow for 1 000 cases).
      const violations = (): string[] => {
        const out: string[] = [];
        allLines.forEach((l, n) => {
          if (l.refunded < 0 || l.refunded > l.refundable || l.voided > l.units) out.push(`line ${n}: ${JSON.stringify(l)}`);
        });
        if (dealRefunded(deal) > deal.lineTotal) out.push(`deal: ${dealRefunded(deal)} > ${deal.lineTotal}`);
        parents.forEach((p, n) => {
          const group = [p.line, ...p.children.map((c) => c.line)];
          const refunded = sum(group.map((l) => l.refunded));
          const refundable = sum(group.map((l) => l.refundable));
          if (refunded > refundable) out.push(`parent ${n}: ${refunded} > ${refundable}`);
        });
        return out;
      };

      // Random mix of part-unit, deal, child-unit, partial-parent and whole-parent voids until nothing is left.
      for (;;) {
        const actions: Array<() => void> = [];
        if (!deal.voided) {
          for (const p of parts) if (remaining(p) > 0) actions.push(() => void voidUnits(p, 1 + rng(remaining(p) - 1)));
          if (rng(3) === 0 || actions.length === 0) actions.push(() => void voidDeal(deal));
        }
        for (const p of parents) {
          if (remaining(p.line) === 0) continue;
          for (const c of p.children) if (remaining(c.line) > 0) actions.push(() => void voidUnits(c.line, 1 + rng(remaining(c.line) - 1)));
          if (p.saleUnit === 'piece') actions.push(() => void voidParentUnits(p, 1 + rng(remaining(p.line) - 1)));
          actions.push(() => void voidParentWhole(p));
        }
        if (actions.length === 0) break;
        (actions[rng(actions.length - 1)] as () => void)();
        steps++;
        expect(violations()).toEqual([]);
      }

      for (const l of allLines) {
        expect(l.voided).toBe(l.units);
        expect(l.refunded).toBe(l.refundable);
      }
      expect(dealRefunded(deal)).toBe(deal.lineTotal);
      for (const p of parents) {
        const group = [p.line, ...p.children.map((c) => c.line)];
        expect(sum(group.map((l) => l.refunded))).toBe(sum(group.map((l) => l.refundable)));
      }
    }
    expect(steps).toBeGreaterThan(1000);
  });
});
