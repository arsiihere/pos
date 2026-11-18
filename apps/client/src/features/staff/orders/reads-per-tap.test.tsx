import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../test/dom';
import { navigate } from '../../../app/router';
import { tapAlert, type TapDeps, type TapRow } from '../../alerts/deeplink-tap';
import { setLanguage } from '../../../i18n';
import type { Resolution } from '../api';
import { ShellContext, type Shell } from '../shell/hooks';
import { createLiveBus } from '../shell/live';
import { createPermissions } from '../shell/permissions';
import { createToastBus } from '../shell/toast';
import type { Enqueue, MapTile, TableMapBody } from '../tables/contracts';
import type { LineView, OrderViewBody, OrdersApi, SeatingLine, ZoneStockBody } from './contracts';
import { OrdersPart } from './table-view/OrdersPart';
import { OrderView } from './view/OrderView';
import { ZoneStock } from './zones/ZoneStock';
import { dropHandover, handOver, HANDOVER_MS, peekOrderView, takeOrderView, takeZoneStock } from './preload';

// 01d v1.3 §3.13.3 "Reads per tap" (m3), test 97, with a fetch spy on the staff api: the tap's open check reads once
// and hands its answer to the screen it opens (orders/preload.ts, integrator ruling (a)), so a takeaway OrderView
// and #/zones make no second read for their first render; a later visit reads fresh; a dine-in tap with a fresh held
// map reads no table-map. Runs end to end through the real tapAlert.

const PLACED = Date.UTC(2026, 10, 13, 15, 11);
const PROMISE = Date.UTC(2026, 10, 13, 15, 31);

function line(over: Partial<LineView> = {}): LineView {
  return {
    order_item_id: 'L1',
    order_id: 'O57',
    parent_order_item_id: null,
    line_kind: 'item',
    item_id: 'I1',
    deal_id: null,
    name: 'Chicken Biryani',
    sale_unit: 'piece',
    quantity: 2,
    units: 2,
    live_units: 2,
    comped_units: 0,
    removed_units: 0,
    voided_units: 0,
    returned_units: 0,
    refundable_minor: 76_000,
    comp_minor: 0,
    comp_voided_minor: 0,
    removed_minor: 0,
    refund_minor: 0,
    line_total_minor: 76_000,
    billed_minor: 76_000,
    return_of: null,
    served_from_zone_id: null,
    zone_served: false,
    added_at: PLACED,
    served_at: null,
    served_source: null,
    is_food: true,
    kitchen_note: null,
    ...over,
  };
}

const sl = (l: LineView, stage: SeatingLine['stage']): SeatingLine => ({ ...l, stage, fired: true });

function body(order_id: string, over: Partial<OrderViewBody> = {}): OrderViewBody {
  return {
    order_id,
    placed_by: { staff_id: 'ST-SANA', name: 'Sana' },
    placed_at: PLACED,
    follow_up: false,
    cancelled: false,
    billed: false,
    has_phone: false,
    promise_ms: PROMISE,
    lines: [sl(line({ order_id, order_item_id: 'L1' }), 'cooking'), sl(line({ order_id, order_item_id: 'L3', name: 'Mint Margarita' }), 'done')],
    order_type: 'takeaway',
    seating_id: null,
    ...over,
  };
}

const ZONES: ZoneStockBody[] = [{ zone_id: 'FH', name: 'Family hall', items: [{ item_id: 'raita', name: 'Raita', on_hand: 3, threshold: 4 }] }];

const tile = (over: Partial<MapTile> = {}): MapTile => ({
  table_id: 'F4',
  name: 'F4',
  seats: 4,
  archived: false,
  state: 'ORDERED',
  seating_id: 'S4',
  party_size: 4,
  primary_table_id: 'F4',
  joined_table_names: [],
  holder: { staff_id: 'ST-SANA', name: 'Sana' },
  assignee: null,
  lock: null,
  opened_at: PLACED - 60_000,
  bill_requested_at: null,
  live_order_count: 1,
  ...over,
});
const MAP: TableMapBody = { as_of_seq: 9, floors: [{ floor_id: 'FL', name: 'Hall', archived: false, zones: [{ zone_id: 'Z', name: 'Hall', tables: [tile()] }] }] };

const ALL: Record<string, Resolution> = {
  'mark-served': { grant: 'allowed', scope: 'branch' },
  'take-order': { grant: 'allowed', scope: 'branch' },
};
const ok = <T,>(data: T) => ({ ok: true as const, data });

