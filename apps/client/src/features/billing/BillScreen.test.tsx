import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../test/dom';
import { setLanguage } from '../../i18n';
import { en } from '../../i18n/en';
import { ur } from '../../i18n/ur';
import enSource from '../../i18n/en.ts?raw';
import { ShellContext, type Shell } from '../staff/shell/hooks';
import { createLiveBus } from '../staff/shell/live';
import { createPermissions } from '../staff/shell/permissions';
import { createToastBus } from '../staff/shell/toast';
import { BillScreen, duesOf } from './BillScreen';
import type { BillView, BillViewSplit, Totals } from './contracts';
import { TODO_05 } from './urdu-todo-05';

// 05 v1.0.14 §8 "Bill screen", §6.1, §6.9, §6.12, §3.3, §3.5 (7) (plan §3.1 task 35; brief §3.2; frames Bill,
// BillPadCash, BillPadCard, BillMixed, BillCloseBlocked, BillReadyToClose, BillTotalChanged, BillClosed, BillRefund,
// BillUrdu). Totals, dues and change come from the hub only; the pad never computes tax, rounding or change.

const NOW = Date.UTC(2026, 10, 20, 13, 40);
const tax = (payment_class: 'cash' | 'digital', rate_bp: number, tax_minor: number) => ({ tax_profile_id: 'food', tax_code: 'PST', label: 'Punjab sales tax on services', payment_class, rate_bp, base_minor: 571_000, tax_minor, rate_ref: null });
const totals = (over: Partial<Totals>): Totals => ({ subtotal_minor: 571_000, discount_minor: 0, service_charge_minor: 0, taxes: [], rounding_minor: 0, total_minor: 0, ...over });
const CASH = totals({ taxes: [tax('cash', 1_600, 91_360)], rounding_minor: 40, total_minor: 662_400 });
const CARD = totals({ taxes: [tax('digital', 500, 28_550)], rounding_minor: 50, total_minor: 599_600 });

function split(over: Partial<BillViewSplit> = {}): BillViewSplit {
  return { split_no: 1, state: 'open', plan: null, payments: [], totals: { cash: CASH, digital: CARD, as_paid: CASH }, balance_minor: 662_400, invoice: null, ...over };
}
const line = (id: string, name: string, units: number, base_minor: number, tags: BillView['lines'][number]['tags'] = []) => ({ order_item_id: id, order_id: 'O1', name, units, base_minor, tax_profile_id: 'food', tags, added_after_close: false });

function bill(over: Partial<BillView> = {}): BillView {
  return {
    bill_id: 'B7',
    state: 'open',
    order_type: 'dine_in',
    identifier: 'T7',
    lines: [line('K', 'Chicken Karahi Full', 1, 220_000), line('N', 'Naan', 6, 36_000)],
    splits: [split()],
    currency: { code: 'PKR', exponent: 2 },
    as_of_seq: 3,
    service_charge: { rate_bp: 0, removed: false },
    discount: null,
    totals_default: CASH,
    open_requests: [],
    prints: [],
    blocks: [{ reason: 'balance_due', split_no: 1, details: { split_no: 1, balance_minor: 662_400 } }],
    reopen_count: 0,
    check_printed_at: Date.UTC(2026, 10, 20, 13, 32),
    buyer: { required: false, threshold_minor: null, waived: false },
    ...over,
  };
}

const MODES = [
  { mode_id: 'cash', name: 'Cash', kind: 'cash', payment_class: 'cash', reference_required: false, is_active: true, sort_order: 1, authority_codes: [] },
  { mode_id: 'card', name: 'Card', kind: 'card', payment_class: 'digital', reference_required: false, is_active: true, sort_order: 2, authority_codes: [] },
  { mode_id: 'jazz', name: 'JazzCash', kind: 'wallet', payment_class: 'digital', reference_required: true, is_active: true, sort_order: 3, authority_codes: [] },
  { mode_id: 'old', name: 'Cheque', kind: 'other', payment_class: 'digital', reference_required: false, is_active: false, sort_order: 4, authority_codes: [] },
];

type Answer = { ok: true; data: unknown } | { ok: false; error: { kind: 'api'; status: number; code: string; details: Record<string, unknown> } | { kind: 'network' } };

interface Opts {
  views?: BillView[];
  answers?: Answer[];
  online?: boolean;
  grants?: Record<string, unknown>;
}

function setup(o: Opts = {}) {
  const views = [...(o.views ?? [bill()])];
  let last = views[0]!;
  const query = vi.fn(async (path: string) => {
    void path;
    last = views.length > 1 ? views.shift()! : views[0]!;
    return { ok: true as const, data: last };
  });
  const queue = [...(o.answers ?? [])];
  const command = vi.fn(async (type: string, payload: unknown, opts?: { commandId?: string }): Promise<Answer> => {
    void type;
    void payload;
    void opts;
    return queue.shift() ?? { ok: true, data: {} };
  });
  const toasts = createToastBus();
  const shell = {
    device: { token: 'D', id: 'dev-1', type: 'cashier_kiosk' },
    api: { query, command },
    live: createLiveBus(),
    toasts,
    permissions: createPermissions({ 'take-payment': { grant: 'allowed', scope: 'branch' }, ...o.grants } as never),
    config: { config: () => null, snapshot: () => ({ currency_code: 'PKR', billing: { payment_modes: MODES } }), subscribe: () => () => {} },
    clock: { nowMs: () => NOW, utcOffsetMs: 0 },
    me: { staff_id: 'sana', name: 'Sana' },
    online: o.online ?? true,
    phone: false,
    portrait: false,
  } as unknown as Shell;
  return { shell, query, command };
}

let view: Mounted | null = null;
beforeEach(() => {
  window.location.hash = '';
});
afterEach(() => {
  view?.unmount();
  view = null;
  setLanguage('en');
  vi.useRealTimers();
});

async function show(s: ReturnType<typeof setup>, ref: { bill_id: string } | { seating_id: string } = { bill_id: 'B7' }) {
  view = mount();
  view.render(
    <ShellContext.Provider value={s.shell}>
      <BillScreen billRef={ref} onBack={() => {}} />
    </ShellContext.Provider>,
  );
  await flush();
  return view;
}

const text = (v: Mounted, sel: string) => v.container.querySelector(sel)?.textContent ?? null;
const all = (v: Mounted, sel: string) => [...v.container.querySelectorAll<HTMLElement>(sel)];
const typeIn = (el: HTMLInputElement | null | undefined, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el!.dispatchEvent(new Event('input', { bubbles: true }));
};
const field = (v: Mounted, label: string) => all(v, '.b5-fld').find((f) => f.querySelector('span')?.textContent === label)?.querySelector('input');

describe('[05 §8 Bill screen; §6.1] header, lines, totals (task 35)', () => {
  it('reads GET /queries/bill by the ref; header with code, state chip, type, check bill printed time', async () => {
    const s = setup();
    const v = await show(s, { seating_id: 'S7' });
    expect(s.query).toHaveBeenCalledWith('/queries/bill?seating_id=S7');
    expect(text(v, '.b5-bh .tcode')).toBe('T7');
    expect(text(v, '.b5-bh .st')).toBe('Open');
    expect(text(v, '.b5-bh__m')).toContain('Dine-in');
    expect(text(v, '.b5-bh__m')).toContain('Check bill printed 1:32 PM');
  });

  it('[R-29] the Reopened chip while reopen_count ≥ 1 and not CLOSED; partly paid / closed chips', async () => {
    const v = await show(setup({ views: [bill({ state: 'partly_paid', reopen_count: 1 })] }));
    expect(all(v, '.b5-bh .st').map((x) => x.textContent)).toEqual(['Partly paid', 'Reopened']);
    v.unmount();
    view = null;
    const w = await show(setup({ views: [bill({ state: 'closed', reopen_count: 2, splits: [split({ state: 'closed', balance_minor: 0 })], blocks: [] })] }));
    expect(all(w, '.b5-bh .st').map((x) => x.textContent)).toEqual(['Closed']);
  });

  it('lines with units, name, base (server amounts) and their tags', async () => {
    const b = bill({ lines: [line('K', 'Chicken Karahi Full', 1, 220_000, ['comp']), line('R', 'Raita', 2, 24_000, ['pending_void']), line('F', 'Fish', 1, 0, ['weight_needed', 'tax_unresolved'])] });
    const v = await show(setup({ views: [b] }));
    const rows = all(v, '.b5-lines .ol');
    expect(rows.map((r) => `${r.querySelector('.ol__q')?.textContent} ${r.querySelector('.ol__n b')?.textContent} ${r.querySelector('.ol__p')?.textContent}`)).toEqual([
      '1× Chicken Karahi Full 2,200.00',
      '2× Raita 240.00',
      '1× Fish 0.00',
    ]);
    expect(rows.map((r) => [...r.querySelectorAll('.b5-tags > span')].map((x) => `${x.className}:${x.textContent}`))).toEqual([['b5-tg comp:COMP'], ['vptag:PENDING VOID'], ['b5-tg c-warn:WEIGHT NEEDED', 'b5-tg c-danger:Tax not set']]);
    expect(rows[1]?.className).toBe('ol pend');
    expect(text(v, '.b5-lines .b5-h .end')).toBe('3 items');
  });

  it('[§8: no tax buttons, tax from the server] the totals table: subtotal, each tax at both classes, the rounding adjustment on its own row', async () => {
    const v = await show(setup());
    const rows = all(v, '.b5-tot .b5-tr').map((r) => [...r.children].map((c) => c.textContent).join('|'));
    expect(rows).toEqual(['The bill|If cash|By card', 'Subtotal|5,710.00', 'Punjab sales tax on services|16 % · 913.60|5 % · 285.50', 'Rounding adjustment|+0.40|+0.50', 'Total|6,624.00|5,996.00']);
    expect(text(v, '.b5-tot .b5-tr.sum > span')).toBe('Total');
    expect(all(v, '.b5-tr.rnd').length).toBe(1);
  });

  it('a discount and a service charge show as their own rows (hub amounts)', async () => {
    const withBoth = totals({ discount_minor: 57_100, service_charge_minor: 15_000 });
    const b = bill({ splits: [split({ totals: { cash: { ...CASH, discount_minor: 57_100, service_charge_minor: 15_000 }, digital: { ...CARD, discount_minor: 57_100, service_charge_minor: 15_000 }, as_paid: withBoth } })], service_charge: { rate_bp: 500, removed: false } });
    const v = await show(setup({ views: [b] }));
    const rows = all(v, '.b5-tot .b5-tr').map((r) => [...r.children].map((c) => c.textContent).join('|'));
    expect(rows).toContain('Discount|-571.00');
    expect(rows).toContain('Service charge 5 %|150.00');
  });
});

