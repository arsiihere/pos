import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, type Mounted } from '../../../../../test/dom';
import type { SubmitOrderPayload } from '../contracts';
import { screenHarness, sl, view } from './screen-harness';
import { aRow, at } from './test-fixtures';

// 02b-TK C3-1 on the takeaway screen (02b v1.0.24 §6.1, §8; 05 v1.0.34 §6.1, §6.9, §6.12, B12; frames HomeKiosk,
// PayCash, PayDone, HomeOffline, TokenDue): Send & pay (F8) sends in the background and opens the pay panel over the
// cart; Send · pay later (F9) only sends; offline Pay is hidden and the order stays Due; Take payment on the token view
// opens the same panel.

vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: true, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));
const nav = vi.hoisted(() => ({ to: [] as string[] }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: (p: string) => nav.to.push(p) }));

const totals = (total_minor: number) => ({ subtotal_minor: total_minor, discount_minor: 0, service_charge_minor: 0, taxes: [], rounding_minor: 0, total_minor });
const aBill = (total: number) => ({
  bill_id: null,
  state: 'projected',
  order_type: 'takeaway',
  identifier: '57',
  lines: [],
  splits: [{ split_no: 1, state: 'open', plan: null, payments: [], totals: { cash: totals(total), digital: totals(total), as_paid: totals(total) }, balance_minor: total, invoice: null }],
  currency: { code: 'PKR', exponent: 2 },
  as_of_seq: 1,
  service_charge: { rate_bp: 0, removed: false },
  discount: null,
  totals_default: totals(total),
  open_requests: [],
  prints: [],
  blocks: [],
  reopen_count: 0,
  check_printed_at: null,
  buyer: { required: false, threshold_minor: null, waived: false },
});
const sent = (payload: unknown) => ({ status: 'sent', result: { order_id: (payload as SubmitOrderPayload).order_id, token: 57, groups: [{ group_id: 'g', promise_ms: at(13, 42), order_item_ids: [] }], lines: [] } });

