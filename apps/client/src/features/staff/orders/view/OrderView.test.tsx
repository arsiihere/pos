import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import { setLanguage } from '../../../../i18n';
import type { Resolution } from '../../api';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import { createPermissions } from '../../shell/permissions';
import { createToastBus } from '../../shell/toast';
import type { Enqueue } from '../../tables/contracts';
import type { CatchUpOrder, LineView, OrdersApi, SeatingLine, SeatingOrder } from '../contracts';
import { OrderView } from './OrderView';

// 02b v1.0.11 §8 Open orders / Table view, §6.18a (02b-S11 OrderView): the takeaway / parking order view.

const OFFSET = 5 * 3_600_000;
const PLACED = Date.UTC(2026, 10, 13, 15, 11); // 8:11 PM
const PROMISE = Date.UTC(2026, 10, 13, 15, 31); // 8:31 PM

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

const LINES: LineView[] = [
  line({ order_item_id: 'L1', served_at: PLACED + 60_000, served_source: 'tap' }),
  line({ order_item_id: 'L2', name: 'Family Deal', quantity: 1, units: 1, live_units: 1, refundable_minor: 0, line_total_minor: 332_000, billed_minor: 332_000, line_kind: 'deal' }),
  line({ order_item_id: 'L3', name: 'Mint Margarita', quantity: 4, units: 4, live_units: 4, line_total_minor: 128_000, billed_minor: 128_000 }),
];

const CAUGHT: CatchUpOrder = {
  order_id: 'O57',
  order_type: 'takeaway',
  table_key: 'takeaway:O57',
  business_date: '2026-11-13',
  token: 57,
  car_number: null,
  car_type: null,
  order_note: null,
  placed_by: 'ST-SANA',
  placed_at: PLACED,
  follow_up: false,
  cancelled: false,
  cancelled_at: null,
  billed: false,
  billed_at: null,
  day_closed_at: null,
  sent_after_reconnect: false,
  has_phone: true,
  lines: LINES,
  customer_name: 'Usman',
};

const sl = (l: LineView, stage: SeatingLine['stage'], fired: boolean): SeatingLine => ({ ...l, stage, fired });

const VIEW: SeatingOrder = {
  order_id: 'O57',
  placed_by: { staff_id: 'ST-SANA', name: 'Sana' },
  placed_at: PLACED,
  follow_up: false,
  cancelled: false,
  billed: false,
  has_phone: true,
  promise_ms: PROMISE,
  lines: [sl(LINES[0]!, 'served', true), sl(LINES[1]!, null, false), sl(LINES[2]!, 'done', true)],
};

const ALL: Record<string, Resolution> = {
  'mark-served': { grant: 'allowed', scope: 'branch' },
  'boost-order': { grant: 'allowed', scope: 'branch' },
  'view-customer-contact': { grant: 'allowed', scope: 'branch' },
  'take-order': { grant: 'allowed', scope: 'branch' },
};

function setup(o: { answer?: 'order' | 'missing'; perms?: Record<string, Resolution>; device?: 'tablet' | 'cashier_kiosk'; order?: CatchUpOrder; orderView?: () => Promise<unknown> } = {}) {
  const live = createLiveBus();
  live.frame({ type: 'catch_up', as_of_seq: 3, state: { orders: { orders: [o.order ?? CAUGHT], zone_stock: [] } } } as never);
  const orders = {
    orderView: vi.fn(o.orderView ?? (async () => ({ ok: true as const, data: o.answer === 'order' ? { kind: 'order' as const, order: VIEW } : { kind: 'missing' as const } }))),
    openOrders: vi.fn(async () => ({ ok: true as const, data: { orders: [] } })),
    orderContact: vi.fn(async () => ({ ok: true as const, data: { customer_name: 'Usman', phone: '03217654321' } })),
    boostOrder: vi.fn(async () => ({ ok: true as const, data: {} })),
  };
  const enqueue = Object.assign(vi.fn(async () => ({ status: 'sent' as const, result: { served: 1, skipped: [] } })), {
    pendingFor: () => 0,
    pendingCount: () => 0,
    subscribe: () => () => {},
  });
  const shell = {
    device: { token: 'D', id: 'DEV', type: o.device ?? 'tablet' },
    live,
    orders: orders as unknown as OrdersApi,
    tables: { tableMap: vi.fn() },
    api: { command: vi.fn(async () => ({ ok: true as const, data: { removed: [] } })) },
    permissions: createPermissions(o.perms ?? ALL),
    toasts: createToastBus(),
    enqueue: enqueue as unknown as Enqueue,
    clock: { nowMs: () => PROMISE, utcOffsetMs: OFFSET },
    config: { snapshot: () => null, config: () => null },
    me: { staff_id: 'ST-SANA', name: 'Sana' },
    online: true,
    phone: false,
    portrait: false,
  } as unknown as Shell;
  const m = mount();
  m.render(
    <ShellContext.Provider value={shell}>
      <OrderView order_id="O57" />
    </ShellContext.Provider>,
  );
  return { m, shell, orders, enqueue, live };
}

