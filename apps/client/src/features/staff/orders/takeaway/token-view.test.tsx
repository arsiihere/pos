
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import { createPermissions } from '../../shell/permissions';
import { createToastBus } from '../../shell/toast';
import type { OrderViewBody, SeatingLine } from '../contracts';
import { createTokenBook, type TokenBook } from './book';
import { createHandovers, UNDO_MS } from './handover';
import { maskPhone, hideName, hidePhone } from './mask';
import type { QueueToken } from './queue-model';
import { TokenView } from './TokenView';
import { aLine, at } from './test-fixtures';
import { orderErrorKey } from '../view/LineActions';
import { voidErrorText } from '../../../voids/errors';

// 02b-TK C2-2 (02b v1.0.24 §3.7, §6.4, §6.18, §6.18a; 05 v1.0.34 §6.1, B16; frames TokenDue, TokenReady, TokenPartial,
// HandoverUndo; ruling R2): the token view drawer and the 5 s hand-over Undo.

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

const chips = (v: Mounted) => [...v.container.querySelectorAll('.tk-il')].map((x) => [x.querySelector('b')!.textContent, x.querySelector('.tk-chip')!.textContent]);
const factText = (v: Mounted) => [...v.container.querySelectorAll('.tk-fact')].map((x) => x.textContent);