const PAID = { ok: true, data: { bill_id: 'B1', payment_id: 'P1', split_no: 1, totals: { as_paid: totals(4_000) }, balance_minor: 0, card_due_minor: 0, cash_due_minor: 0, card_refund_due_minor: 0, cash_refund_due_minor: 0, rounding_minor: 0, change_due_minor: 0 } };
const CLOSED = { ok: true, data: { invoice_id: 'I1', invoice_ref: 'S1', total_minor: 4_000, change_minor: 0, bill_state: 'closed', receipt: { job_id: 'J1', printer_name: 'Counter' }, fiscal_state: 'not_required' } };
const addNaan = (m: Mounted) => {
  m.click(m.button('Sides', m.container.querySelector('.cats')!));
  m.click(m.container.querySelector<HTMLElement>('.mi[aria-label="Naan"]'));
};
const foot = (m: Mounted) => [...m.container.querySelectorAll('.cart__foot .tk-acts .tk-btn')].map((b) => b.textContent);
const key = (k: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

afterEach(() => {
  document.body.innerHTML = '';
  nav.to = [];
});

describe('[02b-TK C3-1] Send & pay / Send · pay later', () => {
  it('[frame HomeKiosk] a take-payment holder sees "Send · pay later F9" and "Send & pay F8"', async () => {
    const h = screenHarness({ rows: [] });
    const m = h.render();
    await flush();
    addNaan(m);
    expect(foot(m)).toEqual(['Send · pay later F9', 'Send & pay F8']);
    expect(m.text()).not.toContain('Send to kitchen');
    m.unmount();
  });

  it('[02b §6.1; frames PayCash, PayDone] Send & pay: SubmitOrder in the background, a fresh cart, the pay panel over it with the order\'s bill; paid → Next customer closes it', async () => {
    const h = screenHarness({ rows: [], answer: (type, payload) => (type === 'SubmitOrder' ? sent(payload) : undefined), bill: () => aBill(4_000), command: (type) => (type === 'AddPayment' ? PAID : type === 'CloseSplit' ? CLOSED : undefined) });
    const m = h.render();
    await flush();
    addNaan(m);
    m.click(m.button('Send & pay'));
    await flush(8);
    const submit = h.sent.find((s) => s.type === 'SubmitOrder')!.payload as SubmitOrderPayload;
    expect(m.container.querySelector('.cart .tk-paypanel')).not.toBeNull();
    expect(h.queries).toContain(`/queries/bill?order_id=${submit.order_id}`);
    expect(m.container.querySelector('.tk-pay__h .tk-tok')?.textContent).toBe('57');
    // the cart behind is fresh (the next customer's)
    expect(m.container.querySelectorAll('.cart .ln')).toHaveLength(0);
    m.click(m.button('Exact'));
    m.click(m.button('Paid · print receipt'));
    await flush(8);
    expect(h.commands.map((c) => c.type)).toEqual(['AddPayment', 'CloseSplit']);
    m.click(m.button('Next customer'));
    expect(m.container.querySelector('.tk-paypanel')).toBeNull();
    m.unmount();
  });

  it('[frame HomeKiosk keys] F8 = Send & pay, F9 = Send · pay later (no panel)', async () => {
    const h = screenHarness({ rows: [], answer: (type, payload) => (type === 'SubmitOrder' ? sent(payload) : undefined), bill: () => aBill(4_000) });
    const m = h.render();
    await flush();
    addNaan(m);
    key('F9');
    await flush(8);
    expect(h.sent.filter((s) => s.type === 'SubmitOrder')).toHaveLength(1);
    expect(m.container.querySelector('.tk-paypanel')).toBeNull();
    addNaan(m);
    key('F8');
    await flush(8);
    expect(h.sent.filter((s) => s.type === 'SubmitOrder')).toHaveLength(2);
    expect(m.container.querySelector('.tk-paypanel')).not.toBeNull();
    m.unmount();
  });

  it('[05 B12; frame SentQueued] Send & pay that only queued: no panel, "Not sent yet", the order stays Due; no money command', async () => {
    const h = screenHarness({ rows: [], answer: (type) => (type === 'SubmitOrder' ? { status: 'queued', entry_id: 'Q1' } : undefined), bill: () => aBill(4_000) });
    const m = h.render();
    await flush();
    addNaan(m);
    m.click(m.button('Send & pay'));
    await flush(8);
    expect(m.container.querySelector('.tk-paypanel')).toBeNull();
    expect(h.toasts.at(-1)!.text).toBe('Not sent yet — token comes when the hub is back');
    expect(h.commands).toEqual([]);
    m.unmount();
  });

  it('[02b §6.1] Send & pay refused: the panel closes, the cart comes back with the reason', async () => {
    const h = screenHarness({ rows: [], answer: (type) => (type === 'SubmitOrder' ? { status: 'refused', error: { kind: 'api', status: 409, code: 'ITEM_UNAVAILABLE', details: { item_id: 'I5' } } } : undefined) });
    const m = h.render();
    await flush();
    addNaan(m);
    m.click(m.button('Send & pay'));
    await flush(8);
    expect(m.container.querySelector('.tk-paypanel')).toBeNull();
    expect(m.container.querySelectorAll('.cart .ln')).toHaveLength(1);
    m.unmount();
  });

  it('[05 B12; frame HomeOffline] offline: Send & pay hidden, "Payment needs the hub…", Send · pay later sends; F8 does nothing', async () => {
    const h = screenHarness({ rows: [], online: false, answer: (type) => (type === 'SubmitOrder' ? { status: 'queued', entry_id: 'Q1' } : undefined) });
    const m = h.render();
    await flush();
    addNaan(m);
    expect(foot(m)).toEqual(['Send · pay later F9']);
    expect(m.text()).toContain('Payment needs the hub. Send now; take payment when Live.');
    key('F8');
    await flush(8);
    expect(h.sent.filter((s) => s.type === 'SubmitOrder')).toHaveLength(0);
    m.click(m.button('Send · pay later'));
    await flush(8);
    expect(h.sent.filter((s) => s.type === 'SubmitOrder')).toHaveLength(1);
    m.unmount();
  });

  it('[frame ReadyTiles; R2] a Due ready tile shows the amount due and its Take payment opens the pay panel over the cart', async () => {
    const h = screenHarness({
      openBills: [{ bill_id: null, seating_id: null, order_id: 'O48', identifier: '#48', order_type: 'takeaway', state: 'projected', total_default_minor: 119_000, paid_minor: 0, due_minor: 119_000, check_printed_at: null, opened_at: at(13, 0), open_minutes: 20, flagged: false, partly_paid: false, has_open_request: false }],
      bills: {},
      bill: () => aBill(119_000),
    });
    const m = h.render();
    await flush();
    const tile = m.container.querySelector('.tk-rt--due')!;
    expect(tile.querySelector('.tk-rt__who')?.textContent).toBe('Rs 1,190');
    m.click(m.button('Take payment', tile));
    await flush();
    expect(m.container.querySelector('.cart .tk-paypanel')).not.toBeNull();
    expect(m.container.querySelector('.tk-pay__h .tk-tok')?.textContent).toBe('48');
    expect(h.queries.filter((q) => q === '/queries/open-bills')).toHaveLength(1);
    expect(h.queries).toContain('/queries/bill?order_id=O48');
    m.unmount();
  });

  it('[frame TokenDue] Take payment on the token view opens the same panel for the token\'s NEWEST order (05 #44e)', async () => {
    const h = screenHarness({
      rows: [aRow({ order_id: 'O48', token: 48, ready: { n: 0, m: 1 } }), aRow({ order_id: 'O48b', token: 48, placed_at: at(13, 5), ready: { n: 0, m: 1 } })],
      views: { O48: view('O48', [sl('O48', 'A', 'Karahi', 'cooking')]), O48b: view('O48b', [sl('O48b', 'B', 'Naan', 'cooking')]) },
      bill: () => aBill(180_000),
    });
    const m = h.render();
    await flush();
    m.click(m.container.querySelector('.tk-qr'));
    await flush();
    m.click(m.button('Take payment', m.container.querySelector('.tk-drawer__f')!));
    await flush();
    expect(m.container.querySelector('.tk-drawer')).toBeNull();
    expect(m.container.querySelector('.cart .tk-paypanel')).not.toBeNull();
    expect(h.queries.at(-1)).toBe('/queries/bill?order_id=O48b');
    expect(m.container.querySelector('.tk-pay__h .tk-tok')?.textContent).toBe('48');
    expect(nav.to).toEqual([]);
    m.click(m.button('Pay later'));
    expect(m.container.querySelector('.tk-paypanel')).toBeNull();
    m.unmount();
  });
});
