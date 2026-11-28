import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import type { BillView, BillViewSplit, Totals } from '../../../billing/contracts';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import { createPermissions } from '../../shell/permissions';
import { createToastBus } from '../../shell/toast';
import { REFETCH_MS } from '../lists/OpenOrders';
import { PayPanel, type PayTarget } from './PayPanel';
import { at } from './test-fixtures';

// ⚠️ 05 v1.0.37 §6.9, §8 (owner 2026-11-28 QA-R2, R2-1; QA BUG-1 BLOCKER, BUG-6), test #21f (client half): the pay
// panel sends the due it shows (`expected_due_minor`), follows the bill live while open ("Bill changed — now Rs X",
// Cash given cleared, Paid waits for a new amount), answers BILL_DUE_CHANGED the same way (nothing paid, no change
// shown), and on a split bill reads "Split 1 of 2 · Rs 33 · Rs 34 more on this bill". Same harness as pay-panel.test.

const nav = vi.hoisted(() => ({ to: [] as string[] }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: (p: string) => nav.to.push(p) }));

const totals = (total_minor: number): Totals => ({ subtotal_minor: total_minor, discount_minor: 0, service_charge_minor: 0, taxes: [], rounding_minor: 0, total_minor });
const split = (o: Partial<BillViewSplit> = {}): BillViewSplit => ({
  split_no: 1,
  state: 'open',
  plan: null,
  payments: [],
  // a cash price 3,650, by card 3,700 (the two classes' totals: the hub's, never computed here)
  totals: { cash: totals(365_000), digital: totals(370_000), as_paid: totals(365_000) },
  balance_minor: 365_000,
  invoice: null,
  ...o,
});
function bill(o: Partial<BillView> = {}): BillView {
  return {
    bill_id: null,
    state: 'projected',
    order_type: 'takeaway',
    identifier: '57',
    lines: [],
    splits: [split()],
    currency: { code: 'PKR', exponent: 2 },
    as_of_seq: 1,
    service_charge: { rate_bp: 0, removed: false },
    discount: null,
    totals_default: totals(365_000),
    open_requests: [],
    prints: [],
    blocks: [],
    reopen_count: 0,
    check_printed_at: null,
    buyer: { required: false, threshold_minor: null, waived: false },
    ...o,
  };
}

const MODES = [
  { mode_id: 'cash', name: 'Cash', kind: 'cash', payment_class: 'cash', reference_required: false, is_active: true, sort_order: 1, authority_codes: [] },
  { mode_id: 'card', name: 'Card', kind: 'card', payment_class: 'digital', reference_required: true, is_active: true, sort_order: 2, authority_codes: [] },
];

type Answer = { ok: true; data: unknown } | { ok: false; error: { kind: 'api'; status: number; code: string; details: Record<string, unknown> } | { kind: 'network' } };
const refused = (status: number, code: string, details: Record<string, unknown> = {}): Answer => ({ ok: false, error: { kind: 'api', status, code, details } });
const PAID = (o: Record<string, unknown> = {}): Answer => ({
  ok: true,
  data: { bill_id: 'B1', payment_id: 'P1', split_no: 1, totals: { as_paid: totals(365_000) }, balance_minor: 0, card_due_minor: 0, cash_due_minor: 0, card_refund_due_minor: 0, cash_refund_due_minor: 0, rounding_minor: 0, change_due_minor: 135_000, ...o },
});
const CLOSED = (o: Record<string, unknown> = {}): Answer => ({
  ok: true,
  data: { invoice_id: 'I1', invoice_ref: 'LHR-S000001', total_minor: 365_000, change_minor: 135_000, bill_state: 'closed', receipt: { job_id: 'J1', printer_name: 'Counter' }, fiscal_state: 'not_required', ...o },
});

function setup(o: { bills?: BillView[]; answers?: Answer[]; online?: boolean; grants?: Record<string, unknown> } = {}) {
  const bills = [...(o.bills ?? [bill()])];
  const query = vi.fn(async (path: string) => {
    void path;
    return { ok: true as const, data: bills.length > 1 ? bills.shift()! : bills[0]! };
  });
  const queue = [...(o.answers ?? [])];
  const command = vi.fn(async (type: string, payload: unknown, opts?: { commandId?: string }): Promise<Answer> => {
    void type;
    void payload;
    void opts;
    return queue.shift() ?? { ok: true, data: {} };
  });
  const shell = {
    device: { token: 'D', id: 'dev-1', type: 'cashier_kiosk' },
    api: { query, page: vi.fn(), command },
    live: createLiveBus(),
    toasts: createToastBus(),
    permissions: createPermissions({ 'take-payment': { grant: 'allowed', scope: 'branch' }, ...(o.grants ?? {}) } as never),
    config: { config: () => null, snapshot: () => ({ currency_code: 'PKR', billing: { payment_modes: MODES } }), subscribe: () => () => {} },
    clock: { nowMs: () => at(13, 20), utcOffsetMs: 0 },
    me: { staff_id: 'S_SANA', name: 'Sana' },
    online: o.online ?? true,
    phone: false,
    portrait: false,
  } as unknown as Shell;
  return { shell, query, command };
}

