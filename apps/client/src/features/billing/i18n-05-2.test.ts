import { describe, expect, it } from 'vitest';
import { en } from '../../i18n/en';
import { ur } from '../../i18n/ur';
import { BILLING_ERROR_KEYS_05_2, BILLING_KIND_KEYS_05_2, billingErrorKey } from './errors';
import { TODO_05 } from './urdu-todo-05';

// 05 §8 "Errors" (every §9 code has an errors.<code> key, EN + UR, D12; DAY_CLOSE_BLOCKED reasons render as lists),
// §3.14 kinds petty_cash / shift_variance; brief §6.6–§6.8 copy (plan §4.1 task 43b: 05-2's codes and kinds).

const EN = en as Record<string, string>;
const UR = ur as Record<string, string | undefined>;
const holes = (text: string) => [...text.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort().join();

describe('[05 §8 Errors; §9] 05-2 error and kind strings (task 43b)', () => {
  it('every 05-2 key is in en, and in ur or 05/urdu-todo.md; Urdu keeps the placeholders', () => {
    const all = [...BILLING_ERROR_KEYS_05_2, ...BILLING_KIND_KEYS_05_2];
    expect(all).toContain('errors.DAY_CLOSE_BLOCKED.shift_open_one');
    expect(all).toContain('errors.DAY_CLOSE_BLOCKED.unbilled_orders_one');
    expect(all).toContain('errors.DAY_CLOSE_BLOCKED.variance_pending_one'); // G-77 (R-76)
    for (const key of all) {
      expect(EN[key], key).toBeTruthy();
      const u = UR[key];
      expect(u !== undefined || TODO_05.has(key), key).toBe(true);
      if (u !== undefined) expect(holes(u), key).toBe(holes(EN[key]!));
    }
  });

  it('[brief §6.6–§6.8] the English copy', () => {
    expect(EN['errors.PETTY_SETTLE_MISMATCH']).toBe('Spent and returned must add up to {amount}');
    expect(EN['errors.PETTY_CASH_NOT_FOUND']).toBe("This advance can't be found");
    expect(EN['errors.Z_REPORT_NOT_FOUND']).toBe("This Z report can't be found");
    expect(EN['errors.PETTY_ADVANCE_SETTLED']).toBe('Already settled');
    expect(EN['errors.DAY_CLOSE_BLOCKED.shift_open_one']).toBe('1 shift is still open — close it first');
    expect(EN['errors.DAY_CLOSE_BLOCKED.shift_open']).toBe('{count} shifts are still open — close them first');
    expect(EN['errors.DAY_CLOSE_BLOCKED.unbilled_orders']).toBe('{count} orders are not billed — bill them or carry them over');
    expect(EN['errors.DAY_CLOSE_BLOCKED.variance_pending']).toBe('{count} variance sign-offs are still pending — answer them first');
    expect(EN['errors.DAY_CLOSE_BLOCKED.variance_pending_one']).toBe('1 variance sign-off is still pending — answer it first');
    expect(EN['errors.PERMISSION_DENIED.skip_not_granted']).toBe("You can't skip the count");
    expect(EN['alert.shift_variance.card']).toBe('Shift variance · {requester} · {amount}');
    expect(EN['alert.shift_variance.reject']).toBe('Dispute');
    expect(EN['alert.petty_cash.lock']).toBe('Petty cash · {requester}');
    expect(EN['alerts.closed.day_closed']).toBe('Closed: day closed');
    // [review M2; frame DayCloseUrdu] the drawn Urdu is in ur.ts
    expect(UR['errors.DAY_CLOSE_BLOCKED.shift_open']).toBe('{count} شفٹیں ابھی کھلی ہیں — پہلے انہیں بند کریں');
    expect(TODO_05.has('errors.DAY_CLOSE_BLOCKED.shift_open')).toBe(false);
  });

  it('billingErrorKey: DAY_CLOSE_BLOCKED shift_open / unbilled_orders read their texts; void_pending keeps 04\'s; skip_not_granted', () => {
    expect(billingErrorKey('DAY_CLOSE_BLOCKED', { reason: 'shift_open', shifts: [], count: 2 })).toBe('errors.DAY_CLOSE_BLOCKED.shift_open');
    expect(billingErrorKey('DAY_CLOSE_BLOCKED', { reason: 'unbilled_orders', orders: [], count: 3 })).toBe('errors.DAY_CLOSE_BLOCKED.unbilled_orders');
    // [review M1] 04's own text for void_pending (brief §6.6 dayclose.blocked.voids), singular at count 1
    expect(billingErrorKey('DAY_CLOSE_BLOCKED', { reason: 'void_pending', count: 3 })).toBe('admin_stock.errors.DAY_CLOSE_BLOCKED');
    expect(billingErrorKey('DAY_CLOSE_BLOCKED', { reason: 'void_pending', count: 1 })).toBe('admin_stock.errors.DAY_CLOSE_BLOCKED_one');
    expect(billingErrorKey('DAY_CLOSE_BLOCKED', { reason: 'shift_open', shifts: [], count: 1 })).toBe('errors.DAY_CLOSE_BLOCKED.shift_open_one');
    expect(billingErrorKey('DAY_CLOSE_BLOCKED', { reason: 'unbilled_orders', orders: [], count: 1 })).toBe('errors.DAY_CLOSE_BLOCKED.unbilled_orders_one');
    // [G-77, R-76] variance_pending reads its own text, never 04's void text
    expect(billingErrorKey('DAY_CLOSE_BLOCKED', { reason: 'variance_pending', shifts: [], count: 2 })).toBe('errors.DAY_CLOSE_BLOCKED.variance_pending');
    expect(billingErrorKey('DAY_CLOSE_BLOCKED', { reason: 'variance_pending', shifts: [], count: 1 })).toBe('errors.DAY_CLOSE_BLOCKED.variance_pending_one');
    expect(billingErrorKey('PERMISSION_DENIED', { reason: 'skip_not_granted' })).toBe('errors.PERMISSION_DENIED.skip_not_granted');
    expect(billingErrorKey('PETTY_ADVANCE_SETTLED', { entry_id: 'E1' })).toBe('errors.PETTY_ADVANCE_SETTLED');
  });
});
