import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import { setLanguage } from '../../../../i18n';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import { createPermissions } from '../../shell/permissions';
import { createToastBus } from '../../shell/toast';
import type { CatchUpOrder, OpenOrder, OpenOrdersBody, OrderViewBody, SeatingLine } from '../contracts';
import { createTokenBook, type TokenBook } from './book';
import { buildQueue, notCollectedMinOf, type QueueToken } from './queue-model';
import { QueueRail } from './QueueRail';
import { aCaught, aLine, aRow, at } from './test-fixtures';
import { TokenView } from './TokenView';

// 02b-TK L-CLIENT-2 item 2 (03b v1.0.16 §3.4 "Not collected" (R3-M-9), §3.5, D8; 02b v1.0.25 §6.16; frames ReadyTiles,
// TokenLate): the counter's Ready tile uses the same nullable bag-ready time and frozen window as every Pass card —
// open-orders `ready_at` (takeaway: the D8 whole-bag epoch) and `bag_ready_window_ms` — and turns amber
// (`tk-rt--late`, "{n} min · Call") at hub now ≥ their sum, re-checked on a timer. It clears when the hub clears the
// pair (the bag incomplete again, D8) or the order is collected (the next read). The token drawer opened on a late
// token shows "Ready {n} min ago — not collected" with Call (frame TokenLate).

const nav = vi.hoisted(() => ({ to: [] as string[] }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: (p: string) => nav.to.push(p) }));

const MIN = 60_000;
const READY = at(13, 3);
const WINDOW = 15 * MIN;
const lateRow = (over: Partial<OpenOrder> = {}) => aRow({ order_id: 'O46', token: 46, ready: { n: 2, m: 2 }, promise_ms: at(13, 3), ready_at: READY, bag_ready_window_ms: WINDOW, ...over });
const CAUGHT: CatchUpOrder[] = [aCaught('O46', 46, [aLine('O46', 'L46a', 'Tawa Piece'), aLine('O46', 'L46b', 'Roti', { units: 4, live_units: 4, quantity: 4 })], { customer_name: 'Kamran', phone: '03001234567', billed: true, billed_at: at(13, 1) })];

describe('[03b v1.0.16 §3.4 R3-M-9] the not-collected clock of a token', () => {
  it('minutes since the bag was ready once hub now ≥ ready_at + window; null before, without the pair, or for a token of several orders missing one', () => {
    const q = buildQueue([{ row: lateRow(), book: undefined }]).ready[0]!;
    expect(notCollectedMinOf(q, READY + WINDOW - 1)).toBeNull();
    expect(notCollectedMinOf(q, READY + WINDOW)).toBe(15);
    expect(notCollectedMinOf(q, at(13, 20))).toBe(17);
    expect(notCollectedMinOf(buildQueue([{ row: lateRow({ ready_at: null, bag_ready_window_ms: null }), book: undefined }]).ready[0]!, at(14, 0))).toBeNull();
    // an older hub: no fields at all
    const old: Partial<OpenOrder> = lateRow();
    delete old.ready_at;
    delete old.bag_ready_window_ms;
    expect(notCollectedMinOf(buildQueue([{ row: old as OpenOrder, book: undefined }]).ready[0]!, at(14, 0))).toBeNull();
    // an addition: the token is late only from the later of its orders' bags
    const two = buildQueue([{ row: lateRow(), book: undefined }, { row: lateRow({ order_id: 'O46b', placed_at: at(13, 5), ready_at: at(13, 10) }), book: undefined }]).ready[0]!;
    expect(notCollectedMinOf(two, at(13, 24))).toBeNull();
    expect(notCollectedMinOf(two, at(13, 25))).toBe(15);
    expect(notCollectedMinOf(buildQueue([{ row: lateRow(), book: undefined }, { row: lateRow({ order_id: 'O46b', ready_at: null }), book: undefined }]).ready[0]!, at(14, 0))).toBeNull();
  });
});

