// 05 v1.0.39 §6.2, §6.2a, §6.25 (owner 2026-11-28 QA-R3, BUG-2), test #60n: the QA repro — a Rs 40 pay-later token
// split equally in 3 (Rs 13 / 13 / 14), split 3 closed in cash (Rs 14, given Rs 20), then split 1 closed by card (Rs 13,
// ref 9999). Every surface asks Rs 13, the bill page's own number: the cash desk row, open-orders' `bill.due_minor`
// (counter Ready tile, Pass card, rail), the unpaid hand-over request amount and the Close-day not-paid list. Never
// "Rs 26" (= 40 − 14: a card-closed split ignored). Real commands over HTTP.
import { SnapshotBillingSchema } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hubBilling } from '../../src/billing/defaults';
import { noneAdapter } from '../../src/billing/fiscal/none';
import { registerFiscalAdapter, resetFiscalAdapters } from '../../src/billing/fiscal/port';
import type { BillView } from '../../src/billing/queries/bill';
import { keyBalances } from '../../src/billing/queries/key-balances';
import type { OpenBillRow } from '../../src/billing/queries/open-bills';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import type { TestHub } from '../helpers/test-hub';
import { openDay, voidsMenu } from '../voids/fixtures';
import { appendOrder, drawerDevice, FX, post, signIn, signInOn, STAFF, startBilling, VX, type Reply, type Who } from './fixtures';

let hub: TestHub;
let cashier: Who;

function menu() {
  const base = voidsMenu();
  const pk = hubBilling({ currency_code: 'PKR', tax_classes: [], billing: undefined });
  return {
    ...base,
    items: base.items.map((i) => (i.item_id === FX.naan ? { ...i, price_minor: 4_000 } : i)),
    billing: SnapshotBillingSchema.parse({
      ...pk.settings,
      payment_modes: [...pk.settings.payment_modes, { mode_id: 'card', name: 'Card', kind: 'card', payment_class: 'digital', reference_required: true, is_active: true, sort_order: 1, authority_codes: [] }],
      jurisdiction: pk.jurisdiction,
      tax_profiles: [],
    }),
  };
}

beforeEach(async () => {
  registerFiscalAdapter(noneAdapter);
  hub = await startBilling({ open: false });
  openDay(hub, { menu: menu(), stock: { [FX.stock]: 1_000_000, [VX.naanStock]: 1_000 } });
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

/** The QA flow up to the two closes (3 in cash, then 1 by card); the token's root order id. */
async function repro(): Promise<string> {
  const root = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.cashier, lines: [{ order_item_id: 'N14', item_id: FX.naan }] }).order_id;
  const ref = { order_id: root };
  ok(await post(hub, cashier, 'set-splits', 'SetSplits', { bill_ref: ref, mode: 'equal', n: 3 }));
  const view0 = await get<BillView>(`/queries/bill?order_id=${root}`);
  expect(view0.splits.map((s) => s.totals.as_paid.total_minor)).toEqual([1_300, 1_300, 1_400]);
  ok(await post(hub, cashier, 'add-payment', 'AddPayment', { bill_ref: ref, split_no: 3, mode_id: 'cash', direction: 'in', amount_minor: 1_400, tendered_minor: 2_000 }));
  ok(await post(hub, cashier, 'close-split', 'CloseSplit', { bill_ref: ref, split_no: 3, expected_total_minor: 1_400 }));
  ok(await post(hub, cashier, 'add-payment', 'AddPayment', { bill_ref: ref, split_no: 1, mode_id: 'card', direction: 'in', amount_minor: 1_300, reference: '9999' }));
  ok(await post(hub, cashier, 'close-split', 'CloseSplit', { bill_ref: ref, split_no: 1, expected_total_minor: 1_300 }));
  return root;
}

describe('[05 v1.0.39 §6.2, §6.2a, §6.25, #60n] a split closed by card counts on every surface (BUG-2)', () => {
  it('[05 #60n] Rs 40 equal in 3, split 3 cash-closed then split 1 card-closed → Rs 13 on the bill page, cash desk, open-orders, keyBalances', async () => {
    const root = await repro();
    const key = db().prepare('SELECT bill_key FROM orders WHERE order_id = ?').pluck().get(root) as string;
    const view = await get<BillView>(`/queries/bill?order_id=${root}`);
    const row = (await get<{ bills: OpenBillRow[] }>('/queries/open-bills')).bills.find((b) => b.order_id === root)!;
    const open = await get<{ orders: Array<{ order_id: string; bill?: { due_minor: number } | null }> }>('/queries/open-orders?order_type=all');
    expect({
      bill_page: view.splits.filter((s) => s.state === 'open').reduce((n, s) => n + s.balance_minor, 0),
      key_balances: keyBalances(db(), [key]).get(key)!.due_minor,
      cash_desk: row.due_minor,
      cash_desk_left: row.open_total_minor - row.open_paid_minor,
      open_orders: open.orders.find((o) => o.order_id === root)?.bill?.due_minor,
    }).toEqual({ bill_page: 1_300, key_balances: 1_300, cash_desk: 1_300, cash_desk_left: 1_300, open_orders: 1_300 });
  });

  it('[05 #60n] the unpaid hand-over request asks Rs 13', async () => {
    const root = await repro();
    ok(await post(hub, cashier, 'request-unpaid-handover', 'RequestUnpaidHandover', { order_id: root }));
    const values = JSON.parse(db().prepare(`SELECT values_json FROM alerts WHERE kind = 'hand_over_unpaid' AND state = 'open'`).pluck().get() as string) as { due_minor: number };
    expect(values.due_minor).toBe(1_300);
  });

  it('[05 #60n] Close day: the not-paid list (the carry dialog\'s rows) asks Rs 13', async () => {
    const root = await repro();
    ok(await post(hub, cashier, 'count-shift', 'CountShift', { shift_id: db().prepare('SELECT shift_id FROM shifts WHERE closed_at IS NULL').pluck().get(), counted_minor: 1_400 }));
    hub.clock.advance(5 * 3_600_000); // 01a's built-in 4 h minimum gap
    const manager = signIn(hub, STAFF.manager);
    const r = await post(hub, manager, 'close-business-day', 'CloseBusinessDay', {});
    expect(r.status, JSON.stringify(r)).toBe(409);
    expect(r.error).toMatchObject({ code: 'DAY_CLOSE_BLOCKED', details: { reason: 'unbilled_orders', orders: [{ order_id: root, total_minor: 1_300, due_minor: 1_300 }] } });
  });
});
