import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import { createPermissions } from '../../shell/permissions';
import { createToastBus } from '../../shell/toast';
import type { CatchUpOrder, DraftStore, OpenOrder, OpenOrdersBody } from '../contracts';
import { DraftStoreContext } from '../order-screen/OrderScreen';
import { KioskHome } from './KioskHome';
import { OpenOrders } from './OpenOrders';

// 02b v1.0.11 §8 Open orders, §6.16 (27b1; frames 02-S07 OpenOrdersKiosk / OpenOrdersAbandoned / OpenOrdersPhone):
// the list over scripted hub answers, the real live bus and the real permissions.

// 20:15 hub time (UTC offset 0), 13 Nov 2026
const NOW = Date.UTC(2026, 10, 13, 20, 15);
const at = (h: number, m: number) => Date.UTC(2026, 10, 13, h, m);

function row(over: Partial<OpenOrder> & { order_id: string }): OpenOrder {
  return {
    order_type: 'takeaway',
    table_key: 'takeaway',
    token: 57,
    car_number: null,
    car_type: null,
    has_phone: false,
    placed_at: at(20, 11),
    business_date: '2026-11-13',
    from_date: null,
    ready: { n: 0, m: 3 },
    promise_ms: at(20, 31),
    abandoned: false,
    ...over,
  };
}

const ROWS: OpenOrder[] = [
  row({ order_id: 'T57', token: 57, ready: { n: 0, m: 3 }, promise_ms: at(20, 31), has_phone: true, placed_by: { staff_id: 'bilal', name: 'Bilal' } }),
  row({ order_id: 'P1', order_type: 'parking', table_key: 'parking', token: null, car_number: 'LEB 1234', car_type: 'sedan', ready: { n: 3, m: 3 }, promise_ms: at(20, 12), placed_at: at(20, 5), placed_by: { staff_id: 'bilal', name: 'Bilal' } }),
  row({ order_id: 'T58', token: 58, ready: { n: 1, m: 2 }, promise_ms: at(20, 33), placed_at: at(20, 14) }),
  row({ order_id: 'T41', token: 41, ready: { n: 2, m: 3 }, promise_ms: null, from_date: '2026-11-06', business_date: '2026-11-06', placed_at: Date.UTC(2026, 10, 6, 23, 40) }),
];
const ABANDONED: OpenOrder = row({ order_id: 'D9', order_type: 'dine_in', table_key: 'dine_in:S9', token: null, abandoned: true, promise_ms: null, ready: { n: 0, m: 0 }, placed_by: { staff_id: 'ali', name: 'Ali' }, table_id: 'T9' });

interface Opts {
  rows?: OpenOrder[];
  manager?: boolean;
  online?: boolean;
  phone?: boolean;
  catchUp?: CatchUpOrder[];
  roster?: Array<{ staff_id: string; display_name: string }>;
  device?: 'cashier_kiosk' | 'tablet';
  takeOrder?: boolean;
}

function setup(o: Opts = {}) {
  const live = createLiveBus();
  if (o.catchUp !== undefined) live.frame({ type: 'catch_up', as_of_seq: 1, state: { orders: { orders: o.catchUp, zone_stock: [] } } });
  const openOrders = vi.fn(async (): Promise<{ ok: true; data: OpenOrdersBody }> => ({ ok: true, data: { orders: o.rows ?? ROWS } }));
  const roster = vi.fn(async () => ({ ok: true as const, data: { staff: (o.roster ?? []).map((s) => ({ ...s, locked_until: null })), active_session: null } }));
  const tableMap = vi.fn(async () => ({
    ok: true as const,
    data: { as_of_seq: 1, floors: [{ floor_id: 'F', name: 'Ground', archived: false, zones: [{ zone_id: 'Z', name: 'Z', tables: [{ table_id: 'T9', name: 'T9', seating_id: 'S9' }] }] }] },
  }));
  const grant = { ...(o.manager === true ? { 'force-release-table-lock': { grant: 'allowed', scope: 'branch' } } : {}), ...(o.takeOrder === true ? { 'take-order': { grant: 'allowed', scope: 'branch' } } : {}) };
  const shell = {
    device: { token: 'D', id: 'dev-1', type: o.device ?? 'tablet' },
    orders: { openOrders },
    tables: { tableMap },
    api: { roster },
    live,
    config: { config: () => ({ order_abandon_ms: 2 * 3_600_000 }), snapshot: () => null, subscribe: () => () => {} },
    permissions: createPermissions(grant as never),
    toasts: createToastBus(),
    clock: { nowMs: () => NOW, utcOffsetMs: 0 },
    me: { staff_id: 'sana', name: 'Sana' },
    online: o.online ?? true,
    phone: o.phone ?? false,
    portrait: false,
  } as unknown as Shell;
  return { shell, live, openOrders, roster, tableMap };
}

