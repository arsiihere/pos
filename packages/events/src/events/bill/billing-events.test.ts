import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as builders from '../../../testing/index';
import { parseEvent } from '../../codecs';
import type { PosEvent } from '../../envelope';
import '../../index';
import { payloadSchema } from '../../registry';

// 05 §6.29: every 05 event, its stream and its builder (one fixture per event, F §6.7).
const EVENTS: { type: string; stream: PosEvent['stream_type']; build: () => PosEvent }[] = [
  { type: 'BillOpened', stream: 'bill', build: builders.aBillOpened },
  { type: 'ChargeApplied', stream: 'bill', build: builders.aChargeApplied },
  { type: 'ChargeRemoved', stream: 'bill', build: builders.aChargeRemoved },
  { type: 'CheckBillPrinted', stream: 'bill', build: builders.aCheckBillPrinted },
  { type: 'BillSplitsSet', stream: 'bill', build: builders.aBillSplitsSet },
  { type: 'DiscountFrozen', stream: 'bill', build: builders.aDiscountFrozen },
  { type: 'DiscountApplied', stream: 'bill', build: builders.aDiscountApplied },
  { type: 'DiscountRemoved', stream: 'bill', build: builders.aDiscountRemoved },
  { type: 'PaymentAdded', stream: 'bill', build: builders.aPaymentAdded },
  { type: 'PaymentRemoved', stream: 'bill', build: builders.aPaymentRemoved },
  { type: 'BuyerIdWaived', stream: 'bill', build: builders.aBuyerIdWaived },
  { type: 'InvoiceIssued', stream: 'bill', build: builders.anInvoiceIssued },
  { type: 'BillReopened', stream: 'bill', build: builders.aBillReopened },
  { type: 'InvoiceCredited', stream: 'bill', build: builders.anInvoiceCredited },
  { type: 'FiscalNumberAssigned', stream: 'bill', build: builders.aFiscalNumberAssigned },
  { type: 'FiscalSubmitRejected', stream: 'bill', build: builders.aFiscalSubmitRejected },
  { type: 'BillClosedEmpty', stream: 'bill', build: builders.aBillClosedEmpty },
  { type: 'ShiftOpened', stream: 'shift', build: builders.aShiftOpened },
  { type: 'ShiftCounted', stream: 'shift', build: builders.aShiftCounted },
  { type: 'ShiftCountSkipped', stream: 'shift', build: builders.aShiftCountSkipped },
  { type: 'HandoverCounted', stream: 'shift', build: builders.aHandoverCounted },
  { type: 'ShiftClosed', stream: 'shift', build: builders.aShiftClosed },
  { type: 'ShiftVarianceSignedOff', stream: 'shift', build: builders.aShiftVarianceSignedOff },
  { type: 'PettyCashAdvanced', stream: 'shift', build: builders.aPettyCashAdvanced },
  { type: 'PettyCashSettled', stream: 'shift', build: builders.aPettyCashSettled },
  { type: 'PettyCashOut', stream: 'shift', build: builders.aPettyCashOut },
  { type: 'PettyCashIn', stream: 'shift', build: builders.aPettyCashIn },
  { type: 'DrawerOpened', stream: 'shift', build: builders.aDrawerOpened },
  { type: 'ZReportIssued', stream: 'hub', build: builders.aZReportIssued },
  { type: 'FiscalTokenSet', stream: 'hub', build: builders.aFiscalTokenSet },
];

const FIXTURES = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const fixture = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as PosEvent;
const schema = (type: string) => payloadSchema(type, 1);
const payloadOf = (type: string) => EVENTS.find((e) => e.type === type)!.build().payload;

