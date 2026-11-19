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

// 05 §3.16, B17, B21, B29, §6.26; §11 task 4a: pure Doc builders over 03c's Doc / DocBlock. They lay out the
// numbers they are given (no tax, rounding or due is computed here). Not in 4a: the QR block (row P-3) and the
// buyer-ID filler block (row P-5) — task 4b.

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

const card = { mode_name: 'Card', payment_class: 'digital', direction: 'in', amount_minor: 599_600 } as const;
const cash = (amount_minor: number) => ({ mode_name: 'Cash', payment_class: 'cash', direction: 'in', amount_minor }) as const;

const receiptInput = (over: Partial<Parameters<typeof buildReceiptDoc>[0]> = {}): Parameters<typeof buildReceiptDoc>[0] => ({
  invoice: sale(),
  payments: [card],
  change_minor: 0,
  cashier_name: 'Bilal',
  order_label: 'T7',
  bill_label: 'T7 split 1',
  fiscal_number: null,
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
    const pending = buildReceiptDoc(receiptInput({ invoice: fiscalized }), ctx());
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
    expect(joined(buildReceiptDoc(receiptInput({ invoice: noneRequired, fiscal_number: 'N9' }), ctx()))).not.toContain('N9');
    const noneCredit = { ...noneRequired, series: 'credit' as const, invoice_id: 'cr1', invoice_ref: 'AC1C000007', ref_invoice_id: 'inv1', ref_invoice_ref: 'AC1S000123' };
    expect(joined(buildCreditNoteDoc({ invoice: noneCredit, buyer_id: null, fiscal_number: null, is_reprint: false, cashier_name: null }, ctx()))).not.toContain('FISCAL');
    // A required snapshot under a real (test) adapter is fiscalized: PENDING until the answer.
    const testRequired = sale({ fiscal: snapshot({ adapter_key: TEST_ADAPTER, pos_id: 'P1', required: true }) });
    expect(texts(buildReceiptDoc(receiptInput({ invoice: testRequired }), ctx()))).toContain('FISCAL NUMBER PENDING');
    // Not required under a real adapter (fiscalize: false order type): no block.
    const testNotRequired = sale({ fiscal: snapshot({ adapter_key: TEST_ADAPTER, pos_id: 'P1', required: false }) });
    expect(joined(buildReceiptDoc(receiptInput({ invoice: testNotRequired }), ctx()))).not.toContain('FISCAL');
  });

  it('[05 #61 doc half] a reprint after the answer shows REPRINT and the fiscal number with its label; before it, PENDING', () => {
    const fiscalized = sale({
      fiscal: snapshot({ adapter_key: 'PRA', pos_id: 'P1', required: true, receipt: { ...snapshot().receipt, fiscal_number_label: 'PRA invoice no.' } }),
    });
    const before = buildReceiptDoc(receiptInput({ invoice: fiscalized, is_reprint: true }), ctx());
    expect(texts(before)).toContain('** REPRINT **');
    expect(texts(before)).toContain('FISCAL NUMBER PENDING');
    const after = buildReceiptDoc(receiptInput({ invoice: fiscalized, is_reprint: true, fiscal_number: '1234ABC' }), ctx());
    expect(lineWith(after, 'PRA invoice no.')).toContain('1234ABC');
    expect(joined(after)).not.toContain('PENDING');
    // no label in the snapshot → a neutral label
    const unlabelled = sale({ fiscal: snapshot({ adapter_key: TEST_ADAPTER, pos_id: 'P1', required: true }) });
    expect(lineWith(buildReceiptDoc(receiptInput({ invoice: unlabelled, fiscal_number: 'N9' }), ctx()), 'N9')).toBe(
      lineWith(buildReceiptDoc(receiptInput({ invoice: unlabelled, fiscal_number: 'N9' }), ctx()), 'Fiscal no.'),
    );
    // a fiscal number never prints on an invoice that is not fiscalized
    expect(joined(buildReceiptDoc(receiptInput({ fiscal_number: 'N9' }), ctx()))).not.toContain('N9');
  });

  it('[05 #61 doc half] no QR block in 4a even when the snapshot asks for one (row P-3 is 4b)', () => {
    const fiscalized = sale({ fiscal: snapshot({ adapter_key: TEST_ADAPTER, pos_id: 'P1', required: true, receipt: { ...snapshot().receipt, show_qr: true, qr_url_template: 'https://x/{fiscal_number}' } }) });
    const doc = buildReceiptDoc(receiptInput({ invoice: fiscalized, fiscal_number: 'N9' }), ctx());
    expect(doc.blocks.every((b) => 'text' in b || 'rule' in b || 'feed' in b || 'cut' in b || 'drawer' in b)).toBe(true);
    expect(joined(doc)).not.toContain('https://x/');
  });
});

describe('credit note', () => {
  function credit(over: Partial<FiscalCreditInvoiceFields> = {}): FiscalCreditInvoiceFields {
    return { ...sale(), series: 'credit', invoice_id: 'cr1', invoice_ref: 'AC1C000007', ref_invoice_id: 'inv1', ref_invoice_ref: 'AC1S000123', ...over };
  }

  it('[05 §3.16 Q-3] credit note: title, its number, the original, amounts, and the last 4 of a buyer ID only', () => {
    const doc = buildCreditNoteDoc(
      { invoice: credit(), buyer_id: { type_label: 'CNIC', last4: '4567' }, fiscal_number: null, is_reprint: false, cashier_name: null },
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
      { invoice: credit(), buyer_id: { type_label: 'CNIC', last4: '3520212345671' }, fiscal_number: null, is_reprint: false, cashier_name: null },
      ctx(),
    );
    expect(joined(doc)).not.toContain('352021234');
    expect(lineWith(doc, 'CNIC')).toBe('CNIC: ****5671');
  });

  it('[05 B21] fiscalized credit: PENDING before the answer, the number after; no buyer line without a buyer', () => {
    const invoice = credit({ fiscal: snapshot({ adapter_key: TEST_ADAPTER, pos_id: 'P1', required: true, receipt: { ...snapshot().receipt, fiscal_number_label: 'PRA invoice no.' } }) });
    const before = buildCreditNoteDoc({ invoice, buyer_id: null, fiscal_number: null, is_reprint: false, cashier_name: null }, ctx());
    expect(texts(before)).toContain('FISCAL NUMBER PENDING');
    const after = buildCreditNoteDoc({ invoice, buyer_id: null, fiscal_number: 'C55', is_reprint: true, cashier_name: null }, ctx());
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
