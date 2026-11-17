import type { BranchConfig } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, mount } from '../../../../../test/dom';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import type { Permission, Scope } from '@pos/domain';
import type { EnqueueResult } from '../../tables/contracts';
import type { Draft } from '../contracts';
import { createMemoryDraftStore } from '../drafts/memory-drafts';
import { Held } from './Held';
import { DraftStoreContext, OrderScreen } from './OrderScreen';

vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: true, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));
const nav = vi.hoisted(() => ({ to: [] as string[] }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: (p: string) => nav.to.push(p) }));

const T = Date.UTC(2025, 9, 20, 15);

function cfg(): BranchConfig {
  const base = aBranchConfig();
  return { ...base, items: [...base.items, { ...base.items.find((i) => i.item_id === 'I2')!, item_id: 'I5', name: 'Naan', price_minor: 4_000 }] };
}

function shellWith(o: { answer?: EnqueueResult; grants?: Partial<Record<Permission, Scope>>; me?: string; phone?: boolean; live?: ReturnType<typeof createLiveBus>; rounds?: number }) {
  const config = cfg();
  const grants = o.grants ?? {};
  const enqueue = Object.assign(async () => o.answer ?? { status: 'queued', entry_id: 'Q' }, { pendingFor: () => 0, pendingCount: () => 0, subscribe: () => () => {} });
  return {
    device: { token: 'tok', id: 'DV1', type: 'tablet' },
    live: o.live ?? createLiveBus(),
    config: { config: () => null, snapshot: () => config, refresh: async () => {}, subscribe: () => () => {}, dispose: () => {} },
    orders: { etaPreview: async () => ({ ok: false, error: { kind: 'network' } }), seatingOrders: async () => ({ ok: true, data: { orders: Array.from({ length: o.rounds ?? 0 }, () => ({})), total_minor: 0 } }) },
    tables: { tableMap: async () => ({ ok: true, data: { as_of_seq: 1, floors: [] } }) },
    toasts: { show: () => {} },
    permissions: {
      allowed: (p: Permission) => grants[p] !== undefined,
      requiresApproval: () => false,
      resolution: (p: Permission) => (grants[p] === undefined ? { grant: 'not_granted' } : { grant: 'allowed', scope: grants[p] }),
      scope: (p: Permission) => grants[p] ?? null,
    },
    enqueue,
    clock: { nowMs: () => T, utcOffsetMs: 5 * 3_600_000 },
    me: { staff_id: o.me ?? 'ST1', name: o.me === 'ST2' ? 'Bilal' : 'Ali' },
    online: true,
    phone: o.phone === true,
    portrait: false,
  } as unknown as Shell;
}

const draft = (o: Partial<Draft>): Draft => ({ draft_id: 'D1', device_id: 'DV1', staff_id: 'ST1', order_type: 'takeaway', cart: { lines: [{ key: 'L1', item_id: 'I5', quantity: 3, options: [] }] }, updated_at: T, held: true, ...o });

