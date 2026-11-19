// 05 plan §2A.4 P0.Sa — spike, 0a half (GATE for the 0b base). Spec §3.5, §3.15, §3.16, §5 (fiscal_outbox),
// §6.12 steps 6–7, §6.31 (table 7). Only merged 0a code is exercised: computeSplit (@pos/domain compute.ts), the 5a
// FiscalSnapshot / invoice field types, buildReceiptDoc (docs.ts), the PK seed (jurisdiction-seeds.ts via
// defaults.ts), outboxRowFor / insertOutboxRow (outbox.ts), the none adapter, runOnce (worker.ts), the test-only fake
// adapter and outbox-db. The glue the 0b close (task 17) and 29b will own — computeSplit → InvoiceIssued fields,
// the per-line tax spread, the snapshot from jurisdiction rules, loadSubmission / onAnswer — lives here as small
// explicit helpers. No casts except the COUNT(*) pluck in case (c) (the fiscal tests' pattern). No timing asserts.
import {
  apportionMinor,
  buildReceiptDoc,
  computeSplit,
  currencyExponent,
  type ComputePayment,
  type ComputeRules,
  type ComputeSplitLine,
  type ComputeSplitResult,
  type ComputeTaxProfile,
  type ComputeTaxRate,
  type Doc,
  type DocContext,
  type DocPayment,
  type FiscalInvoiceLine,
  type FiscalSaleInvoiceFields,
  type FiscalSnapshot,
} from '@pos/domain';
import { JURISDICTION_SEEDS, type JurisdictionRuleValues } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { builtInBillingDefaults } from '../../src/billing/defaults';
import { noneAdapter } from '../../src/billing/fiscal/none';
import { insertOutboxRow, outboxRowFor, type OutboxRow } from '../../src/billing/fiscal/outbox';
import type { FiscalAdapter, FiscalSubmission } from '../../src/billing/fiscal/port';
import {
  resetFiscalWorker,
  runOnce,
  type FiscalFinalAnswer,
  type FiscalWorkRow,
  type LoadedSubmission,
} from '../../src/billing/fiscal/worker';
import { fixedClock, T } from '../../src/lib/clock';
import { createLogCapture } from '../helpers/log-capture';
import { fakeAdapter } from './fiscal/fake-adapter';
import { freshOutboxDb, type OutboxDb } from './fiscal/outbox-db';

let open: OutboxDb[] = [];
afterEach(() => {
  for (const fx of open) fx.cleanup();
  open = [];
  resetFiscalWorker();
});
async function db(): Promise<OutboxDb> {
  const fx = await freshOutboxDb();
  open.push(fx);
  return fx;
}

// ------------------------------------------------------------------------------------------------ table 7 (§6.31)

const BUSINESS_DATE = '2026-11-19';
const PROFILE = 'tc-food'; // 01a tax class id = the line's tax_profile_id (§3.4)

/** What the 0b mapper reads from the orders: the menu side of a bill line (not in ComputeSplitLine). */
type MenuLine = Pick<FiscalInvoiceLine, 'order_item_id' | 'item_id' | 'name' | 'units' | 'unit_price_minor' | 'fiscal_category'>;

/** Rs 5,710.00 of food on one tax class (§6.31): 2 400 + 1 800 + 600 + 910. */
const TABLE_7: MenuLine[] = [
  { order_item_id: 'oi-1', item_id: 'paye', name: 'Paye', units: 2, unit_price_minor: 120_000, fiscal_category: 'restaurant_service' },
  { order_item_id: 'oi-2', item_id: 'chanay', name: 'Chanay', units: 3, unit_price_minor: 60_000, fiscal_category: 'restaurant_service' },
  { order_item_id: 'oi-3', item_id: 'naan', name: 'Naan', units: 10, unit_price_minor: 6_000, fiscal_category: 'restaurant_service' },
  { order_item_id: 'oi-4', item_id: 'lassi', name: 'Lassi', units: 4, unit_price_minor: 22_750, fiscal_category: 'restaurant_service' },
];
const NET_MINOR = 571_000;

function splitLines(menu: readonly MenuLine[]): ComputeSplitLine[] {
  return menu.map((l) => ({
    order_item_id: l.order_item_id,
    line_kind: 'item',
    units: l.units,
    unit_price_minor: l.unit_price_minor,
    base_minor: l.units * l.unit_price_minor,
    discount_minor: 0,
    tax_profile_id: PROFILE,
  }));
}

