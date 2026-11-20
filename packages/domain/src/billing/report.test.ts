import { describe, expect, it } from 'vitest';
import type { ReportDocInput } from './docs.js';
import { buildReport, type ReportInput, type ReportInvoice } from './report.js';

// 05 §6.26, B26, §3.13; §10 #66, #67; 05 v1.0.22 R-83 readings. Amounts are PKR minor units (exponent 2).

const ISSUED_AT = Date.UTC(2026, 10, 19, 18, 0, 0);
const MIN = 60_000;

function sale(over: Partial<ReportInvoice> = {}): ReportInvoice {
  return {
    invoice_id: 'inv-s1',
    series: 'sale',
    bill_id: 'b1',
    subtotal_minor: 571_000,
    discount_minor: 0,
    service_charge_minor: 0,
    rounding_minor: -60,
    total_minor: 662_300,
    taxes: [{ tax_code: 'PST', label: 'PST', tax_profile_id: 'tp1', payment_class: 'cash', rate_bp: 1600, tax_minor: 91_360 }],
    fiscal_state: 'acked',
    discount: null,
    credit_reason_code: null,
    ...over,
  };
}

function input(over: Partial<ReportInput> = {}): ReportInput {
  return {
    kind: 'z',
    z_no: 7,
    business_date: '2026-11-19',
    issued_at: ISSUED_AT,
    currency_code: 'PKR',
    invoices: [],
    takings: [],
    comps: [],
    comp_removals: [],
    voids: [],
    reopens: [],
    full_refunds: [],
    petty: [],
    open_advances: [],
    shifts: [],
    variance_signoffs: [],
    pending_signoffs: [],
    open_bills: [],
    open_bill_flag_minutes: 240,
    carried_over: [],
    brought_forward: [],
    carried_forward: [],
    ...over,
  };
}

