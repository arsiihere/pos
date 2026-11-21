import { describe, expect, it } from 'vitest';
import {
  allocateCappedMinor,
  apportionMinor,
  computeBill,
  computeSplit,
  type ComputeBillInput,
  type ComputePayment,
  type ComputeSplitResult,
  type ComputeTotals,
  SERVICE_CHARGE_ID,
  spreadLineTaxes,
  type ComputeSplitInput,
  type ComputeSplitLine,
} from './compute.js';
import {
  cashStepRules,
  line,
  noneRules,
  PK_PB_RULES,
  PK_REGRESSION,
  PK_RULES,
  pkPbProfile,
  rateBpProfile,
  rates,
  stackedProfile,
  TABLE7_LINES,
  TODAY,
} from './compute.fixtures.js';

function bill(over: Partial<ComputeBillInput> = {}): ComputeBillInput {
  return {
    business_date: TODAY,
    rules: PK_PB_RULES,
    tax_profiles: [pkPbProfile()],
    lines: [line('L1', PK_REGRESSION.net_minor, 'restaurant')],
    discount: null,
    service_charge: null,
    plan: { mode: 'none', split_no: 1 },
    payments: [],
    ...over,
  };
}

const card = (amount_minor: number, split_no = 1): ComputePayment => ({ split_no, payment_class: 'digital', direction: 'in', amount_minor });
const cash = (amount_minor: number, split_no = 1, tendered_minor?: number): ComputePayment => ({
  split_no,
  payment_class: 'cash',
  direction: 'in',
  amount_minor,
  ...(tendered_minor === undefined ? {} : { tendered_minor }),
});
const out = (payment_class: 'cash' | 'digital', amount_minor: number, split_no = 1): ComputePayment => ({
  split_no,
  payment_class,
  direction: 'out',
  amount_minor,
});

function only(b: ComputeBillInput): ComputeSplitResult {
  const r = computeBill(b);
  expect(r.splits).toHaveLength(1);
  return r.splits[0] as ComputeSplitResult;
}

function taxSum(t: ComputeTotals): number {
  return t.taxes.reduce((a, x) => a + x.tax_minor, 0);
}

function money(t: ComputeTotals) {
  return { tax_minor: taxSum(t), exact_total_minor: t.exact_total_minor, rounding_minor: t.rounding_minor, total_minor: t.total_minor };
}

function dues(s: ComputeSplitResult) {
  return {
    balance_minor: s.balance_minor,
    card_due_minor: s.card_due_minor,
    cash_due_minor: s.cash_due_minor,
    card_refund_due_minor: s.card_refund_due_minor,
    cash_refund_due_minor: s.cash_refund_due_minor,
  };
}