function ratesFor(cash_bp: number, digital_bp: number): ComputeTaxRate[] {
  return (['integrated', 'not_integrated'] as const).flatMap((integration_status) => [
    { payment_class: 'cash' as const, integration_status, effective_from: '2026-01-01', rate_bp: cash_bp, ref: null },
    { payment_class: 'digital' as const, integration_status, effective_from: '2026-01-01', rate_bp: digital_bp, ref: null },
  ]);
}

/** §3.4: a PK / none profile = one tax 'TAX' labelled with the tax class name at its rate_bp (the 0b mapper's job). */
function oneTaxProfile(label: string, cash_bp: number, digital_bp = cash_bp): ComputeTaxProfile {
  return { tax_profile_id: PROFILE, taxes: [{ seq: 1, tax_code: 'TAX', label, compound: false, rates: ratesFor(cash_bp, digital_bp) }] };
}

// ------------------------------------------------------------------------------------------------ glue helpers

/**
 * Glue: jurisdiction rule values (A-1 seed shape) → compute rules. `tax_enabled` (01a) and `integration_status`
 * (branch fiscal settings) are not jurisdiction values; the bill freezes price mode and rounding at open (H9-9, H16-2).
 */
function computeRulesFrom(j: JurisdictionRuleValues, currency_exponent: number): ComputeRules {
  return {
    tax_enabled: true,
    prices_include_tax: j.prices_include_tax,
    rounding: { step_minor: j.rounding_step_minor, mode: j.rounding_mode, applies_to: j.rounding_applies_to },
    mixed_class_rule: j.mixed_class_rule,
    integration_status: 'integrated',
    currency_exponent,
  };
}

/**
 * Glue (§6.12 step 6 `fiscal`): the snapshot in force at issue, from the jurisdiction's rule values and the
 * branch's adapter / pos_id. Seam: A-1 `receipt_fiscal` is nullable ("no fiscal fields on the receipt",
 * jurisdiction-seeds.ts:40) while 5a `FiscalSnapshot.receipt` is not (fiscal-snapshot.ts:45); a null maps to an
 * empty receipt block (label null, no registrations, no QR, no buyer ID).
 */
function snapshotFor(
  j: JurisdictionRuleValues,
  adapter: FiscalAdapter,
  o: {
    required: boolean;
    pos_id: string | null;
    seller_registrations: FiscalSnapshot['seller_registrations'];
    payment_codes: FiscalSnapshot['payment_codes'];
  },
): FiscalSnapshot {
  const r = j.receipt_fiscal;
  return {
    adapter_key: j.adapter_key,
    pos_id: o.pos_id,
    required: o.required,
    capabilities: { ordering: adapter.capabilities.ordering, credit: adapter.capabilities.credit },
    credit_support: j.credit_support,
    rounding: { step_minor: j.rounding_step_minor, mode: j.rounding_mode, applies_to: j.rounding_applies_to },
    receipt:
      r === null
        ? { fiscal_number_label: null, tax_reg_labels: [], show_qr: false, qr_url_template: null, buyer_id_on_receipt: false }
        : {
            fiscal_number_label: r.fiscal_number_label,
            tax_reg_labels: r.tax_reg_labels.map((l) => ({ code: l.code, label: l.label })),
            show_qr: r.show_qr,
            qr_url_template: r.qr_url_template,
            buyer_id_on_receipt: r.buyer_id_on_receipt,
          },
    seller_registrations: o.seller_registrations,
    payment_codes: o.payment_codes,
  };
}

/**
 * Glue (§6.12 step 6, J-2): each (profile, tax) invoice row's tax spread over the profile's lines by line net
 * (base − discount) with apportionMinor. compute.ts gives only the invoice rows; the per-line spread is the close's.
 * Line base = the line net (exclusive, simple tax, no service charge — the only shape this spike builds).
 */
function lineTaxes(split: ComputeSplitResult, line: ComputeSplitLine): FiscalInvoiceLine['taxes'] {
  return split.totals.as_paid.taxes
    .filter((t) => t.tax_profile_id === line.tax_profile_id)
    .map((t) => {
      const ofProfile = split.lines.filter((l) => l.tax_profile_id === t.tax_profile_id);
      const shares = apportionMinor(t.tax_minor, ofProfile.map((l) => l.base_minor - l.discount_minor));
      const i = ofProfile.findIndex((l) => l.order_item_id === line.order_item_id);
      return {
        tax_code: t.tax_code,
        payment_class: t.payment_class,
        rate_bp: t.rate_bp,
        base_minor: line.base_minor - line.discount_minor,
        tax_minor: shares[i]!,
      };
    });
}

