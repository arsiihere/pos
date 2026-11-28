// 05 v1.0.39 §6.25 QM-3, 02b §3.3 Day close, §6.16 (owner 2026-11-28 QA-R3, BUG-9): a takeaway handed over unpaid (every live line
// served, an approved unpaid hand-over) whose bill is still Due stays an open order — listed by open-orders with its
// due ("Handed — owes") — until it is paid, across any number of day closes: carried at each close, it is never
// day-closed while its bill is unbilled. Real Close day → Start day rounds: three on following dates, two on one date
// (01a restart, R-85). Lassi = Rs 250.00, untaxed.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { noneAdapter } from '../../src/billing/fiscal/none';
import { registerFiscalAdapter, resetFiscalAdapters } from '../../src/billing/fiscal/port';
import { branchConfig, swapBranchConfig } from '../../src/sync/branch-config-holder';
import type { TestHub } from '../helpers/test-hub';
import { append } from '../voids/fixtures';
import { appendOrder, drawerDevice, FX, post, signIn, signInOn, STAFF, startBilling, VX, type Reply, type Who } from '../billing/fixtures';

let hub: TestHub;
let manager: Who;

beforeEach(async () => {
  registerFiscalAdapter(noneAdapter);
  hub = await startBilling({ stock: { [FX.stock]: 1_000_000, [VX.naanStock]: 1_000 } });
  const config = branchConfig()!;
  swapBranchConfig({ config: { ...config, day_min_gap_hours: 0 }, snapshotHash: 'h'.repeat(64), configVersion: config.config_version, snapshotSchemaVersion: 4, appliedAt: 0 });
  manager = signIn(hub, STAFF.manager);
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

type Row = { order_id: string; bill?: { state: string; due_minor: number } | null; handed?: { n: number; m: number } };
async function openOrders(): Promise<Row[]> {
  const res = await hub.app.inject({ method: 'GET', url: '/queries/open-orders?order_type=all', headers: { authorization: `Bearer ${manager.token}`, 'x-session-token': manager.sessionToken } });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { data: { orders: Row[] } }).data.orders;
}

/** A shift on a new drawer kiosk: open it, run `f`, count it (cash only) so the day may close. */
async function inShift(f: (cashier: Who) => Promise<void>): Promise<void> {
  const cashier = signInOn(hub, STAFF.cashier, drawerDevice(hub, `Kiosk ${Math.random()}`));
  ok(await post(hub, cashier, 'open-shift', 'OpenShift', { float_minor: 0, as_drawer: true }));
  await f(cashier);
  const shift = db().prepare(`SELECT shift_id FROM shifts WHERE state = 'open'`).pluck().get() as string;
  const cash = db().prepare(`SELECT COALESCE(SUM(CASE direction WHEN 'in' THEN amount_minor ELSE -amount_minor END), 0) FROM bill_payments WHERE shift_id = ? AND removed_at IS NULL`).pluck().get(shift) as number;
  ok(await post(hub, cashier, 'count-shift', 'CountShift', { shift_id: shift, counted_minor: cash }));
}

/** Close day (carrying every order the close lists), then Start day. */
async function closeAndStart(advance_ms = 86_400_000): Promise<string[]> {
  const blocked = await post(hub, manager, 'close-business-day', 'CloseBusinessDay', {});
  const listed: string[] = [];
  if (blocked.status === 409) {
    const details = (blocked.error as unknown as { details: { reason: string; orders?: Array<{ order_ids: string[] }> } }).details;
    expect(details.reason).toBe('unbilled_orders');
    for (const o of details.orders ?? []) listed.push(...o.order_ids);
    ok(await post(hub, manager, 'carry-over-orders', 'CarryOverOrders', { order_ids: listed, reason_code: 'customer_will_pay_later' }));
    ok(await post(hub, manager, 'close-business-day', 'CloseBusinessDay', {}));
  } else ok(blocked);
  hub.clock.advance(advance_ms);
  manager = signIn(hub, STAFF.manager); // later: a fresh session
  ok(await post(hub, manager, 'open-business-day', 'OpenBusinessDay', {}));
  return listed;
}

describe('[05 v1.0.39 §6.25 QM-3, #63h] Handed — owes survives every day close until paid (BUG-9)', () => {
  it('[05 #63h] handed over unpaid, Rs 100 of Rs 250 paid → listed with Rs 150 due after the first and the second Close day → Start day; gone once paid', async () => {
    const line = 'HO_L';
    const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: line, item_id: VX.drink }] });
    await inShift(async (cashier) => {
      ok(await post(hub, cashier, 'add-payment', 'AddPayment', { bill_ref: { order_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 10_000 }));
    });
    append(hub, [
      { stream_type: 'order', stream_id: order_id, event_type: 'UnpaidHandoverApproved', payload: { order_id, alert_id: 'AL-HO', approved_by_staff_id: STAFF.manager, due_minor: 15_000 } },
      { stream_type: 'order', stream_id: order_id, event_type: 'ItemServed', payload: { order_item_ids: [line], source: 'tap' } },
    ]);
    const owes = async () => (await openOrders()).find((o) => o.order_id === order_id);
    expect(await owes()).toMatchObject({ bill: { state: 'due', due_minor: 15_000 }, handed: { n: 1, m: 1 } });

    expect(await closeAndStart()).toEqual([order_id]);
    expect(await owes()).toMatchObject({ bill: { state: 'due', due_minor: 15_000 }, handed: { n: 1, m: 1 } });

    expect(await closeAndStart()).toEqual([order_id]);
    expect(await owes()).toMatchObject({ bill: { state: 'due', due_minor: 15_000 }, handed: { n: 1, m: 1 } });

    expect(await closeAndStart()).toEqual([order_id]);
    expect(await owes()).toMatchObject({ bill: { state: 'due', due_minor: 15_000 } });

    // a Close day → Start day again the same calendar date (the same business date: 01a's restart)
    const date = hub.deps.state.get().business_day!.business_date;
    expect(await closeAndStart(60_000)).toEqual([order_id]);
    expect(hub.deps.state.get().business_day!.business_date).toBe(date);
    expect(await owes()).toMatchObject({ bill: { state: 'due', due_minor: 15_000 } });
    expect(await closeAndStart(60_000)).toEqual([order_id]);
    expect(await owes()).toMatchObject({ bill: { state: 'due', due_minor: 15_000 } });

    await inShift(async (cashier) => {
      ok(await post(hub, cashier, 'add-payment', 'AddPayment', { bill_ref: { order_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 15_000 }));
      ok(await post(hub, cashier, 'close-split', 'CloseSplit', { bill_ref: { order_id }, split_no: 1, expected_total_minor: 25_000 }));
    });
    expect(await owes()).toBeUndefined();
  });
});
