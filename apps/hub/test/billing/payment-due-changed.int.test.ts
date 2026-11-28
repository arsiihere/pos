// 05 v1.0.37 §6.9, §9 (owner 2026-11-28 QA-R2, R2-1; QA BUG-1 BLOCKER), tests #21c–#21e: `AddPayment` carries the due
// the cashier saw (`expected_due_minor`, required) — the due field the amount is held to, of the split before this
// payment. A changed bill (an "Add to token", another till's payment, a split plan) refuses the stale payment with
// `409 BILL_DUE_CHANGED { split_no, expected_minor, due_minor }` and writes nothing; a resend with the same command_id
// replays the stored reply (one payment). Real commands over HTTP through the hub's writer. Lassi = Rs 250.00, untaxed.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { noneAdapter } from '../../src/billing/fiscal/none';
import { registerFiscalAdapter, resetFiscalAdapters } from '../../src/billing/fiscal/port';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import type { TestHub } from '../helpers/test-hub';
import { appendOrder, drawerDevice, FX, post, signInOn, STAFF, startBilling, VX, type Reply, type Who } from './fixtures';

let hub: TestHub;
let cashier: Who;
let other: Who;

beforeEach(async () => {
  registerFiscalAdapter(noneAdapter);
  hub = await startBilling({ stock: { [FX.stock]: 1_000_000, [VX.naanStock]: 1_000 } });
  cashier = signInOn(hub, STAFF.cashier, drawerDevice(hub, 'Counter kiosk'));
  ok(await post(hub, cashier, 'open-shift', 'OpenShift', { float_minor: 0, as_drawer: true }));
  other = signInOn(hub, STAFF.manager, drawerDevice(hub, 'Second till'));
  ok(await post(hub, other, 'open-shift', 'OpenShift', { float_minor: 0, as_drawer: true }));
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
const payments = () => db().prepare('SELECT COUNT(*) FROM bill_payments WHERE removed_at IS NULL').pluck().get() as number;
const lassis = (n: number, adds_to_order_id?: string) =>
  appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.cashier, lines: [{ order_item_id: `L${Math.random().toString(36).slice(2, 8)}`, item_id: VX.drink, quantity: n }], ...(adds_to_order_id === undefined ? {} : { adds_to_order_id }) }).order_id;
const pay = (who: Who, order_id: string, p: { amount_minor: number; expected_due_minor?: number; tendered_minor?: number; split_no?: number; direction?: 'in' | 'out' }, commandId?: string) =>
  post(
    hub,
    who,
    'add-payment',
    'AddPayment',
    {
      bill_ref: { order_id },
      split_no: p.split_no ?? 1,
      mode_id: 'cash',
      direction: p.direction ?? 'in',
      amount_minor: p.amount_minor,
      ...(p.expected_due_minor === undefined ? {} : { expected_due_minor: p.expected_due_minor }),
      ...(p.tendered_minor === undefined ? {} : { tendered_minor: p.tendered_minor }),
    },
    commandId,
  );

