import { act } from 'react';
import { afterEach, vi } from 'vitest';
import { describe, expect, it } from 'vitest';
import { createStaffApi, type Device, type PageMeta } from '../../api';
import { createEnqueue } from '../queue/enqueue';
import { createMemoryQueueStore } from '../queue/memory-store';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import { setLanguage } from '../../../../i18n';
import type { Resolution } from '../../api';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus, type LiveBus } from '../../shell/live';
import { createPermissions } from '../../shell/permissions';
import { createToastBus } from '../../shell/toast';
import type { Enqueue, MapTile, TableMapBody } from '../../tables/contracts';
import type { CatchUpOrder, OrdersApi, SeatingLine, SeatingOrder, SeatingOrdersBody } from '../contracts';
import { LateAlertsContext, type LateAlertRow } from '../late/late-groups';
import { OrdersPart } from '../table-view/OrdersPart';

const OFFSET = 5 * 3_600_000;
const NOW = Date.UTC(2026, 10, 13, 15, 15); // 8:15 PM
const at = (h: number, m: number) => Date.UTC(2026, 10, 13, h - 5, m);

function sline(order_item_id: string, over: Partial<SeatingLine> = {}): SeatingLine {
  return {
    order_item_id,
    order_id: 'O2',
    parent_order_item_id: null,
    line_kind: 'item',
    item_id: `I-${order_item_id}`,
    deal_id: null,
    name: order_item_id,
    sale_unit: 'piece',
    quantity: 1,
    units: 1,
    live_units: 1,
    comped_units: 0,
    removed_units: 0,
    voided_units: 0,
    returned_units: 0,
    refundable_minor: 50_000,
    comp_minor: 0,
    comp_voided_minor: 0,
    removed_minor: 0,
    refund_minor: 0,
    line_total_minor: 50_000,
    billed_minor: 50_000,
    return_of: null,
    served_from_zone_id: null,
    zone_served: false,
    added_at: NOW - 5 * 60_000,
    served_at: null,
    served_source: null,
    is_food: true,
    kitchen_note: null,
    stage: 'added',
    fired: true,
    ...over,
  };
}

function sorder(order_id: string, placed_at: number, lines: SeatingLine[], over: Partial<SeatingOrder> = {}): SeatingOrder {
  return {
    order_id,
    placed_by: { staff_id: 'ST-ALI', name: 'Ali' },
    placed_at,
    follow_up: false,
    cancelled: false,
    billed: false,
    has_phone: false,
    promise_ms: null,
    lines: lines.map((l) => ({ ...l, order_id })),
    ...over,
  };
}

function tile(table_id: string, over: Partial<MapTile> = {}): MapTile {
  return {
    table_id,
    name: table_id,
    seats: 4,
    archived: false,
    state: 'ORDERED',
    seating_id: 'S4',
    party_size: 4,
    primary_table_id: 'F4',
    joined_table_names: [],
    holder: { staff_id: 'ST-ALI', name: 'Ali' },
    assignee: null,
    lock: null,
    opened_at: NOW - 30 * 60_000,
    bill_requested_at: null,
    live_order_count: 1,
    ...over,
  };
}

const ok = <T,>(data: T) => ({ ok: true as const, data });

const TAKER: Record<string, Resolution> = {
  'take-order': { grant: 'allowed', scope: 'branch' },
  'mark-served': { grant: 'allowed', scope: 'branch' },
  'apply-comp': { grant: 'requires_approval', approver_role_ids: ['R'], scope: 'branch' },
  'mark-item-returned': { grant: 'allowed', scope: 'branch' },
};

interface Setup {
  body?: SeatingOrdersBody;
  perms?: Record<string, Resolution>;
  catchUpOrders?: CatchUpOrder[];
  openSlips?: Array<{ alert_id: string; order_ids: string[] }>;
  rows?: LateAlertRow[];
  table_ids?: string[];
  tiles?: MapTile[];
  online?: boolean;
  enqueue?: Enqueue;
  zone_undo_ms?: number;
  config?: Record<string, unknown>;
  command?: (type: string, payload: unknown, opts?: { commandId?: string }) => Promise<unknown>;
  live?: LiveBus;
}

