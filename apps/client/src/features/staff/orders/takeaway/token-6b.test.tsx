
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import { createPermissions } from '../../shell/permissions';
import { createToastBus } from '../../shell/toast';
import type { OrderViewBody, SeatingLine } from '../contracts';
import { createTokenBook, type TokenBook } from './book';
import type { QueueToken } from './queue-model';
import { TokenView, latePairOf } from './TokenView';
import { TK_BACK_EVENT } from '../../shell/context-slot';
import type { OpenOrder } from '../contracts';
import { aLine, at } from './test-fixtures';

// ⚠️ 02b-TK L-CLIENT-6b item 4 (frames TokenDue, TokenReady, TokenPartial, TokenLate; CHANGES §3 Token view): the
// drawer's line sub-lines and stage icons, the late Ready by, Hurry kitchen (BoostOrder), F8 / Enter, the bar's Back,
// "Ask a manager" only for a blocked hand-over (02b §3.7a), and the not-collected pair from the drawer's own read.

const nav = vi.hoisted(() => ({ to: [] as string[] }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: (p: string) => nav.to.push(p) }));

const NOW = at(13, 20);

const sl = (order_id: string, id: string, name: string, stage: SeatingLine['stage'], o: Partial<SeatingLine> = {}): SeatingLine => ({ ...aLine(order_id, id, name, o), stage, fired: true, ...o });

function view(order_id: string, lines: SeatingLine[], o: Partial<OrderViewBody> = {}): OrderViewBody {
  return {
    order_id,
    placed_by: { staff_id: 'sana', name: 'Sana' },
    placed_at: at(13, 4),
    follow_up: false,
    cancelled: false,
    billed: false,
    has_phone: false,
    promise_ms: at(13, 24),
    lines,
    order_type: 'takeaway',
    seating_id: null,
    ...o,
  };
}

const bill = (bill_id: string | null, state: 'projected' | 'open' | 'closed', total: number, balance = total) => ({
  bill_id,
  state,
  // the hub's shape (05 §6.1): a closed split carries its invoice's totals; totals_default is the open remainder (0 once
  // every split is closed)
  splits:
    state === 'projected'
      ? []
      : [{ split_no: 1, state: state === 'closed' ? 'closed' : 'open', balance_minor: state === 'closed' ? 0 : balance, totals: { as_paid: { total_minor: state === 'closed' ? total : 0 } } }],
  totals_default: { total_minor: state === 'closed' ? 0 : total },
});

const tok = (o: Partial<QueueToken> = {}): QueueToken => ({
  key: '2026-11-24:54',
  token: 54,
  order_ids: ['O54'],
  newest_order_id: 'O54',
  customer_name: null,
  phone: '03001234567',
  placed_at: at(13, 4),
  promise_ms: at(13, 24),
  ready: { n: 1, m: 2 },
  paid: false,
  part: false,
  summary: '',
  ...o,
});

function setup(o: { views: Record<string, OrderViewBody>; bills: Record<string, unknown>; grants?: Record<string, unknown> }) {
  const live = createLiveBus();
  const query = vi.fn(async (path: string) => {
    if (!path.startsWith('/queries/bill?')) return { ok: false, error: { kind: 'network' } };
    const id = new URLSearchParams(path.split('?')[1]).get('order_id')!;
    return o.bills[id] === undefined ? { ok: false, error: { kind: 'api', status: 404, code: 'BILL_NOT_FOUND', details: {} } } : { ok: true, data: o.bills[id] };
  });
  const orderView = vi.fn(async (id: string) => (o.views[id] === undefined ? { ok: false, error: { kind: 'api', status: 404, code: 'ORDER_NOT_FOUND', details: {} } } : { ok: true, data: { kind: 'order', order: o.views[id] } }));
  const orderContact = vi.fn(async () => ({ ok: true, data: { customer_name: 'Usman', phone: '03001234567' } }));
  const shell = {
    device: { token: 'D', id: 'dev-1', type: 'cashier_kiosk' },
    api: { query, page: vi.fn(), command: vi.fn() },
    orders: { orderView, orderContact },
    live,
    permissions: createPermissions({ 'mark-served': { grant: 'allowed', scope: 'branch' }, 'take-payment': { grant: 'allowed', scope: 'branch' }, ...(o.grants ?? {}) } as never),
    toasts: createToastBus(),
    clock: { nowMs: () => NOW, utcOffsetMs: 0 },
    me: { staff_id: 'sana', name: 'Sana' },
    online: true,
    phone: false,
    portrait: false,
  } as unknown as Shell;
  return { shell, live, query, orderView, orderContact };
}

let m: Mounted | null = null;
let book: TokenBook | null = null;
beforeEach(() => {
  nav.to = [];
});
afterEach(() => {
  m?.unmount();
  m = null;
  book?.dispose();
  book = null;
  vi.useRealTimers();
  document.body.innerHTML = '';
});

