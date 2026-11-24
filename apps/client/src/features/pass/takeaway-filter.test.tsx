import type { LineDetail } from '@pos/domain';
import type { WsServerMessage } from '@pos/events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HubResult } from '../../api/hub-admin';
import { flush, mount, type Mounted } from '../../../test/dom';
import { ShellContext, type Shell } from '../staff/shell/hooks';
import { createLiveBus } from '../staff/shell/live';
import type { PointLine, PointOrder, PointViewBody } from './contracts';
import { passLiveOf } from './live';
import { ordersFor, typeCounts } from './order-filter';
import { createTakeawayPromises } from './takeaway-promises';
import { PassScreen } from './PassScreen';

// 02b-tk C3-4 (03b v1.0.15 §3.4, §6.6, §6.15; frame PackerPass): the Pass filter chip by order type (All / Dine-in /
// Takeaway / Parking) from the lines' `order_type`; Takeaway sorted by promise (open-orders `promise_ms`), the first
// card "Pack next"; a takeaway card's ready button is "Bag ready" = MarkReadyToServe. No bill fields.

function detail(id: string, order_id: string, over: Partial<LineDetail> = {}): LineDetail {
  return {
    order_item_id: id,
    order_id,
    station_id: 'KARAHI',
    point_id: 'PT',
    identifier: { kind: 'table', label: 'T3' },
    order_type: 'dine_in',
    item_name: 'Karahi',
    units: 1,
    line_kind: 'item',
    for_parent: null,
    deal_name: null,
    options: [],
    kitchen_note: null,
    order_note: null,
    return_of: null,
    cook_ms: 1,
    prep_ms: 0,
    from_stock: false,
    placed_by_name: null,
    ...over,
  };
}
const token = (n: number) => ({ kind: 'token' as const, token: n, date: null });
function card(order_id: string, placed_at: number, kind: 'dine_in' | 'takeaway' | 'parking', stage: PointLine['stage'] = 'done'): PointOrder {
  const identifier = kind === 'takeaway' ? token(Number(order_id.slice(1))) : kind === 'parking' ? { kind: 'parking' as const, car_number: 'LEA 123', car_type: 'sedan' as const } : { kind: 'table' as const, label: 'T3' };
  return { order_id, identifier, placed_at, ready: null, lines: [{ ...detail(`${order_id}-L1`, order_id, { identifier, order_type: kind }), stage, handed_over: false }] };
}
const view = (orders: PointOrder[]): PointViewBody => ({ point_id: 'PT', stations: [{ station_id: 'KARAHI', name: 'Karahi', lanes: { lanes_on: 1, lane_count: 1 }, dark: false }], takeovers: [], orders });

const HOUR = 3_600_000;
const BASE = Date.UTC(2025, 9, 20, 8); // 13:00 at +5 h

function shellWith(openOrders: Array<HubResult<unknown>>) {
  const live = createLiveBus();
  const sent: Array<{ type: string; payload: unknown }> = [];
  const queries: string[] = [];
  const shell = {
    live,
    clock: { nowMs: () => BASE, utcOffsetMs: 5 * HOUR },
    api: {
      roster: () => new Promise(() => undefined),
      command: (type: string, payload: unknown) => {
        sent.push({ type, payload });
        return Promise.resolve({ ok: true, data: { alert_id: 'A1' } });
      },
      query: (path: string) => {
        queries.push(path);
        if (path.startsWith('/queries/open-orders')) return Promise.resolve(openOrders.length > 1 ? openOrders.shift()! : (openOrders[0] ?? { ok: false, error: { kind: 'network' } }));
        return Promise.resolve({ ok: true, data: { receivers: [] } });
      },
    },
    permissions: { allowed: (p: string) => p === 'run-pass' },
    toasts: { show: () => undefined },
    online: true,
    portrait: false,
    me: { staff_id: 'S1', name: 'Asif' },
    device: { token: 'DEV', id: 'D-P1', type: 'tablet' },
  } as unknown as Shell;
  const pass = passLiveOf(shell);
  const raw = (f: WsServerMessage) => {
    live.frame(f);
    pass.frame(f);
  };
  return { shell, sent, queries, raw };
}

let m: Mounted;
afterEach(() => m?.unmount());
function show(shell: Shell) {
  m = mount();
  m.render(
    <ShellContext.Provider value={shell}>
      <PassScreen />
    </ShellContext.Provider>,
  );
}
const cards = () => [...m.container.querySelectorAll('.pc')].map((c) => c.getAttribute('data-order'));
const chip = (label: string) => m.container.querySelector<HTMLButtonElement>(`.pfilter button[data-filter="${label}"]`)!;
const promises = (rows: Array<[string, number | null]>): HubResult<unknown> => ({ ok: true, data: { orders: rows.map(([order_id, promise_ms]) => ({ order_id, order_type: 'takeaway', promise_ms })) } });