function setup(o: { view: OrderViewBody; zones?: ZoneStockBody[]; others?: OrderViewBody[] }) {
  const live = createLiveBus();
  live.frame({ type: 'catch_up', as_of_seq: 3, state: { orders: { orders: [], zone_stock: [] }, tables: MAP } } as never);
  /** the fetch spy: every staff api read, by name */
  const reads: string[] = [];
  const spy = <A extends unknown[], R>(name: string, fn: (...a: A) => Promise<R>) =>
    vi.fn(async (...a: A) => {
      reads.push(name);
      return fn(...a);
    });
  const orders = {
    orderView: spy('order-view', async (id: string) => ok({ kind: 'order' as const, order: [o.view, ...(o.others ?? [])].find((b) => b.order_id === id) ?? o.view })),
    zoneStock: spy('zone-stock', async () => ok(o.zones ?? ZONES)),
    seatingOrders: spy('seating-orders', async () => ok({ orders: [o.view], total_minor: 0 })),
    // the token / plate head of an order not in the catch-up (OrderView): not one of §3.13.3's counted reads
    openOrders: vi.fn(async () => ok({ orders: [] })),
  };
  const tables = { tableMap: spy('table-map', async () => ok(MAP)) };
  const enqueue = Object.assign(vi.fn(async () => ({ status: 'sent' as const, result: {} })), { pendingFor: () => 0, pendingCount: () => 0, subscribe: () => () => {} });
  const shell = {
    device: { token: 'D', id: 'DEV', type: 'tablet' },
    live,
    orders: orders as unknown as OrdersApi,
    tables,
    api: { command: vi.fn(async () => ok({})), query: vi.fn(async () => ok({ orders: [] })) /* 04 pending-voids, not a 02b read */ },
    permissions: createPermissions(ALL),
    toasts: createToastBus(),
    enqueue: enqueue as unknown as Enqueue,
    clock: { nowMs: () => PROMISE, utcOffsetMs: 0 },
    config: { snapshot: () => null, config: () => ({ zone_undo_ms: 300_000, comp_reason_chips: [] }) },
    me: { staff_id: 'ST-SANA', name: 'Sana' },
    online: true,
    phone: false,
    portrait: false,
  } as unknown as Shell;
  const deps: TapDeps = {
    orders: shell.orders,
    tables: shell.tables,
    heldMap: () => MAP,
    openSlips: () => [],
    seen: vi.fn(),
    openSheet: vi.fn(),
    navigate: (href) => navigate(href),
    toast: vi.fn(),
    arrive: vi.fn(),
  };
  return { shell, reads, deps, live, orders };
}

const row = (target: TapRow['target'], kind = 'engine_line_dropped'): TapRow => ({
  alert_id: 'AL1',
  kind,
  raised_at: PLACED + 60_000,
  state: 'open',
  lock: { kind_label_key: `alerts.kind.${kind}` } as never,
  target,
});

/** a hash change is a task in jsdom: let it run */
const settle = async () => {
  await new Promise((r) => setTimeout(r, 0));
  await flush();
};

let views: Mounted[] = [];
function show(shell: Shell, node: React.ReactNode) {
  const m = mount();
  views.push(m);
  m.render(<ShellContext.Provider value={shell}>{node}</ShellContext.Provider>);
  return m;
}
beforeEach(() => {
  window.location.hash = '/inbox';
});
afterEach(async () => {
  dropHandover();
  vi.useRealTimers();
  for (const v of views) v.unmount();
  views = [];
  setLanguage('en');
  window.location.hash = '';
  await settle();
});

