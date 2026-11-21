import { describe, expect, it } from 'vitest';
import type { Doc, DocBlock } from '../print.js';
import {
  buildCheckBillDoc,
  buildCreditNoteDoc,
  buildReceiptDoc,
  buildReportDoc,
  formatMinor,
  formatRateBp,
  type CheckBillDocInput,
  type DocContext,
  type ReportDocInput,
} from './docs.js';
import type { FiscalCreditInvoiceFields, FiscalSaleInvoiceFields, FiscalSnapshot } from './fiscal-snapshot.js';
import { renderText } from '../print-render.js';
import { computeBill, computeSplit, spreadLineTaxes, type ComputeSplitInput, type ComputeSplitLine } from './compute.js';
import { line as billLine, pkPbProfile, PK_PB_RULES, TODAY } from './compute.fixtures.js';

// 05 §3.16, B17, B21, B29, §6.26; §11 task 4a: pure Doc builders over 03c's Doc / DocBlock. They lay out the
// numbers they are given (no tax, rounding or due is computed here). Task 4b (rows P-3 / P-5, R-11, G-24, G-25): the
// fiscal state, the QR block, the buyer fill block and the inclusive memo — the last describe blocks of this file.

const texts = (doc: Doc): string[] => doc.blocks.flatMap((b) => ('text' in b ? b.text.split('\n') : []));
const joined = (doc: Doc): string => texts(doc).join('\n');
const has = (doc: Doc, pred: (b: DocBlock) => boolean): boolean => doc.blocks.some(pred);
const hasDrawer = (doc: Doc) => has(doc, (b) => 'drawer' in b);
const lineWith = (doc: Doc, needle: string) => texts(doc).find((t) => t.includes(needle));

// 2026-11-19 13:22 PKT (UTC+5)
const ISSUED_AT = Date.UTC(2026, 10, 19, 8, 22);
const PKT = 5 * 3_600_000;

function ctx(width_cols: 32 | 48 = 48, over: Partial<DocContext['template']> = {}): DocContext {
  return {
    width_cols,
    currency_exponent: 2,
    utc_offset_ms: PKT,
    branch_name: 'Arif Chatkhara Lake City',
    template: {
      header_lines: ['{branch_name}'],
      footer_lines: ['Thank you'],
      show: { tax_reg_no: true, address: true, phone: true, cashier: true, order_no: true, bill_no: true },
      address: 'Lake City, Lahore',
      phone: '042-1111111',
      ...over,
    },
  };
}

/** A test-only adapter key (not `none`, not PRA): a `required` snapshot under it is fiscalized (§3.1). */
const TEST_ADAPTER = 'TEST';

function snapshot(over: Partial<FiscalSnapshot> = {}): FiscalSnapshot {
  return {
    adapter_key: 'none',
    pos_id: null,
    required: false,
    capabilities: { ordering: 'none', credit: true },
    credit_support: 'credit_invoice',
    rounding: { step_minor: 100, mode: 'nearest', applies_to: 'all' },
    receipt: {
      fiscal_number_label: null,
      tax_reg_labels: [{ code: 'NTN', label: 'NTN' }],
      show_qr: false,
      qr_url_template: null,
      buyer_id_on_receipt: false,
    },
    seller_registrations: [{ code: 'NTN', number: '1234567-8' }],
    payment_codes: [],
    ...over,
  };
}

// §6.31 shape: Rs 5,710 of food, one tax (PST), card 5 % → tax 285.50, exact 5 995.50, rounding +0.50, total 5 996.00.
function sale(over: Partial<FiscalSaleInvoiceFields> = {}): FiscalSaleInvoiceFields {
  return {
    series: 'sale',
    invoice_id: 'inv1',
    invoice_ref: 'AC1S000123',
    issued_at: ISSUED_AT,
    order_type: 'dine_in',
    jurisdiction_id: 'PK-PB',
    currency_code: 'PKR',
    prices_include_tax: false,
    lines: [
      {
        order_item_id: 'oi1',
        item_id: 'karahi',
        name: 'Chicken Karahi Full',
        units: 1,
        unit_price_minor: 380_000,
        base_minor: 380_000,
        discount_minor: 0,
        tax_profile_id: 'tp1',
        fiscal_category: 'restaurant_service',
        taxes: [],
      },
      {
        order_item_id: 'oi2',
        item_id: 'naan',
        name: 'Naan',
        units: 10,
        unit_price_minor: 19_100,
        base_minor: 191_000,
        discount_minor: 0,
        tax_profile_id: 'tp1',
        fiscal_category: 'restaurant_service',
        taxes: [],
      },
    ],
    service_charge: null,
    subtotal_minor: 571_000,
    discount_minor: 0,
    taxes: [
      {
        tax_profile_id: 'tp1',
        tax_code: 'PST',
        label: 'PST',
        seq: 1,
        compound: false,
        payment_class: 'digital',
        rate_bp: 500,
        base_minor: 571_000,
        tax_minor: 28_550,
        rate_ref: 'PRA.32-24/2026/1313',
      },
    ],
    rounding_minor: 50,
    total_minor: 599_600,
    payment_ids: ['p1'],
    buyer_id_refused: false,
    fiscal: snapshot(),
    ...over,
  };
}

// R-11 / G-2: the invoice's fiscal state as the hub holds it (outbox row state; number + QR payload once acked).
const NOT_REQUIRED = { state: 'not_required' } as const;
const PENDING = { state: 'pending' } as const;
const REJECTED = { state: 'rejected' } as const;
const acked = (fiscal_number: string, qr_payload: string | null = null) => ({ state: 'acked', fiscal_number, qr_payload }) as const;

const card = { mode_name: 'Card', payment_class: 'digital', direction: 'in', amount_minor: 599_600 } as const;
const cash = (amount_minor: number) => ({ mode_name: 'Cash', payment_class: 'cash', direction: 'in', amount_minor }) as const;

const receiptInput = (over: Partial<Parameters<typeof buildReceiptDoc>[0]> = {}): Parameters<typeof buildReceiptDoc>[0] => ({
  invoice: sale(),
  payments: [card],
  change_minor: 0,
  cashier_name: 'Bilal',
  order_label: 'T7',
  bill_label: 'T7 split 1',
  fiscal: NOT_REQUIRED,
  buyer: null,
  is_reprint: false,
  ...over,
});

describe('formatters', () => {
  it('[05 F-6] formatMinor uses the currency exponent, groups thousands, keeps the sign', () => {
    expect(formatMinor(599_600, 2)).toBe('5,996.00');
    expect(formatMinor(50, 2)).toBe('0.50');
    expect(formatMinor(-2, 2)).toBe('-0.02');
    expect(formatMinor(12_049, 0)).toBe('12,049');
    expect(formatMinor(1_234_567, 3)).toBe('1,234.567');
    expect(formatMinor(0, 2)).toBe('0.00');
    expect(() => formatMinor(1.5, 2)).toThrow();
  });

  it('[05 §3.16] formatRateBp prints basis points as a percent', () => {
    expect(formatRateBp(1600)).toBe('16%');
    expect(formatRateBp(500)).toBe('5%');
    expect(formatRateBp(1650)).toBe('16.5%');
    expect(formatRateBp(1625)).toBe('16.25%');
    expect(formatRateBp(0)).toBe('0%');
  });
});

