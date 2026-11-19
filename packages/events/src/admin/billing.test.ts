import { describe, expect, it } from 'vitest';
import {
  BillingSettings,
  billingSettingsConfigIssue,
  billingSettingsDocument,
  FISCAL_ADAPTER_SETTINGS_SCHEMAS,
  putBillingSettingsBody,
  roundingStepMaxMinor,
} from './billing.js';
import { NoneAdapterSettings } from './fiscal-adapters/none.js';
import { PraAdapterSettings } from './fiscal-adapters/pra.js';

// 05 §4.5 rows A-1 (3) and A-2: the billing settings document's wire shape. Shape and bounds refuse at parse
// (400 VALIDATION_FAILED, C6 duplicates at <list>.N.<key>); the rules A-2 maps to 422 CONFIG_REFERENCE_INVALID
// are returned by billingSettingsConfigIssue for the cloud service to throw (P0.9b).

type Doc = Record<string, unknown> & { fiscal: Record<string, unknown>; receipt: Record<string, unknown> };

function doc(): Doc {
  return {
    jurisdiction_id: 'PK',
    payment_modes: [
      {
        mode_id: 'cash',
        name: 'Cash',
        kind: 'cash',
        payment_class: 'cash',
        reference_required: false,
        is_active: true,
        sort_order: 0,
        authority_codes: [{ adapter_key: 'PRA', code: '1' }],
      },
      {
        mode_id: 'card',
        name: 'Card',
        kind: 'card',
        payment_class: 'digital',
        reference_required: true,
        is_active: true,
        sort_order: 1,
        authority_codes: [{ adapter_key: 'PRA', code: '2' }],
      },
    ],
    service_charge_bp: { dine_in: 0, takeaway: 0, parking: 0, delivery: 0 },
    service_charge_tax_profile_id: null,
    discount_reasons: [{ code: 'regular_customer', label: 'Regular customer' }],
    max_discount_pct: 100,
    variance_threshold_minor: 10_000,
    petty_cash_limit_minor: 500_000,
    petty_categories: [{ category_id: 'pc1', name: 'Vegetables', is_active: true }],
    open_bill_flag_minutes: 240,
    receipt: {
      header_lines: ['Arif Chatkhara'],
      footer_lines: ['Thank you'],
      show: { tax_reg_no: true, address: true, phone: true, cashier: true, order_no: true, bill_no: true },
      tax_registrations: [{ code: 'NTN', number: '1234567' }],
      address: 'Lake City, Lahore',
      phone: '042-0000000',
      invoice_prefix: 'AC1',
    },
    fiscal: {
      environment: 'sandbox',
      pos_ids: [{ pos_id: 'P1', label: 'Counter' }],
      default_pos_id: 'P1',
      device_pos_ids: [{ device_id: 'd1', pos_id: 'P1' }],
      integration_status: 'integrated',
      fiscalize_by_order_type: { dine_in: true, takeaway: true, parking: true, delivery: false },
      stuck_after_ms: 1_800_000,
      switched_at: null,
      adapter_settings: {},
    },
    rate_overrides: [],
  };
}

const PKR = billingSettingsDocument(2);

function issuePaths(result: { success: boolean; error?: { issues: ReadonlyArray<{ path: PropertyKey[] }> } }) {
  expect(result.success).toBe(false);
  return (result.error?.issues ?? []).map((issue) => issue.path.join('.'));
}

describe('billing settings document — shape', () => {
  it('[05 row A-2] accepts a full document', () => {
    expect(PKR.safeParse(doc()).success).toBe(true);
  });

  it('[05 row A-1 (3)] the owner overrides are optional and accepted when sent', () => {
    const body = { ...doc(), prices_include_tax: true, rounding_step_minor: 100, rounding_method: 'up', rounding_applies_to: 'cash' };
    expect(PKR.safeParse(body).success).toBe(true);
  });

  it('[05 row A-2 H16-10] no field carries a mixed_class_rule (it is jurisdiction data, higher_rate only)', () => {
    const parsed = PKR.parse({ ...doc(), mixed_class_rule: 'pro_rata' });
    expect(parsed).not.toHaveProperty('mixed_class_rule');
  });

  it('[05 row A-2] putBillingSettingsBody needs expected_version', () => {
    const body = putBillingSettingsBody(2);
    expect(body.safeParse(doc()).success).toBe(false);
    expect(body.safeParse({ ...doc(), expected_version: 'v1' }).success).toBe(true);
  });
});

