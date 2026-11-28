import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus, type LiveBus } from '../../shell/live';
import { createPermissions } from '../../shell/permissions';
import { createToastBus } from '../../shell/toast';
import type { CatchUpOrder, OpenOrder, OpenOrdersBody } from '../contracts';
import { createTokenBook, type TokenBook } from './book';
import { buildQueue, knownOrders, matchesQuery } from './queue-model';
import { QueueRail } from './QueueRail';
import { aCaught, aLine, aRow, at } from './test-fixtures';

// 02b-TK C2-1 (02b v1.0.24 §6.16, §6.19, §8; frames HomeKiosk, ReadyTiles, PhoneQueue; R3): the takeaway queue rail.

const nav = vi.hoisted(() => ({ to: [] as string[] }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: (p: string) => nav.to.push(p) }));

const NOW = at(13, 20);

const ROWS: OpenOrder[] = [
  aRow({ order_id: 'O48', token: 48, ready: { n: 2, m: 2 }, promise_ms: at(13, 12) }),
  aRow({ order_id: 'O53', token: 53, ready: { n: 0, m: 2 }, promise_ms: at(13, 31) }),
  aRow({ order_id: 'O54', token: 54, ready: { n: 1, m: 2 }, promise_ms: at(13, 24) }),
  aRow({ order_id: 'O52', token: 52, ready: { n: 1, m: 3 }, promise_ms: at(13, 31) }),
];
const CAUGHT: CatchUpOrder[] = [
  aCaught('O48', 48, [aLine('O48', 'L48a', 'Full Chicken Karahi'), aLine('O48', 'L48b', 'Roghni Naan', { units: 6, live_units: 6, quantity: 6 })], { customer_name: 'Ali', phone: '03001234567' }),
  aCaught('O53', 53, [aLine('O53', 'L53a', 'Half Chicken Karahi'), aLine('O53', 'L53b', 'Roghni Naan', { units: 4, live_units: 4, quantity: 4 })], { customer_name: 'Bilal', phone: '03214449876' }),
  aCaught('O54', 54, [aLine('O54', 'L54a', 'Paye')]),
  aCaught('O52', 52, [aLine('O52', 'L52a', 'Paye', { served_at: at(13, 10) }), aLine('O52', 'L52b', 'Karahi')], { customer_name: 'Ayesha' }),
];

/** 05 §6.2 open-bills rows (a projected takeaway bill per bill_key; its order_id = the key's root unbilled order). */
const BILLS = [
  { bill_id: null, seating_id: null, order_id: 'O48', identifier: '#48', order_type: 'takeaway', state: 'projected', total_default_minor: 119_000, paid_minor: 0, due_minor: 119_000, check_printed_at: null, opened_at: at(13, 0), open_minutes: 20, flagged: false, partly_paid: false, has_open_request: false },
  { bill_id: 'B9', seating_id: 'S9', order_id: null, identifier: 'T9', order_type: 'dine_in', state: 'open', total_default_minor: 50_000, paid_minor: 0, due_minor: 50_000, check_printed_at: null, opened_at: at(12, 0), open_minutes: 80, flagged: false, partly_paid: false, has_open_request: false },
];

function setup(o: { rows?: OpenOrder[]; caught?: CatchUpOrder[]; online?: boolean; bills?: unknown[]; takePayment?: boolean } = {}) {
  const live = createLiveBus();
  live.frame({ type: 'catch_up', as_of_seq: 1, state: { orders: { orders: o.caught ?? CAUGHT, zone_stock: [] } } });
  let rows = o.rows ?? ROWS;
  const openOrders = vi.fn(async (): Promise<{ ok: true; data: OpenOrdersBody }> => ({ ok: true, data: { orders: rows } }));
  const orderContact = vi.fn();
  let bills = o.bills ?? BILLS;
  const query = vi.fn(async (path: string) => (path === '/queries/open-bills' ? { ok: true, data: { bills, as_of_seq: 1 } } : { ok: false, error: { kind: 'network' } }));
  const shell = {
    api: { query, page: vi.fn(), command: vi.fn() },
    device: { token: 'D', id: 'dev-1', type: 'cashier_kiosk' },
    orders: { openOrders, orderContact },
    live,
    permissions: createPermissions(o.takePayment === false ? {} : ({ 'take-payment': { grant: 'allowed', scope: 'branch' } } as never)),
    toasts: createToastBus(),
    enqueue: Object.assign(async () => ({ status: 'needs_hub' }), { pendingFor: () => 0, pendingCount: () => 0, subscribe: () => () => {} }),
    clock: { nowMs: () => NOW, utcOffsetMs: 0 },
    me: { staff_id: 'sana', name: 'Sana' },
    online: o.online ?? true,
    phone: false,
    portrait: false,
  } as unknown as Shell;
  return { shell, live, openOrders, orderContact, query, setRows: (r: OpenOrder[]) => (rows = r), setBills: (b: unknown[]) => (bills = b) };
}