describe('check bill (B17)', () => {
  function checkBill(over: Partial<CheckBillDocInput> = {}): CheckBillDocInput {
    return {
      identifier: 'T7',
      printed_at: ISSUED_AT,
      lines: [
        { name: 'Chicken Karahi Full', units: 1, unit_price_minor: 380_000, amount_minor: 380_000 },
        { name: 'Naan', units: 10, unit_price_minor: 19_100, amount_minor: 191_000 },
      ],
      subtotal_minor: 571_000,
      discount_minor: 0,
      service_charge_minor: 0,
      taxes: [{ label: 'PST', rate_bp: 1600, payment_class: 'cash', tax_minor: 91_360 }],
      rounding_minor: 40,
      cash_total_minor: 662_400,
      digital_total_minor: 599_600,
      prices_include_tax: false,
      service_charge_taxes: [],
      ...over,
    };
  }

  it('[05 #59 doc half] banner, no invoice number, fiscal number or QR, the cash total and the digital-rate line', () => {
    const doc = buildCheckBillDoc(checkBill(), ctx());
    expect(texts(doc)).toContain('PROVISIONAL - NOT A TAX INVOICE');
    const all = texts(doc).filter((t) => t !== 'PROVISIONAL - NOT A TAX INVOICE').join('\n');
    expect(all).not.toMatch(/invoice|fiscal|AC1S/i);
    expect(all).not.toContain('QR');
    expect(lineWith(doc, 'Total if paid in cash')).toContain('6,624.00');
    expect(lineWith(doc, 'Total if paid by card')).toContain('5,996.00');
    expect(lineWith(doc, 'PST 16% cash')).toContain('913.60');
    expect(lineWith(doc, 'Rounding')).toContain('0.40');
    expect(hasDrawer(doc)).toBe(false);
    expect(has(doc, (b) => 'cut' in b)).toBe(true);
  });

  it('[05 #59 doc half] the digital-rate line is left out when the digital total is the same or absent', () => {
    expect(lineWith(buildCheckBillDoc(checkBill({ digital_total_minor: 662_400 }), ctx()), 'Total if paid by card')).toBeUndefined();
    expect(lineWith(buildCheckBillDoc(checkBill({ digital_total_minor: null }), ctx()), 'Total if paid by card')).toBeUndefined();
  });

  it('[05 #59 doc half] {bill_no} in a header line never prints a number on the check bill', () => {
    const doc = buildCheckBillDoc(checkBill(), ctx(48, { header_lines: ['{branch_name}', 'Bill {bill_no}'] }));
    expect(texts(doc)).toContain('Arif Chatkhara Lake City');
    expect(texts(doc)).toContain('Bill');
  });

  it('[05 #59 doc half] shows discount and service charge when present', () => {
    const doc = buildCheckBillDoc(checkBill({ discount_minor: 50_000, service_charge_minor: 25_000 }), ctx());
    expect(lineWith(doc, 'Discount')).toContain('-500.00');
    expect(lineWith(doc, 'Service charge')).toContain('250.00');
  });

  it('[05 #59 doc half] one tax row per (label, rate, class) on the check bill too', () => {
    const row = { label: 'PST', rate_bp: 1600, payment_class: 'cash', tax_minor: 50_000 } as const;
    const doc = buildCheckBillDoc(checkBill({ taxes: [row, { ...row, tax_minor: 41_360 }] }), ctx());
    const pst = texts(doc).filter((x) => x.startsWith('PST'));
    expect(pst).toHaveLength(1);
    expect(pst[0]).toContain('913.60');
  });
});

