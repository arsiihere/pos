import { describe, expect, it } from 'vitest';
import { en } from '../../i18n/en';
import { ur } from '../../i18n/ur';
import { BILLING_ERROR_KEYS_05_1, BILLING_KIND_KEYS_05_1 } from './errors';
import { TODO_05 } from './urdu-todo-05';

// 05 §8 "Errors" (every §9 code has an errors.<code> key, EN + UR, D12) and §3.14 / §3.15 kind labels; brief §6.7,
// §6.8 copy; plan §3.1 task 43a (05-1 codes and kinds; 05-2's petty / Z / day-close ones are task 43b).

const EN = en as Record<string, string>;
const UR = ur as Record<string, string | undefined>;

const holes = (text: string) => [...text.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort().join();

describe('[05 §8 Errors; §9] 05-1 error and kind strings (task 43a)', () => {
  const listed = TODO_05;

  it('the urdu-todo parser reads the hand-off rows', () => {
    expect(listed.has('errors.BILL_NOT_OPEN_cancelled')).toBe(true);
    expect(listed.has('errors.SHIFT_NOT_OPEN.payment_shift_closed')).toBe(true);
    expect(listed.has('errors.PAYMENT_EXCEEDS_BALANCE_zero_out')).toBe(true);
    expect(listed.has('alert.fiscal_outbox_stuck.help')).toBe(true);
  });

  it('every 05-1 §9 code (with its reason variants) and every 05-1 kind label is in en, and in ur or 05/urdu-todo.md', () => {
    const all = [...BILLING_ERROR_KEYS_05_1, ...BILLING_KIND_KEYS_05_1];
    expect(all.length).toBeGreaterThan(50);
    for (const key of all) {
      expect(EN[key], key).toBeTruthy();
      const urText = UR[key];
      expect(urText !== undefined || listed.has(key), key).toBe(true);
      if (urText !== undefined) {
        // a key with Urdu is not left on the to-do list, and keeps the English placeholders
        expect(listed.has(key), key).toBe(false);
        expect(holes(urText), key).toBe(holes(EN[key]!));
      }
    }
  });

  it('[05 v1.0.12 R-58] SERVICE_CHARGE_NOT_APPLIED has a text and an urdu-todo row', () => {
    expect(EN['errors.SERVICE_CHARGE_NOT_APPLIED']).toBe('The service charge was already removed');
    expect(listed.has('errors.SERVICE_CHARGE_NOT_APPLIED')).toBe(true);
  });

  it('[brief §6.8] the English copy is the brief text', () => {
    expect(EN['errors.BILL_NOT_FOUND']).toBe("This bill can't be found — go back to Bills");
    expect(EN['errors.BILL_NOT_OPEN']).toBe('This bill is already closed');
    expect(EN['errors.BILL_NOT_OPEN_cancelled']).toBe('This order was cancelled');
    expect(EN['errors.BILL_TOTAL_CHANGED']).toBe('The total changed to {amount} — check it and close again');
    expect(EN['errors.BILL_SPLIT_INVALID.shares_sum']).toBe('Amounts must add up to {amount}');
    expect(EN['errors.PAYMENT_EXCEEDS_BALANCE']).toBe('The most you can take by {mode} is {amount}');
    expect(EN['errors.SHIFT_NOT_OPEN.no_shift']).toBe('Open your shift to take money');
    expect(EN['errors.DRAWER_IN_USE']).toBe("This drawer is in {name}'s open shift — they must close it first, or open without the drawer");
  });

  it('[brief §6.7, §6.8] each text keeps the brief placeholders (no placeholder lost or renamed)', () => {
    const expected: Record<string, string> = {
      'errors.BILL_CLOSE_BLOCKED': '{reasons}',
      'errors.BUYER_ID_REQUIRED': '{threshold}',
      'errors.BILL_TOTAL_CHANGED': '{amount}',
      'errors.BILL_BALANCE_DUE': '{amount},{n}',
      'errors.BILL_HAS_PAYMENTS': '{n}',
      'errors.DRAWER_IN_USE': '{name}',
      'errors.BILL_SPLIT_INVALID.units_missing': '{item}',
      'errors.BILL_SPLIT_INVALID.units_exceed': '{item}',
      'errors.BILL_SPLIT_INVALID.shares_sum': '{amount}',
      'errors.DISCOUNT_TOO_LARGE': '{amount}',
      'errors.PAYMENT_MODE_NOT_FISCAL': '{mode}',
      'errors.PAYMENT_EXCEEDS_BALANCE': '{amount},{mode}',
      'errors.PAYMENT_EXCEEDS_BALANCE_zero_out': '{type}',
      'errors.PAYMENT_CASH_STEP': '{amount}',
      'alert.discount.card': '{amount},{identifier},{reason}',
      'alert.remove_service_charge.card': '{identifier},{reason}',
      'alert.reopen_bill.card': '{identifier},{reason}',
      'alert.remove_comp.card': '{amount},{identifier},{reason}',
      'alert.close_without_buyer_id.card': '{amount},{identifier}',
      'alert.fiscal_outbox_stuck.card': '{minutes},{quantity}',
    };
    for (const key of [...BILLING_ERROR_KEYS_05_1, ...BILLING_KIND_KEYS_05_1]) {
      const want = expected[key] ?? (key.endsWith('.lock') && key !== 'alert.fiscal_outbox_stuck.lock' ? '{requester},{table}' : '');
      expect(holes(EN[key]!), key).toBe(want);
    }
  });

  it('[brief §6.7; frame AnswerUrdu05] kind labels: the English copy, and the discount kind in Urdu as drawn', () => {
    expect(EN['alert.discount.card']).toBe('Discount · {identifier} · {amount} · {reason}');
    expect(EN['alert.discount.lock']).toBe('{table} · Discount · {requester}');
    expect(EN['alert.close_without_buyer_id.name']).toBe('No buyer details');
    expect(EN['alert.fiscal_outbox_stuck.help']).toBe('Tax invoices are not reaching the authority. Tell the owner.');
    expect(UR['alert.discount.name']).toBe('رعایت');
    expect(UR['alert.discount.lock']).toBe('{table} · رعایت · {requester}');
  });

  it('05-2 strings are not part of this task (task 43b)', () => {
    for (const key of [...BILLING_ERROR_KEYS_05_1, ...BILLING_KIND_KEYS_05_1]) {
      expect(key, key).not.toMatch(/PETTY|Z_REPORT|DAY_CLOSE|skip_not_granted|alert\.(petty_cash|shift_variance)\./);
    }
  });
});