let view: Mounted | null = null;
let book: TokenBook | null = null;
beforeEach(() => {
  nav.to = [];
});
afterEach(() => {
  view?.unmount();
  view = null;
  book?.dispose();
  book = null;
  vi.useRealTimers();
});

async function show(s: ReturnType<typeof setup>, onOpen = vi.fn(), heldCount = 0, onPay?: (q: unknown) => void) {
  book = createTokenBook(s.live);
  view = mount();
  view.render(
    <ShellContext.Provider value={s.shell}>
      <QueueRail variant="column" book={book} selected={null} onOpen={onOpen} heldCount={heldCount} onPay={onPay} />
    </ShellContext.Provider>,
  );
  await flush();
  return view;
}

const tiles = (v: Mounted) => [...v.container.querySelectorAll<HTMLElement>('.tk-rt')];
const rows = (v: Mounted) => [...v.container.querySelectorAll<HTMLElement>('.tk-qr:not(.tk-qr--q)')];
const typeIn = (v: Mounted, text: string) => {
  const input = v.container.querySelector<HTMLInputElement>('.tk-search input')!;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const ev = (seq: number, event_type: string, payload: Record<string, unknown>) => ({ type: 'event' as const, seq, event: { event_id: `E${seq}`, event_type, schema_version: 1, payload } });

describe('[02b-TK C2-1] the takeaway queue rail', () => {
  it('[02b §6.16; frame HomeKiosk] Ready — hand over tiles (all ready, or part given) and Cooking rows by promise, names from the catch-up', async () => {
    const v = await show(setup());
    expect(v.text()).toContain('Ready — hand over');
    expect(tiles(v).map((x) => x.querySelector('.tok')!.textContent)).toEqual(['48', '52']);
    // a Due tile shows the amount due, not the name (05 §6.1; R2; frame ReadyTiles)
    expect(tiles(v)[0]!.textContent).toContain('Due');
    expect(tiles(v)[0]!.textContent).toContain('Take payment');
    // part given: a served line, the rest cooking → dashed tile "Part given · rest 1:31 PM"
    expect(tiles(v)[1]!.className).toContain('tk-rt--part');
    expect(tiles(v)[1]!.textContent).toContain('Part given · rest');
    expect(tiles(v)[1]!.textContent).toContain('1:31 PM');
    expect(v.text()).toContain('Cooking');
    expect(rows(v).map((x) => x.querySelector('.tk-tok')!.textContent)).toEqual(['54', '53']);
    expect(rows(v)[1]!.textContent).toContain('Bilal');
    expect(rows(v)[1]!.textContent).toContain('Half Chicken Karahi · 4× Roghni Naan');
    expect(rows(v)[0]!.textContent).toContain('Takeaway');
  });

  it('[05 §6.1, §6.2; R2; frame ReadyTiles] a Due ready tile shows the amount due (Rs, LTR) and Take payment, not the name; one open-bills read for the rail', async () => {
    const s = setup();
    const onPay = vi.fn();
    const v = await show(s, vi.fn(), 0, onPay);
    const due = tiles(v)[0]!;
    const amount = due.querySelector('.tk-rt__who .money')!;
    expect(amount.textContent).toBe('Rs 1,190');
    expect(amount.getAttribute('dir')).toBe('ltr');
    expect(due.querySelector('.tk-rt__who')!.textContent).not.toContain('Ali');
    v.click(v.button('Take payment', due));
    expect(onPay.mock.calls[0]![0]).toMatchObject({ token: 48, newest_order_id: 'O48' });
    // the part-given tile (paid or not) keeps its text; the Cooking rows read no bill
    expect(tiles(v)[1]!.querySelector('.money')).toBeNull();
    expect(s.query.mock.calls.map((c) => c[0])).toEqual(['/queries/open-bills']);
  });

  it('[05 §6.2] the amount follows the bill: a PaymentAdded frame reads open-bills again (debounced), still one read', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const s = setup();
    const v = await show(s);
    // ⚠️ 05 v1.0.35 §6.2 (R3-B-1, D3): the tile shows due_minor (Σ open split balances), not total − paid
    s.setBills([{ ...BILLS[0]!, state: 'partly_paid', partly_paid: true, paid_minor: 19_000, due_minor: 99_500 }]);
    act(() => s.live.frame(ev(2, 'PaymentAdded', { bill_id: 'B48' })));
    act(() => s.live.frame(ev(3, 'PaymentAdded', { bill_id: 'B48' })));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await flush();
    expect(tiles(v)[0]!.querySelector('.tk-rt__who .money')!.textContent).toBe('Rs 995');
    expect(s.query.mock.calls.filter((c) => c[0] === '/queries/open-bills')).toHaveLength(2);
  });

  it('[05 §6.2] no Due ready tile → no open-bills read; a paid tile keeps the name', async () => {
    const s = setup();
    const v = await show(s);
    s.query.mockClear();
    act(() => s.live.frame(ev(2, 'OrdersBilled', { order_ids: ['O48'], bill_id: 'B48' })));
    await flush();
    const paid = tiles(v)[0]!;
    expect(paid.textContent).toContain('Paid');
    expect(paid.querySelector('.tk-rt__who')!.textContent).toBe('Ali');
    expect(paid.querySelector('.money')).toBeNull();
    const none = setup({ rows: [aRow({ order_id: 'O53', token: 53 })] });
    view?.unmount();
    await show(none);
    expect(none.query).not.toHaveBeenCalled();
  });

  it('[R3] search by token, by name, by the last 4 phone digits — on the device; no contact query', async () => {
    const s = setup();
    const v = await show(s);
    typeIn(v, '53');
    expect([...tiles(v), ...rows(v)].map((x) => x.dataset['token'])).toEqual(['2026-11-24:53']);
    typeIn(v, 'ayE');
    expect([...tiles(v), ...rows(v)].map((x) => x.dataset['token'])).toEqual(['2026-11-24:52']);
    typeIn(v, '4567');
    expect([...tiles(v), ...rows(v)].map((x) => x.dataset['token'])).toEqual(['2026-11-24:48']);
    typeIn(v, '');
    expect(tiles(v).length + rows(v).length).toBe(4);
    expect(s.orderContact).not.toHaveBeenCalled();
    expect(s.openOrders).toHaveBeenCalledWith({ order_type: 'takeaway' });
  });

  it('[02b §6.19 O17] an OrderContactSet frame names a token at once', async () => {
    const s = setup();
    const v = await show(s);
    act(() => s.live.frame(ev(2, 'OrderContactSet', { order_id: 'O54', customer_name: 'Hamza', phone: null })));
    expect(rows(v)[0]!.textContent).toContain('Hamza');
  });

  it('[05 #44a] an addition keeps the root token: one row, the newest order opens', async () => {
    const s = setup({ rows: [aRow({ order_id: 'O53', token: 53 }), aRow({ order_id: 'O53b', token: 53, placed_at: at(13, 10), promise_ms: at(13, 33) })] });
    const onOpen = vi.fn();
    const v = await show(s, onOpen);
    expect(rows(v)).toHaveLength(1);
    expect(rows(v)[0]!.textContent).toContain('1:33 PM');
    v.click(rows(v)[0]!);
    expect(onOpen.mock.calls[0]![0]).toMatchObject({ token: 53, order_ids: ['O53', 'O53b'], newest_order_id: 'O53b' });
  });

  it('[02b §6.19] a paid token stays (Paid) until handed over, though open-orders drops it; handed over in full it goes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const s = setup();
    const v = await show(s);
    act(() => s.live.frame(ev(2, 'OrdersBilled', { order_ids: ['O48'], bill_id: 'B48' })));
    s.setRows(ROWS.filter((r) => r.order_id !== 'O48'));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await flush();
    expect(tiles(v)[0]!.textContent).toContain('48');
    expect(tiles(v)[0]!.textContent).toContain('Paid');
    expect(tiles(v)[0]!.textContent).toContain('Hand over');
    act(() => s.live.frame(ev(3, 'ItemServed', { order_item_ids: ['L48a', 'L48b'], source: 'tap' })));
    expect(tiles(v).map((x) => x.querySelector('.tok')!.textContent)).toEqual(['52']);
  });

  it('[frame HomeKiosk] the foot: Held (n) and All orders; nothing open → the one empty style', async () => {
    const v = await show(setup({ rows: [], caught: [] }), vi.fn(), 2);
    expect(v.text()).toContain('No takeaway orders yet');
    expect(v.button('Held').textContent).toContain('2');
    v.click(v.button('Held'));
    v.click(v.button('All orders'));
    expect(nav.to).toEqual(['/held', '/orders']);
  });

  it('[02b §6.16] a failed read says so with Try again', async () => {
    const s = setup();
    s.openOrders.mockResolvedValueOnce({ ok: false, error: { kind: 'network' } } as never);
    const v = await show(s);
    expect(v.text()).toContain('Couldn’t load orders');
    v.click(v.button('Try again'));
    await flush();
    expect(tiles(v)).toHaveLength(2);
  });
});