let view: Mounted | null = null;
beforeEach(() => {
  window.location.hash = '';
});
afterEach(() => {
  view?.unmount();
  view = null;
  vi.useRealTimers();
});

async function show(s: ReturnType<typeof setup>, node = <OpenOrders />, drafts?: DraftStore) {
  view = mount();
  const inner = <ShellContext.Provider value={s.shell}>{node}</ShellContext.Provider>;
  view.render(drafts === undefined ? inner : <DraftStoreContext.Provider value={drafts}>{inner}</DraftStoreContext.Provider>);
  await flush();
  return view;
}

const rowsOf = (v: Mounted) => [...v.container.querySelectorAll<HTMLElement>('.oo')];

describe('[02b §8 Open orders] open orders list', () => {
  it('[02b §8 Open orders] takeaway by token, parking by plate; Ready n/m highlighted; by promise', async () => {
    const v = await show(setup());
    const rows = rowsOf(v);
    // by promise: parking 8:12, token 57 at 8:31, 58 at 8:33, the carried order (no promise) last
    expect(rows.map((r) => r.dataset['order'])).toEqual(['P1', 'T57', 'T58', 'T41']);
    const [plate, token] = rows as [HTMLElement, HTMLElement, ...HTMLElement[]];
    expect(plate.querySelector('.oo__id.p .plate')?.textContent).toBe('LEB 1234');
    expect(plate.querySelector('.plate')?.getAttribute('dir')).toBe('ltr');
    expect(plate.textContent).toContain('Parking · Sedan');
    expect(plate.querySelector('.stg')?.textContent).toBe('Ready 3/3');
    expect(plate.className).toContain('ready');
    expect(plate.querySelector('.oo__r b')?.textContent).toBe('8:12 PM');
    expect(token.querySelector('.oo__id')?.textContent).toBe('57');
    expect(token.textContent).toContain('Takeaway');
    expect(token.className).not.toContain('ready');
    expect(token.querySelector('.stg')?.textContent).toBe('Ready 0/3');
    // the filter counts
    expect(v.text()).toContain('All 4');
    expect(v.text()).toContain('Takeaway 3');
    expect(v.text()).toContain('Parking 1');
    v.click(v.button('Parking'));
    expect(rowsOf(v).map((r) => r.dataset['order'])).toEqual(['P1']);
    // a tap opens the token view
    v.click(rowsOf(v)[0]);
    expect(window.location.hash).toBe('#/orders/P1');
  });

  it('[02b §8 Open orders] "from <date>" on a carried order', async () => {
    const v = await show(setup());
    const carried = rowsOf(v).find((r) => r.dataset['order'] === 'T41')!;
    expect(carried.querySelector('.bdg')?.textContent).toBe('from 6 Nov');
    expect(carried.querySelector('small')?.textContent).toBe('Placed 6 Nov 11:40 PM');
    expect(carried.querySelector('.oo__r b')?.textContent).toBe('—');
    expect(rowsOf(v).find((r) => r.dataset['order'] === 'T57')!.querySelector('.bdg')).toBeNull();
  });

  it('[02b §8 Open orders] Abandoned tab only for managers (branch force-release-table-lock)', async () => {
    const plain = setup({ rows: [...ROWS] });
    const v = await show(plain);
    expect(v.text()).not.toContain('Abandoned');
    expect(plain.openOrders).toHaveBeenCalledWith({ order_type: 'all', abandoned: false });
    v.unmount();
    const boss = setup({ rows: [...ROWS, ABANDONED], manager: true });
    view = null;
    const w = await show(boss);
    expect(boss.openOrders).toHaveBeenCalledWith({ order_type: 'all', abandoned: true });
    expect(w.text()).toContain('Abandoned 1');
    // the abandoned dine-in row is not in All
    expect(rowsOf(w).map((r) => r.dataset['order'])).not.toContain('D9');
    w.click(w.button('Abandoned'));
    const [d9] = rowsOf(w);
    expect(rowsOf(w)).toHaveLength(1);
    expect(d9!.querySelector('.stg')?.textContent).toBe('Not tracked');
    expect(d9!.textContent).toContain('opens the table');
    // a my_floors grant is no manager
    const floors = setup({ rows: [...ROWS] });
    (floors.shell as { permissions: unknown }).permissions = createPermissions({ 'force-release-table-lock': { grant: 'allowed', scope: 'my_floors' } } as never);
    w.unmount();
    view = null;
    expect((await show(floors)).text()).not.toContain('Abandoned');
  });

  it('[02b Q-9] "Usman · placed 8:11 PM": placed_by.name, else catch-up placed_by + staff-roster; dine-in abandoned row names its current table', async () => {
    const catchUp = [{ order_id: 'T58', placed_by: 'hamza' } as CatchUpOrder];
    const s = setup({ rows: [...ROWS, ABANDONED, { ...ABANDONED, order_id: 'D10', table_id: undefined, table_key: 'dine_in:S9', placed_by: undefined }], manager: true, catchUp, roster: [{ staff_id: 'hamza', display_name: 'Hamza' }] });
    const v = await show(s);
    const byId = (id: string) => rowsOf(v).find((r) => r.dataset['order'] === id)!;
    // the hub row's placed_by.name (H4)
    expect(byId('T57').querySelector('small')?.textContent).toBe('Placed 8:11 PM · Bilal');
    expect(byId('P1').querySelector('small')?.textContent).toBe('Placed 8:05 PM · Bilal');
    // no name on the row → the catch-up's placed_by id through the roster
    expect(byId('T58').querySelector('small')?.textContent).toBe('Placed 8:14 PM · Hamza');
    // nobody known → no name
    expect(byId('T41').querySelector('small')?.textContent).toBe('Placed 6 Nov 11:40 PM');
    v.click(v.button('Abandoned'));
    const d9 = byId('D9');
    expect(d9.querySelector('.oo__id')?.textContent).toBe('T9');
    // H4 absent (D10): the map tile whose seating_id = the table_key suffix
    expect(byId('D10').querySelector('.oo__id')?.textContent).toBe('T9');
    expect(s.tableMap).toHaveBeenCalledTimes(1);
    v.click(d9);
    expect(window.location.hash).toBe('#/tables/T9?seating_id=S9');
  });

  it('[02b Q-9] abandon text from order_abandon_ms', async () => {
    const s = setup({ rows: [ABANDONED], manager: true });
    const v = await show(s);
    v.click(v.button('Abandoned'));
    expect(rowsOf(v)[0]!.querySelector('small')?.textContent).toBe('No kitchen tap for 2 h · Ali');
    v.unmount();
    view = null;
    const three = setup({ rows: [ABANDONED], manager: true });
    (three.shell.config as { config: () => unknown }).config = () => ({ order_abandon_ms: 3 * 3_600_000 + 1 });
    const w = await show(three);
    w.click(w.button('Abandoned'));
    expect(rowsOf(w)[0]!.querySelector('small')?.textContent).toBe('No kitchen tap for 3 h · Ali');
  });

  it('[02b Q-9] customer name from catch-up / OrderContactSet for the kiosk and the placer only', async () => {
    const catchUp = [{ order_id: 'T57', placed_by: 'bilal', customer_name: 'Usman', phone: null } as CatchUpOrder, { order_id: 'T58', placed_by: 'bilal' } as CatchUpOrder];
    const s = setup({ catchUp });
    const v = await show(s);
    const byId = (id: string) => rowsOf(v).find((r) => r.dataset['order'] === id)!;
    expect(byId('T57').querySelector('small')?.textContent).toBe('Usman · placed 8:11 PM');
    // the hub sent no contact to this device (not the kiosk, not the placer): no name, never a guess
    expect(byId('T58').querySelector('small')?.textContent).not.toContain('Usman');
    s.live.frame({ type: 'event', seq: 2, event: { event_id: 'E2', event_type: 'OrderContactSet', schema_version: 1, payload: { order_id: 'T58', customer_name: 'Imran', phone: null } } } as never);
    await flush();
    expect(byId('T58').querySelector('small')?.textContent).toBe('Imran · placed 8:14 PM');
  });

  it('[02b Q-6] Ready n/m refetched on order and kitchen frames, debounced', async () => {
    vi.useFakeTimers();
    const s = setup();
    const v = await show(s);
    expect(s.openOrders).toHaveBeenCalledTimes(1);
    const frame = (seq: number, event_type: string) =>
      s.live.frame({ type: 'event', seq, event: { event_id: `E${seq}`, event_type, schema_version: 1, payload: {} } } as never);
    // a burst of order and stage frames → one read after 250 ms
    frame(2, 'ItemServed');
    frame(3, 'ItemDone');
    frame(4, 'FireDispatched');
    await act(async () => {
      vi.advanceTimersByTime(249);
    });
    expect(s.openOrders).toHaveBeenCalledTimes(1);
    s.openOrders.mockResolvedValueOnce({ ok: true, data: { orders: [{ ...ROWS[0]!, ready: { n: 3, m: 3 } }] } });
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    await flush();
    expect(s.openOrders).toHaveBeenCalledTimes(2);
    expect(rowsOf(v).map((r) => r.querySelector('.stg')?.textContent)).toEqual(['Ready 3/3']);
    // a frame that is no order frame reads nothing; a reconnect does
    frame(5, 'TableOpened');
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(s.openOrders).toHaveBeenCalledTimes(2);
    s.live.connection(true);
    s.live.connection(false);
    s.live.connection(true);
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(s.openOrders).toHaveBeenCalledTimes(3);
    // no Refresh line; "Updated" only offline
    expect(v.text()).not.toContain('Refresh');
    expect(v.text()).not.toContain('Updated');
  });

  it('[02b Q-6] offline: the list stays, "Updated {time}" shows', async () => {
    const v = await show(setup({ online: false }));
    expect(v.text()).toContain('Updated 8:15 PM');
    expect(rowsOf(v)).toHaveLength(4);
  });

  it('[02b §8 Open orders] kiosk home = open orders + Takeaway / Parking', async () => {
    const held: DraftStore = {
      put: async () => {},
      remove: async () => {},
      list: async () => [{ draft_id: 'a', held: true }, { draft_id: 'b', held: false }, { draft_id: 'c', held: true }] as never,
    };
    const v = await show(setup({ device: 'cashier_kiosk', takeOrder: true }), <KioskHome />, held);
    expect(rowsOf(v)).toHaveLength(4);
    expect(v.text()).toContain('New order');
    expect(v.button('Held').querySelector('.cnt')?.textContent).toBe('2');
    v.click(v.button('Takeaway', v.container.querySelector('.bchips')!));
    expect(window.location.hash).toMatch(/^#\/order\/takeaway\/[0-9A-Z]{26}$/);
    v.click(v.button('Parking', v.container.querySelector('.bchips')!));
    expect(window.location.hash).toMatch(/^#\/order\/parking\/[0-9A-Z]{26}$/);
    v.click(v.button('Tables'));
    expect(window.location.hash).toBe('#/tables');
    v.click(v.button('Held'));
    expect(window.location.hash).toBe('#/held');
  });

  it('[02b §8 Open orders] phone: chips and rows', async () => {
    const v = await show(setup({ phone: true }));
    expect(v.container.querySelector('.chipsx .chip[aria-pressed="true"]')?.textContent).toContain('All');
    expect(rowsOf(v)).toHaveLength(4);
  });

  it('[02b §8 Rules] kiosk home: Takeaway / Parking follow the take-order grant (R5); Tables and Held stay', async () => {
    const v = await show(setup({ device: 'cashier_kiosk' }), <KioskHome />);
    expect(v.container.querySelector('.bchips')).toBeNull();
    expect(v.text()).not.toContain('New order');
    expect(rowsOf(v)).toHaveLength(4);
    v.click(v.button('Tables'));
    expect(window.location.hash).toBe('#/tables');
  });
});