describe('billing settings document — C6 keyed lists', () => {
  it('[05 row A-2 C6] payment_modes keyed by mode_id', () => {
    const d = doc();
    const modes = d.payment_modes as Array<Record<string, unknown>>;
    d.payment_modes = [...modes, { ...modes[1], mode_id: 'card2' }];
    expect(PKR.safeParse(d).success).toBe(true);
    d.payment_modes = [...modes, { ...modes[1] }];
    expect(issuePaths(PKR.safeParse(d))).toContain('payment_modes.2.mode_id');
  });

  it('[05 row A-2 C6] authority_codes keyed by adapter_key', () => {
    const d = doc();
    const modes = d.payment_modes as Array<Record<string, unknown>>;
    modes[0] = { ...modes[0], authority_codes: [{ adapter_key: 'PRA', code: '1' }, { adapter_key: 'SRB', code: '1' }] };
    expect(PKR.safeParse(d).success).toBe(true);
    modes[0] = { ...modes[0], authority_codes: [{ adapter_key: 'PRA', code: '1' }, { adapter_key: 'PRA', code: '5' }] };
    expect(issuePaths(PKR.safeParse(d))).toContain('payment_modes.0.authority_codes.1.adapter_key');
  });

  it('[05 row A-2 C6] discount_reasons keyed by code', () => {
    const d = doc();
    d.discount_reasons = [{ code: 'a', label: 'A' }, { code: 'b', label: 'B' }];
    expect(PKR.safeParse(d).success).toBe(true);
    d.discount_reasons = [{ code: 'a', label: 'A' }, { code: 'a', label: 'B' }];
    expect(issuePaths(PKR.safeParse(d))).toContain('discount_reasons.1.code');
  });

  it('[05 row A-2 C6] petty_categories keyed by category_id', () => {
    const d = doc();
    d.petty_categories = [{ category_id: 'x', name: 'X', is_active: true }, { category_id: 'y', name: 'Y', is_active: false }];
    expect(PKR.safeParse(d).success).toBe(true);
    d.petty_categories = [{ category_id: 'x', name: 'X', is_active: true }, { category_id: 'x', name: 'Y', is_active: false }];
    expect(issuePaths(PKR.safeParse(d))).toContain('petty_categories.1.category_id');
  });

  it('[05 row A-2 C6] fiscal.pos_ids keyed by pos_id', () => {
    const d = doc();
    d.fiscal.pos_ids = [{ pos_id: 'P1', label: 'A' }, { pos_id: 'P2', label: 'B' }];
    expect(PKR.safeParse(d).success).toBe(true);
    d.fiscal.pos_ids = [{ pos_id: 'P1', label: 'A' }, { pos_id: 'P1', label: 'B' }];
    expect(issuePaths(PKR.safeParse(d))).toContain('fiscal.pos_ids.1.pos_id');
  });

  it('[05 row A-2 C6] fiscal.device_pos_ids keyed by device_id', () => {
    const d = doc();
    d.fiscal.device_pos_ids = [{ device_id: 'd1', pos_id: 'P1' }, { device_id: 'd2', pos_id: 'P1' }];
    expect(PKR.safeParse(d).success).toBe(true);
    d.fiscal.device_pos_ids = [{ device_id: 'd1', pos_id: 'P1' }, { device_id: 'd1', pos_id: 'P2' }];
    expect(issuePaths(PKR.safeParse(d))).toContain('fiscal.device_pos_ids.1.device_id');
  });

  it('[05 row A-2 C6 H9-5] receipt.tax_registrations keyed by code', () => {
    const d = doc();
    d.receipt.tax_registrations = [{ code: 'NTN', number: '1' }, { code: 'STRN', number: '2' }];
    expect(PKR.safeParse(d).success).toBe(true);
    d.receipt.tax_registrations = [{ code: 'NTN', number: '1' }, { code: 'NTN', number: '2' }];
    expect(issuePaths(PKR.safeParse(d))).toContain('receipt.tax_registrations.1.code');
  });

  it('[05 row A-2] rate_overrides keyed by (tax_class_id, tax_code, payment_class, integration_status, effective_from)', () => {
    const d = doc();
    const row = {
      tax_class_id: 'tc1',
      tax_code: 'PST',
      payment_class: 'cash',
      integration_status: 'integrated',
      rate_bp: 1600,
      effective_from: '2026-02-19',
      notification_ref: null,
    };
    d.rate_overrides = [row, { ...row, effective_from: '2026-07-01' }, { ...row, payment_class: 'digital' }];
    expect(PKR.safeParse(d).success).toBe(true);
    d.rate_overrides = [row, { ...row, rate_bp: 500 }];
    expect(issuePaths(PKR.safeParse(d))).toContain('rate_overrides.1');
  });
});