/** Glue (§6.12 step 6): `computeSplit`'s as-paid totals → the `InvoiceIssued` fields 5a types. */
function invoiceFrom(
  split: ComputeSplitResult,
  menu: readonly MenuLine[],
  o: {
    invoice_id: string;
    invoice_ref: string;
    jurisdiction_id: string;
    currency_code: string;
    payment_ids: string[];
    fiscal: FiscalSnapshot;
    /** The rules computeSplit ran with: the bill's frozen price mode is recorded as-is (H9-9). */
    rules: ComputeRules;
  },
): FiscalSaleInvoiceFields {
  const t = split.totals.as_paid;
  const byId = new Map(menu.map((m) => [m.order_item_id, m]));
  return {
    series: 'sale',
    invoice_id: o.invoice_id,
    invoice_ref: o.invoice_ref,
    issued_at: T,
    order_type: 'dine_in',
    jurisdiction_id: o.jurisdiction_id,
    currency_code: o.currency_code,
    prices_include_tax: o.rules.prices_include_tax,
    lines: split.lines.map((l) => {
      const m = byId.get(l.order_item_id)!;
      return {
        order_item_id: l.order_item_id,
        item_id: m.item_id,
        name: m.name,
        units: l.units,
        unit_price_minor: l.unit_price_minor,
        base_minor: l.base_minor,
        discount_minor: l.discount_minor,
        tax_profile_id: l.tax_profile_id,
        fiscal_category: m.fiscal_category,
        taxes: lineTaxes(split, l),
      };
    }),
    service_charge: null, // no service charge on this bill (t.service_charge_minor is 0, asserted below)
    subtotal_minor: t.subtotal_minor,
    discount_minor: t.discount_minor,
    // ComputeTaxRow and FiscalInvoiceTax carry the same ten keys
    taxes: t.taxes.map((x) => ({ ...x })),
    rounding_minor: t.rounding_minor,
    total_minor: t.total_minor,
    payment_ids: o.payment_ids,
    buyer_id_refused: false,
    fiscal: o.fiscal,
  };
}

const CTX: DocContext = {
  width_cols: 48,
  currency_exponent: currencyExponent('PKR'),
  utc_offset_ms: 5 * 3_600_000,
  branch_name: 'Arif Chatkhara Main',
  template: {
    header_lines: ['{branch_name}'],
    footer_lines: ['Thank you'],
    show: { tax_reg_no: true, address: false, phone: false, cashier: true, order_no: false, bill_no: true },
    address: null,
    phone: null,
  },
};

const docText = (doc: Doc): string => doc.blocks.flatMap((b) => ('text' in b ? [b.text] : [])).join('\n');

/** A line "<left> … <right>" of a 48-column doc (the layout's spread). */
const row = (left: string, right: string): string => left + ' '.repeat(48 - left.length - right.length) + right;

// =============================================================================================================== (a)

