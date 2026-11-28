import { describe, expect, it } from 'vitest';
import { createPermissions } from './permissions';
import { visibleScreens } from './screens';

// ⚠️ 02b v1.0.26 §8 (owner 2026-11-28 Q11; QA BUG-18): the order-taking screens (Takeaway, Parking) are hidden for a
// person without `take-order` (e.g. the default Cook); the table map stays (waiters serve and clear without it). 05a
// §3.6 O-16: no read-only screens.

const as = (...allowed: string[]) => createPermissions(Object.fromEntries(allowed.map((p) => [p, { grant: 'allowed', scope: 'branch' }])) as never);
const ALL = ['takeaway', 'parking', 'dine_in', 'cashier', 'pass', 'manager'];

describe('[02b v1.0.26 §8 Q11] order-taking screens need take-order', () => {
  it('a Cook (run-pass, reprint-ticket) sees the table map and the Pass, no order-taking screen', () => {
    expect(visibleScreens(ALL, as('run-pass', 'reprint-ticket'))).toEqual(['dine_in', 'pass']);
  });
  it('a Cashier (take-order, take-payment) keeps Takeaway, Parking, Dine-in and the cash desk', () => {
    expect(visibleScreens(ALL, as('take-order', 'take-payment'))).toEqual(['takeaway', 'parking', 'dine_in', 'cashier']);
  });
  it('a waiter (mark-served, clean-table) keeps the table map, not the order-taking screens', () => {
    expect(visibleScreens(ALL, as('mark-served', 'clean-table'))).toEqual(['dine_in']);
  });
});
