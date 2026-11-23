import { describe, expect, expectTypeOf, it } from 'vitest';
import * as domain from '../index.js';
import type {
  FiscalCapabilities,
  FiscalCreditInvoiceFields,
  FiscalInvoiceFields,
  FiscalInvoiceLine,
  FiscalLineTax,
  FiscalReceiptSnapshot,
  FiscalSaleInvoiceFields,
  FiscalServiceCharge,
  FiscalSnapshot,
  FiscalInvoiceTax,
} from './fiscal-snapshot.js';
import { isFiscalized } from './fiscal-snapshot.js';

// Keys that would carry a buyer ID, a secret or free text. None may exist on the snapshot or on the
// invoice fields the neutral submission reads (05 §6.29 "no buyer tax ID, ever"; B19, B22; §6.29 "no
// payload carries text").
type Forbidden =
  | 'buyer'
  | 'buyer_name'
  | 'tax_id'
  | 'buyer_tax_id'
  | 'id_number'
  | 'token'
  | 'credentials'
  | 'note'
  | 'notes'
  | 'reference'
  | 'paid_to'
  | 'phone'
  | 'mobile'
  | 'pin'
  | 'password'
  | 'api_key'
  | 'buyer_id'
  | 'cnic'
  | 'ntn'
  | 'customer'
  | 'customer_name'
  | 'staff_name'
  | 'taken_by_name'
  | 'text';

type Keys<T> = T extends unknown ? keyof T : never;

const sampleSnapshot = {
  adapter_key: 'PRA',
  pos_id: 'POS-1',
  required: true,
  capabilities: { ordering: 'strict_per_pos_id', credit: true },
  credit_support: 'credit_invoice',
  rounding: { step_minor: 100, mode: 'nearest', applies_to: 'all' },
  receipt: {
    fiscal_number_label: 'PRA invoice no.',
    tax_reg_labels: [{ code: 'NTN', label: 'NTN' }],
    show_qr: true,
    qr_url_template: 'https://example.test/verify/{fiscal_number}',
    buyer_id_on_receipt: true,
  },
  seller_registrations: [{ code: 'NTN', number: '1234567' }],
  payment_codes: [{ payment_id: 'P1', authority_code: '1' }],
} satisfies FiscalSnapshot;