describe('[05 spike-0a] (a) jurisdiction PK, adapter none', () => {
  const defaults = builtInBillingDefaults({ currency_code: 'PKR', currency_exponent: currencyExponent('PKR') });
  const pk = defaults.jurisdiction.rules;
  const rules = computeRulesFrom(pk, defaults.jurisdiction.currency_exponent);
  // the PK seed rate rows: one tax at the tax class rate_bp (1 600) for both classes (§3.4, v0.6.2 adapter none)
  const profiles = [oneTaxProfile('Sales tax', 1600)];
  const payments: ComputePayment[] = [{ split_no: 1, payment_class: 'cash', direction: 'in', amount_minor: 662_400, tendered_minor: 700_000 }];
  const split = computeSplit({ split_no: 1, business_date: BUSINESS_DATE, rules, tax_profiles: profiles, lines: splitLines(TABLE_7), service_charge: null, payments });
  const fiscal = snapshotFor(pk, noneAdapter, {
    required: false, // §3.15 / H8-3: adapter none → not fiscalized
    pos_id: null,
    seller_registrations: [{ code: 'NTN', number: '1234567' }],
    payment_codes: [{ payment_id: 'pay-a1', authority_code: null }],
  });
  const invoice = invoiceFrom(split, TABLE_7, {
    invoice_id: 'inv-a1',
    invoice_ref: 'AC1-S000123',
    jurisdiction_id: defaults.jurisdiction.jurisdiction_id,
    currency_code: defaults.jurisdiction.currency_code,
    payment_ids: ['pay-a1'],
    fiscal,
    rules,
  });

  it('[05 spike-0a] (a) the PK defaults come from the seed constant (PKR, step Rs 1, nearest, all, adapter none)', () => {
    expect(pk).toBe(JURISDICTION_SEEDS.PK);
    expect(defaults.jurisdiction).toMatchObject({ jurisdiction_id: 'PK', adapter_key: 'none', currency_code: 'PKR', currency_exponent: 2 });
    expect(rules.rounding).toEqual({ step_minor: 100, mode: 'nearest', applies_to: 'all' });
    expect(pk.prices_include_tax).toBe(false); // the PK seed is tax-exclusive (A-1 (2))
    expect(rules.prices_include_tax).toBe(false);
  });

  it('[05 spike-0a] (a) computeSplit on table 7 gives 5,710 + 913.60 = 6,623.60 → 6,624.00 (rounding +0.40), change 376', () => {
    expect(split.blocks).toEqual([]);
    expect(split.payment_class).toBe('cash');
    const t = split.totals.as_paid;
    expect(t).toMatchObject({
      subtotal_minor: NET_MINOR,
      discount_minor: 0,
      pre_tax_net_minor: NET_MINOR,
      service_charge_minor: 0,
      exact_total_minor: 662_360,
      rounding_minor: 40,
      total_minor: 662_400,
    });
    expect(t.taxes).toEqual([
      { tax_profile_id: PROFILE, tax_code: 'TAX', label: 'Sales tax', seq: 1, compound: false, payment_class: 'cash', rate_bp: 1600, rate_ref: null, base_minor: NET_MINOR, tax_minor: 91_360 },
    ]);
    expect(split.balance_minor).toBe(0);
    expect(split.change_minor).toBe(37_600);
  });

  it('[05 spike-0a] (a) construction check of the test glue: per-line spread pinned, sums match the invoice row', () => {
    const row0 = invoice.taxes[0]!;
    expect(invoice.prices_include_tax).toBe(rules.prices_include_tax);
    expect(invoice.lines.reduce((s, l) => s + l.taxes[0]!.tax_minor, 0)).toBe(row0.tax_minor);
    expect(invoice.lines.reduce((s, l) => s + l.taxes[0]!.base_minor, 0)).toBe(row0.base_minor);
    expect(invoice.lines.reduce((s, l) => s + l.base_minor, 0)).toBe(invoice.subtotal_minor);
    expect(invoice.lines.map((l) => l.taxes[0]!.tax_minor)).toEqual([38_400, 28_800, 9_600, 14_560]);
    expect(invoice.subtotal_minor - invoice.discount_minor + row0.tax_minor + invoice.rounding_minor).toBe(invoice.total_minor);
    expect(invoice.fiscal.rounding).toEqual(rules.rounding); // H16-2: the frozen rule is recorded
  });

  it('[05 spike-0a] (a) outboxRowFor → insertOutboxRow gives a not_required row; the worker never calls none', async () => {
    const fx = await db();
    const outRow = outboxRowFor(invoice, 41);
    expect(outRow).toEqual({
      invoice_id: 'inv-a1',
      ord: 41,
      ref_invoice_id: null,
      jurisdiction_id: 'PK',
      adapter_key: 'none',
      pos_id: null,
      state: 'not_required',
      queued_at: T,
    });
    expect(insertOutboxRow(fx.db, outRow)).toBe(true);
    expect(fx.db.prepare('SELECT state, attempts, in_flight_at FROM fiscal_outbox WHERE invoice_id = ?').get('inv-a1')).toEqual({
      state: 'not_required',
      attempts: 0,
      in_flight_at: null,
    });
    // none.ts throws when called; a not_required row is never selected by the worker
    const sent = await runOnce({
      db: fx.db,
      clock: fixedClock(T),
      adapterFor: (key) => (key === noneAdapter.key ? noneAdapter : null),
      loadSubmission: () => {
        throw new Error('loadSubmission must not run for a not_required row');
      },
      onAnswer: () => {
        throw new Error('onAnswer must not run for a not_required row');
      },
    });
    expect(sent).toBe(0);
  });

  it('[05 spike-0a] (a) buildReceiptDoc shows the rounding line outside the tax row and NO fiscal block', () => {
    const payments: DocPayment[] = [{ mode_name: 'Cash', payment_class: 'cash', direction: 'in', amount_minor: 662_400 }];
    const doc = buildReceiptDoc(
      { invoice, payments, change_minor: split.change_minor, cashier_name: 'Ali', order_label: null, bill_label: 'T7', fiscal_number: null, is_reprint: false },
      CTX,
    );
    const text = docText(doc);
    const lines = text.split('\n');
    expect(lines).toContain(row('Subtotal', '5,710.00'));
    expect(lines).toContain(row('Sales tax 16% cash', '913.60'));
    expect(lines).toContain(row('Rounding adjustment', '0.40'));
    expect(lines).toContain(row('TOTAL PKR', '6,624.00'));
    expect(lines).toContain(row('Change', '376.00'));
    // the rounding line is its own line, after the tax row and before the total (§3.5 (7), §25)
    expect(lines.indexOf(row('Rounding adjustment', '0.40'))).toBeGreaterThan(lines.indexOf(row('Sales tax 16% cash', '913.60')));
    expect(lines.indexOf(row('Rounding adjustment', '0.40'))).toBeLessThan(lines.indexOf(row('TOTAL PKR', '6,624.00')));
    // B21 / §3.15: not fiscalized → no fiscal block at all
    expect(text).not.toMatch(/fiscal/i);
    expect(doc.blocks).toContainEqual({ drawer: true });
  });

  // §3.15: `none` is never called, so its rows are not_required whatever the snapshot's `required` says (outbox.ts).
  // The receipt side of that combination is a P0.G gap row (integrator), not a test here.
  it('[05 spike-0a] (a) outboxRowFor gives not_required for adapter none even with required: true', () => {
    expect(outboxRowFor({ ...invoice, fiscal: { ...fiscal, required: true } }, 42).state).toBe('not_required');
  });
});