describe('receipt (#34, #20, #61 doc halves)', () => {
  it('[05 #34 doc half] number, lines, tax row, rounding, total, payments, registration, header / footer', () => {
    const doc = buildReceiptDoc(receiptInput(), ctx());
    expect(lineWith(doc, 'Invoice')).toContain('AC1S000123');
    expect(lineWith(doc, 'Chicken Karahi Full')).toContain('3,800.00');
    expect(lineWith(doc, 'Naan')).toContain('1,910.00');
    expect(texts(doc).some((t) => t.includes('10 x 191.00'))).toBe(true);
    expect(lineWith(doc, 'Subtotal')).toContain('5,710.00');
    expect(lineWith(doc, 'PST 5% card')).toContain('285.50');
    expect(lineWith(doc, 'TOTAL')).toContain('5,996.00');
    expect(lineWith(doc, 'Card')).toContain('5,996.00');
    expect(texts(doc)).toContain('NTN: 1234567-8');
    expect(texts(doc)).toContain('Arif Chatkhara Lake City');
    expect(texts(doc)).toContain('Thank you');
    expect(texts(doc)).toContain('Lake City, Lahore');
    expect(lineWith(doc, 'Closed by')).toContain('Bilal');
    expect(lineWith(doc, 'Order')).toContain('T7');
    expect(lineWith(doc, '19 Nov 2026')).toContain('1:22 PM');
    expect(lineWith(doc, 'Discount')).toBeUndefined();
    expect(lineWith(doc, 'Change')).toBeUndefined();
  });

  it('[05 #20 receipt half] the rounding line is outside every tax row and no tax row changes with it (§25)', () => {
    const doc = buildReceiptDoc(receiptInput(), ctx());
    const t = texts(doc);
    const taxAt = t.findIndex((x) => x.startsWith('PST'));
    const roundAt = t.findIndex((x) => x.startsWith('Rounding adjustment'));
    const totalAt = t.findIndex((x) => x.startsWith('TOTAL'));
    expect(t[roundAt]).toContain('0.50');
    expect(t[taxAt]).toContain('285.50');
    expect(taxAt).toBeLessThan(roundAt);
    expect(roundAt).toBeLessThan(totalAt);
    // negative adjustment
    const down = buildReceiptDoc(receiptInput({ invoice: sale({ rounding_minor: -2, total_minor: 599_548 }) }), ctx());
    expect(lineWith(down, 'Rounding')).toContain('-0.02');
    // no adjustment → no line
    const none = buildReceiptDoc(receiptInput({ invoice: sale({ rounding_minor: 0, total_minor: 599_550 }) }), ctx());
    expect(lineWith(none, 'Rounding')).toBeUndefined();
  });

  it('[05 #34 doc half] one tax row per (label, rate, payment class): two profiles with the same tax merge', () => {
    const base = sale().taxes[0]!;
    const invoice = sale({
      taxes: [
        { ...base, tax_profile_id: 'tp1', tax_minor: 20_000 },
        { ...base, tax_profile_id: 'tp2', tax_minor: 8_550 },
        { ...base, tax_profile_id: 'tp3', tax_code: 'FED', label: 'FED', rate_bp: 100, tax_minor: 1_000 },
      ],
    });
    const doc = buildReceiptDoc(receiptInput({ invoice }), ctx());
    const pst = texts(doc).filter((x) => x.startsWith('PST'));
    expect(pst).toHaveLength(1);
    expect(pst[0]).toContain('285.50');
    expect(lineWith(doc, 'FED 1% card')).toContain('10.00');
  });

  it('[05 #34 doc half H9-5] every seller registration prints on its own line with its label', () => {
    const invoice = sale({
      fiscal: snapshot({
        receipt: { ...snapshot().receipt, tax_reg_labels: [{ code: 'NTN', label: 'NTN' }, { code: 'STRN', label: 'Sales tax reg.' }] },
        seller_registrations: [
          { code: 'NTN', number: '1234567-8' },
          { code: 'STRN', number: '32-77-8761-123-45' },
        ],
      }),
    });
    const doc = buildReceiptDoc(receiptInput({ invoice }), ctx());
    expect(texts(doc)).toContain('NTN: 1234567-8');
    expect(texts(doc)).toContain('Sales tax reg.: 32-77-8761-123-45');
  });

  it('[05 B29] {tax_reg_no} in a header line expands to every registration; variables are substituted', () => {
    const invoice = sale({
      fiscal: snapshot({
        seller_registrations: [
          { code: 'NTN', number: '1' },
          { code: 'XX', number: '2' },
        ],
      }),
    });
    const template = {
      header_lines: ['{tax_reg_no}', '{address} / {phone}', 'Bill {bill_no} {date} {cashier}'],
      show: { tax_reg_no: false, address: false, phone: false, cashier: false, order_no: false, bill_no: false },
    };
    const doc = buildReceiptDoc(receiptInput({ invoice }), ctx(48, template));
    expect(texts(doc)).toContain('NTN: 1');
    // a value is never re-read as a replacement pattern or a variable
    const odd = sale({ fiscal: snapshot({ seller_registrations: [{ code: 'NTN', number: "$& $' {cashier}" }] }) });
    expect(texts(buildReceiptDoc(receiptInput({ invoice: odd }), ctx(48, template)))).toContain("NTN: $& $' {cashier}");
    // a code with no label in the snapshot prints its code
    expect(texts(doc)).toContain('XX: 2');
    expect(texts(doc)).toContain('Lake City, Lahore / 042-1111111');
    expect(texts(doc)).toContain('Bill AC1S000123 19 Nov 2026 1:22 PM Bilal');
    expect(lineWith(doc, 'Closed by')).toBeUndefined();
  });

  it('[05 B29] show toggles hide address, phone, registrations, cashier, order and bill lines', () => {
    const show = { tax_reg_no: false, address: false, phone: false, cashier: false, order_no: false, bill_no: false };
    const doc = buildReceiptDoc(receiptInput(), ctx(48, { show }));
    const all = joined(doc);
    expect(all).not.toContain('Lake City, Lahore');
    expect(all).not.toContain('042-1111111');
    expect(all).not.toContain('1234567-8');
    expect(all).not.toContain('Bilal');
    expect(all).not.toContain('T7 split 1');
    expect(lineWith(doc, 'Invoice')).toContain('AC1S000123');
  });

  it('[05 #34 doc half] discount, service charge, cash payment, change and the drawer block', () => {
    const invoice = sale({
      discount_minor: 10_000,
      service_charge: { amount_minor: 20_000, tax_profile_id: null, taxes: [] },
    });
    const doc = buildReceiptDoc(
      receiptInput({ invoice, payments: [cash(700_000)], change_minor: 100_400 }),
      ctx(),
    );
    expect(lineWith(doc, 'Discount')).toContain('-100.00');
    expect(lineWith(doc, 'Service charge')).toContain('200.00');
    expect(texts(doc).find((t) => /^Cash\s/.test(t))).toContain('7,000.00');
    expect(lineWith(doc, 'Change')).toContain('1,004.00');
    expect(hasDrawer(doc)).toBe(true);
  });

  it('[05 #34 doc half] drawer block only with a cash in or out payment', () => {
    expect(hasDrawer(buildReceiptDoc(receiptInput({ payments: [card] }), ctx()))).toBe(false);
    expect(hasDrawer(buildReceiptDoc(receiptInput({ payments: [] }), ctx()))).toBe(false);
    const out = { mode_name: 'Cash', payment_class: 'cash', direction: 'out', amount_minor: 500 } as const;
    const doc = buildReceiptDoc(receiptInput({ payments: [card, out] }), ctx());
    expect(hasDrawer(doc)).toBe(true);
    expect(lineWith(doc, 'Cash refund')).toContain('-5.00');
  });

  it('[05 #34 doc half B21] fiscalized and unanswered → FISCAL NUMBER PENDING; not fiscalized → no fiscal block', () => {
    const fiscalized = sale({
      fiscal: snapshot({ adapter_key: 'PRA', pos_id: 'P1', required: true, receipt: { ...snapshot().receipt, fiscal_number_label: 'PRA invoice no.' } }),
    });
    const pending = buildReceiptDoc(receiptInput({ invoice: fiscalized, fiscal: PENDING }), ctx());
    expect(texts(pending)).toContain('FISCAL NUMBER PENDING');
    expect(joined(pending)).not.toContain('PRA invoice no.');
    const plain = buildReceiptDoc(receiptInput(), ctx());
    expect(joined(plain)).not.toContain('FISCAL');
  });

  it('[05 P0.19a §3.1, §3.15, §6.12 step 7, G-1] fiscal block only when fiscalized: required + adapter none → none; required + a real adapter → PENDING', () => {
    // §3.15 "Not fiscalized (adapter none …)": the receipt has no fiscal block, whatever `required` says.
    const noneRequired = sale({ fiscal: snapshot({ adapter_key: 'none', required: true }) });
    const plain = buildReceiptDoc(receiptInput({ invoice: noneRequired }), ctx());
    expect(joined(plain)).not.toContain('FISCAL');
    // R-11: a fiscal state that disagrees with the snapshot is a caller bug, refused (outbox and docs agree, P0.19a)
    expect(() => buildReceiptDoc(receiptInput({ invoice: noneRequired, fiscal: acked('N9') }), ctx())).toThrow(RangeError);
    const noneCredit = { ...noneRequired, series: 'credit' as const, invoice_id: 'cr1', invoice_ref: 'AC1C000007', ref_invoice_id: 'inv1', ref_invoice_ref: 'AC1S000123' };
    expect(joined(buildCreditNoteDoc({ invoice: noneCredit, buyer_id: null, fiscal: NOT_REQUIRED, is_reprint: false, cashier_name: null }, ctx()))).not.toContain('FISCAL');
    // A required snapshot under a real (test) adapter is fiscalized: PENDING until the answer.
    const testRequired = sale({ fiscal: snapshot({ adapter_key: TEST_ADAPTER, pos_id: 'P1', required: true }) });
    expect(texts(buildReceiptDoc(receiptInput({ invoice: testRequired, fiscal: PENDING }), ctx()))).toContain('FISCAL NUMBER PENDING');
    // Not required under a real adapter (fiscalize: false order type): no block.
    const testNotRequired = sale({ fiscal: snapshot({ adapter_key: TEST_ADAPTER, pos_id: 'P1', required: false }) });
    expect(joined(buildReceiptDoc(receiptInput({ invoice: testNotRequired }), ctx()))).not.toContain('FISCAL');
  });

  it('[05 #61 doc half] a reprint after the answer shows REPRINT and the fiscal number with its label; before it, PENDING', () => {
    const fiscalized = sale({
      fiscal: snapshot({ adapter_key: 'PRA', pos_id: 'P1', required: true, receipt: { ...snapshot().receipt, fiscal_number_label: 'PRA invoice no.' } }),
    });
    const before = buildReceiptDoc(receiptInput({ invoice: fiscalized, fiscal: PENDING, is_reprint: true }), ctx());
    expect(texts(before)).toContain('** REPRINT **');
    expect(texts(before)).toContain('FISCAL NUMBER PENDING');
    const after = buildReceiptDoc(receiptInput({ invoice: fiscalized, is_reprint: true, fiscal: acked('1234ABC') }), ctx());
    expect(lineWith(after, 'PRA invoice no.')).toContain('1234ABC');
    expect(joined(after)).not.toContain('PENDING');
    // no label in the snapshot → a neutral label
    const unlabelled = sale({ fiscal: snapshot({ adapter_key: TEST_ADAPTER, pos_id: 'P1', required: true }) });
    expect(lineWith(buildReceiptDoc(receiptInput({ invoice: unlabelled, fiscal: acked('N9') }), ctx()), 'N9')).toBe(
      lineWith(buildReceiptDoc(receiptInput({ invoice: unlabelled, fiscal: acked('N9') }), ctx()), 'Fiscal no.'),
    );
    // a fiscal number never prints on an invoice that is not fiscalized: the builder refuses the state (R-11)
    expect(() => buildReceiptDoc(receiptInput({ fiscal: acked('N9') }), ctx())).toThrow(RangeError);
  });

});

