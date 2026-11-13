import type { BranchConfig } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import { StrictMode, act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../../../../i18n';
import { flush, mount } from '../../../../../test/dom';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus, type LiveBus } from '../../shell/live';
import type { LockBannerProps, LockBannerState, SeatingRef, TableMapBody } from '../../tables/contracts';
import type { Draft, DraftStore, EtaDraft, EtaPreviewBody } from '../contracts';
import { createMemoryDraftStore } from '../drafts/memory-drafts';
import { DraftStoreContext, OrderScreen } from './OrderScreen';

// 02a's lock hook and banner and the offline bar are other lanes' (23a, 23c): the screen is tested against fakes of
// their W0.4 / W0.6 contracts (integrator ruling: 26b stacks before 23a merges).
const lockFake = vi.hoisted(() => ({ refs: [] as Array<SeatingRef | null>, banner: null as LockBannerState | null, canSend: true }));
vi.mock('../../tables/lock/useTableLock', () => ({
  useTableLock: (ref: SeatingRef | null) => {
    lockFake.refs.push(ref);
    return { banner: lockFake.banner, canSend: lockFake.canSend, release: async () => {} };
  },
}));
vi.mock('../../tables/lock/LockBanner', () => ({
  LockBanner: ({ state }: LockBannerProps) => (state === null ? null : <div data-fake="lock-banner">{state.kind}</div>),
}));
vi.mock('../../tables/offline/OfflineBar', () => ({
  OfflineBar: ({ variant }: { variant: string }) => <div data-fake="offline-bar">Reconnecting… 2 orders waiting to send ({variant})</div>,
}));

const HOUR = 3_600_000;
const T = Date.UTC(2025, 9, 20, 15);

// C1 "Karahi": I1 Half / I3 Full (variants, K1 stock), I2 Mutton; C2 "Sides": I4 Raita (zone item), I5 Naan (stock).
function cfg(): BranchConfig {
  const base = aBranchConfig();
  const plain = (id: string, name: string, category_id: string, o: Record<string, unknown> = {}) => ({ ...base.items.find((i) => i.item_id === 'I2')!, item_id: id, name, category_id, ...o });
  return {
    ...base,
    categories: [...base.categories, { category_id: 'C2', name: 'Sides', sort_order: 2, availability_windows: [] }],
        // Raita is also counted in the kitchen pot K1 (sold_out): a refill moves it to the zone counter
    items: [
      ...base.items,
      plain('I4', 'Raita', 'C2', { price_minor: 8_000, out_of_stock_behaviour: 'sold_out', stock_time_ms: 60_000, stock_draws: [{ stock_item_id: 'K1', quantity_per_sale_unit: 1 }] }),
      plain('I5', 'Naan', 'C2', { price_minor: 4_000 }),
    ],
  };
}

const MAP: TableMapBody = {
  as_of_seq: 1,
  floors: [
    {
      floor_id: 'F1',
      name: 'Ground',
      archived: false,
      zones: [
        {
          zone_id: 'Z1',
          name: 'Family hall',
          tables: [
            {
              table_id: 'TB4',
              name: 'F4',
              seats: 4,
              archived: false,
              state: 'ORDERED',
              seating_id: 'SE1',
              party_size: 4,
              primary_table_id: null,
              joined_table_names: [],
              holder: null,
              assignee: null,
              lock: null,
              opened_at: T - HOUR,
              bill_requested_at: null,
              live_order_count: 1,
            },
          ],
        },
      ],
    },
  ],
};

interface RenderOptions {
  order_type?: 'dine_in' | 'takeaway';
  id?: string;
  online?: boolean;
  phone?: boolean;
  drafts?: Draft[];
  /** a draft store of the test's own (failing reads) */
  store?: DraftStore;
  map?: TableMapBody;
  /** React StrictMode (dev builds mount effects twice) */
  strict?: boolean;
}

