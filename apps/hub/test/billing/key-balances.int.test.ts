// 05 v1.0.35 §6.2a `keyBalances(db, bill_keys)` (task B1-3; ⚠️ run 3 R3-B-1, D3) and §6.2 open-bills `due_minor`, test #60e.
// Due of a key = Σ over its OPEN splits of that split's balance (the split's total less its own net payments); closed
// splits add 0; never "open total − bill-wide payments". Before pending voids (as §6.2). One statement for every key, 0
// for []. Real commands over HTTP (OpenShift, AddPayment, RemovePayment, SetSplits, CloseSplit, ReopenBill, RemoveItems)
// through the hub's real writer and folds. Lassi = Rs 250.00, untaxed, no takeaway service charge.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { noneAdapter } from '../../src/billing/fiscal/none';
import { registerFiscalAdapter, resetFiscalAdapters } from '../../src/billing/fiscal/port';
import type { BillView } from '../../src/billing/queries/bill';
import { keyBalances } from '../../src/billing/queries/key-balances';
import type { OpenBillRow } from '../../src/billing/queries/open-bills';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import type { TestHub } from '../helpers/test-hub';
import { append } from '../voids/fixtures';
import {
  appendOrder,
  compedLine,
  drawerDevice,
  FX,
  post,
  raiseVoid,
  signIn,
  signInOn,
  STAFF,
  startBilling,
  VX,
  type Reply,
  type Who,
} from './fixtures';

let hub: TestHub;
let cashier: Who;
let manager: Who;
let taker: Who;

beforeEach(async () => {
  registerFiscalAdapter(noneAdapter);
  hub = await startBilling({ stock: { [FX.stock]: 1_000_000, [VX.naanStock]: 1_000 } });
  cashier = signInOn(hub, STAFF.cashier, drawerDevice(hub, 'Counter kiosk'));
  ok(await post(hub, cashier, 'open-shift', 'OpenShift', { float_minor: 0, as_drawer: true }));
  manager = signIn(hub, STAFF.manager);
  taker = signIn(hub, STAFF.orderTaker);
});

afterEach(async () => {
  swapBranchConfig(null);
  resetFiscalAdapters();
  await hub?.close();
  hub = undefined as unknown as TestHub;
});

const db = () => hub.deps.db;

function ok(r: Reply): Reply {
  expect(r.status, JSON.stringify(r.error)).toBe(200);
  return r;
}

let seq = 0;
/** A takeaway of `n` lassis (Rs 250.00 each) placed by the order taker; its bill_key. */
function lassis(n: number): { order_id: string; line: string; key: string } {
  seq += 1;
  const line = `KB${seq}_L`;
  const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: line, item_id: VX.drink, quantity: n }] });
  return { order_id, line, key: keyOf(order_id) };
}

const keyOf = (order_id: string) => db().prepare('SELECT bill_key FROM orders WHERE order_id = ?').pluck().get(order_id) as string;
const billOf = (order_id: string) => db().prepare('SELECT bill_id FROM bills WHERE table_key = ? ORDER BY opened_at DESC LIMIT 1').pluck().get(keyOf(order_id)) as string;

const pay = (order_id: string, split_no: number, amount_minor: number) =>
  post(hub, cashier, 'add-payment', 'AddPayment', { bill_ref: { order_id }, split_no, mode_id: 'cash', direction: 'in', amount_minor }).then(ok);
const close = (order_id: string, split_no: number, expected_total_minor: number) =>
  post(hub, cashier, 'close-split', 'CloseSplit', { bill_ref: { order_id }, split_no, expected_total_minor }).then(ok);

async function view(order_id: string): Promise<BillView> {
  const res = await hub.app.inject({ method: 'GET', url: `/queries/bill?order_id=${order_id}`, headers: { authorization: `Bearer ${cashier.token}`, 'x-session-token': cashier.sessionToken } });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { data: BillView }).data;
}

async function openBills(): Promise<OpenBillRow[]> {
  const res = await hub.app.inject({ method: 'GET', url: '/queries/open-bills', headers: { authorization: `Bearer ${cashier.token}`, 'x-session-token': cashier.sessionToken } });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { data: { bills: OpenBillRow[] } }).data.bills;
}

/** keyBalances with its statement count. */
function balances(keys: string[]): { map: ReturnType<typeof keyBalances>; statements: number } {
  const counter = statementCounter(db());
  const before = counter.count;
  const map = keyBalances(db(), keys);
  return { map, statements: counter.count - before };
}