// BUG-12 (QA, kiosk): after the session ended the rail showed every token as "Takeaway", no items, red "Due" — paid
// ones too: it took Paid and the items only from this device's copy (the socket's catch-up / frames), so rows read
// without that copy looked like real, unpaid, empty orders. 02b v1.0.25 §6.16: the open-orders row itself carries
// `bill { state }` and `lines_summary` / `lines_more`; the device copy only adds the names (R3) and Part given.
describe('[BUG-12; 02b v1.0.25 §6.16] the rail never shows the hub rows as something else', () => {
  it('without this device\'s copy of an order (no catch-up), Paid and the items come from the open-orders row', async () => {
    const s = setup({
      caught: [],
      rows: [
        aRow({ order_id: 'O60', token: 60, ready: { n: 2, m: 2 }, bill: { state: 'paid', due_minor: 0 }, lines_summary: [{ name: 'Paye', qty: 1 }, { name: 'Roghni Naan', qty: 4 }], lines_more: 0 }),
        aRow({ order_id: 'O61', token: 61, ready: { n: 0, m: 1 }, bill: { state: 'due', due_minor: 50_000 }, lines_summary: [{ name: 'Karahi', qty: 1 }], lines_more: 2 }),
      ],
    });
    const v = await show(s);
    expect(tiles(v)).toHaveLength(1);
    expect(tiles(v)[0]!.textContent).toContain('Paid');
    expect(tiles(v)[0]!.textContent).not.toContain('Due');
    expect(rows(v)[0]!.textContent).toContain('Karahi +2');
    expect(rows(v)[0]!.textContent).toContain('Due');
  });

  it('a refused read (401 / 403, not a lost network) drops the rows it showed: never the last read as if current', async () => {
    vi.useFakeTimers();
    const s = setup();
    const v = await show(s);
    expect(tiles(v)).toHaveLength(2);
    s.openOrders.mockResolvedValueOnce({ ok: false, error: { kind: 'api', status: 403, code: 'PERMISSION_DENIED', details: {} } } as never);
    act(() => s.live.visibility('visible'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await flush();
    expect(v.text()).toContain('Couldn’t load orders');
    expect(tiles(v)).toHaveLength(0);
    expect(rows(v)).toHaveLength(0);
  });
});

describe('[02b-TK C2-1] queue model', () => {
  it('[R3] last-4 search needs exactly 4 digits; a token prefix matches', () => {
    const live = createLiveBus();
    live.frame({ type: 'catch_up', as_of_seq: 1, state: { orders: { orders: CAUGHT, zone_stock: [] } } });
    const b = createTokenBook(live as LiveBus);
    const m = buildQueue(knownOrders(ROWS, new Map(), b.get));
    const all = [...m.ready, ...m.cooking];
    expect(all.filter((q) => matchesQuery(q, '5')).map((q) => q.token).sort()).toEqual([52, 53, 54]);
    expect(all.filter((q) => matchesQuery(q, '567')).map((q) => q.token)).toEqual([]);
    expect(all.filter((q) => matchesQuery(q, '9876')).map((q) => q.token)).toEqual([53]);
    expect(m.later).toEqual([]);
    b.dispose();
  });
});

// qa1-fix (QA T1 #12; 02b §6.16, §8): the token whose view is open leaves the queue (the whole order cancelled, or
// handed over in full) → the rail tells the screen, which closes the view (never a drawer for a token that is gone).
describe('[02b §8; T1 #12] the open token leaves the queue', () => {
  it('a read without the selected token calls onGone(key) once; a token still listed does not', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const s = setup();
    const gone = vi.fn();
    book = createTokenBook(s.live);
    const key = `${ROWS[0]!.business_date}:${ROWS[0]!.token}`;
    view = mount();
    view.render(
      <ShellContext.Provider value={s.shell}>
        <QueueRail variant="column" book={book} selected={key} onOpen={vi.fn()} heldCount={0} onGone={gone} />
      </ShellContext.Provider>,
    );
    await flush();
    expect(gone).not.toHaveBeenCalled();
    act(() => s.live.frame(ev(2, 'OrderCancelled', { order_id: ROWS[0]!.order_id })));
    s.setRows(ROWS.filter((r) => r.order_id !== ROWS[0]!.order_id));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await flush();
    expect(gone).toHaveBeenCalledWith(key);
    expect(gone).toHaveBeenCalledTimes(1);
  });
});