describe('[02b-tk C3-4] Pass takeaway filter', () => {
  it('[03b §6.15] the order type comes from the lines; counts per type; All keeps the oldest-first order', () => {
    const orders = [card('O1', 30, 'parking'), card('O53', 10, 'takeaway'), card('O2', 0, 'dine_in'), card('O54', 20, 'takeaway')];
    expect(typeCounts(orders)).toEqual({ dine_in: 1, takeaway: 2, parking: 1 });
    expect(ordersFor(orders, 'all', new Map()).map((o) => o.order_id)).toEqual(['O2', 'O53', 'O54', 'O1']);
    expect(ordersFor(orders, 'dine_in', new Map()).map((o) => o.order_id)).toEqual(['O2']);
    expect(ordersFor(orders, 'parking', new Map()).map((o) => o.order_id)).toEqual(['O1']);
    // takeaway by promise; an unknown promise after the known ones, oldest first
    const p = new Map([['O53', 5_000], ['O54', 4_000]]);
    expect(ordersFor(orders, 'takeaway', p).map((o) => o.order_id)).toEqual(['O54', 'O53']);
    expect(ordersFor([...orders, card('O55', 5, 'takeaway')], 'takeaway', p).map((o) => o.order_id)).toEqual(['O54', 'O53', 'O55']);
  });

  it('[02b §6.16] takeaway promises from open-orders: read at start, after a station-load event (100 ms) and every 30 s; a failed read keeps the last; stop ends it', async () => {
    vi.useFakeTimers();
    try {
      const live = createLiveBus();
      const answers = [promises([['O53', 1_000]]), { ok: false, error: { kind: 'network' } } as const, promises([['O53', 2_000]])];
      const read = vi.fn(() => Promise.resolve(answers.shift()!));
      const reader = createTakeawayPromises({ live, read });
      const seen: number[] = [];
      reader.subscribe(() => seen.push(reader.promises().get('O53') ?? -1));
      reader.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(read).toHaveBeenCalledTimes(1);
      expect(reader.promises().get('O53')).toBe(1_000);
      live.frame({ type: 'event', seq: 2, event: { event_id: 'E2', event_type: 'OrderPlaced', schema_version: 1, payload: {} } } as never);
      await vi.advanceTimersByTimeAsync(100);
      expect(read).toHaveBeenCalledTimes(2);
      expect(reader.promises().get('O53')).toBe(1_000);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(read).toHaveBeenCalledTimes(3);
      expect(reader.promises().get('O53')).toBe(2_000);
      expect(seen).toEqual([1_000, 2_000]);
      reader.stop();
      live.frame({ type: 'event', seq: 3, event: { event_id: 'E3', event_type: 'OrderPlaced', schema_version: 1, payload: {} } } as never);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(read).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('[frame PackerPass] chips All / Dine-in / Takeaway / Parking; Takeaway: by promise, "Pack next", "Ready by", Bag ready = MarkReadyToServe', async () => {
    const s = shellWith([promises([['O53', BASE + 11 * 60_000], ['O54', BASE + 4 * 60_000]])]);
    s.raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: view([card('O2', 0, 'dine_in'), card('O53', 10, 'takeaway'), card('O54', 20, 'takeaway', 'cooking'), card('O1', 30, 'parking')]) } });
    show(s.shell);
    await flush();
    expect([...m.container.querySelectorAll('.pfilter button')].map((b) => b.getAttribute('data-filter'))).toEqual(['all', 'dine_in', 'takeaway', 'parking']);
    expect(chip('all').getAttribute('aria-pressed')).toBe('true');
    expect(chip('takeaway').textContent).toBe('Takeaway2');
    expect(cards()).toEqual(['O2', 'O53', 'O54', 'O1']);
    // All reads no promises
    expect(s.queries.filter((q) => q.startsWith('/queries/open-orders'))).toEqual([]);

    m.click(chip('takeaway'));
    await flush();
    expect(s.queries.filter((q) => q.startsWith('/queries/open-orders'))).toEqual(['/queries/open-orders?order_type=takeaway']);
    expect(chip('takeaway').getAttribute('aria-pressed')).toBe('true');
    expect(cards()).toEqual(['O54', 'O53']);
    const first = m.container.querySelector('.pc[data-order="O54"]')!;
    expect(first.classList.contains('pc--next')).toBe(true);
    expect(first.textContent).toContain('Pack next');
    expect(first.textContent).toContain('Ready by 1:04 PM');
    expect(m.container.querySelector('.pc[data-order="O53"]')!.textContent).not.toContain('Pack next');
    expect(m.container.querySelector('.pc[data-order="O53"]')!.textContent).toContain('Ready by 1:11 PM');
    // no bill fields on the Pass (05 bill read not wired here)
    expect(m.text()).not.toContain('Due');

    // Bag ready on a card whose lines are done → one MarkReadyToServe for the order at this point
    m.click(m.button('Bag ready', m.container.querySelector('.pc[data-order="O53"]')!));
    await flush();
    expect(s.sent).toEqual([{ type: 'MarkReadyToServe', payload: { order_id: 'O53', point_id: 'PT' } }]);

    m.click(chip('dine_in'));
    await flush();
    expect(cards()).toEqual(['O2']);
    expect(m.button('Ready to serve', m.container.querySelector('.pc[data-order="O2"]')!)).toBeTruthy();
    m.click(chip('parking'));
    await flush();
    expect(cards()).toEqual(['O1']);
  });

  it('[02b-tk C3-4] a filter with no orders says so; the Pass stays on the chosen filter', async () => {
    const s = shellWith([promises([])]);
    s.raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: view([card('O2', 0, 'dine_in')]) } });
    show(s.shell);
    await flush();
    m.click(chip('takeaway'));
    await flush();
    expect(cards()).toEqual([]);
    expect(m.text()).toContain('No takeaway orders at the Pass');
  });
});
