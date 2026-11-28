import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, type Mounted } from '../../../../../test/dom';
import type { SubmitOrderPayload } from '../contracts';
import { screenHarness, sl, view } from './screen-harness';
import { PAY_LATER_RETRY_MS, printPayLaterSlip, slipMissesOf } from './slips';
import { aRow, at } from './test-fixtures';

// ⚠️ 02b-TK L-CLIENT-4 item 2 (03c v1.0.16 §3.11 trigger 2, §6.14, §8; 02b v1.0.25 §3.2 step 10a, §8): a Send & pay
// panel closed with the bill still open (Pay later, or its ✕, before the bill closed; a partly paid bill too) sends
// `PrintTakeawaySlip { order_id, reason: 'pay_later' }` once, never queued; a lost reply or a 5xx is sent again with
// the SAME command_id while the page lives, until a 2xx or a 4xx; a final failure marks the token "Slip not printed —
// Print slip". A paid panel, or Take payment of a token from the queue (not Send & pay), sends nothing.

vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: true, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: () => {} }));

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
const sent = (payload: unknown) => ({ status: 'sent', result: { order_id: (payload as SubmitOrderPayload).order_id, token: 57, groups: [{ group_id: 'g', promise_ms: at(13, 42), order_item_ids: [] }], lines: [], slip: null } });
const PAID = { ok: true, data: { bill_id: 'B1', payment_id: 'P1', split_no: 1, totals: { as_paid: totals(4_000) }, balance_minor: 0, card_due_minor: 0, cash_due_minor: 0, card_refund_due_minor: 0, cash_refund_due_minor: 0, rounding_minor: 0, change_due_minor: 0 } };
const CLOSED = { ok: true, data: { invoice_id: 'I1', invoice_ref: 'S1', total_minor: 4_000, change_minor: 0, bill_state: 'closed', receipt: { job_id: 'J1', printer_name: 'Counter' }, fiscal_state: 'not_required' } };
const PRINTED = { ok: true, data: { printed: true, job_id: 'J9', skipped: null } };
const skipped = (why: string) => ({ ok: true, data: { printed: false, job_id: null, skipped: why } });
const refused = (status: number, code: string, details: Record<string, unknown> = {}) => ({ ok: false, error: { kind: 'api', status, code, details } });
const NETWORK = { ok: false, error: { kind: 'network' } };

const addNaan = (m: Mounted) => {
  m.click(m.button('Sides', m.container.querySelector('.pills')!));
  m.click(m.container.querySelector<HTMLElement>('.mi[aria-label="Naan"]'));
};
const slips = (h: ReturnType<typeof screenHarness>) => h.commands.filter((c) => c.type === 'PrintTakeawaySlip');
const slipIds = (h: ReturnType<typeof screenHarness>) => h.commands.flatMap((c, i) => (c.type === 'PrintTakeawaySlip' ? [h.commandOpts[i]?.commandId] : []));

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  vi.useRealTimers();
  document.body.innerHTML = '';
});

/** Send & pay → the pay panel on the sent order's bill; `answers` are the PrintTakeawaySlip replies, in order. */
async function sendAndPay(answers: unknown[] = [PRINTED], extra: { pay?: (type: string) => unknown } = {}) {
  const queue = [...answers];
  const h = screenHarness({
    rows: [],
    answer: (type, payload) => (type === 'SubmitOrder' ? sent(payload) : undefined),
    bill: () => aBill(4_000),
    command: (type) => (type === 'PrintTakeawaySlip' ? (queue.length > 1 ? queue.shift() : queue[0]) : extra.pay?.(type)),
  });
  const v = h.render();
  m = v;
  await flush();
  addNaan(v);
  v.click(v.button('Send & pay'));
  await flush(8);
  expect(v.container.querySelector('.tk-paypanel')).not.toBeNull();
  const order_id = (h.sent.find((s) => s.type === 'SubmitOrder')!.payload as SubmitOrderPayload).order_id;
  return { h, v, order_id };
}