async function show(s: ReturnType<typeof setup>, token: QueueToken, onHandOver = vi.fn()) {
  book = createTokenBook(s.live);
  m = mount();
  m.render(
    <ShellContext.Provider value={s.shell}>
      <TokenView token={token} book={book} onClose={() => {}} onHandOver={onHandOver} onAddItems={() => {}} />
    </ShellContext.Provider>,
  );
  await flush();
  return m;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const chips = (v: Mounted) => [...v.container.querySelectorAll('.tk-il')].map((x) => [x.querySelector('b')!.textContent, x.querySelector('.tk-chip')!.textContent]);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const factText = (v: Mounted) => [...v.container.querySelectorAll('.tk-fact')].map((x) => x.textContent);


describe('[02b-TK L-CLIENT-6b item 4] token drawer', () => {
  const withBoost = { 'boost-order': { grant: 'allowed', scope: 'branch' }, 'take-order': { grant: 'allowed', scope: 'branch' } };

  it('[frame TokenDue] a not-started line says its Ready by; a past Ready by while cooking marks the fact Late', async () => {
    const s = setup({ views: { O54: view('O54', [sl('O54', 'B', 'Roghni Naan', 'cooking', { units: 2, live_units: 2 })], { promise_ms: at(13, 10) }) }, bills: { O54: bill(null, 'projected', 14_000) } });
    const v = await show(s, tok({ promise_ms: at(13, 10) }));
    const line = v.container.querySelector('[data-line="B"]')!;
    expect(line.querySelector('small')?.textContent).toBe('Ready by \u20661:10 PM\u2069');
    expect(line.querySelector('.tk-chip .ico')).not.toBeNull();
    const fact = v.container.querySelector('.tk-fact')!;
    expect(fact.className).toContain('tk-fact--late');
    expect(fact.querySelector('small')?.textContent).toBe('Ready byLate');
  });

  it('[CHANGES §3 "Hurry kitchen"; 02b §6.6] Hurry kitchen sends BoostOrder for the orders still cooking (boost-order only)', async () => {
    const s = setup({ views: { O54: view('O54', [sl('O54', 'B', 'Naan', 'cooking')]) }, bills: { O54: bill(null, 'projected', 4_000) }, grants: withBoost });
    const boostOrder = vi.fn(async () => ({ ok: true, data: {} }));
    (s.shell.orders as unknown as { boostOrder: unknown }).boostOrder = boostOrder;
    const v = await show(s, tok());
    v.click(v.button('Hurry kitchen'));
    await flush();
    expect(boostOrder).toHaveBeenCalledWith({ order_id: 'O54' });
    const none = setup({ views: { O54: view('O54', [sl('O54', 'B', 'Naan', 'cooking')]) }, bills: { O54: bill(null, 'projected', 4_000) } });
    m?.unmount();
    const w = await show(none, tok());
    expect(w.buttons().some((b) => b.textContent === 'Hurry kitchen')).toBe(false);
  });

  it('[frames TokenDue, TokenReady] F8 takes payment on a Due token; Enter hands over a paid, all-ready token', async () => {
    const s = setup({ views: { O54: view('O54', [sl('O54', 'B', 'Naan', 'cooking')]) }, bills: { O54: bill(null, 'projected', 4_000) } });
    const onPay = vi.fn();
    book = createTokenBook(s.live);
    m = mount();
    m.render(
      <ShellContext.Provider value={s.shell}>
        <TokenView token={tok()} book={book} onClose={() => {}} onHandOver={() => {}} onPay={onPay} />
      </ShellContext.Provider>,
    );
    await flush();
    expect(m.container.querySelector('.tk-btn--primary .tk-kbd')?.textContent).toBe('F8');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8', bubbles: true }));
    expect(onPay).toHaveBeenCalledTimes(1);
    m.unmount();
    const p = setup({ views: { O48: view('O48', [sl('O48', 'A', 'Karahi', 'done')], { billed: true }) }, bills: { O48: bill('B48', 'closed', 205_000) } });
    const onHandOver = vi.fn();
    m = await show(p, tok({ order_ids: ['O48'], newest_order_id: 'O48', paid: true, ready: { n: 1, m: 1 } }), onHandOver);
    expect(m.button('Hand over allEnter').getAttribute('aria-disabled')).toBe('false');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onHandOver).toHaveBeenCalledTimes(1);
  });

  it('[frames TokenDue …] the top bar\'s Back closes the drawer', async () => {
    const s = setup({ views: { O54: view('O54', [sl('O54', 'B', 'Naan', 'cooking')]) }, bills: { O54: bill(null, 'projected', 4_000) } });
    const onClose = vi.fn();
    book = createTokenBook(s.live);
    m = mount();
    m.render(
      <ShellContext.Provider value={s.shell}>
        <TokenView token={tok()} book={book} onClose={onClose} onHandOver={() => {}} />
      </ShellContext.Provider>,
    );
    await flush();
    window.dispatchEvent(new Event(TK_BACK_EVENT));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('[02b §3.7a] "Ask a manager" only for a blocked hand-over: not on a Due token still cooking', async () => {
    const s = setup({ views: { O54: view('O54', [sl('O54', 'B', 'Naan', 'cooking')]) }, bills: { O54: bill(null, 'projected', 4_000) } });
    const v = await show(s, tok());
    expect(v.text()).not.toContain('Ask a manager');
    expect(v.text()).not.toContain('Take payment first');
  });

  it('[frame TokenLate; "it showed once, then not"] the not-collected pair from the drawer\'s own open-orders rows', () => {
    const row = (o: Partial<OpenOrder>) => ({ order_id: 'O', ready_at: at(13, 0), bag_ready_window_ms: 900_000, ...o }) as unknown as OpenOrder;
    expect(latePairOf([row({}), row({ ready_at: at(13, 3) })])).toEqual({ ready_since: at(13, 3), late_from: at(13, 18) });
    expect(latePairOf([row({}), row({ bag_ready_window_ms: null })])).toBeNull();
    expect(latePairOf(null)).toBeNull();
  });
});