let current: Mounted | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
  setLanguage('en');
  window.location.hash = '';
});

function part(o: Setup = {}) {
  const live = o.live ?? createLiveBus();
  const map: TableMapBody = { as_of_seq: 2, floors: [{ floor_id: 'FL', name: 'Family hall', archived: false, zones: [{ zone_id: 'Z1', name: 'Family hall', tables: o.tiles ?? [tile('F4'), tile('F5')] }] }] };
  const ordersPart = { orders: o.catchUpOrders ?? [], zone_stock: [], ...(o.openSlips === undefined ? {} : { open_slips: o.openSlips }) };
  if (o.live === undefined) live.frame({ type: 'catch_up', as_of_seq: 2, state: { tables: map, orders: ordersPart } } as never);
  let body = o.body ?? { orders: [], total_minor: 0 };
  const orders = {
    seatingOrders: vi.fn(async () => ok(body)),
    releaseItems: vi.fn(async () => ok({ alerts_closed: 2 })),
  };
  const command = vi.fn<(type: string, payload: unknown, opts?: { commandId?: string }) => Promise<unknown>>(o.command ?? (async () => ok({})));
  const enqueue =
    o.enqueue ??
    (Object.assign(
      vi.fn(async () => ({ status: 'sent' as const, result: { served: 1, skipped: [] } })),
      { pendingFor: () => 0, pendingCount: () => 0, subscribe: () => () => {} },
    ) as unknown as Enqueue);
  const releaseTableLock = vi.fn(async () => ok({ released: true }));
  const shell = {
    device: { token: 'D', id: 'DEV', type: 'tablet' },
    live,
    orders: orders as unknown as OrdersApi,
    api: { command },
    tables: { tableMap: vi.fn(async () => ok(map)), releaseTableLock },
    permissions: createPermissions(o.perms ?? TAKER),
    toasts: createToastBus(),
    enqueue,
    clock: { nowMs: () => NOW, utcOffsetMs: OFFSET },
    config: {
      config: () => ({ zone_undo_ms: o.zone_undo_ms ?? 300_000, comp_reason_chips: ['Late'] }),
      snapshot: () => ({ items: [], deals: [], goes_with: [], floors: [{ zones: [{ zone_id: 'ZN', name: 'Family hall' }] }], ...(o.config ?? {}) }),
    },
    me: { staff_id: 'ST-ALI', name: 'Ali' },
    online: o.online ?? true,
    phone: false,
    portrait: false,
  } as unknown as Shell;
  const m = mount();
  current = m;
  const node = (
    <ShellContext.Provider value={shell}>
      <LateAlertsContext.Provider value={o.rows ?? []}>
        <div className="tv__b">
          <OrdersPart seating_id="S4" table_ids={o.table_ids ?? ['F4', 'F5']} primary_table_id="F4" holder_staff_id="ST-ALI" mine />
        </div>
      </LateAlertsContext.Provider>
    </ShellContext.Provider>
  );
  m.render(node);
  const select = (id: string) => m.click(m.container.querySelector(`.ol[data-line="${id}"]`));
  const ctrl = () => m.container.querySelector('.ol.sel .ol__ctrl');
  return {
    m,
    shell,
    live,
    orders,
    command,
    releaseTableLock,
    select,
    ctrl,
    setBody: (b: SeatingOrdersBody) => (body = b),
    frame: (seq: number, event_type: string, payload: Record<string, unknown>) =>
      act(() => live.frame({ type: 'event', seq, event: { event_id: `E${seq}`, event_type, schema_version: 1, payload } })),
    flush,
  };
}

// 02b v1.0.11 §8 Table view (02-S06 TableView, TableViewWaiter, TableViewOffline; #36; Q-6, Q-7): the orders part.

