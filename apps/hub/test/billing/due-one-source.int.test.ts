// 05 v1.0.37 §6.2, §6.2a (owner 2026-11-28 QA-R2, BUG-3), test #60m: one "due" for a bill or token, on every surface —
// keyBalances (02b open-orders `bill.due_minor`: the Pass card, the takeaway rail), the cash desk's open-bills row, the
// unpaid hand-over request amount and the bill page's open splits all read Σ the open splits' balances (D3). A split
// token with payments on both open splits and an addition after them (the QA #4 shape: never "open total − one split's
// payments"). Real commands over HTTP. Lassi = Rs 250.00, untaxed.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { noneAdapter } from '../../src/billing/fiscal/none';
import { registerFiscalAdapter, resetFiscalAdapters } from '../../src/billing/fiscal/port';
import type { BillView } from '../../src/billing/queries/bill';
import { keyBalances } from '../../src/billing/queries/key-balances';
import type { OpenBillRow } from '../../src/billing/queries/open-bills';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import type { TestHub } from '../helpers/test-hub';
import { appendOrder, drawerDevice, FX, post, signInOn, STAFF, startBilling, VX, type Reply, type Who } from './fixtures';

let hub: TestHub;
let cashier: Who;

beforeEach(async () => {
  registerFiscalAdapter(noneAdapter);
  hub = await startBilling({ stock: { [FX.stock]: 1_000_000, [VX.naanStock]: 1_000 } });
  cashier = signInOn(hub, STAFF.cashier, drawerDevice(hub, 'Counter kiosk'));
  ok(await post(hub, cashier, 'open-shift', 'OpenShift', { float_minor: 0, as_drawer: true }));
});

afterEach(async () => {
  swapBranchConfig(null);
  resetFiscalAdapters();
  await hub?.close();
  hub = undefined as unknown as TestHub;
});

function ok(r: Reply): Reply {
  expect(r.status, JSON.stringify(r.error)).toBe(200);
  return r;
}
const db = () => hub.deps.db;
async function get<T>(url: string): Promise<T> {
  const res = await hub.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${cashier.token}`, 'x-session-token': cashier.sessionToken } });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { data: T }).data;
}
const lassis = (n: number, line: string, adds_to_order_id?: string) =>
  appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.cashier, lines: [{ order_item_id: line, item_id: VX.drink, quantity: n }], ...(adds_to_order_id === undefined ? {} : { adds_to_order_id }) }).order_id;

/** Every surface's due of the token whose root is `root`. */
async function dues(root: string, orders: string[]) {
  const key = db().prepare('SELECT bill_key FROM orders WHERE order_id = ?').pluck().get(root) as string;
  const view = await get<BillView>(`/queries/bill?order_id=${orders.at(-1)!}`);
  const row = (await get<{ bills: OpenBillRow[] }>('/queries/open-bills')).bills.find((b) => b.order_id === root)!;
  const open = await get<{ orders: Array<{ order_id: string; bill?: { due_minor: number } | null }> }>('/queries/open-orders?order_type=all');
  return {
    bill_page: view.splits.filter((s) => s.state === 'open').reduce((n, s) => n + s.balance_minor, 0),
    key_balances: keyBalances(db(), [key]).get(key)!.due_minor,
    cash_desk: row.due_minor,
    cash_desk_left: row.open_total_minor - row.open_paid_minor,
    open_orders: orders.map((id) => open.orders.find((o) => o.order_id === id)?.bill?.due_minor),
  };
}

describe('[05 v1.0.37 §6.2, §6.2a, #60m] one due on every surface (BUG-3)', () => {
  it('[05 #60m] Rs 1,000 split equal in 2, Rs 400 paid on split 1 and Rs 100 on split 2 → Rs 500 everywhere; an addition of Rs 250 → Rs 750 everywhere; the request asks Rs 750', async () => {
    const root = lassis(4, 'D1');
    ok(await post(hub, cashier, 'set-splits', 'SetSplits', { bill_ref: { order_id: root }, mode: 'equal', n: 2 }));
    ok(await post(hub, cashier, 'add-payment', 'AddPayment', { bill_ref: { order_id: root }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 40_000 }));
    ok(await post(hub, cashier, 'add-payment', 'AddPayment', { bill_ref: { order_id: root }, split_no: 2, mode_id: 'cash', direction: 'in', amount_minor: 10_000, tendered_minor: 20_000 }));
    const before = await dues(root, [root]);
    expect(before).toEqual({ bill_page: 50_000, key_balances: 50_000, cash_desk: 50_000, cash_desk_left: 50_000, open_orders: [50_000] });

    const add = lassis(1, 'D2', root);
    const after = await dues(root, [root, add]);
    expect(after).toEqual({ bill_page: 75_000, key_balances: 75_000, cash_desk: 75_000, cash_desk_left: 75_000, open_orders: [75_000, 75_000] });

    ok(await post(hub, cashier, 'request-unpaid-handover', 'RequestUnpaidHandover', { order_id: add }));
    const values = JSON.parse(db().prepare(`SELECT values_json FROM alerts WHERE kind = 'hand_over_unpaid' AND state = 'open'`).pluck().get() as string) as { due_minor: number };
    expect(values.due_minor).toBe(75_000);
  });

  it('[05 #60m] split 1 (Rs 530) paid and closed, split 2 (Rs 470) with Rs 130 paid → Rs 340: the due is the open split’s balance, never the open total less split 1’s payments', async () => {
    const root = lassis(4, 'D3'); // Rs 1,000
    ok(await post(hub, cashier, 'set-splits', 'SetSplits', { bill_ref: { order_id: root }, mode: 'amount', splits: [{ split_no: 1, share_minor: 53_000 }, { split_no: 2, share_minor: 47_000 }] }));
    ok(await post(hub, cashier, 'add-payment', 'AddPayment', { bill_ref: { order_id: root }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 53_000 }));
    ok(await post(hub, cashier, 'close-split', 'CloseSplit', { bill_ref: { order_id: root }, split_no: 1, expected_total_minor: 53_000 }));
    ok(await post(hub, cashier, 'add-payment', 'AddPayment', { bill_ref: { order_id: root }, split_no: 2, mode_id: 'cash', direction: 'in', amount_minor: 13_000 }));
    expect(await dues(root, [root])).toEqual({ bill_page: 34_000, key_balances: 34_000, cash_desk: 34_000, cash_desk_left: 34_000, open_orders: [34_000] });
  });
});