/** Two Rs 500.00 amount splits on a Rs 1,000.00 takeaway; split 1 paid and closed, split 2 untouched. */
async function twoSplitsFirstClosed(): Promise<{ order_id: string; key: string }> {
  const t = lassis(4);
  ok(await post(hub, cashier, 'set-splits', 'SetSplits', { bill_ref: { order_id: t.order_id }, mode: 'amount', splits: [{ split_no: 1, share_minor: 50_000 }, { split_no: 2, share_minor: 50_000 }] }));
  await pay(t.order_id, 1, 50_000);
  await close(t.order_id, 1, 50_000);
  return t;
}

describe('[05 v1.0.36 §6.2, QA BUG-16] the cash desk row shows the bill page’s numbers (one computeBill)', () => {
  it('[05 §6.2 BUG-16] split 1 (Rs 400) closed, split 2 (Rs 600) with Rs 300 paid → row Rs 600 · Paid 300 · Left 300 = the open split on the bill page', async () => {
    const t = lassis(4);
    ok(await post(hub, cashier, 'set-splits', 'SetSplits', { bill_ref: { order_id: t.order_id }, mode: 'amount', splits: [{ split_no: 1, share_minor: 40_000 }, { split_no: 2, share_minor: 60_000 }] }));
    await pay(t.order_id, 1, 40_000);
    await close(t.order_id, 1, 40_000);
    await pay(t.order_id, 2, 30_000);
    const v = await view(t.order_id);
    const open = v.splits.filter((s) => s.state === 'open');
    const openPaid = open.reduce((a, s) => a + s.payments.reduce((b, p) => b + (p.direction === 'in' ? p.amount_minor : -p.amount_minor), 0), 0);
    const row = (await openBills()).find((r) => r.order_id === t.order_id)!;
    expect(row).toMatchObject({ open_total_minor: 60_000, open_paid_minor: 30_000, due_minor: 30_000, paid_minor: 70_000 });
    expect([row.open_total_minor, row.open_paid_minor, row.due_minor]).toEqual([open.reduce((a, s) => a + s.totals.as_paid.total_minor, 0), openPaid, open.reduce((a, s) => a + s.balance_minor, 0)]);
    expect(row.open_total_minor - row.open_paid_minor).toBe(row.due_minor);
  });

  it('[05 §6.2 BUG-16, BUG-1] Rs 1,000 equal in 3, split 1 closed at 333: the row is Rs 667 · Left 667 = the bill page (333 + 334)', async () => {
    const t = lassis(4);
    ok(await post(hub, cashier, 'set-splits', 'SetSplits', { bill_ref: { order_id: t.order_id }, mode: 'equal', n: 3 }));
    expect((await view(t.order_id)).splits.map((s) => s.totals.as_paid.total_minor)).toEqual([33_300, 33_300, 33_400]);
    await pay(t.order_id, 1, 33_300);
    await close(t.order_id, 1, 33_300);
    const v = await view(t.order_id);
    expect(v.splits.filter((s) => s.state === 'open').map((s) => s.totals.as_paid.total_minor)).toEqual([33_300, 33_400]);
    expect(v.totals_default.total_minor).toBe(66_700);
    const row = (await openBills()).find((r) => r.order_id === t.order_id)!;
    expect(row).toMatchObject({ total_default_minor: 66_700, open_total_minor: 66_700, open_paid_minor: 0, due_minor: 66_700 });
    expect(balances([t.key]).map.get(t.key)).toEqual({ due_minor: 66_700, state: 'partly_paid' });
  });
});

