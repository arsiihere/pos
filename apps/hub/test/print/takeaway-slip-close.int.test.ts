import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { noneAdapter } from '../../src/billing/fiscal/none';
import { registerFiscalAdapter, resetFiscalAdapters } from '../../src/billing/fiscal/port';
import { branchConfig, swapBranchConfig } from '../../src/sync/branch-config-holder';
import type { TestHub } from '../helpers/test-hub';
import { append as kdsAppend } from '../kds/fixtures';
import { appendOrder, drawerDevice, FX, post, signInOn, STAFF, startBilling, VX, type Reply, type Who } from '../billing/fixtures';

// 03c v1.0.16 §3.11 (Send & pay, race with a close), §6.14; tests 61 and 66 (races): the token slip next to 05's
// receipt through the real AddPayment / CloseSplit. L-ORDERS-1 S-3.

let hub: TestHub;
let cashier: Who;

beforeEach(async () => {
  registerFiscalAdapter(noneAdapter);
  hub = await startBilling({ stock: { [FX.stock]: 1_000_000, [VX.naanStock]: 1_000 } });
  const config = branchConfig()!;
  swapBranchConfig({ config: { ...config, day_min_gap_hours: 0 }, snapshotHash: 'h'.repeat(64), configVersion: config.config_version, snapshotSchemaVersion: 4, appliedAt: 0 });
  cashier = signInOn(hub, STAFF.cashier, drawerDevice(hub, 'Counter kiosk'));
  ok(await post(hub, cashier, 'open-shift', 'OpenShift', { float_minor: 0, as_drawer: true }));
  const branch = hub.deps.config.provisioned!.branch_id;
  kdsAppend(
    hub,
    [
      { stream_type: 'hub', stream_id: branch, event_type: 'PrinterSaved', payload: { printer_id: 'PR_DEF', name: 'Counter', connection: 'lan', address: '192.168.1.60:9100', paper_width_mm: 80, archived: false } },
      { stream_type: 'hub', stream_id: branch, event_type: 'BillRouteSet', payload: { scope: 'default', ref_id: '', printer_id: 'PR_DEF' } },
    ],
    { actor: null },
  );
});
afterEach(async () => {
  swapBranchConfig(null);
  resetFiscalAdapters();
  await hub.close();
});

function ok(r: Reply): Reply {
  expect(r.status, JSON.stringify(r.error)).toBe(200);
  return r;
}
/** A takeaway of 2 lassis (Rs 250.00 each, untaxed). */
const lassis = (): string => appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: `L-${Math.random()}`, item_id: VX.drink, quantity: 2 }] }).order_id;
const payAndClose = async (order_id: string): Promise<void> => {
  ok(await post(hub, cashier, 'add-payment', 'AddPayment', { bill_ref: { order_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 50_000 }));
  ok(await post(hub, cashier, 'close-split', 'CloseSplit', { bill_ref: { order_id }, split_no: 1, expected_total_minor: 50_000 }));
};
const slip = (order_id: string, reason: 'pay_later' | 'reprint') => post(hub, cashier, 'print-takeaway-slip', 'PrintTakeawaySlip', { order_id, reason });
const documents = () =>
  hub.deps.db.prepare("SELECT order_id, json_extract(payload, '$.kind_label') AS kind_label FROM print_jobs WHERE kind = 'document' ORDER BY rowid").all() as Array<{ order_id: string | null; kind_label: string | null }>;
const slips = () => documents().filter((d) => d.kind_label === 'Token slip');

describe('[03c #61] Send & pay prints the receipt alone', () => {
  it('[03c #61] a takeaway with no slip request → AddPayment → CloseSplit → a receipt document, no Token slip; nothing queued on OrderPlaced', async () => {
    const order_id = lassis();
    expect(documents()).toEqual([]); // no fold queues anything on OrderPlaced
    await payAndClose(order_id);
    expect(documents().length).toBeGreaterThanOrEqual(1);
    expect(slips()).toEqual([]);
    expect(documents().every((d) => d.order_id === null)).toBe(true); // 05's documents keep order_id NULL
  });
});

describe('[03c #66] races with a close (single writer)', () => {
  it('[03c #66] slip then CloseSplit → a slip and then the receipt', async () => {
    const order_id = lassis();
    expect((await slip(order_id, 'pay_later')).result).toMatchObject({ printed: true });
    await payAndClose(order_id);
    const docs = documents();
    expect(docs[0]).toMatchObject({ kind_label: 'Token slip', order_id });
    expect(docs.slice(1).length).toBeGreaterThanOrEqual(1);
    expect(docs.slice(1).every((d) => d.kind_label !== 'Token slip')).toBe(true);
  });

  it('[03c #66] CloseSplit then slip → 409 TAKEAWAY_SLIP_NOT_ALLOWED billed', async () => {
    const order_id = lassis();
    await payAndClose(order_id);
    const r = await slip(order_id, 'reprint');
    expect(r).toMatchObject({ status: 409, error: { code: 'TAKEAWAY_SLIP_NOT_ALLOWED', details: { reason: 'billed' } } });
    expect(slips()).toEqual([]);
  });
});

describe('[03c #60] a partly paid bill is still pay-later (D-5)', () => {
  it('[03c #60] one of two splits closed → the slip prints', async () => {
    const order_id = lassis();
    ok(await post(hub, cashier, 'set-splits', 'SetSplits', { bill_ref: { order_id }, mode: 'amount', splits: [{ split_no: 1, share_minor: 25_000 }, { split_no: 2, share_minor: 25_000 }] }));
    ok(await post(hub, cashier, 'add-payment', 'AddPayment', { bill_ref: { order_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 25_000 }));
    ok(await post(hub, cashier, 'close-split', 'CloseSplit', { bill_ref: { order_id }, split_no: 1, expected_total_minor: 25_000 }));
    expect((await slip(order_id, 'pay_later')).result).toMatchObject({ printed: true });
  });
});