describe('apportionMinor / allocateCappedMinor (05 §3.5 (2), (6))', () => {
  it('[05 #10d] the review bases [99900, 99900, 99900, 100] with 299 700: Σ = total, 0 ≤ share ≤ base, ties to the earlier line', () => {
    const shares = allocateCappedMinor(299_700, [99_900, 99_900, 99_900, 100]);
    expect(shares).toEqual([99_867, 99_867, 99_866, 100]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(299_700);
  });

  it('[05 #10d] a total above Σ caps is refused; zero caps with zero total give zeros', () => {
    expect(() => allocateCappedMinor(11, [5, 5])).toThrow();
    expect(allocateCappedMinor(0, [0, 0])).toEqual([0, 0]);
    expect(allocateCappedMinor(10, [5, 5])).toEqual([5, 5]);
  });

  it('[05 #11c] apportionMinor by exact shares: the review case W gives [125, 27]', () => {
    // e = 124.69 / 27.43 (TI 152 on A 13.99, VAT 10 % simple + levy 2 % compound): weights in any common unit.
    expect(apportionMinor(152, [12_469, 2_743])).toEqual([125, 27]);
    expect(apportionMinor(152, [0, 0, 5])).toEqual([0, 0, 152]);
    expect(apportionMinor(3, [1, 1, 1, 1])).toEqual([1, 1, 1, 0]);
    expect(() => apportionMinor(1, [0, 0])).toThrow();
  });
});

describe('Pakistan regression (05 #11, v0.6.2 §6.31)', () => {
  it('[05 #11] PK-PB: check bill, card due and cash due are v0.6.2 byte for byte', () => {
    const s = only(bill());
    expect(money(s.totals.cash)).toEqual(PK_REGRESSION.pk_pb.cash);
    expect(money(s.totals.digital)).toEqual(PK_REGRESSION.pk_pb.digital);
    expect(s.totals.cash.taxes).toEqual([
      {
        tax_profile_id: 'restaurant',
        tax_code: 'PST',
        label: 'Punjab sales tax on services',
        seq: 1,
        compound: false,
        payment_class: 'cash',
        rate_bp: 1600,
        rate_ref: 'PRA.32-24/2026/1313',
        base_minor: 571_000,
        tax_minor: 91_360,
      },
    ]);
    expect(s.payment_class).toBe('cash');
    expect(s.card_due_minor).toBe(599_600);
    expect(s.cash_due_minor).toBe(662_400);
  });

  it('[05 #11] PK-PB all card: 5 % → 5,996.00 closes; mixed card 3,000 + cash 3,624 → 6,624.00', () => {
    const allCard = only(bill({ payments: [card(599_600)] }));
    expect(allCard.payment_class).toBe('digital');
    expect(money(allCard.totals.as_paid)).toEqual(PK_REGRESSION.pk_pb.digital);
    expect(allCard.balance_minor).toBe(0);

    const m = PK_REGRESSION.pk_pb.mixed_card_then_cash;
    const mixed = only(bill({ payments: [card(m.card_minor), cash(m.cash_minor)] }));
    expect(mixed.payment_class).toBe('cash');
    expect(mixed.totals.as_paid.total_minor).toBe(m.total_minor);
    expect(mixed.balance_minor).toBe(0);
  });

  it('[05 #11] seed PK (v0.6.2 adapter none): one tax at rate_bp for both classes, Rs 1 rounding — byte-identical', () => {
    const s = only(bill({ rules: PK_RULES, tax_profiles: [rateBpProfile('restaurant', 'Restaurant', 1600)] }));
    expect(money(s.totals.cash)).toEqual(PK_REGRESSION.pk_rate_bp_1600.cash);
    expect(money(s.totals.digital)).toEqual(PK_REGRESSION.pk_rate_bp_1600.digital);
    expect(s.totals.cash.taxes.map((t) => [t.tax_code, t.label, t.rate_bp, t.base_minor, t.tax_minor])).toEqual([
      ['TAX', 'Restaurant', 1600, 571_000, 91_360],
    ]);
  });

  it('[05 #11] seed none: the same tax rows, no rounding (step NULL, H9-3)', () => {
    const pk = only(bill({ rules: PK_RULES, tax_profiles: [rateBpProfile('restaurant', 'Restaurant', 1600)] }));
    const none = only(bill({ rules: noneRules(), tax_profiles: [rateBpProfile('restaurant', 'Restaurant', 1600)] }));
    expect(none.totals.cash.taxes).toEqual(pk.totals.cash.taxes);
    expect(none.totals.cash.rounding_minor).toBe(0);
    expect(none.totals.cash.total_minor).toBe(662_360);
  });

  it('[05 #8 compute half] equal into 3 of Rs 1,000.00 → 333.33 / 333.33 / 333.34 net shares; each carries the live units', () => {
    const r = computeBill(
      bill({ lines: [line('L1', 100_000, null, { units: 4 })], plan: { mode: 'equal', splits: [{ split_no: 1 }, { split_no: 2 }, { split_no: 3 }] } }),
    );
    expect(r.splits.map((s) => s.totals.as_paid.subtotal_minor)).toEqual([33_333, 33_333, 33_334]);
    // §5 closed_split_units (H1-27): amount / equal splits record the line's live units (the whole line freezes)
    expect(r.splits.map((s) => s.lines.map((l) => [l.order_item_id, l.units]))).toEqual([[['L1', 4]], [['L1', 4]], [['L1', 4]]]);
  });
});

describe('tax arithmetic (05 #11, #11b, #12, #13, #13b, #14)', () => {
  it('[05 #11] exclusive and inclusive, 500 / 1600 bp, one rounding per profile', () => {
    const p = [rateBpProfile('p16', 'GST', 1600), stackedProfile('unused', 1, 1, false)];
    const ex = only(bill({ rules: PK_RULES, tax_profiles: p, lines: [line('A', 100_000, 'p16')] }));
    expect(money(ex.totals.cash)).toEqual({ tax_minor: 16_000, exact_total_minor: 116_000, rounding_minor: 0, total_minor: 116_000 });

    const incl = { ...PK_RULES, prices_include_tax: true };
    const in16 = only(bill({ rules: incl, tax_profiles: p, lines: [line('A', 116_000, 'p16')] }));
    expect(in16.totals.cash.pre_tax_net_minor).toBe(100_000);
    expect(in16.totals.cash.taxes[0]).toMatchObject({ base_minor: 100_000, tax_minor: 16_000 });
    expect(in16.totals.cash.exact_total_minor).toBe(116_000);

    // 500 bp inclusive: TI = round_half_up(116 000 × 500 / 10 500) = round_half_up(5 523.8…) = 5 524 (one rounding).
    const in5 = only(bill({ rules: incl, tax_profiles: [rateBpProfile('p5', 'GST', 500)], lines: [line('A', 116_000, 'p5')] }));
    expect(in5.totals.cash.taxes[0]).toMatchObject({ base_minor: 110_476, tax_minor: 5_524 });
    expect(in5.totals.cash.exact_total_minor).toBe(116_000);
  });

  it('[05 #11] half up only at the named points: 10 × 500 bp = 0.5 → 1; 9 × 500 bp = 0.45 → 0', () => {
    const p = [rateBpProfile('p5', 'GST', 500)];
    expect(only(bill({ rules: noneRules(), tax_profiles: p, lines: [line('A', 10, 'p5')] })).totals.cash.taxes[0]?.tax_minor).toBe(1);
    expect(only(bill({ rules: noneRules(), tax_profiles: p, lines: [line('A', 9, 'p5')] })).totals.cash.taxes[0]?.tax_minor).toBe(0);
    // two lines of 9 in one profile: one rounding on the profile's base 18 → 0.9 → 1 (not 0 + 0)
    const two = only(bill({ rules: noneRules(), tax_profiles: p, lines: [line('A', 9, 'p5'), line('B', 9, 'p5')] }));
    expect(two.totals.cash.taxes).toHaveLength(1);
    expect(two.totals.cash.taxes[0]?.tax_minor).toBe(1);
  });

  it('[05 #11] a BigInt-sized product is exact (Rs 9,999,999 × 1600 bp, both price modes)', () => {
    const p = [rateBpProfile('p16', 'GST', 1600)];
    const ex = only(bill({ rules: noneRules(), tax_profiles: p, lines: [line('A', 999_999_900, 'p16')] }));
    expect(ex.totals.cash.taxes[0]?.tax_minor).toBe(159_999_984);
    const incl = only(bill({ rules: { ...noneRules(), prices_include_tax: true }, tax_profiles: p, lines: [line('A', 999_999_900, 'p16')] }));
    // 999 999 900 × 1600 / 11 600 = 137 931 020.68… → 137 931 021
    expect(incl.totals.cash.taxes[0]?.tax_minor).toBe(137_931_021);
    expect(incl.totals.cash.exact_total_minor).toBe(999_999_900);
    // compound pair inclusive: products pass 2^53 inside (rationals over 10^8)
    const c = only(
      bill({
        rules: { ...noneRules(), prices_include_tax: true },
        tax_profiles: [stackedProfile('c', 500, 950, true)],
        lines: [line('A', 9_999_999_999, 'c')],
      }),
    );
    expect(c.totals.cash.exact_total_minor).toBe(9_999_999_999);
    expect(taxSum(c.totals.cash) + c.totals.cash.pre_tax_net_minor).toBe(9_999_999_999);
  });

  it('[05 #11b] stacked simple pair 500 + 800: two rows in list order, each rounded at its own point', () => {
    const s = only(bill({ rules: noneRules(), tax_profiles: [stackedProfile('s', 500, 800, false)], lines: [line('A', 1_000_001, 's')] }));
    expect(s.totals.cash.taxes.map((t) => [t.seq, t.tax_code, t.compound, t.base_minor, t.tax_minor])).toEqual([
      [1, 'FED', false, 1_000_001, 50_000], // 50 000.05 → 50 000
      [2, 'PROV', false, 1_000_001, 80_000], // 80 000.08 → 80 000
    ]);
    expect(s.totals.cash.exact_total_minor).toBe(1_000_001 + 130_000);
  });

  it('[05 #11b] compound pair 500 + 950: the compound base includes the first row rounded tax', () => {
    const s = only(bill({ rules: noneRules(), tax_profiles: [stackedProfile('c', 500, 950, true)], lines: [line('A', 1_000_009, 'c')] }));
    // FED = rhu(50 000.45) = 50 000; PROV base = 1 000 009 + 50 000 = 1 050 009 → rhu(99 750.855) = 99 751
    expect(s.totals.cash.taxes.map((t) => [t.tax_code, t.base_minor, t.tax_minor])).toEqual([
      ['FED', 1_000_009, 50_000],
      ['PROV', 1_050_009, 99_751],
    ]);
  });

  it('[05 #11b] inclusive compound 500 + 950 on 11 497.50: one rounding, spread [500.00, 997.50] exactly', () => {
    const s = only(
      bill({ rules: { ...noneRules(), prices_include_tax: true }, tax_profiles: [stackedProfile('c', 500, 950, true)], lines: [line('A', 1_149_750, 'c')] }),
    );
    expect(s.totals.cash.pre_tax_net_minor).toBe(1_000_000);
    expect(s.totals.cash.taxes.map((t) => [t.tax_code, t.base_minor, t.tax_minor])).toEqual([
      ['FED', 1_000_000, 50_000],
      ['PROV', 1_050_000, 99_750],
    ]);
  });

  it('[05 #11c] review walk W: inclusive VAT 10 % + levy 2 % compound, 10.00 + 4.99 less 1.00 → rows [1.25, 0.27], G = menu', () => {
    const w = {
      tax_profile_id: 'w',
      taxes: [
        { seq: 1, tax_code: 'VAT', label: 'VAT', compound: false, rates: rates(1000, 1000) },
        { seq: 2, tax_code: 'LEVY', label: 'Levy', compound: true, rates: rates(200, 200) },
      ],
    };
    const r = computeBill(
      bill({
        rules: cashStepRules({ prices_include_tax: true }),
        tax_profiles: [w],
        lines: [line('A', 1000, 'w'), line('B', 499, 'w')],
        discount: { kind: 'amount', value: 100, frozen: null },
      }),
    );
    expect(r.lines.map((l) => l.discount_minor)).toEqual([67, 33]);
    const s = r.splits[0] as ComputeSplitResult;
    expect(s.totals.digital.pre_tax_net_minor).toBe(1247);
    expect(s.totals.digital.taxes.map((t) => [t.tax_code, t.base_minor, t.tax_minor])).toEqual([
      ['VAT', 1247, 125],
      ['LEVY', 1372, 27],
    ]);
    expect(s.totals.digital.exact_total_minor).toBe(1399);
    expect(s.totals.digital.total_minor).toBe(1399); // card: no rounding under 'cash'
    expect(s.cash_due_minor).toBe(1400);
    expect(s.card_due_minor).toBe(1399);
  });

  it('[05 #12] a deal is taxed under its own profile on its whole billed amount; a deal part never; an option child under its own', () => {
    const s = only(
      bill({
        rules: noneRules(),
        tax_profiles: [rateBpProfile('meal', 'Meal', 1600), rateBpProfile('drink', 'Drink', 500)],
        lines: [
          line('D', 100_000, 'meal', { line_kind: 'deal' }),
          line('DP', 0, 'drink', { line_kind: 'deal_part' }),
          line('OC', 10_000, 'drink', { line_kind: 'option_child' }),
        ],
      }),
    );
    expect(s.totals.cash.taxes.map((t) => [t.tax_profile_id, t.base_minor, t.tax_minor])).toEqual([
      ['meal', 100_000, 16_000],
      ['drink', 10_000, 500],
    ]);
  });

  it('[05 #13] two profiles: each row on its own lines only; tax disabled or a null profile → no tax; PK-PB has one row per profile', () => {
    const profiles = [pkPbProfile('restaurant'), { ...pkPbProfile('bakery') }];
    const lines = [line('A', 100_000, 'restaurant'), line('B', 50_000, 'bakery'), line('C', 7_000, null)];
    const s = only(bill({ tax_profiles: profiles, lines }));
    expect(s.totals.cash.taxes.map((t) => [t.tax_profile_id, t.base_minor, t.tax_minor])).toEqual([
      ['restaurant', 100_000, 16_000],
      ['bakery', 50_000, 8_000],
    ]);
    expect(s.totals.cash.exact_total_minor).toBe(157_000 + 24_000);
    const off = only(bill({ tax_profiles: profiles, lines, rules: { ...PK_PB_RULES, tax_enabled: false } }));
    expect(off.totals.cash.taxes).toEqual([]);
    expect(off.totals.cash.exact_total_minor).toBe(157_000);
    expect(off.blocks).toEqual([]);
  });

  it('[05 #13b blocks half] a taxed line whose profile has no tax list or no rate row in force → tax_unresolved', () => {
    const r = computeBill(
      bill({
        rules: noneRules(),
        tax_profiles: [
          { tax_profile_id: 'empty', taxes: [] },
          { tax_profile_id: 'future', taxes: [{ seq: 1, tax_code: 'T', label: 'T', compound: false, rates: rates(1600, 500, '2026-11-20') }] },
          rateBpProfile('ok', 'OK', 1600),
        ],
        lines: [line('A', 100, 'empty'), line('B', 100, 'future'), line('C', 100, 'missing'), line('D', 100, 'ok'), line('E', 100, null)],
      }),
    );
    expect(r.blocks).toEqual([{ reason: 'tax_unresolved', ids: ['A', 'B', 'C'] }]);
    expect(r.splits[0]?.blocks).toEqual([{ reason: 'tax_unresolved', ids: ['A', 'B', 'C'] }]);
    expect(r.lines.map((l) => [l.order_item_id, l.tags])).toEqual([
      ['A', ['tax_unresolved']],
      ['B', ['tax_unresolved']],
      ['C', ['tax_unresolved']],
      ['D', []],
      ['E', []],
    ]);
    // a missing class row is unresolved too (both classes are needed for the dues)
    const cashOnly = computeBill(
      bill({
        tax_profiles: [
          { tax_profile_id: 'p', taxes: [{ seq: 1, tax_code: 'T', label: 'T', compound: false, rates: rates(1600, 500).filter((x) => x.payment_class === 'cash') }] },
        ],
        lines: [line('A', 100, 'p')],
      }),
    );
    expect(cashOnly.blocks).toEqual([{ reason: 'tax_unresolved', ids: ['A'] }]);
  });

  it('[05 #13b blocks half] an applied service charge whose profile does not resolve blocks too (never billed untaxed)', () => {
    const sc = { rate_bp: 1000, removed: false, tax_profile_id: 'missing' };
    const r = computeBill(bill({ service_charge: sc }));
    expect(r.blocks).toEqual([{ reason: 'tax_unresolved', ids: [SERVICE_CHARGE_ID] }]);
    expect(computeBill(bill({ service_charge: { ...sc, removed: true } })).blocks).toEqual([]);
    expect(computeBill(bill({ service_charge: { ...sc, tax_profile_id: null } })).blocks).toEqual([]);
  });

  it('[05 #13b blocks half] under none every profile resolves from rate_bp', () => {
    const r = computeBill(bill({ rules: noneRules(), tax_profiles: [rateBpProfile('a', 'A', 0), rateBpProfile('b', 'B', 1600)], lines: [line('A', 1, 'a'), line('B', 1, 'b')] }));
    expect(r.blocks).toEqual([]);
  });

  it('[05 #14 rate-by-date half] a row effective tomorrow is not used today; at its date it is; the row ref is shown; integration status picks', () => {
    const p = {
      tax_profile_id: 'p',
      taxes: [
        {
          seq: 1,
          tax_code: 'PST',
          label: 'PST',
          compound: false,
          rates: [
            ...rates(1600, 500, '2026-02-19', 'old'),
            ...rates(1500, 400, '2026-11-20', 'new'),
            { payment_class: 'cash' as const, integration_status: 'not_integrated' as const, effective_from: '2026-03-01', rate_bp: 1700, ref: 'ni' },
          ],
        },
      ],
    };
    const today = only(bill({ tax_profiles: [p], lines: [line('A', 100_000, 'p')] }));
    expect(today.totals.cash.taxes[0]).toMatchObject({ rate_bp: 1600, rate_ref: 'old' });
    expect(today.totals.digital.taxes[0]).toMatchObject({ rate_bp: 500, rate_ref: 'old' });
    const tomorrow = only(bill({ business_date: '2026-11-20', tax_profiles: [p], lines: [line('A', 100_000, 'p')] }));
    expect(tomorrow.totals.cash.taxes[0]).toMatchObject({ rate_bp: 1500, rate_ref: 'new' });
    const ni = only(bill({ rules: { ...PK_PB_RULES, integration_status: 'not_integrated' }, tax_profiles: [p], lines: [line('A', 100_000, 'p')] }));
    expect(ni.totals.cash.taxes[0]).toMatchObject({ rate_bp: 1700, rate_ref: 'ni' });
  });
});

describe('payment class, dues and refunds (05 #15 compute half, #20b)', () => {
  it('[05 #15 compute half] higher_rate: card 3,000 + cash 3,624 on Rs 5,710 → 16 % on the whole → 6,624.00, any payment order', () => {
    for (const pays of [[card(300_000), cash(362_400)], [cash(362_400), card(300_000)]]) {
      const s = only(bill({ payments: pays }));
      expect(s.payment_class).toBe('cash');
      expect(s.mixed_rule).toBe('higher_rate');
      expect(s.totals.as_paid.taxes[0]).toMatchObject({ payment_class: 'cash', rate_bp: 1600, tax_minor: 91_360 });
      expect(s.totals.as_paid.total_minor).toBe(662_400);
      expect(s.balance_minor).toBe(0);
    }
  });

  it('[05 #15 compute half] unpaid: card_due 5,996.00, cash_due 6,624.00; after card 3,000: cash due 3,624.00, card due 2,996.00', () => {
    expect(dues(only(bill()))).toEqual({
      balance_minor: 662_400,
      card_due_minor: 599_600,
      cash_due_minor: 662_400,
      card_refund_due_minor: 0,
      cash_refund_due_minor: 0,
    });
    const afterCard = only(bill({ payments: [card(300_000)] }));
    expect(afterCard.payment_class).toBe('digital');
    expect(afterCard.cash_due_minor).toBe(362_400);
    expect(afterCard.card_due_minor).toBe(299_600);
    // after cash 3,624 first, the card due is at the cash rates (the split is cash)
    const afterCash = only(bill({ payments: [cash(362_400)] }));
    expect(afterCash.card_due_minor).toBe(300_000);
  });

  it('[05 #15 compute half] all card 5 % → 5,996.00; then cash_due 0 (no due while balance ≤ 0); a cash refund on a card bill has no due', () => {
    const s = only(bill({ payments: [card(599_600)] }));
    expect(s.totals.as_paid.total_minor).toBe(599_600);
    expect(dues(s)).toEqual({ balance_minor: 0, card_due_minor: 0, cash_due_minor: 0, card_refund_due_minor: 0, cash_refund_due_minor: 0 });
    // reopen −1.00 base → re-rounded 5,994.00 → only "refund card 2.00", no cash due, no cash refund
    const reopened = only(bill({ lines: [line('L1', 570_900, 'restaurant')], payments: [card(599_600)] }));
    expect(dues(reopened)).toEqual({
      balance_minor: -200,
      card_due_minor: 0,
      cash_due_minor: 0,
      card_refund_due_minor: 200,
      cash_refund_due_minor: 0,
    });
  });

  it('[05 #20b] Pakistan: card-only 5,995.50 → 5,996.00 (R +0.50 untaxed, tax row 285.50 unchanged); cash 6,623.60 → 6,624.00', () => {
    const s = only(bill({ payments: [card(599_600)] }));
    expect(s.totals.as_paid.taxes[0]?.tax_minor).toBe(28_550);
    expect(s.totals.as_paid.rounding_minor).toBe(50);
    expect(s.rounding_minor).toBe(50);
    expect(s.totals.cash.rounding_minor).toBe(40);
    expect(s.totals.cash.total_minor).toBe(662_400);
  });

  it('[05 #20b] full refund: card 3,000 + cash 3,624, every line removed → card out 3,000 + cash out 3,624, rounding included', () => {
    const s = only(bill({ lines: [], payments: [card(300_000), cash(362_400)] }));
    expect(s.totals.as_paid.total_minor).toBe(0);
    expect(dues(s)).toEqual({
      balance_minor: -662_400,
      card_due_minor: 0,
      cash_due_minor: 0,
      card_refund_due_minor: 300_000,
      cash_refund_due_minor: 362_400,
    });
    const settled = only(bill({ lines: [], payments: [card(300_000), cash(362_400), out('digital', 300_000), out('cash', 362_400)] }));
    expect(settled.balance_minor).toBe(0);
    expect(settled.card_refund_due_minor).toBe(0);
    expect(settled.cash_refund_due_minor).toBe(0);
  });

  it('[05 #20b] partial: card bill 2,100.00, reopen −200.00 base → exact 1,890.40, re-rounded 1,890.00 → card out 210.00; cash out has no due', () => {
    const paid = only(bill({ lines: [line('A', 200_038, 'restaurant')], payments: [card(210_000)] }));
    expect(paid.totals.as_paid.exact_total_minor).toBe(210_040);
    expect(paid.balance_minor).toBe(0);
    const s = only(bill({ lines: [line('A', 180_038, 'restaurant')], payments: [card(210_000)] }));
    expect(s.totals.as_paid.exact_total_minor).toBe(189_040);
    expect(s.totals.as_paid.total_minor).toBe(189_000);
    expect(s.card_refund_due_minor).toBe(21_000);
    expect(s.cash_refund_due_minor).toBe(0);
  });

  it('[05 #20b] no-change reopen → refund 0, the same tax and total', () => {
    // the original close: mixed card 3,000 + cash 3,624 (class cash); the reopen carries both payments, no line change
    const unpaid = only(bill({ payments: [card(300_000)] }));
    const closed = only(bill({ payments: [card(300_000), cash(unpaid.cash_due_minor)] }));
    expect(closed.balance_minor).toBe(0);
    const reopened = only(bill({ payments: [card(300_000), cash(362_400)] }));
    expect(reopened.totals.as_paid).toEqual(closed.totals.as_paid);
    expect(dues(reopened)).toEqual({ balance_minor: 0, card_due_minor: 0, cash_due_minor: 0, card_refund_due_minor: 0, cash_refund_due_minor: 0 });
  });

  it("[05 #20b] applies_to 'cash' step 5: card-only 12.02 → R 0; card 10.00 + cash 2.00 → R −0.02, total 12.00", () => {
    const rules = cashStepRules();
    const lines = [line('A', 1202, null)];
    const cardOnly = only(bill({ rules, tax_profiles: [], lines, payments: [card(1202)] }));
    expect(cardOnly.totals.as_paid.rounding_minor).toBe(0);
    expect(cardOnly.totals.as_paid.total_minor).toBe(1202);
    expect(cardOnly.balance_minor).toBe(0);
    const mixed = only(bill({ rules, tax_profiles: [], lines, payments: [card(1000), cash(200)] }));
    expect(mixed.totals.as_paid.rounding_minor).toBe(-2);
    expect(mixed.totals.as_paid.total_minor).toBe(1200);
    expect(mixed.balance_minor).toBe(0);
  });

  it("[05 #20b] mixed card 10.00 + cash 2.00 on 12.02 (cash step 5), reopen to 7.01 → total 7.00 → refund 5.00, card ≤ 10.00, cash ≤ 2.00", () => {
    const s = only(bill({ rules: cashStepRules(), tax_profiles: [], lines: [line('A', 701, null)], payments: [card(1000), cash(200)] }));
    expect(s.totals.as_paid.total_minor).toBe(700);
    expect(s.balance_minor).toBe(-500);
    expect(s.card_refund_due_minor).toBe(500);
    expect(s.cash_refund_due_minor).toBe(200);
  });

  it("[05 #20b] 'cash' step 5: an unpaid 13.99 check bill prints 14.00; a 0.02 split closes at 0 with no payment (rounding −0.02)", () => {
    const rules = cashStepRules();
    const unpaid = only(bill({ rules, tax_profiles: [], lines: [line('A', 1399, null)] }));
    expect(unpaid.totals.cash.total_minor).toBe(1400);
    expect(unpaid.cash_due_minor).toBe(1400);
    const tiny = only(bill({ rules, tax_profiles: [], lines: [line('A', 2, null)] }));
    expect(tiny.totals.as_paid.rounding_minor).toBe(-2);
    expect(tiny.totals.as_paid.total_minor).toBe(0);
    expect(dues(tiny)).toEqual({ balance_minor: 0, card_due_minor: 0, cash_due_minor: 0, card_refund_due_minor: 0, cash_refund_due_minor: 0 });
  });

  it("[05 #20b] exponent 0, step 5 'up', cash total 12 050 (exact 12 049): card 33 first → cash due 12 015 (rounded down); cash 12 015 + card 2 closes", () => {
    const rules = cashStepRules({ currency_exponent: 0, rounding: { step_minor: 5, mode: 'up', applies_to: 'cash' } });
    const lines = [line('A', 12_049, null)];
    expect(only(bill({ rules, tax_profiles: [], lines })).totals.cash.total_minor).toBe(12_050);
    const afterCard = only(bill({ rules, tax_profiles: [], lines, payments: [card(33)] }));
    expect(afterCard.cash_due_minor).toBe(12_015);
    const afterBoth = only(bill({ rules, tax_profiles: [], lines, payments: [card(33), cash(12_015)] }));
    expect(afterBoth.balance_minor).toBe(2);
    expect(afterBoth.card_due_minor).toBe(2);
    const closed = only(bill({ rules, tax_profiles: [], lines, payments: [card(33), cash(12_015), card(2)] }));
    expect(closed.balance_minor).toBe(0);
    // a cash refund due off the step is shown rounded down
    const refund = only(bill({ rules, tax_profiles: [], lines: [line('A', 12_000, null)], payments: [card(33), cash(12_015), card(2)] }));
    expect(refund.balance_minor).toBe(-50);
    expect(refund.cash_refund_due_minor).toBe(50);
    const offStep = only(bill({ rules, tax_profiles: [], lines: [line('A', 11_998, null)], payments: [card(33), cash(12_015), card(2)] }));
    expect(offStep.totals.as_paid.total_minor).toBe(12_000);
    expect(offStep.cash_refund_due_minor).toBe(50);
    // paid 12 048 (card 33 + cash 12 015), new total 12 000 → owed back 48: cash refund due 45 (step), card up to 33
    const odd = only(bill({ rules, tax_profiles: [], lines: [line('A', 12_000, null)], payments: [card(33), cash(12_015)] }));
    expect(odd.balance_minor).toBe(-48);
    expect(odd.cash_refund_due_minor).toBe(45);
    expect(odd.card_refund_due_minor).toBe(33);
  });

  it('[05 #20b] Rs 5,710 on PK-PB paid 5,996.00 by card → no cash due; reopen −1.00 base owing Rs 2 → only "refund card 2.00"', () => {
    const paid = only(bill({ payments: [card(599_600)] }));
    expect(paid.cash_due_minor).toBe(0);
    const reopened = only(bill({ lines: [line('L1', 570_900, 'restaurant')], payments: [card(599_600)] }));
    expect(reopened.cash_due_minor).toBe(0);
    expect(reopened.card_due_minor).toBe(0);
    expect(reopened.card_refund_due_minor).toBe(200);
  });

  it('[05 #23 compute half] change = Σ cash in (tendered − amount); an out never changes the class', () => {
    const s = only(bill({ payments: [cash(430_000, 1, 500_000), card(232_400)] }));
    expect(s.change_minor).toBe(70_000);
    const refunded = only(bill({ lines: [line('L1', 570_900, 'restaurant')], payments: [card(599_600), out('digital', 200)] }));
    expect(refunded.payment_class).toBe('digital');
    expect(refunded.balance_minor).toBe(0);
  });
});

describe('service charge and discount (05 #16 spread + cap half, §3.5 (2), (4))', () => {
  it('[05 #16 spread + cap half] percent on the whole bill, spread before splitting; each split carries its lines shares; tax after discount', () => {
    const r = computeBill(
      bill({
        lines: [line('A', 100_000, 'restaurant'), line('B', 100_000, 'restaurant')],
        discount: { kind: 'percent', value: 1000, frozen: null },
        plan: { mode: 'items', splits: [{ split_no: 1, lines: [{ order_item_id: 'A', units: 1 }] }, { split_no: 2, lines: [{ order_item_id: 'B', units: 1 }] }] },
      }),
    );
    expect(r.discount_minor).toBe(20_000);
    expect(r.lines.map((l) => l.discount_minor)).toEqual([10_000, 10_000]);
    for (const s of r.splits) {
      expect(s.totals.cash.subtotal_minor).toBe(100_000);
      expect(s.totals.cash.discount_minor).toBe(10_000);
      expect(s.totals.cash.taxes[0]).toMatchObject({ base_minor: 90_000, tax_minor: 14_400 });
    }
  });

  it('[05 #16 spread + cap half] an amount discount above Σ bases is capped (D ≤ S); a share never exceeds its base', () => {
    const r = computeBill(
      bill({
        lines: [line('A', 300, 'restaurant'), line('B', 0, 'restaurant', { units: 1 })],
        discount: { kind: 'amount', value: 500, frozen: null },
      }),
    );
    expect(r.lines.map((l) => l.discount_minor)).toEqual([300, 0]);
    expect(r.splits[0]?.totals.cash.exact_total_minor).toBe(0);
  });

  it('[05 #16 spread + cap half] R3 (16b): frozen 200.00, split 1 closed with D 100.00; void B → open D 0; half of B → min(100, B) re-spread capped', () => {
    const frozen = { amount_minor: 20_000, closed_discount_minor: 10_000, line_ids: ['A', 'B'] };
    const voided = computeBill(bill({ lines: [line('B', 0, 'restaurant', { units: 0 })], discount: { kind: 'percent', value: 1000, frozen }, plan: { mode: 'none', split_no: 2 } }));
    expect(voided.discount_minor).toBe(0);
    expect(voided.splits[0]?.totals.cash.total_minor).toBe(0);
    const half = computeBill(bill({ lines: [line('B', 50_000, 'restaurant')], discount: { kind: 'percent', value: 1000, frozen }, plan: { mode: 'none', split_no: 2 } }));
    expect(half.discount_minor).toBe(10_000);
    const small = computeBill(bill({ lines: [line('B', 4_000, 'restaurant')], discount: { kind: 'percent', value: 1000, frozen }, plan: { mode: 'none', split_no: 2 } }));
    expect(small.discount_minor).toBe(4_000);
  });

  it('[05 #16 spread + cap half] 16c: a later round C carries no discount (not in bill_discount_lines); void B → open D 0, C pays full', () => {
    const frozen = { amount_minor: 20_000, closed_discount_minor: 10_000, line_ids: ['A', 'B'] };
    const r = computeBill(
      bill({
        lines: [line('B', 0, 'restaurant', { units: 0 }), line('C', 100_000, 'restaurant')],
        discount: { kind: 'percent', value: 1000, frozen },
        plan: { mode: 'none', split_no: 2 },
      }),
    );
    expect(r.lines.map((l) => [l.order_item_id, l.discount_minor])).toEqual([
      ['B', 0],
      ['C', 0],
    ]);
    expect(r.splits[0]?.totals.cash.subtotal_minor).toBe(100_000);
    const withB = computeBill(
      bill({ lines: [line('B', 100_000, 'restaurant'), line('C', 100_000, 'restaurant')], discount: { kind: 'percent', value: 1000, frozen }, plan: { mode: 'none', split_no: 2 } }),
    );
    expect(withB.lines.map((l) => l.discount_minor)).toEqual([10_000, 0]);
  });

  it('[05 §3.5 (4)] service charge on the pre-tax net in both modes, taxed under its profile, never tax-inclusive', () => {
    const sc = { rate_bp: 1000, removed: false, tax_profile_id: 'p16' };
    const p = [rateBpProfile('p16', 'GST', 1600)];
    const ex = only(bill({ rules: noneRules(), tax_profiles: p, lines: [line('A', 100_000, 'p16')], service_charge: sc }));
    expect(ex.totals.cash.service_charge_minor).toBe(10_000);
    expect(ex.totals.cash.taxes[0]).toMatchObject({ base_minor: 110_000, tax_minor: 17_600 });
    expect(ex.totals.cash.exact_total_minor).toBe(127_600);
    const incl = only(bill({ rules: { ...noneRules(), prices_include_tax: true }, tax_profiles: p, lines: [line('A', 116_000, 'p16')], service_charge: sc }));
    expect(incl.totals.cash.pre_tax_net_minor).toBe(100_000);
    expect(incl.totals.cash.service_charge_minor).toBe(10_000);
    expect(incl.totals.cash.taxes[0]).toMatchObject({ base_minor: 110_000, tax_minor: 17_600 });
    expect(incl.totals.cash.exact_total_minor).toBe(127_600);
    // untaxed service charge, removed service charge
    const untaxed = only(bill({ rules: noneRules(), tax_profiles: p, lines: [line('A', 100_000, 'p16')], service_charge: { ...sc, tax_profile_id: null } }));
    expect(untaxed.totals.cash.exact_total_minor).toBe(126_000);
    const removed = only(bill({ rules: noneRules(), tax_profiles: p, lines: [line('A', 100_000, 'p16')], service_charge: { ...sc, removed: true } }));
    expect(removed.totals.cash.service_charge_minor).toBe(0);
  });
});

describe('rounding (05 #20, #14c compute half)', () => {
  const G = [line('A', 662_360, null)];
  const at = (step_minor: number, mode: 'nearest' | 'down' | 'up', base = G) =>
    only(bill({ rules: { ...PK_RULES, rounding: { step_minor, mode, applies_to: 'all' } }, tax_profiles: [], lines: base })).totals.cash.total_minor;

  it('[05 #20] step 100 / 500 / 1 000 × nearest / down / up', () => {
    expect([at(100, 'nearest'), at(100, 'down'), at(100, 'up')]).toEqual([662_400, 662_300, 662_400]);
    expect([at(500, 'nearest'), at(500, 'down'), at(500, 'up')]).toEqual([662_500, 662_000, 662_500]);
    expect([at(1000, 'nearest'), at(1000, 'down'), at(1000, 'up')]).toEqual([662_000, 662_000, 663_000]);
    // exact half rounds away from zero under nearest; an exact multiple never moves
    expect(at(100, 'nearest', [line('A', 662_350, null)])).toBe(662_400);
    expect(at(500, 'up', [line('A', 662_500, null)])).toBe(662_500);
    expect(at(500, 'down', [line('A', 662_500, null)])).toBe(662_500);
  });

  it('[05 #14c compute half] none (step NULL) gives no rounding for exponent 0, 2 and 3', () => {
    for (const e of [0, 2, 3]) {
      const s = only(bill({ rules: noneRules(e), tax_profiles: [], lines: [line('A', 12_349, null)] }));
      expect(s.totals.cash.rounding_minor).toBe(0);
      expect(s.totals.cash.total_minor).toBe(12_349);
      expect(s.cash_due_minor).toBe(12_349);
    }
  });
});

describe('splits (05 §3.8) and bill invariants (#10 compute half)', () => {
  it('[05 #10] Σ split S = Σ line bases; Σ printed tax = Σ rows; one rounding per split; no negative figure', () => {
    const lines = [line('A', 123_457, 'restaurant', { units: 3 }), line('B', 9_999, 'restaurant'), line('C', 50_001, null, { units: 2 })];
    for (const plan of [
      { mode: 'equal' as const, splits: [{ split_no: 1 }, { split_no: 2 }, { split_no: 3 }] },
      {
        mode: 'items' as const,
        splits: [
          { split_no: 1, lines: [{ order_item_id: 'A', units: 2 }, { order_item_id: 'C', units: 1 }] },
          { split_no: 2, lines: [{ order_item_id: 'A', units: 1 }, { order_item_id: 'B', units: 1 }, { order_item_id: 'C', units: 1 }] },
        ],
      },
    ]) {
      const r = computeBill(bill({ lines, plan, discount: { kind: 'amount', value: 7_777, frozen: null }, service_charge: { rate_bp: 500, removed: false, tax_profile_id: 'restaurant' } }));
      expect(r.splits.reduce((a, s) => a + s.totals.as_paid.subtotal_minor, 0)).toBe(183_457);
      expect(r.splits.reduce((a, s) => a + s.totals.as_paid.discount_minor, 0)).toBe(7_777);
      for (const s of r.splits) {
        for (const t of [s.totals.cash, s.totals.digital, s.totals.as_paid]) {
          expect(t.exact_total_minor).toBe(t.pre_tax_net_minor + t.service_charge_minor + taxSum(t));
          expect(t.total_minor).toBe(t.exact_total_minor + t.rounding_minor);
          for (const v of [t.subtotal_minor, t.discount_minor, t.pre_tax_net_minor, t.service_charge_minor, t.exact_total_minor, t.total_minor]) expect(v).toBeGreaterThanOrEqual(0);
          for (const x of t.taxes) expect(x.tax_minor).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('[05 §3.8] item split: base pro rata to units; uncovered units join the highest-numbered split; excess units leave it first', () => {
    const lines = [line('A', 300_000, null, { units: 3 }), line('B', 1_000, null)];
    const r = computeBill(bill({ lines, plan: { mode: 'items', splits: [{ split_no: 1, lines: [{ order_item_id: 'A', units: 2 }] }, { split_no: 2, lines: [] }] } }));
    expect(r.splits.map((s) => [s.split_no, s.lines.map((l) => [l.order_item_id, l.units, l.base_minor])])).toEqual([
      [1, [['A', 2, 200_000]]],
      [2, [['A', 1, 100_000], ['B', 1, 1_000]]],
    ]);
    const voided = computeBill(
      bill({
        lines: [line('A', 100_000, null, { units: 1 })],
        plan: { mode: 'items', splits: [{ split_no: 1, lines: [{ order_item_id: 'A', units: 1 }] }, { split_no: 2, lines: [{ order_item_id: 'A', units: 2 }] }] },
      }),
    );
    expect(voided.splits.map((s) => s.lines.map((l) => [l.order_item_id, l.units, l.base_minor]))).toEqual([[['A', 1, 100_000]], []]);
  });

  it('[05 §3.8] amount split: shares of the default-class total; the last share is re-based; below 1 → shares_sum block', () => {
    const lines = [line('A', 100_000, null)];
    const ok = computeBill(bill({ lines, tax_profiles: [], plan: { mode: 'amount', splits: [{ split_no: 1, share_minor: 40_000 }, { split_no: 2, share_minor: 1 }] } }));
    expect(ok.totals_default.total_minor).toBe(100_000);
    expect(ok.splits.map((s) => s.totals.as_paid.subtotal_minor)).toEqual([40_000, 60_000]);
    expect(ok.blocks).toEqual([]);
    const bad = computeBill(bill({ lines, tax_profiles: [], plan: { mode: 'amount', splits: [{ split_no: 1, share_minor: 100_000 }, { split_no: 2, share_minor: 5 }] } }));
    expect(bad.blocks).toEqual([{ reason: 'shares_sum', ids: ['2'] }]);
  });

  it('[05 §3.5] computeSplit on one split equals computeBill with one split', () => {
    const b = bill({ payments: [card(300_000)] });
    const viaBill = only(b);
    const viaSplit = computeSplit({
      split_no: 1,
      business_date: TODAY,
      rules: PK_PB_RULES,
      tax_profiles: [pkPbProfile()],
      lines: [{ order_item_id: 'L1', units: 1, unit_price_minor: 571_000, base_minor: 571_000, discount_minor: 0, tax_profile_id: 'restaurant', line_kind: 'item' }],
      service_charge: null,
      payments: [card(300_000)],
    });
    expect(viaSplit).toEqual(viaBill);
  });

  it('[05 #11b] three taxes, a simple tax after a compound one: the simple base is the part alone', () => {
    const p = {
      tax_profile_id: 'p3',
      taxes: [
        { seq: 1, tax_code: 'A', label: 'A', compound: false, rates: rates(1000, 1000) },
        { seq: 2, tax_code: 'B', label: 'B', compound: true, rates: rates(500, 500) },
        { seq: 3, tax_code: 'C', label: 'C', compound: false, rates: rates(200, 200) },
      ],
    };
    const s = only(bill({ rules: noneRules(), tax_profiles: [p], lines: [line('X', 100_000, 'p3')] }));
    expect(s.totals.cash.taxes.map((t) => [t.tax_code, t.base_minor, t.tax_minor])).toEqual([
      ['A', 100_000, 10_000],
      ['B', 110_000, 5_500],
      ['C', 100_000, 2_000],
    ]);
    expect(s.totals.cash.exact_total_minor).toBe(117_500);
  });

  it('[05 §3.5 (4)] inclusive, the service charge on a profile with no lines: taxed on its own exclusive part', () => {
    const s = only(
      bill({
        rules: { ...noneRules(), prices_include_tax: true },
        tax_profiles: [rateBpProfile('p16', 'GST', 1600)],
        lines: [line('A', 100_000, null)],
        service_charge: { rate_bp: 1000, removed: false, tax_profile_id: 'p16' },
      }),
    );
    expect(s.totals.cash.taxes.map((t) => [t.tax_profile_id, t.base_minor, t.tax_minor])).toEqual([['p16', 10_000, 1_600]]);
    expect(s.totals.cash.exact_total_minor).toBe(111_600);
  });

  it('[05 §3.5 (4)] tax disabled: a taxed service charge carries no tax and blocks nothing', () => {
    const r = computeBill(
      bill({
        rules: { ...PK_PB_RULES, tax_enabled: false },
        lines: [line('A', 100_000, 'restaurant')],
        service_charge: { rate_bp: 1000, removed: false, tax_profile_id: 'missing' },
      }),
    );
    expect(r.splits[0]?.totals.cash.taxes).toEqual([]);
    expect(r.splits[0]?.totals.cash.exact_total_minor).toBe(110_000);
    expect(r.blocks).toEqual([]);
  });

  it('[05 #13b blocks half] an unresolved service-charge profile does not block while the charge is 0', () => {
    const r = computeBill(bill({ lines: [line('A', 0, null)], service_charge: { rate_bp: 1000, removed: false, tax_profile_id: 'missing' } }));
    expect(r.blocks).toEqual([]);
  });

  it('[05 #16 spread + cap half] a frozen discount whose closed D exceeds it leaves 0 for the open part', () => {
    const frozen = { amount_minor: 10_000, closed_discount_minor: 12_000, line_ids: ['B'] };
    const r = computeBill(bill({ lines: [line('B', 50_000, 'restaurant')], discount: { kind: 'amount', value: 10_000, frozen } }));
    expect(r.discount_minor).toBe(0);
  });

  it('[05 §3.5] invalid input is refused: more than 4 taxes, duplicate rate keys in any order, a deal part with a base', () => {
    const t = (seq: number) => ({ seq, tax_code: `T${seq}`, label: 'T', compound: false, rates: rates(100, 100) });
    expect(() => computeBill(bill({ tax_profiles: [{ tax_profile_id: 'restaurant', taxes: [t(1), t(2), t(3), t(4), t(5)] }] }))).toThrow();
    const dup = (order: number[]) => {
      const rows = [
        { payment_class: 'cash' as const, integration_status: 'integrated' as const, effective_from: '2026-01-01', rate_bp: 100, ref: null },
        { payment_class: 'cash' as const, integration_status: 'integrated' as const, effective_from: '2026-01-01', rate_bp: 200, ref: null },
        { payment_class: 'cash' as const, integration_status: 'integrated' as const, effective_from: '2026-06-01', rate_bp: 300, ref: null },
        ...rates(0, 500).filter((r) => r.payment_class === 'digital'),
      ];
      const ordered = [...order.map((i) => rows[i] as (typeof rows)[number]), ...rows.slice(3)];
      return () => computeBill(bill({ tax_profiles: [{ tax_profile_id: 'restaurant', taxes: [{ ...t(1), rates: ordered }] }] }));
    };
    expect(dup([0, 1, 2])).toThrow();
    expect(dup([2, 0, 1])).toThrow();
    expect(() => computeBill(bill({ lines: [line('DP', 50_000, 'restaurant', { line_kind: 'deal_part' })] }))).toThrow();
    expect(() =>
      computeSplit({
        split_no: 1,
        business_date: TODAY,
        rules: PK_PB_RULES,
        tax_profiles: [pkPbProfile()],
        lines: [{ order_item_id: 'DP', line_kind: 'deal_part', units: 1, unit_price_minor: 0, base_minor: 50_000, discount_minor: 0, tax_profile_id: 'restaurant' }],
        service_charge: null,
        payments: [],
      }),
    ).toThrow();
  });

  it('[05 §3.5] invalid input is refused: pro_rata, negative money, unknown split, duplicate line', () => {
    expect(() => computeBill(bill({ rules: { ...PK_PB_RULES, mixed_class_rule: 'pro_rata' as never } }))).toThrow();
    expect(() => computeBill(bill({ lines: [line('A', -1, null)] }))).toThrow();
    expect(() => computeBill(bill({ payments: [card(1, 9)] }))).toThrow();
    expect(() => computeBill(bill({ lines: [line('A', 1, null), line('A', 2, null)] }))).toThrow();
    expect(() => computeBill(bill({ rules: { ...PK_PB_RULES, rounding: { step_minor: 0, mode: 'nearest', applies_to: 'all' } } }))).toThrow();
  });
});

describe('per-line tax spread (05 §6.12 step 6, J-2; P0.19c, 05-gaps G-8; §10 #11d)', () => {
  const sl = (order_item_id: string, base_minor: number, tax_profile_id: string | null, discount_minor = 0): ComputeSplitLine => ({
    order_item_id,
    line_kind: 'item',
    units: 1,
    unit_price_minor: base_minor,
    base_minor,
    discount_minor,
    tax_profile_id,
  });
  const split = (over: Partial<ComputeSplitInput> = {}): ComputeSplitInput => ({
    split_no: 1,
    business_date: TODAY,
    rules: PK_PB_RULES,
    tax_profiles: [pkPbProfile()],
    lines: [],
    service_charge: null,
    payments: [],
    ...over,
  });
  const taxOf = (r: ReturnType<typeof spreadLineTaxes>, code: string) =>
    r.lines.map((l) => l.taxes.find((t) => t.tax_code === code)?.tax_minor ?? 0);
  const baseOf = (r: ReturnType<typeof spreadLineTaxes>, code: string) =>
    r.lines.map((l) => l.taxes.find((t) => t.tax_code === code)?.base_minor ?? 0);
  /**
   * Per (profile, tax) row of computeSplit's as-paid totals: Σ the lines' + the charge's tax = the row's tax and
   * Σ their bases = the row's base (R-18, R-19), and no base or tax is negative.
   */
  function expectSumsToRows(input: ComputeSplitInput): void {
    const rows = computeSplit(input).totals.as_paid.taxes;
    const r = spreadLineTaxes(input);
    const profileOf = new Map(input.lines.map((l) => [l.order_item_id, l.tax_profile_id]));
    for (const row of rows) {
      let tax = 0;
      let base = 0;
      const add = (ts: ReadonlyArray<{ tax_code: string; base_minor: number; tax_minor: number }>) => {
        for (const t of ts) {
          if (t.tax_code !== row.tax_code) continue;
          expect(t.base_minor).toBeGreaterThanOrEqual(0);
          expect(t.tax_minor).toBeGreaterThanOrEqual(0);
          tax += t.tax_minor;
          base += t.base_minor;
        }
      };
      for (const l of r.lines) if (profileOf.get(l.order_item_id) === row.tax_profile_id) add(l.taxes);
      if (r.service_charge !== null && r.service_charge.tax_profile_id === row.tax_profile_id) add(r.service_charge.taxes);
      expect(tax, `${row.tax_profile_id}/${row.tax_code} tax`).toBe(row.tax_minor);
      expect(base, `${row.tax_profile_id}/${row.tax_code} base`).toBe(row.base_minor);
    }
  }

  it('[05 P0.G G-8] Pakistan Table 7 (#11, §6.31): four lines of Rs 5,710 → [384, 288, 96, 145.60] at 16 %, [120, 90, 30, 45.50] at 5 %', () => {
    const lines = TABLE7_LINES.bases_minor.map((b, i) => sl(`L${i + 1}`, b, 'restaurant'));
    const cashSplit = split({ lines });
    const c = spreadLineTaxes(cashSplit);
    expect(c.payment_class).toBe('cash');
    expect(c.lines.map((l) => l.order_item_id)).toEqual(['L1', 'L2', 'L3', 'L4']);
    expect(taxOf(c, 'PST')).toEqual([...TABLE7_LINES.cash_tax_minor]);
    expect(c.lines[0]?.taxes).toEqual([{ tax_code: 'PST', payment_class: 'cash', rate_bp: 1600, base_minor: 240_000, tax_minor: 38_400 }]);
    expect(c.service_charge).toBeNull();
    expect(TABLE7_LINES.cash_tax_minor.reduce((a, b) => a + b, 0)).toBe(PK_REGRESSION.pk_pb.cash.tax_minor);
    expectSumsToRows(cashSplit);
    const cardSplit = split({ lines, payments: [card(PK_REGRESSION.pk_pb.digital.total_minor)] });
    const d = spreadLineTaxes(cardSplit);
    expect(d.payment_class).toBe('digital');
    expect(taxOf(d, 'PST')).toEqual([...TABLE7_LINES.digital_tax_minor]);
    expect(d.lines[3]?.taxes).toEqual([{ tax_code: 'PST', payment_class: 'digital', rate_bp: 500, base_minor: 91_000, tax_minor: 4_550 }]);
    expect(TABLE7_LINES.digital_tax_minor.reduce((a, b) => a + b, 0)).toBe(PK_REGRESSION.pk_pb.digital.tax_minor);
    expectSumsToRows(cardSplit);
  });

  it('[05 P0.G G-8, #11d] non-even: one rounded row spread with apportionMinor — the left-over unit to the larger fraction, ties to the earlier line', () => {
    const p = [rateBpProfile('p', 'GST', 2500)];
    // row = round_half_up(20 × 25 %) = 5 (per-line rounding would give 3 + 3 = 6); 2.5 / 2.5 → tie → the earlier line
    const tie = split({ rules: noneRules(), tax_profiles: p, lines: [sl('A', 10, 'p'), sl('B', 10, 'p')] });
    expect(taxOf(spreadLineTaxes(tie), 'TAX')).toEqual([3, 2]);
    expectSumsToRows(tie);
    // row = round_half_up(3 × 50 %) = 2; exact shares 1.33 / 0.67 → the later line has the larger fraction
    const later = split({ rules: noneRules(), tax_profiles: [rateBpProfile('p', 'GST', 5000)], lines: [sl('A', 2, 'p'), sl('B', 1, 'p')] });
    expect(taxOf(spreadLineTaxes(later), 'TAX')).toEqual([1, 1]);
    expectSumsToRows(later);
  });

  it('[05 P0.G G-8, #11d] a bill discount: the weights are line net (base − discount share), not base; a line discounted to 0 carries 0', () => {
    // nets 1 000 / 1 000 / 0 → row 320 at 16 % → [160, 160, 0]; by base (2 000 / 1 000 / 500) it would be [183, 91, 46]
    const s = split({ lines: [sl('A', 2_000, 'restaurant', 1_000), sl('B', 1_000, 'restaurant'), sl('C', 500, 'restaurant', 500)] });
    expect(computeSplit(s).totals.as_paid.taxes.map((t) => t.tax_minor)).toEqual([320]);
    expect(taxOf(spreadLineTaxes(s), 'PST')).toEqual([160, 160, 0]);
    expect(baseOf(spreadLineTaxes(s), 'PST')).toEqual([1_000, 1_000, 0]); // R-19 exclusive: base = line net
    expectSumsToRows(s);
  });

  it('[05 P0.G G-8] several profiles: each row spread over its own lines only; untaxed and deal-part lines carry no taxes', () => {
    const s = split({
      tax_profiles: [pkPbProfile('food'), rateBpProfile('bev', 'GST', 1000)],
      lines: [
        sl('A1', 1_000, 'food'),
        sl('B1', 500, 'bev'),
        sl('U', 700, null),
        { ...sl('DP', 0, 'food'), line_kind: 'deal_part' },
        sl('A2', 3_000, 'food'),
      ],
    });
    const r = spreadLineTaxes(s);
    expect(r.lines.map((l) => [l.order_item_id, l.taxes.map((t) => [t.tax_code, t.tax_minor])])).toEqual([
      ['A1', [['PST', 160]]],
      ['B1', [['TAX', 50]]],
      ['U', []],
      ['DP', []],
      ['A2', [['PST', 480]]],
    ]);
    expectSumsToRows(s);
  });

  it('[05 P0.G G-8, #11d] a stacked compound pair: every (profile, tax) row is spread by line net; Σ per tax = the row', () => {
    // N 3 001: FED round(150.05) = 150 → [50, 100]; PROV compound round(3 151 × 9.5 %) = 299 → [100, 199]
    const s = split({ rules: noneRules(), tax_profiles: [stackedProfile('st', 500, 950, true)], lines: [sl('A', 1_000, 'st'), sl('B', 2_001, 'st')] });
    expect(computeSplit(s).totals.as_paid.taxes.map((t) => t.tax_minor)).toEqual([150, 299]);
    const r = spreadLineTaxes(s);
    expect(taxOf(r, 'FED')).toEqual([50, 100]);
    expect(taxOf(r, 'PROV')).toEqual([100, 199]);
    expect(baseOf(r, 'FED')).toEqual([1_000, 2_001]);
    expect(baseOf(r, 'PROV')).toEqual([1_050, 2_101]); // R-19 compound: line net + the line's earlier taxes
    expectSumsToRows(s);
  });

  it('[05 P0.G G-8, #11d] inclusive: the included tax of the profile (one rounding) is spread by line net; Σ = the row', () => {
    // A 2 500 at 16 % inclusive → TI = round(344.83) = 345 → [138.14, 137.86, 69] → [138, 138, 69]
    const s = split({ rules: { ...PK_PB_RULES, prices_include_tax: true }, lines: [sl('A', 1_001, 'restaurant'), sl('B', 999, 'restaurant'), sl('C', 500, 'restaurant')] });
    expect(computeSplit(s).totals.as_paid.taxes.map((t) => t.tax_minor)).toEqual([345]);
    expect(taxOf(spreadLineTaxes(s), 'PST')).toEqual([138, 138, 69]);
    expect(baseOf(spreadLineTaxes(s), 'PST')).toEqual([863, 861, 431]); // R-19 inclusive: line net − the line's tax; Σ 2 155 = N_p
    expectSumsToRows(s);
  });

  it('[05 P0.G G-8, #11d] inclusive compound (R-19): base = line net − the line\'s taxes of the profile, plus its earlier taxes', () => {
    // #11b: 11 497.50 inclusive at 5 % + 9.5 % compound → [500.00, 997.50]; pre-tax 10 000.00
    const prof = [stackedProfile('st', 500, 950, true)];
    const incl = { ...noneRules(), prices_include_tax: true };
    const one = split({ rules: incl, tax_profiles: prof, lines: [sl('A', 1_149_750, 'st')] });
    expect(spreadLineTaxes(one).lines[0]?.taxes.map((t) => [t.tax_code, t.base_minor, t.tax_minor])).toEqual([
      ['FED', 1_000_000, 50_000],
      ['PROV', 1_050_000, 99_750],
    ]);
    expectSumsToRows(one);
    const two = split({ rules: incl, tax_profiles: prof, lines: [sl('A', 700_001, 'st'), sl('B', 449_749, 'st'), sl('C', 3, 'st')] });
    expectSumsToRows(two);
    // the charge is never tax-inclusive (§3.5 (4)): in inclusive mode its base is its amount (+ its earlier part if compound)
    const withSc = split({ ...one, service_charge: { rate_bp: 1000, removed: false, tax_profile_id: 'st' } });
    const w = spreadLineTaxes(withSc);
    expect(w.service_charge?.taxes.map((t) => [t.tax_code, t.base_minor, t.tax_minor])).toEqual([
      ['FED', 100_000, 5_000],
      ['PROV', 105_000, 9_975],
    ]);
    expect(w.lines[0]?.taxes.map((t) => [t.tax_code, t.base_minor, t.tax_minor])).toEqual([
      ['FED', 1_000_000, 50_000],
      ['PROV', 1_050_000, 99_750],
    ]);
    expectSumsToRows(withSc);
  });

  it('[05 P0.G G-8, #11d] service-charge taxes are the invoice service_charge.taxes, never in the lines (own profile; inclusive shared profile)', () => {
    // exclusive, the charge under its own profile: the lines carry only the food row
    const own = split({
      tax_profiles: [pkPbProfile(), rateBpProfile('svc', 'Service tax', 1000)],
      lines: [sl('A', 100_000, 'restaurant'), sl('B', 50_000, 'restaurant')],
      service_charge: { rate_bp: 1000, removed: false, tax_profile_id: 'svc' },
    });
    const o = spreadLineTaxes(own);
    expect(taxOf(o, 'PST')).toEqual([16_000, 8_000]);
    expect(o.lines.flatMap((l) => l.taxes.map((t) => t.tax_code))).toEqual(['PST', 'PST']);
    expect(o.service_charge).toEqual({
      amount_minor: 15_000,
      tax_profile_id: 'svc',
      taxes: [{ tax_code: 'TAX', payment_class: 'cash', rate_bp: 1000, base_minor: 15_000, tax_minor: 1_500 }],
    });
    expectSumsToRows(own);
    // inclusive, the charge on the lines' profile: row 2 640 = included 2 400 (the lines) + exclusive part 240 (the charge)
    const shared = split({
      rules: { ...PK_PB_RULES, prices_include_tax: true },
      lines: [sl('A', 11_600, 'restaurant'), sl('B', 5_800, 'restaurant')],
      service_charge: { rate_bp: 1000, removed: false, tax_profile_id: 'restaurant' },
    });
    expect(computeSplit(shared).totals.as_paid.taxes.map((t) => t.tax_minor)).toEqual([2_640]);
    const sh = spreadLineTaxes(shared);
    expect(taxOf(sh, 'PST')).toEqual([1_600, 800]);
    expect(baseOf(sh, 'PST')).toEqual([10_000, 5_000]); // row base 16 500 = 15 000 (lines) + 1 500 (the charge)
    expect(sh.service_charge).toEqual({
      amount_minor: 1_500,
      tax_profile_id: 'restaurant',
      taxes: [{ tax_code: 'PST', payment_class: 'cash', rate_bp: 1600, base_minor: 1_500, tax_minor: 240 }],
    });
    expectSumsToRows(shared);
    // untaxed and removed charges
    const untaxed = spreadLineTaxes({ ...own, service_charge: { rate_bp: 1000, removed: false, tax_profile_id: null } });
    expect(untaxed.service_charge).toEqual({ amount_minor: 15_000, tax_profile_id: null, taxes: [] });
    expect(spreadLineTaxes({ ...own, service_charge: { rate_bp: 1000, removed: true, tax_profile_id: 'svc' } }).service_charge).toBeNull();
  });

  it('[05 P0.G G-8, #11d] R-18 exclusive, the charge on the lines\' profile: its part rounded on its own; the lines get row − part; Σ = the row', () => {
    const p = [rateBpProfile('p', 'GST', 2500)];
    // N 10, SC 2 (20 %): row round(12 × 25 %) = 3; charge round(0.5) = 1; lines 3 − 1 = 2 → [1, 1]
    // (the lines alone would round 2.5 → 3: the lines' part is the rest of the row, not their own rounding)
    const s = split({ rules: noneRules(), tax_profiles: p, lines: [sl('A', 5, 'p'), sl('B', 5, 'p')], service_charge: { rate_bp: 2000, removed: false, tax_profile_id: 'p' } });
    expect(computeSplit(s).totals.as_paid.taxes.map((t) => [t.base_minor, t.tax_minor])).toEqual([[12, 3]]);
    const r = spreadLineTaxes(s);
    expect(r.lines.map((l) => l.taxes.map((t) => [t.base_minor, t.tax_minor]))).toEqual([[[5, 1]], [[5, 1]]]);
    expect(r.service_charge).toEqual({
      amount_minor: 2,
      tax_profile_id: 'p',
      taxes: [{ tax_code: 'TAX', payment_class: 'cash', rate_bp: 2500, base_minor: 2, tax_minor: 1 }],
    });
    expectSumsToRows(s);
    // Pakistan shape: Rs 1,000 + 10 % charge on PK-PB at 16 % → row 176.00 = 160.00 (line) + 16.00 (charge)
    const pk = split({ lines: [sl('A', 100_000, 'restaurant')], service_charge: { rate_bp: 1000, removed: false, tax_profile_id: 'restaurant' } });
    const pr = spreadLineTaxes(pk);
    expect(pr.lines[0]?.taxes).toEqual([{ tax_code: 'PST', payment_class: 'cash', rate_bp: 1600, base_minor: 100_000, tax_minor: 16_000 }]);
    expect(pr.service_charge?.taxes).toEqual([{ tax_code: 'PST', payment_class: 'cash', rate_bp: 1600, base_minor: 10_000, tax_minor: 1_600 }]);
    expectSumsToRows(pk);
  });

  it('[05 P0.G G-8, #11d] R-18 + R-19 exclusive compound, the charge shared: the charge\'s compound base is its amount + its earlier part', () => {
    // N 3 001, SC round(300.1) = 300. FED: row round(3 301 × 5 %) = 165, charge round(15) = 15, lines 150 → [50, 100].
    // PROV: row round(3 466 × 9.5 %) = 329, charge round(315 × 9.5 % = 29.925) = 30, lines 299 → [100, 199].
    const s = split({
      rules: noneRules(),
      tax_profiles: [stackedProfile('st', 500, 950, true)],
      lines: [sl('A', 1_000, 'st'), sl('B', 2_001, 'st')],
      service_charge: { rate_bp: 1000, removed: false, tax_profile_id: 'st' },
    });
    expect(computeSplit(s).totals.as_paid.taxes.map((t) => [t.tax_code, t.base_minor, t.tax_minor])).toEqual([
      ['FED', 3_301, 165],
      ['PROV', 3_466, 329],
    ]);
    const r = spreadLineTaxes(s);
    expect(taxOf(r, 'FED')).toEqual([50, 100]);
    expect(taxOf(r, 'PROV')).toEqual([100, 199]);
    expect(baseOf(r, 'PROV')).toEqual([1_050, 2_101]);
    expect(r.service_charge?.taxes.map((t) => [t.tax_code, t.base_minor, t.tax_minor])).toEqual([
      ['FED', 300, 15],
      ['PROV', 315, 30],
    ]);
    expectSumsToRows(s);
  });

  it('[05 P0.G G-8] tax disabled or an unresolved charge profile: the charge carries no taxes and tax_profile_id null', () => {
    const base = split({ lines: [sl('A', 100_000, 'restaurant')], service_charge: { rate_bp: 1000, removed: false, tax_profile_id: 'restaurant' } });
    const off = spreadLineTaxes({ ...base, rules: { ...PK_PB_RULES, tax_enabled: false } });
    expect(off.lines[0]?.taxes).toEqual([]);
    expect(off.service_charge).toEqual({ amount_minor: 10_000, tax_profile_id: null, taxes: [] });
    const unresolved = spreadLineTaxes({ ...base, service_charge: { rate_bp: 1000, removed: false, tax_profile_id: 'missing' } });
    expect(unresolved.service_charge).toEqual({ amount_minor: 10_000, tax_profile_id: null, taxes: [] });
    expect(unresolved.lines[0]?.taxes.map((t) => t.tax_minor)).toEqual([16_000]);
  });

  /** Σ = the rows (tax and base), nothing negative, and in inclusive mode no line's taxes of its profile above its net (R-20). */
  function expectSound(input: ComputeSplitInput): void {
    expectSumsToRows(input);
    if (!input.rules.prices_include_tax) return;
    const r = spreadLineTaxes(input);
    input.lines.forEach((l, i) => {
      const own = (r.lines[i]?.taxes ?? []).reduce((a, t) => a + t.tax_minor, 0);
      expect(own, `${l.order_item_id} taxes ≤ net`).toBeLessThanOrEqual(l.base_minor - l.discount_minor);
    });
  }
  const inclNone = { ...noneRules(), prices_include_tax: true };
  const fourTaxes = (bp: number) => ({
    tax_profile_id: 'q',
    taxes: [1, 2, 3, 4].map((seq) => ({ seq, tax_code: `T${seq}`, label: `Tax ${seq}`, compound: false, rates: rates(bp, bp) })),
  });

  it('[05 P0.G G-8, #11d] R-20 review crash: inclusive 13 % + 5 %, 10 lines of 50 000, amount split [499 990, 10] → split 2 via computeBill', () => {
    const prof = [stackedProfile('st', 1300, 500, false)];
    const lines = Array.from({ length: 10 }, (_, i) => line(`L${i}`, 50_000, 'st'));
    const b = computeBill(
      bill({ rules: inclNone, tax_profiles: prof, lines, plan: { mode: 'amount', splits: [{ split_no: 1, share_minor: 499_990 }, { split_no: 2, share_minor: 10 }] } }),
    );
    const s2 = b.splits.find((x) => x.split_no === 2) as ComputeSplitResult;
    expectSound(split({ split_no: 2, rules: inclNone, tax_profiles: prof, lines: s2.lines }));
  });

  it('[05 P0.G G-8, #11d] R-20 review crashes: nets of 1 under stacked and compound profiles (both modes)', () => {
    const cases: Array<[ComputeSplitInput['tax_profiles'], number[]]> = [
      [[stackedProfile('q', 1300, 500, false)], Array.from({ length: 10 }, () => 1)],
      [[stackedProfile('q', 10_000, 10_000, true)], [1, 1, 1]],
      [[stackedProfile('q', 10_000, 10_000, true)], [1, 1, 4]],
      [[fourTaxes(3000)], [1, 2, 2]],
    ];
    for (const [tax_profiles, nets] of cases) {
      for (const rules of [inclNone, noneRules()]) {
        expectSound(split({ rules, tax_profiles, lines: nets.map((n, i) => sl(`L${i}`, n, 'q')) }));
      }
    }
  });

  it('[05 P0.G G-8, #11d] discounted lines with a charge: inclusive one tax and the compound pair (both modes)', () => {
    const sc = { rate_bp: 1000, removed: false, tax_profile_id: 'restaurant' };
    const lines = [sl('A', 11_600, 'restaurant', 1_160), sl('B', 5_801, 'restaurant', 3), sl('C', 999, 'restaurant', 999)];
    expectSound(split({ rules: { ...PK_PB_RULES, prices_include_tax: true }, lines, service_charge: sc }));
    expectSound(split({ lines, service_charge: sc }));
    const st = [stackedProfile('restaurant', 500, 950, true)];
    expectSound(split({ rules: inclNone, tax_profiles: st, lines, service_charge: sc }));
    expectSound(split({ rules: noneRules(), tax_profiles: st, lines, service_charge: sc }));
  });

  it('[05 P0.G G-8, #11d] R-21: an applied charge of 0 (rate 0, net 0, or rounded to 0) is no charge → service_charge null', () => {
    const zeroRate = split({ lines: [sl('A', 100_000, 'restaurant')], service_charge: { rate_bp: 0, removed: false, tax_profile_id: 'restaurant' } });
    expect(spreadLineTaxes(zeroRate).service_charge).toBeNull();
    const zeroNet = split({ lines: [sl('A', 1_000, 'restaurant', 1_000)], service_charge: { rate_bp: 1000, removed: false, tax_profile_id: 'restaurant' } });
    expect(spreadLineTaxes(zeroNet).service_charge).toBeNull();
    expectSumsToRows(zeroNet);
    // rounded to 0: net 4 at 1 000 bp → 0.4 → 0 (R-21, "or the rounded amount 0")
    const roundedZero = split({ lines: [sl('A', 4, 'restaurant')], service_charge: { rate_bp: 1000, removed: false, tax_profile_id: 'restaurant' } });
    expect(computeSplit(roundedZero).totals.as_paid.service_charge_minor).toBe(0);
    expect(spreadLineTaxes(roundedZero).service_charge).toBeNull();
    expectSumsToRows(roundedZero);
  });
});

describe('check bill digital total (05 §6.3, §3.5 (5) / (7), B17; P0.19d, 05-gaps G-25)', () => {
  const openSplit = (b: ComputeBillInput, lines: ComputeSplitLine[]): ComputeSplitResult =>
    computeSplit({ split_no: 1, business_date: b.business_date, rules: b.rules, tax_profiles: b.tax_profiles, lines, service_charge: b.service_charge, payments: [] });
  const asLines = (b: ComputeBillInput): ComputeSplitLine[] => {
    const r = computeBill(b);
    return b.lines.map((l, i) => ({ ...l, discount_minor: (r.lines[i] as { discount_minor: number }).discount_minor }));
  };

  it('[05 P0.G G-25] PK-PB Table 7 (§6.31 step 1): total if paid in cash 6,624.00, card / wallet / QR 5,996.00', () => {
    const b = bill();
    const r = computeBill(b);
    expect(money(r.totals_default)).toEqual(PK_REGRESSION.pk_pb.cash);
    expect(money(r.totals_default_digital)).toEqual(PK_REGRESSION.pk_pb.digital);
    expect(r.totals_default_digital.total_minor).toBe(599_600);
    expect(r.totals_default_digital.taxes.map((t) => [t.payment_class, t.rate_bp, t.base_minor, t.tax_minor])).toEqual([['digital', 500, 571_000, 28_550]]);
    // the plan row's check: the digital-class total equals computeSplit of the same lines at the digital rate
    const s = openSplit(b, asLines(b));
    expect(r.totals_default_digital).toEqual(s.totals.digital);
    expect(r.totals_default).toEqual(s.totals.cash);
    // and equals the open remainder paid all by card (§3.5 (5): all digital → digital)
    const paidByCard = computeSplit({ split_no: 1, business_date: TODAY, rules: b.rules, tax_profiles: b.tax_profiles, service_charge: null, lines: asLines(b), payments: [card(599_600)] });
    expect(r.totals_default_digital).toEqual(paidByCard.totals.as_paid);
  });

  it('[05 P0.G G-25] frozen rounding rule: applies_to cash → the digital total is not rounded; all → it is', () => {
    const lines = [line('L1', 571_003, 'restaurant')];
    // cash 16 %: 91 360.48 → 91 360, G 662 363; digital 5 %: 28 550.15 → 28 550, G 599 553; step 5 nearest
    // (the default cashStepRules has applies_to: 'cash')
    const onlyCash = computeBill(bill({ lines, rules: cashStepRules() }));
    expect(money(onlyCash.totals_default)).toEqual({ tax_minor: 91_360, exact_total_minor: 662_363, rounding_minor: 2, total_minor: 662_365 });
    expect(money(onlyCash.totals_default_digital)).toEqual({ tax_minor: 28_550, exact_total_minor: 599_553, rounding_minor: 0, total_minor: 599_553 });
    const all = computeBill(bill({ lines, rules: cashStepRules({ rounding: { step_minor: 5, mode: 'nearest', applies_to: 'all' } }) }));
    expect(money(all.totals_default)).toEqual(money(onlyCash.totals_default));
    expect(money(all.totals_default_digital)).toEqual({ tax_minor: 28_550, exact_total_minor: 599_553, rounding_minor: 2, total_minor: 599_555 });
    // step NULL: no rounding at either class
    const none = computeBill(bill({ lines, rules: { ...PK_PB_RULES, rounding: { step_minor: null, mode: 'nearest', applies_to: 'all' } } }));
    expect(none.totals_default_digital.rounding_minor).toBe(0);
    expect(none.totals_default_digital.total_minor).toBe(599_553);
  });

  it('[05 P0.G G-25] a split bill: the digital total is the open remainder as one split, whatever the plan and payments', () => {
    // open bases after a closed split (H2-2), a frozen discount re-spread over the open lines (R-2), a service charge
    const lines = [line('A', 120_000, 'restaurant', { units: 2 }), line('B', 45_500, 'restaurant'), line('C', 20_000, null)];
    const base = bill({
      lines,
      discount: { kind: 'amount', value: 0, frozen: { amount_minor: 10_000, closed_discount_minor: 4_000, line_ids: ['A', 'B'] } },
      service_charge: { rate_bp: 500, removed: false, tax_profile_id: 'restaurant' },
    });
    const plans: ComputeBillInput['plan'][] = [
      { mode: 'none', split_no: 2 },
      { mode: 'equal', splits: [{ split_no: 2 }, { split_no: 3 }] },
      { mode: 'items', splits: [{ split_no: 2, lines: [{ order_item_id: 'A', units: 1 }] }, { split_no: 3, lines: [] }] },
      { mode: 'amount', splits: [{ split_no: 2, share_minor: 50_000 }, { split_no: 3, share_minor: 0 }] },
    ];
    const expected = openSplit(base, asLines(base));
    for (const plan of plans) {
      const r = computeBill({ ...base, plan, payments: [card(10_000, 2)] });
      expect(r.totals_default_digital).toEqual(expected.totals.digital);
      expect(r.totals_default).toEqual(expected.totals.cash);
    }
    expect(expected.totals.digital.total_minor).toBeLessThan(expected.totals.cash.total_minor);
    expect(expected.totals.digital.discount_minor).toBe(6_000);
  });

  it('[05 P0.G G-25] inclusive prices with a compound pair: the digital total is the open remainder at the digital class', () => {
    // VAT 10 % cash / 5 % digital simple + levy 2 % compound, prices include tax, a discount and a service charge
    const w = {
      tax_profile_id: 'w',
      taxes: [
        { seq: 1, tax_code: 'VAT', label: 'VAT', compound: false, rates: rates(1000, 500) },
        { seq: 2, tax_code: 'LEVY', label: 'Levy', compound: true, rates: rates(200, 200) },
      ],
    };
    const b = bill({
      rules: cashStepRules({ prices_include_tax: true }),
      tax_profiles: [w],
      lines: [line('A', 1000, 'w'), line('B', 499, 'w')],
      discount: { kind: 'amount', value: 100, frozen: null },
      service_charge: { rate_bp: 500, removed: false, tax_profile_id: 'w' },
    });
    const r = computeBill(b);
    const s = openSplit(b, asLines(b));
    expect(r.totals_default_digital).toEqual(s.totals.digital);
    expect(r.totals_default).toEqual(s.totals.cash);
    expect(r.totals_default_digital.taxes.map((t) => [t.payment_class, t.tax_code])).toEqual([
      ['digital', 'VAT'],
      ['digital', 'LEVY'],
    ]);
    expect(r.totals_default_digital.total_minor).not.toBe(r.totals_default.total_minor);
    expect(r.totals_default_digital.rounding_minor).toBe(0); // applies_to 'cash': the digital total is never rounded
  });

  it('[05 P0.G G-25] same digital and cash rates → the two totals are equal (the check bill prints one line, §6.3)', () => {
    const r = computeBill(bill({ rules: PK_RULES, tax_profiles: [rateBpProfile('restaurant', 'GST', 1600)] }));
    expect(money(r.totals_default)).toEqual(PK_REGRESSION.pk_rate_bp_1600.cash);
    expect(money(r.totals_default_digital)).toEqual(PK_REGRESSION.pk_rate_bp_1600.digital);
    expect(r.totals_default_digital.total_minor).toBe(r.totals_default.total_minor);
  });

  it('[05 P0.G G-25] an unresolved profile: blocks unchanged, the line untaxed at the digital class as at the cash class', () => {
    const b = bill({ lines: [line('L1', 100_000, 'restaurant'), line('X', 5_000, 'missing')], tax_profiles: [pkPbProfile(), { tax_profile_id: 'missing', taxes: [] }] });
    const r = computeBill(b);
    expect(r.blocks).toEqual([{ reason: 'tax_unresolved', ids: ['X'] }]);
    expect(r.totals_default_digital).toEqual(openSplit(b, asLines(b)).totals.digital);
    expect(r.totals_default_digital.taxes.map((t) => t.base_minor)).toEqual([100_000]);
  });
});