const TARGET: PayTarget = { order_id: 'O57', ident: '57', name: 'Usman', promise_ms: at(13, 42) };

let v: Mounted | null = null;
beforeEach(() => {
  nav.to = [];
});
afterEach(() => {
  v?.unmount();
  v = null;
  document.body.innerHTML = '';
});

async function show(s: ReturnType<typeof setup>, o: { target?: PayTarget; onLater?: () => void; onDone?: () => void } = {}) {
  v = mount();
  v.render(
    <ShellContext.Provider value={s.shell}>
      <PayPanel target={o.target ?? TARGET} onLater={o.onLater ?? (() => {})} onDone={o.onDone ?? (() => {})} />
    </ShellContext.Provider>,
  );
  await flush();
  return v;
}

const due = (m: Mounted) => m.container.querySelector('.tk-pay__due .money')?.textContent;
const paidBtn = (m: Mounted) => m.button('Paid · print receipt');
const calls = (s: ReturnType<typeof setup>) => s.command.mock.calls.map((c) => [c[0], c[1]]);


const dues = (cash: number, card = cash) => ({ cash_due_minor: cash, card_due_minor: card, cash_refund_due_minor: 0, card_refund_due_minor: 0 });
const frame = (s: ReturnType<typeof setup>, seq: number, event_type: string) =>
  act(() => {
    s.shell.live.frame({ type: 'event' as const, seq, event: { event_id: `E${seq}`, event_type, schema_version: 1, payload: {} } } as never);
  });
const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, REFETCH_MS + 30));
  });
  await flush();
};
const banner = (m: Mounted) => m.container.querySelector('.tk-pay__b [role="status"]')?.textContent ?? null;
const given = (m: Mounted) => (m.container.querySelector('.tk-tendered input') as HTMLInputElement | null)?.value;

// a Rs 80 token; "Add to token" makes it Rs 200 (the QA BUG-1 shape)
const R80 = bill({ splits: [split({ totals: { cash: totals(8_000), digital: totals(8_000), as_paid: totals(8_000) }, balance_minor: 8_000, dues: dues(8_000) })], totals_default: totals(8_000) });
const R200 = bill({ splits: [split({ totals: { cash: totals(20_000), digital: totals(20_000), as_paid: totals(20_000) }, balance_minor: 20_000, dues: dues(20_000) })], totals_default: totals(20_000) });

describe('[05 v1.0.37 §6.9, R2-1] the pay panel carries the due it shows', () => {
  it('[05 #21f] AddPayment sends expected_due_minor = To pay (the view’s own cash due)', async () => {
    const s = setup({ bills: [R80], answers: [PAID({ change_due_minor: 2_000 }), CLOSED({ total_minor: 8_000, change_minor: 2_000 })] });
    const m = await show(s);
    expect(due(m)).toBe('Rs 80');
    m.click(m.button('Rs 100', m.container.querySelector('.tk-notes')!));
    m.click(paidBtn(m));
    await flush();
    expect(calls(s)[0]).toEqual(['AddPayment', { bill_ref: { order_id: 'O57' }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 8_000, expected_due_minor: 8_000, tendered_minor: 10_000 }]);
  });
});

