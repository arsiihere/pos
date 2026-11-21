// 05 §6.30, §3.15 (B20): the `none` adapter is registered by the production wiring (registerBilling, run by
// buildHubServer), not by a test. Deliberately imports NOTHING from src/billing/fiscal/ and calls no
// registerFiscalAdapter: the hub's own boot path is the only registration (close-out blocker: every CloseSplit was a
// 500 on a real hub). Real commands over HTTP: OpenShift, AddPayment, CloseSplit on the PK built-in (adapter `none`).
import { afterEach, describe, expect, it } from 'vitest';
import { auditEventTypes } from '@pos/domain';
import { checkBillingWiring, FIVE_EVENT_TYPES } from '../../../src/billing/index';
import { swapBranchConfig } from '../../../src/sync/branch-config-holder';
import type { TestHub } from '../../helpers/test-hub';
import { VX } from '../../voids/fixtures';
import { appendOrder, drawerDevice, FX, openSeating, post, signInOn, STAFF, startBilling } from '../fixtures';

let hub: TestHub | undefined;

afterEach(async () => {
  swapBranchConfig(null);
  await hub?.close();
  hub = undefined;
});

describe('[05 §6.30] the none fiscal adapter at boot', () => {
  it('[05 §6.30, §3.15] with no test-side registration, a paid split closes: 200 and an InvoiceIssued', async () => {
    const h = await startBilling({ stock: { [FX.stock]: 1_000_000, [VX.naanStock]: 1_000 } });
    hub = h;
    const cashier = signInOn(h, STAFF.cashier, drawerDevice(h));
    const shift = await post(h, cashier, 'open-shift', 'OpenShift', { float_minor: 0, as_drawer: true });
    expect(shift.status, JSON.stringify(shift.error)).toBe(200);
    const seating_id = 'SEAT_NB1';
    openSeating(h, { table_id: VX.tables.T4, seating_id, holder_staff_id: STAFF.manager });
    appendOrder(h, { order_type: 'dine_in', seating_id, placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'NB_N', item_id: FX.naan, quantity: 1 }] });

    // a naan, Rs 30 (pinned)
    const pay = await post(h, cashier, 'add-payment', 'AddPayment', { bill_ref: { seating_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 3_000 });
    expect(pay.status, JSON.stringify(pay.error)).toBe(200);
    const close = await post(h, cashier, 'close-split', 'CloseSplit', { bill_ref: { seating_id }, split_no: 1, expected_total_minor: 3_000 });
    expect(close.status, JSON.stringify(close.error)).toBe(200);

    const issued = h.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'InvoiceIssued'`).pluck().all() as string[];
    expect(issued).toHaveLength(1);
    expect(JSON.parse(issued[0]!)).toMatchObject({ total_minor: 3_000 });
  });

  it('[05 §6.30, #91b] the startup wiring check fails loudly when the none adapter is not registered', () => {
    const all = new Set(FIVE_EVENT_TYPES);
    const audited = new Set(auditEventTypes());
    expect(() => checkBillingWiring(all, audited, () => false)).toThrow(/no fiscal adapter: none$/);
    expect(() => checkBillingWiring(all, audited, (key) => key === 'none')).not.toThrow();
  });
});
