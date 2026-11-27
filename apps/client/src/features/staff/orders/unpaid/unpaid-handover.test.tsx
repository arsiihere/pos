import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, type Mounted } from '../../../../../test/dom';
import { UNDO_MS } from '../takeaway/handover';
import { screenHarness, sl, view } from '../takeaway/screen-harness';
import { aRow, at } from '../takeaway/test-fixtures';

// 02b-TK L-CLIENT-2 item 4 (02b v1.0.25 §3.7a Ask / Approve / Reject, §6.4 customer_handover, §6.4a, §6.16, §8 OR-7;
// D2; test 90 client part): the counter's unpaid hand-over — the ready tile and the token drawer share the candidate
// check; "Ask a manager" sends RequestUnpaidHandover; the approval (UnpaidHandoverApproved) unlocks only the named
// order; the send carries `customer_handover: true`; the hub's unpaid refusal says ask a manager.

vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: true, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));
const nav = vi.hoisted(() => ({ to: [] as string[] }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: (p: string) => nav.to.push(p) }));

const tick = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
};

const DUE = 119_000;
const openBill = (bill_id: string, owed: number) => ({ bill_id, state: 'open', splits: [{ split_no: 1, state: 'open', balance_minor: owed }], totals_default: { total_minor: owed } });
const dueRow = (order_id: string, token: number, o: Partial<Parameters<typeof aRow>[0]> = {}) => aRow({ order_id, token, ready: { n: 1, m: 1 }, promise_ms: at(13, 12), bill: { state: 'due', due_minor: DUE }, ...o });
let seq = 10;
const frame = (h: ReturnType<typeof screenHarness>, event_type: string, payload: Record<string, unknown>) =>
  act(() => h.live.frame({ type: 'event', seq: ++seq, event: { event_id: `E${seq}`, event_type, schema_version: 1, payload } } as never));
const asks = (h: ReturnType<typeof screenHarness>) => h.commands.filter((c) => c.type === 'RequestUnpaidHandover');
const tile = (m: Mounted) => m.container.querySelector('.tk-rt')!;