interface Harness {
  live: LiveBus;
  previews: EtaDraft[];
  toasts: string[];
  reply: { current: (d: EtaDraft) => EtaPreviewBody | null };
  /** a BranchConfigApplied: the shell's config read answers with a new snapshot */
  setConfig(c: BranchConfig): void;
  render(o?: RenderOptions): ReturnType<typeof mount> & { again(o?: Partial<RenderOptions>): void };
}

function harness(): Harness {
  const live = createLiveBus();
  let config = cfg();
  const configListeners = new Set<() => void>();
  const previews: EtaDraft[] = [];
  const toasts: string[] = [];
  const reply: Harness['reply'] = { current: () => null };
  return {
    live,
    previews,
    toasts,
    reply,
    setConfig(c) {
      config = c;
      act(() => {
        for (const l of [...configListeners]) l();
      });
    },
    render(first = {}) {
      const drafts = first.store ?? createMemoryDraftStore();
      for (const d of first.drafts ?? []) void drafts.put(d);
      // the shell object (and its `me`) is new on every StaffApp render, as StaffApp builds it
      const shellOf = (o: RenderOptions) =>
        ({
          device: { token: 'tok', id: 'DV1', type: o.phone === true ? 'phone' : 'tablet' },
          live,
          config: {
            config: () => null,
            snapshot: () => config,
            refresh: async () => {},
            subscribe: (l: () => void) => {
              configListeners.add(l);
              return () => void configListeners.delete(l);
            },
            dispose: () => {},
          },
          orders: {
            etaPreview: async (d: EtaDraft) => {
              previews.push(d);
              const body = reply.current(d);
              return body === null ? { ok: false, error: { kind: 'network' } } : { ok: true, data: body };
            },
            seatingOrders: async () => ({ ok: true, data: { orders: [{}], total_minor: 0 } }),
          },
          tables: { tableMap: async () => ({ ok: true, data: o.map ?? MAP }) },
          toasts: { show: (x: { text: string }) => toasts.push(x.text) },
          clock: { nowMs: () => T, utcOffsetMs: 5 * HOUR },
          me: { staff_id: 'ST1', name: 'Ali' },
          online: o.online ?? true,
          phone: o.phone === true,
          portrait: false,
        }) as unknown as Shell;
      const m = mount();
      const draw = (o: RenderOptions) => {
        const tree = (
          <ShellContext.Provider value={shellOf(o)}>
            <DraftStoreContext.Provider value={drafts}>
              <OrderScreen order_type={o.order_type ?? 'dine_in'} id={o.id ?? 'SE1'} />
            </DraftStoreContext.Provider>
          </ShellContext.Provider>
        );
        m.render(o.strict === true ? <StrictMode>{tree}</StrictMode> : tree);
      };
      draw(first);
      return Object.assign(m, { again: (o: Partial<RenderOptions> = {}) => draw({ ...first, ...o }) });
    },
  };
}

const tile = (m: ReturnType<typeof mount>, name: string) => m.container.querySelector<HTMLElement>(`.mi[aria-label="${name}"]`)!;
const pick = (m: ReturnType<typeof mount>, category: string) => m.click(m.button(category, m.container.querySelector('.cats')!));
const tick = async (ms = 300) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
};