describe('billing settings document — A-1 (3) bounds', () => {
  it('[05 row A-1 (3) H16-13] rounding_step_minor 1 … 10^(exponent + 4), by the exponent', () => {
    expect(roundingStepMaxMinor(0)).toBe(10_000);
    expect(roundingStepMaxMinor(2)).toBe(1_000_000);
    expect(roundingStepMaxMinor(3)).toBe(10_000_000);
    for (const [exponent, max] of [[0, 10_000], [2, 1_000_000], [3, 10_000_000]] as const) {
      const schema = billingSettingsDocument(exponent);
      expect(schema.safeParse({ ...doc(), rounding_step_minor: 1 }).success).toBe(true);
      expect(schema.safeParse({ ...doc(), rounding_step_minor: max }).success).toBe(true);
      expect(issuePaths(schema.safeParse({ ...doc(), rounding_step_minor: max + 1 }))).toContain('rounding_step_minor');
      expect(issuePaths(schema.safeParse({ ...doc(), rounding_step_minor: 0 }))).toContain('rounding_step_minor');
    }
    expect(billingSettingsDocument(0).safeParse({ ...doc(), rounding_step_minor: 1_000_000 }).success).toBe(false);
  });

  it('[05 row A-1 (3)] rounding_step_minor is an integer', () => {
    expect(issuePaths(PKR.safeParse({ ...doc(), rounding_step_minor: 1.5 }))).toContain('rounding_step_minor');
  });

  it('[05 row A-1 (3)] the exponent itself must be an integer 0 or more', () => {
    expect(() => billingSettingsDocument(-1)).toThrow();
    expect(() => billingSettingsDocument(1.5)).toThrow();
  });

  it('[05 row A-1 (3)] service_charge_bp per order type 0–3 000', () => {
    const d = doc();
    d.service_charge_bp = { dine_in: 3000, takeaway: 0, parking: 0, delivery: 0 };
    expect(PKR.safeParse(d).success).toBe(true);
    d.service_charge_bp = { dine_in: 3001, takeaway: 0, parking: 0, delivery: 0 };
    expect(issuePaths(PKR.safeParse(d))).toContain('service_charge_bp.dine_in');
    d.service_charge_bp = { dine_in: 0, takeaway: -1, parking: 0, delivery: 0 };
    expect(issuePaths(PKR.safeParse(d))).toContain('service_charge_bp.takeaway');
  });

  it('[05 row A-1 (3) K-12] header_lines and footer_lines: ≤ 6 lines of ≤ 48 chars', () => {
    const d = doc();
    d.receipt.header_lines = Array.from({ length: 6 }, () => 'x'.repeat(48));
    d.receipt.footer_lines = Array.from({ length: 6 }, () => 'y'.repeat(48));
    expect(PKR.safeParse(d).success).toBe(true);
    d.receipt.header_lines = Array.from({ length: 7 }, () => 'x');
    expect(issuePaths(PKR.safeParse(d))).toContain('receipt.header_lines');
    d.receipt.header_lines = ['x'.repeat(49)];
    expect(issuePaths(PKR.safeParse(d))).toContain('receipt.header_lines.0');
    d.receipt.header_lines = [];
    d.receipt.footer_lines = ['y'.repeat(49)];
    expect(issuePaths(PKR.safeParse(d))).toContain('receipt.footer_lines.0');
    d.receipt.footer_lines = Array.from({ length: 7 }, () => 'y');
    expect(issuePaths(PKR.safeParse(d))).toContain('receipt.footer_lines');
  });

  it('[05 row A-1 (3)] invoice_prefix ≤ 6', () => {
    const d = doc();
    d.receipt.invoice_prefix = 'ABCDEF';
    expect(PKR.safeParse(d).success).toBe(true);
    d.receipt.invoice_prefix = 'ABCDEFG';
    expect(issuePaths(PKR.safeParse(d))).toContain('receipt.invoice_prefix');
  });

  it('[05 row A-1 (3) H9-5] a registration number ≤ 30', () => {
    const d = doc();
    d.receipt.tax_registrations = [{ code: 'NTN', number: '1'.repeat(30) }];
    expect(PKR.safeParse(d).success).toBe(true);
    d.receipt.tax_registrations = [{ code: 'NTN', number: '1'.repeat(31) }];
    expect(issuePaths(PKR.safeParse(d))).toContain('receipt.tax_registrations.0.number');
  });

  it('[05 row A-1 (3) J-5] an authority code is 1–20 chars', () => {
    const d = doc();
    const modes = d.payment_modes as Array<Record<string, unknown>>;
    modes[0] = { ...modes[0], authority_codes: [{ adapter_key: 'PRA', code: '1'.repeat(20) }] };
    expect(PKR.safeParse(d).success).toBe(true);
    modes[0] = { ...modes[0], authority_codes: [{ adapter_key: 'PRA', code: '1'.repeat(21) }] };
    expect(issuePaths(PKR.safeParse(d))).toContain('payment_modes.0.authority_codes.0.code');
    modes[0] = { ...modes[0], authority_codes: [{ adapter_key: 'PRA', code: '' }] };
    expect(issuePaths(PKR.safeParse(d))).toContain('payment_modes.0.authority_codes.0.code');
  });

  it('[05 row A-1 (3) H9-4] adapter_settings ≤ 4 KB (UTF-8 JSON)', () => {
    const d = doc();
    // {"X":{"k":"…"}} is 14 bytes around the value
    d.fiscal.adapter_settings = { X: { k: 'a'.repeat(4096 - 14) } };
    expect(PKR.safeParse(d).success).toBe(true);
    d.fiscal.adapter_settings = { X: { k: 'a'.repeat(4096 - 13) } };
    expect(issuePaths(PKR.safeParse(d))).toContain('fiscal.adapter_settings');
    // multi-byte characters count as bytes, not chars
    d.fiscal.adapter_settings = { X: { k: 'é'.repeat(2100) } };
    expect(issuePaths(PKR.safeParse(d))).toContain('fiscal.adapter_settings');
  });

  it('[05 row A-1 (3) H10-6] fiscal.base_urls keyed by adapter_key, https:// only', () => {
    const d = doc();
    d.fiscal.base_urls = { PRA: { sandbox: 'https://ims.example.pk/sandbox', production: 'https://ims.example.pk/live' } };
    expect(PKR.safeParse(d).success).toBe(true);
    d.fiscal.base_urls = { PRA: { sandbox: 'http://ims.example.pk/sandbox' } };
    expect(issuePaths(PKR.safeParse(d))).toContain('fiscal.base_urls.PRA.sandbox');
    d.fiscal.base_urls = { PRA: { production: 'ftp://ims.example.pk/x' } };
    expect(issuePaths(PKR.safeParse(d))).toContain('fiscal.base_urls.PRA.production');
    d.fiscal.base_urls = { PRA: { production: 'not a url' } };
    expect(issuePaths(PKR.safeParse(d))).toContain('fiscal.base_urls.PRA.production');
  });

  it('[05 row A-1 (3) B22] the document has no secret field: fiscal refuses nothing it does not know, it drops it', () => {
    const d = doc();
    d.fiscal.token = 'test-token';
    const parsed = PKR.parse(d);
    expect(parsed.fiscal).not.toHaveProperty('token');
  });
});