describe('[02b-TK L-CLIENT-4 item 2; 03c v1.0.16 §3.11 trigger 2, §8] Send & pay closed unpaid → PrintTakeawaySlip pay_later', () => {
  it('[03c §8] Pay later on the Send & pay panel: one PrintTakeawaySlip { order_id, reason: "pay_later" }, not queued; "Slip printing"', async () => {
    const { h, v, order_id } = await sendAndPay();
    v.click(v.button('Pay later'));
    await flush(8);
    expect(v.container.querySelector('.tk-paypanel')).toBeNull();
    expect(slips(h)).toEqual([{ type: 'PrintTakeawaySlip', payload: { order_id, reason: 'pay_later' } }]);
    expect(slipIds(h)[0]).toMatch(/^[0-9A-Z]{26}$/);
    expect(h.sent.map((s) => s.type)).toEqual(['SubmitOrder']);
    expect(h.toasts.at(-1)).toEqual({ text: 'Slip printing', tone: 'ok' });
  });

  it('[03c §8] the panel\'s ✕ before paying is the same close (the bill is still open)', async () => {
    const { h, v, order_id } = await sendAndPay();
    v.click(v.container.querySelector<HTMLElement>('.tk-pay__h .tk-x'));
    await flush(8);
    expect(slips(h).map((c) => c.payload)).toEqual([{ order_id, reason: 'pay_later' }]);
  });

  it('[03c §3.11 Send & pay] paid → Next customer, or ✕ on the paid panel: no slip (the receipt is the only paper)', async () => {
    for (const close of ['Next customer', 'x'] as const) {
      const { h, v } = await sendAndPay([PRINTED], { pay: (type) => (type === 'AddPayment' ? PAID : type === 'CloseSplit' ? CLOSED : undefined) });
      v.click(v.button('Exact'));
      v.click(v.button('Paid · print receipt'));
      await flush(8);
      expect(v.text()).toContain('Next customer');
      if (close === 'x') v.click(v.container.querySelector<HTMLElement>('.tk-pay__h .tk-x'));
      else v.click(v.button('Next customer'));
      await flush(8);
      expect(v.container.querySelector('.tk-paypanel')).toBeNull();
      expect(slips(h)).toEqual([]);
      v.unmount();
      m = null;
    }
  });

  it('[03c §8 "a Send & pay panel"] Take payment of a queued token, closed unpaid: no slip (it had its own at Send)', async () => {
    const h = screenHarness({
      rows: [aRow({ order_id: 'O48', token: 48, ready: { n: 0, m: 1 } })],
      views: { O48: view('O48', [sl('O48', 'A', 'Karahi', 'cooking')]) },
      bills: {},
      bill: () => aBill(180_000),
      command: () => PRINTED,
    });
    const v = h.render();
    m = v;
    await flush();
    v.click(v.container.querySelector('.tk-qr'));
    await flush();
    v.click(v.button('Take payment', v.container.querySelector('.tk-drawer__f')!));
    await flush();
    v.click(v.button('Pay later'));
    await flush(8);
    expect(slips(h)).toEqual([]);
  });

  it('[03c §8] a lost reply or a 5xx is sent again with the SAME command_id until a 2xx; once only', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { h, v, order_id } = await sendAndPay([NETWORK, refused(503, 'HUB_UNAVAILABLE'), PRINTED]);
    v.click(v.button('Pay later'));
    await flush(8);
    expect(slips(h)).toHaveLength(1);
    for (const wait of PAY_LATER_RETRY_MS.slice(0, 2)) {
      await vi.advanceTimersByTimeAsync(wait);
      await flush(8);
    }
    expect(slips(h).map((c) => c.payload)).toEqual([
      { order_id, reason: 'pay_later' },
      { order_id, reason: 'pay_later' },
      { order_id, reason: 'pay_later' },
    ]);
    const ids = slipIds(h);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toMatch(/^[0-9A-Z]{26}$/);
    expect(h.toasts.at(-1)).toEqual({ text: 'Slip printing', tone: 'ok' });
    await vi.advanceTimersByTimeAsync(PAY_LATER_RETRY_MS.reduce((a, b) => a + b, 0));
    expect(slips(h)).toHaveLength(3);
    expect(slipMissesOf(h.shell).missed([order_id])).toBe(false);
  });

  it('[03c §8 "a final failure"] no answer after every retry → the token is marked "Slip not printed — Print slip"', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { h, v, order_id } = await sendAndPay([NETWORK]);
    v.click(v.button('Pay later'));
    await flush(8);
    for (const wait of PAY_LATER_RETRY_MS) {
      await vi.advanceTimersByTimeAsync(wait);
      await flush(8);
    }
    expect(slips(h)).toHaveLength(PAY_LATER_RETRY_MS.length + 1);
    expect(new Set(slipIds(h)).size).toBe(1);
    expect(slipMissesOf(h.shell).missed([order_id])).toBe(true);
    expect(h.toasts.at(-1)).toEqual({ text: 'Slip not printed — Print slip', tone: 'warn' });
  });

  it('[03c §6.14 Result, §8] no_printer → the token is marked and "No slip printer is set up"; setting_off, slip_held, already_printed show nothing', async () => {
    const none = await sendAndPay([skipped('no_printer')]);
    none.v.click(none.v.button('Pay later'));
    await flush(8);
    expect(none.h.toasts.at(-1)).toEqual({ text: 'No slip printer is set up — the token is on the screen', tone: 'warn' });
    expect(slipMissesOf(none.h.shell).missed([none.order_id])).toBe(true);
    none.v.unmount();
    m = null;
    for (const why of ['setting_off', 'slip_held', 'already_printed']) {
      const r = await sendAndPay([skipped(why)]);
      const before = r.h.toasts.length;
      r.v.click(r.v.button('Pay later'));
      await flush(8);
      expect(slips(r.h)).toHaveLength(1);
      expect(r.h.toasts.length).toBe(before);
      expect(slipMissesOf(r.h.shell).missed([r.order_id])).toBe(false);
      r.v.unmount();
      m = null;
    }
  });

  it('[03c §6.14 Errors, §8] a 4xx is final (no retry): its errors.<code> text; TAKEAWAY_SLIP_NOT_ALLOWED billed (paid meanwhile) shows nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const denied = await sendAndPay([refused(403, 'PERMISSION_DENIED')]);
    denied.v.click(denied.v.button('Pay later'));
    await flush(8);
    await vi.advanceTimersByTimeAsync(PAY_LATER_RETRY_MS.reduce((a, b) => a + b, 0));
    expect(slips(denied.h)).toHaveLength(1);
    expect(denied.h.toasts.at(-1)?.tone).toBe('warn');
    expect(denied.h.toasts.at(-1)?.text).not.toBe('Slip printing');
    expect(slipMissesOf(denied.h.shell).missed([denied.order_id])).toBe(false);
    denied.v.unmount();
    m = null;

    const cancelled = await sendAndPay([refused(409, 'TAKEAWAY_SLIP_NOT_ALLOWED', { reason: 'cancelled' })]);
    cancelled.v.click(cancelled.v.button('Pay later'));
    await flush(8);
    expect(cancelled.h.toasts.at(-1)).toEqual({ text: 'No slip for this order — it is paid, cancelled or not a takeaway', tone: 'warn' });
    cancelled.v.unmount();
    m = null;

    const billed = await sendAndPay([refused(409, 'TAKEAWAY_SLIP_NOT_ALLOWED', { reason: 'billed' })]);
    const before = billed.h.toasts.length;
    billed.v.click(billed.v.button('Pay later'));
    await flush(8);
    await vi.advanceTimersByTimeAsync(PAY_LATER_RETRY_MS.reduce((a, b) => a + b, 0));
    expect(slips(billed.h)).toHaveLength(1);
    expect(billed.h.toasts.length).toBe(before);
  });

  it('[03c §8 "once"] a second close of the same order sends nothing more (one slip per Send & pay)', async () => {
    const h = screenHarness({ command: () => PRINTED });
    printPayLaterSlip(h.shell, 'O57');
    printPayLaterSlip(h.shell, 'O57');
    await flush(8);
    expect(slips(h)).toHaveLength(1);
  });
});