let now = at(13, 17);
function setup(rowsIn: OpenOrder[]) {
  const live = createLiveBus();
  live.frame({ type: 'catch_up', as_of_seq: 1, state: { orders: { orders: CAUGHT, zone_stock: [] } } });
  let rows = rowsIn;
  const openOrders = vi.fn(async (): Promise<{ ok: true; data: OpenOrdersBody }> => ({ ok: true, data: { orders: rows } }));
  const shell = {
    api: { query: vi.fn(async () => ({ ok: true, data: { bills: [], as_of_seq: 1 } })), page: vi.fn(), command: vi.fn() },
    device: { token: 'D', id: 'dev-1', type: 'cashier_kiosk' },
    orders: { openOrders, orderContact: vi.fn() },
    live,
    permissions: createPermissions({ 'take-payment': { grant: 'allowed', scope: 'branch' } } as never),
    toasts: createToastBus(),
    enqueue: Object.assign(async () => ({ status: 'needs_hub' }), { pendingFor: () => 0, pendingCount: () => 0, subscribe: () => () => {} }),
    clock: { nowMs: () => now, utcOffsetMs: 0 },
    me: { staff_id: 'sana', name: 'Sana' },
    online: true,
    phone: false,
    portrait: false,
  } as unknown as Shell;
  return { shell, live, setRows: (r: OpenOrder[]) => (rows = r) };
}

let v: Mounted | null = null;
let book: TokenBook | null = null;
afterEach(() => {
  v?.unmount();
  v = null;
  book?.dispose();
  book = null;
  vi.useRealTimers();
  setLanguage('en');
  document.body.innerHTML = '';
});

async function rail(s: ReturnType<typeof setup>, onOpen = vi.fn(), onHandOver = vi.fn()) {
  book = createTokenBook(s.live);
  v = mount();
  v.render(
    <ShellContext.Provider value={s.shell}>
      <QueueRail variant="column" book={book} selected={null} onOpen={onOpen} heldCount={0} onHandOver={onHandOver} />
    </ShellContext.Provider>,
  );
  await flush();
  return v;
}
const tile = (m: Mounted) => m.container.querySelector<HTMLElement>('.tk-rt[data-token="2026-11-24:46"]')!;
const ev = (seq: number, event_type: string, payload: Record<string, unknown>) => ({ type: 'event' as const, seq, event: { event_id: `E${seq}`, event_type, schema_version: 1, payload } });

