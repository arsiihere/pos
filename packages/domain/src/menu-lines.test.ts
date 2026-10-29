import { describe, expect, it, vi } from 'vitest';
import * as root from './index';
import { lineTotalMinor } from './line-total';
import {
  allocateDealMinor,
  checkOptionChoices,
  childQuantity,
  isDealOrderable,
  isGroupSatisfiable,
  isItemOrderable,
  optionChargeMinor,
  orderLineTotalMinor,
  type IsAvailable,
  type MenuLineDeal,
  type MenuLineGroup,
  type MenuLineItem,
  type MenuLineOption,
} from './menu-lines';

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
    // The chosen naan (plain 3 000 or Roghni 6 000) never enters the weights, so one split serves both picks.
    const dealQty = 1;
    const naanPartQty = 4;
    const reference = { karahi: 220_000, naan: 3_000, lassi: 75_000 };
    const roghniPrice = 6_000;
    const weightsFor = (naanPrice: number): number[] => [
      lineTotalMinor(reference.karahi, 1 * dealQty, 'piece'),
      lineTotalMinor(naanPrice, naanPartQty * dealQty, 'piece'),
      lineTotalMinor(reference.lassi, 1 * dealQty, 'piece'),
    ];
    const split = allocateDealMinor(320_000 * dealQty, weightsFor(reference.naan));
    expect(split).toEqual([229_315, 12_508, 78_177]);
    expect(sum(split)).toBe(320_000);
    // The wrong rule (weights from the chosen Roghni price) gives a different split, so the assertion above pins the rule.
    const byChosen = allocateDealMinor(320_000 * dealQty, weightsFor(roghniPrice));
    expect(byChosen).not.toEqual(split);
    expect(sum(byChosen)).toBe(320_000);
    // Roghni extra +3 000 per piece × part qty 4 × deal qty 1, added on top to the naan part only.
    const roghniExtraPerPiece = 3_000;
    expect((split[1] as number) + roghniExtraPerPiece * naanPartQty * dealQty).toBe(24_508);
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

// ---- §3.4.6 option checks and orderability (task 4) ----

const opt = (option_id: string, o: Partial<MenuLineOption> = {}): MenuLineOption => ({
  option_id,
  price_minor: 0,
  max_quantity: 1,
  is_default: false,
  linked_item_id: null,
  ...o,
});
const linked = (option_id: string, itemId: string, o: Partial<MenuLineOption> = {}): MenuLineOption =>
  opt(option_id, { linked_item_id: itemId, ...o });
const grp = (modifier_group_id: string, min_choices: number, max_choices: number, options: MenuLineOption[], hasPlain?: boolean): MenuLineGroup => ({
  modifier_group_id,
  min_choices,
  max_choices,
  has_plain_options: hasPlain ?? options.some((o) => o.linked_item_id === null),
  options,
});
const itm = (item_id: string, modifier_group_ids: string[] = [], sale_unit: MenuLineItem['sale_unit'] = 'piece'): MenuLineItem => ({
  item_id,
  sale_unit,
  modifier_group_ids,
});
const byId = <T,>(key: keyof T, xs: T[]): Record<string, T> => Object.fromEntries(xs.map((x) => [String(x[key]), x]));
const groupsOf = (...gs: MenuLineGroup[]) => byId<MenuLineGroup>('modifier_group_id', gs);
const itemsOf = (...is: MenuLineItem[]) => byId<MenuLineItem>('item_id', is);
// Stock-style availability: an item is available for q when q ≤ stock[item] (absent → unlimited); `off` items never.
const avail = (stock: Record<string, number> = {}, off: string[] = []): IsAvailable =>
  (id, q) => !off.includes(id) && (stock[id] === undefined || q <= stock[id]);
const piece = (quantity: number | null) => ({ quantity, sale_unit: 'piece' as const });