describe('[05 v1.0.37 §8, R2-1] the panel follows the bill live', () => {
  it('[05 #21f, BUG-1] an "Add to token" lands while the panel is open: "Bill changed — now Rs 200", Customer gave cleared, Paid waits; the next payment is of Rs 200', async () => {
    const s = setup({ bills: [R80, R200], answers: [PAID({ change_due_minor: 0 }), CLOSED({ total_minor: 20_000, change_minor: 0 })] });
    const m = await show(s);
    m.click(m.button('Rs 100', m.container.querySelector('.tk-notes')!));
    expect(given(m)).toBe('100');
    frame(s, 10, 'ItemAdded');
    await settle();
    expect(s.query).toHaveBeenCalledTimes(2);
    expect(due(m)).toBe('Rs 200');
    expect(banner(m)).toBe('Bill changed — now Rs 200');
    expect(given(m)).toBe('');
    expect(m.container.querySelector('.tk-change')).toBeNull();
    expect(paidBtn(m).getAttribute('aria-disabled')).toBe('true');
    m.click(paidBtn(m));
    await flush();
    expect(calls(s)).toEqual([]);
    m.click(m.button('Exact', m.container.querySelector('.tk-notes')!));
    m.click(paidBtn(m));
    await flush();
    expect(calls(s)[0]).toEqual(['AddPayment', { bill_ref: { order_id: 'O57' }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 20_000, expected_due_minor: 20_000, tendered_minor: 20_000 }]);
  });

  it('[05 #21f] a frame that leaves the due as it was changes nothing: no banner, Customer gave kept', async () => {
    const s = setup({ bills: [R80] });
    const m = await show(s);
    m.click(m.button('Rs 100', m.container.querySelector('.tk-notes')!));
    frame(s, 11, 'PrintJobUpdated');
    frame(s, 12, 'CheckBillPrinted');
    await settle();
    expect(s.query).toHaveBeenCalledTimes(2);
    expect(banner(m)).toBeNull();
    expect(given(m)).toBe('100');
  });

  it('[05 #21f] the hub refuses BILL_DUE_CHANGED: nothing paid, no CloseSplit, the new amount shown, Customer gave cleared', async () => {
    const s = setup({ bills: [R80, R200], answers: [refused(409, 'BILL_DUE_CHANGED', { split_no: 1, expected_minor: 8_000, due_minor: 20_000 })] });
    const m = await show(s);
    m.click(m.button('Rs 100', m.container.querySelector('.tk-notes')!));
    m.click(paidBtn(m));
    await flush();
    expect(calls(s).map((c) => c[0])).toEqual(['AddPayment']);
    expect(due(m)).toBe('Rs 200');
    expect(banner(m)).toBe('Bill changed — now Rs 200');
    expect(given(m)).toBe('');
    expect(m.text()).not.toContain('Give change');
    expect(m.container.querySelector('.tk-pay__done')).toBeNull();
  });

  it('[05 #21f] double tap on Paid sends one AddPayment', async () => {
    const s = setup({ bills: [R80], answers: [PAID({ change_due_minor: 2_000 }), CLOSED({ total_minor: 8_000, change_minor: 2_000 })] });
    const m = await show(s);
    m.click(m.button('Rs 100', m.container.querySelector('.tk-notes')!));
    m.click(paidBtn(m));
    m.click(paidBtn(m));
    await flush();
    expect(calls(s).filter((c) => c[0] === 'AddPayment')).toHaveLength(1);
  });
});

describe('[05 v1.0.37 §8, BUG-6] a split bill on the pay panel', () => {
  it('[05 #21f, BUG-6] Rs 67 split in two (33 + 34): "Split 1 of 2 · Rs 33 · Rs 34 more on this bill"; the payment is split 1’s', async () => {
    const two = bill({
      bill_id: 'B4',
      state: 'open',
      splits: [
        split({ split_no: 1, plan: { n: 2, k: 1 }, totals: { cash: totals(3_300), digital: totals(3_300), as_paid: totals(3_300) }, balance_minor: 3_300, dues: dues(3_300) }),
        split({ split_no: 2, plan: { n: 2, k: 2 }, totals: { cash: totals(3_400), digital: totals(3_400), as_paid: totals(3_400) }, balance_minor: 3_400, dues: dues(3_400) }),
      ],
      totals_default: totals(6_700),
    });
    const s = setup({ bills: [two] });
    const m = await show(s);
    expect(due(m)).toBe('Rs 33');
    expect(m.container.querySelector('.tk-pay__split')?.textContent).toBe('Split 1 of 2 · Rs 33 · Rs 34 more on this bill');
    m.click(m.button('Exact', m.container.querySelector('.tk-notes')!));
    m.click(paidBtn(m));
    await flush();
    expect(calls(s)[0]).toEqual(['AddPayment', { bill_ref: { order_id: 'O57' }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 3_300, expected_due_minor: 3_300, tendered_minor: 3_300 }]);
  });

  it('[BUG-6] the last open split of a split bill: "Split 2 of 2 · Rs 34", nothing more; an unsplit bill has no split line', async () => {
    const last = bill({
      bill_id: 'B4',
      state: 'partly_paid',
      splits: [split({ split_no: 1, state: 'closed', balance_minor: 0, dues: dues(0) }), split({ split_no: 2, totals: { cash: totals(3_400), digital: totals(3_400), as_paid: totals(3_400) }, balance_minor: 3_400, dues: dues(3_400) })],
    });
    const m = await show(setup({ bills: [last] }));
    expect(m.container.querySelector('.tk-pay__split')?.textContent).toBe('Split 2 of 2 · Rs 34');
    v?.unmount();
    const one = await show(setup({ bills: [R80] }));
    expect(one.container.querySelector('.tk-pay__split')).toBeNull();
  });
});