describe('billing settings document — 422 CONFIG_REFERENCE_INVALID rules (A-2)', () => {
  it('[05 row A-2] a valid document has no issue', () => {
    expect(billingSettingsConfigIssue(BillingSettings.parse(doc()))).toBeNull();
  });

  it("[05 row A-2] kind 'cash' needs payment_class 'cash'", () => {
    const d = doc();
    const modes = d.payment_modes as Array<Record<string, unknown>>;
    modes[1] = { ...modes[1], kind: 'cash', payment_class: 'digital' };
    expect(billingSettingsConfigIssue(BillingSettings.parse(d))).toEqual({ field: 'payment_modes.1.payment_class' });
    modes[1] = { ...modes[1], kind: 'cash', payment_class: 'cash' };
    expect(billingSettingsConfigIssue(BillingSettings.parse(d))).toBeNull();
  });

  it('[05 row A-2] at least one active cash mode', () => {
    const d = doc();
    const modes = d.payment_modes as Array<Record<string, unknown>>;
    d.payment_modes = [{ ...modes[0], is_active: false }, modes[1]];
    expect(billingSettingsConfigIssue(BillingSettings.parse(d))).toEqual({ field: 'payment_modes' });
    d.payment_modes = [modes[1]];
    expect(billingSettingsConfigIssue(BillingSettings.parse(d))).toEqual({ field: 'payment_modes' });
    // a cash mode is a mode of kind 'cash' (A-2); a cash-class mode of another kind does not count
    d.payment_modes = [{ ...modes[1], mode_id: 'x', kind: 'other', payment_class: 'cash' }, modes[1]];
    expect(billingSettingsConfigIssue(BillingSettings.parse(d))).toEqual({ field: 'payment_modes' });
    d.payment_modes = [{ ...modes[0], is_active: false }, { ...modes[0], mode_id: 'cash2' }];
    expect(billingSettingsConfigIssue(BillingSettings.parse(d))).toBeNull();
  });

  it('[05 row A-2 H9-4] adapter_settings[key] is parsed by that key’s settingsSchema', () => {
    const d = doc();
    d.fiscal.adapter_settings = { PRA: {}, none: {} };
    expect(billingSettingsConfigIssue(BillingSettings.parse(d))).toBeNull();
    d.fiscal.adapter_settings = { PRA: { ntn: '1234567' } };
    expect(billingSettingsConfigIssue(BillingSettings.parse(d))).toEqual({
      field: 'fiscal.adapter_settings.PRA',
      reason: 'invalid',
    });
    d.fiscal.adapter_settings = { none: { x: 1 } };
    expect(billingSettingsConfigIssue(BillingSettings.parse(d))).toEqual({
      field: 'fiscal.adapter_settings.none',
      reason: 'invalid',
    });
  });

  it('[05 row A-2 H9-4] adapter_settings for a key with no settingsSchema is invalid', () => {
    const d = doc();
    d.fiscal.adapter_settings = { SRB: {} };
    expect(billingSettingsConfigIssue(BillingSettings.parse(d))).toEqual({
      field: 'fiscal.adapter_settings.SRB',
      reason: 'invalid',
    });
  });

  it('[05 row A-2 H9-4] the settings schemas are shared from fiscal-adapters/<key>.ts', () => {
    expect(FISCAL_ADAPTER_SETTINGS_SCHEMAS.none).toBe(NoneAdapterSettings);
    expect(FISCAL_ADAPTER_SETTINGS_SCHEMAS.PRA).toBe(PraAdapterSettings);
    expect(Object.keys(FISCAL_ADAPTER_SETTINGS_SCHEMAS).sort()).toEqual(['PRA', 'none']);
  });
});