describe('menu-lines: option checks (§3.4.6, V9)', () => {
  const spice = grp('spice', 1, 1, [opt('mild'), opt('hot')]);
  const extras = grp('extras', 0, 3, [opt('raita', { max_quantity: 2 }), opt('salad')]);
  const other = grp('other', 0, 1, [opt('x')]);
  const gs = groupsOf(spice, extras, other);
  const none = itemsOf();

  it('[01c #11] Spice min 1 none → below_min; 2 picks of max 1 → above_max; quantity > max_quantity; non-effective group', () => {
    const run = (chosen: Parameters<typeof checkOptionChoices>[1]) =>
      checkOptionChoices([spice, extras], chosen, 'line', piece(1), gs, none, avail());
    expect(run([])).toEqual([{ reason: 'below_min', modifier_group_id: 'spice', option_id: null }]);
    expect(run([{ modifier_group_id: 'spice', option_id: 'mild', quantity: 1 }])).toEqual([]);
    expect(
      run([
        { modifier_group_id: 'spice', option_id: 'mild', quantity: 1 },
        { modifier_group_id: 'spice', option_id: 'hot', quantity: 1 },
      ]),
    ).toEqual([{ reason: 'above_max', modifier_group_id: 'spice', option_id: null }]);
    expect(
      run([
        { modifier_group_id: 'spice', option_id: 'mild', quantity: 1 },
        { modifier_group_id: 'extras', option_id: 'raita', quantity: 3 },
      ]),
    ).toContainEqual({ reason: 'quantity_out_of_range', modifier_group_id: 'extras', option_id: 'raita' });
    expect(
      run([
        { modifier_group_id: 'spice', option_id: 'mild', quantity: 1 },
        { modifier_group_id: 'extras', option_id: 'raita', quantity: 0 },
      ]),
    ).toContainEqual({ reason: 'quantity_out_of_range', modifier_group_id: 'extras', option_id: 'raita' });
    expect(
      run([
        { modifier_group_id: 'spice', option_id: 'mild', quantity: 1 },
        { modifier_group_id: 'other', option_id: 'x', quantity: 1 },
      ]),
    ).toEqual([{ reason: 'not_effective', modifier_group_id: 'other', option_id: 'x' }]);
    // An option not offered in its (effective) group at this branch is not effective either.
    expect(
      run([
        { modifier_group_id: 'spice', option_id: 'mild', quantity: 1 },
        { modifier_group_id: 'extras', option_id: 'ghost', quantity: 1 },
      ]),
    ).toEqual([{ reason: 'not_effective', modifier_group_id: 'extras', option_id: 'ghost' }]);
    // Σ chosen quantities per group: raita 2 + salad 1 = 3 ≤ max 3; within range.
    expect(
      run([
        { modifier_group_id: 'spice', option_id: 'hot', quantity: 1 },
        { modifier_group_id: 'extras', option_id: 'raita', quantity: 2 },
        { modifier_group_id: 'extras', option_id: 'salad', quantity: 1 },
      ]),
    ).toEqual([]);
  });

  it('[01c #12] child position refuses a linked option; A → B → A cannot be built (B offered as child ignores its link to A)', () => {
    // A (karahi) has linked option B (naan); B has a group whose only option links back to A.
    const aBread = grp('a-bread', 0, 1, [linked('opt-b', 'B')]);
    const bBack = grp('b-back', 1, 1, [linked('opt-a', 'A')], false);
    const groups = groupsOf(aBread, bBack);
    const items = itemsOf(itm('A', ['a-bread']), itm('B', ['b-back']));
    const isAvailable = vi.fn(avail());
    // B in a child position: b-back has no plain option → not offered, no violation, A never looked at.
    expect(isItemOrderable(items.B!, groups, items, 'child', 3, isAvailable)).toBe(true);
    expect(isAvailable).toHaveBeenCalledTimes(1);
    expect(isAvailable).toHaveBeenCalledWith('B', 3);
    // A's line with linked B → accepted (B orderable as child).
    expect(checkOptionChoices([aBread], [{ modifier_group_id: 'a-bread', option_id: 'opt-b', quantity: 1 }], 'line', piece(1), groups, items, avail())).toEqual([]);
    // B as a child carrying its linked option to A → refused, so A → B → A cannot be built.
    expect(checkOptionChoices([bBack], [{ modifier_group_id: 'b-back', option_id: 'opt-a', quantity: 1 }], 'child', piece(3), groups, items, avail())).toEqual([
      { reason: 'linked_in_child', modifier_group_id: 'b-back', option_id: 'opt-a' },
    ]);
  });

  it('[01c §3.4.6, V18] piece parent with quantity null throws; g parent with quantity null checks as with a quantity', () => {
    const bread = grp('bread', 0, 3, [linked('naan', 'Naan', { max_quantity: 3 })]);
    const groups = groupsOf(bread, spice);
    const items = itemsOf(itm('Naan'));
    const chosen = [{ modifier_group_id: 'bread', option_id: 'naan', quantity: 3 }];
    // V18: a piece parent always has a quantity; null is a caller bug, never defaulted.
    expect(() => checkOptionChoices([bread], chosen, 'line', piece(null), groups, items, avail())).toThrow(
      'checkOptionChoices: piece parent quantity is null',
    );
    expect(() => checkOptionChoices([spice], [], 'line', piece(null), groups, items, avail())).toThrow(
      'checkOptionChoices: piece parent quantity is null',
    );
    // A g parent may be pending its weight: same violations with quantity null as with 1 250 g.
    for (const stock of [{}, { Naan: 2 }]) {
      const withQty = checkOptionChoices([bread, spice], chosen, 'line', { quantity: 1250, sale_unit: 'g' }, groups, items, avail(stock));
      const pending = checkOptionChoices([bread, spice], chosen, 'line', { quantity: null, sale_unit: 'g' }, groups, items, avail(stock));
      expect(pending).toEqual(withQty);
    }
    expect(checkOptionChoices([bread, spice], chosen, 'line', { quantity: null, sale_unit: 'g' }, groups, items, avail({ Naan: 2 }))).toEqual([
      { reason: 'linked_not_orderable', modifier_group_id: 'bread', option_id: 'naan' },
      { reason: 'below_min', modifier_group_id: 'spice', option_id: null },
    ]);
  });

  it('[01c #96] child position: linked-only group not offered; plain group required; empty plain group; mixed group', () => {
    const bread = grp('bread', 1, 1, [linked('naan', 'Naan')], false);
    const spiceC = grp('spice', 1, 1, [opt('mild')]);
    const empty = grp('empty', 1, 1, [], true);
    const items = itemsOf(itm('Naan'));
    const groups = groupsOf(bread, spiceC, empty);
    expect(checkOptionChoices([bread], [], 'child', piece(2), groups, items, avail())).toEqual([]);
    expect(isGroupSatisfiable(bread, 'child', groups, items, avail())).toBe(true);
    expect(checkOptionChoices([bread, spiceC], [], 'child', piece(2), groups, items, avail())).toEqual([
      { reason: 'below_min', modifier_group_id: 'spice', option_id: null },
    ]);
    // has_plain_options true, options [] at the branch → not orderable as a child; deal with it as the only choice → not orderable.
    const kheer = itm('Kheer', ['empty']);
    const items2 = itemsOf(kheer);
    expect(isItemOrderable(kheer, groups, items2, 'child', 1, avail())).toBe(false);
    const deal: MenuLineDeal = { deal_id: 'd', parts: [{ deal_part_id: 'p', quantity: 1, choices: [{ item_id: 'Kheer', extra_price_minor: 0 }] }] };
    expect(isDealOrderable(deal, 1, groups, items2, avail(), true)).toBe(false);
    // Mixed (N6): plain "No bread" not offered at the branch (absent from options), linked Naan offered.
    const mixedNotOffered = grp('mixed', 1, 1, [linked('naan', 'Naan')], true);
    const karahi = itm('Karahi', ['mixed']);
    const g1 = groupsOf(mixedNotOffered);
    const i1 = itemsOf(karahi, itm('Naan'));
    expect(isGroupSatisfiable(mixedNotOffered, 'child', g1, i1, avail())).toBe(false);
    expect(isItemOrderable(karahi, g1, i1, 'child', 1, avail())).toBe(false);
    // Same group with "No bread" offered → satisfiable in a child position; Naan still refused if chosen.
    const mixed = grp('mixed', 1, 1, [opt('no-bread'), linked('naan', 'Naan')]);
    const g2 = groupsOf(mixed);
    expect(isGroupSatisfiable(mixed, 'child', g2, i1, avail())).toBe(true);
    expect(isItemOrderable(karahi, g2, i1, 'child', 1, avail())).toBe(true);
    expect(checkOptionChoices([mixed], [{ modifier_group_id: 'mixed', option_id: 'naan', quantity: 1 }], 'child', piece(1), g2, i1, avail())).toContainEqual({
      reason: 'linked_in_child',
      modifier_group_id: 'mixed',
      option_id: 'naan',
    });
    // min 2: one offered plain option of max_quantity 1 plus linked Naan → child false, line true.
    const min2 = grp('min2', 2, 2, [opt('no-bread'), linked('naan', 'Naan')]);
    const g3 = groupsOf(min2);
    expect(isGroupSatisfiable(min2, 'child', g3, i1, avail())).toBe(false);
    expect(isGroupSatisfiable(min2, 'line', g3, i1, avail())).toBe(true);
  });

  it('[01c #97] linked Naan with isAvailable(Naan, 3) false → violation; true → none', () => {
    const bread = grp('bread', 0, 3, [linked('naan', 'Naan', { max_quantity: 3 })]);
    const groups = groupsOf(bread);
    const items = itemsOf(itm('Naan'));
    const chosen = [{ modifier_group_id: 'bread', option_id: 'naan', quantity: 3 }];
    for (const no of [avail({}, ['Naan']), avail({ Naan: 2 })]) {
      expect(checkOptionChoices([bread], chosen, 'line', piece(1), groups, items, no)).toEqual([
        { reason: 'linked_not_orderable', modifier_group_id: 'bread', option_id: 'naan' },
      ]);
    }
    expect(checkOptionChoices([bread], chosen, 'line', piece(1), groups, items, avail({ Naan: 3 }))).toEqual([]);
  });

  it('[01c #122] linked Naan with an empty required plain group not selectable; line-position group of linked breads (P2)', () => {
    const naanSize = grp('naan-size', 1, 1, [], true);
    const bread = grp('bread', 0, 3, [linked('naan', 'Naan', { max_quantity: 3 })]);
    const naan = itm('Naan', ['naan-size']);
    const items = itemsOf(naan);
    const chosen = [{ modifier_group_id: 'bread', option_id: 'naan', quantity: 3 }];
    let groups = groupsOf(naanSize, bread);
    expect(isItemOrderable(naan, groups, items, 'child', 3, avail())).toBe(false);
    expect(checkOptionChoices([bread], chosen, 'line', piece(1), groups, items, avail())).toEqual([
      { reason: 'linked_not_orderable', modifier_group_id: 'bread', option_id: 'naan' },
    ]);
    groups = groupsOf(grp('naan-size', 1, 1, [opt('small')]), bread);
    expect(isItemOrderable(naan, groups, items, 'child', 3, avail())).toBe(true);
    expect(checkOptionChoices([bread], chosen, 'line', piece(1), groups, items, avail())).toEqual([]);

    // P2: Karahi with required "Bread" (min 1) whose only options are linked Naan and Roghni.
    const breadReq = grp('bread', 1, 1, [linked('naan', 'Naan'), linked('roghni', 'Roghni')]);
    const karahi = itm('Karahi', ['bread']);
    const items2 = itemsOf(karahi, itm('Naan'), itm('Roghni'));
    const g2 = groupsOf(breadReq);
    const soldOut = avail({ Naan: 0, Roghni: 0 });
    expect(isGroupSatisfiable(breadReq, 'line', g2, items2, soldOut)).toBe(false);
    expect(isItemOrderable(karahi, g2, items2, 'line', 1, soldOut)).toBe(false);
    const roghniBack = avail({ Naan: 0, Roghni: 5 });
    expect(isGroupSatisfiable(breadReq, 'line', g2, items2, roghniBack)).toBe(true);
    expect(isItemOrderable(karahi, g2, items2, 'line', 1, roghniBack)).toBe(true);
    const withPlain = grp('bread', 1, 1, [linked('naan', 'Naan'), linked('roghni', 'Roghni'), opt('no-bread')]);
    const g3 = groupsOf(withPlain);
    expect(isGroupSatisfiable(withPlain, 'line', g3, items2, soldOut)).toBe(true);
    expect(isItemOrderable(karahi, g3, items2, 'line', 1, soldOut)).toBe(true);
  });

  it('[01c §12.7 T3] linked option child quantity from parent: piece × 2 → 6; g 1 250 → 3; g with quantity null → 3', () => {
    const bread = grp('bread', 0, 3, [linked('naan', 'Naan', { max_quantity: 3 })]);
    const groups = groupsOf(bread);
    const items = itemsOf(itm('Naan'));
    const chosen = [{ modifier_group_id: 'bread', option_id: 'naan', quantity: 3 }];
    const cases: Array<[{ quantity: number | null; sale_unit: MenuLineItem['sale_unit'] }, number]> = [
      [{ quantity: 2, sale_unit: 'piece' }, 6],
      [{ quantity: 1250, sale_unit: 'g' }, 3],
      [{ quantity: null, sale_unit: 'g' }, 3],
    ];
    for (const [parent, expected] of cases) {
      const isAvailable = vi.fn(avail());
      expect(checkOptionChoices([bread], chosen, 'line', parent, groups, items, isAvailable)).toEqual([]);
      expect(isAvailable).toHaveBeenCalledWith('Naan', expected);
      expect(isAvailable).toHaveBeenCalledTimes(1);
    }
  });

  it('[01c §4.2 Q3] a linked item absent from itemsById is not counted (line) and gives linked_not_orderable', () => {
    const bread = grp('bread', 1, 1, [linked('naan', 'Naan')]);
    const groups = groupsOf(bread);
    const karahi = itm('Karahi', ['bread']);
    const items = itemsOf(karahi);
    expect(isGroupSatisfiable(bread, 'line', groups, items, avail())).toBe(false);
    expect(isItemOrderable(karahi, groups, items, 'line', 1, avail())).toBe(false);
    expect(checkOptionChoices([bread], [{ modifier_group_id: 'bread', option_id: 'naan', quantity: 1 }], 'line', piece(1), groups, items, avail())).toEqual([
      { reason: 'linked_not_orderable', modifier_group_id: 'bread', option_id: 'naan' },
    ]);
  });
});