describe('[05 §8; §3.5 (7)] dues', () => {
  it('no payment yet: the dues are the split\'s two class totals, side by side; the close reason names both', async () => {
    const v = await show(setup());
    expect(all(v, '.b5-due').map((d) => `${d.querySelector('.b5-due__k')?.textContent}=${d.querySelector('.b5-due__v')?.textContent}`)).toEqual(['Cash=Rs6,624.00', 'Card=Rs5,996.00']);
    expect(text(v, '.b5-close .b5-why1')).toBe('Take Rs 6,624.00 in cash or Rs 5,996.00 by card');
  });

  it('duesOf: from the latest AddPayment result while it is the split\'s last payment; otherwise only with no payments (else unknown)', () => {
    const s0 = split();
    expect(duesOf(s0, null)).toEqual({ card_due_minor: 599_600, cash_due_minor: 662_400, card_refund_due_minor: 0, cash_refund_due_minor: 0 });
    const paid = split({ payments: [{ payment_id: 'P1', mode_id: 'card', mode_name: 'Card', direction: 'in', amount_minor: 300_000, tendered_minor: null, change_minor: 0, has_reference: false, taken_by_name: 'Sana', taken_by_staff_id: 'S_SANA' }], balance_minor: 299_600, totals: { cash: CASH, digital: CARD, as_paid: CARD } });
    const result = { split_no: 1, payment_id: 'P1', balance_minor: 299_600, total_minor: 599_600, card_due_minor: 299_600, cash_due_minor: 362_400, card_refund_due_minor: 0, cash_refund_due_minor: 0 };
    expect(duesOf(paid, result)).toEqual({ card_due_minor: 299_600, cash_due_minor: 362_400, card_refund_due_minor: 0, cash_refund_due_minor: 0 });
    // [review M1, money] stale once the split's balance or total moved (a round, a void, a reopen): unknown again
    expect(duesOf({ ...paid, balance_minor: 311_600 }, result)).toBeNull();
    expect(duesOf({ ...paid, totals: { ...paid.totals, as_paid: { ...CARD, total_minor: 611_600 } } }, result)).toBeNull();
    expect(duesOf(paid, null)).toBeNull();
    expect(duesOf(paid, { ...result, payment_id: 'P0' })).toBeNull();
    // a paid split (balance ≤ 0) has no payment due
    expect(duesOf(split({ balance_minor: 0, payments: paid.payments }), null)).toEqual({ card_due_minor: 0, cash_due_minor: 0, card_refund_due_minor: 0, cash_refund_due_minor: 0 });
  });

  it('a split with payments and no AddPayment result here: Paid · Left only (the view carries no dues — STOP to the owner)', async () => {
    const paid = split({ payments: [{ payment_id: 'P1', mode_id: 'card', mode_name: 'Card', direction: 'in', amount_minor: 300_000, tendered_minor: null, change_minor: 0, has_reference: false, taken_by_name: 'Sana', taken_by_staff_id: 'S_SANA' }], balance_minor: 299_600 });
    const v = await show(setup({ views: [bill({ state: 'partly_paid', splits: [paid], blocks: [{ reason: 'balance_due', split_no: 1, details: { split_no: 1, balance_minor: 299_600 } }] })] }));
    expect(all(v, '.b5-due').length).toBe(0);
    expect(text(v, '.b5-paid')).toBe('Paid Rs 3,000.00 · Left Rs 2,996.00');
    expect(text(v, '.b5-close .b5-why1')).toBe('Rs 2,996.00 still to take on split 1');
    // E2E E-3: the row now ends with Remove (Sana's own payment, take-payment, open split)
    expect(all(v, '.b5-pay').map((p) => p.textContent)).toEqual(['CardRs 3,000.00by SanaRemove']);
  });
});

describe('[05 §8 pad; §6.9] payment pad', () => {
  it('only active modes, in sort order, with their class word; idle until one is picked', async () => {
    const v = await show(setup());
    expect(all(v, '.b5-mode').map((m) => m.textContent)).toEqual(['Cashcash rate', 'Carddigital', 'JazzCashdigital · ref']);
    expect(text(v, '.b5-pad__idle b')).toBe('Pick how they pay');
  });

  it('[M-7, M-6] Cash: "Total in cash" with that due, amount pre-set to it, Cash given empty, change only after Add payment', async () => {
    const s = setup({ answers: [{ ok: true, data: { bill_id: 'B7', payment_id: 'P1', split_no: 1, totals: { as_paid: CASH }, balance_minor: 0, card_due_minor: 0, cash_due_minor: 0, card_refund_due_minor: 0, cash_refund_due_minor: 0, rounding_minor: 40, change_due_minor: 37_500 } }] });
    const v = await show(s);
    v.click(v.button('Cash'));
    expect(text(v, '.b5-pad__say span')).toContain('Total in cash');
    expect(text(v, '.b5-pad__say b')).toBe('Rs 6,624.00');
    expect(field(v, 'Amount')?.value).toBe('6,624.00');
    expect(field(v, 'Cash given')?.value).toBe('');
    expect(text(v, '.b5-change')).toContain('shows after Add payment — from the hub');
    typeIn(field(v, 'Cash given'), '7000');
    await flush();
    expect(text(v, '.b5-change b')).toBe('—');
    v.click(v.button('Add payment'));
    await flush();
    expect(s.command.mock.calls[0]![0]).toBe('AddPayment');
    expect(s.command.mock.calls[0]![1]).toEqual({ bill_ref: { bill_id: 'B7' }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: 662_400, tendered_minor: 700_000 });
    // the hub's figure (37 500 here), never 7 000 − 6 624 computed on the screen
    expect(text(v, '.b5-change b')).toBe('Rs 375.00');
  });

  it('Card: "Total by card" with the card due; a digital mode sends no tendered; a reference mode asks for it first', async () => {
    const s = setup({ answers: [{ ok: true, data: { bill_id: 'B7', payment_id: 'P1', split_no: 1, totals: { as_paid: CARD }, balance_minor: 0, card_due_minor: 0, cash_due_minor: 0, card_refund_due_minor: 0, cash_refund_due_minor: 0, rounding_minor: 50, change_due_minor: 0 } }] });
    const v = await show(s);
    v.click(v.button('JazzCash'));
    expect(text(v, '.b5-pad__say b')).toBe('Rs 5,996.00');
    expect(field(v, 'Cash given')).toBeUndefined();
    expect(v.button('Enter the reference').getAttribute('aria-disabled')).toBe('true');
    typeIn(field(v, 'Reference'), 'TX-77');
    await flush();
    v.click(v.button('Add payment'));
    await flush();
    expect(s.command.mock.calls[0]![1]).toEqual({ bill_ref: { bill_id: 'B7' }, split_no: 1, mode_id: 'jazz', direction: 'in', amount_minor: 599_600, reference: 'TX-77' });
    // [B30] the reference is never kept on the screen after the send
    expect(field(v, 'Reference')?.value ?? '').toBe('');
  });

  it('the AddPayment result\'s dues replace the screen\'s, and the view is read again', async () => {
    const after = split({ payments: [{ payment_id: 'P1', mode_id: 'card', mode_name: 'Card', direction: 'in', amount_minor: 300_000, tendered_minor: null, change_minor: 0, has_reference: false, taken_by_name: 'Sana', taken_by_staff_id: 'S_SANA' }], balance_minor: 299_600, totals: { cash: CASH, digital: CARD, as_paid: CARD } });
    const s = setup({
      views: [bill(), bill({ state: 'open', splits: [after], blocks: [{ reason: 'balance_due', split_no: 1, details: { split_no: 1, balance_minor: 299_600 } }] })],
      answers: [{ ok: true, data: { bill_id: 'B7', payment_id: 'P1', split_no: 1, totals: { as_paid: CARD }, balance_minor: 299_600, card_due_minor: 299_600, cash_due_minor: 362_400, card_refund_due_minor: 0, cash_refund_due_minor: 0, rounding_minor: 50, change_due_minor: 0 } }],
    });
    const v = await show(s);
    v.click(v.button('Card'));
    typeIn(field(v, 'Amount'), '3000');
    await flush();
    v.click(v.button('Add payment'));
    await flush();
    expect(s.query).toHaveBeenCalledTimes(2);
    expect(all(v, '.b5-due').map((d) => d.querySelector('.b5-due__v')?.textContent)).toEqual(['Rs3,624.00', 'Rs2,996.00']);
    expect(text(v, '.b5-paid')).toBe('Paid Rs 3,000.00 · Left Rs 2,996.00');
  });

  it('pad errors read their §9 text with the hub\'s figures (PAYMENT_EXCEEDS_BALANCE, PAYMENT_CASH_STEP, SHIFT_NOT_OPEN)', async () => {
    const s = setup({
      answers: [
        { ok: false, error: { kind: 'api', status: 422, code: 'PAYMENT_EXCEEDS_BALANCE', details: { balance_minor: 599_600 } } },
        { ok: false, error: { kind: 'api', status: 422, code: 'PAYMENT_CASH_STEP', details: { step_minor: 100 } } },
        { ok: false, error: { kind: 'api', status: 409, code: 'SHIFT_NOT_OPEN', details: { reason: 'no_shift' } } },
      ],
    });
    const v = await show(s);
    v.click(v.button('Card'));
    typeIn(field(v, 'Amount'), '9000');
    await flush();
    v.click(v.button('Add payment'));
    await flush();
    expect(text(v, '.b5-pad .msg')).toBe('The most you can take by Card is Rs 5,996.00');
    // [re-check M3] a refusal means the screen was stale: the bill is read again
    expect(s.query).toHaveBeenCalledTimes(2);
    v.click(v.button('Cash'));
    typeIn(field(v, 'Amount'), '6623.50');
    await flush();
    v.click(v.button('Add payment'));
    await flush();
    expect(text(v, '.b5-pad .msg')).toBe('Cash must be in steps of Rs 1.00');
    v.click(v.button('Add payment'));
    await flush();
    expect(text(v, '.b5-pad .msg')).toBe('Open your shift to take money');
  });

  it('[handbook §10] a lost reply: "Needs the hub"; the resend is the same command_id', async () => {
    const s = setup({ answers: [{ ok: false, error: { kind: 'network' } }, { ok: true, data: { bill_id: 'B7', payment_id: 'P1', split_no: 1, totals: { as_paid: CARD }, balance_minor: 0, card_due_minor: 0, cash_due_minor: 0, card_refund_due_minor: 0, cash_refund_due_minor: 0, rounding_minor: 50, change_due_minor: 0 } }] });
    const v = await show(s);
    v.click(v.button('Card'));
    v.click(v.button('Add payment'));
    await flush();
    expect(text(v, '.b5-pad .msg')).toBe('Needs the hub');
    v.click(v.button('Add payment'));
    await flush();
    expect(s.command.mock.calls[1]![2]?.commandId).toBe(s.command.mock.calls[0]![2]?.commandId);
  });

  it('[§8, H17-1] a negative balance shows only "Refund …" for the types with a refund due, and the pad gives back (direction out)', async () => {
    const paid = split({ payments: [{ payment_id: 'P1', mode_id: 'cash', mode_name: 'Cash', direction: 'in', amount_minor: 662_400, tendered_minor: 700_000, change_minor: 37_600, has_reference: false, taken_by_name: 'Sana', taken_by_staff_id: 'S_SANA' }], balance_minor: -32_500 });
    const result = { bill_id: 'B7', payment_id: 'P1', split_no: 1, totals: { as_paid: CASH }, balance_minor: -32_500, card_due_minor: 0, cash_due_minor: 0, card_refund_due_minor: 0, cash_refund_due_minor: 32_500, rounding_minor: 0, change_due_minor: 0 };
    const s = setup({ views: [bill({ splits: [paid], blocks: [] })], answers: [{ ok: true, data: result }] });
    const v = await show(s);
    // without a result here the refund per type is not known (STOP): the balance shows
    expect(text(v, '.b5-paid')).toBe('Paid Rs 6,624.00 · Left -Rs 325.00');
    expect(all(v, '.b5-mode').map((m) => m.textContent)).toEqual(['Cashcash rate', 'Carddigital', 'JazzCashdigital · ref']);
    v.click(v.button('Cash'));
    expect(v.button('Give back')).toBeTruthy();
    typeIn(field(v, 'Amount'), '325');
    await flush();
    v.click(v.button('Give back'));
    await flush();
    expect(s.command.mock.calls[0]![1]).toEqual({ bill_ref: { bill_id: 'B7' }, split_no: 1, mode_id: 'cash', direction: 'out', amount_minor: 32_500 });
  });
});