describe('[02b §8 Table view] orders part', () => {
  const r2 = sorder('O2', at(20, 10), [sline('Karahi', { name: 'Chicken Karahi — Full', stage: 'cooking', kitchen_note: 'less spicy', billed_minor: 220_000 }), sline('Extra', { name: 'Extra naan', line_kind: 'option_child', parent_order_item_id: 'Karahi', stage: null, units: 2, live_units: 2, billed_minor: 8_000 }), sline('Naan', { stage: 'done', units: 6, live_units: 6, billed_minor: 24_000 }), sline('Kebab', { name: 'Seekh Kebab', stage: 'added', units: 4, live_units: 4, billed_minor: 140_000 })], { promise_ms: at(20, 29) });
  const r1 = sorder('O1', at(19, 45), [sline('Old', { stage: 'served', served_at: at(19, 55), billed_minor: 100_000 })]);
  const r3 = sorder('O3', at(20, 14), [sline('Fish', { sale_unit: 'g', quantity: null, line_total_minor: null, billed_minor: 0, refundable_minor: 0, stage: 'added', fired: false })], {
    placed_by: { staff_id: 'ST-SANA', name: 'Sana' },
    promise_ms: at(20, 38),
  });
  const BODY = { orders: [r3, r1, r2], total_minor: 492_000 };

  it('[02b #36] rounds by time and person with promise and stage words', async () => {
    const s = part({ body: BODY });
    await flush();
    const rounds = [...s.m.container.querySelectorAll('.rnd')].map((r) => r.querySelector('.rnd__h')?.textContent);
    // open rounds by time (Round 2, Round 3), the served round folded at the end
    expect(rounds).toEqual(['Round 28:10 PM · AliFood at 8:29 PM', 'Round 38:14 PM · SanaFood at 8:38 PM', 'Round 17:45 PM · AliServed1 items']);
    const r = s.m.container.querySelector('.rnd[data-order="O2"]')!;
    expect([...r.querySelectorAll('.ol')].map((x) => [x.querySelector('.ol__n b')?.textContent, x.querySelector('.stg')?.textContent ?? null])).toEqual([
      ['Chicken Karahi — Full', 'Cooking'],
      ['+ Extra naan', null],
      ['Naan', 'Ready'],
      ['Seekh Kebab', 'Sent to kitchen'],
    ]);
    expect(s.m.container.querySelector('.rnd[data-order="O1"] .ol')).toBeNull();
    s.m.click(s.m.container.querySelector('.rnd[data-order="O1"] .rnd__h'));
    expect(s.m.container.querySelector('.rnd[data-order="O1"] .ol')?.textContent).toContain('Served · 7:55 PM');
    const sec = s.m.container.querySelector('.tv__sec')!.textContent;
    expect(sec).toContain('3 orders');
    expect(sec).toContain('Rs 4,920');
    expect(sec).toContain('+ 1 to weigh');
    expect(s.orders.seatingOrders).toHaveBeenCalledWith('S4');
  });

  it('[02b §8 Table view] waiter: only Mark served', async () => {
    const s = part({ body: BODY, perms: { 'mark-served': { grant: 'allowed', scope: 'branch' } } });
    await flush();
    s.select('Naan');
    expect([...s.ctrl()!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Mark served']);
    s.select('Kebab');
    expect([...s.ctrl()!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Mark served']);
    // the sheet offers every fired line of the table, by round
    s.m.click(s.m.button('Mark served', s.ctrl()!));
    expect([...s.m.container.querySelectorAll('.dlg .ckr')].map((c) => [c.getAttribute('data-line'), c.querySelector('small')?.textContent])).toEqual([
      ['Karahi', 'Round 2'],
      ['Naan', 'Round 2'],
      ['Kebab', 'Round 2'],
    ]);
  });

  it('[02b Q-7] order note at the round header', async () => {
    const s = part({ body: { orders: [{ ...r2, order_note: 'birthday — bring together' }, r3], total_minor: 0 } });
    await flush();
    expect(s.m.container.querySelector('.rnd[data-order="O2"] .rnd__h')?.textContent).toContain('“birthday — bring together”');
    // H2 not on the hub: no order_note field → no note line
    expect(s.m.container.querySelector('.rnd[data-order="O3"] .rnd__h')?.textContent).not.toContain('“');
  });

  it('[02b Q-6] no Refresh line; "Updated {time}" only offline', async () => {
    const online = part({ body: BODY });
    await flush();
    expect(online.m.text()).not.toContain('Refresh');
    expect(online.m.text()).not.toContain('Updated');
    online.m.unmount();
    const offline = part({ body: BODY, online: false });
    await flush();
    expect(offline.m.container.querySelector('.tv__sec')?.textContent).toContain('Updated 8:15 PM');
    expect(offline.m.text()).not.toContain('Refresh');
  });

  it('[02b §8 Table view] offline: queued round dashed "Waiting to send"; Mark served queues', async () => {
    const device: Device = { token: 'DEV', id: 'DEV', type: 'tablet' };
    const meta: PageMeta = { tenantId: 'T', branchId: 'B', branchName: 'Gulberg', hubNowMs: NOW, utcOffsetMs: OFFSET };
    const fetch = vi.fn(async (input: string) => {
      if (input === '/auth/pin') return new Response(JSON.stringify({ data: { session_token: 'TOK', session_id: 'SE', staff_id: 'ST-ALI', display_name: 'Ali', role_ids: [], idle_ttl_ms: 1 } }), { status: 200 });
      throw new TypeError('Failed to fetch');
    });
    const api = createStaffApi({ device, meta, fetch, onSignedOut: () => {} });
    await api.signIn('ST-ALI', '1234', false);
    const live = createLiveBus();
    live.frame({ type: 'catch_up', as_of_seq: 2, state: { tables: { as_of_seq: 2, floors: [{ floor_id: 'FL', name: null, archived: false, zones: [{ zone_id: null, name: null, tables: [tile('F4'), tile('F5')] }] }] }, orders: { orders: [], zone_stock: [] } } } as never);
    const enqueue = createEnqueue({
      api,
      device,
      clock: () => ({ nowMs: () => NOW, utcOffsetMs: OFFSET }),
      live,
      store: createMemoryQueueStore(),
      onDeviceRevoked: () => {},
      presence: () => ({ ownedElsewhere: async () => new Set<string>(), announceRemoved: () => {}, onRemoved: () => () => {}, dispose: () => {} }),
    });
    await act(async () => {
      await enqueue('SubmitOrder', { order_id: 'O4', order_type: 'dine_in', table_id: 'F4', seating_id: 'S4', lines: [{ order_item_id: 'Q1', item_id: 'NAAN', quantity: 1 }] }, { label: 'F4', table_id: 'F4', seating_id: 'S4' });
    });
    const s = part({ body: BODY, online: false, enqueue, live, config: { items: [{ item_id: 'NAAN', name: 'Naan', sale_unit: 'piece', price_minor: 4_000, modifier_group_ids: [] }], modifier_groups: [] } });
    await flush();
    const q = s.m.container.querySelector('.rnd.q')!;
    expect(q.querySelector('.rnd__h')?.textContent).toContain('Round 4');
    expect(q.querySelector('.rnd__h')?.textContent).toContain('Waiting to send');
    expect(q.querySelector('.ol')?.textContent).toContain('1×Naan');
    // the queued line's amount, as the cart prices it (frame TableViewOffline "Rs 40")
    expect(q.querySelector('.ol .ol__p')?.textContent).toBe('Rs 40');
    // Mark served offline goes to the queue
    s.select('Naan');
    s.m.click(s.m.button('Mark served', s.ctrl()!));
    s.m.click(s.m.button('Mark 1 served'));
    await flush();
    expect(s.shell.toasts.current()?.text).toBe('Will be sent when the hub is back');
    s.select('Naan');
    s.select('Naan');
    expect(s.ctrl()?.textContent).toContain('Queued — sent when the hub is back');
  });
});

describe('[02b Q-6] orders part reads — review #185', () => {
  const r2 = sorder('O2', at(20, 10), [sline('Naan', { stage: 'cooking' })]);
  const r2done = sorder('O2', at(20, 10), [sline('Naan', { stage: 'done' })]);

  it('[02b Q-6] IR-6: a stage frame during the mount read drops its reply; the follow-up read answers', async () => {
    vi.useFakeTimers();
    try {
      const s = part({ body: { orders: [r2], total_minor: 0 } });
      // the mount read is in flight (its promise has not been awaited yet) when ItemDone for this seating arrives
      s.frame(40, 'ItemDone', { order_item_ids: ['Naan'] });
      s.setBody({ orders: [r2done], total_minor: 0 });
      await flush();
      expect(s.m.text()).not.toContain('Cooking');
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      await flush();
      expect(s.orders.seatingOrders).toHaveBeenCalledTimes(2);
      expect(s.m.container.querySelector('.ol[data-line="Naan"] .stg')?.textContent).toBe('Ready');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('[02a §8] seating change — review #185 round 2', () => {
  it('[02a §8] a new seating shows none of the old seating\'s orders, even before its read answers', async () => {
    const s = part({ body: { orders: [sorder('O2', at(20, 10), [sline('Naan', { stage: 'done' })])], total_minor: 0 } });
    await flush();
    expect(s.m.container.querySelector('.ol[data-line="Naan"]')).not.toBeNull();
    s.orders.seatingOrders.mockImplementation(() => new Promise(() => {}));
    s.m.render(
      <ShellContext.Provider value={s.shell}>
        <LateAlertsContext.Provider value={[]}>
          <div className="tv__b">
            <OrdersPart seating_id="S9" table_ids={['F4']} primary_table_id="F4" holder_staff_id="ST-ALI" mine />
          </div>
        </LateAlertsContext.Provider>
      </ShellContext.Provider>,
    );
    expect(s.m.container.querySelector('.ol')).toBeNull();
  });
});

describe('[02b §8 Table view E-7] 26d binding', () => {
  it('[02b §8 Table view E-7] the order screen\'s comp-it announce reaches the prompt; "Send it as a new item" puts the item in the seating\'s draft', async () => {
    const { announceCompIt } = await import('../send/send');
    const { DraftStoreContext } = await import('../order-screen/OrderScreen');
    const { createMemoryDraftStore } = await import('../drafts/memory-drafts');
    const remade = sline('K', { name: 'Chicken Karahi', item_id: 'KARAHI', stage: 'returned', returned_units: 1, served_at: NOW - 40 * 60_000 });
    const removed = sline('R', { name: 'Chicken Karahi', item_id: 'KARAHI', return_of: 'K', stage: 'removed', live_units: 0, removed_units: 1 });
    const again = sline('N', { name: 'Chicken Karahi', item_id: 'KARAHI', stage: 'added', billed_minor: 220_000 });
    const drafts = createMemoryDraftStore();
    const s = part({
      body: { orders: [sorder('O1', at(20, 0), [remade, removed, sline('X', { stage: 'cooking' })]), sorder('O5', at(20, 20), [again])], total_minor: 0 },
      config: { items: [{ item_id: 'KARAHI', name: 'Chicken Karahi', sale_unit: 'piece', price_minor: 220_000, modifier_group_ids: [] }], modifier_groups: [] },
    });
    s.m.render(
      <ShellContext.Provider value={s.shell}>
        <DraftStoreContext.Provider value={drafts}>
          <div className="tv__b">
            <OrdersPart seating_id="S4" table_ids={['F4', 'F5']} primary_table_id="F4" holder_staff_id="ST-ALI" mine />
          </div>
        </DraftStoreContext.Provider>
      </ShellContext.Provider>,
    );
    await flush();
    s.select('K');
    s.m.click(s.m.button('Send it as a new item', s.ctrl()!));
    await flush();
    const saved = await drafts.list('DEV', 'ST-ALI');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ order_type: 'dine_in', seating_id: 'S4', table_id: 'F4' });
    expect((saved[0]!.cart as { lines: Array<{ item_id: string; comp_it?: boolean }> }).lines).toEqual([expect.objectContaining({ item_id: 'KARAHI', comp_it: true })]);
    expect(window.location.hash).toBe('#/order/dine_in/S4');

    // the round was sent: 26d announces the comp-it line → "Comp the new …?"
    act(() => announceCompIt({ order_id: 'O5', order_type: 'dine_in', table_id: 'F4', seating_id: 'S4', lines: [] }, { lines: [{ key: 'N', item_id: 'KARAHI', quantity: 1, options: [], comp_it: true }] }));
    expect(s.m.container.querySelector('.dlg')?.textContent).toContain('Comp the new Chicken Karahi?');
  });
});
