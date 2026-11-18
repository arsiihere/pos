import { describe, expect, it } from 'vitest';
import {
  BILL_REOPEN_REASONS,
  CARRY_OVER_REASONS,
  CHARGE_REMOVE_REASONS,
  COMP_REMOVE_REASONS,
  CREDIT_SUPPORT,
  DISCOUNT_KINDS,
  FISCAL_ORDERING,
  FISCAL_ROW_STATES,
  INVOICE_SERIES,
  MIXED_CLASS_RULES,
  PAYMENT_CLASSES,
  PAYMENT_MODE_KINDS,
  PETTY_KINDS,
  ROUNDING_APPLIES_TO,
  ROUNDING_METHODS,
  SPLIT_MODES,
} from './types.js';

describe('billing shared constants', () => {
  it('[05 §4.4] PAYMENT_CLASSES is exactly cash, digital', () => {
    expect(PAYMENT_CLASSES).toEqual(['cash', 'digital']);
  });
  it('[05 §4.4] PAYMENT_MODE_KINDS is exactly cash, card, wallet, online, other', () => {
    expect(PAYMENT_MODE_KINDS).toEqual(['cash', 'card', 'wallet', 'online', 'other']);
  });
  it('[05 §4.4] SPLIT_MODES is exactly items, amount, equal', () => {
    expect(SPLIT_MODES).toEqual(['items', 'amount', 'equal']);
  });
  it('[05 §4.4] MIXED_CLASS_RULES is exactly higher_rate', () => {
    expect(MIXED_CLASS_RULES).toEqual(['higher_rate']);
  });
  it('[05 §4.4] ROUNDING_METHODS is exactly nearest, down, up', () => {
    expect(ROUNDING_METHODS).toEqual(['nearest', 'down', 'up']);
  });
  it('[05 §4.4] ROUNDING_APPLIES_TO is exactly all, cash', () => {
    expect(ROUNDING_APPLIES_TO).toEqual(['all', 'cash']);
  });
  it('[05 §4.4] CREDIT_SUPPORT is exactly credit_invoice, none', () => {
    expect(CREDIT_SUPPORT).toEqual(['credit_invoice', 'none']);
  });
  it('[05 §4.4] FISCAL_ORDERING is exactly strict_per_pos_id, none', () => {
    expect(FISCAL_ORDERING).toEqual(['strict_per_pos_id', 'none']);
  });
  it('[05 §4.4] INVOICE_SERIES is exactly sale, credit', () => {
    expect(INVOICE_SERIES).toEqual(['sale', 'credit']);
  });
  it('[05 §4.4] FISCAL_ROW_STATES is exactly pending, acked, rejected, not_required', () => {
    expect(FISCAL_ROW_STATES).toEqual(['pending', 'acked', 'rejected', 'not_required']);
  });
  it('[05 §4.4] DISCOUNT_KINDS is exactly amount, percent', () => {
    expect(DISCOUNT_KINDS).toEqual(['amount', 'percent']);
  });
  it('[05 §4.4] PETTY_KINDS is exactly advance, out, in', () => {
    expect(PETTY_KINDS).toEqual(['advance', 'out', 'in']);
  });
  it('[05 §4.4] BILL_REOPEN_REASONS holds the five reasons exactly', () => {
    expect(BILL_REOPEN_REASONS).toEqual([
      'wrong_item_billed',
      'wrong_payment_mode',
      'customer_returned_item',
      'price_error',
      'other',
    ]);
  });
  it('[05 §4.4] CHARGE_REMOVE_REASONS holds the four reasons exactly', () => {
    expect(CHARGE_REMOVE_REASONS).toEqual([
      'customer_request',
      'service_complaint',
      'staff_meal',
      'other',
    ]);
  });
  it('[05 §4.4] COMP_REMOVE_REASONS holds the three reasons exactly', () => {
    expect(COMP_REMOVE_REASONS).toEqual(['comped_by_mistake', 'wrong_line', 'other']);
  });
  it('[05 §4.4] CARRY_OVER_REASONS holds the three reasons exactly', () => {
    expect(CARRY_OVER_REASONS).toEqual([
      'table_still_seated',
      'customer_will_pay_later',
      'other',
    ]);
  });
});
