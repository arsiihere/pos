import { afterEach, describe, expect, it, vi } from 'vitest';
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

// ⚠️ 02b v1.0.28 §3.7a, §6.16, §8 (owner 2026-11-28 QA-R2), tests 100–102 (client):
// BUG-7  a token handed over in full while its bill is still Due leaves READY — HAND OVER: "Handed — owes Rs X";
// BUG-12 after a boost every counter time reads "Ready ~{new}", also once the bag is ready;
// BUG-27 an open request on the bill shows "Waiting for a manager…" before any tap, on every counter.

vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: true, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: () => {} }));

const NOW = at(13, 20);
const PICK = at(14, 0);
const PROMISE = at(14, 5);
const PLANNED = at(13, 35);
const DONE = at(13, 18);

const model = (rows: OpenOrder[]) => buildQueue(knownOrders(rows, new Map(), () => undefined), NOW);

let v: Mounted | null = null;
let book: TokenBook | null = null;
afterEach(() => {
  v?.unmount();
  v = null;
  book?.dispose();
  book = null;
  document.body.innerHTML = '';
});

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

async function rail(rows: OpenOrder[], caught: CatchUpOrder[]): Promise<Mounted> {
  const shell = railShell(rows, caught);
  book = createTokenBook(shell.live);
  v = mount();
  v.render(
    <ShellContext.Provider value={shell}>
      <QueueRail variant="column" book={book} selected={null} onOpen={() => {}} onHandOver={() => {}} heldCount={0} />
    </ShellContext.Provider>,
  );
  await flush();
  return v;
}

describe('[02b #100] BUG-7: handed over in full, still owing', () => {
  const handed = (o: Partial<OpenOrder> = {}) =>
    aRow({ order_id: 'O30', token: 30, ready: { n: 1, m: 1 }, handed: { n: 1, m: 1 }, bill: { state: 'due', due_minor: 3_000, key: 'takeaway:O30' }, unpaid_handover_approved: true, ...o });

  it('the model puts it under owes (with what it owes), never under ready; paid and handed → nowhere', () => {
    const m = model([handed(), aRow({ order_id: 'O31', token: 31, ready: { n: 1, m: 1 }, handed: { n: 0, m: 1 }, bill: { state: 'due', due_minor: 500 } })]);
    expect(m.ready.map((q) => q.token)).toEqual([31]);
    expect(m.owes.map((q) => [q.token, q.owed_minor])).toEqual([[30, 3_000]]);
    expect(model([handed({ bill: { state: 'paid', due_minor: 0 } })]).owes).toEqual([]);
    // one bill of two orders owes its due once
    const two = model([handed(), handed({ order_id: 'O30b', placed_at: at(13, 5) })]);
    expect(two.owes[0]!.owed_minor).toBe(3_000);
  });

  it('the rail shows it under "Handed — owes" as "Handed — owes Rs 30", no Hand over, not in READY — HAND OVER', async () => {
    const m = await rail([handed()], [aCaught('O30', 30, [aLine('O30', 'A', 'Lassi', { served_at: at(13, 10) })])]);
    expect(m.container.querySelector('.tk-rt[data-token$=":30"]')).toBeNull();
    const row = m.container.querySelector<HTMLElement>('[data-owes] [data-token$=":30"]')!;
    expect(m.container.querySelector('[data-owes] .tk-sec')?.textContent).toContain('Handed — owes');
    expect(row.textContent).toContain('Handed — owes Rs 30');
    expect(row.textContent).not.toContain('Hand over');
  });
});

