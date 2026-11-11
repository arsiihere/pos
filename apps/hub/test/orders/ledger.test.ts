// 02b §3.4 (O19–O21; 01c §3.4.8): the per-line money ledger, pure halves of tests #19, #20, #37, #38, #39.
// Plain counters in, numbers and payload drafts out. Deterministic LCG with a fixed seed (no Math.random, F §6.7).
import { allocateDealMinor, orderLineTotalMinor, type Unit } from '@pos/domain';
import { describe, expect, it } from 'vitest';
import {
  billedMinor,
  cascadeUnits,
  compUnits,
  gmlDealPartPartial,
  hasUnitOutOfBilling,
  type LedgerLine,
  lineShares,
  liveUnits,
  moneyOutMinor,
  planComp,
  planRemove,
  planVoid,
  removeUnits,
  voidUnits,
} from '../../src/orders/ledger';

type Kind = 'item' | 'option_child' | 'deal' | 'deal_part';

const fresh = (refundable_minor: number, units: number): LedgerLine => ({
  refundable_minor,
  units,
  comped_units: 0,
  removed_units: 0,
  voided_units: 0,
  comp_minor: 0,
  comp_voided_minor: 0,
  removed_minor: 0,
  refund_minor: 0,
});
const ref = (order_item_id: string, l: LedgerLine) => ({ order_item_id, ...l });
const parent = (order_item_id: string, line_kind: Kind, sale_unit: Unit, l: LedgerLine) => ({
  order_item_id,
  line_kind,
  sale_unit,
  ...l,
});
const itemBilled = (l: LedgerLine): number => billedMinor({ line_kind: 'item', line_total_minor: l.refundable_minor, ...l });
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

const meta = { reason_code: 'quality', note: null, requester_staff_id: 'S1', alert_id: null, approver_staff_id: null };