describe('menu-lines: orderability (M1, V11 d, m16)', () => {
  const dealOf = (parts: Array<[number, string[]]>): MenuLineDeal => ({
    deal_id: 'deal',
    parts: parts.map(([quantity, ids], i) => ({ deal_part_id: `p${i}`, quantity, choices: ids.map((item_id) => ({ item_id, extra_price_minor: 0 })) })),
  });
  const items = itemsOf(itm('Karahi'), itm('Naan'), itm('Roghni'), itm('Drink'));
  const groups = groupsOf();

  it('[01c #14] isDealOrderable: fixed part off → false; pick-one one off one on → true; all off → false; outside windows → false', () => {
    const deal = dealOf([
      [1, ['Karahi']],
      [2, ['Naan', 'Roghni']],
    ]);
    expect(isDealOrderable(deal, 1, groups, items, avail(), true)).toBe(true);
    expect(isDealOrderable(deal, 1, groups, items, avail({}, ['Karahi']), true)).toBe(false);
    expect(isDealOrderable(deal, 1, groups, items, avail({}, ['Naan']), true)).toBe(true);
    expect(isDealOrderable(deal, 1, groups, items, avail({}, ['Naan', 'Roghni']), true)).toBe(false);
    expect(isDealOrderable(deal, 1, groups, items, avail(), false)).toBe(false);
    // A choice item absent from itemsById is not orderable.
    expect(isDealOrderable(dealOf([[1, ['Ghost']]]), 1, groups, items, avail(), true)).toBe(false);
  });

  it('[01c #110] sold_out Naan with 2 available, part needs 4 per deal → false; 8 available, deal qty 2 → true', () => {
    const deal = dealOf([[4, ['Naan']]]);
    expect(isDealOrderable(deal, 1, groups, items, avail({ Naan: 2 }), true)).toBe(false);
    const isAvailable = vi.fn(avail({ Naan: 8 }));
    expect(isDealOrderable(deal, 2, groups, items, isAvailable, true)).toBe(true);
    expect(isAvailable).toHaveBeenCalledWith('Naan', 8);
  });

  it('[01c §3.4.6] isItemOrderable: unavailable item false; group missing from groupsById (optional empty) skipped; root exports', () => {
    expect(isItemOrderable(itm('Karahi'), groups, items, 'line', 1, avail({}, ['Karahi']))).toBe(false);
    expect(isItemOrderable(itm('Karahi', ['optional-empty']), groups, items, 'line', 1, avail())).toBe(true);
    expect(root.checkOptionChoices).toBe(checkOptionChoices);
    expect(root.isGroupSatisfiable).toBe(isGroupSatisfiable);
    expect(root.isItemOrderable).toBe(isItemOrderable);
    expect(root.isDealOrderable).toBe(isDealOrderable);
  });
});