describe('[03b v1.0.16 §3.4 R3-M-9, §3.5; frame ReadyTiles] the amber counter Ready tile', () => {
  it('before the window: the plain paid tile; at ready_at + window (timer): amber "{n} min · Call", which opens the token', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    now = at(13, 17);
    const onOpen = vi.fn();
    const onHandOver = vi.fn();
    const m = await rail(setup([lateRow()]), onOpen, onHandOver);
    expect(tile(m).classList.contains('tk-rt--late')).toBe(false);
    expect(tile(m).querySelector('.tk-rt__act')!.textContent).toBe('Hand over');
    now = at(13, 20);
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(tile(m).classList.contains('tk-rt--late')).toBe(true);
    const act_ = tile(m).querySelector<HTMLElement>('.tk-rt__act')!;
    expect(act_.textContent).toBe('17 min · Call');
    expect(act_.querySelector('.num')!.getAttribute('dir')).toBe('ltr');
    m.click(act_);
    expect(onOpen.mock.calls[0]![0]).toMatchObject({ token: 46 });
    expect(onHandOver).not.toHaveBeenCalled();
  });

  it('[D8] the bag incomplete again (the hub clears the pair, the next read) → no amber; collected → the tile goes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    now = at(13, 20);
    const s = setup([lateRow()]);
    const m = await rail(s);
    expect(tile(m).classList.contains('tk-rt--late')).toBe(true);
    s.setRows([lateRow({ ready: { n: 1, m: 2 }, ready_at: null, bag_ready_window_ms: null })]);
    act(() => s.live.frame(ev(2, 'ItemReturned', { order_id: 'O46', order_item_id: 'L46a' })));
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    await flush();
    expect(m.container.querySelector('.tk-rt--late')).toBeNull();
  });

  it('a Due late tile is amber and keeps Take payment (money first)', async () => {
    now = at(13, 20);
    const live = setup([lateRow()]);
    live.live.frame({ type: 'catch_up', as_of_seq: 1, state: { orders: { orders: [{ ...CAUGHT[0]!, billed: false, billed_at: null }], zone_stock: [] } } });
    book = createTokenBook(live.live);
    v = mount();
    const onPay = vi.fn();
    v.render(
      <ShellContext.Provider value={live.shell}>
        <QueueRail variant="column" book={book} selected={null} onOpen={vi.fn()} heldCount={0} onPay={onPay} />
      </ShellContext.Provider>,
    );
    await flush();
    expect(tile(v).className).toContain('tk-rt--late');
    expect(tile(v).querySelector('.tk-rt__act')!.textContent).toBe('Take payment');
  });

  // ⚠️ L-CLIENT-2 items 2 + 4 together (03b v1.0.16 §3.4 R3-M-9; 02b v1.0.25 §3.7a, §6.16; D2): a Due tile approved at
  // its due is handable, so past the window it behaves as a paid one; a Due, unapproved one keeps money first
  function dueLate(row: OpenOrder, phone: string | null) {
    const s = setup([row]);
    s.live.frame({ type: 'catch_up', as_of_seq: 1, state: { orders: { orders: [{ ...CAUGHT[0]!, phone, billed: false, billed_at: null }], zone_stock: [] } } });
    book = createTokenBook(s.live);
    v = mount();
    const onOpen = vi.fn();
    const onHandOver = vi.fn();
    const onPay = vi.fn();
    v.render(
      <ShellContext.Provider value={s.shell}>
        <QueueRail variant="column" book={book} selected={null} onOpen={onOpen} heldCount={0} onHandOver={onHandOver} onPay={onPay} />
      </ShellContext.Provider>,
    );
    return { onOpen, onHandOver, onPay };
  }
  const DUE = { bill: { state: 'due' as const, due_minor: 50_000 } };

  it('a Due tile approved at its due, past the window: amber and handable — "{n} min · Call" opens the token; no phone → Hand over', async () => {
    now = at(13, 20);
    const called = dueLate(lateRow({ ...DUE, unpaid_handover_approved: true }), '03001234567');
    await flush();
    expect(tile(v!).className).toContain('tk-rt--late');
    const act_ = tile(v!).querySelector<HTMLElement>('.tk-rt__act')!;
    expect(act_.textContent).toBe('17 min · Call');
    v!.click(act_);
    expect(called.onOpen.mock.calls[0]![0]).toMatchObject({ token: 46 });
    expect(called.onPay).not.toHaveBeenCalled();
    expect(tile(v!).querySelector('[data-ask]')).toBeNull();
    v!.unmount();

    const handed = dueLate(lateRow({ ...DUE, unpaid_handover_approved: true }), null);
    await flush();
    expect(tile(v!).className).toContain('tk-rt--late');
    const hand = tile(v!).querySelector<HTMLElement>('.tk-rt__act')!;
    expect(hand.textContent).toBe('Hand over');
    v!.click(hand);
    expect(handed.onHandOver).toHaveBeenCalledTimes(1);
    expect(handed.onPay).not.toHaveBeenCalled();
  });

  it('a Due, unapproved tile past the window: amber, keeps Take payment and offers Ask a manager (no Call)', async () => {
    now = at(13, 20);
    const called = dueLate(lateRow({ ...DUE, unpaid_handover_approved: false }), '03001234567');
    await flush();
    expect(tile(v!).className).toContain('tk-rt--late');
    const act_ = tile(v!).querySelector<HTMLElement>('.tk-rt__act')!;
    expect(act_.textContent).toBe('Take payment');
    expect(tile(v!).querySelector('[data-ask="O46"]')).not.toBeNull();
    v!.click(act_);
    expect(called.onPay).toHaveBeenCalledTimes(1);
    expect(called.onOpen).not.toHaveBeenCalled();
    expect(called.onHandOver).not.toHaveBeenCalled();
  });

  it('Urdu: "{n} منٹ · فون"', async () => {
    setLanguage('ur');
    now = at(13, 20);
    const m = await rail(setup([lateRow()]));
    expect(tile(m).querySelector('.tk-rt__act')!.textContent).toBe('17 منٹ · فون');
  });
});

