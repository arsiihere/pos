import { VOID_DISPOSITIONS } from '../voids.js';
import type { ReportDocInput } from './docs.js';
import type { FISCAL_ROW_STATES, INVOICE_SERIES, PAYMENT_CLASSES } from './types.js';

// 05 §6.26, B26, §3.13; §11 task 26a (plan PL-2: before task 25, whose day-close appender calls it, §6.25).
// The one pure X / Z builder: the hub passes the rows of its ≤ 6 (Z) / ≤ 8 (X) statements, 06 / 07 the same facts
// from synced events. No IO, no clock (issued_at is given), integer minor units only. The result is 4a's
// `ReportDocInput` (staff ids only, H16-5; `mode_name` / `category_name` embedded, G-9).
// Every output list is sorted by its key, so a rebuild from seq 0 gives the identical report whatever the row order (#66).

type PaymentClass = (typeof PAYMENT_CLASSES)[number];

export interface ReportInvoiceTax {
  tax_code: string;
  label: string;
  tax_profile_id: string;
  payment_class: PaymentClass;
  rate_bp: number;
  tax_minor: number;
}

/** One invoice issued in the report's day (`invoices_day`, both series) with its `invoice_taxes` rows. */
export interface ReportInvoice {
  invoice_id: string;
  series: (typeof INVOICE_SERIES)[number];
  bill_id: string;
  subtotal_minor: number;
  discount_minor: number;
  service_charge_minor: number;
  rounding_minor: number;
  total_minor: number;
  taxes: readonly ReportInvoiceTax[];
  fiscal_state: (typeof FISCAL_ROW_STATES)[number];
  /** Sale invoices with `discount_minor > 0`: the bill's discount (reason, requester, approver from the audit fold). */
  discount: { reason_code: string; requester_staff_id: string; approver_staff_id: string | null } | null;
  /** Credit invoices: the reopen's `reason_code` (BillReopened). */
  credit_reason_code: string | null;
}

export interface ReportShiftRow {
  shift_id: string;
  staff_id: string;
  float_minor: number;
  expected_cash_minor: number;
  counted_minor: number | null;
  variance_minor: number | null;
  count_skipped: boolean;
  variance_state: 'pending' | 'approved' | 'disputed' | null;
}

/** A live payment on a split that is not closed (at the day's open = brought forward; at issue = carried forward). */
export interface ReportForwardPayment {
  mode_id: string;
  mode_name: string;
  /** The staff of the payment's shift. */
  shift_staff_id: string;
  direction: 'in' | 'out';
  amount_minor: number;
}

export interface ReportInput {
  kind: 'x' | 'z';
  z_no: number | null;
  business_date: string;
  issued_at: number;
  currency_code: string;
  invoices: readonly ReportInvoice[];
  /** `shift_takings` rows of the day's shifts, with the mode name joined. */
  takings: ReadonlyArray<{ mode_id: string; mode_name: string; taken_by_staff_id: string; in_minor: number; out_minor: number; change_minor: number }>;
  /** 02b `LineComped` of the day. */
  comps: ReadonlyArray<{ value_minor: number }>;
  /** 02b `LineCompRemoved` of the day. */
  comp_removals: ReadonlyArray<{ comp_minor: number }>;
  /** 04 `ItemVoided` of the day. */
  voids: ReadonlyArray<{ disposition: string | null; units: number; refund_minor?: number | undefined; comp_voided_minor?: number | undefined }>;
  /**
   * `BillReopened` of the day with the credit invoices it issued (in `invoices`). `reopen_id` = the BillReopened
   * event's id (the caller supplies it; it is only echoed in a warning).
   */
  reopens: ReadonlyArray<{ reopen_id: string; requester_staff_id: string; approver_staff_id: string | null; credit_invoice_ids: readonly string[] }>;
  /** `BillClosedEmpty` of the day with the totals of its credit invoices. */
  full_refunds: ReadonlyArray<{ bill_id: string; credit_totals_minor: readonly number[] }>;
  /** Petty-cash entries on the day's shifts, with the category name joined. */
  petty: ReadonlyArray<{ category_name: string; kind: string; amount_minor: number }>;
  /** Advances not settled at issue (any day). */
  open_advances: ReadonlyArray<{ staff_id: string; amount_minor: number; at: number }>;
  /** The day's shifts. */
  shifts: readonly ReportShiftRow[];
  /** `shift_signoffs` of the day, any shift date. */
  variance_signoffs: ReadonlyArray<{ shift_date: string; staff_id: string; variance_minor: number; outcome: string; approver_staff_id: string | null; signed_at: number }>;
  /** Shifts of any date with `variance_state = 'pending'` at issue. */
  pending_signoffs: ReadonlyArray<{ shift_date: string; staff_id: string; variance_minor: number }>;
  /** X only (ignored for a Z). */
  open_bills: ReadonlyArray<{ identifier: string; open_minutes: number }>;
  open_bill_flag_minutes: number;
  carried_over: ReadonlyArray<{ label: string; carried_in: boolean }>;
  brought_forward: readonly ReportForwardPayment[];
  carried_forward: readonly ReportForwardPayment[];
}

