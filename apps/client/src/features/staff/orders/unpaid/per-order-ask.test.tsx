import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../../../../i18n';
import { flush, type Mounted } from '../../../../../test/dom';
import { screenHarness, sl, view } from '../takeaway/screen-harness';
import { aRow, at } from '../takeaway/test-fixtures';

// BUG-9 (owner ruling 2026-11-28 "Pass bag = token", approval ruling A kept; 02b v1.0.25 §3.7a Ask, §6.4a, §6.16 bill
// facts, §6.19, §8 OR-7; D2, D3): an unpaid hand-over request is for ONE order and that order's own due. The token
// drawer of a token with two unpaid orders (root + addition, 05 #44a) offers one "Ask a manager" per blocked order,
// each naming it ("#48", "#48 (addition)") with that order's due from its own open-orders row — never the token total
// as one request's amount. An approval (UnpaidHandoverApproved, or the row's unpaid_handover_approved on a re-read)
// takes that order's card away live; the other order keeps its own.

vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: true, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: () => {} }));

const tick = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
};
const ROOT = 4_000;
const ADD = 6_000;
const openBill = (bill_id: string, owed: number) => ({ bill_id, state: 'open', splits: [{ split_no: 1, state: 'open', balance_minor: owed }], totals_default: { total_minor: owed } });
let seq = 10;
const frame = (h: ReturnType<typeof screenHarness>, event_type: string, payload: Record<string, unknown>) =>
  act(() => h.live.frame({ type: 'event', seq: ++seq, event: { event_id: `E${seq}`, event_type, schema_version: 1, payload } } as never));

function harness(o: { approved?: Record<string, boolean>; command?: (type: string, payload: unknown) => unknown; sharedKey?: string } = {}) {
  const views = { O48: view('O48', [sl('O48', 'A', 'Karahi', 'done')]), O49: view('O49', [sl('O49', 'B', 'Naan', 'done')]) };
  const rows = [
    aRow({ order_id: 'O48', token: 48, placed_at: at(13, 4), ready: { n: 1, m: 1 }, promise_ms: at(13, 12), bill: { state: 'due', due_minor: o.sharedKey === undefined ? ROOT : ROOT + ADD, ...(o.sharedKey === undefined ? {} : { key: o.sharedKey }) }, unpaid_handover_approved: o.approved?.['O48'] ?? false }),
    aRow({ order_id: 'O49', token: 48, placed_at: at(13, 6), ready: { n: 1, m: 1 }, promise_ms: at(13, 12), bill: { state: 'due', due_minor: o.sharedKey === undefined ? ADD : ROOT + ADD, ...(o.sharedKey === undefined ? {} : { key: o.sharedKey }) }, unpaid_handover_approved: o.approved?.['O49'] ?? false }),
  ];
  const h = screenHarness({ rows, views, bills: { O48: openBill('B48', ROOT), O49: openBill('B49', ADD) }, ...(o.command === undefined ? {} : { command: o.command }) });
  return { h, rows };
}
const open = async (h: ReturnType<typeof screenHarness>): Promise<Mounted> => {
  const m = h.render();
  await flush();
  m.click(m.container.querySelector('.tk-rt__open, .tk-qr'));
  await tick(300);
  return m;
};
const card = (m: Mounted, order_id: string) => m.container.querySelector<HTMLElement>(`.tk-drawer [data-unpaid="${order_id}"]`);