describe('[02b §8 Ordering screen] Hold, Held, day not started', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    nav.to = [];
  });

  it('[02b §8 Ordering screen] Hold keeps a device draft; Held lists this screen + this person; Resume / Discard', async () => {
    const drafts = createMemoryDraftStore();
    const m = mount();
    m.render(
      <ShellContext.Provider value={shellWith({})}>
        <DraftStoreContext.Provider value={drafts}>
          <OrderScreen order_type="takeaway" id="D7" />
        </DraftStoreContext.Provider>
      </ShellContext.Provider>,
    );
    await flush();
    m.click(m.container.querySelector<HTMLElement>('.mi[aria-label="Naan"]'));
    m.click(m.button('Hold'));
    await flush();
    expect(nav.to).toEqual(['/orders']);
    m.unmount();
    // another person's and another device's held drafts are not listed
    await drafts.put(draft({ draft_id: 'X1', staff_id: 'ST2' }));
    await drafts.put(draft({ draft_id: 'X2', device_id: 'DV2' }));
    const mine = await drafts.list('DV1', 'ST1');
    expect(mine.map((d) => [d.draft_id, d.held])).toEqual([['D7', true]]);

    const held = mount();
    held.render(
      <ShellContext.Provider value={shellWith({})}>
        <DraftStoreContext.Provider value={drafts}>
          <Held />
        </DraftStoreContext.Provider>
      </ShellContext.Provider>,
    );
    await flush();
    expect(held.container.querySelectorAll('.ql')).toHaveLength(1);
    expect(held.text()).toContain('Only Ali sees these.');
    expect(held.container.querySelector('.ql')?.textContent).toContain('held 8:00 PM');
    held.click(held.button('Resume'));
    await flush();
    expect(nav.to.at(-1)).toBe('/order/takeaway/D7');
    expect((await drafts.list('DV1', 'ST1'))[0]!.held).toBe(false);
    await drafts.put({ ...(await drafts.list('DV1', 'ST1'))[0]!, held: true });
    held.unmount();
    const again = mount();
    again.render(
      <ShellContext.Provider value={shellWith({})}>
        <DraftStoreContext.Provider value={drafts}>
          <Held />
        </DraftStoreContext.Provider>
      </ShellContext.Provider>,
    );
    await flush();
    again.click(again.button('Discard'));
    await flush();
    expect(again.container.querySelectorAll('.ql')).toHaveLength(0);
    expect(await drafts.list('DV1', 'ST1')).toEqual([]);
    again.unmount();
  });

  it('[02b #36 Q-20] BUSINESS_DAY_NOT_OPEN → "Start day" opens /admin/stock/ only with manage-stock at branch; others "Ask the manager"', async () => {
    const refusal: EnqueueResult = { status: 'refused', error: { kind: 'api', status: 409, code: 'BUSINESS_DAY_NOT_OPEN', details: {} } };
    for (const [grants, canStart] of [
      [{ 'manage-stock': 'branch' }, true],
      [{ 'manage-stock': 'my_stations' }, false],
      [{}, false],
    ] as const) {
      const drafts = createMemoryDraftStore();
      const m = mount();
      m.render(
        <ShellContext.Provider value={shellWith({ answer: refusal, grants })}>
          <DraftStoreContext.Provider value={drafts}>
            <OrderScreen order_type="takeaway" id="D8" />
          </DraftStoreContext.Provider>
        </ShellContext.Provider>,
      );
      await flush();
      m.click(m.container.querySelector<HTMLElement>('.mi[aria-label="Naan"]'));
      m.click(m.button('Send to kitchen'));
      await flush();
      expect(m.text()).toContain("The day hasn't started");
      const link = m.container.querySelector<HTMLAnchorElement>('.day a');
      if (canStart) {
        expect(link?.getAttribute('href')).toBe('/admin/stock/');
        expect(link?.textContent).toBe('Start day');
      } else {
        expect(link).toBeNull();
        expect(m.text()).toContain('Ask the manager to start the day. Your order is kept.');
      }
      // the order is kept
      expect(m.container.querySelectorAll('.ln')).toHaveLength(1);
      m.unmount();
    }
  });

  const renderHeld = (drafts: ReturnType<typeof createMemoryDraftStore>, o: Parameters<typeof shellWith>[0] = {}) => {
    const m = mount();
    m.render(
      <ShellContext.Provider value={shellWith(o)}>
        <DraftStoreContext.Provider value={drafts}>
          <Held />
        </DraftStoreContext.Provider>
      </ShellContext.Provider>,
    );
    return m;
  };

  it('[02b §8 Ordering screen] Held: newest first; a dine-in row "F2 · Round 3"; the time LTR in Urdu', async () => {
    const drafts = createMemoryDraftStore();
    await drafts.put(draft({ draft_id: 'A', updated_at: T - 120_000 }));
    await drafts.put(draft({ draft_id: 'B', updated_at: T }));
    await drafts.put(draft({ draft_id: 'C', order_type: 'dine_in', seating_id: 'SE2', table_id: 'TB2', updated_at: T - 60_000 }));
    const live = createLiveBus();
    live.frame({ type: 'catch_up', as_of_seq: 1, state: { tables: { as_of_seq: 1, floors: [{ floor_id: 'F', name: null, archived: false, zones: [{ zone_id: null, name: null, tables: [{ table_id: 'TB2', name: 'F2' }] }] }] } } });
    const m = renderHeld(drafts, { live, rounds: 2 });
    await flush();
    const rows = [...m.container.querySelectorAll('.ql')];
    expect(rows.map((r) => r.querySelector('.t')?.textContent)).toEqual(['held 8:00 PM', 'held 7:59 PM', 'held 7:58 PM']);
    expect(rows[1]!.querySelector('b')?.textContent).toBe('F2 · Round 3');
    expect(rows[0]!.querySelector('.t [dir="ltr"]')?.textContent).toBe('8:00 PM');
    m.unmount();
  });

  it('[02b §8 Ordering screen] Held counts and totals by the day-frozen sale unit (01c V20)', async () => {
    const drafts = createMemoryDraftStore();
    await drafts.put(draft({ cart: { lines: [{ key: 'L1', item_id: 'I5', quantity: 500, options: [] }] } }));
    const live = createLiveBus();
    // Naan (a piece item, Rs 40) is frozen in g today: 500 g = Rs 20, one weighed line
    live.frame({ type: 'catch_up', as_of_seq: 1, state: { stock: { business_day: { business_date: '2025-10-20', opened_at: T - 3_600_000, closed_at: null, stock_units: {}, draws: { I5: { sale_unit: 'g', stock_draws: [] } } }, business_day_started_at: T - 3_600_000, items: {} } } });
    const m = renderHeld(drafts, { live });
    await flush();
    expect(m.container.querySelector('.ql small')?.textContent).toBe('1 items · Rs 20');
    m.unmount();
  });

  it('[02b §8 Ordering screen] resuming a held dine-in order while the seating has an open draft leaves one draft', async () => {
    const drafts = createMemoryDraftStore();
    await drafts.put(draft({ draft_id: 'H', order_type: 'dine_in', seating_id: 'SE2', held: true }));
    await drafts.put(draft({ draft_id: 'O', order_type: 'dine_in', seating_id: 'SE2', held: false, cart: { lines: [{ key: 'L9', item_id: 'I5', quantity: 1, options: [] }] } }));
    const m = renderHeld(drafts);
    await flush();
    m.click(m.button('Resume'));
    await flush();
    const left = await drafts.list('DV1', 'ST1');
    expect(left.map((d) => d.draft_id)).toEqual(['O']);
    expect((left[0]!.cart as { lines: Array<{ quantity: number }> }).lines.map((l) => l.quantity)).toEqual([1, 3]);
    expect(nav.to.at(-1)).toBe('/order/dine_in/SE2');
    m.unmount();
  });

  it('[02b-B11] phone with the day not started: one Send, in the day block', async () => {
    const refusal: EnqueueResult = { status: 'refused', error: { kind: 'api', status: 409, code: 'BUSINESS_DAY_NOT_OPEN', details: {} } };
    const m = mount();
    m.render(
      <ShellContext.Provider value={shellWith({ answer: refusal, phone: true })}>
        <DraftStoreContext.Provider value={createMemoryDraftStore()}>
          <OrderScreen order_type="takeaway" id="D9" />
        </DraftStoreContext.Provider>
      </ShellContext.Provider>,
    );
    await flush();
    m.click(m.container.querySelector<HTMLElement>('.mi[aria-label="Naan"]'));
    m.click(m.container.querySelector<HTMLElement>('.sbar .btn--primary'));
    await flush();
    expect(m.text()).toContain("The day hasn't started");
    expect(m.container.querySelector('.sbar')).toBeNull();
    expect(m.buttons().filter((b) => (b.textContent ?? '').includes('Send'))).toHaveLength(1);
    m.unmount();
  });
});