let current: Mounted | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
  setLanguage('en');
});

describe('[02b §8 Open orders] order view', () => {
  it('[02b Q-8] order view reads order-view; a 404 route → Served / Not served from the catch-up lines', async () => {
    const fallback = setup({ answer: 'missing' });
    current = fallback.m;
    await flush();
    expect(fallback.orders.orderView).toHaveBeenCalledWith('O57');
    const text = fallback.m.text();
    expect(text).toContain('57');
    expect(text).toContain('Takeaway · Usman');
    expect(text).toContain("Kitchen stages aren't sent for takeaway yet");
    const badges = [...fallback.m.container.querySelectorAll('.ol .bdg')].map((b) => b.textContent);
    expect(badges).toEqual(['Served', 'Not served', 'Not served']);
    // no stage pills, no line actions in the fallback
    expect(fallback.m.container.querySelector('.ol .stg')).toBeNull();
    expect(fallback.m.container.querySelector('.ol[tabindex]')).toBeNull();
    expect(text).toContain('Rs 5,360');
    fallback.m.unmount();

    const real = setup({ answer: 'order' });
    current = real.m;
    await flush();
    const stages = [...real.m.container.querySelectorAll('.ol .stg')].map((b) => b.textContent);
    expect(stages).toEqual(['Served · 8:12 PM', 'Ready']);
    expect(real.m.text()).not.toContain("Kitchen stages aren't sent");
    expect(real.m.text()).toContain('Ready 2/2');
    expect(real.m.text()).toContain('8:31 PM');
    expect(real.m.text()).toContain('Placed 8:11 PM · Sana');
  });

  it('[02b Q-23] kiosk Mark served / Boost from permissions', async () => {
    // the cashier default: mark-served (Q-23), no boost-order
    const kiosk = setup({ answer: 'order', device: 'cashier_kiosk', perms: { 'mark-served': { grant: 'allowed', scope: 'branch' } } });
    current = kiosk.m;
    await flush();
    const acts = [...kiosk.m.container.querySelectorAll('.tv__acts .btn')].map((b) => b.textContent);
    expect(acts).toEqual(['Mark served']);
    kiosk.m.unmount();

    const none = setup({ answer: 'order', device: 'cashier_kiosk', perms: {} });
    current = none.m;
    await flush();
    expect(none.m.container.querySelector('.tv__acts')).toBeNull();
    none.m.unmount();

    const all = setup({ answer: 'order' });
    current = all.m;
    await flush();
    expect([...all.m.container.querySelectorAll('.tv__acts .btn')].map((b) => b.textContent)).toEqual(['Call', 'Boost', 'Mark served']);
  });

  it('[02b §8 Table view] Boost confirms in place', async () => {
    const s = setup({ answer: 'order' });
    current = s.m;
    await flush();
    s.m.click(s.m.button('Boost'));
    const confirm = s.m.container.querySelector('.confirm');
    expect(confirm?.textContent).toContain('Ask the kitchen to hurry order 57?');
    expect(s.orders.boostOrder).not.toHaveBeenCalled();
    s.m.click(s.m.button('Cancel', confirm!));
    expect(s.m.container.querySelector('.confirm')).toBeNull();
    s.m.click(s.m.button('Boost'));
    s.m.click(s.m.button('Boost', s.m.container.querySelector('.confirm')!));
    await flush();
    expect(s.orders.boostOrder).toHaveBeenCalledWith({ order_id: 'O57' });
    expect(s.shell.toasts.current()?.text).toBe('Kitchen told to hurry');
    expect(s.m.container.querySelector('.confirm')).toBeNull();
  });
});

