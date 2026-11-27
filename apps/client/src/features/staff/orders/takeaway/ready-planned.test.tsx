import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../../../../i18n';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import { createPermissions } from '../../shell/permissions';
import { createToastBus } from '../../shell/toast';
import type { CatchUpOrder, OpenOrder } from '../contracts';
import { createTokenBook, type TokenBook } from './book';
import { buildQueue, knownOrders, plannedReadyOf, type QueueToken } from './queue-model';
import { QueueRail } from './QueueRail';
import { screenHarness, sl, view } from './screen-harness';
import { aCaught, aLine, aRow, at } from './test-fixtures';
import { TokenView } from './TokenView';

// ⚠️ 02b v1.0.25 §6.16 row `planned_ready_at_ms` (owner ruling BR-1, 2026-11-27); 03a v1.2.11 PK-5: once a pickup
// token is boosted (Customer is here: the effective pickup null, the pickup kept) and the engine's planned ready time is
// earlier than the stored promise, the token view, the queue row and the ready tile show "Ready ~{planned}" with the
// promise struck through beside it; otherwise the promise as before. A token of several orders: the latest planned of
// its orders not yet ready, only when every one of them is boosted with a planned time.

vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: true, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: () => {} }));

const NOW = at(13, 20);
const PICK = at(14, 0);
const PROMISE = at(14, 5); // the pickup + the takeaway padding (stored, never changes: PK-5)
const PLANNED = at(13, 35);

/** A pickup order: boosted (effective pickup null) unless said otherwise. */
const pickupRow = (order_id: string, token: number, o: Partial<OpenOrder> = {}) =>
  aRow({ order_id, token, ready: { n: 0, m: 2 }, promise_ms: PROMISE, pickup_at_ms: PICK, effective_pickup_at_ms: null, planned_ready_at_ms: PLANNED, ...o });

const model = (rows: OpenOrder[]) => buildQueue(knownOrders(rows, new Map(), () => undefined), NOW);
const one = (rows: OpenOrder[]) => [...model(rows).ready, ...model(rows).cooking, ...model(rows).later][0]!;

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

