import { describe, expect, it } from 'vitest';
import { billingErrorKey } from './errors';

// 05 §8 "Errors" / §9: a billing refusal shows its errors.<code> text, picked by the reason / state the details carry.

describe('[05 §8 Errors; §9] billingErrorKey (task 43a)', () => {
  it('a plain §9 code reads errors.<code>', () => {
    expect(billingErrorKey('BILL_NOT_FOUND', { bill_id: 'b1' })).toBe('errors.BILL_NOT_FOUND');
    expect(billingErrorKey('LINE_IN_CLOSED_SPLIT', { order_item_id: 'i', bill_id: 'b', split_no: 1 })).toBe('errors.LINE_IN_CLOSED_SPLIT');
    expect(billingErrorKey('SERVICE_CHARGE_NOT_APPLIED', { bill_id: 'b1' })).toBe('errors.SERVICE_CHARGE_NOT_APPLIED');
  });

  it('BILL_NOT_OPEN with state cancelled reads the cancelled text; any other state the closed one', () => {
    expect(billingErrorKey('BILL_NOT_OPEN', { bill_id: null, state: 'cancelled' })).toBe('errors.BILL_NOT_OPEN_cancelled');
    expect(billingErrorKey('BILL_NOT_OPEN', { bill_id: 'b', state: 'closed' })).toBe('errors.BILL_NOT_OPEN');
    expect(billingErrorKey('BILL_NOT_OPEN', { bill_id: 'b', state: 'absorbed' })).toBe('errors.BILL_NOT_OPEN');
  });

  it('SHIFT_NOT_OPEN, BILL_SPLIT_INVALID and PERMISSION_DENIED read their reason text', () => {
    expect(billingErrorKey('SHIFT_NOT_OPEN', { reason: 'no_drawer_shift' })).toBe('errors.SHIFT_NOT_OPEN.no_drawer_shift');
    expect(billingErrorKey('SHIFT_NOT_OPEN', { reason: 'payment_shift_closed' })).toBe('errors.SHIFT_NOT_OPEN.payment_shift_closed');
    expect(billingErrorKey('BILL_SPLIT_INVALID', { reason: 'deal_whole', order_item_id: 'i' })).toBe('errors.BILL_SPLIT_INVALID.deal_whole');
    expect(billingErrorKey('PERMISSION_DENIED', { reason: 'not_own_payment' })).toBe('errors.PERMISSION_DENIED.not_own_payment');
    expect(billingErrorKey('PERMISSION_DENIED', { reason: 'outside_scope' })).toBe('errors.PERMISSION_DENIED.outside_scope');
  });

  it('an unknown reason never shows a raw key: the generic text', () => {
    expect(billingErrorKey('SHIFT_NOT_OPEN', { reason: 'something_new' })).toBe('errors.UNKNOWN');
    expect(billingErrorKey('BILL_SPLIT_INVALID', {})).toBe('errors.UNKNOWN');
    expect(billingErrorKey('NOT_A_CODE', {})).toBe('errors.UNKNOWN');
  });

  it('PAYMENT_EXCEEDS_BALANCE at balance 0: nothing left (in) / nothing to give back (out); above 0 the cap text', () => {
    expect(billingErrorKey('PAYMENT_EXCEEDS_BALANCE', { balance_minor: 0 }, { direction: 'in' })).toBe('errors.PAYMENT_EXCEEDS_BALANCE_zero_in');
    expect(billingErrorKey('PAYMENT_EXCEEDS_BALANCE', { balance_minor: 0 }, { direction: 'out' })).toBe('errors.PAYMENT_EXCEEDS_BALANCE_zero_out');
    expect(billingErrorKey('PAYMENT_EXCEEDS_BALANCE', { balance_minor: 500 }, { direction: 'in' })).toBe('errors.PAYMENT_EXCEEDS_BALANCE');
    expect(billingErrorKey('PAYMENT_EXCEEDS_BALANCE', { balance_minor: 0 })).toBe('errors.PAYMENT_EXCEEDS_BALANCE');
  });

  it('BILL_HAS_PAYMENTS: with split_nos the split text, without (merge / seating split) the tables text', () => {
    expect(billingErrorKey('BILL_HAS_PAYMENTS', { bill_id: 'b', split_nos: [2] })).toBe('errors.BILL_HAS_PAYMENTS');
    expect(billingErrorKey('BILL_HAS_PAYMENTS', { bill_id: 'b' })).toBe('errors.BILL_HAS_PAYMENTS_tables');
  });

  it('reused codes with an existing text keep it (§9 "Reused")', () => {
    expect(billingErrorKey('PRINTER_NOT_FOUND', { printer_id: 'p' })).toBe('errors.PRINTER_NOT_FOUND');
    expect(billingErrorKey('VALIDATION_FAILED', {})).toBe('errors.VALIDATION_FAILED');
  });
});