describe('[05 v1.0.37 §6.9, #21c] AddPayment carries the due the cashier saw', () => {
  it('[05 #21c] expected = the split’s cash due → paid; ≠ → 409 BILL_DUE_CHANGED { split_no, expected_minor, due_minor }, nothing written', async () => {
    const order_id = lassis(2); // Rs 500
    const stale = await pay(cashier, order_id, { amount_minor: 20_000, expected_due_minor: 40_000 });
    expect(stale.status).toBe(409);
    expect(stale.error).toEqual({ code: 'BILL_DUE_CHANGED', details: { split_no: 1, expected_minor: 40_000, due_minor: 50_000 } });
    expect(stale.events).toEqual([]);
    expect(payments()).toBe(0);
    const paid = ok(await pay(cashier, order_id, { amount_minor: 20_000, expected_due_minor: 50_000 }));
    expect(paid.result).toMatchObject({ balance_minor: 30_000 });
    // the next payment is held to the due after the first
    expect((await pay(cashier, order_id, { amount_minor: 30_000, expected_due_minor: 50_000 })).error?.code).toBe('BILL_DUE_CHANGED');
    ok(await pay(cashier, order_id, { amount_minor: 30_000, expected_due_minor: 30_000 }));
    expect(payments()).toBe(2);
  });

  it('[05 #21c] a payload without expected_due_minor → 400 VALIDATION_FAILED (required)', async () => {
    const order_id = lassis(1);
    // raw inject: the shared `post` fixture fills the field as a client does
    const res = await hub.app.inject({
      method: 'POST',
      url: '/commands/add-payment',
      headers: { authorization: `Bearer ${cashier.token}`, 'x-session-token': cashier.sessionToken },
      payload: { command_id: 'raw-1', tenant_id: 'tenant-a', branch_id: 'branch-1', command_type: 'AddPayment', payload: { bill_ref: { order_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 25_000 }, occurred_at: hub.clock.branchNow(), actor_id: cashier.staffId, device_id: cashier.deviceId },
    });
    const r = { status: res.statusCode, error: (res.json() as { error?: { code: string } }).error };
    expect(r.status).toBe(400);
    expect(r.error?.code).toBe('VALIDATION_FAILED');
    expect(payments()).toBe(0);
  });

  it('[05 #21c] an out is held to its refund due the same way', async () => {
    const order_id = lassis(1);
    ok(await pay(cashier, order_id, { amount_minor: 25_000, expected_due_minor: 25_000 }));
    ok(await post(hub, cashier, 'close-split', 'CloseSplit', { bill_ref: { order_id }, split_no: 1, expected_total_minor: 25_000 }));
    const bill_id = db().prepare('SELECT bill_id FROM bills ORDER BY opened_at DESC LIMIT 1').pluck().get() as string;
    ok(await post(hub, other, 'reopen-bill', 'ReopenBill', { bill_id, reason_code: 'customer_returned_item' }));
    // nothing removed: the refund due of the reopened bill is 0, the stale screen thought 25 000
    const out = await post(hub, cashier, 'add-payment', 'AddPayment', { bill_ref: { bill_id }, split_no: 1, mode_id: 'cash', direction: 'out', amount_minor: 25_000, expected_due_minor: 25_000 });
    expect(out.status).toBe(409);
    expect(out.error).toEqual({ code: 'BILL_DUE_CHANGED', details: { split_no: 1, expected_minor: 25_000, due_minor: 0 } });
  });
});

describe('[05 v1.0.37 §6.9, #21d, #21e] R2-1 race: a stale pay panel after an "Add to token"', () => {
  it('[05 #21d, BUG-1] the panel read Rs 250; Rs 250 more is added to the token; the stale payment (tendered Rs 300) is refused with the new due and no change is owed', async () => {
    const root = lassis(1); // the panel reads: due 25 000
    lassis(1, root); // Add to token on another device
    const stale = await pay(cashier, root, { amount_minor: 25_000, expected_due_minor: 25_000, tendered_minor: 30_000 });
    expect(stale.status).toBe(409);
    expect(stale.error).toEqual({ code: 'BILL_DUE_CHANGED', details: { split_no: 1, expected_minor: 25_000, due_minor: 50_000 } });
    expect(payments()).toBe(0);
    expect(db().prepare('SELECT COALESCE(SUM(expected_cash_minor), 0) FROM shifts').pluck().get()).toBe(0);
    // the panel shows the new amount; the cashier takes it
    const paid = ok(await pay(cashier, root, { amount_minor: 50_000, expected_due_minor: 50_000, tendered_minor: 50_000 }));
    expect(paid.result).toMatchObject({ balance_minor: 0, change_due_minor: 0 });
  });

  it('[05 #21d] two tills on one token at once, both with the due they read: exactly one payment; the other is BILL_DUE_CHANGED (due 0)', async () => {
    const order_id = lassis(2);
    const [a, b] = await Promise.all([
      pay(cashier, order_id, { amount_minor: 50_000, expected_due_minor: 50_000 }),
      pay(other, order_id, { amount_minor: 50_000, expected_due_minor: 50_000 }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect([a, b].find((r) => r.status === 409)!.error).toEqual({ code: 'BILL_DUE_CHANGED', details: { split_no: 1, expected_minor: 50_000, due_minor: 0 } });
    expect(payments()).toBe(1);
  });

  it('[05 #21d] the payment and the addition sent at once: the payment lands first (then the addition is due) or it is refused — never paid against the old due after the addition', async () => {
    const root = lassis(1);
    const [r] = await Promise.all([pay(cashier, root, { amount_minor: 25_000, expected_due_minor: 25_000 }), Promise.resolve().then(() => lassis(1, root))]);
    const due = db().prepare('SELECT COUNT(*) FROM orders').pluck().get() as number;
    expect(due).toBe(2);
    if (r.status === 200) expect(r.result).toMatchObject({ balance_minor: 0 });
    else expect(r.error).toEqual({ code: 'BILL_DUE_CHANGED', details: { split_no: 1, expected_minor: 25_000, due_minor: 50_000 } });
  });

  it('[05 #21e] a resend with the same command_id after the bill changed replays the stored payment (one PaymentAdded); a new id with the old due is refused', async () => {
    const root = lassis(1);
    const first = ok(await pay(cashier, root, { amount_minor: 10_000, expected_due_minor: 25_000 }, 'pay-once'));
    lassis(1, root);
    const again = await pay(cashier, root, { amount_minor: 10_000, expected_due_minor: 25_000 }, 'pay-once');
    expect(again.status).toBe(200);
    expect(again.result).toEqual(first.result);
    expect(payments()).toBe(1);
    expect((await pay(cashier, root, { amount_minor: 10_000, expected_due_minor: 25_000 }, 'pay-twice')).error?.code).toBe('BILL_DUE_CHANGED');
    expect(payments()).toBe(1);
  });
});