describe('credit note', () => {
  function credit(over: Partial<FiscalCreditInvoiceFields> = {}): FiscalCreditInvoiceFields {
    return { ...sale(), series: 'credit', invoice_id: 'cr1', invoice_ref: 'AC1C000007', ref_invoice_id: 'inv1', ref_invoice_ref: 'AC1S000123', ...over };
  }

  it('[05 §3.16 Q-3] credit note: title, its number, the original, amounts, and the last 4 of a buyer ID only', () => {
    const doc = buildCreditNoteDoc(
      { invoice: credit(), buyer_id: { type_label: 'CNIC', last4: '4567' }, fiscal: NOT_REQUIRED, is_reprint: false, cashier_name: null },
      ctx(),
    );
    expect(texts(doc)).toContain('CREDIT NOTE');
    expect(lineWith(doc, 'Credit note')).toContain('AC1C000007');
    expect(lineWith(doc, 'Against invoice')).toContain('AC1S000123');
    expect(lineWith(doc, 'PST 5% card')).toContain('285.50');
    expect(lineWith(doc, 'Rounding')).toContain('0.50');
    expect(lineWith(doc, 'TOTAL CREDIT')).toContain('5,996.00');
    expect(lineWith(doc, 'CNIC')).toBe('CNIC: ****4567');
    expect(hasDrawer(doc)).toBe(false);
  });

  it('[05 §3.16 Q-3] a longer value passed as last4 still prints 4 characters only', () => {
    const doc = buildCreditNoteDoc(
      { invoice: credit(), buyer_id: { type_label: 'CNIC', last4: '3520212345671' }, fiscal: NOT_REQUIRED, is_reprint: false, cashier_name: null },
      ctx(),
    );
    expect(joined(doc)).not.toContain('352021234');
    expect(lineWith(doc, 'CNIC')).toBe('CNIC: ****5671');
  });

  it('[05 B21] fiscalized credit: PENDING before the answer, the number after; no buyer line without a buyer', () => {
    const invoice = credit({ fiscal: snapshot({ adapter_key: TEST_ADAPTER, pos_id: 'P1', required: true, receipt: { ...snapshot().receipt, fiscal_number_label: 'PRA invoice no.' } }) });
    const before = buildCreditNoteDoc({ invoice, buyer_id: null, fiscal: PENDING, is_reprint: false, cashier_name: null }, ctx());
    expect(texts(before)).toContain('FISCAL NUMBER PENDING');
    const after = buildCreditNoteDoc({ invoice, buyer_id: null, fiscal: acked('C55'), is_reprint: true, cashier_name: null }, ctx());
    expect(lineWith(after, 'PRA invoice no.')).toContain('C55');
    expect(texts(after)).toContain('** REPRINT **');
    expect(joined(after)).not.toContain('****');
  });
});

