import { describe, expect, it } from 'vitest';
import * as root from '../index';
import { BUILTIN_UNITS, toStockUnits } from './conversions';
import {
  buildCostInputs,
  dealCost,
  explodeStockItem,
  explodeUsage,
  plateCost,
  recipeCost,
  roundMinor,
  stockItemUnitCost,
  type CostInputs,
  type Fraction,
  type SaleLineShape,
} from './costing';
import { effectiveMenuPrice, pricePerStockUnit } from './prices';

// 08 v1.1 Part B §10.1 tests 1–11. Inputs are built the way a hub builds them: a snapshot `inventory` key
// (§5.3 shapes, BIGINT as strings) through buildCostInputs.

const NOW = 1_800_000_000_000;
const B1 = 'B1';

type Kind = 'prepared' | 'ingredient' | 'packet';
type U = 'piece' | 'g' | 'ml';
const item = (id: string, kind: Kind | string, stock_unit: U | string) => ({ stock_item_id: id, kind, name: id, code: null, stock_unit, cost_category: 'food', is_a_item: false });
let priceSeq = 0;
// Rs `rs` for `qty` stock units (minor = rs × 100); every branch, manual
const price = (id: string, rs: number, qty: number | [string, string], extra: Record<string, unknown> = {}) => {
  priceSeq += 1;
  const [num, den] = Array.isArray(qty) ? qty : [String(qty), '1'];
  return {
    price_id: `P${String(priceSeq).padStart(4, '0')}`,
    stock_item_id: id,
    branch_id: null,
    kind: 'manual',
    unit_name: 'x',
    stock_unit: 'g',
    price_minor: String(Math.round(rs * 100)),
    stock_qty_num: num,
    stock_qty_den: den,
    created_at: 1_700_000_000_000 + priceSeq,
    valid_until_at: null,
    ...extra,
  };
};
const line = (id: string, qty: string | [string, string], stock_unit: U | string = 'g', qty_basis = 'AP') => {
  const [num, den] = Array.isArray(qty) ? qty : [qty, '1'];
  return { stock_item_id: id, stock_qty_num: num, stock_qty_den: den, stock_unit, qty_basis };
};
interface V {
  owner_type?: string;
  owner_id: string;
  basis?: string;
  base_qty?: number | null;
  measure_unit?: string | null;
  batch_yield_qty?: string | null;
  batch_stock_unit?: string | null;
  misc_allowance_bp?: number;
  status?: string;
  recipe_archived?: boolean;
  lines: ReturnType<typeof line>[];
}
const version = (id: string, v: V) => ({
  recipe_version_id: id,
  status: v.status ?? 'published',
  owner_type: v.owner_type ?? 'menu_item',
  owner_id: v.owner_id,
  basis: v.basis ?? 'per_unit',
  base_qty: v.base_qty ?? null,
  measure_unit: v.measure_unit ?? null,
  recipe_archived: v.recipe_archived ?? false,
  batch_yield_qty: v.batch_yield_qty ?? null,
  batch_stock_unit: v.batch_stock_unit ?? null,
  misc_allowance_bp: v.misc_allowance_bp ?? 500,
  published_at: 1_700_000_000_000,
  lines: v.lines,
});
const key = (k: { items: unknown[]; prices?: unknown[]; yields?: unknown[]; recipes?: unknown[]; units?: unknown[] }) => ({
  items: k.items,
  units: k.units ?? [],
  prices: k.prices ?? [],
  yields: k.yields ?? [],
  recipes: k.recipes ?? [],
});
const f = (num: bigint, den = 1n): Fraction => {
  const g = (a: bigint, b: bigint): bigint => (b === 0n ? (a < 0n ? -a : a) : g(b, a % b));
  const d = g(num, den);
  return num === 0n ? { num: 0n, den: 1n } : { num: num / d, den: den / d };
};
const pieceLine = (item_id: string, quantity: bigint, options: SaleLineShape['options'] = []): SaleLineShape => ({ kind: 'item', item_id, quantity, sale_unit: 'piece', options });
const measureLine = (item_id: string, quantity: bigint, sale_unit: 'g' | 'ml', options: SaleLineShape['options'] = []): SaleLineShape => ({ kind: 'item', item_id, quantity, sale_unit, options });