const sl = (id: string, name: string, stage: SeatingLine['stage']): SeatingLine => ({ ...aLine('O46', id, name), stage, fired: true });
const orderView = (lines: SeatingLine[]): OrderViewBody => ({
  order_id: 'O46', placed_by: { staff_id: 'sana', name: 'Sana' }, placed_at: at(13, 0), follow_up: false, cancelled: false, billed: true, has_phone: true, promise_ms: at(13, 3), lines, order_type: 'takeaway', seating_id: null,
});
const token = (over: Partial<QueueToken> = {}): QueueToken => ({
  key: '2026-11-24:46', token: 46, order_ids: ['O46'], newest_order_id: 'O46', customer_name: 'Kamran', phone: '03001234567', placed_at: at(13, 0), promise_ms: at(13, 3),
  ready: { n: 2, m: 2 }, paid: true, part: false, summary: '', ready_since: READY, late_from: READY + WINDOW, ...over,
});

async function drawer(lines: SeatingLine[], q: QueueToken) {
  const live = createLiveBus();
  const shell = {
    device: { token: 'D', id: 'dev-1', type: 'cashier_kiosk' },
    api: { query: vi.fn(async () => ({ ok: false, error: { kind: 'network' } })), page: vi.fn(), command: vi.fn() },
    orders: { orderView: vi.fn(async () => ({ ok: true, data: { kind: 'order', order: orderView(lines) } })), orderContact: vi.fn() },
    live,
    permissions: createPermissions({ 'mark-served': { grant: 'allowed', scope: 'branch' }, 'view-customer-contact': { grant: 'allowed', scope: 'branch' } } as never),
    toasts: createToastBus(),
    clock: { nowMs: () => now, utcOffsetMs: 0 },
    me: { staff_id: 'sana', name: 'Sana' },
    online: true,
    phone: false,
    portrait: false,
  } as unknown as Shell;
  book = createTokenBook(live);
  v = mount();
  v.render(
    <ShellContext.Provider value={shell}>
      <TokenView token={q} book={book} onClose={() => {}} onHandOver={() => {}} />
    </ShellContext.Provider>,
  );
  await flush();
  return v;
}

describe('[03b v1.0.16 §3.4 R3-M-9; frame TokenLate] the token drawer of a late token', () => {
  it('"Ready 17 min ago — not collected" with Call while every line is ready; none before the window', async () => {
    now = at(13, 20);
    const m = await drawer([sl('L46a', 'Tawa Piece', 'done'), sl('L46b', 'Roti', 'done')], token());
    const banner = m.container.querySelector<HTMLElement>('.tk-banner--warn[data-late]')!;
    expect(banner.textContent).toContain('Ready 17 min ago — not collected');
    // ⚠️ L-CLIENT-6b item 4 (frame TokenLate "Call · 0300 ••• 4567"): the masked phone on the banner's Call
    expect(banner.querySelector('.tk-btn')!.textContent).toBe('Call · 0300 ••• 4567');
    m.unmount();
    now = at(13, 17);
    const before = await drawer([sl('L46a', 'Tawa Piece', 'done'), sl('L46b', 'Roti', 'done')], token());
    expect(before.container.querySelector('[data-late]')).toBeNull();
  });

  it('[D8] a line not ready any more (the drawer\'s own read) → no banner', async () => {
    now = at(13, 20);
    const m = await drawer([sl('L46a', 'Tawa Piece', 'cooking'), sl('L46b', 'Roti', 'done')], token());
    expect(m.container.querySelector('[data-late]')).toBeNull();
  });
});