describe('X / Z report', () => {
  function report(over: Partial<ReportDocInput> = {}): ReportDocInput {
    return {
      kind: 'z',
      z_no: 41,
      business_date: '2026-11-19',
      issued_at: ISSUED_AT,
      currency_code: 'PKR',
      sales: {
        invoice_count: 2,
        gross_minor: 1_142_000,
        discounts: { count: 1, value_minor: 10_000, by_reason: [{ reason_code: 'regular_customer', count: 1, value_minor: 10_000 }], entries: [{ requester_staff_id: 's1', approver_staff_id: 's9', method: 'approval', value_minor: 10_000 }] },
        service_charge_minor: 0,
        net_minor: 1_132_000,
        taxes: [{ tax_code: 'PST', label: 'PST', tax_profile_id: 'tp1', payment_class: 'cash', rate_bp: 1600, tax_minor: 181_120 }],
        rounding_minor: -20,
        total_minor: 1_313_100,
      },
      credits: { count: 1, value_minor: 662_400, by_reason: [{ reason_code: 'wrong_item_billed', count: 1, value_minor: 662_400 }] },
      net_after_credits_minor: 650_700,
      payments_by_mode: [{ mode_name: 'Cash', in_minor: 1_400_000, out_minor: 662_400, change_minor: 86_900 }],
      comps: { value_minor: 0, voided_minor: 0, removals: { count: 0, value_minor: 0 } },
      voids: [{ disposition: 'wastage', count: 1, value_minor: 19_100 }, { disposition: null, count: 2, value_minor: 5_000 }],
      reopens: { count: 1, value_minor: 662_400, entries: [{ requester_staff_id: 's1', approver_staff_id: null }] },
      petty_cash: [{ category_name: 'Vegetables', kind: 'out', amount_minor: 120_000 }],
      open_advances: [{ staff_id: 's2', amount_minor: 50_000, age_minutes: 300 }],
      shifts: [
        { staff_id: 's1', float_minor: 500_000, expected_minor: 1_150_700, counted_minor: 1_150_000, variance_minor: -700, skipped: false, signoff_state: 'pending sign-off' },
        { staff_id: 's2', float_minor: 0, expected_minor: 200_000, counted_minor: null, variance_minor: null, skipped: true, signoff_state: null },
      ],
      variance_signoffs: [{ shift_date: '2026-11-18', staff_id: 's3', amount_minor: -1_000, outcome: 'approved', approver_staff_id: 's9', at: ISSUED_AT }],
      pending_signoffs: [{ shift_date: '2026-11-19', staff_id: 's1', amount_minor: -700 }],
      takings_by_taker: [{ staff_id: 's1', amount_minor: 737_600 }],
      full_refunds: { count: 0, value_minor: 0 },
      fiscal: { pending: 1, acked: 3, rejected: 0, not_required: 0 },
      bills: { count: 2, average_minor: 656_550 },
      open_bills: [],
      carried_over: [{ label: '#12', carried_in: true }],
      brought_forward: [{ mode_name: 'Cash', staff_id: 's1', amount_minor: 0 }],
      carried_forward: [{ mode_name: 'Card', staff_id: 's1', amount_minor: 30_000 }],
      ...over,
    };
  }
  const names = { s1: 'Bilal', s2: 'Usman', s3: 'Ali', s9: 'Arslan' };

  it('[05 §6.26 doc half] Z: title, date, currency, sales, tax by code / profile / class with rate, rounding on its own line', () => {
    const doc = buildReportDoc(report(), names, ctx());
    expect(texts(doc)).toContain('Z REPORT #41');
    expect(joined(doc)).toContain('2026-11-19');
    expect(joined(doc)).toContain('PKR');
    expect(lineWith(doc, 'Invoices')).toContain('2');
    expect(lineWith(doc, 'Gross')).toContain('11,420.00');
    expect(lineWith(doc, 'PST 16% cash')).toContain('1,811.20');
    expect(lineWith(doc, 'Rounding')).toContain('-0.20');
    expect(lineWith(doc, 'Net (sales - credits)')).toContain('6,507.00');
    expect(lineWith(doc, 'regular_customer')).toContain('100.00');
  });

  it('[05 §6.26 H16-5] staff ids are shown by the names passed in; an unknown id prints the id', () => {
    const doc = buildReportDoc(report(), { s1: 'Bilal' }, ctx());
    expect(joined(doc)).toContain('Bilal');
    expect(joined(doc)).toContain('s2');
    expect(joined(doc)).not.toContain('Arslan');
  });

  it('[05 §6.26] shifts: float, expected, counted, variance, skipped flag and sign-off state; payments by mode', () => {
    const doc = buildReportDoc(report(), names, ctx());
    const all = joined(doc);
    expect(all).toContain('Bilal');
    expect(lineWith(doc, 'Expected')).toContain('11,507.00');
    expect(lineWith(doc, 'Variance')).toContain('-7.00');
    expect(all).toContain('pending sign-off');
    expect(all).toContain('count skipped');
    expect(lineWith(doc, 'Change')).toContain('869.00');
    expect(lineWith(doc, 'Carried forward')).toContain('300.00');
    expect(all).toContain('carried in');
  });

  it('[05 §6.26 B23] X: expected cash is hidden for a shift not counted; open bills listed with the flag', () => {
    const doc = buildReportDoc(
      report({ kind: 'x', z_no: null, open_bills: [{ identifier: 'T4', open_minutes: 300, flagged: true }] }),
      names,
      ctx(),
    );
    expect(texts(doc)).toContain('X REPORT (DAY NOT CLOSED)');
    const usman = texts(doc).indexOf('Usman - count skipped');
    expect(usman).toBeGreaterThan(-1);
    const nextShift = texts(doc).slice(usman + 1);
    expect(nextShift.find((t) => t.trim().startsWith('Expected'))).toContain('hidden');
    expect(nextShift.find((t) => t.trim().startsWith('Variance'))).not.toContain('-7');
    // the counted shift still shows its expected cash on the X
    expect(lineWith(doc, 'Expected')).toContain('11,507.00');
    expect(lineWith(doc, 'T4')).toContain('OPEN TOO LONG');
    // the Z never hides it
    const z = buildReportDoc(report(), names, ctx());
    expect(joined(z)).not.toContain('hidden');
  });

  it('[05 §6.26] fiscal counts and voids by disposition', () => {
    const doc = buildReportDoc(report(), names, ctx());
    expect(lineWith(doc, 'Pending')).toContain('1');
    expect(lineWith(doc, 'Acked')).toContain('3');
    expect(lineWith(doc, 'wastage')).toContain('191.00');
    expect(lineWith(doc, 'no disposition')).toContain('50.00');
  });
});

describe('32 and 48 columns', () => {
  it.each([32, 48] as const)('[05 §3.16] %i cols: every two-column line fits the width exactly, the doc carries width_cols', (cols) => {
    const docs = [
      buildReceiptDoc(receiptInput(), ctx(cols)),
      buildCheckBillDoc(
        {
          identifier: 'T7',
          printed_at: ISSUED_AT,
          lines: [{ name: 'Naan', units: 10, unit_price_minor: 19_100, amount_minor: 191_000 }],
          subtotal_minor: 191_000,
          discount_minor: 0,
          service_charge_minor: 0,
          taxes: [],
          rounding_minor: 0,
          cash_total_minor: 191_000,
          digital_total_minor: null,
          prices_include_tax: false,
          service_charge_taxes: [],
        },
        ctx(cols),
      ),
    ];
    for (const doc of docs) {
      expect(doc.width_cols).toBe(cols);
      for (const t of texts(doc)) expect(t.length).toBeLessThanOrEqual(cols);
      expect(lineWith(doc, 'Naan')).toHaveLength(cols);
    }
  });

  it('[05 §3.16] a label too long for one line puts the amount on its own right-aligned line', () => {
    const longName = 'Special Mutton Karahi With Extra Butter Half Kg';
    const invoice = sale({ lines: [{ ...sale().lines[0]!, name: longName }] });
    const doc = buildReceiptDoc(receiptInput({ invoice }), ctx(32));
    const i = doc.blocks.findIndex((b) => 'text' in b && b.text === longName);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(doc.blocks[i + 1]).toEqual({ text: '3,800.00', align: 'right' });
  });
});

// =============================================================================================================== 4b

/** `left` and `right` spread over `cols` (the builders' two-column line). */
const row = (left: string, right: string, cols: 32 | 48 = 48) => left + ' '.repeat(cols - left.length - right.length) + right;

/** A fiscalized (test adapter) sale whose snapshot asks for a QR from `template`. */
function qrSale(template: string | null, show_qr = true, over: Partial<FiscalSnapshot['receipt']> = {}): FiscalSaleInvoiceFields {
  return sale({
    fiscal: snapshot({
      adapter_key: TEST_ADAPTER,
      pos_id: 'P1',
      required: true,
      receipt: { ...snapshot().receipt, fiscal_number_label: 'PRA invoice no.', show_qr, qr_url_template: template, ...over },
    }),
  });
}
const TEMPLATE = 'https://verify.test/inv?n={fiscal_number}';
const qrBlocks = (doc: Doc) => doc.blocks.filter((b): b is Extract<DocBlock, { qr: string }> => 'qr' in b);