// Every object key of a schema, as a dotted path (arrays as `[]`), through nullable / optional wrappers.
function keyPaths(s: z.ZodType, prefix = ''): string[] {
  if (s instanceof z.ZodNullable || s instanceof z.ZodOptional) return keyPaths(s.unwrap() as z.ZodType, prefix);
  if (s instanceof z.ZodArray) return keyPaths(s.element as z.ZodType, `${prefix}[]`);
  if (s instanceof z.ZodUnion) return (s.options as z.ZodType[]).flatMap((o) => keyPaths(o, prefix));
  if (s instanceof z.ZodRecord) return keyPaths(s.valueType as z.ZodType, `${prefix}{}`);
  if (s instanceof z.ZodObject) {
    return Object.entries(s.shape as Record<string, z.ZodType>).flatMap(([k, v]) => {
      const path = prefix === '' ? k : `${prefix}.${k}`;
      return [path, ...keyPaths(v, path)];
    });
  }
  return [];
}

// The only `name` keys a 05 event may carry: a menu item's billed name (§6.12 step 6, §3.15 lines[].name), the
// payment-mode and petty-category names the Z embeds (G-9), and a credential's name (§6.28a, e.g. 'token').
const ALLOWED_NAME_KEYS: Record<string, string[]> = {
  InvoiceIssued: ['lines[].name'],
  InvoiceCredited: ['lines[].name'],
  ZReportIssued: [
    'report.payments_by_mode[].mode_name',
    'report.petty_cash[].category_name',
    'report.brought_forward[].mode_name',
    'report.carried_forward[].mode_name',
  ],
  FiscalTokenSet: ['name'],
};
// Privacy (B19, B22, B30; plan §1): no key may *contain* a buyer tax ID, token, PIN, name, phone, note, paid-to or
// payment-reference part — checked by substring, so `buyer_note`, `pin_hash` or `staff_name` are caught too. Only the
// flag / id keys below and the per-event name keys above are let through.
const FORBIDDEN_IN_KEY = ['buyer_tax_id', 'tax_id', 'token', 'pin', 'name', 'phone', 'note', 'paid_to', 'reference', 'customer', 'text', 'ntn', 'cnic'];
const ALLOWED_KEYS = new Set(['has_note', 'note_id', 'has_buyer_id', 'has_paid_to', 'has_reference']);
const forbiddenIn = (type: string, path: string): string[] => {
  const leaf = path.split('.').at(-1)!.replace(/\[\]|\{\}/g, '');
  if (ALLOWED_KEYS.has(leaf) || (ALLOWED_NAME_KEYS[type] ?? []).includes(path)) return [];
  return FORBIDDEN_IN_KEY.filter((f) => leaf.includes(f));
};

