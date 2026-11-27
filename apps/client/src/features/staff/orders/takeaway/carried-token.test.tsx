import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../../../../i18n';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import { createPermissions } from '../../shell/permissions';
import { createToastBus } from '../../shell/toast';
import type { OpenOrder } from '../contracts';
import { createTokenBook, type TokenBook } from './book';
import { buildQueue, knownOrders, type QueueToken } from './queue-model';
import { carriedLabel, QueueRail } from './QueueRail';
import { screenHarness, sl, view } from './screen-harness';
import { aCaught, aLine, aRow, at } from './test-fixtures';
import { TokenView } from './TokenView';

// ⚠️ 02b-TK L-CLIENT-5 item 3 (02b v1.0.25 §3.3 Day close: a carried order "is shown under the next day with its date
// beside its token" ("57 · 6 Nov"); ruling DC-2; §6.16 `from_date`): on the counter a token whose order's business date
// is not the open day's shows its date beside the number — the queue rail's rows and ready tiles and the token view's
// header — in the hub-local date the open-orders list uses ("27 Nov", Urdu month names). Today's token is unchanged;
// the number itself stays the bare token.

vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: true, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: () => {} }));

const ROWS: OpenOrder[] = [
  aRow({ order_id: 'O57', token: 57, business_date: '2026-11-23', from_date: '2026-11-23', ready: { n: 0, m: 1 } }),
  aRow({ order_id: 'O58', token: 58, business_date: '2026-11-23', from_date: '2026-11-23', ready: { n: 1, m: 1 }, bill: { state: 'paid', due_minor: 0 } }),
  aRow({ order_id: 'O12', token: 12, ready: { n: 0, m: 1 } }),
];

let v: Mounted | null = null;
let book: TokenBook | null = null;
afterEach(() => {
  v?.unmount();
  v = null;
  book?.dispose();
  book = null;
  setLanguage('en');
  document.body.innerHTML = '';
});

describe('[02b-TK L-CLIENT-5 item 3; 02b §3.3, §6.16; DC-2] the carried token', () => {
  it('[§6.16 from_date] the model keeps the token\'s carried date; today\'s token has none', () => {
    const m = buildQueue(knownOrders(ROWS, new Map(), () => undefined));
    const all = [...m.ready, ...m.cooking];
    expect(all.find((q) => q.token === 57)!.from_date).toBe('2026-11-23');
    expect(all.find((q) => q.token === 12)!.from_date).toBeNull();
  });

  it('[§3.3 "57 · 6 Nov"] the label', () => {
    expect(carriedLabel({ token: 57, from_date: '2026-11-23' })).toBe('57 · 23 Nov');
    expect(carriedLabel({ token: 57, from_date: null })).toBeNull();
    setLanguage('ur');
    expect(carriedLabel({ token: 57, from_date: '2026-11-23' })).toBe('57 · 23 نومبر');
  });

  async function rail(): Promise<Mounted> {
    const live = createLiveBus();
    live.frame({ type: 'catch_up', as_of_seq: 1, state: { orders: { orders: ROWS.map((r) => aCaught(r.order_id, r.token!, [aLine(r.order_id, `${r.order_id}a`, 'Karahi')], { business_date: r.business_date })), zone_stock: [] } } });
    const shell = {
      api: { query: vi.fn(async () => ({ ok: false, error: { kind: 'network' } })), page: vi.fn(), command: vi.fn() },
      device: { token: 'D', id: 'dev-1', type: 'cashier_kiosk' },
      orders: { openOrders: vi.fn(async () => ({ ok: true, data: { orders: ROWS } })), orderContact: vi.fn() },
      live,
      permissions: createPermissions({}),
      toasts: createToastBus(),
      enqueue: Object.assign(async () => ({ status: 'needs_hub' }), { pendingFor: () => 0, pendingCount: () => 0, subscribe: () => () => {} }),
      clock: { nowMs: () => at(13, 20), utcOffsetMs: 0 },
      me: { staff_id: 'sana', name: 'Sana' },
      online: true,
      phone: false,
      portrait: false,
    } as unknown as Shell;
    book = createTokenBook(shell.live);
    v = mount();
    v.render(
      <ShellContext.Provider value={shell}>
        <QueueRail variant="column" book={book} selected={null} onOpen={() => {}} heldCount={0} />
      </ShellContext.Provider>,
    );
    await flush();
    return v;
  }

  it('[§3.3; DC-2] a carried row and ready tile show "57 · 23 Nov" beside the bare token; today\'s row shows none', async () => {
    const m = await rail();
    const row = (t: number) => [...m.container.querySelectorAll<HTMLElement>('.tk-qr')].find((r) => r.querySelector('.tk-tok')?.textContent === String(t))!;
    expect(row(57).querySelector('[data-carried]')?.textContent).toBe('57 · 23 Nov');
    expect(row(12).querySelector('[data-carried]')).toBeNull();
    const tile = [...m.container.querySelectorAll<HTMLElement>('.tk-rt')].find((x) => x.querySelector('.tok')?.textContent === '58')!;
    expect(tile.querySelector('[data-carried]')?.textContent).toBe('58 · 23 Nov');
  });

  it('[§3.3] Urdu month', async () => {
    setLanguage('ur');
    const m = await rail();
    expect(m.container.querySelector('.tk-qr [data-carried]')?.textContent).toBe('57 · 23 نومبر');
  });

  it('[§3.3] the token view header', async () => {
    const q: QueueToken = { key: '2026-11-23:57', token: 57, order_ids: ['O57'], newest_order_id: 'O57', customer_name: null, phone: null, placed_at: at(13, 0), promise_ms: null, ready: { n: 0, m: 1 }, paid: false, part: false, summary: '', from_date: '2026-11-23' };
    const h = screenHarness({ views: { O57: view('O57', [sl('O57', 'A', 'Karahi', 'cooking')]) } });
    book = createTokenBook(h.shell.live);
    v = mount();
    v.render(
      <ShellContext.Provider value={h.shell}>
        <TokenView token={q} book={book} onClose={() => {}} onHandOver={() => {}} />
      </ShellContext.Provider>,
    );
    await flush();
    expect(v.container.querySelector('.tk-drawer__h [data-carried]')?.textContent).toBe('57 · 23 Nov');
    expect(v.container.querySelector('.tk-tv__tok')?.textContent).toBe('57');
  });
});