describe('buildReport (05 §6.26, task 26a)', () => {
  it('[#66] Z net = Σ sale − Σ credit; sales lines from sale invoices only (R-83 (1))', () => {
    const r = buildReport(
      input({
        invoices: [
          sale(),
          sale({
            invoice_id: 'inv-s2',
            bill_id: 'b2',
            subtotal_minor: 300_000,
            discount_minor: 30_000,
            service_charge_minor: 0,
            rounding_minor: 80,
            total_minor: 313_280,
            taxes: [{ tax_code: 'PST', label: 'PST', tax_profile_id: 'tp1', payment_class: 'cash', rate_bp: 1600, tax_minor: 43_200 }],
            discount: { reason_code: 'regular_customer', requester_staff_id: 's1', approver_staff_id: 's9' },
          }),
          sale({ invoice_id: 'inv-c1', series: 'credit', bill_id: 'b0', total_minor: 662_300, credit_reason_code: 'price_error', fiscal_state: 'pending' }),
        ],
      }),
    );
    expect(r.sales.invoice_count).toBe(2);
    expect(r.sales.gross_minor).toBe(871_000);
    expect(r.sales.discounts.value_minor).toBe(30_000);
    expect(r.sales.net_minor).toBe(841_000); // §3.1: Σ bases − discount
    expect(r.sales.taxes).toEqual([
      { tax_code: 'PST', label: 'PST', tax_profile_id: 'tp1', payment_class: 'cash', rate_bp: 1600, tax_minor: 134_560 },
    ]);
    expect(r.sales.rounding_minor).toBe(20);
    expect(r.sales.total_minor).toBe(975_580);
    expect(r.credits).toEqual({ count: 1, value_minor: 662_300, by_reason: [{ reason_code: 'price_error', count: 1, value_minor: 662_300 }] });
    expect(r.net_after_credits_minor).toBe(975_580 - 662_300);
    expect(r.fiscal).toEqual({ pending: 1, acked: 2, rejected: 0, not_required: 0 });
  });

  it('[#66] tax by (tax code, profile, class); one key with two rates or labels splits into rows (R-83 (2))', () => {
    const t = (payment_class: 'cash' | 'digital', rate_bp: number, tax_minor: number, label = 'PST', tax_profile_id = 'tp1') => ({
      tax_code: 'PST',
      label,
      tax_profile_id,
      payment_class,
      rate_bp,
      tax_minor,
    });
    const r = buildReport(
      input({
        invoices: [
          sale({ invoice_id: 'a', taxes: [t('cash', 1600, 91_360), t('digital', 500, 0, 'PST', 'tp2')] }),
          sale({ invoice_id: 'b', taxes: [t('digital', 500, 28_550)] }),
          sale({ invoice_id: 'c', taxes: [t('digital', 500, 1_000), t('cash', 1500, 10_000)] }),
          sale({ invoice_id: 'd', taxes: [t('cash', 1600, 5_000, 'Punjab sales tax')] }),
          sale({ invoice_id: 'cr', series: 'credit', credit_reason_code: 'other', taxes: [t('cash', 1600, 91_360)] }),
        ],
      }),
    );
    expect(r.sales.taxes).toEqual([
      t('cash', 1500, 10_000),
      t('cash', 1600, 91_360),
      t('cash', 1600, 5_000, 'Punjab sales tax'),
      t('digital', 500, 29_550),
      t('digital', 500, 0, 'PST', 'tp2'),
    ]);
    // Σ printed tax = Σ sale invoice tax rows
    expect(r.sales.taxes.reduce((s, x) => s + x.tax_minor, 0)).toBe(91_360 + 28_550 + 1_000 + 10_000 + 5_000);
  });

  it('[§6.26] rounding is its own line, never inside a tax row or payments by mode', () => {
    const r = buildReport(
      input({
        invoices: [sale({ rounding_minor: -60 }), sale({ invoice_id: 'x', rounding_minor: 40 })],
        takings: [{ mode_id: 'cash', mode_name: 'Cash', taken_by_staff_id: 's1', in_minor: 1_324_600, out_minor: 0, change_minor: 75_400 }],
      }),
    );
    expect(r.sales.rounding_minor).toBe(-20);
    expect(r.sales.taxes[0]!.tax_minor).toBe(182_720);
    expect(r.payments_by_mode).toEqual([{ mode_name: 'Cash', in_minor: 1_324_600, out_minor: 0, change_minor: 75_400 }]);
  });

  it('[R-83 (3)] discounts from sale invoices: count per invoice, by reason, method approval / direct', () => {
    const r = buildReport(
      input({
        invoices: [
          sale({ invoice_id: 'i1', discount_minor: 10_000, discount: { reason_code: 'staff', requester_staff_id: 's1', approver_staff_id: null } }),
          sale({ invoice_id: 'i2', discount_minor: 5_000, discount: { reason_code: 'staff', requester_staff_id: 's1', approver_staff_id: 's9' } }),
          sale({ invoice_id: 'i3', discount_minor: 2_500, discount: { reason_code: 'complaint', requester_staff_id: 's2', approver_staff_id: 's9' } }),
          sale({ invoice_id: 'i4' }),
          sale({ invoice_id: 'c', series: 'credit', discount_minor: 10_000, credit_reason_code: 'other', discount: { reason_code: 'staff', requester_staff_id: 's1', approver_staff_id: null } }),
        ],
      }),
    );
    expect(r.sales.discounts).toEqual({
      count: 3,
      value_minor: 17_500,
      by_reason: [
        { reason_code: 'complaint', count: 1, value_minor: 2_500 },
        { reason_code: 'staff', count: 2, value_minor: 15_000 },
      ],
      entries: [
        { requester_staff_id: 's1', approver_staff_id: null, method: 'direct', value_minor: 10_000 },
        { requester_staff_id: 's1', approver_staff_id: 's9', method: 'approval', value_minor: 5_000 },
        { requester_staff_id: 's2', approver_staff_id: 's9', method: 'approval', value_minor: 2_500 },
      ],
    });
    expect(r.sales.net_minor).toBe(4 * 571_000 - 17_500);
  });

  it('[R-83 (4)] voids by disposition from ItemVoided: count in units, missing refund = 0; voided comps', () => {
    const r = buildReport(
      input({
        voids: [
          { disposition: 'wastage', units: 2, refund_minor: 38_200 },
          { disposition: null, units: 1, refund_minor: 2_500 },
          { disposition: 'wastage', units: 1, refund_minor: 19_100, comp_voided_minor: 19_100 },
          { disposition: null, units: 3 },
          { disposition: 'moved', units: 1, refund_minor: 0 },
        ],
        comps: [{ value_minor: 19_100 }, { value_minor: 45_000 }],
        comp_removals: [{ comp_minor: 45_000 }],
      }),
    );
    expect(r.voids).toEqual([
      { disposition: 'moved', count: 1, value_minor: 0 },
      { disposition: 'wastage', count: 3, value_minor: 57_300 },
      { disposition: null, count: 4, value_minor: 2_500 },
    ]);
    expect(r.comps).toEqual({ value_minor: 64_100, voided_minor: 19_100, removals: { count: 1, value_minor: 45_000 } });
  });

  it('[R-83 (6)] bills: distinct bills of the sale invoices; average = sales total / count, half up; empty → 0', () => {
    const r = buildReport(
      input({
        invoices: [
          sale({ bill_id: 'b1', total_minor: 100_000 }),
          sale({ invoice_id: 'i2', bill_id: 'b1', total_minor: 100_001 }),
          sale({ invoice_id: 'i3', bill_id: 'b2', total_minor: 100_000 }),
          sale({ invoice_id: 'c', series: 'credit', bill_id: 'b3', total_minor: 50_000, credit_reason_code: 'other' }),
        ],
      }),
    );
    expect(r.bills).toEqual({ count: 2, average_minor: 150_001 }); // 300 001 / 2 = 150 000.5 → 150 001
    const down = buildReport(
      input({ invoices: [sale({ bill_id: 'a', total_minor: 100 }), sale({ invoice_id: 'i2', bill_id: 'b', total_minor: 100 }), sale({ invoice_id: 'i3', bill_id: 'c', total_minor: 101 })] }),
    );
    expect(down.bills).toEqual({ count: 3, average_minor: 100 }); // 100.33 → 100
  });

  it('[R-83 (6)] a day with no bills: count 0, average 0, no division by zero', () => {
    const r = buildReport(
      input({ invoices: [sale({ invoice_id: 'c', series: 'credit', bill_id: 'b3', total_minor: 50_000, credit_reason_code: 'other' })] }),
    );
    expect(r.bills).toEqual({ count: 0, average_minor: 0 });
    expect(Number.isSafeInteger(r.bills.average_minor)).toBe(true);
    expect(buildReport(input()).bills).toEqual({ count: 0, average_minor: 0 });
  });

  it('[R-83 (7)] reopens value = Σ the credits they issued; full refunds = Σ their credits; advance age floored', () => {
    const r = buildReport(
      input({
        invoices: [
          sale({ invoice_id: 'c1', series: 'credit', total_minor: 662_300, credit_reason_code: 'price_error' }),
          sale({ invoice_id: 'c2', series: 'credit', total_minor: 100_000, credit_reason_code: 'price_error' }),
        ],
        reopens: [{ reopen_id: 'ev-r1', requester_staff_id: 's1', approver_staff_id: 's9', credit_invoice_ids: ['c1', 'c2'] }],
        full_refunds: [{ bill_id: 'b9', credit_totals_minor: [100_000, 25_000] }],
        open_advances: [
          { staff_id: 's2', amount_minor: 50_000, at: ISSUED_AT - 300 * MIN - 59_999 },
          { staff_id: 's3', amount_minor: 10_000, at: ISSUED_AT - 59_999 },
        ],
      }),
    );
    expect(r.reopens).toEqual({ count: 1, value_minor: 762_300, entries: [{ requester_staff_id: 's1', approver_staff_id: 's9' }] });
    expect(r.full_refunds).toEqual({ count: 1, value_minor: 125_000 });
    expect(r.open_advances).toEqual([
      { staff_id: 's2', amount_minor: 50_000, age_minutes: 300 },
      { staff_id: 's3', amount_minor: 10_000, age_minutes: 0 },
    ]);
  });

  it('[R-84] a reopen naming a credit not in the day is skipped with a warning (ids only); the rest of the Z is intact', () => {
    const warnings: unknown[] = [];
    const invoices = [
      sale({ invoice_id: 's1', bill_id: 'b1', total_minor: 662_300 }),
      sale({ invoice_id: 'c1', series: 'credit', bill_id: 'b0', total_minor: 100_000, credit_reason_code: 'price_error' }),
    ];
    const r = buildReport(
      input({
        invoices,
        reopens: [
          { reopen_id: 'ev-ok', requester_staff_id: 's1', approver_staff_id: 's9', credit_invoice_ids: ['c1'] },
          { reopen_id: 'ev-bad', requester_staff_id: 's2', approver_staff_id: null, credit_invoice_ids: ['c1', 'nope'] },
        ],
      }),
      { warn: (w) => warnings.push(w) },
    );
    expect(warnings).toEqual([{ code: 'reopen_credit_missing', reopen_id: 'ev-bad', credit_invoice_id: 'nope' }]);
    expect(r.reopens).toEqual({ count: 1, value_minor: 100_000, entries: [{ requester_staff_id: 's1', approver_staff_id: 's9' }] });
    const clean = buildReport(input({ invoices, reopens: [{ reopen_id: 'ev-ok', requester_staff_id: 's1', approver_staff_id: 's9', credit_invoice_ids: ['c1'] }] }));
    expect(r).toEqual(clean);
    expect(r.sales.total_minor).toBe(662_300);
    expect(r.credits.value_minor).toBe(100_000);
    expect(r.net_after_credits_minor).toBe(562_300);
    // no warn callback: still no throw
    expect(() =>
      buildReport(input({ reopens: [{ reopen_id: 'ev-bad', requester_staff_id: 's2', approver_staff_id: null, credit_invoice_ids: ['nope'] }] })),
    ).not.toThrow();
  });

  const shifts: ReportInput['shifts'] = [
    { shift_id: 'sh1', staff_id: 's1', float_minor: 500_000, expected_cash_minor: 1_150_700, counted_minor: 1_150_000, variance_minor: -700, count_skipped: false, variance_state: 'pending' },
    { shift_id: 'sh2', staff_id: 's2', float_minor: 0, expected_cash_minor: 200_000, counted_minor: null, variance_minor: null, count_skipped: true, variance_state: null },
    { shift_id: 'sh3', staff_id: 's3', float_minor: 100_000, expected_cash_minor: 400_000, counted_minor: 390_000, variance_minor: -10_000, count_skipped: false, variance_state: 'disputed' },
    { shift_id: 'sh4', staff_id: 's4', float_minor: 100_000, expected_cash_minor: 250_000, counted_minor: 250_000, variance_minor: 0, count_skipped: false, variance_state: 'approved' },
  ];

  it('[§6.26, R-83 (8)] Z shifts: float, expected (skipped too), counted, variance, skipped, sign-off state', () => {
    const r = buildReport(input({ shifts }));
    expect(r.shifts).toEqual([
      { staff_id: 's1', float_minor: 500_000, expected_minor: 1_150_700, counted_minor: 1_150_000, variance_minor: -700, skipped: false, signoff_state: 'pending sign-off' },
      { staff_id: 's2', float_minor: 0, expected_minor: 200_000, counted_minor: null, variance_minor: null, skipped: true, signoff_state: null },
      { staff_id: 's3', float_minor: 100_000, expected_minor: 400_000, counted_minor: 390_000, variance_minor: -10_000, skipped: false, signoff_state: 'disputed' },
      { staff_id: 's4', float_minor: 100_000, expected_minor: 250_000, counted_minor: 250_000, variance_minor: 0, skipped: false, signoff_state: 'approved' },
    ]);
  });

  it('[#67, B23, R-83 (8)] X = the same builder over the open day; expected hidden for every uncounted shift; open bills flagged', () => {
    const open: ReportInput['shifts'][number] = {
      shift_id: 'sh5', staff_id: 's5', float_minor: 200_000, expected_cash_minor: 900_000, counted_minor: null, variance_minor: null, count_skipped: false, variance_state: null,
    };
    const x = buildReport(
      input({
        kind: 'x',
        z_no: null,
        shifts: [...shifts, open],
        open_bills: [
          { identifier: 'T4', open_minutes: 241 },
          { identifier: 'T7', open_minutes: 240 },
        ],
      }),
    );
    expect(x.kind).toBe('x');
    expect(x.z_no).toBeNull();
    expect(x.shifts.map((s) => s.expected_minor)).toEqual([1_150_700, null, 400_000, 250_000, null]);
    expect(x.shifts.map((s) => s.variance_minor)).toEqual([-700, null, -10_000, 0, null]);
    expect(x.open_bills).toEqual([
      { identifier: 'T4', open_minutes: 241, flagged: true },
      { identifier: 'T7', open_minutes: 240, flagged: false },
    ]);
    // the Z carries no open bills
    expect(buildReport(input({ open_bills: [{ identifier: 'T4', open_minutes: 300 }] })).open_bills).toEqual([]);
  });

  it('[§6.26 H8-1] variance sign-offs of the day and pending sign-offs, outside takings', () => {
    const r = buildReport(
      input({
        variance_signoffs: [{ shift_date: '2026-11-18', staff_id: 's3', variance_minor: -1_000, outcome: 'approved', approver_staff_id: 's9', signed_at: ISSUED_AT - MIN }],
        pending_signoffs: [{ shift_date: '2026-11-17', staff_id: 's1', variance_minor: -700 }],
      }),
    );
    expect(r.variance_signoffs).toEqual([{ shift_date: '2026-11-18', staff_id: 's3', amount_minor: -1_000, outcome: 'approved', approver_staff_id: 's9', at: ISSUED_AT - MIN }]);
    expect(r.pending_signoffs).toEqual([{ shift_date: '2026-11-17', staff_id: 's1', amount_minor: -700 }]);
    expect(r.payments_by_mode).toEqual([]);
  });

  it('[§6.26 Q10] payments by mode (in, out, change) and takings by taker (in − out)', () => {
    const r = buildReport(
      input({
        takings: [
          { mode_id: 'cash', mode_name: 'Cash', taken_by_staff_id: 's1', in_minor: 1_000_000, out_minor: 662_400, change_minor: 86_900 },
          { mode_id: 'card', mode_name: 'Card', taken_by_staff_id: 's1', in_minor: 400_000, out_minor: 0, change_minor: 0 },
          { mode_id: 'cash', mode_name: 'Cash', taken_by_staff_id: 's2', in_minor: 300_000, out_minor: 0, change_minor: 1_000 },
        ],
      }),
    );
    expect(r.payments_by_mode).toEqual([
      { mode_name: 'Card', in_minor: 400_000, out_minor: 0, change_minor: 0 },
      { mode_name: 'Cash', in_minor: 1_300_000, out_minor: 662_400, change_minor: 87_900 },
    ]);
    expect(r.takings_by_taker).toEqual([
      { staff_id: 's1', amount_minor: 737_600 },
      { staff_id: 's2', amount_minor: 300_000 },
    ]);
  });

  it('[§6.26] petty cash by category and kind; carried over passed through', () => {
    const r = buildReport(
      input({
        petty: [
          { category_name: 'Vegetables', kind: 'out', amount_minor: 120_000 },
          { category_name: 'Vegetables', kind: 'out', amount_minor: 30_000 },
          { category_name: 'Staff advance', kind: 'advance', amount_minor: 50_000 },
          { category_name: 'Vegetables', kind: 'in', amount_minor: 5_000 },
        ],
        carried_over: [{ label: '#12', carried_in: true }],
      }),
    );
    expect(r.petty_cash).toEqual([
      { category_name: 'Staff advance', kind: 'advance', amount_minor: 50_000 },
      { category_name: 'Vegetables', kind: 'in', amount_minor: 5_000 },
      { category_name: 'Vegetables', kind: 'out', amount_minor: 150_000 },
    ]);
    expect(r.carried_over).toEqual([{ label: '#12', carried_in: true }]);
  });

  it('[#63b, #66, R-83 (5)] brought / carried forward by mode and shift staff; Σ takings = Z net + CF − BF', () => {
    // day 1: split 1 paid 500 and closed (invoice 500), split 2 paid 200 on the open split, bill carried
    const day1 = buildReport(
      input({
        invoices: [sale({ total_minor: 50_000, rounding_minor: 0 })],
        takings: [{ mode_id: 'cash', mode_name: 'Cash', taken_by_staff_id: 's7', in_minor: 70_000, out_minor: 0, change_minor: 0 }],
        carried_forward: [{ mode_id: 'cash', mode_name: 'Cash', shift_staff_id: 's1', direction: 'in', amount_minor: 20_000 }],
      }),
    );
    expect(day1.carried_forward).toEqual([{ mode_name: 'Cash', staff_id: 's1', amount_minor: 20_000 }]);
    const cf = (r: ReportDocInput) => r.carried_forward.reduce((s, x) => s + x.amount_minor, 0);
    const bf = (r: ReportDocInput) => r.brought_forward.reduce((s, x) => s + x.amount_minor, 0);
    const takings = (r: ReportDocInput) => r.payments_by_mode.reduce((s, p) => s + p.in_minor - p.out_minor, 0);
    expect(takings(day1)).toBe(day1.net_after_credits_minor + cf(day1) - bf(day1));
    // day 2: split 2 paid 300 more and closed (invoice 500)
    const day2 = buildReport(
      input({
        business_date: '2026-11-20',
        invoices: [sale({ invoice_id: 'inv-2', total_minor: 50_000, rounding_minor: 0 })],
        takings: [{ mode_id: 'cash', mode_name: 'Cash', taken_by_staff_id: 's8', in_minor: 30_000, out_minor: 0, change_minor: 0 }],
        brought_forward: [{ mode_id: 'cash', mode_name: 'Cash', shift_staff_id: 's1', direction: 'in', amount_minor: 20_000 }],
      }),
    );
    expect(day2.brought_forward).toEqual([{ mode_name: 'Cash', staff_id: 's1', amount_minor: 20_000 }]);
    expect(takings(day2)).toBe(day2.net_after_credits_minor + cf(day2) - bf(day2));
  });

  it('[R-83 (5)] forward lines group by (mode, shift staff), net of outs; a full refund in another mode nets to 0 per mode', () => {
    const r = buildReport(
      input({
        carried_forward: [
          { mode_id: 'cash', mode_name: 'Cash', shift_staff_id: 's1', direction: 'in', amount_minor: 100_000 },
          { mode_id: 'card', mode_name: 'Card', shift_staff_id: 's1', direction: 'in', amount_minor: 30_000 },
          { mode_id: 'cash', mode_name: 'Cash', shift_staff_id: 's1', direction: 'out', amount_minor: 40_000 },
          { mode_id: 'cash', mode_name: 'Cash', shift_staff_id: 's2', direction: 'in', amount_minor: 5_000 },
        ],
      }),
    );
    expect(r.carried_forward).toEqual([
      { mode_name: 'Card', staff_id: 's1', amount_minor: 30_000 },
      { mode_name: 'Cash', staff_id: 's1', amount_minor: 60_000 },
      { mode_name: 'Cash', staff_id: 's2', amount_minor: 5_000 },
    ]);
  });

  it('[#66] replay gives the identical report: input order does not matter', () => {
    const inv = [
      sale({ invoice_id: 'a', bill_id: 'b1', discount_minor: 1_000, discount: { reason_code: 'staff', requester_staff_id: 's1', approver_staff_id: null } }),
      sale({ invoice_id: 'b', bill_id: 'b2', taxes: [{ tax_code: 'PST', label: 'PST', tax_profile_id: 'tp1', payment_class: 'digital', rate_bp: 500, tax_minor: 28_550 }] }),
      sale({ invoice_id: 'c', series: 'credit', bill_id: 'b0', credit_reason_code: 'other' }),
    ];
    const takings = [
      { mode_id: 'cash', mode_name: 'Cash', taken_by_staff_id: 's1', in_minor: 1, out_minor: 0, change_minor: 0 },
      { mode_id: 'card', mode_name: 'Card', taken_by_staff_id: 's2', in_minor: 2, out_minor: 0, change_minor: 0 },
    ];
    const full = input({
      kind: 'x',
      z_no: null,
      invoices: [...inv, sale({ invoice_id: 'c2', series: 'credit', bill_id: 'b0', total_minor: 1_000, credit_reason_code: 'other' })],
      takings,
      shifts,
      reopens: [
        { reopen_id: 'r3', requester_staff_id: 's2', approver_staff_id: null, credit_invoice_ids: ['c'] },
        { reopen_id: 'r2', requester_staff_id: 's1', approver_staff_id: 's9', credit_invoice_ids: ['c2'] },
        { reopen_id: 'r1', requester_staff_id: 's1', approver_staff_id: null, credit_invoice_ids: ['c2', 'c'] },
      ],
      open_advances: [
        { staff_id: 's3', amount_minor: 10_000, at: ISSUED_AT - 5 * MIN },
        { staff_id: 's2', amount_minor: 50_000, at: ISSUED_AT - 300 * MIN },
        { staff_id: 's2', amount_minor: 20_000, at: ISSUED_AT - 60 * MIN },
      ],
      variance_signoffs: [
        { shift_date: '2026-11-18', staff_id: 's3', variance_minor: -1_000, outcome: 'approved', approver_staff_id: 's9', signed_at: ISSUED_AT - MIN },
        { shift_date: '2026-11-17', staff_id: 's4', variance_minor: 2_000, outcome: 'disputed', approver_staff_id: 's9', signed_at: ISSUED_AT - 2 * MIN },
      ],
      pending_signoffs: [
        { shift_date: '2026-11-19', staff_id: 's1', variance_minor: -700 },
        { shift_date: '2026-11-17', staff_id: 's6', variance_minor: -300 },
      ],
      open_bills: [
        { identifier: 'T9', open_minutes: 10 },
        { identifier: 'T4', open_minutes: 300 },
      ],
      carried_over: [
        { label: '#12', carried_in: true },
        { label: '#03', carried_in: false },
      ],
      voids: [
        { disposition: null, units: 1, refund_minor: 2_500 },
        { disposition: 'wastage', units: 2, refund_minor: 38_200 },
      ],
      petty: [
        { category_name: 'Vegetables', kind: 'out', amount_minor: 120_000 },
        { category_name: 'Gas', kind: 'out', amount_minor: 30_000 },
      ],
      brought_forward: [
        { mode_id: 'cash', mode_name: 'Cash', shift_staff_id: 's2', direction: 'in', amount_minor: 5_000 },
        { mode_id: 'card', mode_name: 'Card', shift_staff_id: 's1', direction: 'in', amount_minor: 3_000 },
      ],
      carried_forward: [
        { mode_id: 'cash', mode_name: 'Cash', shift_staff_id: 's2', direction: 'in', amount_minor: 7_000 },
        { mode_id: 'card', mode_name: 'Card', shift_staff_id: 's1', direction: 'in', amount_minor: 1_000 },
      ],
    });
    // every list of the input reversed (and the invoices' tax rows too)
    const reversed = Object.fromEntries(
      Object.entries(full).map(([k, v]) => [k, Array.isArray(v) ? [...(v as unknown[])].reverse() : v]),
    ) as unknown as ReportInput;
    const flipped = { ...reversed, invoices: reversed.invoices.map((i) => ({ ...i, taxes: [...i.taxes].reverse() })) };
    for (const kind of ['x', 'z'] as const) {
      const z_no = kind === 'z' ? 7 : null;
      const a = buildReport({ ...full, kind, z_no });
      const b = buildReport({ ...flipped, kind, z_no });
      expect(b).toEqual(a);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
    const a = buildReport(full);
    const b = buildReport(flipped);
    expect(a.shifts.map((x) => x.staff_id)).toEqual(['s1', 's2', 's3', 's4']);
    expect(a.reopens.entries).toEqual([
      { requester_staff_id: 's1', approver_staff_id: null },
      { requester_staff_id: 's1', approver_staff_id: 's9' },
      { requester_staff_id: 's2', approver_staff_id: null },
    ]);
    expect(a.open_bills.map((x) => x.identifier)).toEqual(['T4', 'T9']);
    expect(a.carried_over.map((x) => x.label)).toEqual(['#03', '#12']);
    expect(a.pending_signoffs.map((x) => x.shift_date)).toEqual(['2026-11-17', '2026-11-19']);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('[H16-5] the report carries staff ids only', () => {
    const r = buildReport(input({ shifts, takings: [{ mode_id: 'cash', mode_name: 'Cash', taken_by_staff_id: 's1', in_minor: 1, out_minor: 0, change_minor: 0 }] }));
    const keys = new Set<string>();
    JSON.stringify(r, (k, v: unknown) => (keys.add(k), v));
    expect([...keys].filter((k) => k.endsWith('_name')).sort()).toEqual(['mode_name']);
  });

  it('[money] a non-integer amount is refused', () => {
    expect(() => buildReport(input({ invoices: [sale({ total_minor: 1.5 })] }))).toThrow(RangeError);
  });
});