describe('05 events (§6.29)', () => {
  it('[05 §6.29] 30 events, all schema_version 1, on the bill / shift / hub streams', () => {
    expect(EVENTS).toHaveLength(30);
    for (const { type, stream, build } of EVENTS) {
      const event = build();
      expect(event.event_type, type).toBe(type);
      expect(event.stream_type, type).toBe(stream);
      expect(event.schema_version, type).toBe(1);
    }
  });

  it('[05 §6.29, F §6.7] every event: its builder and its fixtures (v1, latest) parse and agree', () => {
    for (const { type, build } of EVENTS) {
      const built = build();
      expect(parseEvent(built), type).toEqual(built);
      expect(parseEvent(fixture(`${type}.v1.json`)), type).toEqual(built);
      expect(fixture(`${type}.latest.json`), type).toEqual(built);
    }
  });

  it('[05 §6.29] every event: .strict() — an extra field is refused', () => {
    for (const { type, build } of EVENTS) {
      const payload = build().payload;
      expect(schema(type).safeParse(payload).success, type).toBe(true);
      expect(schema(type).safeParse({ ...payload, extra: 1 }).success, type).toBe(false);
    }
  });

  it('[05 §6.29, B19, H16-5] every event: no staff or buyer name field exists, and no free-text field', () => {
    for (const { type } of EVENTS) {
      const paths = keyPaths(schema(type));
      expect(paths.length, type).toBeGreaterThan(0);
      const names = paths.filter((p) => /name/.test(p.split('.').at(-1)!));
      expect(names, type).toEqual(ALLOWED_NAME_KEYS[type] ?? []);
      for (const p of paths) expect(forbiddenIn(type, p), `${type} ${p}`).toEqual([]);
    }
  });

  it('[05 B19, B22, B30] the privacy guard matches by substring: a key that only contains a forbidden part is caught', () => {
    for (const key of ['buyer_tax_id', 'buyer_tax_id_last4', 'pin_hash', 'staff_pin', 'fiscal_token', 'staff_name', 'customer_phone', 'bill_note', 'notes', 'paid_to_text', 'reference_no']) {
      expect(forbiddenIn('BillOpened', key), key).not.toEqual([]);
    }
    for (const key of ['has_note', 'note_id', 'has_buyer_id', 'buyer_id_refused', 'has_paid_to', 'has_reference', 'invoice_ref', 'pos_id']) {
      expect(forbiddenIn('BillOpened', key), key).toEqual([]);
    }
    expect(forbiddenIn('BillOpened', 'lines[].name')).toEqual(['name']);
    expect(forbiddenIn('InvoiceIssued', 'lines[].name')).toEqual([]);
  });

  it('[05 §6.29, H2-22] text-taking events carry has_note / note_id; petty cash has_paid_to; a payment has_reference', () => {
    for (const type of ['ChargeApplied', 'ChargeRemoved', 'DiscountApplied', 'DiscountRemoved', 'BuyerIdWaived', 'BillReopened', 'ShiftClosed', 'PettyCashSettled', 'DrawerOpened']) {
      expect(keyPaths(schema(type)), type).toEqual(expect.arrayContaining(['has_note', 'note_id']));
    }
    for (const type of ['PettyCashAdvanced', 'PettyCashOut', 'PettyCashIn']) {
      expect(keyPaths(schema(type)), type).toEqual(expect.arrayContaining(['has_note', 'has_paid_to']));
    }
    expect(keyPaths(schema('PaymentAdded'))).toContain('has_reference');
    expect(keyPaths(schema('PaymentRemoved'))).toContain('has_note');
  });

  it('[05 H2-1] events an approval apply can return carry alert_id (null on the direct path)', () => {
    for (const type of ['ChargeRemoved', 'DiscountApplied', 'BuyerIdWaived', 'BillReopened', 'InvoiceCredited', 'ShiftClosed', 'PettyCashAdvanced', 'PettyCashOut', 'PettyCashIn']) {
      const payload = payloadOf(type);
      expect(schema(type).safeParse({ ...payload, alert_id: null }).success, type).toBe(true);
      expect(schema(type).safeParse({ ...payload, alert_id: 'A1' }).success, type).toBe(true);
      const without = { ...payload };
      delete without.alert_id;
      expect(schema(type).safeParse(without).success, type).toBe(false);
    }
    const signed = payloadOf('ShiftVarianceSignedOff');
    expect(schema('ShiftVarianceSignedOff').safeParse({ ...signed, alert_id: null }).success).toBe(false);
  });

  it('[05 §6.29, H8-5] BillClosedEmpty: alert_id is optional (never null); seating_id nullable', () => {
    const p = payloadOf('BillClosedEmpty');
    const direct = { ...p };
    delete direct.alert_id;
    expect(schema('BillClosedEmpty').safeParse(direct).success).toBe(true);
    expect(schema('BillClosedEmpty').safeParse({ ...p, alert_id: null }).success).toBe(false);
    expect(schema('BillClosedEmpty').safeParse({ ...p, seating_id: null }).success).toBe(true);
  });

  it('[05 §5, H2-16] BillOpened: scope seating ⇔ seating_id, scope key ⇔ bill_key', () => {
    const p = payloadOf('BillOpened');
    const s = schema('BillOpened');
    expect(s.safeParse(p).success).toBe(true);
    expect(s.safeParse({ ...p, scope: 'key', seating_id: null, bill_key: 'takeaway:K1', order_type: 'takeaway' }).success).toBe(true);
    expect(s.safeParse({ ...p, seating_id: null }).success).toBe(false);
    expect(s.safeParse({ ...p, bill_key: 'takeaway:K1' }).success).toBe(false);
    expect(s.safeParse({ ...p, scope: 'key', seating_id: null, bill_key: null }).success).toBe(false);
  });

  it('[05 R-40, §6.13, §3.10] BillReopened carries mode full | corrections (folded into bills.reopen_mode)', () => {
    const p = payloadOf('BillReopened');
    const s = schema('BillReopened');
    expect(p).toMatchObject({ mode: 'full' });
    expect(s.safeParse({ ...p, mode: 'corrections' }).success).toBe(true);
    expect(s.safeParse({ ...p, mode: 'partial' }).success).toBe(false);
    const without = { ...p };
    delete without.mode;
    expect(s.safeParse(without).success).toBe(false);
  });

  it('[05 §6.9, §5] PaymentAdded: tendered and change only on a cash in; change = tendered − amount', () => {
    const p = payloadOf('PaymentAdded');
    const s = schema('PaymentAdded');
    expect(p).toMatchObject({ payment_class: 'cash', direction: 'in' });
    expect(s.safeParse(p).success).toBe(true);
    expect(s.safeParse({ ...p, change_minor: 1 }).success).toBe(false);
    expect(s.safeParse({ ...p, tendered_minor: null, change_minor: null }).success).toBe(true);
    expect(s.safeParse({ ...p, payment_class: 'digital' }).success).toBe(false);
    expect(s.safeParse({ ...p, direction: 'out' }).success).toBe(false);
    expect(s.safeParse({ ...p, tendered_minor: 1, change_minor: -(p.amount_minor as number) + 1 }).success).toBe(false);
    expect(s.safeParse({ ...p, amount_minor: 0 }).success).toBe(false);
  });

  it('[05 R-8 / G-1] InvoiceIssued (and its credit) refuses fiscal.required: true with adapter none', () => {
    for (const type of ['InvoiceIssued', 'InvoiceCredited']) {
      const p = payloadOf(type) as { fiscal: Record<string, unknown> };
      const s = schema(type);
      expect(p.fiscal).toMatchObject({ adapter_key: 'PRA', required: true });
      expect(s.safeParse(p).success, type).toBe(true);
      expect(s.safeParse({ ...p, fiscal: { ...p.fiscal, adapter_key: 'none' } }).success, type).toBe(false);
      expect(s.safeParse({ ...p, fiscal: { ...p.fiscal, adapter_key: 'none', required: false } }).success, type).toBe(true);
      expect(s.safeParse({ ...p, fiscal: { ...p.fiscal, required: false } }).success, type).toBe(true);
    }
  });

  it('[05 G-3] InvoiceIssued validates only the non-null receipt shape (null label and empty lists accepted)', () => {
    const p = payloadOf('InvoiceIssued') as { fiscal: Record<string, unknown> };
    const s = schema('InvoiceIssued');
    const empty = { fiscal_number_label: null, tax_reg_labels: [], show_qr: false, qr_url_template: null, buyer_id_on_receipt: false };
    expect(s.safeParse({ ...p, fiscal: { ...p.fiscal, receipt: empty } }).success).toBe(true);
    expect(s.safeParse({ ...p, fiscal: { ...p.fiscal, receipt: null } }).success).toBe(false);
  });

  it('[05 G-27, R-21] InvoiceIssued.service_charge is nullable', () => {
    const p = payloadOf('InvoiceIssued');
    expect(p.service_charge).not.toBeNull();
    expect(schema('InvoiceIssued').safeParse({ ...p, service_charge: null, service_charge_minor: 0 }).success).toBe(true);
  });

  it('[05 §6.12 step 6, H3-8] InvoiceIssued: discount_line_ids string[] or null; series sale only; the credit series credit only', () => {
    const p = payloadOf('InvoiceIssued');
    expect(schema('InvoiceIssued').safeParse({ ...p, discount_line_ids: null }).success).toBe(true);
    expect(schema('InvoiceIssued').safeParse({ ...p, series: 'credit' }).success).toBe(false);
    const c = payloadOf('InvoiceCredited');
    expect(schema('InvoiceCredited').safeParse({ ...c, series: 'sale' }).success).toBe(false);
    expect(c).not.toHaveProperty('discount_line_ids');
  });

  it('[05 §6.25, H16-5, G-9] ZReportIssued.report: staff ids only; mode_name per takings row and category_name per petty row', () => {
    const p = payloadOf('ZReportIssued') as { report: Record<string, unknown> };
    const paths = keyPaths(schema('ZReportIssued'));
    expect(paths).toEqual(expect.arrayContaining(['report.payments_by_mode[].mode_name', 'report.petty_cash[].category_name']));
    const staff = paths.filter((x) => /staff/.test(x));
    expect(staff.length).toBeGreaterThan(0);
    for (const x of staff) expect(x, x).toMatch(/staff_id$/);
    expect(p.report).toMatchObject({ kind: 'z' });
    expect(schema('ZReportIssued').safeParse({ ...p, report: { ...p.report, kind: 'x' } }).success).toBe(false);
    const takings = p.report.payments_by_mode as Record<string, unknown>[];
    expect(schema('ZReportIssued').safeParse({ ...p, report: { ...p.report, payments_by_mode: [{ ...takings[0], staff_name: 'x' }] } }).success).toBe(false);
  });

  it('[05 §6.28a] FiscalTokenSet carries no token, length or hash', () => {
    expect(keyPaths(schema('FiscalTokenSet')).sort()).toEqual(['name', 'pos_id', 'set_at', 'set_by_staff_id']);
  });

  it('[05 §6.29] no fixture carries a machine path or a bearer token', () => {
    for (const { type } of EVENTS) {
      for (const name of [`${type}.v1.json`, `${type}.latest.json`]) {
        const text = readFileSync(join(FIXTURES, name), 'utf8');
        expect(/\/home\/|\/Users\/|Bearer [A-Za-z0-9]{12,}/.test(text), name).toBe(false);
      }
    }
  });

  it('[05 #16d schema half, R-41] DiscountFrozen { bill_id, frozen_minor ≥ 0, line_ids: string[] }: strict, no audit fields', () => {
    const p = payloadOf('DiscountFrozen');
    const s = schema('DiscountFrozen');
    expect(Object.keys(p).sort()).toEqual(['bill_id', 'frozen_minor', 'line_ids']);
    expect(s.safeParse({ ...p, frozen_minor: 0, line_ids: [] }).success).toBe(true);
    expect(s.safeParse({ ...p, frozen_minor: -1 }).success).toBe(false);
    expect(s.safeParse({ ...p, frozen_minor: 1.5 }).success).toBe(false);
    expect(s.safeParse({ ...p, line_ids: null }).success).toBe(false);
    expect(s.safeParse({ ...p, alert_id: null }).success).toBe(false);
    // line_ids = the same set as the first close's InvoiceIssued.discount_line_ids
    expect(p.line_ids).toEqual(payloadOf('InvoiceIssued').discount_line_ids);
  });

  it('[05 #50d schema half, R-42] ShiftCounted.variance_alert_id: string | null, required; HandoverCounted refuses it', () => {
    const p = payloadOf('ShiftCounted');
    const s = schema('ShiftCounted');
    expect(p).toHaveProperty('variance_alert_id');
    expect(s.safeParse({ ...p, variance_alert_id: null }).success).toBe(true);
    expect(s.safeParse({ ...p, variance_alert_id: 'A1' }).success).toBe(true);
    const without = { ...p };
    delete without.variance_alert_id;
    expect(s.safeParse(without).success).toBe(false);
    const h = payloadOf('HandoverCounted');
    expect(h).not.toHaveProperty('variance_alert_id');
    expect(schema('HandoverCounted').safeParse({ ...h, variance_alert_id: null }).success).toBe(false);
  });

  it('[05 §6.17, §6.19] ShiftCounted / HandoverCounted: variance = counted − expected (any other value refused)', () => {
    for (const type of ['ShiftCounted', 'HandoverCounted']) {
      const p = payloadOf(type) as { counted_minor: number; expected_minor: number; variance_minor: number };
      const s = schema(type);
      expect(p.variance_minor, type).toBe(p.counted_minor - p.expected_minor);
      expect(s.safeParse({ ...p, variance_minor: p.variance_minor + 1 }).success, type).toBe(false);
      expect(s.safeParse({ ...p, variance_minor: p.expected_minor - p.counted_minor }).success, type).toBe(false);
      expect(s.safeParse({ ...p, counted_minor: p.expected_minor + 700, variance_minor: 700 }).success, type).toBe(true);
    }
  });

  it('[05 #47b schema half, R-44] PaymentRemoved carries the removed payment’s shift_id, mode_id, payment_class, direction, amount_minor, change_minor, taken_by_staff_id; no reference text', () => {
    const p = payloadOf('PaymentRemoved');
    const added = payloadOf('PaymentAdded');
    const s = schema('PaymentRemoved');
    for (const k of ['shift_id', 'mode_id', 'payment_class', 'direction', 'amount_minor', 'change_minor', 'taken_by_staff_id']) {
      expect(p[k], k).toEqual(added[k]);
      const without = { ...p };
      delete without[k];
      expect(s.safeParse(without).success, k).toBe(false);
    }
    expect(s.safeParse({ ...p, change_minor: 0, payment_class: 'digital' }).success).toBe(true);
    expect(s.safeParse({ ...p, change_minor: null }).success).toBe(false);
    expect(s.safeParse({ ...p, change_minor: -1 }).success).toBe(false);
    expect(s.safeParse({ ...p, payment_class: 'mixed' }).success).toBe(false);
    expect(s.safeParse({ ...p, direction: 'sideways' }).success).toBe(false);
    expect(s.safeParse({ ...p, amount_minor: 0 }).success).toBe(false);
    expect(s.safeParse({ ...p, reference: 'x' }).success).toBe(false);
    expect(s.safeParse({ ...p, has_reference: false }).success).toBe(false);
  });

  it('[05 #47b sign-off date half, R-44] ShiftVarianceSignedOff.business_date: required BusinessDate', () => {
    const p = payloadOf('ShiftVarianceSignedOff');
    const s = schema('ShiftVarianceSignedOff');
    expect(p.business_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.safeParse({ ...p, business_date: '2025/10/21' }).success).toBe(false);
    const without = { ...p };
    delete without.business_date;
    expect(s.safeParse(without).success).toBe(false);
  });

  it('[05 #91c] petty cash: advance_staff_id required on PettyCashAdvanced, null on PettyCashOut / PettyCashIn', () => {
    const adv = payloadOf('PettyCashAdvanced');
    expect(adv.advance_staff_id).toEqual(expect.any(String));
    expect(schema('PettyCashAdvanced').safeParse({ ...adv, advance_staff_id: null }).success).toBe(false);
    for (const type of ['PettyCashOut', 'PettyCashIn']) {
      const p = payloadOf(type);
      expect(p.advance_staff_id, type).toBeNull();
      expect(schema(type).safeParse({ ...p, advance_staff_id: 'S9' }).success, type).toBe(false);
    }
  });

  it('[05 #91c, §3.8] BillSplitsSet: items lines carry order_id; amount share_minor; equal / none list split numbers only; none exactly one', () => {
    const p = payloadOf('BillSplitsSet') as { splits: { split_no: number; lines: unknown; share_minor: unknown }[] };
    const s = schema('BillSplitsSet');
    const only = (n: number, extra: Record<string, unknown> = {}) => ({ split_no: n, lines: null, share_minor: null, ...extra });
    expect(s.safeParse(p).success).toBe(true);
    const line = { order_item_id: 'L1', order_id: 'O1', units: 1 };
    const noOrder = { order_item_id: 'L1', units: 1 };
    expect(s.safeParse({ ...p, splits: [only(1, { lines: [noOrder] }), only(2, { lines: [line] })] }).success).toBe(false);
    expect(s.safeParse({ ...p, splits: [only(1, { lines: [line] }), only(1, { lines: [line] })] }).success).toBe(false);
    expect(s.safeParse({ ...p, splits: [only(1, { lines: [line] }), only(2)] }).success).toBe(false);
    expect(s.safeParse({ ...p, splits: [only(1, { lines: [{ ...line, units: 0 }] }), only(2, { lines: [line] })] }).success).toBe(false);
    expect(s.safeParse({ ...p, mode: 'amount', splits: [only(1, { share_minor: 100 }), only(2, { share_minor: 200 })] }).success).toBe(true);
    expect(s.safeParse({ ...p, mode: 'amount', splits: [only(1, { share_minor: 100 }), only(2)] }).success).toBe(false);
    expect(s.safeParse({ ...p, mode: 'amount', splits: [only(1, { share_minor: 0 }), only(2, { share_minor: 1 })] }).success).toBe(false);
    expect(s.safeParse({ ...p, mode: 'amount', splits: [only(1, { share_minor: 100, lines: [line] }), only(2, { share_minor: 1 })] }).success).toBe(false);
    expect(s.safeParse({ ...p, mode: 'equal', splits: [only(2), only(3)] }).success).toBe(true);
    expect(s.safeParse({ ...p, mode: 'equal', splits: [only(2), only(3, { share_minor: 5 })] }).success).toBe(false);
    expect(s.safeParse({ ...p, mode: 'none', splits: [only(3)] }).success).toBe(true);
    expect(s.safeParse({ ...p, mode: 'none', splits: [only(1), only(2)] }).success).toBe(false);
    expect(s.safeParse({ ...p, mode: 'none', splits: [] }).success).toBe(false);
    expect(s.safeParse({ ...p, mode: 'equal', splits: [only(21), only(2)] }).success).toBe(false);
  });

  it('[05 #91c, §6.6] DiscountApplied: percent value 1–10 000 bp; replaces is a boolean; DiscountRemoved has no approval keys', () => {
    const p = payloadOf('DiscountApplied');
    const s = schema('DiscountApplied');
    expect(p).toMatchObject({ kind: 'percent' });
    expect(s.safeParse({ ...p, value: 10_000 }).success).toBe(true);
    expect(s.safeParse({ ...p, value: 10_001 }).success).toBe(false);
    expect(s.safeParse({ ...p, value: 0 }).success).toBe(false);
    expect(s.safeParse({ ...p, kind: 'amount', value: 10_001 }).success).toBe(true);
    expect(s.safeParse({ ...p, replaces: 'yes' }).success).toBe(false);
    const r = payloadOf('DiscountRemoved');
    expect(Object.keys(r).sort()).toEqual(['bill_id', 'has_note', 'note_id', 'reason_code']);
    for (const k of ['alert_id', 'requester_staff_id', 'approver_staff_id']) {
      expect(schema('DiscountRemoved').safeParse({ ...r, [k]: null }).success, k).toBe(false);
    }
  });

  it('[05 #91c] ShiftCountSkipped { shift_id } only; CheckBillPrinted.source only manual; InvoiceIssued.payment_class accepts mixed', () => {
    expect(keyPaths(schema('ShiftCountSkipped'))).toEqual(['shift_id']);
    const c = payloadOf('CheckBillPrinted');
    expect(schema('CheckBillPrinted').safeParse({ ...c, source: 'bill_requested' }).success).toBe(false);
    const i = payloadOf('InvoiceIssued');
    expect(schema('InvoiceIssued').safeParse({ ...i, payment_class: 'mixed' }).success).toBe(true);
    expect(schema('InvoiceIssued').safeParse({ ...i, payment_class: 'card' }).success).toBe(false);
  });

  it('[05 #91c, §6.13] InvoiceCredited: refuses discount_line_ids; needs series credit, ref_invoice_id, ref_invoice_ref, alert_id', () => {
    const c = payloadOf('InvoiceCredited');
    const s = schema('InvoiceCredited');
    expect(s.safeParse({ ...c, discount_line_ids: null }).success).toBe(false);
    for (const k of ['series', 'ref_invoice_id', 'ref_invoice_ref', 'alert_id']) {
      const without = { ...c };
      delete without[k];
      expect(s.safeParse(without).success, k).toBe(false);
    }
    // closed_by = the reopen's requester (§6.13), as the builders pair them
    expect(c.closed_by).toBe(payloadOf('BillReopened').requester_staff_id);
  });

  it('[05 B19, A7] an invoice never has both has_buyer_id and buyer_id_refused (a waiver leaves the buyer fields empty)', () => {
    for (const type of ['InvoiceIssued', 'InvoiceCredited']) {
      const p = payloadOf(type);
      const s = schema(type);
      expect(s.safeParse({ ...p, has_buyer_id: true, buyer_id_refused: false }).success, type).toBe(true);
      expect(s.safeParse({ ...p, has_buyer_id: false, buyer_id_refused: true }).success, type).toBe(true);
      expect(s.safeParse({ ...p, has_buyer_id: true, buyer_id_refused: true }).success, type).toBe(false);
    }
  });

  it('[05 #91c, §6.25] ZReportIssued: report.business_date / z_no equal the event’s (a mismatch refused); open_bills is X only (Z refuses any)', () => {
    const p = payloadOf('ZReportIssued') as { business_date: string; z_no: number; report: Record<string, unknown> };
    const s = schema('ZReportIssued');
    expect(p.report).toMatchObject({ business_date: p.business_date, z_no: p.z_no });
    expect(s.safeParse({ ...p, business_date: '2025-10-21' }).success).toBe(false);
    expect(s.safeParse({ ...p, z_no: p.z_no + 1 }).success).toBe(false);
    expect(s.safeParse({ ...p, report: { ...p.report, business_date: '2025-10-21' } }).success).toBe(false);
    expect(s.safeParse({ ...p, report: { ...p.report, z_no: 2 } }).success).toBe(false);
    expect(s.safeParse({ ...p, business_date: '20251020', report: { ...p.report, business_date: '20251020' } }).success).toBe(false);
    expect(s.safeParse({ ...p, report: { ...p.report, open_bills: [{ identifier: 'T4', open_minutes: 300, flagged: true }] } }).success).toBe(false);
  });

  it('[05 §6.2 ensure bill, B8] ChargeApplied: a rule charge has rate_bp ≥ 1 (rate 0 → no event); a manual one may not exceed 10 000', () => {
    const p = payloadOf('ChargeApplied');
    const s = schema('ChargeApplied');
    expect(p).toMatchObject({ source: 'rule' });
    expect(s.safeParse({ ...p, rate_bp: 0 }).success).toBe(false);
    expect(s.safeParse({ ...p, rate_bp: 1 }).success).toBe(true);
    expect(s.safeParse({ ...p, rate_bp: 10_001 }).success).toBe(false);
    expect(s.safeParse({ ...p, source: 'manual', rate_bp: 10_001 }).success).toBe(false);
  });

  it('[05 §6.24] OrdersCarriedOver.business_date is a BusinessDate (YYYY-MM-DD)', () => {
    const s = payloadSchema('OrdersCarriedOver', 1);
    const p = { order_ids: ['O1'], business_date: '2025-10-20', reason_code: 'other', has_note: false, note_id: null };
    expect(s.safeParse(p).success).toBe(true);
    expect(s.safeParse({ ...p, business_date: 'yesterday' }).success).toBe(false);
  });
});