describe('[02b-TK C2-2] token view', () => {
  it('[02b §6.18a; frame TokenDue] stages per item; Ready by, Bill Due from bill?order_id, the phone masked', async () => {
    const s = setup({
      views: { O54: view('O54', [sl('O54', 'A', 'Paye', 'done', { units: 2, live_units: 2 }), sl('O54', 'B', 'Lassi', 'cooking'), sl('O54', 'C', 'Raita', 'added', { fired: false }), sl('O54', 'D', 'Naan', 'served', { served_at: at(13, 10) })]) },
      bills: { O54: bill(null, 'projected', 180_000) },
    });
    const v = await show(s, tok());
    expect(chips(v)).toEqual([
      ['Paye', 'Ready'],
      ['Lassi', 'Cooking'],
      ['Raita', 'Waiting'],
      ['Naan', 'Handed over'],
    ]);
    expect(v.container.querySelector('.tk-il')!.textContent).toContain('2×');
    expect(factText(v)).toEqual(['Ready by1:24 PM', 'BillDue · Rs 1,800', 'Phone0300 ••• 4567']);
    expect(v.text()).toContain('Placed 1:04 PM by Sana');
    expect(s.query).toHaveBeenCalledWith('/queries/bill?order_id=O54');
  });

  it('[02b §3.7, §6.4] Give ready items now hands over the ready lines only', async () => {
    const s = setup({ views: { O54: view('O54', [sl('O54', 'A', 'Paye', 'done', { units: 2, live_units: 2 }), sl('O54', 'B', 'Lassi', 'cooking')]) }, bills: { O54: bill(null, 'projected', 180_000) } });
    const onHandOver = vi.fn();
    const v = await show(s, tok(), onHandOver);
    v.click(v.button('Give ready items now'));
    expect(v.button('Give ready items now').textContent).toContain('2× Paye');
    expect(onHandOver.mock.calls[0]![0].map((l: SeatingLine) => l.order_item_id)).toEqual(['A']);
  });

  it('[02b §3.7, §6.4; owner ruling 2026-11-24 #1] a line not yet sent to the kitchen keeps the token not all ready: Give ready items now, no Hand over all', async () => {
    const s = setup({
      views: { O48: view('O48', [sl('O48', 'A', 'Karahi', 'done'), sl('O48', 'B', 'Kheer', 'added', { fired: false }), sl('O48', 'C', 'Raita', 'removed', { live_units: 0 }), sl('O48', 'D', 'Naan', 'served', { served_at: at(13, 10) })]) },
      bills: { O48: bill('B48', 'closed', 205_000) },
    });
    const onHandOver = vi.fn();
    const v = await show(s, tok({ order_ids: ['O48'], newest_order_id: 'O48', paid: true }), onHandOver);
    expect(v.text()).not.toContain('Hand over all');
    v.click(v.button('Give ready items now'));
    expect(onHandOver.mock.calls[0]![0].map((l: SeatingLine) => l.order_item_id)).toEqual(['A']);
  });

  it('[owner ruling 2026-11-24 #1] an addition\'s unsent line counts too; every live line ready (served and removed ones aside) → Hand over all', async () => {
    const root = view('O48', [sl('O48', 'A', 'Karahi', 'done'), sl('O48', 'C', 'Raita', 'removed', { live_units: 0 }), sl('O48', 'D', 'Naan', 'served', { served_at: at(13, 10) })]);
    const tk = tok({ order_ids: ['O48', 'O48b'], newest_order_id: 'O48b', paid: true });
    const bills = { O48: bill('B48', 'closed', 205_000), O48b: bill('B48', 'closed', 205_000) };
    const notYet = await show(setup({ views: { O48: root, O48b: view('O48b', [sl('O48b', 'B', 'Kheer', 'added', { fired: false })]) }, bills }), tk);
    expect(notYet.text()).not.toContain('Hand over all');
    expect(notYet.text()).toContain('Give ready items now');
    notYet.unmount();
    m = null;
    book?.dispose();
    const onHandOver = vi.fn();
    const v = await show(setup({ views: { O48: root, O48b: view('O48b', [sl('O48b', 'B', 'Kheer', 'done')]) }, bills }), tk, onHandOver);
    expect(v.text()).not.toContain('Give ready items now');
    v.click(v.button('Hand over all'));
    expect(onHandOver.mock.calls[0]![0].map((l: SeatingLine) => l.order_item_id)).toEqual(['A', 'B']);
  });

  it('[R2; 05 B16] a Due bill greys Hand over all for a cashier; Take payment opens the bill', async () => {
    const s = setup({ views: { O50: view('O50', [sl('O50', 'A', 'Karahi', 'done'), sl('O50', 'B', 'Naan', 'done')]) }, bills: { O50: bill('B50', 'open', 119_000) }, grants: { 'apply-discount': { grant: 'requires_approval' } } });
    const onHandOver = vi.fn();
    const v = await show(s, tok({ key: 'k50', token: 50, order_ids: ['O50'], newest_order_id: 'O50' }), onHandOver);
    const all = v.button('Hand over all');
    expect(all.getAttribute('aria-disabled')).toBe('true');
    v.click(all);
    expect(onHandOver).not.toHaveBeenCalled();
    expect(v.text()).toContain('Take payment first');
    v.click(v.button('Take payment · Rs 1,190'));
    expect(nav.to).toEqual(['/bill?order_id=O50']);
  });

  it('[R2; owner ruling 2026-11-24 #2] no unpaid override in the pilot: a manager / Owner session on a Due token sees Hand over all greyed and "Take payment first"', async () => {
    const owner = { 'apply-discount': { grant: 'allowed', scope: 'branch' }, 'take-order': { grant: 'allowed', scope: 'branch' }, 'void-item': { grant: 'allowed', scope: 'branch' }, 'view-customer-contact': { grant: 'allowed', scope: 'branch' } };
    const s = setup({ views: { O50: view('O50', [sl('O50', 'A', 'Karahi', 'done')]) }, bills: { O50: bill('B50', 'open', 119_000) }, grants: owner });
    const onHandOver = vi.fn();
    const v = await show(s, tok({ order_ids: ['O50'], newest_order_id: 'O50' }), onHandOver);
    expect(v.text()).not.toContain('Hand over unpaid');
    // ⚠️ OR-7 (02b v1.0.25 §3.7a; L-CLIENT-2 item 4): no override — the only way is the request, "Ask a manager"
    expect(v.container.querySelectorAll('[data-ask]')).toHaveLength(1);
    const all = v.button('Hand over all');
    expect(all.getAttribute('aria-disabled')).toBe('true');
    v.click(all);
    expect(onHandOver).not.toHaveBeenCalled();
    expect(v.container.querySelector('[role="note"]')?.textContent).toBe('Take payment first');
  });

  it('[frame TokenReady] paid and all ready: Hand over all hands every servable line over', async () => {
    const s = setup({ views: { O48: view('O48', [sl('O48', 'A', 'Karahi', 'done'), sl('O48', 'B', 'Raita', null)]) }, bills: { O48: bill('B48', 'closed', 205_000) } });
    const onHandOver = vi.fn();
    const v = await show(s, tok({ order_ids: ['O48'], newest_order_id: 'O48', paid: true }), onHandOver);
    expect(factText(v)[1]).toBe('BillPaid · Rs 2,050');
    expect(v.text()).not.toContain('Give ready items now');
    v.click(v.button('Hand over all'));
    expect(onHandOver.mock.calls[0]![0].map((l: SeatingLine) => l.order_item_id)).toEqual(['A', 'B']);
  });

  it('[frame TokenPartial] not all ready: Hand over all greyed with the ready time', async () => {
    const s = setup({ views: { O52: view('O52', [sl('O52', 'A', 'Karahi', 'cooking')], { promise_ms: at(13, 31) }) }, bills: { O52: bill('B52', 'closed', 295_000) } });
    const v = await show(s, tok({ order_ids: ['O52'], newest_order_id: 'O52', paid: true }));
    expect(v.button('Hand over all').getAttribute('aria-disabled')).toBe('true');
    expect(v.button('Hand over all').textContent).toContain('1:31 PM');
  });

  it('[05 #44e] the root bill closed, the addition opened a new bill: the newest order is asked; both bills show', async () => {
    const s = setup({
      views: { O53: view('O53', [sl('O53', 'A', 'Karahi', 'cooking')]), O53b: view('O53b', [sl('O53b', 'B', 'Naan', 'added')]) },
      bills: { O53: bill('B1', 'closed', 290_000), O53b: bill('B2', 'open', 39_000) },
    });
    const v = await show(s, tok({ order_ids: ['O53', 'O53b'], newest_order_id: 'O53b' }));
    expect(factText(v)).toEqual(['Ready by1:24 PM', 'Bill 1Paid · Rs 2,900', 'Bill 2Due · Rs 390', 'Phone0300 ••• 4567']);
    expect(s.orderView.mock.calls.map((c) => c[0])).toEqual(['O53', 'O53b']);
  });

  it('[02b §6.18] Call only for view-customer-contact holders; it reads order-contact', async () => {
    const views = { O54: view('O54', [sl('O54', 'A', 'Paye', 'cooking')], { has_phone: true }) };
    const none = await show(setup({ views, bills: {} }), tok());
    expect(none.text()).not.toContain('Call');
    none.unmount();
    m = null;
    const s = setup({ views, bills: {}, grants: { 'view-customer-contact': { grant: 'allowed', scope: 'branch' } } });
    const v = await show(s, tok());
    v.click(v.button('Call'));
    await flush();
    expect(s.orderContact).toHaveBeenCalledWith('O54');
    expect(document.body.textContent).toContain('03001234567');
  });

  // ⚠️ 02b v1.0.29 §8 (owner 2026-11-28 QA-R2, BUG-14), test 107: Call only when view-customer-contact covers the token
  it('[02b #107] an Order taker (own_tables) on a token someone else placed: Call disabled (masked), no order-contact read; on their own token: enabled', async () => {
    const own = { 'view-customer-contact': { grant: 'allowed', scope: 'own_tables' } };
    const theirs = { O54: view('O54', [sl('O54', 'A', 'Paye', 'cooking')], { has_phone: true, placed_by: { staff_id: 'zain', name: 'Zain' } }) };
    const s = setup({ views: theirs, bills: {}, grants: own });
    const v = await show(s, tok());
    const call = v.button('Call');
    expect(call.getAttribute('aria-disabled')).toBe('true');
    v.click(call);
    await flush();
    expect(s.orderContact).not.toHaveBeenCalled();
    v.unmount();
    m = null;
    const mine = { O54: view('O54', [sl('O54', 'A', 'Paye', 'cooking')], { has_phone: true }) };
    const s2 = setup({ views: mine, bills: {}, grants: own });
    const v2 = await show(s2, tok());
    expect(v2.button('Call').getAttribute('aria-disabled')).toBe('false');
    v2.click(v2.button('Call'));
    await flush();
    expect(s2.orderContact).toHaveBeenCalledWith('O54');
  });
});