describe('[02b §6.16 BR-1] the queue model', () => {
  it('boosted + planned earlier than the promise → the token carries it; otherwise null', () => {
    expect(one([pickupRow('O60', 60)]).planned_ready_at_ms).toBe(PLANNED);
    // not boosted (still waiting for its pickup), or no pickup at all
    expect(one([pickupRow('O60', 60, { effective_pickup_at_ms: PICK })]).planned_ready_at_ms).toBeNull();
    expect(one([pickupRow('O60', 60, { pickup_at_ms: null, effective_pickup_at_ms: null })]).planned_ready_at_ms).toBeNull();
    // planned unknown, absent (older hub), equal to or after the promise
    expect(one([pickupRow('O60', 60, { planned_ready_at_ms: null })]).planned_ready_at_ms).toBeNull();
    expect(one([pickupRow('O60', 60, { planned_ready_at_ms: undefined })]).planned_ready_at_ms).toBeNull();
    expect(one([pickupRow('O60', 60, { planned_ready_at_ms: PROMISE })]).planned_ready_at_ms).toBeNull();
    expect(one([pickupRow('O60', 60, { planned_ready_at_ms: at(14, 10) })]).planned_ready_at_ms).toBeNull();
  });

  it('several orders: the latest planned of the orders not yet ready, only when each is boosted with a planned time', () => {
    const root = pickupRow('O70', 70, { placed_at: at(13, 0) });
    const later = pickupRow('O71', 70, { placed_at: at(13, 5), planned_ready_at_ms: at(13, 42) });
    expect(plannedReadyOf([root, later])).toBe(at(13, 42));
    // an addition with no pickup (not boosted) still cooking → the promise
    expect(plannedReadyOf([root, aRow({ order_id: 'O72', token: 70, placed_at: at(13, 6), promise_ms: at(13, 50), planned_ready_at_ms: at(13, 45) })])).toBeNull();
    // a ready addition does not count (its planned is null: every line ready)
    expect(plannedReadyOf([root, aRow({ order_id: 'O73', token: 70, ready: { n: 1, m: 1 }, planned_ready_at_ms: null })])).toBe(PLANNED);
    // every order ready → nothing to plan
    expect(plannedReadyOf([pickupRow('O74', 74, { ready: { n: 2, m: 2 }, planned_ready_at_ms: null })])).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------ the rail

function railShell(rows: OpenOrder[], caught: CatchUpOrder[]): Shell {
  const live = createLiveBus();
  live.frame({ type: 'catch_up', as_of_seq: 1, state: { orders: { orders: caught, zone_stock: [] } } });
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

const RAIL_ROWS: OpenOrder[] = [
  pickupRow('O60', 60),
  pickupRow('O61', 61, { effective_pickup_at_ms: PICK, pickup_at_ms: at(13, 10) }), // elapsed, not boosted: the promise
  pickupRow('O62', 62, { planned_ready_at_ms: null }),
  // part given: one line handed over, the rest cooking, boosted → the tile reads "Part given · rest Ready ~…"
  pickupRow('O63', 63, { ready: { n: 1, m: 2 } }),
];
const RAIL_CAUGHT: CatchUpOrder[] = [
  aCaught('O60', 60, [aLine('O60', 'O60a', 'Karahi')]),
  aCaught('O61', 61, [aLine('O61', 'O61a', 'Karahi')]),
  aCaught('O62', 62, [aLine('O62', 'O62a', 'Karahi')]),
  aCaught('O63', 63, [aLine('O63', 'O63a', 'Naan', { served_at: at(13, 15) }), aLine('O63', 'O63b', 'Karahi')]),
];

async function rail(): Promise<Mounted> {
  const shell = railShell(RAIL_ROWS, RAIL_CAUGHT);
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
const tileOf = (m: Mounted, token: number) => [...m.container.querySelectorAll<HTMLElement>('.tk-rt')].find((r) => r.querySelector('.tok')?.textContent === String(token))!;

describe('[02b §6.16 BR-1] the queue row and the ready tile', () => {
  it('a boosted row: "Ready ~1:35 PM" with the promise 2:05 PM struck through; not boosted or no planned → the promise only', async () => {
    const m = await rail();
    const boosted = rowOf(m, 60);
    expect(boosted.querySelector('[data-planned]')?.textContent).toBe('Ready ~1:35 PM');
    expect(boosted.querySelector('s')?.textContent).toBe('2:05 PM');
    for (const token of [61, 62]) {
      const row = rowOf(m, token);
      expect(row.querySelector('[data-planned]'), String(token)).toBeNull();
      expect(row.querySelector('s'), String(token)).toBeNull();
      expect(row.querySelector('.tk-qr__r .time')?.textContent).toBe('2:05 PM');
    }
  });

  it('a part-given ready tile: "Part given · rest Ready ~1:35 PM" with the promise struck through', async () => {
    const m = await rail();
    const tile = tileOf(m, 63);
    expect(tile.className).toContain('tk-rt--part');
    expect(tile.querySelector('[data-planned]')?.textContent).toBe('Ready ~1:35 PM');
    expect(tile.querySelector('s')?.textContent).toBe('2:05 PM');
  });

  it('Urdu', async () => {
    setLanguage('ur');
    const m = await rail();
    const planned = rowOf(m, 60).querySelector('[data-planned]')?.textContent ?? '';
    expect(planned).toContain('تقریباً');
    expect(planned).toContain('1:35 PM');
    expect(rowOf(m, 60).querySelector('s')?.textContent).toBe('2:05 PM');
  });
});

// ------------------------------------------------------------------------------------------ the token view

describe('[02b §6.16 BR-1] the token view', () => {
  const token = (o: Partial<QueueToken> = {}): QueueToken => ({ key: '2026-11-24:60', token: 60, order_ids: ['O60'], newest_order_id: 'O60', customer_name: null, phone: null, placed_at: at(13, 0), promise_ms: PROMISE, ready: { n: 0, m: 2 }, paid: false, part: false, summary: '', pickup_at_ms: PICK, effective_pickup_at_ms: PICK, pickup_order_ids: ['O60'], ...o });
  const promiseView = () => ({ ...view('O60', [sl('O60', 'A', 'Karahi', 'added'), sl('O60', 'B', 'Lassi', 'added')]), promise_ms: PROMISE });

  const open = async (rows: () => OpenOrder[], q: QueueToken = token()) => {
    const h = screenHarness({ views: { O60: promiseView() }, bills: { O60: { bill_id: null, state: 'projected', splits: [], totals_default: { total_minor: 4_000 } } }, grants: { 'boost-order': { grant: 'allowed', scope: 'branch' } } });
    (h.shell.orders as { openOrders: unknown }).openOrders = vi.fn(async () => ({ ok: true, data: { orders: rows() } }));
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
  const readyFact = (m: Mounted) => m.container.querySelector<HTMLElement>('.tk-facts .tk-fact')!;
  const here = (m: Mounted) => [...m.container.querySelectorAll<HTMLButtonElement>('.tk-drawer button')].find((b) => b.textContent?.includes('Customer is here')) ?? null;

  it('before Customer is here the promise; after it (the refetch reads the boosted row) "Ready ~1:35 PM" with 2:05 PM struck through', async () => {
    let boosted = false;
    const { m } = await open(() => [pickupRow('O60', 60, boosted ? {} : { effective_pickup_at_ms: PICK, planned_ready_at_ms: at(13, 58) })]);
    expect(readyFact(m).querySelector('[data-planned]')).toBeNull();
    expect(readyFact(m).querySelector('s')).toBeNull();
    expect(readyFact(m).querySelector('b')?.textContent).toBe('2:05 PM');
    boosted = true;
    m.click(here(m));
    await flush();
    expect(readyFact(m).querySelector('small')?.textContent).toBe('Ready by');
    expect(readyFact(m).querySelector('[data-planned]')?.textContent).toBe('Ready ~1:35 PM');
    expect(readyFact(m).querySelector('s')?.textContent).toBe('2:05 PM');
    // Hand over all (not all ready) carries the same time
    const handOver = [...m.container.querySelectorAll('.tk-drawer button')].find((b) => b.textContent?.startsWith('Hand over all'))!;
    expect(handOver.querySelector('[data-planned]')?.textContent).toBe('Ready ~1:35 PM');
    expect(handOver.querySelector('s')?.textContent).toBe('2:05 PM');
  });

  it('boosted but planned null or not earlier → the promise only; the row unread falls back to the token\'s value', async () => {
    for (const planned of [null, PROMISE, at(14, 20)]) {
      const { m } = await open(() => [pickupRow('O60', 60, { planned_ready_at_ms: planned })], token({ effective_pickup_at_ms: null, pickup_order_ids: [] }));
      expect(readyFact(m).querySelector('[data-planned]'), String(planned)).toBeNull();
      expect(readyFact(m).querySelector('b')?.textContent).toBe('2:05 PM');
      m.unmount();
      v = null;
    }
    // open-orders does not list the order (or the read failed): the rail's token value
    const { m } = await open(() => [], token({ effective_pickup_at_ms: null, pickup_order_ids: [], planned_ready_at_ms: PLANNED }));
    expect(readyFact(m).querySelector('[data-planned]')?.textContent).toBe('Ready ~1:35 PM');
  });

  it('Urdu', async () => {
    setLanguage('ur');
    const { m } = await open(() => [pickupRow('O60', 60)], token({ effective_pickup_at_ms: null, pickup_order_ids: [] }));
    const planned = readyFact(m).querySelector('[data-planned]')?.textContent ?? '';
    expect(planned).toContain('تقریباً');
    expect(planned).toContain('1:35 PM');
    expect(readyFact(m).querySelector('s')?.textContent).toBe('2:05 PM');
  });
});