// ---------------------------------------------------------------------------------------------------- helpers

function int(v: number, what: string): number {
  if (!Number.isSafeInteger(v)) throw new RangeError(`buildReport: ${what} is not an integer amount: ${v}`);
  return v;
}

function sum(values: Iterable<number>, what: string): number {
  let s = 0;
  for (const v of values) s += int(v, what);
  return int(s, what);
}

/** Plain code-unit order (never locale), so the order is the same on every machine. */
function cmp(a: readonly (string | number)[], b: readonly (string | number)[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return a.length - b.length;
}

/** A sorted copy (rows are never mutated); the key is total, so equal keys are equal rows. */
function sortBy<R>(rows: readonly R[], key: (r: R) => readonly (string | number)[]): R[] {
  return [...rows].sort((a, b) => cmp(key(a), key(b)));
}

/** Groups rows by a key tuple, folds each group, returns the groups sorted by key. */
function groupBy<R, A>(
  rows: Iterable<R>,
  key: (r: R) => readonly (string | number)[],
  init: () => A,
  add: (acc: A, r: R) => void,
): Array<{ key: readonly (string | number)[]; acc: A }> {
  const map = new Map<string, { key: readonly (string | number)[]; acc: A }>();
  for (const r of rows) {
    const k = key(r);
    const id = JSON.stringify(k);
    let g = map.get(id);
    if (g === undefined) {
      g = { key: k, acc: init() };
      map.set(id, g);
    }
    add(g.acc, r);
  }
  return [...map.values()].sort((a, b) => cmp(a.key, b.key));
}

/** Non-negative numerator / positive divisor, rounded half up, exact (BigInt). */
function divHalfUp(n: number, d: number): number {
  const N = BigInt(n);
  const D = BigInt(d);
  const q = (2n * N + D) / (2n * D);
  return Number(q);
}

const SIGNOFF_LABEL = { pending: 'pending sign-off', approved: 'approved', disputed: 'disputed' } as const;

// --------------------------------------------------------------------------------------------------- builder

/** 05 v1.0.23 R-84: a reopen naming a credit invoice that is not among the day's credits (ids only, no text). */
export interface ReportWarning {
  code: 'reopen_credit_missing';
  reopen_id: string;
  credit_invoice_id: string;
}

export interface BuildReportOptions {
  warn?: (w: ReportWarning) => void;
}

export function buildReport(input: ReportInput, opts?: BuildReportOptions): ReportDocInput {
  const sales = input.invoices.filter((i) => i.series === 'sale');
  const credits = input.invoices.filter((i) => i.series === 'credit');

  // 05 v1.0.22 R-83 (1): every `sales` line (gross, discount, service charge, taxes, rounding, total) is over
  // sale-series invoices only; credits reduce the Z total separately (net_after_credits = Σ sale − Σ credit).
  const gross = sum(sales.map((i) => i.subtotal_minor), 'subtotal_minor');
  const salesTotal = sum(sales.map((i) => i.total_minor), 'total_minor');

  // 05 v1.0.22 R-83 (3): discounts from the sale invoices' `discount_minor`; one count per invoice;
  // method `approval` when the discount has an approver, else `direct`.
  const discounted = sales.filter((i) => int(i.discount_minor, 'discount_minor') > 0);
  const discountValue = sum(discounted.map((i) => i.discount_minor), 'discount_minor');
  const discountOf = (i: ReportInvoice) => {
    if (i.discount === null) throw new Error(`buildReport: sale invoice ${i.invoice_id} has a discount but no discount record`);
    return i.discount;
  };
  const discountByReason = groupBy(
    discounted,
    (i) => [discountOf(i).reason_code],
    () => ({ count: 0, value_minor: 0 }),
    (a, i) => {
      a.count += 1;
      a.value_minor += i.discount_minor;
    },
  ).map((g) => ({ reason_code: String(g.key[0]), count: g.acc.count, value_minor: g.acc.value_minor }));
  const discountEntries = [...discounted]
    .sort((a, b) => cmp([a.invoice_id], [b.invoice_id]))
    .map((i) => {
      const d = discountOf(i);
      return {
        requester_staff_id: d.requester_staff_id,
        approver_staff_id: d.approver_staff_id,
        method: d.approver_staff_id !== null ? 'approval' : 'direct', // 05 v1.0.22 R-83 (3)
        value_minor: i.discount_minor,
      };
    });

  // §6.26 (J-2): one line per `invoice_taxes` key (tax code, profile, class). 05 v1.0.22 R-83 (2): a key that
  // carries two rate_bp or label values in the day is split into one row per (key, rate, label), never merged.
  const taxes = groupBy(
    sales.flatMap((i) => i.taxes),
    (t) => [t.payment_class, t.tax_code, t.tax_profile_id, t.rate_bp, t.label],
    () => ({ tax_minor: 0 }),
    (a, t) => {
      a.tax_minor += int(t.tax_minor, 'tax_minor');
    },
  ).map((g) => ({
    tax_code: String(g.key[1]),
    label: String(g.key[4]),
    tax_profile_id: String(g.key[2]),
    payment_class: g.key[0] as PaymentClass,
    rate_bp: Number(g.key[3]),
    tax_minor: int(g.acc.tax_minor, 'tax_minor'),
  }));

  const creditValue = sum(credits.map((i) => i.total_minor), 'total_minor');
  const creditByReason = groupBy(
    credits,
    (i) => [i.credit_reason_code ?? ''],
    () => ({ count: 0, value_minor: 0 }),
    (a, i) => {
      a.count += 1;
      a.value_minor += i.total_minor;
    },
  ).map((g) => ({ reason_code: String(g.key[0]), count: g.acc.count, value_minor: g.acc.value_minor }));

  // Payments by mode (in, out, change) and takings by taker (Q10: in − out).
  const paymentsByMode = groupBy(
    input.takings,
    (t) => [t.mode_name, t.mode_id],
    () => ({ in_minor: 0, out_minor: 0, change_minor: 0 }),
    (a, t) => {
      a.in_minor += int(t.in_minor, 'in_minor');
      a.out_minor += int(t.out_minor, 'out_minor');
      a.change_minor += int(t.change_minor, 'change_minor');
    },
  ).map((g) => ({ mode_name: String(g.key[0]), ...g.acc }));
  const takingsByTaker = groupBy(
    input.takings,
    (t) => [t.taken_by_staff_id],
    () => ({ amount_minor: 0 }),
    (a, t) => {
      a.amount_minor += t.in_minor - t.out_minor;
    },
  ).map((g) => ({ staff_id: String(g.key[0]), amount_minor: int(g.acc.amount_minor, 'takings') }));

  // 05 v1.0.22 R-83 (4): voids by disposition (04 G-8, from ItemVoided), counted in units; a void without
  // `refund_minor` is worth 0. Order: 04's VOID_DISPOSITIONS, then no disposition (null) last.
  const dispositionRank = (d: string | null) => {
    const i = d === null ? -1 : (VOID_DISPOSITIONS as readonly string[]).indexOf(d);
    return d === null ? VOID_DISPOSITIONS.length + 1 : i === -1 ? VOID_DISPOSITIONS.length : i;
  };
  const voids = groupBy(
    input.voids,
    (v) => [dispositionRank(v.disposition), v.disposition ?? ''],
    () => ({ disposition: null as string | null, count: 0, value_minor: 0 }),
    (a, v) => {
      a.disposition = v.disposition;
      a.count += int(v.units, 'units');
      a.value_minor += int(v.refund_minor ?? 0, 'refund_minor'); // 05 v1.0.22 R-83 (4)
    },
  ).map((g) => g.acc);

  // 05 v1.0.22 R-83 (7): a reopen's value = Σ the totals of the credit invoices it issued (in the same day).
  // 05 v1.0.23 R-84: a reopen naming a credit that is not a credit invoice of the day is skipped whole (not in
  // count, value or entries) and reported through `opts.warn` once per missing id, so a day close is never blocked.
  // The callback is the caller's; buildReport itself does no IO.
  const creditTotal = new Map(credits.map((c) => [c.invoice_id, c.total_minor]));
  const reopens = sortBy(input.reopens, (r) => [r.requester_staff_id, r.approver_staff_id ?? '', ...r.credit_invoice_ids, r.reopen_id]).filter(
    (r) => {
      const missing = r.credit_invoice_ids.filter((id) => !creditTotal.has(id));
      for (const id of missing) opts?.warn?.({ code: 'reopen_credit_missing', reopen_id: r.reopen_id, credit_invoice_id: id });
      return missing.length === 0;
    },
  );
  const reopenValue = sum(
    reopens.flatMap((r) => r.credit_invoice_ids.map((id) => creditTotal.get(id)!)),
    'reopen value',
  );

  // 05 v1.0.22 R-83 (6): bills = distinct bills of the day's sale invoices; average = sales total / count,
  // rounded half up. 05 v1.0.22 R-83 (6), integrator call: a day with no bills has average 0 (no division by zero).
  // 05 v1.0.23 R-84 (reading 4 kept): a bill with at least one sale invoice in the day counts, even if it later
  // closed empty that day; §3.10's "not in bills count / average" applies only to bills with no sale invoice that day.
  const billCount = new Set(sales.map((i) => i.bill_id)).size;
  const average = billCount === 0 ? 0 : divHalfUp(salesTotal, billCount);

  // Shifts (B23). 05 v1.0.22 R-83 (8): the X hides expected (and so variance) for every shift not counted,
  // a skipped one too; the Z shows expected for every shift, a skipped one included.
  const shifts = sortBy(input.shifts, (s) => [s.staff_id, s.shift_id]).map((s) => {
    const hide = input.kind === 'x' && s.counted_minor === null; // 05 v1.0.22 R-83 (8)
    return {
      staff_id: s.staff_id,
      float_minor: int(s.float_minor, 'float_minor'),
      expected_minor: hide ? null : int(s.expected_cash_minor, 'expected_cash_minor'),
      counted_minor: s.counted_minor === null ? null : int(s.counted_minor, 'counted_minor'),
      variance_minor: hide || s.variance_minor === null ? null : int(s.variance_minor, 'variance_minor'),
      skipped: s.count_skipped,
      signoff_state: s.variance_state === null ? null : SIGNOFF_LABEL[s.variance_state],
    };
  });

  // 05 v1.0.22 R-83 (5): brought / carried forward lines by (mode, the payment's shift staff), in − out.
  const forward = (rows: readonly ReportForwardPayment[]) =>
    groupBy(
      rows,
      (p) => [p.mode_name, p.mode_id, p.shift_staff_id],
      () => ({ amount_minor: 0 }),
      (a, p) => {
        a.amount_minor += p.direction === 'in' ? int(p.amount_minor, 'amount_minor') : -int(p.amount_minor, 'amount_minor');
      },
    ).map((g) => ({ mode_name: String(g.key[0]), staff_id: String(g.key[2]), amount_minor: int(g.acc.amount_minor, 'forward') }));

  const fiscal = { pending: 0, acked: 0, rejected: 0, not_required: 0 };
  for (const i of input.invoices) fiscal[i.fiscal_state] += 1;

  return {
    kind: input.kind,
    z_no: input.z_no,
    business_date: input.business_date,
    issued_at: input.issued_at,
    currency_code: input.currency_code,
    sales: {
      invoice_count: sales.length,
      gross_minor: gross,
      discounts: { count: discounted.length, value_minor: discountValue, by_reason: discountByReason, entries: discountEntries },
      service_charge_minor: sum(sales.map((i) => i.service_charge_minor), 'service_charge_minor'),
      net_minor: int(gross - discountValue, 'net'), // §3.1: Net = Σ line bases − discount
      taxes,
      rounding_minor: sum(sales.map((i) => i.rounding_minor), 'rounding_minor'), // §6.26 (§25): its own line
      total_minor: salesTotal,
    },
    credits: { count: credits.length, value_minor: creditValue, by_reason: creditByReason },
    net_after_credits_minor: int(salesTotal - creditValue, 'net_after_credits'), // B26: Z = Σ sale − Σ credit
    payments_by_mode: paymentsByMode,
    comps: {
      value_minor: sum(input.comps.map((c) => c.value_minor), 'comp value_minor'),
      voided_minor: sum(input.voids.map((v) => v.comp_voided_minor ?? 0), 'comp_voided_minor'),
      removals: { count: input.comp_removals.length, value_minor: sum(input.comp_removals.map((c) => c.comp_minor), 'comp_minor') },
    },
    voids,
    reopens: {
      count: reopens.length,
      value_minor: reopenValue,
      entries: reopens.map((r) => ({ requester_staff_id: r.requester_staff_id, approver_staff_id: r.approver_staff_id })),
    },
    petty_cash: groupBy(
      input.petty,
      (p) => [p.category_name, p.kind],
      () => ({ amount_minor: 0 }),
      (a, p) => {
        a.amount_minor += int(p.amount_minor, 'petty amount_minor');
      },
    ).map((g) => ({ category_name: String(g.key[0]), kind: String(g.key[1]), amount_minor: g.acc.amount_minor })),
    open_advances: sortBy(input.open_advances, (a) => [a.staff_id, a.at, a.amount_minor]).map((a) => ({
      staff_id: a.staff_id,
      amount_minor: int(a.amount_minor, 'advance amount_minor'),
      age_minutes: Math.max(0, Math.floor((input.issued_at - a.at) / 60_000)), // 05 v1.0.22 R-83 (7): floored
    })),
    shifts,
    variance_signoffs: sortBy(input.variance_signoffs, (v) => [v.shift_date, v.staff_id, v.signed_at, v.outcome, v.approver_staff_id ?? '', v.variance_minor]).map((v) => ({
      shift_date: v.shift_date,
      staff_id: v.staff_id,
      amount_minor: int(v.variance_minor, 'variance_minor'),
      outcome: v.outcome,
      approver_staff_id: v.approver_staff_id,
      at: v.signed_at,
    })),
    pending_signoffs: sortBy(input.pending_signoffs, (p) => [p.shift_date, p.staff_id, p.variance_minor]).map((p) => ({
      shift_date: p.shift_date,
      staff_id: p.staff_id,
      amount_minor: int(p.variance_minor, 'variance_minor'),
    })),
    takings_by_taker: takingsByTaker,
    full_refunds: {
      count: input.full_refunds.length,
      // 05 v1.0.22 R-83 (7): Σ the totals of the BillClosedEmpty's credit invoices (already inside credits)
      value_minor: sum(input.full_refunds.flatMap((f) => f.credit_totals_minor), 'full refund'),
    },
    fiscal,
    bills: { count: billCount, average_minor: average },
    // §6.26, M-8: open bills on the X only; flagged = open_minutes > open_bill_flag_minutes (§6.2)
    open_bills:
      input.kind === 'x'
        ? sortBy(input.open_bills, (b) => [b.identifier, b.open_minutes]).map((b) => ({ identifier: b.identifier, open_minutes: b.open_minutes, flagged: b.open_minutes > input.open_bill_flag_minutes }))
        : [],
    carried_over: sortBy(input.carried_over, (c) => [c.label, c.carried_in ? 1 : 0]).map((c) => ({ label: c.label, carried_in: c.carried_in })),
    brought_forward: forward(input.brought_forward),
    carried_forward: forward(input.carried_forward),
  };
}