describe('[05 task 5a] invoice fiscal snapshot types', () => {
  it('[05 §6.12 step 6, H9-6] the fiscal snapshot has exactly the §6.12 keys', () => {
    expectTypeOf<keyof FiscalSnapshot>().toEqualTypeOf<
      | 'adapter_key'
      | 'pos_id'
      | 'required'
      | 'capabilities'
      | 'credit_support'
      | 'rounding'
      | 'receipt'
      | 'seller_registrations'
      | 'payment_codes'
    >();
    // A PRA-shaped snapshot (Appendix P seed values) satisfies the type as written.
    expectTypeOf(sampleSnapshot).toMatchTypeOf<FiscalSnapshot>();
  });

  it('[05 §6.12 step 6, §3.15, H16-2] field types follow §3.15 and §4.4', () => {
    expectTypeOf<FiscalSnapshot['adapter_key']>().toEqualTypeOf<string>();
    expectTypeOf<FiscalSnapshot['pos_id']>().toEqualTypeOf<string | null>();
    expectTypeOf<FiscalSnapshot['required']>().toEqualTypeOf<boolean>();
    expectTypeOf<FiscalCapabilities>().toEqualTypeOf<FiscalSnapshot['capabilities']>();
    expectTypeOf<FiscalSnapshot['capabilities']>().toEqualTypeOf<{
      ordering: 'strict_per_pos_id' | 'none';
      credit: boolean;
    }>();
    expectTypeOf<FiscalSnapshot['credit_support']>().toEqualTypeOf<'credit_invoice' | 'none'>();
    expectTypeOf<FiscalSnapshot['rounding']>().toEqualTypeOf<{
      step_minor: number | null;
      mode: 'nearest' | 'down' | 'up';
      applies_to: 'all' | 'cash';
    }>();
    expectTypeOf<FiscalSnapshot['seller_registrations']>().toEqualTypeOf<
      { code: string; number: string }[]
    >();
    expectTypeOf<FiscalSnapshot['payment_codes']>().toEqualTypeOf<
      { payment_id: string; authority_code: string | null }[]
    >();
  });

  it('[05 §6.12 step 6, A-1 receipt_fiscal, H9-5] receipt holds labels, QR template and buyer-on-receipt only', () => {
    expectTypeOf<keyof FiscalReceiptSnapshot>().toEqualTypeOf<
      | 'fiscal_number_label'
      | 'tax_reg_labels'
      | 'show_qr'
      | 'qr_url_template'
      | 'buyer_id_on_receipt'
    >();
    expectTypeOf<FiscalReceiptSnapshot['fiscal_number_label']>().toEqualTypeOf<string | null>();
    expectTypeOf<FiscalReceiptSnapshot['tax_reg_labels']>().toEqualTypeOf<
      { code: string; label: string }[]
    >();
    expectTypeOf<FiscalReceiptSnapshot['show_qr']>().toEqualTypeOf<boolean>();
    expectTypeOf<FiscalReceiptSnapshot['qr_url_template']>().toEqualTypeOf<string | null>();
    expectTypeOf<FiscalReceiptSnapshot['buyer_id_on_receipt']>().toEqualTypeOf<boolean>();
  });

  it('[05 §6.29, B19] no free-text, secret or buyer-ID field exists on the snapshot', () => {
    expectTypeOf<Extract<Keys<FiscalSnapshot>, Forbidden>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<Keys<FiscalReceiptSnapshot>, Forbidden>>().toEqualTypeOf<never>();
    expectTypeOf<
      Extract<Keys<FiscalSnapshot['payment_codes'][number]>, Forbidden>
    >().toEqualTypeOf<never>();
    expectTypeOf<
      Extract<Keys<FiscalSnapshot['seller_registrations'][number]>, Forbidden>
    >().toEqualTypeOf<never>();
  });

  it('[05 §6.12 step 6, §3.15] the invoice fields the neutral submission reads', () => {
    expectTypeOf<keyof FiscalSaleInvoiceFields>().toEqualTypeOf<
      | 'invoice_id'
      | 'series'
      | 'invoice_ref'
      | 'issued_at'
      | 'order_type'
      | 'jurisdiction_id'
      | 'currency_code'
      | 'prices_include_tax'
      | 'lines'
      | 'service_charge'
      | 'subtotal_minor'
      | 'discount_minor'
      | 'taxes'
      | 'rounding_minor'
      | 'total_minor'
      | 'payment_ids'
      | 'buyer_id_refused'
      | 'fiscal'
    >();
    expectTypeOf<Omit<FiscalSaleInvoiceFields, 'series'>>().toEqualTypeOf<{
      invoice_id: string;
      invoice_ref: string;
      issued_at: number;
      order_type: string;
      jurisdiction_id: string;
      currency_code: string;
      prices_include_tax: boolean;
      lines: FiscalInvoiceLine[];
      service_charge: FiscalServiceCharge | null;
      subtotal_minor: number;
      discount_minor: number;
      taxes: FiscalInvoiceTax[];
      rounding_minor: number;
      total_minor: number;
      payment_ids: string[];
      buyer_id_refused: boolean;
      fiscal: FiscalSnapshot;
    }>();
    expectTypeOf<FiscalSaleInvoiceFields['series']>().toEqualTypeOf<'sale'>();
    expectTypeOf<FiscalSaleInvoiceFields['fiscal']>().toEqualTypeOf<FiscalSnapshot>();
    expectTypeOf<FiscalSaleInvoiceFields['service_charge']>().toEqualTypeOf<FiscalServiceCharge | null>();
    expectTypeOf<FiscalInvoiceLine>().toEqualTypeOf<{
      order_item_id: string;
      item_id: string | null;
      name: string;
      units: number;
      unit_price_minor: number;
      base_minor: number;
      discount_minor: number;
      tax_profile_id: string | null;
      fiscal_category: string | null;
      taxes: FiscalLineTax[];
      part_of?: string; // ⚠️ 05 v1.0.33 §6.29 (STAB-5): a split line's part
    }>();
    expectTypeOf<FiscalLineTax>().toEqualTypeOf<{
      tax_code: string;
      payment_class: 'cash' | 'digital';
      rate_bp: number;
      base_minor: number;
      tax_minor: number;
    }>();
    expectTypeOf<FiscalServiceCharge>().toEqualTypeOf<{
      amount_minor: number;
      tax_profile_id: string | null;
      taxes: FiscalLineTax[];
    }>();
    expectTypeOf<FiscalInvoiceTax>().toEqualTypeOf<{
      tax_profile_id: string;
      tax_code: string;
      label: string;
      seq: number;
      compound: boolean;
      payment_class: 'cash' | 'digital';
      rate_bp: number;
      base_minor: number;
      tax_minor: number;
      rate_ref: string | null;
    }>();
  });

  it('[05 §6.13, H6-8] a credit carries its original reference; sale and credit form one union', () => {
    expectTypeOf<FiscalCreditInvoiceFields['series']>().toEqualTypeOf<'credit'>();
    expectTypeOf<
      Omit<FiscalCreditInvoiceFields, 'series' | 'ref_invoice_id' | 'ref_invoice_ref'>
    >().toEqualTypeOf<Omit<FiscalSaleInvoiceFields, 'series'>>();
    expectTypeOf<FiscalCreditInvoiceFields['ref_invoice_id']>().toEqualTypeOf<string>();
    expectTypeOf<FiscalCreditInvoiceFields['ref_invoice_ref']>().toEqualTypeOf<string>();
    expectTypeOf<FiscalInvoiceFields>().toEqualTypeOf<
      FiscalSaleInvoiceFields | FiscalCreditInvoiceFields
    >();
    expectTypeOf<Exclude<keyof FiscalCreditInvoiceFields, keyof FiscalSaleInvoiceFields>>().toEqualTypeOf<
      'ref_invoice_id' | 'ref_invoice_ref'
    >();
  });

  it('[05 §6.29, B19] no free-text, secret or buyer-ID field exists on the invoice fields', () => {
    expectTypeOf<Extract<Keys<FiscalInvoiceFields>, Forbidden>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<Keys<FiscalInvoiceLine>, Forbidden>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<Keys<FiscalServiceCharge>, Forbidden>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<Keys<FiscalInvoiceTax>, Forbidden>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<Keys<FiscalLineTax>, Forbidden>>().toEqualTypeOf<never>();
  });

  it('[05 task 5a] exported from @pos/domain', () => {
    expectTypeOf<domain.FiscalSnapshot>().toEqualTypeOf<FiscalSnapshot>();
    expectTypeOf<domain.FiscalInvoiceFields>().toEqualTypeOf<FiscalInvoiceFields>();
  });
});

describe('[05 P0.19a] isFiscalized (§3.1 "Fiscalized", §3.15, R-8 / G-1)', () => {
  it('[05 §3.1, R-8] fiscalized iff required && adapter_key !== none (truth table)', () => {
    const cases: [boolean, string, boolean][] = [
      [true, 'TEST', true],
      [false, 'TEST', false],
      [true, 'none', false],
      [false, 'none', false],
    ];
    for (const [required, adapter_key, want] of cases) {
      expect(isFiscalized({ ...sampleSnapshot, required, adapter_key }), `${String(required)} × ${adapter_key}`).toBe(want);
    }
  });

  it('[05 P0.19a] exported from @pos/domain', () => {
    expect(typeof domain.isFiscalized).toBe('function');
    expect(domain.isFiscalized).toBe(isFiscalized);
  });
});