describe('[02b §8 Ordering screen] order screen', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    lockFake.refs = [];
    lockFake.banner = null;
    lockFake.canSend = true;
  });
  afterEach(() => {
    vi.useRealTimers();
    setLanguage('en');
    document.body.innerHTML = '';
  });

  it('[02b §8 Zone items] zone tile "Raita · 6 here"; a tap adds or increments one from_zone line', async () => {
    const h = harness();
    h.live.frame({ type: 'catch_up', as_of_seq: 1, state: { orders: { orders: [], zone_stock: [{ zone_id: 'Z1', name: 'Family hall counter', items: [{ item_id: 'I4', name: 'Raita', on_hand: 6, threshold: 2 }] }] } } });
    const m = h.render();
    await flush();
    pick(m, 'Sides');
    expect(tile(m, 'Raita').textContent).toContain('Family hall counter');
    expect(tile(m, 'Raita').textContent).toContain('6 here');
    m.click(tile(m, 'Raita'));
    m.click(tile(m, 'Raita'));
    await tick();
    expect(h.previews.at(-1)!.lines).toEqual([{ key: expect.any(String), item_id: 'I4', quantity: 2, from_zone: true }]);
    expect(h.previews.at(-1)).toMatchObject({ order_type: 'dine_in', table_id: 'TB4', seating_id: 'SE1' });
    expect(m.container.querySelector('.qty')?.textContent).toBe('2');
    m.unmount();
  });

  it('[02b §8 Ordering screen] a line problem marks the line; Send says "Fix n item first"', async () => {
    const h = harness();
    // Naan's station is paused; Raita is fine
    h.reply.current = (d) => ({
      as_of_seq: 2,
      groups: d.lines.filter((l) => l.item_id === 'I4').map((l) => ({ promise_ms: T + 20 * 60_000, keys: [l.key] })),
      lines: d.lines.map((l) =>
        l.item_id === 'I5'
          ? { key: l.key, eta_ms: null, from_stock: false, zone_served: false, refused: { code: 'STATION_PAUSED', details: { station_id: 'S1' } } }
          : { key: l.key, eta_ms: T + 18 * 60_000, from_stock: false, zone_served: false },
      ),
    });
    const m = h.render({ order_type: 'takeaway', id: 'D1' });
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    m.click(tile(m, 'Raita'));
    await tick();
    const lines = [...m.container.querySelectorAll('.ln')];
    expect(lines.filter((l) => l.classList.contains('prob')).map((l) => l.textContent)).toEqual([expect.stringContaining('Kitchen station paused')]);
    expect(m.text()).toContain("1 item can't be sent — fix it first");
    const send = m.button('Fix 1 item first');
    expect(send.hasAttribute('disabled')).toBe(true);
    // Remove from the problem row clears it
    m.click(lines.find((l) => l.classList.contains('prob'))!.querySelector('[aria-label="Remove"]'));
    await tick();
    expect(m.button('Send to kitchen').hasAttribute('disabled')).toBe(false);
    m.unmount();
  });

  it('[02b §8 Ordering screen] preview failed / offline → "—", "set when sent"; Send stays on (queues)', async () => {
    const h = harness();
    const m = h.render({ order_type: 'takeaway', id: 'D1', online: false });
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    await tick();
    expect(h.previews).toHaveLength(0);
    expect(m.container.querySelector('.ln .eta.none')?.textContent).toBe('—');
    expect(m.text()).toContain('Times will be set when sent');
    expect(m.button('Send to kitchen').hasAttribute('disabled')).toBe(false);
    m.unmount();
  });

  it('[02b §8 Queue] offline: OrderScreen mounts OfflineBar "Reconnecting… n orders waiting to send"', async () => {
    const h = harness();
    const m = h.render({ online: false });
    await flush();
    expect(m.container.querySelector('[data-fake="offline-bar"]')?.textContent).toContain('(order)');
    m.unmount();
    const online = harness().render();
    await flush();
    expect(online.container.querySelector('[data-fake="offline-bar"]')).toBeNull();
    online.unmount();
  });

  it('[02b §8 Ordering screen] dine-in mounts useTableLock + LockBanner for the seating; Send follows canSend', async () => {
    const h = harness();
    lockFake.canSend = false;
    lockFake.banner = { kind: 'other_device', table: 'F4' };
    const m = h.render();
    await flush();
    expect(lockFake.refs.at(-1)).toEqual({ table_id: 'TB4', seating_id: 'SE1' });
    expect(m.container.querySelector('[data-fake="lock-banner"]')?.textContent).toBe('other_device');
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    await tick();
    expect(m.button('Send to kitchen').hasAttribute('disabled')).toBe(true);
    m.unmount();
    // a takeaway order has no table lock
    lockFake.refs = [];
    const t2 = harness().render({ order_type: 'takeaway', id: 'D2' });
    await flush();
    expect(lockFake.refs.every((r) => r === null)).toBe(true);
    t2.unmount();
  });

  it('[02b #35] after sign-in the draft comes back ("Your unsent order is back")', async () => {
    const h = harness();
    const draft: Draft = {
      draft_id: 'DR1',
      device_id: 'DV1',
      staff_id: 'ST1',
      order_type: 'dine_in',
      table_id: 'TB4',
      seating_id: 'SE1',
      cart: { lines: [{ key: 'L1', item_id: 'I5', quantity: 6, options: [] }] },
      updated_at: T + 9 * 60_000, // 8:09 PM hub time
      held: false,
    };
    const someoneElse = { ...draft, draft_id: 'DR2', staff_id: 'ST2', cart: { lines: [{ key: 'L9', item_id: 'I4', quantity: 1, options: [] }] } };
    const m = h.render({ drafts: [draft, someoneElse] });
    await flush();
    expect(m.text()).toContain('Your unsent order is back');
    expect(m.text()).toContain('Kept on this screen since 8:09 PM');
    expect(m.container.querySelector('.ln')?.textContent).toContain('Naan');
    expect(m.container.querySelectorAll('.ln')).toHaveLength(1);
    expect(m.text()).toContain('Rs 240');
    m.click(m.button('OK'));
    expect(m.text()).not.toContain('Your unsent order is back');
    m.unmount();
  });

  it('[02b §8 Rules] phone Menu / Cart tabs + sticky Send; Urdu rail on the right, prices and times LTR', async () => {
    const h = harness();
    const phone = h.render({ order_type: 'takeaway', id: 'D1', phone: true });
    await flush();
    const tabs = phone.container.querySelectorAll('.ptabs button');
    expect([...tabs].map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([
      ['Menu', 'true'],
      ['Cart 0', 'false'],
    ]);
    expect(phone.container.querySelector('.sbar .btn--primary')?.textContent).toBe('Send');
    expect(phone.container.querySelector('.cats')).toBeNull();
    phone.click(phone.button('Sides', phone.container.querySelector('.pills')!));
    phone.click(tile(phone, 'Naan'));
    phone.click(tabs[1]!);
    expect(phone.container.querySelector('.ln')?.textContent).toContain('Naan');
    expect(phone.container.querySelector('.sbar')?.textContent).toContain('Rs 40');
    phone.unmount();

    setLanguage('ur');
    const ur = harness().render({ order_type: 'takeaway', id: 'D3' });
    await flush();
    expect(ur.container.querySelector('.order')?.getAttribute('dir')).toBe('rtl');
    expect(ur.container.querySelector('.order .osc > .cats')).not.toBeNull(); // the rail is the row's first: on the right in RTL
    expect([...ur.container.querySelectorAll('.price')].every((p) => p.getAttribute('dir') === 'ltr')).toBe(true);
    expect(ur.container.querySelector('.cart__foot strong')?.getAttribute('dir')).toBe('ltr');
    ur.unmount();
  });

  it('[02b #35] a re-render with a new person object never brings the draft back over the cart being typed', async () => {
    const h = harness();
    const draft: Draft = { draft_id: 'DR1', device_id: 'DV1', staff_id: 'ST1', order_type: 'takeaway', cart: { lines: [{ key: 'L1', item_id: 'I5', quantity: 6, options: [] }] }, updated_at: T, held: false };
    const m = h.render({ order_type: 'takeaway', id: 'DR1', drafts: [draft] });
    await flush();
    m.click(m.button('OK'));
    pick(m, 'Sides');
    m.click(tile(m, 'Naan')); // 7 now
    m.again(); // StaffApp re-renders (15 s tick): a new shell and a new `me`
    await flush();
    m.again();
    await flush();
    expect(m.text()).not.toContain('Your unsent order is back');
    expect(m.container.querySelector('.ln__q')?.textContent).toBe('7×');
    m.unmount();
  });

  it('[02b #35] a draft store that cannot be read still saves the cart', async () => {
    const h = harness();
    const puts: Draft[] = [];
    const store: DraftStore = { list: () => Promise.reject(new Error('idb')), put: async (d) => void puts.push(d), remove: async () => {} };
    const m = h.render({ order_type: 'takeaway', id: 'D9', store });
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    await flush();
    expect(puts.at(-1)).toMatchObject({ draft_id: 'D9', staff_id: 'ST1', cart: { lines: [{ item_id: 'I5', quantity: 1 }] } });
    m.unmount();
  });

  it('[02b §3.10] after a refill the kitchen is sold out but the zone has 6: zone taps are not capped, no problem, Send on', async () => {
    const h = harness();
    const day = { business_date: '2025-10-20', opened_at: T - HOUR, closed_at: null, stock_units: { K1: 'g' }, draws: {} };
    h.live.frame({
      type: 'catch_up',
      as_of_seq: 1,
      state: {
        stock: { business_day: day, business_day_started_at: T - HOUR, items: { K1: { on_hand: 0, reserved: 0, set_at: T - 60_000, unit: 'g', available: 0, level: 'out' } } },
        orders: { orders: [], zone_stock: [{ zone_id: 'Z1', name: 'Family hall counter', items: [{ item_id: 'I4', name: 'Raita', on_hand: 6, threshold: 2 }] }] },
      },
    });
    const m = h.render();
    await flush();
    pick(m, 'Sides');
    expect(tile(m, 'Raita').classList.contains('off')).toBe(false);
    expect(tile(m, 'Raita').textContent).not.toContain('Sold out');
    for (let i = 0; i < 7; i += 1) m.click(tile(m, 'Raita'));
    await tick();
    // 6 at the counter; a 7th would make the whole line a kitchen line, and the kitchen has none
    expect(m.container.querySelector('.ln__q')?.textContent).toBe('6×');
    expect(m.container.querySelector('.ln.prob')).toBeNull();
    expect(m.button('Send to kitchen').hasAttribute('disabled')).toBe(false);
    m.unmount();
  });

  it('[02b §3.10] a removed zone-served line goes back to the zone count', async () => {
    const h = harness();
    const line = { order_item_id: 'ZL1', served_from_zone_id: 'Z1', item_id: 'I4', live_units: 2 };
    h.live.frame({ type: 'catch_up', as_of_seq: 1, state: { orders: { orders: [{ order_id: 'O1', lines: [line] }], zone_stock: [{ zone_id: 'Z1', name: 'Counter', items: [{ item_id: 'I4', name: 'Raita', on_hand: 6, threshold: 2 }] }] } } });
    const m = h.render();
    await flush();
    pick(m, 'Sides');
    expect(tile(m, 'Raita').textContent).toContain('6 here');
    act(() => h.live.frame({ type: 'event', seq: 2, event: { event_id: 'E2', event_type: 'ItemRemoved', schema_version: 1, payload: { order_item_id: 'ZL1', units: 1 } } }));
    expect(tile(m, 'Raita').textContent).toContain('7 here');
    act(() => h.live.frame({ type: 'event', seq: 3, event: { event_id: 'E3', event_type: 'ItemRemoved', schema_version: 1, payload: { order_item_id: 'ZL1' } } }));
    expect(tile(m, 'Raita').textContent).toContain('8 here');
    m.unmount();
  });

  it('[02b §8 Ordering screen] the link drops after a good preview: times and "All ready by" go at once', async () => {
    const h = harness();
    h.reply.current = (d) => ({ as_of_seq: 2, groups: [{ promise_ms: T + 27 * 60_000, keys: d.lines.map((l) => l.key) }], lines: d.lines.map((l) => ({ key: l.key, eta_ms: T + 20 * 60_000, from_stock: false, zone_served: false })) });
    const m = h.render({ order_type: 'takeaway', id: 'D1' });
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    await tick();
    expect(m.text()).toContain('All ready by');
    expect(m.container.querySelector('.ln .eta')?.textContent).toBe('8:20 PM');
    m.again({ online: false });
    expect(m.text()).not.toContain('All ready by');
    expect(m.text()).toContain('Times will be set when sent');
    expect(m.container.querySelector('.ln .eta.none')?.textContent).toBe('—');
    m.unmount();
  });

  it('[02b §8 Ordering screen] dine-in: a seating not on the map → toast, one more read, then Send off with a message', async () => {
    const h = harness();
    const m = h.render({ map: { as_of_seq: 1, floors: [] } });
    await flush();
    expect(h.toasts).toEqual(['This table changed — refreshed']);
    expect(m.text()).toContain('This table changed. Go back to the tables to take the order.');
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    expect(m.button('Send to kitchen').hasAttribute('disabled')).toBe(true);
    m.unmount();
  });

  it('[02b #35] under StrictMode (dev) the draft still comes back and later changes are saved', async () => {
    const h = harness();
    const store = createMemoryDraftStore();
    await store.put({ draft_id: 'D5', device_id: 'DV1', staff_id: 'ST1', order_type: 'takeaway', cart: { lines: [{ key: 'L1', item_id: 'I5', quantity: 2, options: [] }] }, updated_at: T, held: false });
    const m = h.render({ order_type: 'takeaway', id: 'D5', store, strict: true });
    await flush();
    expect(m.text()).toContain('Your unsent order is back');
    expect(m.container.querySelector('.ln__q')?.textContent).toBe('2×');
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    await flush();
    expect((await store.list('DV1', 'ST1'))[0]!.cart).toMatchObject({ lines: [{ item_id: 'I5', quantity: 3 }] });
    m.unmount();
  });

  it('[02b §8 Ordering screen] the screen prices and weighs by the day-frozen sale unit from the stock mirror (01c V20)', async () => {
    const h = harness();
    // the open day froze Naan (a piece item in the config, Rs 40) in g
    const day = { business_date: '2025-10-20', opened_at: T - HOUR, closed_at: null, stock_units: {}, draws: { I5: { sale_unit: 'g', stock_draws: [] } } };
    h.live.frame({ type: 'catch_up', as_of_seq: 1, state: { stock: { business_day: day, business_day_started_at: T - HOUR, items: {} } } });
    const m = h.render({ order_type: 'takeaway', id: 'D6' });
    await flush();
    pick(m, 'Sides');
    expect(tile(m, 'Naan').textContent).toContain('By weight');
    expect(tile(m, 'Naan').textContent).toContain('/ kg');
    m.click(tile(m, 'Naan')); // a weighed item opens the options sheet (26c)
    for (const k of ['0', '.', '5']) m.click([...m.container.querySelectorAll<HTMLElement>('.wpad button')].find((b) => b.textContent === k)!);
    m.click(m.button('Add to order'));
    // lineTotalMinor(4 000, 500, 'g') = Rs 20 on the line and in the total
    expect(m.container.querySelector('.ln__q')?.textContent).toBe('500 g');
    expect(m.container.querySelector('.ln__p')?.textContent).toBe('Rs 20');
    expect(m.container.querySelector('.cart__foot strong')?.textContent).toBe('Rs 20');
    m.unmount();
  });

  it('[02b §8 Ordering screen] a menu change removing the open sheet\'s item closes it: "This item changed — pick again"', async () => {
    const h = harness();
    const m = h.render({ order_type: 'takeaway', id: 'D9' });
    await flush();
    m.click(tile(m, 'Chicken Karahi')); // the variants sheet
    expect(m.container.querySelector('.dlg')).not.toBeNull();
    const c = cfg();
    h.setConfig({ ...c, items: c.items.filter((i) => i.variant_group_id === null) });
    await flush();
    expect(m.container.querySelector('.dlg')).toBeNull();
    expect(h.toasts).toEqual(['This item changed — pick again']);
    m.unmount();
  });
});
