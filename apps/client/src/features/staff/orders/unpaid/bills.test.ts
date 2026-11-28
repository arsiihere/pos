import { describe, expect, it } from 'vitest';
import { parseBillRows, unpaidBills } from './candidate';

// ⚠️ 02b v1.0.27 §6.16, §8 (owner 2026-11-28 Q9): a token's orders grouped by `bill.key` — one Due and one request per
// unpaid, unapproved bill (never one bill's due added twice); an order without a key is its own bill.

describe('[02b v1.0.27 Q9] unpaidBills', () => {
  it('root + addition on one bill → one bill with its due once; another bill → its own; paid / approved bills left out', () => {
    const read = parseBillRows(
      {
        orders: [
          { order_id: 'R', order_type: 'takeaway', bill: { state: 'due', due_minor: 12_000, key: 'K1' } },
          { order_id: 'A', order_type: 'takeaway', bill: { state: 'due', due_minor: 12_000, key: 'K1' } },
          { order_id: 'B', order_type: 'takeaway', bill: { state: 'due', due_minor: 4_000, key: 'K2' } },
          { order_id: 'P', order_type: 'takeaway', bill: { state: 'paid', due_minor: 0, key: null } },
          { order_id: 'X', order_type: 'takeaway', bill: { state: 'due', due_minor: 900, key: 'K3' }, unpaid_handover_approved: true },
        ],
      },
      0,
    )!;
    expect(read.rows.get('R')!.bill).toEqual({ state: 'due', due_minor: 12_000, key: 'K1' });
    const bills = unpaidBills(['R', 'A', 'B', 'P', 'X'], (id) => read.rows.get(id), () => undefined);
    expect(bills).toEqual([
      { key: 'K1', order_ids: ['R', 'A'], due_minor: 12_000, addition: false },
      { key: 'K2', order_ids: ['B'], due_minor: 4_000, addition: true },
    ]);
  });

  it('a row without a key (an older hub) is its own bill; an approval this page knows covers its bill', () => {
    const rows = new Map([
      ['R', { order_type: 'takeaway', bill: { state: 'due' as const, due_minor: 500 } }],
      ['A', { order_type: 'takeaway', bill: { state: 'due' as const, due_minor: 700 } }],
    ]);
    expect(unpaidBills(['R', 'A'], (id) => rows.get(id), () => undefined).map((b) => b.order_ids)).toEqual([['R'], ['A']]);
    expect(unpaidBills(['R', 'A'], (id) => rows.get(id), (id) => (id === 'A' ? 700 : undefined)).map((b) => b.order_ids)).toEqual([['R']]);
  });
});