describe('[02b #101] BUG-12: one counter clock after a boost', () => {
  const boosted = (o: Partial<OpenOrder> = {}) =>
    aRow({ order_id: 'O60', token: 60, promise_ms: PROMISE, pickup_at_ms: PICK, effective_pickup_at_ms: null, planned_ready_at_ms: PLANNED, ...o });

  it('plannedReadyOf keeps the boosted time once the bag is ready (the hub sends the latest done time)', () => {
    expect(plannedReadyOf([boosted({ ready: { n: 2, m: 2 }, planned_ready_at_ms: DONE })])).toBe(DONE);
    // a not-boosted ready addition does not block the boosted root's time
    expect(plannedReadyOf([boosted({ ready: { n: 2, m: 2 }, planned_ready_at_ms: DONE }), aRow({ order_id: 'O61', token: 60, ready: { n: 1, m: 1 }, planned_ready_at_ms: null })])).toBe(DONE);
    // a not-boosted order still cooking → the promise
    expect(plannedReadyOf([boosted(), aRow({ order_id: 'O62', token: 60, ready: { n: 0, m: 1 }, planned_ready_at_ms: at(13, 40) })])).toBeNull();
  });

  it('the ready tile of a boosted, ready token keeps "Ready ~" (not the promise)', async () => {
    const m = await rail([boosted({ ready: { n: 2, m: 2 }, planned_ready_at_ms: DONE, bill: { state: 'paid', due_minor: 0 } })], [aCaught('O60', 60, [aLine('O60', 'A', 'Karahi')])]);
    expect(model([boosted({ ready: { n: 2, m: 2 }, planned_ready_at_ms: DONE })]).ready[0]!.planned_ready_at_ms).toBe(DONE);
    expect(m.container.querySelector('.tk-rt')).not.toBeNull();
  });

  it('the token drawer\'s line rows read "Ready ~1:35 PM" like its header, not "Ready by 2:05 PM"', async () => {
    const q: QueueToken = { key: '2026-11-24:60', token: 60, order_ids: ['O60'], newest_order_id: 'O60', customer_name: null, phone: null, placed_at: at(13, 0), promise_ms: PROMISE, ready: { n: 0, m: 2 }, paid: false, part: false, summary: '', pickup_at_ms: PICK, effective_pickup_at_ms: null, pickup_order_ids: [], planned_ready_at_ms: PLANNED };
    const h = screenHarness({ views: { O60: { ...view('O60', [sl('O60', 'A', 'Karahi', 'cooking')]), promise_ms: PROMISE } }, bills: {} });
    (h.shell.orders as { openOrders: unknown }).openOrders = vi.fn(async () => ({ ok: true, data: { orders: [boosted({ ready: { n: 0, m: 1 } })] } }));
    book = createTokenBook(h.shell.live);
    v = mount();
    v.render(
      <ShellContext.Provider value={h.shell}>
        <TokenView token={q} book={book} onClose={() => {}} onHandOver={() => {}} />
      </ShellContext.Provider>,
    );
    await flush();
    const plain = v.text().replace(/[\u200e\u200f\u2066-\u2069]/g, '');
    const rows = [...v.container.querySelectorAll('.tk-il')].map((r) => (r.textContent ?? '').replace(/[\u200e\u200f\u2066-\u2069]/g, ''));
    expect(plain).toContain('Ready ~1:35 PM');
    expect(rows.join(' | ')).not.toContain('Ready by 2:05 PM');
    expect(rows.some((r) => r.includes('Ready ~1:35 PM'))).toBe(true);
  });
});

describe('[02b #102] BUG-27: a pending request shows on every counter before a tap', () => {
  it('a Due ready tile whose row says unpaid_handover_pending reads "Waiting for a manager…", not "Ask a manager"', async () => {
    const row = aRow({ order_id: 'O40', token: 40, ready: { n: 1, m: 1 }, handed: { n: 0, m: 1 }, bill: { state: 'due', due_minor: 900, key: 'takeaway:O40' }, unpaid_handover_approved: false, unpaid_handover_pending: true });
    const m = await rail([row], [aCaught('O40', 40, [aLine('O40', 'A', 'Lassi')])]);
    const tile = m.container.querySelector<HTMLElement>('.tk-rt')!;
    expect(tile.textContent).toContain('Waiting for a manager');
    expect(tile.textContent).not.toContain('Ask a manager');
  });
});