describe('[02b Q-6] order view live refresh', () => {
  const ev = (seq: number, event_type: string, payload: Record<string, unknown>) => ({ type: 'event' as const, seq, event: { event_id: `E${seq}`, event_type, schema_version: 1, payload } });
  const answer = (order: SeatingOrder) => ({ ok: true as const, data: { kind: 'order' as const, order } });

  it('[02b Q-6] stage frames (ItemStarted / ItemDone / ItemDoneUndone / FireDispatched) and order frames → one debounced order-view read; stages, Ready and Mark served pre-ticks follow', async () => {
    vi.useFakeTimers();
    try {
      const cooking: SeatingOrder = { ...VIEW, lines: [VIEW.lines[0]!, VIEW.lines[1]!, sl(LINES[2]!, 'cooking', true)] };
      let reply = answer(cooking);
      const s = setup({ orderView: async () => reply });
      current = s.m;
      await flush();
      expect(s.m.text()).toContain('Cooking');
      expect(s.m.text()).toContain('Ready 1/2');
      expect(s.orders.orderView).toHaveBeenCalledTimes(1);

      reply = answer(VIEW); // L3 is done now
      act(() => {
        s.live.frame(ev(10, 'ItemStarted', { order_item_ids: ['L3'] }));
        s.live.frame(ev(11, 'ItemDone', { order_item_ids: ['L3'] }));
        s.live.frame(ev(12, 'FireDispatched', { order_ids: ['O57'] }));
        // another order's frame: ignored
        s.live.frame(ev(13, 'ItemServed', { order_item_ids: ['OTHER'] }));
      });
      expect(s.orders.orderView).toHaveBeenCalledTimes(1);
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      await flush();
      expect(s.orders.orderView).toHaveBeenCalledTimes(2);
      expect(s.m.text()).toContain('Ready 2/2');
      expect([...s.m.container.querySelectorAll('.ol .stg')].map((b) => b.textContent)).toEqual(['Served · 8:12 PM', 'Ready']);
      // Mark served pre-ticks the ready line
      s.m.click(s.m.button('Mark served'));
      expect(s.m.container.querySelector('.dlg .ckr[data-line="L3"]')?.getAttribute('aria-checked')).toBe('true');
      // no Refresh line, no "Updated" while online
      expect(s.m.text()).not.toContain('Refresh');

      // a reconnect / the page turning visible → one read too
      act(() => s.live.visibility('visible'));
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      expect(s.orders.orderView).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('[02b Q-6] a reply is dropped when a triggering frame came after its request (IR-6); the follow-up read answers', async () => {
    vi.useFakeTimers();
    try {
      const cooking: SeatingOrder = { ...VIEW, lines: [VIEW.lines[0]!, VIEW.lines[1]!, sl(LINES[2]!, 'cooking', true)] };
      const pending: Array<(v: unknown) => void> = [];
      const s = setup({ orderView: () => new Promise((resolve) => pending.push(resolve)) });
      current = s.m;
      // the first read is in flight when ItemDone arrives
      act(() => s.live.frame(ev(20, 'ItemDone', { order_item_ids: ['L3'] })));
      await act(async () => pending.shift()!(answer(cooking)));
      await flush();
      expect(s.m.text()).not.toContain('Cooking');
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      await act(async () => pending.shift()!(answer(VIEW)));
      await flush();
      expect(s.m.text()).toContain('Ready 2/2');
    } finally {
      vi.useRealTimers();
    }
  });

  it('[02b Q-8] a failed first read is retried on reconnect; the fallback lines follow ItemServed frames', async () => {
    vi.useFakeTimers();
    try {
      let first = true;
      const s = setup({
        orderView: async () => {
          if (first) {
            first = false;
            return { ok: false as const, error: { kind: 'network' as const } };
          }
          return { ok: true as const, data: { kind: 'missing' as const } };
        },
      });
      current = s.m;
      await flush();
      expect(s.m.container.querySelector('.ol')).toBeNull();
      act(() => {
        s.live.connection(true);
        s.live.connection(false);
        s.live.connection(true);
      });
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      await flush();
      expect([...s.m.container.querySelectorAll('.ol .bdg')].map((b) => b.textContent)).toEqual(['Served', 'Not served', 'Not served']);
      act(() => s.live.frame(ev(30, 'ItemServed', { order_item_ids: ['L3'] })));
      expect([...s.m.container.querySelectorAll('.ol .bdg')].map((b) => b.textContent)).toEqual(['Served', 'Not served', 'Served']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('[02b §6.2] one order-view read per action; a dine-in order sends Remove with its seating_id', async () => {
    const dine: CatchUpOrder = { ...CAUGHT, order_type: 'dine_in', table_key: 'dine_in:S4', token: null };
    const later: SeatingOrder = { ...VIEW, lines: [sl(LINES[2]!, 'added', true)] };
    const s = setup({ order: dine, orderView: async () => ({ ok: true as const, data: { kind: 'order' as const, order: later } }) });
    current = s.m;
    await flush();
    s.m.click(s.m.container.querySelector('.ol[data-line="L3"]'));
    s.m.click(s.m.button('Remove', s.m.container.querySelector('.ol__ctrl')!));
    s.m.click(s.m.button('Remove 1'));
    await flush();
    expect(s.shell.api.command).toHaveBeenCalledWith('RemoveItems', { order_id: 'O57', seating_id: 'S4', lines: [{ order_item_id: 'L3', units: 1 }] }, { commandId: expect.any(String) });
    expect(s.orders.orderView).toHaveBeenCalledTimes(2);

    // Mark served sent: one read too
    s.m.click(s.m.button('Mark served'));
    s.m.click(s.m.container.querySelector('.dlg .ckr[data-line="L3"]'));
    s.m.click(s.m.button('Mark 1 served'));
    await flush();
    expect(s.enqueue).toHaveBeenCalledTimes(1);
    expect(s.orders.orderView).toHaveBeenCalledTimes(3);
  });
});