describe('[02b-TK C2-2] hand-over Undo', () => {
  const payload = { lines: [{ order_id: 'O48', order_item_ids: ['A'] }] };
  it('[frame HandoverUndo] MarkServed waits 5 s; Undo inside the window never sends it', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const sent: string[] = [];
    const h = createHandovers({ send: (x) => sent.push(x.id) });
    const stop = h.attach();
    h.start({ id: 'h1', token_key: 'k', ident: '48', payload });
    h.start({ id: 'h2', token_key: 'k2', ident: '49', payload });
    vi.advanceTimersByTime(UNDO_MS - 1);
    expect(sent).toEqual([]);
    expect(h.undo('h2')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual(['h1']);
    vi.advanceTimersByTime(UNDO_MS);
    expect(sent).toEqual(['h1']);
    expect(h.undo('h1')).toBe(false);
    stop();
  });

  it('[02b-TK C2-2] the page hiding, pagehide or the screen closing sends the waiting hand-overs at once', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const sent: string[] = [];
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
    const win = new EventTarget();
    const h = createHandovers({ send: (x) => sent.push(x.id), doc: doc as never, target: win as never });
    const stop = h.attach();
    h.start({ id: 'h1', token_key: 'k', ident: '48', payload });
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(sent).toEqual(['h1']);
    h.start({ id: 'h2', token_key: 'k', ident: '48', payload });
    win.dispatchEvent(new Event('pagehide'));
    expect(sent).toEqual(['h1', 'h2']);
    h.start({ id: 'h3', token_key: 'k', ident: '48', payload });
    stop();
    expect(sent).toEqual(['h1', 'h2', 'h3']);
    vi.advanceTimersByTime(UNDO_MS);
    expect(sent).toEqual(['h1', 'h2', 'h3']);
  });

  it('[R3] masks', () => {
    expect(maskPhone('+92 300 1234567')).toBe('9230 ••• 4567');
    expect(maskPhone('03001234567')).toBe('0300 ••• 4567');
    expect(hidePhone('03001234567')).toBe('••• 4567');
    expect(hideName(' Usman ')).toBe('U•••');
    expect(hideName('')).toBeNull();
    expect(maskPhone(null)).toBeNull();
  });
});