describe('[05 4b] fiscal state (R-11 / G-2, B21, §3.16, §6.22)', () => {
  it('[05 #61 QR half, R-11] rejected → "FISCAL NUMBER NOT ISSUED" on the receipt and its reprint; never PENDING, no number, no QR', () => {
    for (const is_reprint of [false, true]) {
      const doc = buildReceiptDoc(receiptInput({ invoice: qrSale(TEMPLATE), fiscal: REJECTED, is_reprint }), ctx());
      expect(texts(doc)).toContain('FISCAL NUMBER NOT ISSUED');
      expect(joined(doc)).not.toContain('PENDING');
      expect(joined(doc)).not.toContain('PRA invoice no.');
      expect(qrBlocks(doc)).toEqual([]);
      expect(texts(doc).includes('** REPRINT **')).toBe(is_reprint);
    }
  });

  it('[05 #61 QR half, R-11] pending → PENDING and no QR, even when the snapshot asks for one', () => {
    const doc = buildReceiptDoc(receiptInput({ invoice: qrSale(TEMPLATE), fiscal: PENDING }), ctx());
    expect(texts(doc)).toContain('FISCAL NUMBER PENDING');
    expect(joined(doc)).not.toContain('NOT ISSUED');
    expect(qrBlocks(doc)).toEqual([]);
  });

  it('[05 R-11, P0.19a] a state that disagrees with the snapshot is refused: not_required on a fiscalized invoice, any other on a plain one', () => {
    expect(() => buildReceiptDoc(receiptInput({ invoice: qrSale(TEMPLATE), fiscal: NOT_REQUIRED }), ctx())).toThrow(RangeError);
    for (const fiscal of [PENDING, REJECTED, acked('N9')]) {
      expect(() => buildReceiptDoc(receiptInput({ fiscal }), ctx())).toThrow(RangeError);
    }
    expect(() => buildReceiptDoc(receiptInput({ fiscal: NOT_REQUIRED }), ctx())).not.toThrow();
  });

  it('[05 #78, R-11] the credit note follows the same states: rejected → NOT ISSUED, acked → number + QR', () => {
    const invoice = { ...qrSale(TEMPLATE), series: 'credit' as const, invoice_id: 'cr1', invoice_ref: 'AC1C000007', ref_invoice_id: 'inv1', ref_invoice_ref: 'AC1S000123' };
    const base = { invoice, buyer_id: null, is_reprint: false, cashier_name: null };
    const rejected = buildCreditNoteDoc({ ...base, fiscal: REJECTED }, ctx());
    expect(texts(rejected)).toContain('FISCAL NUMBER NOT ISSUED');
    expect(joined(rejected)).not.toContain('PENDING');
    const ok = buildCreditNoteDoc({ ...base, fiscal: acked('C55') }, ctx());
    expect(texts(ok)).toContain(row('PRA invoice no.', 'C55'));
    expect(qrBlocks(ok)).toEqual([{ qr: 'https://verify.test/inv?n=C55' }]);
    expect(() => buildCreditNoteDoc({ ...base, fiscal: NOT_REQUIRED }, ctx())).toThrow(RangeError);
  });
});

describe('[05 4b] QR block (row P-3; B21, §6.22, A3, R-26)', () => {
  it('[05 #61 QR half] acked: the fiscal number line, then the QR block from the snapshot template; no size (the printer decides, R-26)', () => {
    for (const is_reprint of [false, true]) {
      const doc = buildReceiptDoc(receiptInput({ invoice: qrSale(TEMPLATE), fiscal: acked('FN-000777'), is_reprint }), ctx());
      const at = doc.blocks.findIndex((b) => 'qr' in b);
      expect(doc.blocks[at]).toEqual({ qr: 'https://verify.test/inv?n=FN-000777' });
      expect(doc.blocks[at - 1]).toEqual({ text: row('PRA invoice no.', 'FN-000777'), bold: true });
      expect(qrBlocks(doc)).toHaveLength(1);
      expect(joined(doc)).not.toMatch(/PENDING|NOT ISSUED/);
    }
  });

  it('[05 #61 QR half] the answer\'s own qr_payload wins over the template (Appendix P: "unless the answer carries its own payload")', () => {
    const doc = buildReceiptDoc(receiptInput({ invoice: qrSale(TEMPLATE), fiscal: acked('FN-1', 'AUTH-QR-PAYLOAD-1') }), ctx());
    expect(qrBlocks(doc)).toEqual([{ qr: 'AUTH-QR-PAYLOAD-1' }]);
    // and with no template at all
    const noTemplate = buildReceiptDoc(receiptInput({ invoice: qrSale(null), fiscal: acked('FN-1', 'AUTH-QR-PAYLOAD-1') }), ctx());
    expect(qrBlocks(noTemplate)).toEqual([{ qr: 'AUTH-QR-PAYLOAD-1' }]);
  });

  it('[05 #61 QR half] no QR when the snapshot does not ask (show_qr false), or asks with neither template nor payload; the number still prints', () => {
    const off = buildReceiptDoc(receiptInput({ invoice: qrSale(TEMPLATE, false), fiscal: acked('FN-1', 'AUTH-QR') }), ctx());
    expect(qrBlocks(off)).toEqual([]);
    expect(texts(off)).toContain(row('PRA invoice no.', 'FN-1'));
    const nothing = buildReceiptDoc(receiptInput({ invoice: qrSale(null), fiscal: acked('FN-1') }), ctx());
    expect(qrBlocks(nothing)).toEqual([]);
    expect(texts(nothing)).toContain(row('PRA invoice no.', 'FN-1'));
  });

  it('[05 #61 QR half, H9-6] the template is the invoice snapshot\'s; every {fiscal_number} is replaced', () => {
    const doc = buildReceiptDoc(receiptInput({ invoice: qrSale('https://a.test/{fiscal_number}?again={fiscal_number}'), fiscal: acked('N9') }), ctx());
    expect(qrBlocks(doc)).toEqual([{ qr: 'https://a.test/N9?again=N9' }]);
  });

  it('[05 row P-3] the 400 limit counts code points: 400 kept (also 400 astral characters), 401 → no QR block, the number line stays', () => {
    const astral = '\u{1F600}'.repeat(400); // 800 UTF-16 units, 400 code points
    expect(qrBlocks(buildReceiptDoc(receiptInput({ invoice: qrSale(null), fiscal: acked('N9', 'a'.repeat(400)) }), ctx()))).toHaveLength(1);
    expect(qrBlocks(buildReceiptDoc(receiptInput({ invoice: qrSale(null), fiscal: acked('N9', astral) }), ctx()))).toHaveLength(1);
    const over = buildReceiptDoc(receiptInput({ invoice: qrSale(null), fiscal: acked('N9', 'a'.repeat(401)) }), ctx());
    expect(qrBlocks(over)).toEqual([]);
    expect(texts(over)).toContain(row('PRA invoice no.', 'N9'));
    // an empty payload is no QR either (03c's encoder refuses it)
    expect(qrBlocks(buildReceiptDoc(receiptInput({ invoice: qrSale(null), fiscal: acked('N9', '') }), ctx()))).toEqual([]);
  });

  it('[05 #61 QR half, row P-3] renderText at 48 columns: rule, number line, `[QR] <payload>` on one line', () => {
    const doc = buildReceiptDoc(receiptInput({ invoice: qrSale(TEMPLATE), fiscal: acked('FN-000777') }), ctx(48));
    const out = renderText(doc, 48).split('\n');
    const at = out.indexOf(row('PRA invoice no.', 'FN-000777', 48));
    expect(out.slice(at - 1, at + 2)).toEqual(['-'.repeat(48), row('PRA invoice no.', 'FN-000777', 48), '[QR] https://verify.test/inv?n=FN-000777']);
  });

  it('[05 #61 QR half, row P-3] renderText at 32 columns: the `[QR] <payload>` line wraps at 32, the long word broken', () => {
    const doc = buildReceiptDoc(receiptInput({ invoice: qrSale(TEMPLATE), fiscal: acked('FN-000777') }), ctx(32));
    const out = renderText(doc, 48).split('\n'); // doc.width_cols (32) wins
    const qrLine = '[QR] https://verify.test/inv?n=FN-000777';
    const at = out.indexOf(row('PRA invoice no.', 'FN-000777', 32));
    expect(out.slice(at - 1, at + 3)).toEqual(['-'.repeat(32), row('PRA invoice no.', 'FN-000777', 32), qrLine.slice(0, 32), qrLine.slice(32)]);
    for (const l of out) expect(l.length).toBeLessThanOrEqual(32);
  });

  it('[05 B17] the check bill never carries a QR or a fill block', () => {
    const doc = buildCheckBillDoc(
      {
        identifier: 'T7',
        printed_at: ISSUED_AT,
        lines: [],
        subtotal_minor: 0,
        discount_minor: 0,
        service_charge_minor: 0,
        taxes: [],
        rounding_minor: 0,
        cash_total_minor: 0,
        digital_total_minor: null,
        prices_include_tax: false,
        service_charge_taxes: [],
      },
      ctx(),
    );
    expect(doc.blocks.some((b) => 'qr' in b || 'fill' in b)).toBe(false);
  });
});