describe('[05 §6.2a, #60e] keyBalances = Σ open split balances (D3)', () => {
  it('[05 #60e, D3] two Rs 500 splits, the first paid and closed, the second untouched → due Rs 500, partly_paid; open-bills shows the same due', async () => {
    const t = await twoSplitsFirstClosed();
    const v = await view(t.order_id);
    expect(v.state).toBe('partly_paid');
    expect(v.splits.map((s) => [s.split_no, s.state, s.balance_minor])).toEqual([[1, 'closed', 0], [2, 'open', 50_000]]);
    const { map, statements } = balances([t.key]);
    expect(map.get(t.key)).toEqual({ due_minor: 50_000, state: 'partly_paid' });
    expect(statements).toBe(1);
    const row = (await openBills()).find((r) => r.order_id === t.order_id)!;
    expect(row).toMatchObject({ state: 'partly_paid', due_minor: 50_000, paid_minor: 50_000 });
  });

  it('[05 #60e, D3] one Rs 1,000 split with Rs 600 paid → due Rs 400 (bill open); still Rs 400 after adding and removing a second payment; open-bills agrees', async () => {
    const t = lassis(4);
    await pay(t.order_id, 1, 60_000);
    // §3.2: the bill stays OPEN until a split closes; the due is the split's own balance
    expect(balances([t.key]).map.get(t.key)).toEqual({ due_minor: 40_000, state: 'open' });
    const second = await pay(t.order_id, 1, 10_000);
    expect(balances([t.key]).map.get(t.key)).toEqual({ due_minor: 30_000, state: 'open' });
    ok(await post(hub, cashier, 'remove-payment', 'RemovePayment', { payment_id: second.result!['payment_id'], reason_code: 'wrong_amount' }));
    expect(balances([t.key]).map.get(t.key)).toEqual({ due_minor: 40_000, state: 'open' });
    expect((await view(t.order_id)).splits[0]!.balance_minor).toBe(40_000);
    expect((await openBills()).find((r) => r.order_id === t.order_id)).toMatchObject({ due_minor: 40_000, paid_minor: 60_000 });
  });

  it('[05 #60e] projected key: gross total, state projected; an opened bill with no payment: open; equals the bill view', async () => {
    const projected = lassis(3);
    const opened = lassis(2);
    ok(await post(hub, cashier, 'set-splits', 'SetSplits', { bill_ref: { order_id: opened.order_id }, mode: 'none' }));
    const { map } = balances([projected.key, opened.key]);
    expect(map.get(projected.key)).toEqual({ due_minor: 75_000, state: 'projected' });
    expect(map.get(opened.key)).toEqual({ due_minor: 50_000, state: 'open' });
    expect((await view(projected.order_id)).totals_default.total_minor).toBe(75_000);
    const rows = await openBills();
    expect(rows.find((r) => r.order_id === projected.order_id)).toMatchObject({ state: 'projected', due_minor: 75_000 });
    expect(rows.find((r) => r.order_id === opened.order_id)).toMatchObject({ state: 'open', due_minor: 50_000 });
  });

  it('[05 #60e] comped to zero on an open bill → due 0, open; every order billed or cancelled → none; an unknown key → none', async () => {
    const comped = compedLine(hub, { units: 3, value_minor: 9_000 });
    const key = keyOf(comped.order_id);
    ok(await post(hub, cashier, 'set-splits', 'SetSplits', { bill_ref: { order_id: comped.order_id }, mode: 'none' }));
    expect(balances([key]).map.get(key)).toEqual({ due_minor: 0, state: 'open' });
    await close(comped.order_id, 1, 0); // the last close bills its order
    const cancelled = lassis(1);
    append(hub, [{ stream_type: 'order', stream_id: cancelled.order_id, event_type: 'OrderCancelled', payload: { order_id: cancelled.order_id } }]);
    const { map } = balances([key, cancelled.key, 'K_UNKNOWN']);
    expect([...map.entries()]).toEqual([
      [key, { due_minor: 0, state: 'none' }],
      [cancelled.key, { due_minor: 0, state: 'none' }],
      ['K_UNKNOWN', { due_minor: 0, state: 'none' }],
    ]);
  });

  it('[05 #60e] a reopened bill with a lower total keeps its negative balance', async () => {
    const t = lassis(2);
    await pay(t.order_id, 1, 50_000);
    await close(t.order_id, 1, 50_000);
    ok(await post(hub, manager, 'reopen-bill', 'ReopenBill', { bill_id: billOf(t.order_id), reason_code: 'customer_returned_item' }));
    ok(await post(hub, manager, 'remove-items', 'RemoveItems', { order_id: t.order_id, lines: [{ order_item_id: t.line, units: 1 }] }));
    expect((await view(t.order_id)).splits.find((s) => s.state === 'open')!.balance_minor).toBe(-25_000);
    expect(balances([t.key]).map.get(t.key)).toEqual({ due_minor: -25_000, state: 'open' });
    expect((await openBills()).find((r) => r.order_id === t.order_id)).toMatchObject({ due_minor: -25_000 });
  });

  it('[05 #60e, §6.2] pending voids are not subtracted (before pending voids, as open-bills)', async () => {
    const t = lassis(4);
    const before = balances([t.key]).map.get(t.key);
    raiseVoid(hub, { requester: taker, order_id: t.order_id, order_item_id: t.line, units: 1 });
    expect(balances([t.key]).map.get(t.key)).toEqual(before);
    expect(before).toEqual({ due_minor: 100_000, state: 'projected' });
  });

  it('[05 #60e] [] → empty map, 0 statements; 1 and 300 keys → 1 statement, every asked key present', async () => {
    expect(balances([])).toEqual({ map: new Map(), statements: 0 });
    const first = await twoSplitsFirstClosed();
    expect(balances([first.key]).statements).toBe(1);
    const keys = [first.key];
    for (let i = 0; i < 299; i += 1) keys.push(lassis(1 + (i % 3)).key);
    const { map, statements } = balances(keys);
    expect(statements).toBe(1);
    expect(map.size).toBe(300);
    expect(map.get(first.key)).toEqual({ due_minor: 50_000, state: 'partly_paid' });
    keys.slice(1).forEach((k, i) => expect(map.get(k)).toEqual({ due_minor: 25_000 * (1 + (i % 3)), state: 'projected' }));
  });
});