describe('[01d #97] reads per tap', () => {
  it('[01d #97] takeaway order_line tap: exactly one order-view; OrderView\'s first render makes none; a later visit reads fresh', async () => {
    const s = setup({ view: body('O57') });
    await settle();
    expect(await tapAlert(row({ type: 'order_line', order_id: 'O57', order_item_id: 'L3' }), s.deps)).toBe('navigated');
    await settle();
    expect(window.location.hash).toBe('#/orders/O57?focus=line%3AL3');
    expect(s.reads).toEqual(['order-view']);
    const m = show(s.shell, <OrderView order_id="O57" />);
    await flush();
    expect(s.reads).toEqual(['order-view']);
    // drawn from the handed-over body at once: the lines and their stages, the place findable
    expect(m.container.querySelector('[data-order="O57"]')).not.toBeNull();
    expect(m.container.querySelector('.ol[data-line="L3"]')).not.toBeNull();
    expect([...m.container.querySelectorAll('.ol .stg')].length).toBeGreaterThan(0);
    m.unmount();
    views = [];
    // the same route again, mounted anew: the handover was taken once, so this is a normal read
    const again = show(s.shell, <OrderView order_id="O57" />);
    await flush();
    expect(s.reads).toEqual(['order-view', 'order-view']);
    again.unmount();
    views = [];
    // a later visit after leaving: fresh
    navigate('/orders');
    await settle();
    navigate('/orders/O57');
    await settle();
    show(s.shell, <OrderView order_id="O57" />);
    await flush();
    expect(s.reads).toEqual(['order-view', 'order-view', 'order-view']);
  });

  it('[01d #97] a handover not taken is dropped at the next hash change to another route', async () => {
    const s = setup({ view: body('O57') });
    await settle();
    await tapAlert(row({ type: 'order_line', order_id: 'O57', order_item_id: 'L3' }), s.deps);
    await settle();
    // the person goes elsewhere before OrderView mounts, then comes back
    navigate('/tables');
    await settle();
    navigate('/orders/O57');
    await settle();
    show(s.shell, <OrderView order_id="O57" />);
    await flush();
    expect(s.reads).toEqual(['order-view', 'order-view']);
  });

  it('[01d #97] zone tap: one zone-stock, reused by #/zones; a later visit reads fresh', async () => {
    const tapped: ZoneStockBody[] = [{ zone_id: 'FH', name: 'Family hall', items: [{ item_id: 'raita', name: 'Raita', on_hand: 2, threshold: 4 }] }];
    const s = setup({ view: body('O57'), zones: tapped });
    await settle();
    expect(await tapAlert(row({ type: 'zone_item', zone_id: 'FH', item_id: 'raita' }, 'zone_stock_low'), s.deps)).toBe('navigated');
    await settle();
    expect(window.location.hash).toBe('#/zones?focus=item%3AFH%3Araita');
    expect(s.reads).toEqual(['zone-stock']);
    const m = show(s.shell, <ZoneStock />);
    await flush();
    expect(s.reads).toEqual(['zone-stock']);
    expect(m.container.querySelector('[data-zone-item="FH:raita"] .n')?.textContent).toBe('2');
    m.unmount();
    views = [];
    navigate('/tables');
    await settle();
    navigate('/zones');
    await settle();
    show(s.shell, <ZoneStock />);
    await flush();
    expect(s.reads).toEqual(['zone-stock', 'zone-stock']);
  });

  it('[01d #97] dine-in tap with a fresh held map: order-view + the sheet\'s seating-orders, no table-map by the tap', async () => {
    const s = setup({ view: body('O4', { order_type: 'dine_in', seating_id: 'S4' }) });
    await settle();
    expect(await tapAlert(row({ type: 'order_line', order_id: 'O4', order_item_id: 'L3' }), s.deps)).toBe('navigated');
    await settle();
    expect(window.location.hash).toBe('#/tables/F4?seating_id=S4&focus=line%3AL3');
    show(
      s.shell,
      <div className="tv__b">
        <OrdersPart seating_id="S4" table_ids={['F4']} primary_table_id="F4" holder_staff_id="ST-SANA" mine />
      </div>,
    );
    await flush();
    expect(s.reads).toEqual(['order-view', 'seating-orders']);
    expect(s.reads).not.toContain('table-map');
    // the dine-in body is not for #/orders/<id>: a later OrderView of that order reads fresh
    navigate('/orders/O4');
    await settle();
    show(s.shell, <OrderView order_id="O4" />);
    await flush();
    expect(s.reads.filter((r) => r === 'order-view')).toHaveLength(2);
  });

  it('[01d #97] two quick taps, O57 then O58, in the same OrderView: O58 is drawn from its own body, never O57\'s', async () => {
    const o58 = body('O58', { lines: [sl(line({ order_id: 'O58', order_item_id: 'M1', name: 'Zinger' }), 'cooking')] });
    const s = setup({ view: body('O57'), others: [o58] });
    await settle();
    await tapAlert(row({ type: 'order_line', order_id: 'O57', order_item_id: 'L3' }), s.deps);
    await settle();
    const m = show(s.shell, <OrderView order_id="O57" />);
    await flush();
    expect(m.container.querySelector('.ol[data-line="L3"]')).not.toBeNull();
    await tapAlert(row({ type: 'order_line', order_id: 'O58', order_item_id: 'M1' }), s.deps);
    await settle();
    // slots.tsx reuses the one OrderView for the new order_id
    m.render(
      <ShellContext.Provider value={s.shell}>
        <OrderView order_id="O58" />
      </ShellContext.Provider>,
    );
    expect(m.container.querySelector('.ol[data-line="L3"]')).toBeNull();
    await flush();
    expect(m.container.querySelector('.ol[data-line="M1"]')).not.toBeNull();
    expect(m.container.querySelector('.ol[data-line="L3"]')).toBeNull();
    expect(m.container.querySelector('[data-order="O58"]')).not.toBeNull();
    expect(s.reads).toEqual(['order-view', 'order-view']);
    // and with no handover for the next order: no other order's lines while it is read
    navigate('/orders/O57');
    await settle();
    m.render(
      <ShellContext.Provider value={s.shell}>
        <OrderView order_id="O57" />
      </ShellContext.Provider>,
    );
    expect(m.container.querySelector('.ol[data-line="M1"]')).toBeNull();
    await flush();
    expect(m.container.querySelector('.ol[data-line="L3"]')).not.toBeNull();
    expect(s.reads).toEqual(['order-view', 'order-view', 'order-view']);
  });

  it('[01d #97] the tap lands on a screen already open: #/zones applies the handover; a remount later (sign-out, sign-in) reads fresh', async () => {
    const tapped: ZoneStockBody[] = [{ zone_id: 'FH', name: 'Family hall', items: [{ item_id: 'raita', name: 'Raita', on_hand: 1, threshold: 4 }] }];
    const s = setup({ view: body('O57'), zones: tapped });
    navigate('/zones');
    await settle();
    const m = show(s.shell, <ZoneStock />);
    await flush();
    expect(s.reads).toEqual(['zone-stock']);
    await tapAlert(row({ type: 'zone_item', zone_id: 'FH', item_id: 'raita' }, 'zone_stock_low'), s.deps);
    await settle();
    expect(s.reads).toEqual(['zone-stock', 'zone-stock']);
    expect(m.container.querySelector('[data-zone-item="FH:raita"] .n')?.textContent).toBe('1');
    // nothing is left held: the same hash, the screen mounted anew, reads
    m.unmount();
    views = [];
    show(s.shell, <ZoneStock />);
    await flush();
    expect(s.reads).toEqual(['zone-stock', 'zone-stock', 'zone-stock']);
  });

  it('[01d #97] the tap lands on the order already open: OrderView applies it; a remount later reads fresh', async () => {
    const s = setup({ view: body('O57') });
    navigate('/orders/O57');
    await settle();
    const m = show(s.shell, <OrderView order_id="O57" />);
    await flush();
    expect(s.reads).toEqual(['order-view']);
    await tapAlert(row({ type: 'order_line', order_id: 'O57', order_item_id: 'L3' }), s.deps);
    await settle();
    expect(s.reads).toEqual(['order-view', 'order-view']);
    expect(peekOrderView('O57')).toBeNull();
    m.unmount();
    views = [];
    show(s.shell, <OrderView order_id="O57" />);
    await flush();
    expect(s.reads).toEqual(['order-view', 'order-view', 'order-view']);
  });

  it('[01d #97] a handover no screen takes is dropped after HANDOVER_MS, so a remount on the same hash then reads', async () => {
    vi.useFakeTimers();
    window.location.hash = '/orders/O57';
    handOver({ order_view: body('O57') });
    expect(peekOrderView('O57')).not.toBeNull();
    vi.advanceTimersByTime(HANDOVER_MS - 1);
    expect(peekOrderView('O57')).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(takeOrderView('O57')).toBeNull();
  });

  it('[01d #97] a handover is only ever served on its own route', () => {
    // for #/orders/O57, asked on #/zones, on another order, and by the zone screen
    window.location.hash = '/zones';
    handOver({ order_view: body('O57') });
    expect(takeOrderView('O57')).toBeNull();
    expect(takeZoneStock()).toBeNull();
    window.location.hash = '/orders/O58';
    expect(takeOrderView('O58')).toBeNull();
    expect(takeOrderView('O57')).toBeNull();
    // still held for its own route (the hash change event has not run yet)
    window.location.hash = '/orders/O57';
    expect(takeOrderView('O57')?.order_id).toBe('O57');
    // for #/zones, asked on an order view and on a table
    handOver({ zone_stock: ZONES });
    window.location.hash = '/orders/O57';
    expect(takeZoneStock()).toBeNull();
    expect(takeOrderView('O57')).toBeNull();
    window.location.hash = '/tables/F4?seating_id=S4';
    expect(takeZoneStock()).toBeNull();
    window.location.hash = '/zones?focus=item:FH:raita';
    expect(takeZoneStock()).toEqual(ZONES);
  });

  it('[01d #97] after a handover, frames still read again: OrderView on an order frame, #/zones on a ZoneStock frame', async () => {
    const s = setup({ view: body('O57') });
    await settle();
    await tapAlert(row({ type: 'order_line', order_id: 'O57', order_item_id: 'L3' }), s.deps);
    await settle();
    show(s.shell, <OrderView order_id="O57" />);
    await flush();
    expect(s.reads).toEqual(['order-view']);
    s.live.frame({ type: 'event', seq: 4, event: { event_id: 'E4', event_type: 'ItemServed', schema_version: 1, payload: { order_id: 'O57', order_item_ids: ['L1'] } } } as never);
    await new Promise((r) => setTimeout(r, 300));
    await flush();
    expect(s.reads).toEqual(['order-view', 'order-view']);
    for (const v of views) v.unmount();
    views = [];
    await tapAlert(row({ type: 'zone_item', zone_id: 'FH', item_id: 'raita' }, 'zone_stock_low'), s.deps);
    await settle();
    show(s.shell, <ZoneStock />);
    await flush();
    expect(s.reads).toEqual(['order-view', 'order-view', 'zone-stock']);
    s.live.frame({ type: 'event', seq: 5, event: { event_id: 'E5', event_type: 'ZoneStockSet', schema_version: 1, payload: { zone_id: 'FH', item_id: 'raita', on_hand: 9 } } } as never);
    await new Promise((r) => setTimeout(r, 300));
    await flush();
    expect(s.reads).toEqual(['order-view', 'order-view', 'zone-stock', 'zone-stock']);
  });

  it('[01d #97] a read in flight when the handover is applied answers older data: it is dropped, the tap\'s body stays', async () => {
    const tapBody = body('O57', { lines: [sl(line({ order_id: 'O57', order_item_id: 'NEW', name: 'Fresh line' }), 'cooking')] });
    const s = setup({ view: tapBody });
    navigate('/orders/O57');
    await settle();
    // the view's own mount read is slow and answers the order as it was before
    let answerOld: () => void = () => {};
    s.orders.orderView.mockImplementationOnce(
      (async () => {
        await new Promise<void>((r) => (answerOld = r));
        return ok({ kind: 'order' as const, order: body('O57') });
      }) as never,
    );
    const m = show(s.shell, <OrderView order_id="O57" />);
    await flush();
    // the tap lands while that read is out
    await tapAlert(row({ type: 'order_line', order_id: 'O57', order_item_id: 'NEW' }), s.deps);
    await settle();
    expect(m.container.querySelector('.ol[data-line="NEW"]')).not.toBeNull();
    answerOld();
    await settle();
    expect(m.container.querySelector('.ol[data-line="NEW"]')).not.toBeNull();
    expect(m.container.querySelector('.ol[data-line="L3"]')).toBeNull();
    // a later frame read still answers
    s.live.frame({ type: 'event', seq: 7, event: { event_id: 'E7', event_type: 'ItemServed', schema_version: 1, payload: { order_id: 'O57', order_item_ids: ['NEW'] } } } as never);
    await new Promise((r) => setTimeout(r, 300));
    await flush();
    expect(s.orders.orderView).toHaveBeenCalledTimes(3); // mount (slow), tap, frame
  });

  it('[01d #97] a stale tap hands nothing over: the screen then reads as before', async () => {
    const s = setup({ view: body('O57') });
    await settle();
    expect(await tapAlert(row({ type: 'order_line', order_id: 'O57', order_item_id: 'L3' }), { ...s.deps, isCurrent: () => false })).toBe('stale');
    expect(peekOrderView('O57')).toBeNull();
    navigate('/orders/O57');
    await settle();
    expect(peekOrderView('O57')).toBeNull();
    show(s.shell, <OrderView order_id="O57" />);
    await flush();
    expect(s.reads).toEqual(['order-view', 'order-view']);
  });
});