// =============================================================================================================== (b)

describe('[05 spike-0a] (b) test jurisdiction with the fake adapter (strict_per_pos_id, credential token)', () => {
  const fake = fakeAdapter({ key: 'FAKE', ordering: 'strict_per_pos_id', credentialNames: ['token'] });
  // A test jurisdiction shaped like PK-PB (§6.31): cash 16 %, digital 5 %, Rs 1 nearest, all, adapter FAKE.
  const TEST_J: JurisdictionRuleValues = {
    ...JURISDICTION_SEEDS.PK,
    jurisdiction_id: 'TEST-J',
    adapter_key: fake.key,
    receipt_fiscal: {
      fiscal_number_label: 'TEST fiscal no.',
      tax_reg_labels: [{ code: 'NTN', label: 'NTN' }],
      show_qr: false,
      qr_url_template: null,
      buyer_id_on_receipt: false,
    },
  };
  const exponent = currencyExponent('PKR');
  const rules = computeRulesFrom(TEST_J, exponent);
  const profiles = [oneTaxProfile('Sales tax on services', 1600, 500)];
  // §6.31 step 2: all by card → 5,710 + 285.50 = 5,995.50 → 5,996.00 (+0.50)
  const payments: ComputePayment[] = [{ split_no: 1, payment_class: 'digital', direction: 'in', amount_minor: 599_600 }];
  const split = computeSplit({ split_no: 1, business_date: BUSINESS_DATE, rules, tax_profiles: profiles, lines: splitLines(TABLE_7), service_charge: null, payments });
  const POS = 'POS-1';
  const fiscal = snapshotFor(TEST_J, fake, {
    required: true,
    pos_id: POS,
    seller_registrations: [{ code: 'NTN', number: '1234567' }],
    payment_codes: [{ payment_id: 'pay-b1', authority_code: '2' }],
  });
  const invoice = invoiceFrom(split, TABLE_7, {
    invoice_id: 'inv-b1',
    invoice_ref: 'AC1-S000123',
    jurisdiction_id: TEST_J.jurisdiction_id,
    currency_code: 'PKR',
    payment_ids: ['pay-b1'],
    fiscal,
    rules,
  });
  const docPayments: DocPayment[] = [{ mode_name: 'Card', payment_class: 'digital', direction: 'in', amount_minor: 599_600 }];
  const receipt = (fiscal_number: string | null, is_reprint: boolean): Doc =>
    buildReceiptDoc(
      { invoice, payments: docPayments, change_minor: split.change_minor, cashier_name: null, order_label: null, bill_label: 'T7', fiscal_number, is_reprint },
      CTX,
    );
  /** The money lines of the all-card receipt (§6.31 step 2), as docs.ts prints them. */
  const expectCardAmounts = (text: string): void => {
    const lines = text.split('\n');
    expect(lines).toContain(row('Subtotal', '5,710.00'));
    expect(lines).toContain(row('Sales tax on services 5% card', '285.50'));
    expect(lines).toContain(row('Rounding adjustment', '0.50'));
    expect(lines).toContain(row('TOTAL PKR', '5,996.00'));
    expect(lines).toContain(row('Card', '5,996.00'));
  };

  /**
   * Glue (29b's loadSubmission): the neutral submission from the invoice fields + the payments + branch fiscal
   * settings. Not on the invoice: `seller.branch_id`, `currency_exponent` (row F-6), `config`, each payment's class /
   * direction / amount (PaymentAdded), `tax_minor` (Σ the invoice rows). Seam: the snapshot's
   * `payment_codes[].authority_code` is `string | null` (fiscal-snapshot.ts:47) while the port's
   * `payments[].authority_code` is `string` (port.ts:33); the close guarantees a code on a fiscalized split (§6.12
   * step 3, H8-3), so a null here is a test bug and throws.
   */
  function submissionFor(inv: FiscalSaleInvoiceFields): Extract<LoadedSubmission, { ok: true }>['submission'] {
    const codes = new Map(inv.fiscal.payment_codes.map((c) => [c.payment_id, c.authority_code]));
    const live = payments.map((p, i) => ({ payment_id: inv.payment_ids[i]!, ...p }));
    return {
      currency_code: inv.currency_code,
      currency_exponent: currencyExponent(inv.currency_code),
      prices_include_tax: inv.prices_include_tax,
      seller: { branch_id: 'branch-1', tax_registrations: inv.fiscal.seller_registrations },
      config: { environment: 'sandbox', base_url: null, settings: {} },
      invoice: {
        invoice_ref: inv.invoice_ref,
        issued_at: inv.issued_at,
        order_type: inv.order_type,
        lines: inv.lines.map((l) => ({
          order_item_id: l.order_item_id,
          item_id: l.item_id,
          tax_profile_id: l.tax_profile_id,
          fiscal_category: l.fiscal_category,
          name: l.name,
          units: l.units,
          unit_price_minor: l.unit_price_minor,
          base_minor: l.base_minor,
          discount_minor: l.discount_minor,
          taxes: l.taxes,
        })),
        service_charge: inv.service_charge === null ? null : { amount_minor: inv.service_charge.amount_minor, taxes: inv.service_charge.taxes },
        subtotal_minor: inv.subtotal_minor,
        discount_minor: inv.discount_minor,
        tax_minor: inv.taxes.reduce((s, x) => s + x.tax_minor, 0),
        rounding_minor: inv.rounding_minor,
        total_minor: inv.total_minor,
        taxes: inv.taxes.map((x) => ({
          tax_profile_id: x.tax_profile_id,
          tax_code: x.tax_code,
          payment_class: x.payment_class,
          rate_bp: x.rate_bp,
          base_minor: x.base_minor,
          tax_minor: x.tax_minor,
        })),
        payments: live.map((p) => {
          const code = codes.get(p.payment_id);
          if (code === undefined || code === null) throw new Error(`spike glue: payment ${p.payment_id} has no authority_code`);
          return { authority_code: code, payment_class: p.payment_class, direction: p.direction, amount_minor: p.amount_minor };
        }),
        buyer: null,
        buyer_id_refused: inv.buyer_id_refused,
      },
    };
  }

  it('[05 spike-0a] (b) computeSplit: all card at 5 % → 5,995.50 → 5,996.00 (rounding +0.50)', () => {
    expect(split.blocks).toEqual([]);
    expect(split.payment_class).toBe('digital');
    expect(split.totals.as_paid).toMatchObject({ subtotal_minor: NET_MINOR, exact_total_minor: 599_550, rounding_minor: 50, total_minor: 599_600 });
    expect(split.totals.as_paid.taxes.map((t) => [t.payment_class, t.rate_bp, t.tax_minor])).toEqual([['digital', 500, 28_550]]);
    expect(split.balance_minor).toBe(0);
  });

  it('[05 spike-0a] (b) construction check of the test glue: per-line spread pinned, sums match the invoice row', () => {
    expect(invoice.prices_include_tax).toBe(rules.prices_include_tax);
    expect(invoice.lines.map((l) => l.taxes[0]!.tax_minor)).toEqual([12_000, 9_000, 3_000, 4_550]);
    expect(invoice.lines.reduce((s, l) => s + l.taxes[0]!.tax_minor, 0)).toBe(invoice.taxes[0]!.tax_minor);
    expect(invoice.lines.reduce((s, l) => s + l.taxes[0]!.base_minor, 0)).toBe(invoice.taxes[0]!.base_minor);
  });

  it('[05 spike-0a] (b) pending row → runOnce sends with idempotency_key = invoice_ref and computeSplit totals; onAnswer ok; reprint shows the number', async () => {
    const fx = await db();
    const clock = fixedClock(T);
    fx.db
      .prepare('INSERT INTO fiscal_credentials (pos_id, name, token, set_at, set_by_staff_id) VALUES (?, ?, ?, ?, ?)')
      .run(POS, 'token', 'test-token', T, 'staff-owner');

    const outRow = outboxRowFor(invoice, 57);
    expect(outRow).toMatchObject({ state: 'pending', jurisdiction_id: 'TEST-J', adapter_key: 'FAKE', pos_id: POS, ord: 57 });
    expect(insertOutboxRow(fx.db, outRow)).toBe(true);

    // printed at close, before any answer (§6.12 step 7, B21)
    const closeDoc = receipt(null, false);
    const atClose = docText(closeDoc);
    expectCardAmounts(atClose);
    expect(atClose).toContain('FISCAL NUMBER PENDING');
    expect(atClose).not.toContain('TEST fiscal no.');
    // §6.31 step 2 / §3.16: an all-card split opens no drawer
    expect(closeDoc.blocks).not.toContainEqual({ drawer: true });
    const cap = createLogCapture();
    const logLine = (level: string) => (obj: Record<string, unknown>, msg?: string) => {
      cap.stream.write(`${JSON.stringify({ level, msg, ...obj })}\n`);
    };

    const invoices = new Map<string, FiscalSaleInvoiceFields>([[invoice.invoice_id, invoice]]);
    const answers: { row: FiscalWorkRow; answer: FiscalFinalAnswer }[] = [];
    fake.script({ outcome: 'ok', fiscal_number: 'FN-000777', qr_payload: null });
    const sent = await runOnce({
      db: fx.db,
      clock,
      adapterFor: (key) => (key === fake.key ? fake : null),
      loadSubmission: (r: FiscalWorkRow): LoadedSubmission => {
        const inv = invoices.get(r.invoice_id);
        return inv === undefined ? { ok: false, error_code: 'not_found' } : { ok: true, submission: submissionFor(inv), original: null };
      },
      // Glue (29b's onAnswer): FiscalNumberAssigned + the billing fold's row change, in one writer tx.
      // The `acked` state below is written by THIS test glue, not by the worker (29b supplies the real one);
      // the worker's own work on the row is clearing `in_flight_at` and `last_error` after the commit.
      onAnswer: (r, answer) => {
        fx.db.transaction(() => {
          answers.push({ row: r, answer });
          fx.db.prepare("UPDATE fiscal_outbox SET state = 'acked', acked_at = ? WHERE invoice_id = ?").run(clock.branchNow(), r.invoice_id);
        })();
      },
      log: { info: logLine('info'), error: logLine('error') },
    });

    expect(sent).toBe(1);
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0]!;
    expect(call.kind).toBe('sale');
    const sub: FiscalSubmission = call.sub;
    expect(sub.idempotency_key).toBe(invoice.invoice_ref);
    expect(sub.idempotency_key).toBe('AC1-S000123');
    expect(sub.pos_id).toBe(POS);
    expect(sub.jurisdiction_id).toBe('TEST-J');
    expect(sub.credentials).toEqual({ token: 'test-token' });
    // the submission's totals are computeSplit's, untouched
    const t = split.totals.as_paid;
    expect({
      subtotal_minor: sub.invoice.subtotal_minor,
      discount_minor: sub.invoice.discount_minor,
      tax_minor: sub.invoice.tax_minor,
      rounding_minor: sub.invoice.rounding_minor,
      total_minor: sub.invoice.total_minor,
    }).toEqual({
      subtotal_minor: t.subtotal_minor,
      discount_minor: t.discount_minor,
      tax_minor: t.taxes.reduce((s, x) => s + x.tax_minor, 0),
      rounding_minor: t.rounding_minor,
      total_minor: t.total_minor,
    });
    expect(sub.invoice).toMatchObject({ subtotal_minor: 571_000, discount_minor: 0, tax_minor: 28_550, rounding_minor: 50, total_minor: 599_600 });
    expect(sub.invoice.taxes).toEqual(
      t.taxes.map((x) => ({
        tax_profile_id: x.tax_profile_id,
        tax_code: x.tax_code,
        payment_class: x.payment_class,
        rate_bp: x.rate_bp,
        base_minor: x.base_minor,
        tax_minor: x.tax_minor,
      })),
    );
    expect(sub.invoice.lines.flatMap((l) => l.taxes).reduce((s, x) => s + x.tax_minor, 0)).toBe(sub.invoice.tax_minor);
    expect(sub.invoice.payments).toEqual([{ authority_code: '2', payment_class: 'digital', direction: 'in', amount_minor: 599_600 }]);

    expect(answers).toEqual([
      { row: expect.objectContaining({ invoice_id: 'inv-b1', pos_id: POS }), answer: { outcome: 'ok', fiscal_number: 'FN-000777', qr_payload: null } },
    ]);
    expect(fx.db.prepare('SELECT state, in_flight_at, last_error FROM fiscal_outbox WHERE invoice_id = ?').get('inv-b1')).toEqual({
      state: 'acked',
      in_flight_at: null,
      last_error: null,
    });

    // a reprint after the answer reads the number (FiscalNumberAssigned) and the snapshot's label (B21, H9-6)
    const answered = answers[0]!.answer;
    const number = answered.outcome === 'ok' ? answered.fiscal_number : null;
    const reprintDoc = receipt(number, true);
    const reprint = docText(reprintDoc);
    expectCardAmounts(reprint);
    expect(reprint).toContain('** REPRINT **');
    expect(reprint.split('\n')).toContain(row('TEST fiscal no.', 'FN-000777'));
    expect(reprint).not.toContain('FISCAL NUMBER PENDING');
    expect(reprintDoc.blocks).not.toContainEqual({ drawer: true });

    // privacy (B22, §7 Secrets): the token reaches the adapter only — never a log line, a Doc or the outbox row
    expect(cap.text()).toContain('fiscal.answered'); // the capture is live
    const outboxRow = fx.db.prepare('SELECT * FROM fiscal_outbox WHERE invoice_id = ?').get('inv-b1');
    for (const where of [cap.text(), JSON.stringify(closeDoc), JSON.stringify(reprintDoc), JSON.stringify(outboxRow)]) {
      expect(where).not.toContain('test-token');
      expect(where).not.toMatch(/buyer/i);
    }
    expect(sub.invoice.buyer).toBeNull(); // no buyer on this bill
  });
});

