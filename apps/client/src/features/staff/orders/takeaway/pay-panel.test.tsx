import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import type { BillView, BillViewSplit, Totals } from '../../../billing/contracts';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import { createPermissions } from '../../shell/permissions';
import { createToastBus } from '../../shell/toast';
import { PayPanel, type PayTarget } from './PayPanel';
import { at } from './test-fixtures';

// 02b-TK C3-1 (05 v1.0.34 §6.1, §6.9, §6.12, B12, B16; frames PayCash, PayCashShort, PayCard, PayDone, PayError): the
// takeaway pay panel over the cart — cash notes and change, card with its reference, AddPayment then CloseSplit (the
// receipt prints as today), every refusal mapped, offline no Pay.

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

const typeIn = (el: Element | null | undefined, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el!.dispatchEvent(new Event('input', { bubbles: true }));
};
const due = (m: Mounted) => m.container.querySelector('.tk-pay__due .money')?.textContent;
const paidBtn = (m: Mounted) => m.button('Paid · print receipt');
const calls = (s: ReturnType<typeof setup>) => s.command.mock.calls.map((c) => [c[0], c[1]]);

describe('[02b-TK C3-1] pay panel — cash (frames PayCash, PayCashShort, PayDone)', () => {
  it('[05 §6.1; frame PayCash] reads bill?order_id, To pay = the cash due, Exact / 4,000 / 5,000 / 10,000, the token and name', async () => {
    const s = setup();
    const m = await show(s);
    expect(s.query).toHaveBeenCalledWith('/queries/bill?order_id=O57');
    expect(m.container.querySelector('.tk-paypanel')).not.toBeNull();
    expect(m.container.querySelector('.tk-pay__h .tk-tok')?.textContent).toBe('57');
    expect(m.text()).toContain('Take payment');
    expect(m.text()).toContain('Usman');
    expect(due(m)).toBe('Rs 3,650');
    expect([...m.container.querySelectorAll('.tk-modes .tk-mode')].map((b) => [b.textContent, b.classList.contains('is-sel')])).toEqual([
      ['Cash', true],
      ['Card', false],
    ]);
    expect([...m.container.querySelectorAll('.tk-notes button')].map((b) => b.textContent)).toEqual(['ExactRs 3,650', 'Rs 4,000', 'Rs 5,000', 'Rs 10,000']);
    // M-6: Customer gave is never pre-filled; Paid waits for it
    expect(paidBtn(m).getAttribute('aria-disabled')).toBe('true');
  });

  it('[05 §6.9, §6.12; frames PayCash, PayDone] Rs 5,000 → change Rs 1,350; Paid → AddPayment then CloseSplit; Paid · change huge · receipt; Enter = next customer', async () => {
    const s = setup({ answers: [PAID(), CLOSED()] });
    const onDone = vi.fn();
    const m = await show(s, { onDone });
    m.click(m.button('Rs 5,000', m.container.querySelector('.tk-notes')!));
    expect(m.container.querySelector('.tk-notes .is-sel')?.textContent).toBe('Rs 5,000');
    expect(m.container.querySelector('.tk-change')?.textContent).toBe('Give changeRs 1,350');
    expect(paidBtn(m).getAttribute('aria-disabled')).toBe('false');
    m.click(paidBtn(m));
    await flush();
    expect(calls(s)).toEqual([
      ['AddPayment', { bill_ref: { order_id: 'O57' }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 365_000, tendered_minor: 500_000 }],
      ['CloseSplit', { bill_ref: { order_id: 'O57' }, split_no: 1, expected_total_minor: 365_000 }],
    ]);
    expect(m.text()).toContain('Paid · Rs 3,650');
    expect(m.container.querySelector('.tk-change .money')?.textContent).toBe('Rs 1,350');
    expect(m.text()).toContain('Receipt is printing');
    m.key(document.body, 'Enter');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('[frame PayCash] Exact sends tendered = the due; no change row', async () => {
    const s = setup({ answers: [PAID({ change_due_minor: 0 }), CLOSED({ change_minor: 0 })] });
    const m = await show(s);
    m.click(m.button('Exact'));
    expect(m.container.querySelector('.tk-change')).toBeNull();
    m.key(document.body, 'Enter');
    await flush();
    expect(s.command.mock.calls[0]![1]).toMatchObject({ amount_minor: 365_000, tendered_minor: 365_000 });
    expect(m.text()).toContain('Paid · Rs 3,650');
    expect(m.container.querySelector('.tk-change')).toBeNull();
  });

  it('[TAPS row 1 "F8 ⏎ ⏎"] Enter while the tapped note still has the focus = Paid, once (not the note again)', async () => {
    const s = setup({ answers: [PAID({ change_due_minor: 0 }), CLOSED({ change_minor: 0 })] });
    const m = await show(s);
    const exact = m.button('Exact');
    m.click(exact);
    // a real key press is cancelable: Paid takes it, so the browser does not click the focused note too
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    act(() => void exact.dispatchEvent(ev));
    await flush();
    expect(calls(s).map((c) => c[0])).toEqual(['AddPayment', 'CloseSplit']);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('[frame PayCashShort] typed 3,000 → "Short by Rs 650" in red, Paid stays off, nothing sent', async () => {
    const s = setup();
    const m = await show(s);
    typeIn(m.container.querySelector('.tk-tendered input'), '3,000');
    expect(m.container.querySelector('.tk-change--short')?.textContent).toBe('Short byRs 650');
    expect(paidBtn(m).getAttribute('aria-disabled')).toBe('true');
    m.click(paidBtn(m));
    m.key(document.body, 'Enter');
    await flush();
    expect(s.command).not.toHaveBeenCalled();
  });
});

describe('[02b-TK C3-1] pay panel — card (frame PayCard)', () => {
  it('[05 §6.9 reference rule; frame PayCard] Card: To pay = the card due; the reference is needed, sent, no tendered', async () => {
    const s = setup({ answers: [PAID({ totals: { as_paid: totals(370_000) }, change_due_minor: 0 }), CLOSED({ total_minor: 370_000, change_minor: 0 })] });
    const m = await show(s);
    m.click(m.button('Card', m.container.querySelector('.tk-modes')!));
    expect(due(m)).toBe('Rs 3,700');
    expect(m.text()).toContain('Card machine approved?');
    expect(m.container.querySelector('.tk-notes')).toBeNull();
    expect(paidBtn(m).getAttribute('aria-disabled')).toBe('true');
    typeIn(m.container.querySelector('.tk-qrbox input'), '4417');
    m.click(paidBtn(m));
    await flush();
    expect(calls(s)).toEqual([
      ['AddPayment', { bill_ref: { order_id: 'O57' }, split_no: 1, mode_id: 'card', direction: 'in', amount_minor: 370_000, reference: '4417' }],
      ['CloseSplit', { bill_ref: { order_id: 'O57' }, split_no: 1, expected_total_minor: 370_000 }],
    ]);
    expect(m.text()).toContain('Paid · Rs 3,700');
  });
});

describe('[02b-TK C3-1] pay panel — refusals (frame PayError)', () => {
  const pay = async (s: ReturnType<typeof setup>, o: { onLater?: () => void } = {}) => {
    const m = await show(s, o);
    m.click(m.button('Exact'));
    m.click(paidBtn(m));
    await flush();
    return m;
  };

  it.each([
    ['SHIFT_NOT_OPEN', 409, { reason: 'no_shift' }, 'Open your shift to take money'],
    ['BUSINESS_DAY_NOT_OPEN', 409, {}, 'The day hasn’t started — start the day before taking money'],
    ['PAYMENT_REFERENCE_REQUIRED', 422, {}, 'Enter the reference'],
    ['PAYMENT_EXCEEDS_BALANCE', 422, { balance_minor: 300_000, mode_id: 'cash' }, 'The most you can take by Cash is Rs 3,000.00'],
    ['PAYMENT_CASH_STEP', 422, { step_minor: 500 }, 'Cash must be in steps of Rs 5.00'],
    ['PAYMENT_MODE_NOT_FISCAL', 422, { mode_id: 'cash', adapter_key: 'PRA' }, "Cash can't be used for a tax invoice here"],
  ])('[05 §6.9] AddPayment %s → "Payment didn’t go through", nothing charged, the reason; no CloseSplit', async (code, status, details, text) => {
    const s = setup({ answers: [refused(status, code, details)] });
    const m = await pay(s);
    expect(m.text()).toContain('Payment didn’t go through');
    expect(m.text()).toContain('Nothing was charged');
    expect(m.text()).toContain('the order is already in the kitchen');
    expect(m.text()).toContain(text);
    expect(m.text()).not.toContain('{');
    expect(calls(s).map((c) => c[0])).toEqual(['AddPayment']);
  });

  it('[05 §6.9; frame PayError] Pay later closes the panel (the order stays Due); Try again goes back to the pad', async () => {
    const s = setup({ answers: [refused(422, 'PAYMENT_CASH_STEP', { step_minor: 500 }), refused(422, 'PAYMENT_CASH_STEP', { step_minor: 500 })] });
    const onLater = vi.fn();
    const m = await pay(s, { onLater });
    m.click(m.button('Try again'));
    expect(m.container.querySelector('.tk-notes')).not.toBeNull();
    m.click(m.button('Exact'));
    m.click(paidBtn(m));
    await flush();
    m.click(m.button('Pay later'));
    expect(onLater).toHaveBeenCalledTimes(1);
  });

  it('[05 §6.9 B11] SHIFT_NOT_OPEN no_shift with manage-own-shift offers Open shift (#/shift)', async () => {
    const s = setup({ answers: [refused(409, 'SHIFT_NOT_OPEN', { reason: 'no_shift' })], grants: { 'manage-own-shift': { grant: 'allowed', scope: 'branch' } } });
    const m = await pay(s);
    m.click(m.button('My shift'));
    expect(nav.to).toEqual(['/shift']);
  });

  it('[handbook §10] a lost reply: "Hub offline", Try again resends the SAME command (one payment)', async () => {
    const s = setup({ answers: [{ ok: false, error: { kind: 'network' } }, PAID(), CLOSED()] });
    const m = await pay(s);
    expect(m.text()).toContain('Hub offline — payment can’t be recorded now');
    m.click(m.button('Try again'));
    await flush();
    const ids = s.command.mock.calls.filter((c) => c[0] === 'AddPayment').map((c) => c[2]?.commandId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(m.text()).toContain('Paid · Rs 3,650');
  });

  it('[05 §6.12 rule 7] CloseSplit BILL_TOTAL_CHANGED → the bill is read again, the new total shown, never closed by itself', async () => {
    const after = bill({ state: 'open', bill_id: 'B1', splits: [split({ balance_minor: 20_000, totals: { cash: totals(385_000), digital: totals(390_000), as_paid: totals(385_000) }, payments: [{ payment_id: 'P1', mode_id: 'cash', mode_name: 'Cash', direction: 'in', amount_minor: 365_000, tendered_minor: 500_000, change_minor: 135_000, has_reference: false, taken_by_name: 'Sana', taken_by_staff_id: 'S_SANA' }] })] });
    const s = setup({ bills: [bill(), after], answers: [PAID(), refused(409, 'BILL_TOTAL_CHANGED', { total_minor: 385_000 })] });
    const m = await pay(s);
    expect(m.text()).toContain('The total changed to Rs 3,850.00');
    expect(due(m)).toBe('Rs 200');
    expect(m.text()).not.toContain('Nothing was charged');
    expect(calls(s).map((c) => c[0])).toEqual(['AddPayment', 'CloseSplit']);
  });

  it.each([
    ['BILL_CLOSE_BLOCKED', 409, { reason: 'void_pending', order_item_ids: [] }, "Can't close yet"],
    ['BUYER_ID_REQUIRED', 422, { threshold_minor: 10_000_000, net_minor: 365_000, accepted_types: ['CNIC'] }, 'Buyer details are needed above Rs 100,000.00'],
    ['DISCOUNT_PENDING', 409, { alert_id: 'A1' }, 'A discount is waiting for approval'],
  ])('[05 §6.12] CloseSplit %s after the payment: the reason, not "nothing charged"; Open bill goes to the bill screen', async (code, status, details, text) => {
    const s = setup({ answers: [PAID(), refused(status, code, details)] });
    const m = await pay(s);
    expect(m.text()).toContain(text);
    expect(m.text()).not.toContain('Nothing was charged');
    expect(m.text()).toContain('The payment is in');
    m.click(m.button('Open bill'));
    expect(nav.to).toEqual(['/bill?order_id=O57']);
  });

  it('[05 §6.12 rule 8] CloseSplit BILL_BALANCE_DUE → the bill read again, the pad shows what is still to take', async () => {
    const paid = { payment_id: 'P1', mode_id: 'cash', mode_name: 'Cash', direction: 'in' as const, amount_minor: 360_000, tendered_minor: 360_000, change_minor: 0, has_reference: false, taken_by_name: 'Sana', taken_by_staff_id: 'S_SANA' };
    const after = bill({ state: 'open', bill_id: 'B1', splits: [split({ balance_minor: 5_000, payments: [paid] })] });
    const s = setup({ bills: [bill(), after], answers: [PAID(), refused(409, 'BILL_BALANCE_DUE', { split_no: 1, balance_minor: 5_000 })] });
    const m = await pay(s);
    expect(m.text()).toContain('Rs 50.00 still to take on split 1');
    expect(due(m)).toBe('Rs 50');
    expect(m.text()).not.toContain('Nothing was charged');
  });

  it('[05 B12; HomeOffline] offline: "Hub offline — payment can’t be recorded now", no Paid, Pay later stays', async () => {
    const s = setup({ online: false });
    const m = await show(s);
    expect(m.text()).toContain('Hub offline — payment can’t be recorded now');
    expect(() => paidBtn(m)).toThrow();
    expect(m.button('Pay later')).toBeTruthy();
  });

  it('[C3-1] while the order is still being sent: no bill read, Paid waits', async () => {
    const s = setup();
    const m = await show(s, { target: { ...TARGET, order_id: null } });
    expect(s.query).not.toHaveBeenCalled();
    expect(m.text()).toContain('Sending');
    expect(() => paidBtn(m)).toThrow();
  });
});
