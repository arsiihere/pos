import { buildReport, type ReportInput } from '@pos/domain';
import { describe, expect, it } from 'vitest';
import { ZReportIssuedPayload, ZReportSchema } from './ZReportIssued.v1';

// 05 §6.25, §6.26, §11 task 26a: a Z built by the pure `buildReport` (domain) parses with the `ZReportIssued` report
// schema (strict), so the day-close appender (task 25) can append it as built. Lives in packages/events because
// events depends on domain, never the reverse. Amounts are PKR minor units.

const ISSUED_AT = Date.UTC(2026, 10, 19, 18, 0, 0);
const MIN = 60_000;
const tax = (payment_class: 'cash' | 'digital', rate_bp: number, tax_minor: number) => ({
  tax_code: 'PST',
  label: 'PST',
  tax_profile_id: 'tp1',
  payment_class,
  rate_bp,
  tax_minor,
});

/** Every list of the report non-empty (open bills excepted: a Z carries none). */
const FULL: ReportInput = {
  kind: 'z',
  z_no: 41,
  business_date: '2026-11-19',
  issued_at: ISSUED_AT,
  currency_code: 'PKR',
  invoices: [
    {
      invoice_id: 'inv-s1', series: 'sale', bill_id: 'b1', subtotal_minor: 571_000, discount_minor: 10_000, service_charge_minor: 0,
      rounding_minor: -60, total_minor: 650_700, taxes: [tax('cash', 1600, 89_760)], fiscal_state: 'acked',
      discount: { reason_code: 'regular_customer', requester_staff_id: 's1', approver_staff_id: 's9' }, credit_reason_code: null,
    },
    {
      invoice_id: 'inv-s2', series: 'sale', bill_id: 'b2', subtotal_minor: 571_000, discount_minor: 0, service_charge_minor: 28_550,
      rounding_minor: 50, total_minor: 629_000, taxes: [tax('digital', 500, 29_400)], fiscal_state: 'pending',
      discount: null, credit_reason_code: null,
    },
    {
      invoice_id: 'inv-c1', series: 'credit', bill_id: 'b0', subtotal_minor: 571_000, discount_minor: 0, service_charge_minor: 0,
      rounding_minor: -60, total_minor: 662_300, taxes: [tax('cash', 1600, 91_360)], fiscal_state: 'not_required',
      discount: null, credit_reason_code: 'wrong_item_billed',
    },
  ],
  takings: [
    { mode_id: 'cash', mode_name: 'Cash', taken_by_staff_id: 's1', in_minor: 1_400_000, out_minor: 662_300, change_minor: 86_900 },
    { mode_id: 'card', mode_name: 'Card', taken_by_staff_id: 's2', in_minor: 629_000, out_minor: 0, change_minor: 0 },
  ],
  comps: [{ value_minor: 45_000 }],
  comp_removals: [{ comp_minor: 45_000 }],
  voids: [
    { disposition: 'wastage', units: 1, refund_minor: 19_100, comp_voided_minor: 19_100 },
    { disposition: null, units: 2, refund_minor: 5_000 },
  ],
  reopens: [{ reopen_id: 'ev-r1', requester_staff_id: 's1', approver_staff_id: null, credit_invoice_ids: ['inv-c1'] }],
  full_refunds: [{ bill_id: 'b7', credit_totals_minor: [25_000] }],
  petty: [{ category_name: 'Vegetables', kind: 'out', amount_minor: 120_000 }],
  open_advances: [{ staff_id: 's2', amount_minor: 50_000, at: ISSUED_AT - 300 * MIN }],
  shifts: [
    { shift_id: 'sh1', staff_id: 's1', float_minor: 500_000, expected_cash_minor: 1_150_700, counted_minor: 1_150_000, variance_minor: -700, count_skipped: false, variance_state: 'approved' },
    { shift_id: 'sh2', staff_id: 's2', float_minor: 0, expected_cash_minor: 200_000, counted_minor: null, variance_minor: null, count_skipped: true, variance_state: null },
  ],
  variance_signoffs: [{ shift_date: '2026-11-18', staff_id: 's3', variance_minor: -1_000, outcome: 'approved', approver_staff_id: 's9', signed_at: ISSUED_AT - MIN }],
  pending_signoffs: [{ shift_date: '2026-11-17', staff_id: 's4', variance_minor: -300 }],
  open_bills: [{ identifier: 'T4', open_minutes: 300 }],
  open_bill_flag_minutes: 240,
  carried_over: [{ label: '#12', carried_in: true }],
  brought_forward: [{ mode_id: 'cash', mode_name: 'Cash', shift_staff_id: 's1', direction: 'in', amount_minor: 20_000 }],
  carried_forward: [{ mode_id: 'card', mode_name: 'Card', shift_staff_id: 's2', direction: 'in', amount_minor: 30_000 }],
};

describe('buildReport → ZReportIssued (05 §6.25, §6.26)', () => {
  it('[task 26a] a fully populated Z built by buildReport parses with ZReportSchema and ZReportIssuedPayload', () => {
    const report = buildReport(FULL);
    const parsed = ZReportSchema.safeParse(report);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(report);
    // every list the fixture fills is non-empty in the built report (the parse is not vacuous)
    for (const [k, v] of Object.entries(report)) if (Array.isArray(v) && k !== 'open_bills') expect(v.length, k).toBeGreaterThan(0);
    expect(report.sales.taxes.length).toBeGreaterThan(0);
    expect(report.sales.discounts.entries.length).toBeGreaterThan(0);
    const payload = ZReportIssuedPayload.safeParse({ business_date: '2026-11-19', z_no: 41, report });
    expect(payload.success).toBe(true);
  });

  it('[H16-5] the strict schema refuses a staff name smuggled into the built report', () => {
    const report = buildReport(FULL);
    const bad = { ...report, shifts: report.shifts.map((s) => ({ ...s, staff_name: 'Bilal' })) };
    expect(ZReportSchema.safeParse(bad).success).toBe(false);
  });
});