describe('[BUG-9; 02b §3.7a, §8 OR-7; D2] the token drawer asks per order, with each order\'s own due', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }));
  afterEach(() => {
    vi.useRealTimers();
    setLanguage('en');
    document.body.innerHTML = '';
  });

  it('[02b v1.0.27 owner 2026-11-28 Q9] root and addition on ONE bill → one card for the bill ("#48 · Rs 100"), one request naming the bill\'s oldest order', async () => {
    const sent: unknown[] = [];
    const { h } = harness({ sharedKey: 'K48', command: (type, p) => (type === 'RequestUnpaidHandover' ? (sent.push(p), { ok: true, data: { alert_id: 'AL-K48', is_requester: true } }) : undefined) });
    const m = await open(h);
    expect(card(m, 'O48')).not.toBeNull();
    expect(card(m, 'O49')).toBeNull();
    expect(card(m, 'O48')!.textContent).toContain('Rs 100');
    m.click(card(m, 'O48')!.querySelector('[data-ask="O48"]'));
    await tick(0);
    expect(sent).toEqual([{ order_id: 'O48' }]);
  });

  it('two unpaid orders → two cards: "#48 · Rs 40" and "#48 · Rs 60 (addition)"; each Ask sends its own order_id', async () => {
    const { h } = harness({ command: (type, p) => (type === 'RequestUnpaidHandover' ? { ok: true, data: { alert_id: `AL-${(p as { order_id: string }).order_id}`, is_requester: true } } : undefined) });
    const m = await open(h);
    expect(card(m, 'O48')?.querySelector('small')?.textContent).toBe('#48 · Rs 40');
    expect(card(m, 'O49')?.querySelector('small')?.textContent).toBe('#48 · Rs 60 (addition)');
    m.click(card(m, 'O49')!.querySelector('[data-ask="O49"]'));
    await flush();
    m.click(card(m, 'O48')!.querySelector('[data-ask="O48"]'));
    await flush();
    expect(h.commands.filter((c) => c.type === 'RequestUnpaidHandover').map((c) => c.payload)).toEqual([{ order_id: 'O49' }, { order_id: 'O48' }]);
    m.unmount();
  });

  it('"Already waiting" on the addition goes when the manager approves it (frame); the root keeps its own card; both approved → Hand over all', async () => {
    const { h, rows } = harness({ command: (type) => (type === 'RequestUnpaidHandover' ? { ok: true, data: { alert_id: 'AL1', is_requester: false } } : undefined) });
    const m = await open(h);
    m.click(card(m, 'O49')!.querySelector('[data-ask="O49"]'));
    await flush();
    expect(card(m, 'O49')?.textContent).toContain('Already waiting for a manager');
    // the hub's rows after each approval (a re-read follows the frame)
    rows[1] = { ...rows[1]!, unpaid_handover_approved: true };
    frame(h, 'UnpaidHandoverApproved', { order_id: 'O49', alert_id: 'AL1', approved_by_staff_id: 'S_MGR', due_minor: ADD });
    await tick(300);
    expect(card(m, 'O49')).toBeNull();
    expect(card(m, 'O48')?.querySelector('small')?.textContent).toBe('#48 · Rs 40');
    expect(m.button('Hand over all').getAttribute('aria-disabled')).toBe('true');
    rows[0] = { ...rows[0]!, unpaid_handover_approved: true };
    frame(h, 'UnpaidHandoverApproved', { order_id: 'O48', alert_id: 'AL2', approved_by_staff_id: 'S_MGR', due_minor: ROOT });
    await tick(300);
    expect(card(m, 'O48')).toBeNull();
    expect(m.button('Hand over all').getAttribute('aria-disabled')).toBe('false');
    m.unmount();
  });

  it('a missed frame: the drawer\'s next read of open-orders (unpaid_handover_approved) takes the approved order\'s card away', async () => {
    const { h, rows } = harness();
    const m = await open(h);
    expect(card(m, 'O49')).not.toBeNull();
    rows[1] = { ...rows[1]!, unpaid_handover_approved: true };
    // any order frame makes the drawer read again (useLiveRefetch)
    frame(h, 'OpenOrderBillChanged', { order_ids: ['O48'], approval_cleared_order_ids: [] });
    await tick(300);
    expect(card(m, 'O49')).toBeNull();
    expect(card(m, 'O48')).not.toBeNull();
    m.unmount();
  });

  it('Urdu: the addition mark', async () => {
    setLanguage('ur');
    const { h } = harness();
    const m = await open(h);
    expect(card(m, 'O49')?.querySelector('small')?.textContent).toContain('اضافہ');
    m.unmount();
  });
});
