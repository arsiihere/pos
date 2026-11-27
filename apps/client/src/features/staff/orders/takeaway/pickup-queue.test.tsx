import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../../../../i18n';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import { createPermissions } from '../../shell/permissions';
import { createToastBus } from '../../shell/toast';
import type { CatchUpOrder, OpenOrder } from '../contracts';
import { createTokenBook, type TokenBook } from './book';
import { buildQueue, knownOrders, type QueueToken } from './queue-model';
import { QueueRail } from './QueueRail';
import { screenHarness, sl, view } from './screen-harness';
import { aCaught, aLine, aRow, at } from './test-fixtures';
import { TokenView } from './TokenView';

// ⚠️ 02b-TK L-CLIENT-5 item 1 (02b v1.0.25 §6.16 `pickup_at_ms` / `effective_pickup_at_ms` (R3-M-1), §8 (02b-R4-3:
// the "later" grouping uses `effective_pickup_at_ms`, the original time is kept after a boost); D1; frame PickupLater
// "Phone orders — later"): a pickup token sits under Phone orders — later while its effective pickup is ahead of hub
// now and it is not ready; once elapsed or boosted it is in the now queue with its real promise. Its row, tile and the
// token view show "Pickup 2:00 PM" (kept after a boost, D1).

vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: true, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: () => {} }));

const NOW = at(13, 20);
const PICK = at(14, 0);
const ROWS: OpenOrder[] = [
  aRow({ order_id: 'O53', token: 53, promise_ms: at(13, 31) }),
  aRow({ order_id: 'O60', token: 60, promise_ms: PICK, pickup_at_ms: PICK, effective_pickup_at_ms: PICK }),
  // boosted (D1): the pickup kept, the effective one null → the now queue, its real promise
  aRow({ order_id: 'O61', token: 61, promise_ms: at(13, 40), pickup_at_ms: at(14, 30), effective_pickup_at_ms: null }),
  // elapsed: in the now queue
  aRow({ order_id: 'O62', token: 62, promise_ms: at(13, 35), pickup_at_ms: at(13, 10), effective_pickup_at_ms: at(13, 10) }),
];
const CAUGHT: CatchUpOrder[] = ROWS.map((r) => aCaught(r.order_id, r.token!, [aLine(r.order_id, `${r.order_id}a`, 'Karahi')]));

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

const tokens = (list: QueueToken[]) => list.map((q) => q.token);

describe('[02b-TK L-CLIENT-5 item 1; 02b §6.16, §8] the queue model', () => {
  it('[§8 02b-R4-3, R3-M-1] Phone orders — later holds the tokens whose effective pickup is ahead; boosted and elapsed are in the now queue', () => {
    const m = buildQueue(knownOrders(ROWS, new Map(), () => undefined), NOW);
    expect(tokens(m.later)).toEqual([60]);
    expect(tokens(m.cooking)).toEqual([62, 61, 53]); // L-CLIENT-6a item 4: Cooking newest first
    const later = m.later[0]!;
    expect([later.pickup_at_ms, later.effective_pickup_at_ms]).toEqual([PICK, PICK]);
    const boosted = m.cooking.find((q) => q.token === 61)!;
    expect([boosted.pickup_at_ms, boosted.effective_pickup_at_ms]).toEqual([at(14, 30), null]);
    // the same model a little later: 60's pickup passed → the now queue
    expect(tokens(buildQueue(knownOrders(ROWS, new Map(), () => undefined), PICK).later)).toEqual([]);
  });

  it('[§6.16] a ready pickup token is Ready — hand over, not later; an older hub (no fields) has no pickup', () => {
    const ready = aRow({ order_id: 'O63', token: 63, ready: { n: 2, m: 2 }, pickup_at_ms: PICK, effective_pickup_at_ms: PICK });
    const m = buildQueue(knownOrders([ready, aRow({ order_id: 'O64', token: 64 })], new Map(), () => undefined), NOW);
    expect(tokens(m.ready)).toEqual([63]);
    expect(m.later).toEqual([]);
    expect(m.cooking[0]!.pickup_at_ms).toBeNull();
  });
});

function railShell(rows: OpenOrder[]): Shell {
  const live = createLiveBus();
  live.frame({ type: 'catch_up', as_of_seq: 1, state: { orders: { orders: CAUGHT, zone_stock: [] } } });
  return {
    api: { query: vi.fn(async () => ({ ok: false, error: { kind: 'network' } })), page: vi.fn(), command: vi.fn() },
    device: { token: 'D', id: 'dev-1', type: 'cashier_kiosk' },
    orders: { openOrders: vi.fn(async () => ({ ok: true, data: { orders: rows } })), orderContact: vi.fn() },
    live,
    permissions: createPermissions({}),
    toasts: createToastBus(),
    enqueue: Object.assign(async () => ({ status: 'needs_hub' }), { pendingFor: () => 0, pendingCount: () => 0, subscribe: () => () => {} }),
    clock: { nowMs: () => NOW, utcOffsetMs: 0 },
    me: { staff_id: 'sana', name: 'Sana' },
    online: true,
    phone: false,
    portrait: false,
  } as unknown as Shell;
}