// =============================================================================================================== (c)

// Plan §2A.4 (c) as written: outbox writes roll back with their SQLite transaction, and insertOutboxRow's guard
// refuses a bad row. This is NOT the invoice + outbox close atomicity (append + fold in one tx) — carried to P0.Sb.
describe('[05 spike-0a] (c) outbox writes roll back with their SQLite transaction; insertOutboxRow guard', () => {
  const pending: OutboxRow = {
    invoice_id: 'inv-c1',
    ord: 9,
    ref_invoice_id: null,
    jurisdiction_id: 'TEST-J',
    adapter_key: 'FAKE',
    pos_id: 'POS-1',
    state: 'pending',
    queued_at: T,
  };
  const count = (fx: OutboxDb): number => fx.db.prepare('SELECT COUNT(*) FROM fiscal_outbox').pluck().get() as number;

  it('[05 spike-0a] (c) a failed insert after the row, inside a rolled-back SQLite transaction, leaves no outbox row', async () => {
    const fx = await db();
    const close = fx.db.transaction(() => {
      expect(insertOutboxRow(fx.db, pending)).toBe(true);
      expect(count(fx)).toBe(1); // visible inside the transaction
      // a later write in the same transaction fails (here: a second row breaking the table's CHECK through plain SQL)
      fx.db
        .prepare("INSERT INTO fiscal_outbox (invoice_id, ord, jurisdiction_id, adapter_key, state, queued_at) VALUES ('inv-c2', 10, 'TEST-J', 'FAKE', 'sent', ?)")
        .run(T);
    });
    expect(() => close()).toThrow(/CHECK constraint failed/);
    expect(count(fx)).toBe(0);
  });

  it('[05 spike-0a] (c) a bad row refused by insertOutboxRow rolls back the row before it in the same transaction', async () => {
    const fx = await db();
    const close = fx.db.transaction(() => {
      insertOutboxRow(fx.db, pending);
      insertOutboxRow(fx.db, { ...pending, invoice_id: 'inv-c3', jurisdiction_id: '' }); // OR IGNORE would swallow it; the guard throws
    });
    expect(() => close()).toThrow(/invalid fiscal_outbox row for invoice inv-c3/);
    expect(count(fx)).toBe(0);
    // and a committed close keeps its row
    fx.db.transaction(() => insertOutboxRow(fx.db, pending))();
    expect(count(fx)).toBe(1);
  });
});