// The pilot kitchen: beef (yield 71.20 %), onion (no yield), oil (ml), makhan, TP-1 packet, paye raw, shorba (ml),
// PAYE-COOKED (prepared, piece; batch of 160 from 40 kg paye raw) and "Paye Half" (1 piece + 200 ml shorba).
function kitchen(extra: { items?: unknown[]; prices?: unknown[]; yields?: unknown[]; recipes?: unknown[] } = {}): CostInputs {
  return buildCostInputs(
    key({
      items: [
        item('beef', 'ingredient', 'g'),
        item('onion', 'ingredient', 'g'),
        item('oil', 'ingredient', 'ml'),
        item('tp1', 'packet', 'g'),
        item('payeRaw', 'ingredient', 'g'),
        item('shorba', 'ingredient', 'ml'),
        item('payeCooked', 'prepared', 'piece'),
        ...(extra.items ?? []),
      ],
      prices: [
        price('beef', 1500, 1000), // Rs 1 500 / kg → 150 minor / g
        price('onion', 200, 1000), // 20 minor / g
        price('oil', 600, 1000, { stock_unit: 'ml' }), // 60 minor / ml
        price('tp1', 300, 1000), // packet by menu price: 30 minor / g
        price('payeRaw', 800, 1000), // 80 minor / g
        price('shorba', 100, 1000, { stock_unit: 'ml' }), // 10 minor / ml
        ...(extra.prices ?? []),
      ],
      yields: [{ stock_item_id: 'beef', yield_bp: 7120 }, ...(extra.yields ?? [])],
      recipes: [
        version('V-PAYE-COOKED', {
          owner_type: 'stock_item',
          owner_id: 'payeCooked',
          basis: 'per_batch',
          batch_yield_qty: '160',
          batch_stock_unit: 'piece',
          lines: [line('payeRaw', '40000')], // Rs 32 000 / 160 = Rs 200 a piece
        }),
        version('V-PAYE-HALF', { owner_id: 'payeHalf', lines: [line('payeCooked', '1', 'piece'), line('shorba', '200', 'ml')] }),
        ...(extra.recipes ?? []),
      ],
    }),
  );
}