async function rail(rows: OpenOrder[]): Promise<Mounted> {
  const shell = railShell(rows);
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
const rowOf = (m: Mounted, token: number) => [...m.container.querySelectorAll<HTMLElement>('.tk-qr')].find((r) => r.querySelector('.tk-tok')?.textContent === String(token))!;

describe('[02b-TK L-CLIENT-5 item 1; frame PickupLater] the rail', () => {
  it('[frame PickupLater] Phone orders — later (2) with the pickup row; a boosted token keeps "Pickup 2:30 PM" in Cooking (D1)', async () => {
    const m = await rail(ROWS);
    const secs = [...m.container.querySelectorAll('.tk-sec')].map((s) => s.textContent);
    expect(secs.some((s) => s?.startsWith('Phone orders — later') && s.endsWith('1'))).toBe(true);
    // the later row comes after the Phone orders — later head
    const head = [...m.container.querySelectorAll('.tk-sec')].find((s) => s.textContent?.startsWith('Phone orders — later'))!;
    expect(head.compareDocumentPosition(rowOf(m, 60)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rowOf(m, 60).querySelector('[data-pickup]')?.textContent).toBe('Pickup 2:00 PM');
    expect(rowOf(m, 61).querySelector('[data-pickup]')?.textContent).toBe('Pickup 2:30 PM');
    expect(rowOf(m, 53).querySelector('[data-pickup]')).toBeNull();
    // the token itself stays the bare number (the e2e finds it so)
    expect(rowOf(m, 60).querySelector('.tk-tok')?.textContent).toBe('60');
    // L-CLIENT-6a item 12 (frame HomeKiosk): a phone order for later shows the phone with its token; Cooking does not
    expect(rowOf(m, 60).querySelector('.tk-tok--phone .ico')).not.toBeNull();
    expect(rowOf(m, 53).querySelector('.tk-tok--phone')).toBeNull();
  });

  it('[frame PickupLaterUrdu] Urdu', async () => {
    setLanguage('ur');
    const m = await rail(ROWS);
    expect(m.text()).toContain('فون آرڈر — بعد میں');
    expect(rowOf(m, 60).querySelector('[data-pickup]')?.textContent).toContain('کب لیں گے');
    expect(rowOf(m, 60).querySelector('[data-pickup]')?.textContent).toContain('2:00 PM');
  });
});

describe('[02b-TK L-CLIENT-5 item 1; 02b §8 token view] the token view', () => {
  const token = (o: Partial<QueueToken>): QueueToken => ({ key: '2026-11-24:60', token: 60, order_ids: ['O60'], newest_order_id: 'O60', customer_name: null, phone: null, placed_at: at(13, 0), promise_ms: PICK, ready: { n: 0, m: 1 }, paid: false, part: false, summary: '', pickup_at_ms: PICK, effective_pickup_at_ms: PICK, ...o });

  const open = async (q: QueueToken) => {
    const h = screenHarness({ views: { O60: view('O60', [sl('O60', 'A', 'Karahi', 'added')]) }, bills: { O60: { bill_id: null, state: 'projected', splits: [], totals_default: { total_minor: 4_000 } } } });
    book = createTokenBook(h.shell.live);
    v = mount();
    v.render(
      <ShellContext.Provider value={h.shell}>
        <TokenView token={q} book={book} onClose={() => {}} onHandOver={() => {}} />
      </ShellContext.Provider>,
    );
    await flush();
    return v;
  };

  it('[§8; D1] a pickup token shows the Pickup fact; a boosted one keeps it; none without a pickup', async () => {
    let m = await open(token({}));
    expect(m.container.querySelector('.tk-facts [data-pickup]')?.textContent).toContain('Pickup');
    expect(m.container.querySelector('.tk-facts [data-pickup]')?.textContent).toContain('2:00 PM');
    m.unmount();
    v = null;
    m = await open(token({ effective_pickup_at_ms: null }));
    expect(m.container.querySelector('.tk-facts [data-pickup]')?.textContent).toContain('2:00 PM');
    m.unmount();
    v = null;
    m = await open(token({ pickup_at_ms: null, effective_pickup_at_ms: null }));
    expect(m.container.querySelector('.tk-facts [data-pickup]')).toBeNull();
  });
});

// ⚠️ 02b-TK L-CLIENT-5 item 2 (02b v1.0.25 §3.8, §6.6, §8 (02b-R4-3: "Customer is here — cook now" = BoostOrder);
// 03a v1.2.11 §3.5.8 PK-5; D1; T1 #8): the token view of a pickup token not yet boosted offers Customer is here; it
// sends BoostOrder { order_id } for each of the token's orders still waiting for its pickup (boost-order, online only:
// not queueable), then shows the token as boosted (no button), the pickup time still shown; whole-bag readiness stays.
describe('[02b-TK L-CLIENT-5 item 2; 02b §6.6, §8] Customer is here', () => {
  const token = (o: Partial<QueueToken>): QueueToken => ({ key: '2026-11-24:60', token: 60, order_ids: ['O60'], newest_order_id: 'O60', customer_name: null, phone: null, placed_at: at(13, 0), promise_ms: PICK, ready: { n: 0, m: 2 }, paid: false, part: false, summary: '', pickup_at_ms: PICK, effective_pickup_at_ms: PICK, pickup_order_ids: ['O60'], ...o });
  const lines = [sl('O60', 'A', 'Karahi', 'done'), sl('O60', 'B', 'Lassi', 'added')];

  const open = async (q: QueueToken, o: { grants?: Record<string, unknown>; online?: boolean; command?: (type: string, payload: unknown) => unknown } = {}) => {
    const h = screenHarness({ views: { O60: view('O60', lines) }, bills: { O60: { bill_id: null, state: 'projected', splits: [], totals_default: { total_minor: 4_000 } } }, grants: { 'boost-order': { grant: 'allowed', scope: 'branch' }, ...(o.grants ?? {}) }, ...(o.online === undefined ? {} : { online: o.online }), ...(o.command === undefined ? {} : { command: o.command }) });
    book = createTokenBook(h.shell.live);
    v = mount();
    v.render(
      <ShellContext.Provider value={h.shell}>
        <TokenView token={q} book={book} onClose={() => {}} onHandOver={() => {}} />
      </ShellContext.Provider>,
    );
    await flush();
    return { h, m: v };
  };
  const here = (m: Mounted) => [...m.container.querySelectorAll<HTMLButtonElement>('.tk-drawer button')].find((b) => b.textContent?.includes('Customer is here')) ?? null;

  it('[§8 02b-R4-3, §6.6] a pickup token offers it; a tap sends BoostOrder { order_id }; then no button, the Pickup fact stays (D1)', async () => {
    const { h, m } = await open(token({}));
    expect(here(m)?.textContent).toBe('Customer is here — cook now');
    m.click(here(m));
    await flush();
    expect(h.commands.filter((c) => c.type === 'BoostOrder').map((c) => c.payload)).toEqual([{ order_id: 'O60' }]);
    expect(h.toasts.at(-1)?.text).toBe('The kitchen cooks it now');
    expect(here(m)).toBeNull();
    expect(m.container.querySelector('.tk-facts [data-pickup]')?.textContent).toContain('2:00 PM');
  });

  it('[D1; 03a PK-5] whole-bag readiness stays: the Karahi done, the Lassi still to make → Hand over all is not offered as ready', async () => {
    const { m } = await open(token({}));
    m.click(here(m));
    await flush();
    const handOver = [...m.container.querySelectorAll('.tk-drawer button')].find((b) => b.textContent?.startsWith('Hand over all'));
    expect(handOver === undefined || handOver.getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('[D1] none on a boosted token (effective pickup null), on a token without a pickup, without boost-order, or offline', async () => {
    for (const [q, o] of [
      [token({ effective_pickup_at_ms: null, pickup_order_ids: [] }), {}],
      [token({ pickup_at_ms: null, effective_pickup_at_ms: null, pickup_order_ids: [] }), {}],
      [token({}), { grants: { 'boost-order': { grant: 'not_granted', scope: 'branch' } } }],
      [token({}), { online: false }],
    ] as const) {
      const { m } = await open(q, o);
      expect(here(m)).toBeNull();
      m.unmount();
      v = null;
    }
  });

  it('[§6.6 errors] ORDER_NOT_IN_ENGINE says so and keeps the button', async () => {
    const { h, m } = await open(token({}), { command: (type) => (type === 'BoostOrder' ? { ok: false, error: { kind: 'api', status: 409, code: 'ORDER_NOT_IN_ENGINE', details: {} } } : undefined) });
    m.click(here(m));
    await flush();
    expect(h.toasts.at(-1)?.tone).toBe('warn');
    expect(here(m)).not.toBeNull();
  });

  it('[§8] Urdu', async () => {
    setLanguage('ur');
    const { m } = await open(token({}));
    expect([...m.container.querySelectorAll('.tk-drawer button')].some((b) => b.textContent === 'گاہک آ گیا — ابھی بنائیں')).toBe(true);
  });

  it('[§6.16] the model names the token\'s orders still waiting for a pickup', () => {
    const rows = [aRow({ order_id: 'O70', token: 70, pickup_at_ms: PICK, effective_pickup_at_ms: PICK }), aRow({ order_id: 'O71', token: 70, placed_at: at(13, 5), pickup_at_ms: PICK, effective_pickup_at_ms: null })];
    expect(buildQueue(knownOrders(rows, new Map(), () => undefined), NOW).later[0]!.pickup_order_ids).toEqual(['O70']);
  });
});
