import { act } from 'react';
import { afterEach, vi } from 'vitest';
import { describe, expect, it } from 'vitest';
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

// 02b v1.0.11 §8 Zone items, §3.5 (frames ZoneUndo, ZoneUndoLate).

const raita = (added_at: number) => sline('Raita', { name: 'Raita', zone_served: true, served_from_zone_id: 'ZN', served_source: 'zone', served_at: added_at, stage: null, units: 2, live_units: 2, quantity: 2, added_at, billed_minor: 16_000 });
const body = (added_at: number) => ({ orders: [sorder('O2', at(20, 10), [raita(added_at), sline('Karahi', { stage: 'cooking' })])], total_minor: 0 });

describe('[02b §8 Zone items] zone undo', () => {
  it('[02b §8 Zone items] Undo · m:ss for zone_undo_ms from added_at on the hub clock, never a fixed 5 min', async () => {
    // a branch with a 2 min window, the line added 30 s ago (hub clock) → 1:30 left
    const s = part({ body: body(NOW - 30_000), zone_undo_ms: 120_000 });
    await flush();
    s.select('Raita');
    expect(s.ctrl()?.textContent).toContain('Undo · 1:30');
    expect(s.ctrl()?.textContent).toContain('Puts 2 back in the Family hall count');
    s.m.unmount();
    const t = part({ body: body(NOW - 30_000), zone_undo_ms: 600_000 });
    await flush();
    t.select('Raita');
    expect(t.ctrl()?.textContent).toContain('Undo · 9:30');
  });

  it('[02b §8 Zone items] Undo = RemoveItems of that line, then ReleaseTableLock', async () => {
    const order: string[] = [];
    const s = part({ body: body(NOW - 30_000), command: async (type) => (order.push(type), { ok: true, data: { removed: [] } }) });
    s.releaseTableLock.mockImplementation(async () => (order.push('ReleaseTableLock'), { ok: true as const, data: { released: true } }));
    await flush();
    s.select('Raita');
    s.m.click(s.m.button('Undo', s.ctrl()!));
    await flush();
    expect(s.command).toHaveBeenCalledWith('RemoveItems', { order_id: 'O2', seating_id: 'S4', lines: [{ order_item_id: 'Raita', units: 2 }] }, { commandId: expect.any(String) });
    expect(s.releaseTableLock).toHaveBeenCalledWith({ table_id: 'F4', seating_id: 'S4' });
    expect(order).toEqual(['RemoveItems', 'ReleaseTableLock']);
    // the view reads its orders again
    expect(s.orders.seatingOrders).toHaveBeenCalledTimes(2);
  });

  it('[02b §8 Zone items] after the window: "Too late to undo here" + Zone stock', async () => {
    const s = part({ body: body(NOW - 301_000), zone_undo_ms: 300_000 });
    await flush();
    s.select('Raita');
    expect(s.ctrl()?.textContent).toContain('Too late to undo here. Fix the count on the zone screen.');
    expect(s.ctrl()?.textContent).not.toContain('Undo ·');
    s.m.click(s.m.button('Zone stock', s.ctrl()!));
    expect(window.location.hash).toBe('#/zones');
  });
});

describe('[02b §8 Zone items] undo retry — review #185', () => {
  it('[02b §8 Zone items] a lost reply: Undo again sends the same command_id; ReleaseTableLock only after the 2xx', async () => {
    let n = 0;
    const s = part({ body: body(NOW - 30_000), command: async (type) => (type === 'RemoveItems' && ++n === 1 ? { ok: false, error: { kind: 'network' } } : ok({ removed: [] })) });
    await flush();
    s.select('Raita');
    s.m.click(s.m.button('Undo', s.ctrl()!));
    await flush();
    expect(s.shell.toasts.current()?.text).toBe('No answer from the hub — try again');
    expect(s.releaseTableLock).not.toHaveBeenCalled();
    s.m.click(s.m.button('Undo', s.ctrl()!));
    await flush();
    const calls = s.command.mock.calls.filter((c) => c[0] === 'RemoveItems');
    expect(calls).toHaveLength(2);
    expect(calls[1]![2]?.commandId).toBe(calls[0]![2]?.commandId);
    expect(s.releaseTableLock).toHaveBeenCalledTimes(1);
  });
});

describe('[02b §8 Zone items] undo rules — review #185 round 2', () => {
  it('[02b §8 Zone items] the window is inclusive: at exactly zone_undo_ms Undo still shows (0:00)', async () => {
    const s = part({ body: body(NOW - 300_000), zone_undo_ms: 300_000 });
    await flush();
    s.select('Raita');
    expect(s.ctrl()?.textContent).toContain('Undo · 0:00');
  });

  it('[02b §8 Zone items] no Undo on a billed order, none without take-order, and offline it says "Needs the hub"', async () => {
    const billed = part({ body: { orders: [sorder('O2', at(20, 10), [raita(NOW - 30_000), sline('Karahi', { stage: 'cooking' })], { billed: true })], total_minor: 0 } });
    await flush();
    billed.select('Raita');
    expect(billed.ctrl()?.textContent ?? '').not.toContain('Undo');
    billed.m.unmount();
    // take-order-anywhere alone is not enough (the hub's RemoveItems needs take-order)
    const anywhere = part({ body: body(NOW - 30_000), perms: { 'take-order-anywhere': { grant: 'allowed', scope: 'branch' } } });
    await flush();
    anywhere.select('Raita');
    expect(anywhere.ctrl()?.textContent ?? '').not.toContain('Undo');
    anywhere.m.unmount();
    const off = part({ body: body(NOW - 30_000), online: false });
    await flush();
    off.select('Raita');
    off.m.click(off.m.button('Undo', off.ctrl()!));
    await flush();
    expect(off.shell.toasts.current()?.text).toBe('Needs the hub');
    expect(off.command).not.toHaveBeenCalled();
  });
});