describe('[02b-TK C2-4] remove / cancel from a token', () => {
  const cookingAndNew = () => view('O54', [sl('O54', 'A', 'Paye', 'cooking', { units: 2, live_units: 2 }), sl('O54', 'B', 'Lassi', 'added', { fired: false })]);

  it('[02b §3.5, §6.2] before the kitchen starts: Remove → RemoveItems on that order', async () => {
    const s = setup({ views: { O54: cookingAndNew() }, bills: { O54: bill(null, 'projected', 180_000) }, grants: { 'take-order': { grant: 'allowed', scope: 'branch' } } });
    const command = s.shell.api.command as ReturnType<typeof vi.fn>;
    command.mockResolvedValue({ ok: true, data: { removed: [{ order_item_id: 'B', units: 1 }], cancelled: false, comp_requests_closed: [] } });
    const v = await show(s, tok());
    v.click(v.button('Remove / cancel'));
    // ⚠️ L-CLIENT-6b item 5 (frame TokenRemove): one dialog "Remove from token 54" — a stepper per not-started line, the
    // bill line, Keep / "Remove 1 Lassi"
    const dlg = document.body.querySelector<HTMLElement>('.tk-remove')!;
    expect(dlg.querySelector('h2')?.textContent).toBe('Remove from token 54');
    const lassi = dlg.querySelector('[data-line="B"]')!;
    const paye = dlg.querySelector('[data-line="A"]')!;
    expect(paye.querySelector('.tk-step')).toBeNull();
    v.click(v.button('One more Lassi', lassi));
    expect(dlg.textContent).toContain('Bill goes from Rs 1,800 to');
    expect(dlg.textContent).toContain('Not paid yet, so no refund.');
    v.click(v.button('Remove 1 Lassi', dlg));
    await flush();
    expect(command.mock.calls[0]![0]).toBe('RemoveItems');
    expect(command.mock.calls[0]![1]).toEqual({ order_id: 'O54', lines: [{ order_item_id: 'B', units: 1 }] });
  });

  it('[04 §6.1] after the kitchen started: Void, marked for approval when void-item needs it', async () => {
    const s = setup({ views: { O54: cookingAndNew() }, bills: { O54: bill(null, 'projected', 180_000) }, grants: { 'void-item': { grant: 'requires_approval', scope: 'branch' } } });
    const v = await show(s, tok());
    v.click(v.button('Remove / cancel'));
    const dlg = document.body.querySelector<HTMLElement>('.tk-remove')!;
    const paye = dlg.querySelector('[data-line="A"]')!;
    // frame TokenRemove: "Void · approval" and "… · Void needs a manager" on a line past stage 1
    expect(paye.querySelector('.tk-remove__void')?.textContent).toBe('Void · approval');
    expect(paye.textContent).toContain('Void needs a manager');
    // no take-order: the not-started line offers nothing
    expect(dlg.querySelector('[data-line="B"] button')).toBeNull();
    v.click(paye.querySelector('.tk-remove__void'));
    await flush();
    expect(document.body.querySelector('.tk-remove')).toBeNull();
    expect(document.body.querySelector('.dlg')).not.toBeNull();
  });

  it('[05 §3.10, §6.9] paid: nothing comes off here — reopen the bill first; Bill opens it', async () => {
    const s = setup({
      views: { O48: view('O48', [sl('O48', 'A', 'Karahi', 'cooking')], { billed: true }) },
      bills: { O48: bill('B48', 'closed', 205_000) },
      grants: { 'take-order': { grant: 'allowed', scope: 'branch' }, 'void-item': { grant: 'allowed', scope: 'branch' } },
    });
    const v = await show(s, tok({ order_ids: ['O48'], newest_order_id: 'O48', paid: true }));
    v.click(v.button('Remove / cancel'));
    const dlg = document.body.querySelector<HTMLElement>('.tk-remove')!;
    expect(dlg.textContent).toContain('Paid: reopen the bill first');
    expect(dlg.querySelector('[data-line="A"] .tk-step button:not([disabled])')).toBeNull();
    v.click(v.button('Bill', dlg.querySelector('.tk-msg')!));
    expect(nav.to).toEqual(['/bill?order_id=O48']);
  });

  it('[02b §6.2; 04 §6.1; audit #15] every RemoveItems / VoidItems refusal has its own message', () => {
    const api = (status: number, code: string, details: Record<string, unknown> = {}) => ({ kind: 'api' as const, status, code, details });
    const remove = [api(400, 'VALIDATION_FAILED'), api(404, 'ORDER_NOT_FOUND'), api(409, 'ORDER_BILLED'), api(409, 'ITEM_WRONG_STAGE'), api(409, 'VOID_PENDING'), api(409, 'LINE_IN_CLOSED_SPLIT'), api(403, 'PERMISSION_DENIED')];
    const keys = remove.map((e) => orderErrorKey(e));
    expect(keys).toEqual(['tables.err.VALIDATION_FAILED', 'line.err.gone', 'line.err.billed', 'line.err.stage', 'void.err.VOID_PENDING', 'line.err.closed_split', 'tables.err.PERMISSION_DENIED']);
    // review 6: a line command's COMP_PENDING (an open comp request on the line) has its own message too
    expect(orderErrorKey(api(409, 'COMP_PENDING'))).toBe('void.err.COMP_PENDING');
    const voids = [...remove, api(409, 'COMP_PENDING'), api(409, 'VOID_NOT_ALLOWED', { reason: 'not_movable_stage' }), api(409, 'VOID_NOT_ALLOWED', { reason: 'something_new' })].map((e) => voidErrorText(e).key);
    expect(voids).toEqual([
      'void.err.VALIDATION_FAILED',
      'line.err.gone',
      'void.err.ORDER_BILLED',
      'line.err.stage',
      'void.err.VOID_PENDING',
      'line.err.closed_split',
      'tables.err.PERMISSION_DENIED',
      'void.err.COMP_PENDING',
      'void.block.not_movable_stage',
      'line.err.void_not_allowed',
    ]);
    for (const k of [...keys, ...voids]) expect(k).not.toMatch(/unknown/);
  });
});