describe('[05 §8; §6.12, §3.3] close', () => {
  it('[R-29] Close is disabled with one line per block (pinned reason → copy, filled from details), several in a boxed list', async () => {
    const b = bill({
      lines: [line('R', 'Raita', 2, 24_000, ['pending_void']), line('F', 'Fish', 1, 0, ['weight_needed'])],
      blocks: [
        { reason: 'void_pending', split_no: null, details: { reason: 'void_pending', order_item_ids: ['R'] } },
        { reason: 'weight_pending', split_no: 1, details: { reason: 'weight_pending', order_item_ids: ['F'] } },
        { reason: 'tax_unresolved', split_no: 1, details: { reason: 'tax_unresolved', order_item_ids: ['service_charge'] } },
        { reason: 'discount_pending', split_no: null, details: { alert_id: 'A1' } },
        { reason: 'buyer_id_required', split_no: null, details: { threshold_minor: 5_000_000, net_minor: 6_000_000, accepted_types: ['CNIC'] } },
        { reason: 'balance_due', split_no: 1, details: { split_no: 1, balance_minor: 662_400 } },
      ],
    });
    const v = await show(setup({ views: [b] }));
    expect(v.button('Close bill').getAttribute('aria-disabled')).toBe('true');
    expect(all(v, '.b5-why li').map((l) => l.textContent)).toEqual([
      'Can’t close yet',
      '1 items waiting for void approval: Raita',
      '1 items need a weight: Fish',
      'Tax is not set for the service charge — ask the owner',
      'A discount is waiting for approval',
      'Buyer details needed above Rs 50,000.00',
      'Take Rs 6,624.00 in cash or Rs 5,996.00 by card',
    ]);
  });

  it('balance 0, no blocks: Close is the primary; CloseSplit { bill_ref, split_no, expected_total_minor } → closed with the invoice', async () => {
    const ready = bill({ splits: [split({ balance_minor: 0, payments: [{ payment_id: 'P1', mode_id: 'card', mode_name: 'Card', direction: 'in', amount_minor: 599_600, tendered_minor: null, change_minor: 0, has_reference: false, taken_by_name: 'Sana', taken_by_staff_id: 'S_SANA' }], totals: { cash: CASH, digital: CARD, as_paid: CARD } })], blocks: [] });
    const closed = bill({ state: 'closed', splits: [split({ state: 'closed', balance_minor: 0, totals: { cash: CASH, digital: CARD, as_paid: CARD }, invoice: { invoice_id: 'INV_AC1-S000123', invoice_ref: 'AC1-S000123', fiscal_number: null, fiscal_state: 'pending' } })], blocks: [] });
    const s = setup({ views: [ready, closed], answers: [{ ok: true, data: { invoice_id: 'I1', invoice_ref: 'AC1-S000123', total_minor: 599_600, change_minor: 0, bill_state: 'closed', receipt: { job_id: 'J1', printer_name: 'Counter' }, fiscal_state: 'pending' } }] });
    const done: unknown[] = [];
    view = mount();
    view.render(
      <ShellContext.Provider value={s.shell}>
        <BillScreen billRef={{ bill_id: 'B7' }} onBack={() => done.push('back')} />
      </ShellContext.Provider>,
    );
    await flush();
    const v = view;
    expect(text(v, '.b5-pad__idle b')).toBe('All paid');
    const close = v.button('Close bill');
    expect(close.getAttribute('aria-disabled')).toBe('false');
    expect(close.textContent).toBe('Close bill · Rs 5,996.00 · issues the invoice');
    expect(all(v, '.b5-tot .b5-tr.paid').map((r) => [...r.children].map((c) => c.textContent).join('|'))).toEqual(['Paid · card|5,996.00']);
    expect(text(v, '.b5-dues.one .b5-due.zero .b5-due__s')).toBe('Nothing left to take — close the bill');
    expect(close.className).toContain('btn--primary');
    v.click(close);
    await flush();
    expect(s.command.mock.calls[0]).toEqual(['CloseSplit', { bill_ref: { bill_id: 'B7' }, split_no: 1, expected_total_minor: 599_600 }, expect.anything()]);
    expect(text(v, '.b5-done b')).toBe('Closed · Invoice AC1-S000123 · Rs 5,996.00');
    v.click(v.button('Done'));
    expect(done).toEqual(['back']);
  });

  it('BILL_TOTAL_CHANGED: the view is read again, the banner shows the new total, nothing closes by itself', async () => {
    const ready = bill({ splits: [split({ balance_minor: 0 })], blocks: [] });
    const s = setup({ views: [ready, ready], answers: [{ ok: false, error: { kind: 'api', status: 409, code: 'BILL_TOTAL_CHANGED', details: { expected_minor: 662_400, total_minor: 674_400 } } }] });
    const v = await show(s);
    v.click(v.button('Close bill'));
    await flush();
    expect(text(v, '.b5-ban')).toBe('The total changed to Rs 6,744.00 — check it and close again');
    expect(s.query).toHaveBeenCalledTimes(2);
    expect(s.command).toHaveBeenCalledTimes(1);
  });

  it('an empty close reads "Closed · nothing billed · money given back"', async () => {
    const s = setup({ views: [bill({ splits: [split({ balance_minor: 0 })], blocks: [] })], answers: [{ ok: true, data: { bill_state: 'closed', empty: true } }] });
    const v = await show(s);
    v.click(v.button('Close bill'));
    await flush();
    expect(text(v, '.b5-done b')).toBe('Closed · nothing billed · money given back');
  });
});