describe('[05 4b] buyer fill block (row P-5; B19, §6.12 step 7, §6.22)', () => {
  // An obviously fake ID, used only in this file; the scan below proves no Doc / preview carries it.
  const FULL_ID = '9999900001234';
  const buyerOn = (on: boolean) =>
    sale({ fiscal: snapshot({ adapter_key: TEST_ADAPTER, pos_id: 'P1', required: true, receipt: { ...snapshot().receipt, buyer_id_on_receipt: on } }) });

  /** Every place a Doc could carry the ID to: the stored JSON (print_jobs.payload's doc) and both previews. */
  const leaksOf = (secret: string, doc: Doc): string[] =>
    [
      ['Doc JSON', JSON.stringify(doc)],
      ['renderText 48', renderText(doc, 48)],
      ['renderText 32', renderText(doc, 32)],
    ]
      .filter(([, text]) => text!.includes(secret))
      .map(([place]) => place!);

  it('[05 row P-5, B19] the receipt carries { fill: "buyer_id", ref: invoice_id, last4 } when the snapshot prints the buyer ID; renderText prints last4', () => {
    const doc = buildReceiptDoc(receiptInput({ invoice: buyerOn(true), fiscal: PENDING, buyer: { type_label: 'CNIC', last4: '1234' } }), ctx());
    const fills = doc.blocks.filter((b) => 'fill' in b);
    expect(fills).toEqual([{ fill: 'buyer_id', ref: 'inv1', last4: 'CNIC: ****1234' }]);
    // right after the invoice number line, before the item lines
    const at = doc.blocks.findIndex((b) => 'fill' in b);
    expect(doc.blocks[at - 1]).toEqual({ text: row('Invoice', 'AC1S000123'), bold: true });
    expect(renderText(doc, 48).split('\n')).toContain('CNIC: ****1234');
  });

  it('[05 B19] the full ID never enters the Doc: a full value passed as last4 is cut to its last 4 (scan: Doc JSON, renderText 48 / 32)', () => {
    for (const is_reprint of [false, true]) {
      const doc = buildReceiptDoc(
        receiptInput({ invoice: buyerOn(true), fiscal: PENDING, is_reprint, buyer: { type_label: 'CNIC', last4: FULL_ID } }),
        ctx(),
      );
      expect(doc.blocks.filter((b) => 'fill' in b)).toEqual([{ fill: 'buyer_id', ref: 'inv1', last4: 'CNIC: ****1234' }]);
      expect(leaksOf('1234', doc).length).toBeGreaterThan(0); // the scan is live
      expect(leaksOf(FULL_ID, doc)).toEqual([]);
      expect(leaksOf(FULL_ID.slice(0, 9), doc)).toEqual([]);
    }
  });

  it('[05 §6.12 step 7] no fill block when the snapshot does not print the buyer ID, or the invoice has no buyer', () => {
    const off = buildReceiptDoc(receiptInput({ invoice: buyerOn(false), fiscal: PENDING, buyer: { type_label: 'CNIC', last4: '1234' } }), ctx());
    expect(off.blocks.some((b) => 'fill' in b)).toBe(false);
    expect(joined(off)).not.toContain('****');
    const none = buildReceiptDoc(receiptInput({ invoice: buyerOn(true), fiscal: PENDING, buyer: null }), ctx());
    expect(none.blocks.some((b) => 'fill' in b)).toBe(false);
  });

  it('[05 Q-3] the credit note keeps the last 4 as plain text, never a fill block', () => {
    const invoice = { ...buyerOn(true), series: 'credit' as const, invoice_id: 'cr1', invoice_ref: 'AC1C000007', ref_invoice_id: 'inv1', ref_invoice_ref: 'AC1S000123' };
    const doc = buildCreditNoteDoc({ invoice, buyer_id: { type_label: 'CNIC', last4: FULL_ID }, fiscal: PENDING, is_reprint: false, cashier_name: null }, ctx());
    expect(doc.blocks.some((b) => 'fill' in b)).toBe(false);
    expect(leaksOf(FULL_ID, doc)).toEqual([]);
  });
});