describe('[02b-TK L-CLIENT-2 item 4; 02b §3.7a, §8 OR-7; test 90] the counter: Ask a manager → approved → hand over', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }));
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    nav.to = [];
  });

  it('a Due, unapproved ready tile offers Take payment and Ask a manager; the ask sends { order_id }, then "Waiting for a manager…"', async () => {
    const h = screenHarness({ rows: [dueRow('O48', 48)], bills: { O48: openBill('B48', DUE) }, command: () => ({ ok: true, data: { alert_id: 'AL1', is_requester: true } }) });
    const m = h.render();
    await flush();
    expect(tile(m).textContent).toContain('Take payment');
    expect(tile(m).textContent).not.toContain('Hand over');
    m.click(tile(m).querySelector('[data-ask="O48"]'));
    await flush();
    expect(asks(h)).toEqual([{ type: 'RequestUnpaidHandover', payload: { order_id: 'O48' } }]);
    expect(tile(m).textContent).toContain('Waiting for a manager…');
    // 01d R3-M-3 (one string per state): not "Waiting — find a manager" while ask_in_person is false
    expect(tile(m).textContent).not.toContain('find a manager');
    m.unmount();
  });

  it('UnpaidHandoverApproved for the order → the tile hands over; MarkServed after the Undo window carries customer_handover: true', async () => {
    const h = screenHarness({ rows: [dueRow('O48', 48)], bills: { O48: openBill('B48', DUE) }, command: () => ({ ok: true, data: { alert_id: 'AL1', is_requester: true } }) });
    const m = h.render();
    await flush();
    m.click(tile(m).querySelector('[data-ask="O48"]'));
    await flush();
    frame(h, 'UnpaidHandoverApproved', { order_id: 'O48', alert_id: 'AL1', approved_by_staff_id: 'S_MGR', due_minor: DUE });
    await tick(300);
    const hand = [...tile(m).querySelectorAll('button')].find((b) => b.textContent === 'Hand over')!;
    expect(hand).toBeDefined();
    expect(tile(m).querySelector('[data-ask]')).toBeNull();
    m.click(hand);
    await flush();
    expect(m.container.querySelector('.tk-toast')?.textContent).toContain('48 handed over');
    await tick(UNDO_MS);
    expect(h.sent).toEqual([{ type: 'MarkServed', payload: { lines: [{ order_id: 'O48', order_item_ids: ['A'] }], customer_handover: true }, meta: { label: 'Mark served · 48' } }]);
    m.unmount();
  });

  it('D2: the approved amount covers only that due — the due rising above it blocks the tile again', async () => {
    const rows = [dueRow('O48', 48)];
    const h = screenHarness({ rows, bills: { O48: openBill('B48', DUE) } });
    const m = h.render();
    await flush();
    frame(h, 'UnpaidHandoverApproved', { order_id: 'O48', alert_id: 'AL1', approved_by_staff_id: 'S_MGR', due_minor: DUE });
    await tick(300);
    expect(tile(m).querySelector('[data-ask]')).toBeNull();
    rows[0] = dueRow('O48', 48, { bill: { state: 'due', due_minor: DUE + 10_000 } });
    frame(h, 'OpenOrderBillChanged', { order_ids: ['O48'], approval_cleared_order_ids: [] });
    await tick(300);
    expect(tile(m).querySelector('[data-ask="O48"]')).not.toBeNull();
    m.unmount();
  });

  it('the hub flag unpaid_handover_approved: true on the row (a reload) hands over without a frame', async () => {
    const h = screenHarness({ rows: [dueRow('O48', 48, { unpaid_handover_approved: true })], bills: { O48: openBill('B48', DUE) } });
    const m = h.render();
    await flush();
    expect([...tile(m).querySelectorAll('button')].some((b) => b.textContent === 'Hand over')).toBe(true);
    m.unmount();
  });

  it('a mixed Due token (root + addition): approving the addition (D2) leaves Hand over all blocked; Ask names the root', async () => {
    const views = { O48: view('O48', [sl('O48', 'A', 'Karahi', 'done')]), O49: view('O49', [sl('O49', 'B', 'Naan', 'done')]) };
    const rows = [dueRow('O48', 48, { placed_at: at(13, 4) }), dueRow('O49', 48, { placed_at: at(13, 6) })];
    const h = screenHarness({ rows, views, bills: { O49: openBill('B48', DUE), O48: openBill('B48', DUE) } });
    const m = h.render();
    await flush();
    // the newest blocked order is named first
    expect(tile(m).querySelector('[data-ask="O49"]')).not.toBeNull();
    frame(h, 'UnpaidHandoverApproved', { order_id: 'O49', alert_id: 'AL1', approved_by_staff_id: 'S_MGR', due_minor: DUE });
    await tick(300);
    expect(tile(m).querySelector('[data-ask="O48"]')).not.toBeNull();
    m.click(m.container.querySelector('.tk-rt__open'));
    await tick(300);
    const drawer = m.container.querySelector('.tk-drawer')!;
    expect(drawer.querySelector('[data-ask="O48"]')).not.toBeNull();
    expect(m.button('Hand over all').getAttribute('aria-disabled')).toBe('true');
    m.unmount();
  });

  it('the drawer: Give ready items now may not take the last line of a Due order; a partial one that leaves a line is allowed', async () => {
    const views = { O48: view('O48', [sl('O48', 'A', 'Karahi', 'done'), sl('O48', 'B', 'Naan', 'cooking')]) };
    const h = screenHarness({ rows: [dueRow('O48', 48, { ready: { n: 1, m: 2 } })], views, bills: { O48: openBill('B48', DUE) } });
    const m = h.render();
    await flush();
    m.click(m.container.querySelector('.tk-qr, .tk-rt__open'));
    await tick(300);
    const give = [...m.container.querySelectorAll('.tk-drawer button')].find((b) => b.textContent?.startsWith('Give ready items now'))!;
    // Karahi given, Naan still cooking in the order: allowed (partial)
    expect(give.getAttribute('aria-disabled')).toBe('false');
    m.click(give);
    await tick(UNDO_MS);
    expect(h.sent[0]?.payload).toEqual({ lines: [{ order_id: 'O48', order_item_ids: ['A'] }], customer_handover: true });
    m.unmount();
  });

  it('the last live line of a Due order: Hand over all greyed, Ask a manager in the drawer (R2-M-7, TK-Q19)', async () => {
    const views = { O48: view('O48', [sl('O48', 'A', 'Karahi', 'done')]) };
    const h = screenHarness({ rows: [dueRow('O48', 48)], views, bills: { O48: openBill('B48', DUE) } });
    const m = h.render();
    await flush();
    m.click(m.container.querySelector('.tk-rt__open'));
    await tick(300);
    expect(m.button('Hand over all').getAttribute('aria-disabled')).toBe('true');
    expect(m.container.querySelector('.tk-drawer [data-ask="O48"]')).not.toBeNull();
    m.unmount();
  });

  it('the hub refuses an unpaid hand-over (403 unpaid_handover_approval_required) → "Not paid — take payment first or ask a manager"', async () => {
    const h = screenHarness({
      rows: [dueRow('O48', 48, { unpaid_handover_approved: true })],
      bills: { O48: openBill('B48', DUE) },
      answer: () => ({ status: 'refused', error: { kind: 'api', status: 403, code: 'PERMISSION_DENIED', details: { reason: 'unpaid_handover_approval_required', order_id: 'O48' } } }),
    });
    const m = h.render();
    await flush();
    m.click([...tile(m).querySelectorAll('button')].find((b) => b.textContent === 'Hand over')!);
    await flush();
    await tick(UNDO_MS);
    expect(h.toasts.at(-1)).toEqual({ text: 'Not paid — take payment first or ask a manager', tone: 'warn' });
    m.unmount();
  });

  it('a paid tile (bill paid on the row) hands over at once, with the flag', async () => {
    const h = screenHarness({ rows: [dueRow('O48', 48, { bill: { state: 'paid', due_minor: 0 } })] });
    const m = h.render();
    await flush();
    m.click([...tile(m).querySelectorAll('button')].find((b) => b.textContent === 'Hand over')!);
    await flush();
    await tick(UNDO_MS);
    expect(h.sent[0]?.payload).toEqual({ lines: [{ order_id: 'O48', order_item_ids: ['A'] }], customer_handover: true });
    m.unmount();
  });

  it('[L-CLIENT-6b; e2e 02b-tk-handover ur] the bill just closed (OrdersBilled), the rail row not re-read yet (still Due): the tile hands over — the fresh order-view says billed', async () => {
    const h = screenHarness({ rows: [dueRow('O48', 48)], views: { O48: { ...view('O48', [sl('O48', 'A', 'Karahi', 'done')]), billed: true } } });
    const m = h.render();
    await flush();
    frame(h, 'OrdersBilled', { order_ids: ['O48'] });
    await flush();
    m.click([...tile(m).querySelectorAll('button')].find((b) => b.textContent === 'Hand over')!);
    await flush();
    expect(m.container.querySelector('section.tk-drawer')).toBeNull();
    await tick(UNDO_MS);
    expect(h.sent[0]?.payload).toEqual({ lines: [{ order_id: 'O48', order_item_ids: ['A'] }], customer_handover: true });
    m.unmount();
  });
});