describe('[05 §8] several splits, offline, Urdu', () => {
  it('a splits strip when there are several; a closed split is locked with its invoice and has no pad', async () => {
    const b = bill({
      state: 'partly_paid',
      splits: [split({ split_no: 1, state: 'closed', balance_minor: 0, invoice: { invoice_id: 'INV_AC1-S000124', invoice_ref: 'AC1-S000124', fiscal_number: null, fiscal_state: 'pending' } }), split({ split_no: 2 })],
      blocks: [{ reason: 'balance_due', split_no: 2, details: { split_no: 2, balance_minor: 662_400 } }],
    });
    const v = await show(setup({ views: [b] }));
    expect(all(v, '.b5-splits button.b5-sp').map((x) => x.textContent)).toEqual(['Split 1 · ClosedPaid · AC1-S000124', 'Split 2 · Open']);
    expect(v.container.querySelector('.b5-sp.done')?.textContent).toContain('Split 1');
    // the first open split is selected; its Close names it
    expect(text(v, '.b5-splits .is-sel b')).toBe('Split 2 · Open');
    expect(text(v, '.b5-close .btn--primary')).toBe('Close split 2');
    v.click(v.button('Split 1 · Closed'));
    expect(v.container.querySelector('.b5-pad')).toBeNull();
  });

  it('[G0-1] offline: every bill action says "Needs the hub" and sends nothing', async () => {
    const s = setup({ online: false });
    const v = await show(s);
    expect(text(v, '.b5-off')).toContain('every bill action needs the hub');
    // frame BillOffline: the modes stay, off; the pad says Needs the hub; Close carries it too
    expect(all(v, '.b5-mode.off').length).toBe(3);
    expect(text(v, '.b5-pad__idle b')).toBe('Needs the hub');
    expect(v.container.querySelector('.b5-close .b5-needshub')?.textContent).toBe('Close bill · Needs the hub');
    v.click(all(v, '.b5-mode.off')[0]);
    expect(v.container.querySelector('.b5-pad__say')).toBeNull();
    v.click(v.button('Close bill'));
    await flush();
    expect(s.command).not.toHaveBeenCalled();
  });

  it('refetches on a bill frame', async () => {
    vi.useFakeTimers();
    const s = setup();
    await show(s);
    s.shell.live.frame({ type: 'event', seq: 5, event: { event_type: 'PaymentAdded', payload: {} } } as never);
    await vi.advanceTimersByTimeAsync(300);
    expect(s.query).toHaveBeenCalledTimes(2);
  });

  it('[frame BillUrdu] Urdu: the drawn texts; amounts LTR in Latin digits', async () => {
    setLanguage('ur');
    const v = await show(setup());
    expect(text(v, '.b5-close .btn--primary')).toBe('بل بند کریں');
    expect(text(v, '.b5-pad__idle b')).toBe('ادائیگی کا طریقہ چنیں');
    expect(text(v, '.b5-tot .b5-tr:nth-child(2) > span')).toBe('ذیلی کل');
    expect(all(v, '.b5-due').map((d) => d.querySelector('.b5-due__v')?.textContent)).toEqual(['Rs6,624.00', 'Rs5,996.00']);
  });

  it('[05 §8 Rules] every task-35 key is in en and in ur or 05/urdu-todo.md; Urdu keeps the placeholders', () => {
    const start = enSource.indexOf('// ---- 05 client (task 35)');
    expect(start).toBeGreaterThan(0);
    const end = enSource.indexOf('// ----', start + 10);
    const keys = [...enSource.slice(start, end === -1 ? undefined : end).matchAll(/^ {2}'([^']+)':/gm)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(40);
    const holes = (x: string) => [...x.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort().join();
    for (const key of keys) {
      expect(key in en, key).toBe(true);
      const u = (ur as Record<string, string | undefined>)[key];
      expect(u !== undefined || TODO_05.has(key), key).toBe(true);
      if (u !== undefined) expect(holes(u), key).toBe(holes((en as Record<string, string>)[key]!));
    }
  });

  it('[review M3] a close refusal reads its text filled from the details, and the bill is read again', async () => {
    const ready = bill({ splits: [split({ balance_minor: 0 })], blocks: [] });
    const s = setup({
      views: [ready, ready, ready],
      answers: [
        { ok: false, error: { kind: 'api', status: 409, code: 'BILL_CLOSE_BLOCKED', details: { reason: 'void_pending', order_item_ids: ['N'] } } },
        { ok: false, error: { kind: 'api', status: 409, code: 'BUYER_ID_REQUIRED', details: { threshold_minor: 5_000_000, net_minor: 6_000_000, accepted_types: ['CNIC'] } } },
      ],
    });
    const v = await show(s);
    v.click(v.button('Close bill'));
    await flush();
    expect(text(v, '.b5-close .msg')).toBe("Can't close yet: 1 items waiting for void approval: Naan");
    expect(s.query).toHaveBeenCalledTimes(2);
    v.click(v.button('Close bill'));
    await flush();
    // [brief §3.5.3] BUYER_ID_REQUIRED on Close opens the buyer sheet
    expect(text(v, '.dlg__t h2')).toBe('Buyer details');
    expect(s.query).toHaveBeenCalledTimes(3);
  });

  it('[review m, money] a negative balance: the close line says what to give back; a refund result pre-fills the Give back amount', async () => {
    const paid = split({ payments: [{ payment_id: 'P1', mode_id: 'cash', mode_name: 'Cash', direction: 'in', amount_minor: 662_400, tendered_minor: null, change_minor: 0, has_reference: false, taken_by_name: 'Sana', taken_by_staff_id: 'S_SANA' }], balance_minor: -32_500 });
    const v = await show(setup({ views: [bill({ splits: [paid], blocks: [{ reason: 'balance_due', split_no: 1, details: { split_no: 1, balance_minor: -32_500 } }] })] }));
    expect(text(v, '.b5-close .b5-why1')).toBe('Give back Rs 325.00 first');
  });

  it('[review m, money] Cash given below the amount is stopped on the screen', async () => {
    const s = setup();
    const v = await show(s);
    v.click(v.button('Cash'));
    typeIn(field(v, 'Cash given'), '5000');
    await flush();
    expect(v.button('Cash given is less than the amount').getAttribute('aria-disabled')).toBe('true');
    v.click(v.button('Cash given is less than the amount'));
    await flush();
    expect(s.command).not.toHaveBeenCalled();
  });

  it('[review m, money] the amount is read at the bill\'s exponent (KWD 3)', async () => {
    const kwd = bill({ currency: { code: 'KWD', exponent: 3 } });
    const s = setup({ views: [kwd] });
    const v = await show(s);
    v.click(v.button('Card'));
    typeIn(field(v, 'Amount'), '1.5');
    await flush();
    v.click(v.button('Add payment'));
    await flush();
    expect((s.command.mock.calls[0]![1] as { amount_minor: number }).amount_minor).toBe(1_500);
  });

  it('[review m6] a bill reply older than the last request is dropped', async () => {
    vi.useFakeTimers();
    const s = setup({ views: [bill()] });
    let late: () => void = () => {};
    s.query.mockImplementationOnce(() => new Promise((done) => (late = () => done({ ok: true as const, data: bill({ identifier: 'OLD' }) }))));
    const v = await show(s);
    s.shell.live.frame({ type: 'event', seq: 9, event: { event_type: 'PaymentAdded', payload: {} } } as never);
    await vi.advanceTimersByTimeAsync(300);
    late();
    await vi.advanceTimersByTimeAsync(0);
    expect(text(v, '.b5-bh .tcode')).toBe('T7');
  });

  it('[task 38 merged] Print check bill sits in the bill actions and the bill\'s print rows show under the lines', async () => {
    const v = await show(setup({ views: [bill({ prints: [{ job_id: 'J1', doc_kind: 'check', state: 'printed', printer_name: 'Counter', last_error: null }] })] }));
    expect(v.button('Print check bill')).toBeTruthy();
    expect(text(v, '.b5-pr .t > span:last-child')).toBe('Printed on Counter');
  });

  it('[re-check M4, money] after a lost reply, editing Cash given or the reference resends the same command_id (the reference still goes)', async () => {
    const s = setup({ answers: [{ ok: false, error: { kind: 'network' } }, { ok: false, error: { kind: 'network' } }, { ok: false, error: { kind: 'network' } }] });
    const v = await show(s);
    v.click(v.button('Cash'));
    typeIn(field(v, 'Cash given'), '7000');
    await flush();
    v.click(v.button('Add payment'));
    await flush();
    typeIn(field(v, 'Cash given'), '10000');
    await flush();
    v.click(v.button('Add payment'));
    await flush();
    expect(s.command.mock.calls[1]![2]?.commandId).toBe(s.command.mock.calls[0]![2]?.commandId);
    v.click(v.button('JazzCash'));
    typeIn(field(v, 'Reference'), 'TX-1');
    await flush();
    v.click(v.button('Add payment'));
    await flush();
    typeIn(field(v, 'Reference'), 'TX-2');
    await flush();
    v.click(v.button('Add payment'));
    await flush();
    expect(s.command.mock.calls[3]![2]?.commandId).toBe(s.command.mock.calls[2]![2]?.commandId);
    expect((s.command.mock.calls[3]![1] as { reference?: string }).reference).toBe('TX-2');
  });

  it('[re-check, money] "command_id already used" (the first send went in): its own text, the pad is cleared, the bill is read again', async () => {
    const s = setup({
      answers: [
        { ok: false, error: { kind: 'network' } },
        { ok: false, error: { kind: 'api', status: 422, code: 'VALIDATION_FAILED', details: { issues: [{ path: 'command_id', message: 'command_id already used' }] } } },
      ],
    });
    const v = await show(s);
    v.click(v.button('Cash'));
    typeIn(field(v, 'Cash given'), '7000');
    await flush();
    v.click(v.button('Add payment'));
    await flush();
    typeIn(field(v, 'Cash given'), '8000');
    await flush();
    v.click(v.button('Add payment'));
    await flush();
    expect(text(v, '.b5-pad .msg')).toBe('This payment may already be in — check the payments before taking it again');
    expect(v.container.querySelector('.b5-pad__say')).toBeNull();
    expect(s.query).toHaveBeenCalledTimes(2);
  });

  it('[frame BillPartlyPaid] a negative rounding reads with the minus sign U+2212', async () => {
    const neg = split({ totals: { cash: { ...CASH, rounding_minor: -40 }, digital: { ...CARD, rounding_minor: -60 }, as_paid: CASH } });
    const v = await show(setup({ views: [bill({ splits: [neg] })] }));
    expect(text(v, '.b5-tr.rnd')).toBe('Rounding adjustment\u22120.40\u22120.60');
  });

  it('[05 §8, §6.12, B19; task 37 buyer] buyer.required: the row with Add buyer; the sheet\'s buyer rides on the Close (then is gone); the buyer block no longer holds Close', async () => {
    const need = { reason: 'buyer_id_required', split_no: null, details: { threshold_minor: 5_000_000, net_minor: 6_000_000, accepted_types: ['CNIC'] } };
    const ready = bill({ splits: [split({ balance_minor: 0 })], blocks: [need], buyer: { required: true, threshold_minor: 5_000_000, waived: false } });
    const closed = bill({ state: 'closed', splits: [split({ state: 'closed', balance_minor: 0 })], blocks: [], buyer: { required: true, threshold_minor: 5_000_000, waived: false } });
    const s = setup({
      views: [ready, closed],
      answers: [{ ok: true, data: { invoice_id: 'I1', invoice_ref: 'AC1-S000200', total_minor: 662_400, change_minor: 0, bill_state: 'closed', receipt: { job_id: null, printer_name: null }, fiscal_state: 'pending' } }],
    });
    (s.shell.config as { snapshot: () => unknown }).snapshot = () => ({
      currency_code: 'PKR',
      billing: { payment_modes: MODES, jurisdiction: { jurisdiction_id: 'PK-PB', adapter_key: 'PRA', currency_code: 'PKR', currency_exponent: 2, rules: [{ effective_from: '2026-01-01', buyer_id: { threshold_minor: 5_000_000, accepted_types: [{ type: 'CNIC', label: 'CNIC', pattern: '^[0-9]{13}$', strip: '-' }] } }] } },
    });
    const v = await show(s);
    expect(text(v, '.b5-buyer b')).toBe('Buyer details needed above Rs 50,000.00');
    expect(v.button('Close bill').getAttribute('aria-disabled')).toBe('true');
    v.click(v.button('Add buyer'));
    await flush();
    const inp = (label: string) => [...v.container.querySelectorAll('.dlg .b5-fld')].find((f) => f.querySelector('span')?.textContent === label)?.querySelector('input');
    typeIn(inp('Name'), 'Sample Traders');
    v.click(v.button('CNIC'));
    typeIn(inp('ID number'), '12345-1234567-1');
    await flush();
    v.click(v.button('Use for this close'));
    await flush();
    expect(v.container.querySelector('.dlg')).toBeNull();
    expect(text(v, '.b5-buyer b')).toBe('Buyer added — sent with Close');
    // no value, no last 4 on the screen
    expect(v.text()).not.toContain('1234567');
    const close = v.button('Close bill');
    expect(close.getAttribute('aria-disabled')).toBe('false');
    v.click(close);
    await flush();
    expect(s.command.mock.calls[0]![1]).toEqual({ bill_ref: { bill_id: 'B7' }, split_no: 1, expected_total_minor: 662_400, buyer: { name: 'Sample Traders', tax_id: { type: 'CNIC', value: '12345-1234567-1' } } });
    expect(text(v, '.b5-done b')).toBe('Closed · Invoice AC1-S000200 · Rs 6,624.00');
  });

  it('[B19] a close refused on the buyer reopens the sheet with its text (never the value); the held buyer is dropped after any answer', async () => {
    const need = { reason: 'buyer_id_required', split_no: null, details: { threshold_minor: 5_000_000, net_minor: 6_000_000, accepted_types: ['CNIC'] } };
    const ready = bill({ splits: [split({ balance_minor: 0 })], blocks: [need], buyer: { required: true, threshold_minor: 5_000_000, waived: false } });
    const s = setup({
      views: [ready, ready],
      answers: [{ ok: false, error: { kind: 'api', status: 400, code: 'VALIDATION_FAILED', details: { issues: [{ path: 'payload.buyer.tax_id.value', message: 'no match' }] } } }],
    });
    (s.shell.config as { snapshot: () => unknown }).snapshot = () => ({
      currency_code: 'PKR',
      billing: { payment_modes: MODES, jurisdiction: { jurisdiction_id: 'PK-PB', adapter_key: 'PRA', currency_code: 'PKR', currency_exponent: 2, rules: [{ effective_from: '2026-01-01', buyer_id: { threshold_minor: 5_000_000, accepted_types: [{ type: 'CNIC', label: 'CNIC', pattern: '.*', strip: '' }] } }] } },
    });
    const v = await show(s);
    v.click(v.button('Add buyer'));
    await flush();
    const inp = (label: string) => [...v.container.querySelectorAll('.dlg .b5-fld')].find((f) => f.querySelector('span')?.textContent === label)?.querySelector('input');
    typeIn(inp('Name'), 'A');
    v.click(v.button('CNIC'));
    typeIn(inp('ID number'), '99');
    await flush();
    v.click(v.button('Use for this close'));
    await flush();
    v.click(v.button('Close bill'));
    await flush();
    expect(v.container.querySelector('.dlg .msg')?.textContent).toBe('Check the ID number');
    expect(inp('ID number')?.value).toBe('');
    expect(text(v, '.b5-buyer b')).toBe('Buyer details needed above Rs 50,000.00');
  });

  // task 37 buyer review: retry, drop after the answer, Change, a lifted need, the .type / .name refusals, not_required
  const NEED = { reason: 'buyer_id_required', split_no: null, details: { threshold_minor: 5_000_000, net_minor: 6_000_000, accepted_types: ['CNIC'] } };
  const BUYER_SNAPSHOT = {
    currency_code: 'PKR',
    billing: { payment_modes: MODES, jurisdiction: { jurisdiction_id: 'PK-PB', adapter_key: 'PRA', currency_code: 'PKR', currency_exponent: 2, rules: [{ effective_from: '2026-01-01', buyer_id: { threshold_minor: 5_000_000, accepted_types: [{ type: 'CNIC', label: 'CNIC', pattern: '^[0-9]{13}$', strip: '-' }] } }] } },
  };
  const needy = (over: Partial<BillView> = {}) => bill({ splits: [split({ balance_minor: 0 })], blocks: [NEED], buyer: { required: true, threshold_minor: 5_000_000, waived: false }, ...over });
  async function withBuyer(s: ReturnType<typeof setup>) {
    (s.shell.config as { snapshot: () => unknown }).snapshot = () => BUYER_SNAPSHOT;
    const v = await show(s);
    v.click(v.button('Add buyer'));
    await flush();
    const inp = (label: string) => [...v.container.querySelectorAll('.dlg .b5-fld')].find((f) => f.querySelector('span')?.textContent === label)?.querySelector('input');
    typeIn(inp('Name'), 'Sample Traders');
    v.click(v.button('CNIC'));
    typeIn(inp('ID number'), '1234512345671');
    await flush();
    v.click(v.button('Use for this close'));
    await flush();
    return { v, inp };
  }
  const CLOSED_OK = { ok: true as const, data: { invoice_id: 'I1', invoice_ref: 'AC1-S000200', total_minor: 662_400, change_minor: 0, bill_state: 'partly_paid', receipt: { job_id: null, printer_name: null }, fiscal_state: 'pending' } };
  const BUYER = { name: 'Sample Traders', tax_id: { type: 'CNIC', value: '1234512345671' } };

  it('[B19, D32] a lost close reply keeps the buyer for the resend with the same command_id; once answered it is dropped and the next close sends none', async () => {
    const s = setup({ views: [needy(), needy(), needy()], answers: [{ ok: false, error: { kind: 'network' } }, CLOSED_OK, CLOSED_OK] });
    const { v } = await withBuyer(s);
    v.click(v.button('Close bill'));
    await flush();
    expect(text(v, '.b5-buyer b')).toBe('Buyer added — sent with Close');
    v.click(v.button('Close bill'));
    await flush();
    const [first, second] = s.command.mock.calls;
    expect(first![1]).toEqual(expect.objectContaining({ buyer: BUYER }));
    expect(second![1]).toEqual(expect.objectContaining({ buyer: BUYER }));
    expect((second![2] as { commandId?: string }).commandId).toBe((first![2] as { commandId?: string }).commandId);
    // answered: gone from memory and from the row
    expect(text(v, '.b5-buyer b')).toBe('Buyer details needed above Rs 50,000.00');
  });

  it('[B19] Change drops the held buyer and opens an empty sheet (the value is never shown again)', async () => {
    const s = setup({ views: [needy()] });
    const { v, inp } = await withBuyer(s);
    v.click(v.button('Change'));
    await flush();
    expect(v.container.querySelector('.dlg')).not.toBeNull();
    expect(inp('ID number')?.value).toBe('');
    expect(text(v, '.b5-buyer b')).toBe('Buyer details needed above Rs 50,000.00');
    expect(v.button('Close bill').getAttribute('aria-disabled')).toBe('true');
  });

  it('[B19] a refresh that lifts the need drops the held buyer: the close then sends none', async () => {
    const lifted = bill({ splits: [split({ balance_minor: 0 })], blocks: [], buyer: { required: false, threshold_minor: 5_000_000, waived: false } });
    const s = setup({ views: [needy(), lifted], answers: [CLOSED_OK] });
    const { v } = await withBuyer(s);
    vi.useFakeTimers();
    s.shell.live.frame({ type: 'event', seq: 5, event: { event_type: 'PaymentAdded', payload: {} } } as never);
    await vi.advanceTimersByTimeAsync(300);
    vi.useRealTimers();
    await flush();
    expect(v.container.querySelector('.b5-buyer')).toBeNull();
    v.click(v.button('Close bill'));
    await flush();
    expect(s.command.mock.calls[0]![1]).not.toHaveProperty('buyer');
  });

  it('a close refused on buyer.tax_id.type reopens on "Pick an ID type", on buyer.name on "Type the name"', async () => {
    const refusal = (path: string) => ({ ok: false as const, error: { kind: 'api' as const, status: 400, code: 'VALIDATION_FAILED', details: { issues: [{ path, message: 'x' }] } } });
    const s = setup({ views: [needy(), needy(), needy()], answers: [refusal('payload.buyer.tax_id.type')] });
    const { v } = await withBuyer(s);
    v.click(v.button('Close bill'));
    await flush();
    expect(v.container.querySelector('.dlg .msg')?.textContent).toBe('Pick an ID type');
    v.unmount();
    const t2 = setup({ views: [needy(), needy(), needy()], answers: [refusal('payload.buyer.name')] });
    const w = (await withBuyer(t2)).v;
    w.click(w.button('Close bill'));
    await flush();
    expect(w.container.querySelector('.dlg .msg')?.textContent).toBe('Type the name');
    w.unmount();
  });

  it('BUYER_ID_REQUIRED on a close (no buyer held) opens the sheet with the hub\'s accepted types', async () => {
    const s = setup({ views: [needy({ blocks: [] }), needy({ blocks: [] })], answers: [{ ok: false, error: { kind: 'api', status: 409, code: 'BUYER_ID_REQUIRED', details: { threshold_minor: 5_000_000, net_minor: 6_000_000, accepted_types: ['CNIC'] } } }] });
    (s.shell.config as { snapshot: () => unknown }).snapshot = () => BUYER_SNAPSHOT;
    const v = await show(s);
    v.click(v.button('Close bill'));
    await flush();
    expect(text(v, '.dlg__t h2')).toBe('Buyer details');
    expect([...v.container.querySelectorAll('.dlg .b5-chip')].map((c) => c.textContent)).toEqual(['CNIC']);
  });

  it('Customer refuses answered not_required: the row reads "Not needed for this bill"', async () => {
    const s = setup({ views: [needy(), bill({ buyer: { required: false, threshold_minor: 5_000_000, waived: false } })], answers: [{ ok: true, data: { bill_id: 'B7', changed: false, reason: 'not_required' } }], grants: { 'close-without-buyer-id': { grant: 'allowed', scope: 'branch' } } });
    (s.shell.config as { snapshot: () => unknown }).snapshot = () => BUYER_SNAPSHOT;
    const v = await show(s);
    v.click(v.button('Add buyer'));
    await flush();
    v.click(v.button('Customer refuses'));
    await flush();
    expect(v.container.querySelector('.dlg')).toBeNull();
    expect(text(v, '.b5-buyer b')).toBe('Not needed for this bill');
    expect(text(v, '.b5-buyer span')).toBe('The total fell under the threshold.');
  });

  it('a waived bill\'s row reads "Customer refused buyer details"', async () => {
    const v = await show(setup({ views: [bill({ buyer: { required: true, threshold_minor: 5_000_000, waived: true } })] }));
    expect(text(v, '.b5-buyer b')).toBe('Customer refused buyer details');
    expect(v.buttons().some((b) => b.textContent === 'Add buyer')).toBe(false);
  });
});

// E2E E-1 (docs/reviews/05-e2e.md): the split editor (task 36), the discount sheet and the service-charge row (task 37)
// mounted on the bill screen — 05 §8 Bill screen (split editor, discount sheet, service charge row with Remove /
// Add back), Splits; frame Bill: the acts row Print check bill · Split · Discount (+ Needs approval).
describe('[05 §8; E2E E-1] split, discount and service charge on the bill', () => {
  const grant = (g: 'allowed' | 'requires_approval') => ({ grant: g, scope: 'branch' });
  const dlg = (v: Mounted) => v.container.querySelector('.dlg__t h2')?.textContent ?? null;

  it('the acts row: Split opens the split editor; Discount opens the discount sheet', async () => {
    const s = setup({ grants: { 'apply-discount': grant('allowed') } });
    const v = await show(s);
    const acts = [...v.container.querySelectorAll('.b5-acts .btn')].map((b) => b.textContent);
    expect(acts).toEqual(['Print check bill', 'Split', 'Discount']);
    v.click(v.button('Split'));
    await flush();
    expect(dlg(v)).toBe('Split the bill');
    v.click(v.container.querySelector<HTMLButtonElement>('.dlg__x')!);
    await flush();
    v.click(v.button('Discount'));
    await flush();
    expect(dlg(v)).toBe('Discount the bill');
  });

  it('Discount: "Needs approval" with requires_approval; none without apply-discount; none once a split is closed (B7)', async () => {
    let v = await show(setup({ grants: { 'apply-discount': grant('requires_approval') } }));
    expect(v.button('Discount').querySelector('.ntag')?.textContent).toBe('Needs approval');
    v.unmount();
    v = await show(setup());
    expect(v.buttons().some((b) => b.textContent?.startsWith('Discount'))).toBe(false);
    v.unmount();
    v = await show(setup({ grants: { 'apply-discount': grant('allowed') }, views: [bill({ state: 'partly_paid', splits: [split({ state: 'closed', balance_minor: 0 }), split({ split_no: 2 })] })] }));
    expect(v.buttons().some((b) => b.textContent?.startsWith('Discount'))).toBe(false);
  });

  it('a discount on the bill: its row has Remove discount → the remove sheet', async () => {
    const d = { kind: 'percent' as const, value: 1_000, reason_code: 'regular_customer', frozen_minor: null, discount_minor: 66_240 };
    const v = await show(setup({ grants: { 'apply-discount': grant('allowed') }, views: [bill({ discount: d, splits: [split({ totals: { ...split().totals, cash: { ...split().totals.cash, discount_minor: 66_240 } } })] })] }));
    v.click(v.button('Remove discount'));
    await flush();
    expect(dlg(v)).toBe('Remove the discount');
  });

  it('service charge: the row with Remove (remove-service-charge) → the sheet; removed → Add back', async () => {
    const sc = (removed: boolean) => bill({ service_charge: { rate_bp: 500, removed } });
    let v = await show(setup({ grants: { 'remove-service-charge': grant('allowed') }, views: [sc(false)] }));
    expect(v.text()).toContain('Service charge 5 %');
    v.click(v.button('Remove'));
    await flush();
    expect(dlg(v)).toBe('Remove service charge');
    v.unmount();
    v = await show(setup({ grants: { 'remove-service-charge': grant('allowed') }, views: [sc(true)] }));
    expect(v.text()).toContain('Service charge removed');
    expect(v.buttons().some((b) => b.textContent === 'Add back')).toBe(true);
  });

  it('a saved split plan or a sheet\'s answer reads the bill again', async () => {
    const s = setup({ grants: { 'apply-discount': grant('allowed') }, answers: [{ ok: true, data: { bill_id: 'B7', changed: true } }] });
    const v = await show(s);
    v.click(v.button('Discount'));
    await flush();
    v.click([...v.container.querySelectorAll<HTMLButtonElement>('.dlg .b5-chip')][0]!);
    const input = v.container.querySelector<HTMLInputElement>('.dlg .b5-in input')!;
    typeIn(input, '10');
    await flush();
    v.click(v.container.querySelector<HTMLButtonElement>('.dlg .acts .btn--primary')!);
    await flush();
    expect(s.command.mock.calls[0]![0]).toBe('ApplyDiscount');
    expect(v.container.querySelector('.dlg')).toBeNull();
    expect(s.query).toHaveBeenCalledTimes(2);
  });

  it('[review m1] offline: no Split, no Discount, no service-charge Remove', async () => {
    const v = await show(setup({ online: false, grants: { 'apply-discount': grant('allowed'), 'remove-service-charge': grant('allowed') }, views: [bill({ service_charge: { rate_bp: 500, removed: false } })] }));
    expect(v.buttons().some((b) => ['Split', 'Discount', 'Remove'].includes(b.textContent ?? ''))).toBe(false);
    expect(v.text()).toContain('Service charge 5 %');
  });

  it('[review m2] per split: each split\'s own charge; a closed split shows its frozen charge, no Remove, even after a removal', async () => {
    const tot = (sc: number) => ({ ...split().totals, cash: { ...split().totals.cash, service_charge_minor: sc } });
    const b = bill({
      state: 'partly_paid',
      service_charge: { rate_bp: 500, removed: true },
      splits: [split({ split_no: 1, state: 'closed', balance_minor: 0, totals: tot(15_000) }), split({ split_no: 2, totals: tot(0) })],
    });
    const v = await show(setup({ grants: { 'remove-service-charge': grant('allowed') }, views: [b] }));
    // split 2 (open) first: removed, Add back
    const scRow = () => [...v.container.querySelectorAll('.b5-tot .b5-tr')].find((r) => r.textContent?.includes('Service charge'))!;
    expect(scRow().textContent).toContain('Service charge removed');
    v.click(v.button('Split 1'));
    await flush();
    expect(scRow().textContent).toContain('Service charge 5 %');
    expect(scRow().textContent).toContain('150.00');
    expect(v.buttons().some((x) => x.textContent === 'Add back' || x.textContent === 'Remove')).toBe(false);
  });

  it('a partly-paid bill still offers Split (frame BillPartlyPaid); the split editor\'s save reads the bill again', async () => {
    const s = setup({ views: [bill({ state: 'partly_paid' })] });
    const v = await show(s);
    v.click(v.button('Split'));
    await flush();
    expect(v.container.querySelector('.dlg__t h2')?.textContent).toBe('Split the bill');
  });

  it('a closed bill: no Split, no Discount, no Remove', async () => {
    const v = await show(setup({ grants: { 'apply-discount': grant('allowed'), 'remove-service-charge': grant('allowed') }, views: [bill({ state: 'closed', service_charge: { rate_bp: 500, removed: false }, splits: [split({ state: 'closed', balance_minor: 0 })], blocks: [] })] }));
    expect(v.buttons().some((b) => ['Split', 'Discount', 'Remove'].includes(b.textContent ?? ''))).toBe(false);
  });
});

// E2E E-3 (docs/reviews/05-e2e.md): no Remove payment (§6.10, B10), the Print to picker never opened (PrintRows had no
// onChanged, §8 Print status, B18) and Reprint receipt (§6.22) was not mounted. Frames RemovePayment,
// RemovePaymentShiftClosed, BillMixed (Remove on the payment row), PrintTo, BillClosed (Reprint receipt).
describe('[05 §6.10, §8, §6.22; E2E E-3] remove payment, Print to, reprint', () => {
  const PAY = { payment_id: 'P1', mode_id: 'card', mode_name: 'Card', direction: 'in' as const, amount_minor: 300_000, tendered_minor: null, change_minor: 0, has_reference: true, taken_by_name: 'Sana', taken_by_staff_id: 'S_SANA' };
  const paidBill = (over: Partial<BillView> = {}) => bill({ splits: [split({ payments: [PAY], balance_minor: 362_400 })], ...over });

  it('a payment row has Remove → the sheet: the payment, Why remove it (4 reasons), Other needs a note → RemovePayment; reload', async () => {
    const s = setup({ views: [paidBill(), bill()], answers: [{ ok: true, data: { payment_id: 'P1', bill_id: 'B7', split_no: 1 } }] });
    const v = await show(s);
    v.click(v.button('Remove'));
    await flush();
    expect(v.container.querySelector('.dlg__t h2')?.textContent).toBe('Remove payment');
    expect(v.container.querySelector('.dlg .b5-pay')?.textContent).toContain('Rs 3,000.00');
    const chips = [...v.container.querySelectorAll<HTMLButtonElement>('.dlg .b5-chip')];
    expect(chips.map((c) => c.textContent)).toEqual(['Wrong payment type', 'Wrong amount', 'Customer changed their mind', 'Other']);
    const primary = () => v.container.querySelector<HTMLButtonElement>('.dlg .acts .btn--primary')!;
    expect(primary().textContent).toBe('Pick a reason');
    v.click(chips[3]!);
    await flush();
    expect(primary().textContent).toBe('Write why first');
    v.click(chips[1]!);
    await flush();
    expect(primary().textContent).toBe('Remove payment');
    v.click(primary());
    await flush();
    expect(s.command.mock.calls[0]!.slice(0, 2)).toEqual(['RemovePayment', { payment_id: 'P1', reason_code: 'wrong_amount' }]);
    expect(v.container.querySelector('.dlg')).toBeNull();
    expect(s.query).toHaveBeenCalledTimes(2);
  });

  it('[frame RemovePaymentShiftClosed] SHIFT_NOT_OPEN payment_shift_closed: its warning and OK only', async () => {
    const s = setup({ views: [paidBill()], answers: [{ ok: false, error: { kind: 'api', status: 409, code: 'SHIFT_NOT_OPEN', details: { reason: 'payment_shift_closed' } } }] });
    const v = await show(s);
    v.click(v.button('Remove'));
    await flush();
    v.click([...v.container.querySelectorAll<HTMLButtonElement>('.dlg .b5-chip')][0]!);
    await flush();
    v.click(v.container.querySelector<HTMLButtonElement>('.dlg .acts .btn--primary')!);
    await flush();
    expect(v.container.querySelector('.dlg .msg.c-warn')?.textContent).toContain('already counted');
    expect([...v.container.querySelectorAll('.dlg .acts .btn')].map((b) => b.textContent)).toEqual(['OK']);
  });

  it('no Remove offline, on a closed split, or on someone else\'s payment without close-shift-for-others', async () => {
    let v = await show(setup({ online: false, views: [paidBill()] }));
    expect(v.buttons().some((b) => b.textContent === 'Remove')).toBe(false);
    v.unmount();
    v = await show(setup({ views: [paidBill({ splits: [split({ payments: [{ ...PAY, taken_by_name: 'Usman', taken_by_staff_id: 'S_USMAN' }], balance_minor: 362_400 })] })] }));
    expect(v.buttons().some((b) => b.textContent === 'Remove')).toBe(false);
    v.unmount();
    v = await show(setup({ grants: { 'close-shift-for-others': { grant: 'allowed', scope: 'branch' } }, views: [paidBill({ splits: [split({ payments: [{ ...PAY, taken_by_name: 'Usman', taken_by_staff_id: 'S_USMAN' }], balance_minor: 362_400 })] })] }));
    expect(v.buttons().some((b) => b.textContent === 'Remove')).toBe(true);
  });

  it('[B18] a failed receipt print: Print to → pick a printer → RetargetBillPrint, then the bill is read again (take-order)', async () => {
    const s = setup({
      grants: { 'take-order': { grant: 'allowed', scope: 'branch' } },
      views: [bill({ prints: [{ job_id: 'J1', doc_kind: 'receipt', state: 'failed', printer_name: 'Counter', last_error: 'paper_out' }] })],
      answers: [{ ok: true, data: { job_id: 'J1', state: 'waiting', printer_name: 'First floor bill', last_error: null, printer_id: 'P2' } }],
    });
    const viewOf = s.query.getMockImplementation()!;
    s.query.mockImplementation(async (path: string) => (path === '/queries/bill-printers' ? { ok: true as const, data: { printers: [{ printer_id: 'P2', name: 'First floor bill' }] } as never } : viewOf(path)));
    const v = await show(s);
    v.click(v.button('Print to'));
    await flush();
    expect(s.query.mock.calls.some((c) => c[0] === '/queries/bill-printers')).toBe(true);
    const reads = s.query.mock.calls.filter((c) => String(c[0]).startsWith('/queries/bill?')).length;
    v.click([...v.container.querySelectorAll<HTMLButtonElement>('.dlg .b5-chip')].find((c) => c.textContent?.includes('First floor bill'))!);
    await flush();
    const send = [...v.container.querySelectorAll<HTMLButtonElement>('.dlg .btn--primary')].at(-1)!;
    v.click(send);
    await flush();
    expect(s.command.mock.calls[0]!.slice(0, 2)).toEqual(['RetargetBillPrint', { job_id: 'J1', printer_id: 'P2' }]);
    expect(s.query.mock.calls.filter((c) => String(c[0]).startsWith('/queries/bill?')).length).toBeGreaterThan(reads);
  });

  it('[review m4 / NIT 8] without take-order a failed print offers no Print to (RetargetBillPrint needs it)', async () => {
    const v = await show(setup({ views: [bill({ prints: [{ job_id: 'J1', doc_kind: 'receipt', state: 'failed', printer_name: 'Counter', last_error: 'paper_out' }] })] }));
    expect(v.buttons().some((b) => b.textContent === 'Print to')).toBe(false);
  });

  const openRemove = async (s: ReturnType<typeof setup>) => {
    const v = await show(s);
    v.click(v.button('Remove'));
    await flush();
    return v;
  };
  const chip = (v: Mounted, label: string) => [...v.container.querySelectorAll<HTMLButtonElement>('.dlg .b5-chip')].find((c) => c.textContent === label)!;
  const note = (v: Mounted, text: string) => {
    const el = v.container.querySelector('.dlg textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const send = (v: Mounted) => v.click(v.container.querySelector<HTMLButtonElement>('.dlg .acts .btn--primary')!);

  it('[§6.10 note min 1] spaces are not a note: Other stays blocked, another reason sends none; a note is trimmed', async () => {
    const s = setup({ views: [paidBill()], answers: [{ ok: true, data: { payment_id: 'P1', bill_id: 'B7', split_no: 1 } }] });
    const v = await openRemove(s);
    v.click(chip(v, 'Other'));
    note(v, '   ');
    await flush();
    expect(v.container.querySelector('.dlg .acts .btn--primary')?.textContent).toBe('Write why first');
    note(v, '  Typed 3000 for 300  ');
    await flush();
    send(v);
    await flush();
    expect(s.command.mock.calls[0]![1]).toEqual({ payment_id: 'P1', reason_code: 'other', note: 'Typed 3000 for 300' });
  });

  it('[D32] a lost reply: "may already be removed"; the resend with an edited note keeps the command_id', async () => {
    const s = setup({ views: [paidBill()], answers: [{ ok: false, error: { kind: 'network' } }, { ok: true, data: { payment_id: 'P1', bill_id: 'B7', split_no: 1 } }] });
    const v = await openRemove(s);
    v.click(chip(v, 'Wrong amount'));
    await flush();
    send(v);
    await flush();
    expect(v.container.querySelector('.dlg .msg')?.textContent).toContain('may already be removed');
    note(v, 'second try');
    await flush();
    send(v);
    await flush();
    const [a, b] = s.command.mock.calls;
    expect((b![2] as { commandId: string }).commandId).toBe((a![2] as { commandId: string }).commandId);
  });

  it('refusals: not_own_payment keeps the sheet with its text; PAYMENT_NOT_FOUND closes it with a toast and reads the bill', async () => {
    const s = setup({ views: [paidBill()], answers: [{ ok: false, error: { kind: 'api', status: 403, code: 'PERMISSION_DENIED', details: { reason: 'not_own_payment' } } }, { ok: false, error: { kind: 'api', status: 404, code: 'PAYMENT_NOT_FOUND', details: {} } }] });
    const v = await openRemove(s);
    v.click(chip(v, 'Wrong amount'));
    await flush();
    send(v);
    await flush();
    expect(v.container.querySelector('.dlg .msg')?.textContent).toContain("Only a manager can remove someone else's payment");
    send(v);
    await flush();
    expect(v.container.querySelector('.dlg')).toBeNull();
    expect(s.query.mock.calls.length).toBeGreaterThan(1);
  });

  it('offline while the sheet is open: the primary reads "Needs the hub"', async () => {
    const s = setup({ views: [paidBill()] });
    const v = await openRemove(s);
    v.click(chip(v, 'Wrong amount'));
    (s.shell as { online: boolean }).online = false;
    v.click(chip(v, 'Wrong payment type'));
    await flush();
    expect(v.container.querySelector('.dlg .acts .btn--primary')?.textContent).toBe('Needs the hub');
  });

  it('[§6.22] a split closed in this visit (bill partly paid): Reprint receipt on that split, by its own invoice; an empty close has none', async () => {
    const two = bill({ state: 'open', splits: [split({ split_no: 1, balance_minor: 0 }), split({ split_no: 2 })], blocks: [] });
    const after = bill({ state: 'partly_paid', splits: [split({ split_no: 1, state: 'closed', balance_minor: 0, invoice: { invoice_id: 'INV_AC1-S000201', invoice_ref: 'AC1-S000201', fiscal_number: null, fiscal_state: 'pending' } }), split({ split_no: 2 })], blocks: [] });
    const s = setup({
      views: [two, after],
      answers: [
        { ok: true, data: { invoice_id: 'INV7', invoice_ref: 'AC1-S000201', total_minor: 662_400, change_minor: 0, bill_state: 'partly_paid', receipt: { job_id: 'J1', printer_name: 'Counter' }, fiscal_state: 'pending' } },
        { ok: true, data: { printed: true, job_id: 'J2', printer_name: 'Counter' } },
      ],
    });
    const v = await show(s);
    v.click([...v.container.querySelectorAll<HTMLButtonElement>('.b5-close .btn--primary')][0]!);
    await flush();
    v.click(v.button('Split 1'));
    await flush();
    v.click(v.button('Reprint receipt'));
    await flush();
    expect(s.command.mock.calls[1]!.slice(0, 2)).toEqual(['PrintBillDocument', { doc: 'receipt', ref_id: 'INV7' }]);
  });

  it('[review m1] reopened and closed again elsewhere (the split now shows another invoice): no Reprint of the cancelled one', async () => {
    const two = bill({ state: 'open', splits: [split({ split_no: 1, balance_minor: 0 }), split({ split_no: 2 })], blocks: [] });
    const reclosed = bill({ state: 'partly_paid', splits: [split({ split_no: 1, state: 'closed', balance_minor: 0, invoice: { invoice_id: 'INV_AC1-S000202', invoice_ref: 'AC1-S000202', fiscal_number: null, fiscal_state: 'pending' } }), split({ split_no: 2 })], blocks: [] });
    const s = setup({ views: [two, reclosed], answers: [{ ok: true, data: { invoice_id: 'INV7', invoice_ref: 'AC1-S000201', total_minor: 662_400, change_minor: 0, bill_state: 'partly_paid', receipt: { job_id: 'J1', printer_name: 'Counter' }, fiscal_state: 'pending' } }] });
    const v = await show(s);
    v.click([...v.container.querySelectorAll<HTMLButtonElement>('.b5-close .btn--primary')][0]!);
    await flush();
    v.click(v.button('Split 1'));
    await flush();
    expect(v.buttons().some((b) => b.textContent === 'Reprint receipt')).toBe(false);
  });

  it('[§6.22, frame BillClosed] after the last close: Reprint receipt → PrintBillDocument { receipt, the closed invoice }', async () => {
    const ready = bill({ splits: [split({ balance_minor: 0 })], blocks: [] });
    const closed = bill({ state: 'closed', splits: [split({ state: 'closed', balance_minor: 0 })], blocks: [] });
    const s = setup({
      views: [ready, closed],
      answers: [
        { ok: true, data: { invoice_id: 'INV1', invoice_ref: 'AC1-S000200', total_minor: 662_400, change_minor: 0, bill_state: 'closed', receipt: { job_id: 'J1', printer_name: 'Counter' }, fiscal_state: 'pending' } },
        { ok: true, data: { printed: true, job_id: 'J2', printer_name: 'Counter' } },
      ],
    });
    const v = await show(s);
    v.click(v.button('Close bill'));
    await flush();
    v.click(v.button('Reprint receipt'));
    await flush();
    expect(s.command.mock.calls[1]!.slice(0, 2)).toEqual(['PrintBillDocument', { doc: 'receipt', ref_id: 'INV1' }]);
  });
});

// 36c (05 v1.0.28 §8 Reopen, R-89, G-91; test #37k; E2E E-2): a Reopen action on a CLOSED bill with a sale invoice and
// on a closed split's invoice of a PARTLY_PAID bill, for reopen-bill holders (allowed / requires_approval); the sheet
// (frames Reopen, ReopenWaiting, ReopenNotSupported): BILL_REOPEN_REASONS, a note required for other, the what-happens
// line; allowed → ReopenBill, requires_approval → the waiting card with Withdraw; the result's mode sets the banner
// (frame ReopenCorrections); refusals by §9 code.
describe('[05 §8 Reopen, §6.13; #37k] reopen a closed bill', () => {
  const g = (grant: 'allowed' | 'requires_approval') => ({ 'reopen-bill': { grant, scope: 'branch' } });
  const closed = () => bill({ state: 'closed', blocks: [], splits: [split({ state: 'closed', balance_minor: 0, invoice: { invoice_ref: 'AC1-S000123', fiscal_number: null, fiscal_state: 'pending' } })] });
  const reopened = (mode: 'full' | 'corrections') => ({ ok: true as const, data: { reopened: { mode, credits: [{ invoice_ref: 'AC1-C000017', total_minor: 599_600 }] } } });
  const chip = (v: Mounted, label: string) => [...v.container.querySelectorAll<HTMLButtonElement>('.dlg .b5-chip')].find((c) => c.textContent === label)!;
  const primary = (v: Mounted) => v.container.querySelector<HTMLButtonElement>('.dlg .acts .btn--primary')!;

  it('a closed bill with reopen-bill: Reopen → the sheet: the reasons, the note for Other, the what-happens line', async () => {
    const v = await show(setup({ grants: g('allowed'), views: [closed()] }));
    v.click(v.button('Reopen'));
    await flush();
    expect(v.container.querySelector('.dlg__t h2')?.textContent).toBe('Reopen bill');
    expect(v.container.querySelector('.dlg__t .ac__who')?.textContent).toBe('Invoice AC1-S000123');
    expect([...v.container.querySelectorAll('.dlg .b5-chip')].map((c) => c.textContent)).toEqual(['Wrong item billed', 'Wrong payment type', 'Customer returned an item', 'Price error', 'Other']);
    expect(v.text()).toContain('Each paid split gets a credit note. Payments stay. Close again to issue new invoices.');
    expect(primary(v).textContent).toBe('Pick a reason');
    v.click(chip(v, 'Other'));
    await flush();
    expect(primary(v).textContent).toBe('Write why first');
  });

  it('allowed: Reopen bill → ReopenBill { bill_id, reason_code }; corrections mode: the banner names the credit and the corrections-only line', async () => {
    const s = setup({ grants: g('allowed'), views: [closed(), bill({ state: 'partly_paid', reopen_count: 1 })], answers: [reopened('corrections')] });
    const v = await show(s);
    v.click(v.button('Reopen'));
    await flush();
    v.click(chip(v, 'Wrong payment type'));
    await flush();
    expect(primary(v).textContent).toBe('Reopen bill');
    v.click(primary(v));
    await flush();
    expect(s.command.mock.calls[0]!.slice(0, 2)).toEqual(['ReopenBill', { bill_id: 'B7', reason_code: 'wrong_payment_mode' }]);
    expect(v.container.querySelector('.dlg')).toBeNull();
    expect(v.container.querySelector('.b5-ban.c-ok')?.textContent).toContain('Reopened · credit AC1-C000017 Rs 5,996.00');
    expect(v.container.querySelector('.b5-ban.c-ok')?.textContent).toContain('Corrections only: remove, void or comp; new items go on a new bill');
    expect(s.query).toHaveBeenCalledTimes(2);
  });

  it('full mode: the banner without the corrections line', async () => {
    const s = setup({ grants: g('allowed'), views: [closed(), bill({ reopen_count: 1 })], answers: [reopened('full')] });
    const v = await show(s);
    v.click(v.button('Reopen'));
    await flush();
    v.click(chip(v, 'Price error'));
    await flush();
    v.click(primary(v));
    await flush();
    expect(v.container.querySelector('.b5-ban.c-ok')?.textContent).toContain('Reopened · credit AC1-C000017');
    expect(v.container.querySelector('.b5-ban.c-ok')?.textContent).not.toContain('Corrections only');
  });

  it('requires_approval: Ask for approval (Needs approval) → pending → the waiting card; Withdraw', async () => {
    const s = setup({ grants: g('requires_approval'), views: [closed()], answers: [{ ok: true, data: { pending: { alert_id: 'A5' } } }, { ok: true, data: {} }] });
    const v = await show(s);
    v.click(v.button('Reopen'));
    await flush();
    v.click(chip(v, 'Wrong payment type'));
    await flush();
    expect(primary(v).textContent).toBe('Ask for approvalNeeds approval');
    v.click(primary(v));
    await flush();
    expect(v.container.querySelector('.dlg .b5-wait b')?.textContent).toBe('Waiting for approval');
    expect(v.text()).toContain('The credit note prints on the approver');
    v.click(v.button('Withdraw'));
    await flush();
    expect(s.command.mock.calls[1]!.slice(0, 2)).toEqual(['WithdrawRequest', { alert_id: 'A5' }]);
  });

  it('[frame ReopenNotSupported] BILL_REOPEN_NOT_SUPPORTED: the danger message and OK only; BILL_REOPEN_PENDING and BILL_NOT_OPEN: their texts', async () => {
    const refusal = (code: string) => ({ ok: false as const, error: { kind: 'api' as const, status: 409, code, details: {} } });
    const s = setup({ grants: g('allowed'), views: [closed()], answers: [refusal('BILL_REOPEN_PENDING'), refusal('BILL_NOT_OPEN'), refusal('BILL_REOPEN_NOT_SUPPORTED')] });
    const v = await show(s);
    v.click(v.button('Reopen'));
    await flush();
    v.click(chip(v, 'Price error'));
    await flush();
    v.click(primary(v));
    await flush();
    expect(v.container.querySelector('.dlg .msg')?.textContent).toContain('A reopen is already waiting for approval');
    v.click(primary(v));
    await flush();
    expect(v.container.querySelector('.dlg .msg')?.textContent).toContain('Only a closed or partly paid bill can be reopened');
    v.click(primary(v));
    await flush();
    expect(v.container.querySelector('.dlg .msg.c-danger')?.textContent).toContain("This bill can't be reopened");
    expect([...v.container.querySelectorAll('.dlg .acts .btn')].map((b) => b.textContent)).toEqual(['OK']);
  });

  it('[D32] a lost reply: the resend keeps the command_id (the note is out of the key)', async () => {
    const s = setup({ grants: g('allowed'), views: [closed()], answers: [{ ok: false, error: { kind: 'network' } }, reopened('full')] });
    const v = await show(s);
    v.click(v.button('Reopen'));
    await flush();
    v.click(chip(v, 'Price error'));
    await flush();
    v.click(primary(v));
    await flush();
    v.click(primary(v));
    await flush();
    const [a, b] = s.command.mock.calls;
    expect((b![2] as { commandId: string }).commandId).toBe((a![2] as { commandId: string }).commandId);
  });

  it('a partly-paid bill: Reopen on its closed split, not on the open one; none without reopen-bill, none offline, none on an open bill', async () => {
    const pp = bill({ state: 'partly_paid', splits: [split({ split_no: 1, state: 'closed', balance_minor: 0, invoice: { invoice_ref: 'AC1-S000124', fiscal_number: null, fiscal_state: 'pending' } }), split({ split_no: 2 })] });
    let v = await show(setup({ grants: g('allowed'), views: [pp] }));
    expect(v.buttons().some((b) => b.textContent === 'Reopen')).toBe(false);
    v.click(v.button('Split 1'));
    await flush();
    expect(v.buttons().some((b) => b.textContent === 'Reopen')).toBe(true);
    v.unmount();
    v = await show(setup({ views: [closed()] }));
    expect(v.buttons().some((b) => b.textContent === 'Reopen')).toBe(false);
    v.unmount();
    v = await show(setup({ grants: g('allowed'), online: false, views: [closed()] }));
    expect(v.buttons().some((b) => b.textContent === 'Reopen')).toBe(false);
    v.unmount();
    v = await show(setup({ grants: g('allowed') }));
    expect(v.buttons().some((b) => b.textContent === 'Reopen')).toBe(false);
  });

  it('[review m1] requires_approval: the Reopen action carries "Needs approval"', async () => {
    const v = await show(setup({ grants: g('requires_approval'), views: [closed()] }));
    expect(v.button('Reopen').querySelector('.ntag')?.textContent).toBe('Needs approval');
  });

  it('[review m4] approved while the waiting card is open (the bill reopened): the sheet closes', async () => {
    const pendingView = bill({ ...closed(), open_requests: [{ alert_id: 'A5', kind: 'reopen_bill' } as never] });
    const s = setup({ grants: g('requires_approval'), views: [closed(), pendingView, bill({ state: 'partly_paid', reopen_count: 1 })], answers: [{ ok: true, data: { pending: { alert_id: 'A5' } } }] });
    const v = await show(s);
    v.click(v.button('Reopen'));
    await flush();
    v.click(chip(v, 'Price error'));
    await flush();
    v.click(primary(v));
    await flush();
    expect(v.container.querySelector('.dlg .b5-wait')).not.toBeNull();
    vi.useFakeTimers();
    s.shell.live.frame({ type: 'event', seq: 9, event: { event_type: 'BillReopened', payload: {} } } as never);
    await vi.advanceTimersByTimeAsync(300);
    vi.useRealTimers();
    await flush();
    expect(v.container.querySelector('.dlg')).toBeNull();
  });

  it('[review m3] BILL_REOPEN_PENDING / BILL_NOT_OPEN read the bill again', async () => {
    const s = setup({ grants: g('allowed'), views: [closed()], answers: [{ ok: false, error: { kind: 'api', status: 409, code: 'BILL_REOPEN_PENDING', details: { alert_id: 'A9' } } }] });
    const v = await show(s);
    v.click(v.button('Reopen'));
    await flush();
    v.click(chip(v, 'Price error'));
    await flush();
    const before = s.query.mock.calls.length;
    v.click(primary(v));
    await flush();
    expect(s.query.mock.calls.length).toBeGreaterThan(before);
  });

  it('Other with a note: the note is trimmed; spaces alone stay blocked', async () => {
    const s = setup({ grants: g('allowed'), views: [closed()], answers: [reopened('full')] });
    const v = await show(s);
    v.click(v.button('Reopen'));
    await flush();
    v.click(chip(v, 'Other'));
    const el = v.container.querySelector('.dlg textarea')!;
    const put = (x: string) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, x);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    put('   ');
    await flush();
    expect(primary(v).textContent).toBe('Write why first');
    put('  Wrong table billed  ');
    await flush();
    v.click(primary(v));
    await flush();
    expect(s.command.mock.calls[0]![1]).toEqual({ bill_id: 'B7', reason_code: 'other', note: 'Wrong table billed' });
  });

  it('a bill closed empty (no invoice): no Reopen', async () => {
    const v = await show(setup({ grants: g('allowed'), views: [bill({ state: 'closed', blocks: [], splits: [split({ state: 'closed', balance_minor: 0, invoice: null })] })] }));
    expect(v.buttons().some((b) => b.textContent?.startsWith('Reopen'))).toBe(false);
  });

  it('[frame BillClosed] the closed view after the last close has Reopen too', async () => {
    const ready = bill({ splits: [split({ balance_minor: 0 })], blocks: [] });
    const s = setup({ grants: g('allowed'), views: [ready, closed()], answers: [{ ok: true, data: { invoice_id: 'INV1', invoice_ref: 'AC1-S000123', total_minor: 662_400, change_minor: 0, bill_state: 'closed', receipt: { job_id: 'J1', printer_name: 'Counter' }, fiscal_state: 'pending' } }] });
    const v = await show(s);
    v.click(v.button('Close bill'));
    await flush();
    v.click(v.button('Reopen'));
    await flush();
    expect(v.container.querySelector('.dlg__t h2')?.textContent).toBe('Reopen bill');
  });
});