describe('[08b §10.1] cost engine (packages/domain/src/inventory/costing.ts)', () => {
  it('[08b #1] line cost: beef 250 g EP, Rs 1 500 / kg, yield 7 120 → exact; AP without yield ÷ 1; Rs 1 000 per lb → per g exact', () => {
    const inputs = kitchen({ recipes: [version('V-T', { owner_id: 'tawa', lines: [line('beef', '250', 'g', 'EP'), line('onion', '30')] })] });
    const r = recipeCost(inputs, 'V-T', B1, NOW, { top: false });
    // 250 × 150 × 10 000 / 7 120 + 30 × 20
    expect(r.value).toEqual(f(250n * 150n * 10_000n + 30n * 20n * 7120n, 7120n));
    expect(r).toMatchObject({ status: 'costed', unknown: [], known: true });
    // P-3: a beef price of Rs 1 000 per lb (frozen 45 359 237 / 100 000 g)
    const lb = toStockUnits(1n, BUILTIN_UNITS.lb);
    const perLb = buildCostInputs(key({ items: [item('beef', 'ingredient', 'g')], prices: [price('beef', 1000, [lb.num.toString(), lb.den.toString()])] }));
    expect(stockItemUnitCost(perLb, 'beef', B1, NOW)).toEqual({ per_stock_unit: f(1000n * 100n * 100_000n, 45_359_237n), source: 'menu' });
  });

  it('[08b #2] missing price / EP without yield / frozen-unit and basis backstops → partial; known; stockItemUnitCost', () => {
    const inputs = kitchen({
      items: [item('makhan', 'ingredient', 'g'), item('ghee', 'ingredient', 'g'), item('qeema', 'prepared', 'g'), item('lassiMix', 'ingredient', 'ml')],
      prices: [price('qeema', 900, 1000)],
      recipes: [
        version('V-MISS', { owner_id: 'a', lines: [line('makhan', '10'), line('onion', '30')] }), // makhan has no price
        version('V-EP', { owner_id: 'b', lines: [line('onion', '30', 'g', 'EP')] }), // EP, no yield (D9: never yield 1)
        version('V-EP-PKT', { owner_id: 'c', lines: [line('tp1', '15', 'g', 'EP'), line('payeCooked', '1', 'piece', 'EP')] }),
        version('V-NONE', { owner_id: 'd', lines: [line('makhan', '10'), line('ghee', '5')] }),
        version('V-UNIT', { owner_id: 'e', lines: [line('oil', '20', 'g')] }), // frozen g, oil is now ml (N-1)
        version('V-BATCH-UNIT', { owner_type: 'stock_item', owner_id: 'qeema', basis: 'per_batch', batch_yield_qty: '10', batch_stock_unit: 'piece', lines: [line('beef', '1000')] }),
        version('V-USES-QEEMA', { owner_id: 'f', lines: [line('qeema', '100')] }),
        version('V-LASSI', { owner_id: 'lassi', basis: 'per_measure', base_qty: 1000, measure_unit: 'g', lines: [line('lassiMix', '1000', 'ml')] }),
        version('V-KARAHI-PC', { owner_id: 'karahi', lines: [line('beef', '1000')] }),
        version('V-SPICY', { owner_type: 'modifier_option', owner_id: 'spicy', lines: [] }),
      ],
    });
    expect(recipeCost(inputs, 'V-MISS', B1, NOW, { top: false })).toEqual({ value: f(600n), status: 'partial', unknown: ['makhan'], known: true });
    expect(recipeCost(inputs, 'V-EP', B1, NOW, { top: false })).toMatchObject({ status: 'partial', unknown: ['onion'], known: false });
    // EP on packet / prepared: no division
    expect(recipeCost(inputs, 'V-EP-PKT', B1, NOW, { top: false })).toEqual({ value: f(15n * 30n + 20_000n), status: 'costed', unknown: [], known: true });
    expect(recipeCost(inputs, 'V-NONE', B1, NOW, { top: false })).toMatchObject({ value: f(0n), status: 'partial', known: false });
    expect(recipeCost(inputs, 'V-UNIT', B1, NOW, { top: false })).toMatchObject({ status: 'partial', unknown: ['oil'], known: false });
    // a batch whose frozen batch_stock_unit ≠ the owner's current one (N-1): partial; as a line it is unknown, never re-read
    expect(recipeCost(inputs, 'V-BATCH-UNIT', B1, NOW, { top: false }).status).toBe('partial');
    expect(stockItemUnitCost(inputs, 'qeema', B1, NOW)).toBeNull();
    expect(recipeCost(inputs, 'V-USES-QEEMA', B1, NOW, { top: false })).toMatchObject({ status: 'partial', known: false });
    // T-2: a per_measure recipe frozen at g on an ml line; a per_unit recipe on a g line
    expect(plateCost(inputs, measureLine('lassi', 300n, 'ml'), B1, NOW)).toMatchObject({ status: 'partial', known: false, value: f(0n) });
    expect(plateCost(inputs, measureLine('karahi', 1250n, 'g'), B1, NOW)).toMatchObject({ status: 'partial', known: false });
    // t-6: an empty "Spicy" option → known, value 0, costed
    expect(recipeCost(inputs, 'V-SPICY', B1, NOW, { top: true })).toEqual({ value: f(0n), status: 'costed', unknown: [], known: true });
    // stockItemUnitCost: ingredient = 08a pricePerStockUnit(effectiveMenuPrice(…)); prepared with recipe → recipe; none → null
    const beefRow = effectiveMenuPrice(inputs.prices.get('beef')!, B1, NOW, 'g')!;
    expect(stockItemUnitCost(inputs, 'beef', B1, NOW)).toEqual({ per_stock_unit: pricePerStockUnit(beefRow), source: 'menu' });
    expect(stockItemUnitCost(inputs, 'payeCooked', B1, NOW)).toEqual({ per_stock_unit: f(20_000n), source: 'recipe' });
    expect(stockItemUnitCost(inputs, 'makhan', B1, NOW)).toBeNull();
    expect(stockItemUnitCost(inputs, 'nope', B1, NOW)).toBeNull();
  });

  it('[08b #3] misc 500 bp at the top recipe only (OQ-4): Paye Half = (200 + 20) × 1.05 = Rs 231; explodeUsage never applies it', () => {
    const inputs = kitchen();
    const plate = plateCost(inputs, pieceLine('payeHalf', 1n), B1, NOW);
    expect(plate).toMatchObject({ status: 'costed', known: true, recipe_version_ids: { item: 'V-PAYE-HALF', options: [] } });
    expect(roundMinor(plate.value)).toBe(23_100n); // not 24 150 (no misc on the batch used as a line)
    expect(recipeCost(inputs, 'V-PAYE-HALF', B1, NOW, { top: false }).value).toEqual(f(22_000n));
    const usage = explodeUsage(inputs, { ...pieceLine('payeHalf', 1n), recipe_version_ids: plate.recipe_version_ids });
    expect(usage).toEqual({ usage: new Map([['payeRaw', f(250n)], ['shorba', f(200n)]]), status: 'costed' });
  });

  it('[08b #4] produced item: PAYE-COOKED batch ÷ 160; Paye Half uses it; a partial batch makes Paye Half partial; packet by menu price', () => {
    const inputs = kitchen();
    expect(recipeCost(inputs, 'V-PAYE-COOKED', B1, NOW, { top: false })).toMatchObject({ value: f(3_200_000n), status: 'costed' });
    expect(stockItemUnitCost(inputs, 'payeCooked', B1, NOW)?.per_stock_unit).toEqual(f(3_200_000n, 160n));
    expect(stockItemUnitCost(inputs, 'tp1', B1, NOW)).toEqual({ per_stock_unit: f(30n), source: 'menu' });
    const partialBatch = kitchen({
      items: [item('adrak', 'ingredient', 'g')],
      recipes: [
        version('V-PAYE-COOKED', {
          owner_type: 'stock_item',
          owner_id: 'payeCooked',
          basis: 'per_batch',
          batch_yield_qty: '160',
          batch_stock_unit: 'piece',
          lines: [line('payeRaw', '40000'), line('adrak', '500')], // adrak has no price
        }),
      ],
    });
    const plate = plateCost(partialBatch, pieceLine('payeHalf', 1n), B1, NOW);
    expect(plate).toMatchObject({ status: 'partial', known: true });
    expect(roundMinor(plate.value)).toBe(23_100n); // the known part, shown labelled
  });

  it('[08b #5] per_measure: karahi 1 000 g, sale 1 250 g → × 5/4; lassi 1 000 ml, sale 300 ml → × 3/10; options once on g / ml, × qty on piece', () => {
    const inputs = kitchen({
      items: [item('chicken', 'ingredient', 'g'), item('milk', 'ingredient', 'ml'), item('raita', 'ingredient', 'g')],
      prices: [price('chicken', 700, 1000), price('milk', 200, 1000, { stock_unit: 'ml' }), price('raita', 400, 1000)],
      recipes: [
        version('V-KARAHI', { owner_id: 'karahi', basis: 'per_measure', base_qty: 1000, measure_unit: 'g', misc_allowance_bp: 0, lines: [line('chicken', '1000')] }),
        version('V-LASSI', { owner_id: 'lassi', basis: 'per_measure', base_qty: 1000, measure_unit: 'ml', misc_allowance_bp: 0, lines: [line('milk', '800', 'ml')] }),
        version('V-RAITA', { owner_type: 'modifier_option', owner_id: 'raita', misc_allowance_bp: 0, lines: [line('raita', '100')] }),
        version('V-TAWA', { owner_id: 'tawa', misc_allowance_bp: 0, lines: [line('onion', '30')] }),
      ],
    });
    expect(plateCost(inputs, measureLine('karahi', 1250n, 'g'), B1, NOW).value).toEqual(f(70_000n * 5n, 4n));
    expect(plateCost(inputs, measureLine('lassi', 300n, 'ml'), B1, NOW).value).toEqual(f(800n * 20n * 3n, 10n));
    // raita (Rs 40) on a g parent: once per line, whatever the weight
    expect(plateCost(inputs, measureLine('karahi', 1250n, 'g', [{ option_id: 'raita', quantity: 1n }]), B1, NOW).value).toEqual(f(87_500n + 4_000n));
    // on a piece parent: × parent quantity (childQuantity, bigint → number at the boundary)
    const tawa = plateCost(inputs, pieceLine('tawa', 3n, [{ option_id: 'raita', quantity: 2n }]), B1, NOW);
    expect(tawa.value).toEqual(f(3n * 600n + 6n * 4_000n));
    expect(tawa.recipe_version_ids).toEqual({ item: 'V-TAWA', options: [{ option_id: 'raita', recipe_version_id: 'V-RAITA' }] });
  });

  it('[08b #6] dealCost over part results; part qty × deal qty; deal_qty on a g part; known; plain option without recipe; ids', () => {
    const inputs = kitchen({
      items: [item('chicken', 'ingredient', 'g')],
      prices: [price('chicken', 700, 1000)],
      recipes: [
        version('V-KARAHI', { owner_id: 'karahi', basis: 'per_measure', base_qty: 1000, measure_unit: 'g', misc_allowance_bp: 0, lines: [line('chicken', '1000'), line('onion', '50')] }),
        version('V-NO-ONION', { owner_type: 'modifier_option', owner_id: 'noOnion', misc_allowance_bp: 0, lines: [line('onion', '-30')] }),
        version('V-NAAN', { owner_id: 'naan', misc_allowance_bp: 0, lines: [line('onion', '10')] }),
      ],
    });
    const costed = { value: f(100n), status: 'costed' as const, known: true };
    const none = { value: f(0n), status: 'no_recipe' as const, known: false };
    expect(dealCost([costed, none])).toEqual({ value: f(100n), status: 'partial', known: true });
    expect(dealCost([none, none])).toEqual({ value: f(0n), status: 'no_recipe', known: false });
    expect(dealCost([costed, costed])).toEqual({ value: f(200n), status: 'costed', known: true });
    expect(dealCost([{ value: f(0n), status: 'partial', known: false }, none])).toMatchObject({ status: 'partial', known: false });
    // 2 deals × part qty 2 naan → plateCost called with 4
    expect(plateCost(inputs, pieceLine('naan', 4n), B1, NOW).value).toEqual(f(4n * 200n));
    // t-3: 2 family deals with a 1 000 g karahi part + "No onion" (−30 g) → the option counted × 2 (deal_qty)
    const part: SaleLineShape = { ...measureLine('karahi', 2000n, 'g', [{ option_id: 'noOnion', quantity: 1n }]), deal_qty: 2n };
    const plain = plateCost(inputs, { ...part, options: [] }, B1, NOW);
    expect(plain.value).toEqual(f(2n * (70_000n + 1_000n)));
    expect(plateCost(inputs, part, B1, NOW).value).toEqual(f(142_000n - 2n * 30n * 20n));
    // a plain option without a recipe → + 0, partial; ids returned for item and options
    const unknownOpt = plateCost(inputs, pieceLine('naan', 1n, [{ option_id: 'extraButter', quantity: 1n }]), B1, NOW);
    expect(unknownOpt).toMatchObject({ value: f(200n), status: 'partial', known: true, recipe_version_ids: { item: 'V-NAAN', options: [{ option_id: 'extraButter', recipe_version_id: null }] } });
    expect(plateCost(inputs, pieceLine('nothing', 1n), B1, NOW)).toMatchObject({ status: 'no_recipe', known: false, recipe_version_ids: { item: null } });
    expect(dealCost([])).toEqual({ value: f(0n), status: 'no_recipe', known: false });
    // t-6: every item line unknown but a costed option → known (value > 0, partial)
    const optOnly = kitchen({
      items: [item('makhan', 'ingredient', 'g')],
      recipes: [
        version('V-BARE', { owner_id: 'bare', misc_allowance_bp: 0, lines: [line('makhan', '10')] }),
        version('V-RAITA', { owner_type: 'modifier_option', owner_id: 'raita', misc_allowance_bp: 0, lines: [line('onion', '100')] }),
      ],
    });
    expect(plateCost(optOnly, pieceLine('bare', 1n, [{ option_id: 'raita', quantity: 1n }]), B1, NOW)).toMatchObject({ value: f(2_000n), status: 'partial', known: true });
  });

  it('[08b #7] B7 cap in AP stock units after yield: −30 g on 20 g direct → −20 g; only inside a sub-recipe → 0; × parent qty; × q / base_qty', () => {
    const inputs = kitchen({
      items: [item('qeemaCooked', 'prepared', 'g'), item('chicken', 'ingredient', 'g')],
      prices: [price('chicken', 700, 1000)],
      yields: [{ stock_item_id: 'onion', yield_bp: 8000 }],
      recipes: [
        version('V-DISH', { owner_id: 'dish', misc_allowance_bp: 0, lines: [line('beef', '100'), line('onion', '20')] }),
        version('V-DISH-EP', { owner_id: 'dishEp', misc_allowance_bp: 0, lines: [line('onion', '16', 'g', 'EP')] }), // AP 20 g
        version('V-QEEMA', { owner_type: 'stock_item', owner_id: 'qeemaCooked', basis: 'per_batch', batch_yield_qty: '1000', batch_stock_unit: 'g', lines: [line('onion', '200')] }),
        version('V-QDISH', { owner_id: 'qdish', misc_allowance_bp: 0, lines: [line('qeemaCooked', '100')] }),
        version('V-KARAHI', { owner_id: 'karahi', basis: 'per_measure', base_qty: 1000, measure_unit: 'g', misc_allowance_bp: 0, lines: [line('chicken', '1000'), line('onion', '20')] }),
        version('V-NO-ONION', { owner_type: 'modifier_option', owner_id: 'noOnion', misc_allowance_bp: 0, lines: [line('onion', '-30')] }),
      ],
    });
    const noOnion = [{ option_id: 'noOnion', quantity: 1n }];
    const ids = (item: string, v: string) => ({ item: v, options: [{ option_id: 'noOnion', recipe_version_id: 'V-NO-ONION' }] });
    const use = (l: SaleLineShape, v: string) => explodeUsage(inputs, { ...l, recipe_version_ids: ids(l.item_id, v) }).usage;
    expect(use(pieceLine('dish', 1n, noOnion), 'V-DISH').get('onion')).toBeUndefined(); // 20 − 20 = 0
    expect(plateCost(inputs, pieceLine('dish', 1n, noOnion), B1, NOW).value).toEqual(f(100n * 150n)); // −20 g, not −30 g
    expect(plateCost(inputs, pieceLine('dishEp', 1n, noOnion), B1, NOW).value).toEqual(f(0n)); // cap after yield: AP 20 g
    expect(use(pieceLine('qdish', 1n, noOnion), 'V-QDISH').get('onion')).toEqual(f(20n)); // onion only inside QEEMA: nothing removed
    expect(plateCost(inputs, pieceLine('qdish', 1n, noOnion), B1, NOW).value).toEqual(plateCost(inputs, pieceLine('qdish', 1n), B1, NOW).value);
    // per parent unit × parent quantity: 3 dishes, 3 × −30 capped at 3 × 20
    expect(use(pieceLine('dish', 3n, noOnion), 'V-DISH').get('onion')).toBeUndefined();
    expect(use(pieceLine('dish', 3n), 'V-DISH').get('onion')).toEqual(f(60n));
    // per_measure parent: × q / base_qty — 500 g karahi has 10 g direct onion; the option (once per line) removes ≤ 10 g
    expect(use(measureLine('karahi', 500n, 'g', noOnion), 'V-KARAHI').get('onion')).toBeUndefined();
    expect(plateCost(inputs, measureLine('karahi', 500n, 'g', noOnion), B1, NOW).value).toEqual(f(35_000n));
    // one cap per stock item for the whole sale line: two removals of onion together take ≤ 20 g, never below 0
    const twoRemovals = [{ option_id: 'noOnion', quantity: 1n }, { option_id: 'noSalad', quantity: 1n }];
    const both = { item: 'V-DISH', options: [{ option_id: 'noOnion', recipe_version_id: 'V-NO-ONION' }, { option_id: 'noSalad', recipe_version_id: 'V-NO-SALAD' }] };
    const withSalad = buildCostInputs({
      ...key({ items: [] }),
      items: [item('beef', 'ingredient', 'g'), item('onion', 'ingredient', 'g')],
      prices: [price('beef', 1500, 1000), price('onion', 200, 1000)],
      recipes: [
        version('V-DISH', { owner_id: 'dish', misc_allowance_bp: 0, lines: [line('beef', '100'), line('onion', '20')] }),
        version('V-NO-ONION', { owner_type: 'modifier_option', owner_id: 'noOnion', misc_allowance_bp: 0, lines: [line('onion', '-30')] }),
        version('V-NO-SALAD', { owner_type: 'modifier_option', owner_id: 'noSalad', misc_allowance_bp: 0, lines: [line('onion', '-30')] }),
      ],
    });
    expect(explodeUsage(withSalad, { ...pieceLine('dish', 1n, twoRemovals), recipe_version_ids: both }).usage).toEqual(new Map([['beef', f(100n)]]));
    expect(plateCost(withSalad, pieceLine('dish', 1n, twoRemovals), B1, NOW).value).toEqual(f(100n * 150n));
  });

  it('[08b #8] explodeUsage with per-line version ids: EP → AP by yield; prepared always; packet never; unknown yield; absent id; basis mismatch', () => {
    const inputs = kitchen({
      items: [item('chicken', 'ingredient', 'g')],
      recipes: [
        version('V-TAWA', { owner_id: 'tawa', lines: [line('beef', '250', 'g', 'EP'), line('tp1', '15'), line('payeCooked', '2', 'piece')] }),
        version('V-EP-NOYIELD', { owner_id: 'x', lines: [line('onion', '30', 'g', 'EP'), line('beef', '100')] }),
        version('V-KARAHI-ML', { owner_id: 'karahi', basis: 'per_measure', base_qty: 1000, measure_unit: 'ml', lines: [line('chicken', '1000')] }),
      ],
    });
    const tawa = explodeUsage(inputs, { ...pieceLine('tawa', 2n), recipe_version_ids: { item: 'V-TAWA', options: [] } });
    expect(tawa.status).toBe('costed');
    expect(tawa.usage).toEqual(
      new Map([
        ['beef', f(2n * 250n * 10_000n, 7120n)], // EP ÷ yield
        ['tp1', f(30n)], // packet: stock, never exploded
        ['payeRaw', f(2n * 2n * 40_000n, 160n)], // prepared: always exploded through its batch
      ]),
    );
    const noYield = explodeUsage(inputs, { ...pieceLine('x', 1n), recipe_version_ids: { item: 'V-EP-NOYIELD', options: [] } });
    expect(noYield).toEqual({ usage: new Map([['beef', f(100n)]]), status: 'partial' }); // onion left out
    // a version id absent from the inputs (more than 3 republishes back, OQ-5)
    expect(explodeUsage(inputs, { ...pieceLine('tawa', 1n), recipe_version_ids: { item: 'V-GONE', options: [] } })).toEqual({ usage: new Map(), status: 'partial' });
    // f-2: a karahi line ordered in g whose recorded version is per_measure ml → partial, nothing exploded
    expect(explodeUsage(inputs, { ...measureLine('karahi', 1000n, 'g'), recipe_version_ids: { item: 'V-KARAHI-ML', options: [] } })).toEqual({ usage: new Map(), status: 'partial' });
    // T-2 inside explodeUsage: a per_unit recipe on a g line → nothing exploded
    expect(explodeUsage(inputs, { ...measureLine('tawa', 250n, 'g'), recipe_version_ids: { item: 'V-TAWA', options: [] } })).toEqual({ usage: new Map(), status: 'partial' });
    // an option's recorded version absent from the inputs → that part partial, the item still exploded
    const lost = explodeUsage(inputs, { ...pieceLine('tawa', 1n, [{ option_id: 'raita', quantity: 1n }]), recipe_version_ids: { item: 'V-TAWA', options: [{ option_id: 'raita', recipe_version_id: 'V-GONE' }] } });
    expect(lost.status).toBe('partial');
    expect(lost.usage.get('tp1')).toEqual(f(15n));
    // N-1 inside explodeUsage: a line whose frozen unit is not the item's current one → that line left out
    const drifted = kitchen({ recipes: [version('V-OIL', { owner_id: 'fry', lines: [line('oil', '20', 'g'), line('onion', '5')] })] });
    expect(explodeUsage(drifted, { ...pieceLine('fry', 1n), recipe_version_ids: { item: 'V-OIL', options: [] } })).toEqual({ usage: new Map([['onion', f(5n)]]), status: 'partial' });
    // n-2: a prepared sub-line explodes through the CURRENT published version; once that sub-recipe is archived, partial
    const archivedSub = kitchen({
      recipes: [
        version('V-PAYE-COOKED', { owner_type: 'stock_item', owner_id: 'payeCooked', basis: 'per_batch', batch_yield_qty: '160', batch_stock_unit: 'piece', recipe_archived: true, lines: [line('payeRaw', '40000')] }),
      ],
    });
    expect(explodeUsage(archivedSub, { ...pieceLine('payeHalf', 1n), recipe_version_ids: { item: 'V-PAYE-HALF', options: [] } })).toEqual({ usage: new Map([['shorba', f(200n)]]), status: 'partial' });
  });

  it('[08b #9] round once, half away from zero: +0.5 → 1, −0.5 → −1; summing rounded lines never used', () => {
    expect(roundMinor(f(1n, 2n))).toBe(1n);
    expect(roundMinor(f(-1n, 2n))).toBe(-1n);
    expect(roundMinor(f(3n, 2n))).toBe(2n);
    expect(roundMinor(f(-5n, 4n))).toBe(-1n);
    expect(roundMinor(f(0n))).toBe(0n);
    // three lines of 1/3 minor each: the exact sum (1) rounds to 1; rounding each line first would give 0
    const inputs = buildCostInputs(
      key({
        items: [item('a', 'ingredient', 'g'), item('b', 'ingredient', 'g'), item('c', 'ingredient', 'g')],
        prices: ['a', 'b', 'c'].map((id) => price(id, 0.01, 3)),
        recipes: [version('V', { owner_id: 'm', misc_allowance_bp: 0, lines: [line('a', '1'), line('b', '1'), line('c', '1')] })],
      }),
    );
    expect(roundMinor(plateCost(inputs, pieceLine('m', 1n), B1, NOW).value)).toBe(1n);
  });

  it('[08b #10] never throws: cycle and depth 4 → partial / null; buildCostInputs element-wise with an unknown kind and a malformed price row', () => {
    const chain = (ids: string[]) =>
      ids.map((id, i) =>
        version(`V-${id}`, {
          owner_type: 'stock_item',
          owner_id: id,
          basis: 'per_batch',
          batch_yield_qty: '10',
          batch_stock_unit: 'g',
          lines: [i + 1 < ids.length ? line(ids[i + 1]!, '100') : line('onion', '100')],
        }),
      );
    const cycle = buildCostInputs(
      key({
        items: ['A', 'B', 'C', 'D', 'P', 'Q'].map((id) => item(id, 'prepared', 'g')).concat([item('onion', 'ingredient', 'g')]),
        prices: [price('onion', 200, 1000)],
        recipes: [
          ...chain(['A', 'B', 'C', 'D']), // A → B → C → D: depth 4
          version('V-P', { owner_type: 'stock_item', owner_id: 'P', basis: 'per_batch', batch_yield_qty: '1', batch_stock_unit: 'g', lines: [line('Q', '1')] }),
          version('V-Q', { owner_type: 'stock_item', owner_id: 'Q', basis: 'per_batch', batch_yield_qty: '1', batch_stock_unit: 'g', lines: [line('P', '1')] }),
          version('V-M', { owner_id: 'm', lines: [line('A', '10')] }),
          version('V-MP', { owner_id: 'mp', lines: [line('P', '10')] }),
          version('V-OK', { owner_id: 'ok', lines: [line('B', '10')] }), // B → C → D: three levels, allowed
        ],
      }),
    );
    for (const id of ['V-M', 'V-MP', 'V-P', 'V-A']) expect(() => recipeCost(cycle, id, B1, NOW, { top: true })).not.toThrow();
    expect(recipeCost(cycle, 'V-M', B1, NOW, { top: true }).status).toBe('partial');
    expect(recipeCost(cycle, 'V-MP', B1, NOW, { top: true }).status).toBe('partial');
    expect(recipeCost(cycle, 'V-OK', B1, NOW, { top: true }).status).toBe('costed');
    expect(plateCost(cycle, pieceLine('mp', 1n), B1, NOW)).toMatchObject({ status: 'partial', known: false });
    expect(explodeUsage(cycle, { ...pieceLine('m', 1n), recipe_version_ids: { item: 'V-M', options: [] } }).status).toBe('partial');
    expect(explodeStockItem(cycle, 'P', 1n)).toEqual({ usage: new Map(), status: 'partial' });
    expect(explodeStockItem(cycle, 'A', 1n).status).toBe('partial'); // A → B → C → D: depth 4 dropped
    expect(stockItemUnitCost(cycle, 'P', B1, NOW)).toBeNull();
    expect(stockItemUnitCost(cycle, 'A', B1, NOW)).toBeNull();
    // garbage in: never a throw, no items
    for (const junk of [null, undefined, 42, 'x', [], { items: 'nope' }, { items: [null], recipes: [{ lines: 'x' }] }]) {
      expect(() => buildCostInputs(junk)).not.toThrow();
    }
    expect(buildCostInputs(null).items.size).toBe(0);
    // review: a line without options, a malformed fraction, a malformed deal part — still no throw
    expect(() => plateCost(cycle, { kind: 'item', item_id: 'm', quantity: 1n, sale_unit: 'piece' } as unknown as SaleLineShape, B1, NOW)).not.toThrow();
    expect(() => plateCost(null as unknown as CostInputs, pieceLine('m', 1n), B1, NOW)).not.toThrow();
    expect(roundMinor({ num: 1n, den: 0n })).toBe(0n);
    expect(dealCost([{ status: 'costed', known: true } as unknown as Parameters<typeof dealCost>[0][number]])).toMatchObject({ status: 'partial' });
    // N-4 / t-5: one element of an unknown kind (kept as a string, treated unknown) and one malformed price row
    const lenient = buildCostInputs(
      key({
        items: [item('beef', 'ingredient', 'g'), item('semi', 'semi_prepared', 'g'), { ...item('onion', 'ingredient', 'g'), extra_field_08d: 1 }],
        prices: [price('beef', 1500, 1000), price('onion', 200, 1000), { ...price('semi', 1, 1), price_minor: 12.5 }],
        recipes: [version('V-1', { owner_id: 'a', lines: [line('beef', '100'), line('onion', '10')] }), version('V-2', { owner_id: 'b', lines: [line('semi', '10')] })],
      }),
    );
    expect(lenient.dropped).toBe(1);
    expect(lenient.items.get('semi')?.kind).toBe('semi_prepared');
    expect(recipeCost(lenient, 'V-1', B1, NOW, { top: false })).toMatchObject({ value: f(100n * 150n + 10n * 20n), status: 'costed' });
    expect(recipeCost(lenient, 'V-2', B1, NOW, { top: false })).toMatchObject({ status: 'partial', unknown: ['semi'] });
    expect(stockItemUnitCost(lenient, 'semi', B1, NOW)).toBeNull();
  });

  it('[08b #11] explodeStockItem: 14n PAYE-COOKED pieces → 14/160; 6n biryani plates → 6/40; through a sub-item; depth 4; no recipe', () => {
    const inputs = kitchen({
      items: [item('rice', 'ingredient', 'g'), item('chicken', 'ingredient', 'g'), item('ghee', 'ingredient', 'g'), item('biryani', 'prepared', 'piece'), item('masala', 'prepared', 'g'), item('chili', 'ingredient', 'g'), item('dal', 'prepared', 'g')],
      recipes: [
        version('V-BIRYANI', {
          owner_type: 'stock_item',
          owner_id: 'biryani',
          basis: 'per_batch',
          batch_yield_qty: '40',
          batch_stock_unit: 'piece',
          lines: [line('rice', '8000'), line('chicken', '6000'), line('ghee', '1000'), line('masala', '400')],
        }),
        version('V-MASALA', { owner_type: 'stock_item', owner_id: 'masala', basis: 'per_batch', batch_yield_qty: '1000', batch_stock_unit: 'g', lines: [line('chili', '500')] }),
      ],
    });
    expect(explodeStockItem(inputs, 'payeCooked', 14n)).toEqual({ usage: new Map([['payeRaw', f(14n * 40_000n, 160n)]]), status: 'costed' });
    expect(explodeStockItem(inputs, 'biryani', 6n)).toEqual({
      usage: new Map([
        ['rice', f(6n * 8000n, 40n)],
        ['chicken', f(6n * 6000n, 40n)],
        ['ghee', f(6n * 1000n, 40n)],
        ['chili', f(6n * 400n * 500n, 40n * 1000n)], // through the prepared sub-item
      ]),
      status: 'costed',
    });
    expect(explodeStockItem(inputs, 'dal', 1n)).toEqual({ usage: new Map(), status: 'partial' }); // prepared, no published recipe
    expect(explodeStockItem(inputs, 'rice', 1n)).toEqual({ usage: new Map(), status: 'partial' }); // not prepared
  });

  it('[08b §4.2] archived recipes kept by id, not in publishedByOwner (t-7 b); superseded kept by id; exports on the package root', () => {
    const inputs = kitchen({
      recipes: [
        version('V-OLD', { owner_id: 'tawa', status: 'superseded', lines: [line('onion', '10')] }),
        version('V-ARCH', { owner_id: 'gone', recipe_archived: true, lines: [line('onion', '10')] }),
      ],
    });
    expect(inputs.versions.has('V-OLD')).toBe(true);
    expect(inputs.versions.has('V-ARCH')).toBe(true);
    expect(inputs.publishedByOwner.get('menu_item:tawa')).toBeUndefined();
    expect(inputs.publishedByOwner.get('menu_item:gone')).toBeUndefined();
    expect(inputs.publishedByOwner.get('stock_item:payeCooked')).toBe('V-PAYE-COOKED');
    expect(plateCost(inputs, pieceLine('gone', 1n), B1, NOW).status).toBe('no_recipe');
    // a line sold before the archive still explodes with its recorded version
    expect(explodeUsage(inputs, { ...pieceLine('gone', 1n), recipe_version_ids: { item: 'V-ARCH', options: [] } }).usage.get('onion')).toEqual(f(10n));
    for (const name of ['buildCostInputs', 'plateCost', 'dealCost', 'recipeCost', 'stockItemUnitCost', 'explodeUsage', 'explodeStockItem', 'roundMinor']) {
      expect(typeof (root as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('[08b #27 t-1] snapshot price rows: created_at → per-item rank (created_at, then price_id); a hub clock behind the cloud still uses them', () => {
    const rows = [
      { ...price('beef', 1000, 1000), price_id: 'P-B', created_at: 5_000 },
      { ...price('beef', 1200, 1000), price_id: 'P-A', created_at: 5_000 }, // same created_at, lower id
      { ...price('beef', 1100, 1000), price_id: 'P-C', created_at: 4_000 },
    ];
    const inputs = buildCostInputs(key({ items: [item('beef', 'ingredient', 'g')], prices: rows }));
    expect(inputs.prices.get('beef')!.map((p) => [p.price_id, p.created_at])).toEqual([
      ['P-B', 2],
      ['P-A', 1],
      ['P-C', 0],
    ]);
    // 08a I7 on the cloud would pick P-B (created_at 5 000, then price_id P-B > P-A); the hub, at any clock, picks the same
    expect(stockItemUnitCost(inputs, 'beef', B1, 3)?.per_stock_unit).toEqual(f(100n));
    // the cloud context keeps created_at (rows are time-filtered for now already)
    const cloud = buildCostInputs({ source: 'cloud', ...key({ items: [item('beef', 'ingredient', 'g')], prices: rows }) });
    expect(cloud.prices.get('beef')!.map((p) => p.created_at)).toEqual([5_000, 5_000, 4_000]);
  });
});