describe('menu-lines: line-position group satisfiability (§4.4 02)', () => {
  it('[01c #13] isGroupSatisfiable(group, line): min 2 with one option of max_quantity 1 → false', () => {
    const g = grp('g', 2, 2, [opt('a')]);
    expect(isGroupSatisfiable(g, 'line', groupsOf(g), itemsOf(), avail())).toBe(false);
    const g2 = grp('g', 2, 2, [opt('a', { max_quantity: 2 })]);
    expect(isGroupSatisfiable(g2, 'line', groupsOf(g2), itemsOf(), avail())).toBe(true);
  });
});

describe('menu-lines: chosen quantities summed per option (§3.4.6, M2)', () => {
  it('[01c §3.4.6] duplicate entries of one option summing above max_quantity → quantity_out_of_range once', () => {
    const extras = grp('extras', 0, 10, [opt('raita', { max_quantity: 2 })]);
    const chosen = [
      { modifier_group_id: 'extras', option_id: 'raita', quantity: 2 },
      { modifier_group_id: 'extras', option_id: 'raita', quantity: 2 },
    ];
    expect(checkOptionChoices([extras], chosen, 'line', piece(1), groupsOf(extras), itemsOf(), avail())).toEqual([
      { reason: 'quantity_out_of_range', modifier_group_id: 'extras', option_id: 'raita' },
    ]);
    // Split entries within max_quantity are fine: 1 + 1 = 2.
    const ok = chosen.map((c) => ({ ...c, quantity: 1 }));
    expect(checkOptionChoices([extras], ok, 'line', piece(1), groupsOf(extras), itemsOf(), avail())).toEqual([]);
  });

  it('[01c §3.4.6 M2] linked Naan entered twice ({2},{2}) with Naan available for 2 → linked_not_orderable, one isAvailable call for 4', () => {
    const bread = grp('bread', 0, 4, [linked('naan', 'Naan', { max_quantity: 4 })]);
    const chosen = [
      { modifier_group_id: 'bread', option_id: 'naan', quantity: 2 },
      { modifier_group_id: 'bread', option_id: 'naan', quantity: 2 },
    ];
    const isAvailable = vi.fn(avail({ Naan: 2 }));
    expect(checkOptionChoices([bread], chosen, 'line', piece(1), groupsOf(bread), itemsOf(itm('Naan')), isAvailable)).toEqual([
      { reason: 'linked_not_orderable', modifier_group_id: 'bread', option_id: 'naan' },
    ]);
    expect(isAvailable).toHaveBeenCalledTimes(1);
    expect(isAvailable).toHaveBeenCalledWith('Naan', 4);
  });

  it('[01c §3.4.6] out-of-range quantities do not count toward the group; child-position linked options do not count toward min', () => {
    const spice = grp('spice', 1, 1, [opt('mild')]);
    expect(checkOptionChoices([spice], [{ modifier_group_id: 'spice', option_id: 'mild', quantity: 5 }], 'line', piece(1), groupsOf(spice), itemsOf(), avail())).toEqual([
      { reason: 'quantity_out_of_range', modifier_group_id: 'spice', option_id: 'mild' },
      { reason: 'below_min', modifier_group_id: 'spice', option_id: null },
    ]);
    const mixed = grp('mixed', 1, 1, [opt('no-bread'), linked('naan', 'Naan')]);
    expect(checkOptionChoices([mixed], [{ modifier_group_id: 'mixed', option_id: 'naan', quantity: 1 }], 'child', piece(1), groupsOf(mixed), itemsOf(itm('Naan')), avail())).toEqual([
      { reason: 'linked_in_child', modifier_group_id: 'mixed', option_id: 'naan' },
      { reason: 'below_min', modifier_group_id: 'mixed', option_id: null },
    ]);
  });
});