describe('[05 4b] inclusive prices: the memo tax block (G-24)', () => {
  // PK-PB's profile with prices including tax, a discount share on one line and a 10 % service charge taxed under the
  // same profile; no payment → cash class (16 %). The invoice is mapped from computeSplit + spreadLineTaxes as task 17 does.
  const rules = { ...PK_PB_RULES, prices_include_tax: true };
  const splitLines: ComputeSplitLine[] = [
    { ...billLine('oi1', 116_000, 'restaurant'), discount_minor: 1_160 },
    { ...billLine('oi2', 58_050, 'restaurant', { units: 3, unit_price_minor: 19_350 }), discount_minor: 0 },
  ];
  const input: ComputeSplitInput = {
    split_no: 1,
    business_date: TODAY,
    rules,
    // PK-PB's rates under a short label, so every printed row fits one 48-column line
    tax_profiles: [{ ...pkPbProfile(), taxes: [{ ...pkPbProfile().taxes[0]!, label: 'PST' }] }],
    lines: splitLines,
    service_charge: { rate_bp: 1000, removed: false, tax_profile_id: 'restaurant' },
    payments: [],
  };
  const split = computeSplit(input);
  const spread = spreadLineTaxes(input);
  const t = split.totals.as_paid;
  const inclusive = sale({
    prices_include_tax: true,
    lines: splitLines.map((l, i) => ({
      order_item_id: l.order_item_id,
      item_id: l.order_item_id,
      name: `Item ${i + 1}`,
      units: l.units,
      unit_price_minor: l.unit_price_minor,
      base_minor: l.base_minor,
      discount_minor: l.discount_minor,
      tax_profile_id: l.tax_profile_id,
      fiscal_category: 'restaurant_service',
      taxes: spread.lines[i]!.taxes,
    })),
    service_charge: spread.service_charge,
    subtotal_minor: t.subtotal_minor,
    discount_minor: t.discount_minor,
    taxes: t.taxes,
    rounding_minor: t.rounding_minor,
    total_minor: t.total_minor,
  });
  const amount = (text: string): number => Math.round(Number(text.trim().split(/\s+/).pop()!.replace(/,/g, '')) * 100);

  it('[05 P0.G G-24] the printed lines add up: subtotal − discount + charge + the charge\'s taxes + rounding = TOTAL; the memo holds the included tax', () => {
    expect(t.service_charge_minor).toBeGreaterThan(0);
    expect(spread.service_charge!.taxes[0]!.tax_minor).toBeGreaterThan(0);
    const out = texts(buildReceiptDoc(receiptInput({ invoice: inclusive }), ctx()));
    const get = (prefix: string) => out.filter((l) => l.startsWith(prefix));
    const total = amount(get('TOTAL PKR')[0]!);
    const tot = out.indexOf(get('TOTAL PKR')[0]!);
    const above = out.slice(0, tot);
    const sum =
      amount(above.find((l) => l.startsWith('Subtotal'))!) +
      amount(above.find((l) => l.startsWith('Discount'))!) +
      amount(above.find((l) => l.startsWith('Service charge '))!) +
      above.filter((l) => l.includes('on service charge')).reduce((a, l) => a + amount(l), 0) +
      above.filter((l) => l.startsWith('Rounding')).reduce((a, l) => a + amount(l), 0);
    expect(sum).toBe(total);
    expect(total).toBe(t.total_minor);
    // no full tax row above TOTAL (it is inside the menu prices); the memo below TOTAL holds the lines' part
    expect(above.some((l) => /^PST 16% cash\s+[\d,.]+$/.test(l))).toBe(false);
    const memoAt = out.indexOf('Tax included in prices');
    expect(memoAt).toBeGreaterThan(tot);
    const memo = out.slice(memoAt + 1).filter((l) => l.startsWith('  PST 16% cash'));
    expect(memo).toHaveLength(1);
    const scTax = spread.service_charge!.taxes.reduce((a, x) => a + x.tax_minor, 0);
    // memo + the charge's taxes = the invoice's tax rows (Σ printed tax = Σ invoice tax rows, §3.5 (8))
    expect(amount(memo[0]!) + scTax).toBe(t.taxes.reduce((a, x) => a + x.tax_minor, 0));
  });

  it('[05 P0.G G-24] exclusive prices are unchanged: full tax rows above TOTAL, no memo block', () => {
    const out = texts(buildReceiptDoc(receiptInput(), ctx()));
    expect(out).not.toContain('Tax included in prices');
    expect(out).toContain(row('PST 5% card', '285.50'));
  });

  it('[05 P0.G G-24] the check bill too: inclusive → the charge\'s taxes above the total, the rest as a memo', () => {
    const scRows = spread.service_charge!.taxes.map((x) => ({ label: 'PST', rate_bp: x.rate_bp, payment_class: x.payment_class, tax_minor: x.tax_minor }));
    const doc = buildCheckBillDoc(
      {
        identifier: 'T7',
        printed_at: ISSUED_AT,
        lines: [],
        subtotal_minor: t.subtotal_minor,
        discount_minor: t.discount_minor,
        service_charge_minor: t.service_charge_minor,
        taxes: t.taxes.map((x) => ({ label: x.label, rate_bp: x.rate_bp, payment_class: x.payment_class, tax_minor: x.tax_minor })),
        rounding_minor: t.rounding_minor,
        cash_total_minor: t.total_minor,
        digital_total_minor: null,
        prices_include_tax: true,
        service_charge_taxes: scRows,
      },
      ctx(),
    );
    const out = texts(doc);
    const tot = out.findIndex((l) => l.startsWith('Total if paid in cash'));
    const above = out.slice(0, tot);
    const sum =
      amount(above.find((l) => l.startsWith('Subtotal'))!) +
      amount(above.find((l) => l.startsWith('Discount'))!) +
      amount(above.find((l) => l.startsWith('Service charge '))!) +
      above.filter((l) => l.includes('on service charge')).reduce((a, l) => a + amount(l), 0) +
      above.filter((l) => l.startsWith('Rounding')).reduce((a, l) => a + amount(l), 0);
    expect(sum).toBe(amount(out[tot]!));
    expect(out.indexOf('Tax included in prices')).toBeGreaterThan(tot);
  });
});

describe('[05 4b] check bill digital line from totals_default_digital (G-25, P0.19d)', () => {
  it('[05 P0.G G-25] computeBill → the slip: cash 6,624.00 from totals_default, card 5,996.00 from totals_default_digital', () => {
    const r = computeBill({
      business_date: TODAY,
      rules: PK_PB_RULES,
      tax_profiles: [pkPbProfile()],
      lines: [billLine('L1', 571_000, 'restaurant')],
      discount: null,
      service_charge: null,
      plan: { mode: 'none', split_no: 1 },
      payments: [],
    });
    const c = r.totals_default;
    const doc = buildCheckBillDoc(
      {
        identifier: 'T7',
        printed_at: ISSUED_AT,
        lines: [{ name: 'Food', units: 1, unit_price_minor: 571_000, amount_minor: 571_000 }],
        subtotal_minor: c.subtotal_minor,
        discount_minor: c.discount_minor,
        service_charge_minor: c.service_charge_minor,
        taxes: c.taxes.map((x) => ({ label: 'PST', rate_bp: x.rate_bp, payment_class: x.payment_class, tax_minor: x.tax_minor })),
        rounding_minor: c.rounding_minor,
        cash_total_minor: c.total_minor,
        digital_total_minor: r.totals_default_digital.total_minor,
        prices_include_tax: false,
        service_charge_taxes: [],
      },
      ctx(),
    );
    expect(texts(doc)).toContain(row('Total if paid in cash', '6,624.00'));
    expect(texts(doc)).toContain(row('Total if paid by card', '5,996.00'));
  });
});