describe('02b ledger (§3.4)', () => {
  it('[02b §3.4] lineShares: shares k … k+n−1 of allocateDealMinor(refundable, [1 × units]); k counts every unit out', () => {
    expect(allocateDealMinor(10001, [1, 1, 1])).toEqual([3333, 3333, 3335]);
    const s = lineShares(fresh(10001, 3));
    expect(s.next_share_minor(0)).toBe(0);
    expect(s.next_share_minor(1)).toBe(3333);
    expect(s.next_share_minor(3)).toBe(10001);
    expect(lineShares({ ...fresh(10001, 3), removed_units: 1, comped_units: 1, comp_minor: 3333 }).next_share_minor(1)).toBe(3335);
    expect(lineShares({ ...fresh(10001, 3), voided_units: 2 }).next_share_minor(1)).toBe(3335);
    expect(() => s.next_share_minor(4)).toThrow();
    expect(() => s.comped_take_back_minor(1)).toThrow();
    // A weighed line still pending: 1 unit, 0 money.
    expect(lineShares(fresh(0, 1)).next_share_minor(1)).toBe(0);
  });

  it('[02b #19 pure] comp 2 then remove 2 of 2 naan → comp_minor 0, removed_minor 20 000, total ≥ 0', () => {
    const comped = compUnits(fresh(20000, 2), 2);
    expect(comped.value_minor).toBe(20000);
    expect(comped.after).toMatchObject({ comped_units: 2, comp_minor: 20000 });
    const removed = removeUnits(comped.after, 2);
    expect(removed.removed_minor).toBe(20000);
    expect(removed.after).toMatchObject({ comped_units: 0, comp_minor: 0, removed_units: 2, removed_minor: 20000 });
    expect(itemBilled(removed.after)).toBe(0);
  });

  it('[02b #19 pure] remove 1 then void 2 (ItemVoided from lineShares) → refunds = remaining shares, total 0', () => {
    const r = planRemove(parent('N', 'item', 'piece', fresh(10001, 3)), [], 1);
    expect(r.lines.map((l) => l.payload)).toEqual([{ order_item_id: 'N', units: 1 }]);
    expect(r.removed_minor).toBe(3333);
    const after = r.lines[0]?.after as LedgerLine;
    const v = planVoid(parent('N', 'item', 'piece', after), [], 2);
    expect(v.lines.map((l) => l.payload)).toEqual([{ order_item_id: 'N', units: 2, refund_minor: 6668, comp_voided_minor: 0 }]);
    const end = v.lines[0]?.after as LedgerLine;
    expect(end).toMatchObject({ removed_minor: 3333, refund_minor: 6668, voided_units: 2, removed_units: 1 });
    expect(itemBilled(end)).toBe(0);
  });

  it('[02b #19 pure] comp then void → comp_voided_minor, refund_minor 0 (O21); uncomped units go first', () => {
    const one = voidUnits(compUnits(fresh(10000, 1), 1).after, 1);
    expect(one).toMatchObject({ refund_minor: 0, comp_voided_minor: 10000 });
    expect(one.after).toMatchObject({ comp_minor: 0, comp_voided_minor: 10000, refund_minor: 0, comped_units: 0, voided_units: 1 });
    expect(itemBilled(one.after)).toBe(0);

    // 2 units, 1 comped: void 1 takes the uncomped unit (a refund); the next void takes the comp back (never a refund).
    const c = compUnits(fresh(20000, 2), 1).after;
    const v1 = voidUnits(c, 1);
    expect(v1).toMatchObject({ refund_minor: 10000, comp_voided_minor: 0 });
    expect(v1.after).toMatchObject({ comped_units: 1, comp_minor: 10000 });
    const v2 = voidUnits(v1.after, 1);
    expect(v2).toMatchObject({ refund_minor: 0, comp_voided_minor: 10000 });
    expect(v2.after).toMatchObject({ refund_minor: 10000, comp_voided_minor: 10000, comp_minor: 0, comped_units: 0, voided_units: 2 });
  });

  it('[02b #19 pure] remainder share comped then taken back (3 units of 10 001) → take-back 3 335 first', () => {
    const c = compUnits(fresh(10001, 3), 3);
    expect(c.value_minor).toBe(10001);
    expect(lineShares(c.after).comped_take_back_minor(1)).toBe(3335);
    expect(lineShares(c.after).comped_take_back_minor(3)).toBe(10001);
    const r1 = removeUnits(c.after, 1);
    expect(r1.removed_minor).toBe(3335);
    // The unit moves from comped_units to removed_units.
    expect(r1.after).toMatchObject({ comped_units: 2, removed_units: 1, comp_minor: 6666, removed_minor: 3335 });
    const v1 = voidUnits(r1.after, 1);
    expect(v1).toMatchObject({ refund_minor: 0, comp_voided_minor: 3333 });
    expect(v1.after).toMatchObject({ comped_units: 1, voided_units: 1, comp_minor: 3333 });

    // A comp without the remainder share: its take-back is q.
    const a = compUnits(removeUnits(fresh(10001, 3), 1).after, 1).after; // remove share 0, comp share 1
    expect(a.comp_minor).toBe(3333);
    const v = voidUnits(a, 2); // uncomped unit (share 2, the remainder) first, then the comped one
    expect(v).toMatchObject({ refund_minor: 3335, comp_voided_minor: 3333 });
    expect(moneyOutMinor(v.after)).toBe(10001);
  });

  it('[02b #19 pure] comp then weight: a line with any unit out of billing is settled (LINE_ALREADY_SETTLED predicate)', () => {
    // A weighed g line (LineWeightSet folded: refundable = line total); a pending one cannot be comped (LINE_WEIGHT_PENDING).
    const weighed = fresh(275000, 1);
    expect(hasUnitOutOfBilling(weighed)).toBe(false);
    expect(hasUnitOutOfBilling(compUnits(weighed, 1).after)).toBe(true);
    expect(hasUnitOutOfBilling(removeUnits(fresh(100, 2), 1).after)).toBe(true);
    expect(hasUnitOutOfBilling(voidUnits(fresh(100, 2), 1).after)).toBe(true);
  });

  it('[02b §3.4] unit bounds: remove / void ≤ live units, comp ≤ live − comped, n ≥ 1', () => {
    const l = compUnits(removeUnits(fresh(300, 3), 1).after, 1).after; // live 2, comped 1
    expect(liveUnits(l)).toBe(2);
    expect(() => removeUnits(l, 3)).toThrow();
    expect(() => voidUnits(l, 3)).toThrow();
    expect(() => compUnits(l, 2)).toThrow();
    expect(() => compUnits(l, 0)).toThrow();
    expect(() => removeUnits(l, 1.5)).toThrow();
    expect(compUnits(l, 1).value_minor).toBe(100);
  });

  it('[02b §3.4] billed_minor: item / option_child = refundable − out; deal_part 0; deal = total − Σ parts out', () => {
    const l = removeUnits(compUnits(fresh(9000, 3), 1).after, 1).after;
    expect(billedMinor({ line_kind: 'item', line_total_minor: 9000, ...l })).toBe(3000);
    expect(billedMinor({ line_kind: 'option_child', line_total_minor: 9000, ...l })).toBe(3000);
    expect(billedMinor({ line_kind: 'deal_part', line_total_minor: 0, ...l })).toBe(0);
    // Weight pending: refundable 0, total null.
    expect(billedMinor({ line_kind: 'item', line_total_minor: null, ...fresh(0, 1) })).toBe(0);
    expect(billedMinor({ line_kind: 'deal', line_total_minor: 320000, ...fresh(0, 1) }, [l, fresh(1, 1)])).toBe(320000 - 6000);
    expect(() => billedMinor({ line_kind: 'item', line_total_minor: 1, ...fresh(1, 1) }, [l])).toThrow();
  });

  // ---- #37 deals (family deal ×1 = 320 000; naan part 12 508 over 4 units, the rest one part, 01c #117) ----

  const familyDeal = (qty: number) => ({
    deal: parent('D', 'deal', 'piece', fresh(0, qty)),
    naan: ref('NAAN', fresh(12508 * qty, 4 * qty)),
    rest: ref('REST', fresh((320000 - 12508) * qty, qty)),
  });

  it('[02b #37 pure] 04 voids 1 of 4 naan parts → 12 508 / 4 on the part, deal billed 320 000 − that; void the deal → total − parts refunded', () => {
    const { deal, naan, rest } = familyDeal(1);
    // Untouched: the deal bills its total, every part 0.
    expect(billedMinor({ ...deal, line_total_minor: 320000 }, [naan, rest])).toBe(320000);
    expect(billedMinor({ ...naan, line_kind: 'deal_part', line_total_minor: 0 })).toBe(0);
    expect(billedMinor({ ...rest, line_kind: 'deal_part', line_total_minor: 0 })).toBe(0);

    const v1 = planVoid(parent('NAAN', 'deal_part', 'piece', naan), [], 1);
    expect(v1.lines.map((l) => l.payload)).toEqual([{ order_item_id: 'NAAN', units: 1, refund_minor: 3127, comp_voided_minor: 0 }]);
    const naan1 = ref('NAAN', v1.lines[0]?.after as LedgerLine);
    expect(billedMinor({ ...deal, line_total_minor: 320000 }, [naan1, rest])).toBe(320000 - 3127);

    const vd = planVoid(deal, [naan1, rest], 1);
    expect(vd.refund_minor).toBe(320000 - 3127);
    expect(vd.lines.map((l) => l.payload)).toEqual([
      { order_item_id: 'D', units: 1, refund_minor: 0, comp_voided_minor: 0 },
      { order_item_id: 'NAAN', units: 3, refund_minor: 9381, comp_voided_minor: 0 },
      { order_item_id: 'REST', units: 1, refund_minor: 307492, comp_voided_minor: 0 },
    ]);
    const parts = vd.lines.slice(1).map((l) => l.after);
    expect(billedMinor({ ...deal, line_total_minor: 320000 }, parts)).toBe(0);
  });

  it('[02b #37 pure] remove 1 of 2 deals → each part loses its per-portion units, one ItemRemoved per line', () => {
    const { deal, naan, rest } = familyDeal(2);
    const r = planRemove(deal, [naan, rest], 1);
    expect(r.lines.map((l) => l.payload)).toEqual([
      { order_item_id: 'D', units: 1 },
      { order_item_id: 'NAAN', units: 4 },
      { order_item_id: 'REST', units: 1 },
    ]);
    expect(r.removed_minor).toBe(320000);
    expect(billedMinor({ ...deal, line_total_minor: 640000 }, r.lines.slice(1).map((l) => l.after))).toBe(320000);
  });

  it('[02b #37 pure] cascade capped: remove 1 naan part unit, then the whole deal → 3 naan units; void 1 naan, comp the deal → 3 naan comped', () => {
    const { deal, naan, rest } = familyDeal(1);
    const naan1 = ref('NAAN', removeUnits(naan, 1).after);
    expect(cascadeUnits('remove', deal, 1, naan1)).toBe(3);
    const r = planRemove(deal, [naan1, rest], 1);
    expect(r.lines.map((l) => l.payload)).toEqual([
      { order_item_id: 'D', units: 1 },
      { order_item_id: 'NAAN', units: 3 },
      { order_item_id: 'REST', units: 1 },
    ]);

    const naanV = ref('NAAN', voidUnits(naan, 1).after);
    const c = planComp(deal, [naanV, rest], 1, meta);
    expect(c.lines.map((l) => [l.order_item_id, l.units, l.payload.value_minor])).toEqual([
      ['D', 1, 0],
      ['NAAN', 3, 9381],
      ['REST', 1, 307492],
    ]);
    // The comp's value sums every line it touches; the deal's own LineComped carries only its own share (0).
    expect(c.value_minor).toBe(320000 - 3127);
    expect(billedMinor({ ...deal, line_total_minor: 320000 }, c.lines.slice(1).map((l) => l.after))).toBe(0);
  });

  it('[02b #37 pure] deal ×2 with a 1 kg karahi (g) part open → remove 1 deal is gml_deal_part_partial; remove both allowed', () => {
    const parts = [
      { sale_unit: 'g' as const, open_in_engine: true },
      { sale_unit: 'piece' as const, open_in_engine: true },
    ];
    expect(gmlDealPartPartial({ line_kind: 'deal', live_units: 2, units: 1, parts })).toBe(true);
    expect(gmlDealPartPartial({ line_kind: 'deal', live_units: 2, units: 2, parts })).toBe(false);
    // The g part served (no longer open): a partial is fine.
    expect(gmlDealPartPartial({ line_kind: 'deal', live_units: 2, units: 1, parts: [{ sale_unit: 'g', open_in_engine: false }] })).toBe(false);
    // Only piece parts: fine.
    expect(gmlDealPartPartial({ line_kind: 'deal', live_units: 2, units: 1, parts: [{ sale_unit: 'piece', open_in_engine: true }] })).toBe(false);
    // A g/ml deal_part alone (units = deal qty): partial refused while open, whole allowed.
    const self = [{ sale_unit: 'ml' as const, open_in_engine: true }];
    expect(gmlDealPartPartial({ line_kind: 'deal_part', live_units: 2, units: 1, parts: self })).toBe(true);
    expect(gmlDealPartPartial({ line_kind: 'deal_part', live_units: 2, units: 2, parts: self })).toBe(false);
    // Not a deal line: never.
    expect(gmlDealPartPartial({ line_kind: 'item', live_units: 2, units: 1, parts: self })).toBe(false);
  });

  // ---- #38 remake (O20): returned_units is not a ledger input ----

  it('[02b #38 pure] remade karahi stays billed; comp allowed; a void after the remake refunds its share', () => {
    const remade: LedgerLine & { returned_units: number } = { ...fresh(440000, 2), returned_units: 1 };
    expect(itemBilled(remade)).toBe(440000);
    expect(liveUnits(remade)).toBe(2);
    const c = planComp(parent('K', 'item', 'piece', remade), [], 1, meta);
    expect(c.lines.map((l) => l.payload)).toEqual([{ order_item_id: 'K', units: 1, value_minor: 220000, ...meta }]);
    const v = planVoid(parent('K', 'item', 'piece', remade), [], 1);
    expect(v.lines[0]?.payload).toEqual({ order_item_id: 'K', units: 1, refund_minor: 220000, comp_voided_minor: 0 });
    // Same numbers as a line never returned.
    expect(planVoid(parent('K', 'item', 'piece', fresh(440000, 2)), [], 1).refund_minor).toBe(220000);
  });

  // ---- #39 option children ----

  it('[02b #39 pure] option child capped: remove 1 of 3 child naans, then the karahi → 2 child units; one event per line', () => {
    const karahi = parent('K', 'item', 'piece', fresh(220000, 1));
    const naan = ref('C', removeUnits(fresh(9000, 3), 1).after);
    const r = planRemove(karahi, [naan], 1);
    expect(r.lines.map((l) => l.payload)).toEqual([
      { order_item_id: 'K', units: 1 },
      { order_item_id: 'C', units: 2 },
    ]);
    expect(r.removed_minor).toBe(220000 + 6000);

    // Partial piece parent: childQuantity per parent unit, clamped (01c #126): karahi ×3, naan 2 each, 5 naan gone.
    const k3 = parent('K', 'item', 'piece', fresh(660000, 3));
    const n6 = ref('C', removeUnits(fresh(18000, 6), 5).after);
    expect(cascadeUnits('remove', k3, 1, n6)).toBe(1);
    expect(cascadeUnits('void', k3, 1, ref('C', fresh(18000, 6)))).toBe(2);
    // A fully gone child yields no event.
    const gone = ref('C', removeUnits(fresh(18000, 6), 6).after);
    expect(planVoid(k3, [gone], 1).lines.map((l) => l.order_item_id)).toEqual(['K']);
    // A g/ml parent (1 unit) takes every child unit.
    const g = parent('G', 'item', 'g', fresh(275000, 1));
    expect(cascadeUnits('void', g, 1, ref('C', fresh(9000, 3)))).toBe(3);
    // The parent's last live unit takes every remaining child unit, even beyond its per-unit quantity (§3.4, 01c :312).
    const lastOne = parent('K', 'item', 'piece', voidUnits(fresh(440000, 2), 1).after);
    expect(cascadeUnits('remove', lastOne, 1, ref('C', fresh(18000, 6)))).toBe(6);
    expect(cascadeUnits('comp', lastOne, 1, ref('C', compUnits(fresh(18000, 6), 1).after))).toBe(5);
  });

  it('[02b #39 pure] comp cascade caps at live − comped; an approved comp: every LineComped carries the alert id and its own value', () => {
    const k2 = parent('K', 'item', 'piece', fresh(440000, 2));
    const n6 = ref('C', fresh(18000, 6));
    const approved = { ...meta, alert_id: 'A1', approver_staff_id: 'S2' };
    const c = planComp(k2, [n6], 1, approved);
    expect(c.lines.map((l) => l.payload)).toEqual([
      { order_item_id: 'K', units: 1, value_minor: 220000, ...approved },
      { order_item_id: 'C', units: 3, value_minor: 9000, ...approved },
    ]);
    expect(c.value_minor).toBe(229000);

    const n4 = ref('C', compUnits(fresh(18000, 6), 4).after); // 4 naan comped alone: 2 left to comp
    expect(cascadeUnits('comp', k2, 1, n4)).toBe(2);
    // The parent's last compable unit takes every remaining compable child unit.
    const k2c = parent('K', 'item', 'piece', compUnits(fresh(440000, 2), 1).after);
    const n3 = ref('C', compUnits(removeUnits(fresh(18000, 6), 2).after, 3).after); // live 4, comped 3
    expect(cascadeUnits('comp', k2c, 1, n3)).toBe(1);
    expect(() => planComp(parent('C', 'option_child', 'piece', fresh(1, 1)), [n6], 1, meta)).toThrow();
  });

  // ---- #20 property tests ----

  // Deterministic 64-bit LCG (Knuth MMIX constants), as packages/domain/src/menu-lines.voids.test.ts. Integer in [0, max].
  function makeRng(seed: bigint): (max: number) => number {
    let s = seed;
    return (max: number) => {
      s = (s * 6364136223846793005n + 1442695040888963407n) & 0xffff_ffff_ffff_ffffn;
      return Number((s >> 8n) % (BigInt(max) + 1n));
    };
  }

  // 01c #119's deal generator: the deal line total from orderLineTotalMinor; parts = allocated share + extras / charges.
  function genDeal(rng: (max: number) => number): { qty: number; lineTotal: number; parts: { refundable: number; units: number }[] } {
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
      return { refundable: (allocated[k] as number) + extras, units: piece ? sp.quantity * dealQty : dealQty };
    });
    return { qty: dealQty, lineTotal, parts };
  }

  it("[02b #20] a deal's money equals 01c #119's reference model through lineShares (1 000 deals, void sequences)", () => {
    // 01c #119's reference model (test-only, §3.4.8): the k-th voided unit gets share k, the last the remainder.
    interface RefLine {
      refundable: number;
      units: number;
      voided: number;
      refunded: number;
    }
    const refVoid = (l: RefLine, count: number): number => {
      const shares = allocateDealMinor(l.refundable, Array.from({ length: l.units }, () => 1));
      let refund = 0;
      for (let i = 0; i < count; i++) {
        const share = l.voided === l.units - 1 ? l.refundable - l.refunded : (shares[l.voided] as number);
        l.voided += 1;
        l.refunded += share;
        refund += share;
      }
      return refund;
    };
    const refRest = (l: RefLine): number => {
      const refund = l.refundable - l.refunded;
      l.voided = l.units;
      l.refunded = l.refundable;
      return refund;
    };

    const rng = makeRng(20261029119n);
    let steps = 0;
    for (let i = 0; i < 1000; i++) {
      const g = genDeal(rng);
      const model: RefLine[] = g.parts.map((p) => ({ refundable: p.refundable, units: p.units, voided: 0, refunded: 0 }));
      let deal = parent('D', 'deal', 'piece', fresh(0, g.qty));
      let parts = g.parts.map((p, k) => ref(`P${k}`, fresh(p.refundable, p.units)));
      expect(sum(parts.map((p) => p.refundable_minor))).toBe(g.lineTotal);

      while (liveUnits(deal) > 0) {
        const pick = rng(2);
        if (pick === 0) {
          // A part's own units (04 void of a deal_part alone).
          const live = parts.map((p, k) => [p, k] as const).filter(([p]) => liveUnits(p) > 0);
          if (live.length === 0) continue;
          const [p, k] = live[rng(live.length - 1)] as (typeof live)[number];
          const n = 1 + rng(liveUnits(p) - 1);
          const v = planVoid({ ...p, line_kind: 'deal_part', sale_unit: 'piece' }, [], n);
          expect(v.refund_minor).toBe(refVoid(model[k] as RefLine, n));
          parts[k] = ref(p.order_item_id, v.lines[0]?.after as LedgerLine);
        } else {
          // n deal portions: every part per portion, capped; the deal's last unit takes everything left (01c :311).
          const n = 1 + rng(liveUnits(deal) - 1);
          const last = n === liveUnits(deal);
          const expected = parts.map((p, k) => {
            const m = model[k] as RefLine;
            if (last) return refRest(m);
            return refVoid(m, Math.min((p.units / deal.units) * n, m.units - m.voided));
          });
          const v = planVoid(deal, parts, n);
          const byId = new Map(v.lines.map((l) => [l.order_item_id, l]));
          expect(parts.map((p) => byId.get(p.order_item_id)?.payload.refund_minor ?? 0)).toEqual(expected);
          deal = { ...deal, ...(byId.get('D')?.after as LedgerLine) };
          parts = parts.map((p) => {
            const l = byId.get(p.order_item_id);
            return l ? ref(p.order_item_id, l.after) : p;
          });
        }
        steps++;
        expect(parts.map((p) => p.refund_minor)).toEqual(model.map((m) => m.refunded));
        expect(billedMinor({ ...deal, line_total_minor: g.lineTotal }, parts)).toBe(g.lineTotal - sum(model.map((m) => m.refunded)));
      }
      // The deal's last unit took every part's last unit: refunds sum to the deal total exactly.
      expect(sum(parts.map((p) => p.refund_minor))).toBe(g.lineTotal);
      expect(billedMinor({ ...deal, line_total_minor: g.lineTotal }, parts)).toBe(0);
    }
    expect(steps).toBeGreaterThan(1000);
  });

  it('[02b #20] 1 000 random comp / remove / void / remake / weight sequences: CHECKs hold, Σ billed = Σ totals − Σ out, never negative', () => {
    interface L extends LedgerLine {
      order_item_id: string;
      line_kind: Kind;
      sale_unit: Unit;
      line_total_minor: number | null;
      parent: string | null;
      returned_units: number;
      weighed: boolean;
    }
    const rng = makeRng(20261110020n);
    let steps = 0;
    const kinds = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const lines = new Map<string, L>();
      let id = 0;
      const add = (l: Omit<L, keyof LedgerLine | 'order_item_id' | 'returned_units'> & { refundable: number; units: number }): L => {
        const { refundable, units, ...rest } = l;
        const line: L = { ...fresh(refundable, units), ...rest, order_item_id: `L${id++}`, returned_units: 0 };
        lines.set(line.order_item_id, line);
        return line;
      };
      // Item lines: piece (with option children) or g (1 unit; maybe weight pending), as 01c #119's parents.
      for (let n = 1 + rng(2); n > 0; n--) {
        const piece = rng(2) !== 0;
        const qty = piece ? 1 + rng(4) : 1;
        const pending = !piece && rng(1) === 0;
        const total = pending ? null : rng(3) === 0 ? rng(3) : rng(5_000_000);
        const p = add({ line_kind: 'item', sale_unit: piece ? 'piece' : 'g', line_total_minor: total, parent: null, weighed: !piece, refundable: total ?? 0, units: qty });
        for (let c = rng(3); c > 0; c--) {
          const optQty = 1 + rng(3);
          const ct = rng(3) === 0 ? rng(5) : rng(1_000_000);
          add({ line_kind: 'option_child', sale_unit: 'piece', line_total_minor: ct, parent: p.order_item_id, weighed: false, refundable: ct, units: piece ? optQty * qty : optQty });
        }
      }
      // Deals and their parts (01c #119 generator).
      for (let n = rng(2); n > 0; n--) {
        const g = genDeal(rng);
        const d = add({ line_kind: 'deal', sale_unit: 'piece', line_total_minor: g.lineTotal, parent: null, weighed: false, refundable: 0, units: g.qty });
        for (const part of g.parts) {
          add({ line_kind: 'deal_part', sale_unit: 'piece', line_total_minor: 0, parent: d.order_item_id, weighed: false, refundable: part.refundable, units: part.units });
        }
      }
      const all = (): L[] => [...lines.values()];
      const childrenOf = (p: L): L[] => all().filter((l) => l.parent === p.order_item_id);
      const apply = (planned: readonly { order_item_id: string; after: LedgerLine }[]): void => {
        for (const pl of planned) lines.set(pl.order_item_id, { ...(lines.get(pl.order_item_id) as L), ...pl.after });
      };
      const totalMinor = (l: L): number => (l.line_kind === 'deal' ? (l.line_total_minor ?? 0) : l.line_kind === 'deal_part' ? 0 : l.refundable_minor);
      const billedOf = (l: L): number => billedMinor(l, l.line_kind === 'deal' ? childrenOf(l) : []);

      const violations = (): string[] => {
        const out: string[] = [];
        for (const l of all()) {
          const cols = [l.comp_minor, l.comp_voided_minor, l.removed_minor, l.refund_minor, l.comped_units, l.removed_units, l.voided_units];
          if (cols.some((x) => x < 0)) out.push(`${l.order_item_id} negative`);
          if (l.removed_units + l.voided_units > l.units) out.push(`${l.order_item_id} units`);
          if (l.comped_units > liveUnits(l)) out.push(`${l.order_item_id} comped`);
          if (moneyOutMinor(l) > l.refundable_minor) out.push(`${l.order_item_id} money ${moneyOutMinor(l)} > ${l.refundable_minor}`);
          if (liveUnits(l) === 0 && moneyOutMinor(l) !== l.refundable_minor) out.push(`${l.order_item_id} not exact`);
          if (billedOf(l) < 0) out.push(`${l.order_item_id} billed < 0`);
        }
        const billed = sum(all().map(billedOf));
        const expected = sum(all().map(totalMinor)) - sum(all().map(moneyOutMinor));
        if (billed !== expected) out.push(`Σ billed ${billed} ≠ ${expected}`);
        return out;
      };

      for (let s = 0; s < 12; s++) {
        const candidates = all().filter((l) => liveUnits(l) > 0);
        if (candidates.length === 0) break;
        const l = candidates[rng(candidates.length - 1)] as L;
        const kids = l.line_kind === 'item' || l.line_kind === 'deal' ? childrenOf(l) : [];
        const before = sum(all().map(billedOf));
        const op = rng(4);
        kinds.add(`${l.line_kind}:${op}`);
        if (op === 0) {
          // §3.6 / §3.9: a comp on a weight-pending line is refused (LINE_WEIGHT_PENDING), so never generated.
          if (l.line_kind === 'deal_part' || liveUnits(l) - l.comped_units === 0 || (l.weighed && l.line_total_minor === null)) continue;
          apply(planComp(l, kids, 1 + rng(liveUnits(l) - l.comped_units - 1), meta).lines);
        } else if (op === 1) {
          apply(planRemove(l, kids, 1 + rng(liveUnits(l) - 1)).lines);
        } else if (op === 2) {
          apply(planVoid(l, kids, 1 + rng(liveUnits(l) - 1)).lines);
        } else if (op === 3 && l.line_kind === 'item' && rng(1) === 0) {
          // Remake: engine view only, money unchanged (O20).
          lines.set(l.order_item_id, { ...l, returned_units: l.units });
          expect(sum(all().map(billedOf))).toBe(before);
        } else {
          // Weight (set or corrected) only while no unit left billing; the fold sets refundable = line total.
          if (!l.weighed || hasUnitOutOfBilling(l)) continue;
          const t = rng(5_000_000);
          lines.set(l.order_item_id, { ...l, line_total_minor: t, refundable_minor: t });
        }
        steps++;
        expect(violations()).toEqual([]);
      }
      // Close out: void every live line whole (parents cascade); everything is then exact.
      for (const l of all()) {
        const cur = lines.get(l.order_item_id) as L;
        if (liveUnits(cur) > 0) apply(planVoid(cur, cur.line_kind === 'item' || cur.line_kind === 'deal' ? childrenOf(cur) : [], liveUnits(cur)).lines);
      }
      expect(violations()).toEqual([]);
      expect(sum(all().map(billedOf))).toBe(0);
    }
    expect(steps).toBeGreaterThan(1000);
    for (const k of ['item', 'option_child', 'deal', 'deal_part']) for (const op of [0, 1, 2]) if (!(k === 'deal_part' && op === 0)) expect(kinds.has(`${k}:${op}`)).toBe(true);
  });
});
