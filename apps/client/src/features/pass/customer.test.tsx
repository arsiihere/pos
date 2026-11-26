import type { LineDetail } from '@pos/domain';
import type { WsServerMessage } from '@pos/events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HubResult } from '../../api/hub-admin';
import { flush, mount, type Mounted } from '../../../test/dom';
import type { OrderViewBody, SeatingLine } from '../staff/orders/contracts';
import { ShellContext, type Shell } from '../staff/shell/hooks';
import { createLiveBus } from '../staff/shell/live';
import type { PointLine, PointOrder, PointOrderMeta, PointViewBody } from './contracts';
import { passLiveOf } from './live';
import { PassScreen } from './PassScreen';

// 02b-TK L-CLIENT-1 item 1 (03b v1.0.16 §3.4 Pickup identity, Readiness, Handed to customer, Bill freshness, Tap and
// send; frames PackerPass, HandoverUndo): the Pass card of a pickup order (pickup time, station-less lines, whole-order
// Bag ready) and the "Handed to customer" action of a Pass-role person (run-pass + mark-served), greyed until the bill
// is known; a Cook (run-pass only) has none.

const HOUR = 3_600_000;
const BASE = Date.UTC(2025, 9, 20, 8); // 1:00 PM at +5 h

function detail(id: string, order_id: string, over: Partial<LineDetail> = {}): LineDetail {
  return {
    order_item_id: id,
    order_id,
    station_id: 'KARAHI',
    point_id: 'PT',
    identifier: { kind: 'token', token: 48, date: null },
    order_type: 'takeaway',
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
const line = (id: string, order_id: string, stage: PointLine['stage'], over: Partial<LineDetail> = {}): PointLine => ({ ...detail(id, order_id, over), stage, handed_over: false });
function card(order_id: string, stage: PointLine['stage'], over: Partial<PointOrder> = {}, type: 'takeaway' | 'parking' | 'dine_in' = 'takeaway'): PointOrder {
  const identifier = type === 'takeaway' ? { kind: 'token' as const, token: Number(order_id.slice(1)), date: null } : type === 'parking' ? { kind: 'parking' as const, car_number: 'LEA 123', car_type: 'sedan' as const } : { kind: 'table' as const, label: 'T3' };
  return { order_id, identifier, placed_at: BASE - 60_000, ready: null, lines: [line(`${order_id}-L1`, order_id, stage, { identifier, order_type: type })], ...over };
}
const meta = (order_id: string, over: Partial<PointOrderMeta> = {}): PointOrderMeta => ({
  order_id,
  pickup_at_ms: BASE + 30 * 60_000,
  boosted: false,
  pickup_readiness: { all_engine_lines_done: false, station_less_hold_until: null },
  no_station_lines: [],
  bag_ready_since: null,
  bag_ready_window_ms: null,
  ...over,
});
const view = (orders: PointOrder[]): PointViewBody => ({ point_id: 'PT', stations: [{ station_id: 'KARAHI', name: 'Karahi', lanes: { lanes_on: 1, lane_count: 1 }, dark: false }], takeovers: [], orders });

function sline(id: string, order_id: string, over: Partial<SeatingLine> = {}): SeatingLine {
  return {
    order_item_id: id, order_id, parent_order_item_id: null, line_kind: 'item', item_id: 'I', deal_id: null, name: id, sale_unit: 'piece', quantity: 1, units: 1, live_units: 1,
    comped_units: 0, removed_units: 0, voided_units: 0, returned_units: 0, refundable_minor: 0, comp_minor: 0, comp_voided_minor: 0, removed_minor: 0, refund_minor: 0,
    line_total_minor: 100, billed_minor: 0, return_of: null, served_from_zone_id: null, zone_served: false, added_at: 0, served_at: null, served_source: null, is_food: true,
    kitchen_note: null, stage: 'done', fired: true, ...over,
  };
}
const ov = (order_id: string, lines: SeatingLine[]): OrderViewBody =>
  ({ order_id, placed_by: { staff_id: 'S', name: null }, placed_at: 0, follow_up: false, cancelled: false, billed: false, has_phone: false, promise_ms: null, lines, order_type: 'takeaway', seating_id: null }) as OrderViewBody;
const openOrders = (rows: Array<Record<string, unknown>>): HubResult<unknown> => ({ ok: true, data: { orders: rows } });

function shellWith(o: { grants: string[]; bills?: () => HubResult<unknown>; views?: Record<string, OrderViewBody>; online?: boolean; enqueue?: (type: string, payload: unknown) => unknown }) {
  const live = createLiveBus();
  const queries: string[] = [];
  const enqueued: Array<{ type: string; payload: unknown }> = [];
  const toasts: string[] = [];
  const shell = {
    live,
    clock: { nowMs: () => BASE, utcOffsetMs: 5 * HOUR },
    api: {
      roster: () => new Promise(() => undefined),
      command: () => Promise.resolve({ ok: true, data: { alert_id: 'A1' } }),
      query: (path: string) => {
        queries.push(path);
        if (path === '/queries/open-orders?order_type=all') return Promise.resolve(o.bills?.() ?? openOrders([]));
        if (path.startsWith('/queries/open-orders')) return Promise.resolve(openOrders([]));
        return Promise.resolve({ ok: true, data: { receivers: [] } });
      },
    },
    orders: { orderView: (id: string) => Promise.resolve(o.views?.[id] === undefined ? { ok: false, error: { kind: 'network' } } : { ok: true, data: { kind: 'order', order: o.views[id] } }) },
    enqueue: (type: string, payload: unknown) => {
      enqueued.push({ type, payload });
      return Promise.resolve(o.enqueue?.(type, payload) ?? { status: 'sent', result: { served: 1, skipped: [] } });
    },
    permissions: { allowed: (p: string) => o.grants.includes(p) },
    toasts: { show: (x: { text: string }) => void toasts.push(x.text) },
    online: o.online ?? true,
    portrait: false,
    me: { staff_id: 'S1', name: 'Pervez' },
    device: { token: 'DEV', id: 'D-P1', type: 'tablet' },
  } as unknown as Shell;
  const pass = passLiveOf(shell);
  const raw = (f: WsServerMessage) => {
    live.frame(f);
    pass.frame(f);
  };
  return { shell, queries, enqueued, toasts, raw };
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
const pc = (id: string) => m.container.querySelector<HTMLElement>(`.pc[data-order="${id}"]`)!;
const customerBtn = (id: string) => pc(id).querySelector<HTMLButtonElement>('.btn--customer');
const PASS = ['run-pass', 'mark-served'];

describe('[03b v1.0.16 §3.4 Pickup identity, Readiness (R3-B-1, R3-M-5)] a pickup card on the Pass', () => {
  it('shows the pickup time and the station-less lines; Bag ready only once the whole order is ready (live point_lines.orders)', async () => {
    const s = shellWith({ grants: ['run-pass'] });
    s.raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: view([card('O48', 'done', meta('O48', { no_station_lines: [{ order_item_id: 'COLA', item_name: 'Cola', units: 2 }] }))]) } });
    show(s.shell);
    await flush();
    expect(pc('O48').textContent).toContain('Pickup 1:30 PM');
    expect(pc('O48').querySelector('.pl--counter')!.textContent).toBe('2 xCola');
    expect(pc('O48').textContent).toContain('From the counter');
    // another point still cooks: no Ready pill, no Bag ready
    expect(pc('O48').classList.contains('ready')).toBe(false);
    expect(pc('O48').querySelector('.btn--ready')).toBeNull();
    s.raw({ type: 'point_lines', point_id: 'PT', lines: [], orders: [meta('O48', { pickup_readiness: { all_engine_lines_done: true, station_less_hold_until: null } })] } as WsServerMessage);
    await flush();
    expect(pc('O48').classList.contains('ready')).toBe(true);
    expect(m.button('Bag ready', pc('O48'))).toBeTruthy();
    // a Cook has no customer hand-over and the Pass reads no bill
    expect(customerBtn('O48')).toBeNull();
    expect(s.queries.filter((q) => q.includes('order_type=all'))).toEqual([]);
  });
});

describe('[03b v1.0.16 §3.4 Handed to customer (R3-B-2, OR-2, OR-7)] the Pass-role action', () => {
  it('takeaway / parking cards only; greyed "Waiting for the bill" while open-orders has no bill field (today\'s hub)', async () => {
    const s = shellWith({ grants: PASS, bills: () => openOrders([{ order_id: 'O48', order_type: 'takeaway' }]) });
    s.raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: view([card('O48', 'done'), card('O2', 'done', {}, 'dine_in')]) } });
    show(s.shell);
    await flush();
    expect(s.queries.filter((q) => q.includes('order_type=all'))).toEqual(['/queries/open-orders?order_type=all']);
    expect(customerBtn('O2')).toBeNull();
    expect(customerBtn('O48')!.disabled).toBe(true);
    expect(customerBtn('O48')!.textContent).toBe('Handed to customer');
    expect(pc('O48').querySelector('.pc__hint')!.textContent).toBe('Waiting for the bill');
    expect(pc('O48').textContent).not.toContain('Due');
  });

  it('a Due row: greyed, "Due — customer pays at counter" and "Take payment first"; a Paid row enables it', async () => {
    const s = shellWith({ grants: PASS, bills: () => openOrders([{ order_id: 'O48', order_type: 'takeaway', bill: { state: 'due', due_minor: 119_000 } }, { order_id: 'O49', order_type: 'takeaway', bill: { state: 'paid', due_minor: 0 } }]) });
    s.raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: view([card('O48', 'done'), card('O49', 'done')]) } });
    show(s.shell);
    await flush();
    expect(customerBtn('O48')!.disabled).toBe(true);
    expect(pc('O48').querySelector('.pc__due')!.textContent).toBe('Due — customer pays at counter');
    expect(pc('O48').querySelector('.pc__hint')!.textContent).toBe('Take payment first');
    expect(customerBtn('O49')!.disabled).toBe(false);
    expect(pc('O49').querySelector('.pc__hint')).toBeNull();
  });

  it('a line here still cooking keeps it greyed; offline greys it with "Offline — hand over at the counter"', async () => {
    const paid = () => openOrders([{ order_id: 'O48', order_type: 'takeaway', bill: { state: 'paid', due_minor: 0 } }]);
    const s = shellWith({ grants: PASS, bills: paid });
    s.raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: view([card('O48', 'cooking')]) } });
    show(s.shell);
    await flush();
    expect(customerBtn('O48')!.disabled).toBe(true);
    m.unmount();
    const off = shellWith({ grants: PASS, bills: paid, online: false });
    off.raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: view([card('O48', 'done')]) } });
    show(off.shell);
    await flush();
    expect(customerBtn('O48')!.disabled).toBe(true);
    expect(pc('O48').querySelector('.pc__hint')!.textContent).toBe('Offline — hand over at the counter');
  });

  it('[tests 112, 115] tap: fresh reads → "#48 handed to customer · Undo" → after 5 s one MarkServed with every live line; Undo sends nothing', async () => {
    vi.useFakeTimers();
    try {
      const views = { O48: ov('O48', [sline('O48-L1', 'O48'), sline('RAITA', 'O48', { line_kind: 'option_child', parent_order_item_id: 'O48-L1', stage: null, fired: false }), sline('COLA', 'O48', { stage: null, fired: false })]) };
      const s = shellWith({ grants: PASS, views, bills: () => openOrders([{ order_id: 'O48', order_type: 'takeaway', bill: { state: 'paid', due_minor: 0 } }]) });
      s.raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: view([card('O48', 'done')]) } });
      show(s.shell);
      await vi.advanceTimersByTimeAsync(0);
      await flush();
      m.click(customerBtn('O48'));
      await vi.advanceTimersByTimeAsync(0);
      await flush();
      const toast = m.container.querySelector('.pass-undo')!;
      expect(toast.textContent).toBe('#48 handed to customerUndo');
      expect(customerBtn('O48')!.disabled).toBe(true);
      expect(s.enqueued).toEqual([]);
      await vi.advanceTimersByTimeAsync(5_000);
      await flush();
      expect(s.enqueued).toEqual([{ type: 'MarkServed', payload: { lines: [{ order_id: 'O48', order_item_ids: ['O48-L1', 'RAITA', 'COLA'] }] } }]);
      expect(s.toasts).toEqual([]);
      expect(m.container.querySelector('.pass-undo')).toBeNull();

      // again, then Undo: nothing is sent
      m.click(customerBtn('O48'));
      await vi.advanceTimersByTimeAsync(0);
      await flush();
      m.click(m.button('Undo', m.container.querySelector('.pass-undo')!));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(s.enqueued).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('[test 116] a refusal queues nothing: another item still cooking, or the pickup time not reached for a station-less line', async () => {
    const paid = () => openOrders([{ order_id: 'O48', order_type: 'takeaway', bill: { state: 'paid', due_minor: 0 } }]);
    const views = { O48: ov('O48', [sline('O48-L1', 'O48'), sline('DRINK', 'O48', { stage: 'cooking' })]) };
    const s = shellWith({ grants: PASS, views, bills: paid });
    s.raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: view([card('O48', 'done')]) } });
    show(s.shell);
    await flush();
    m.click(customerBtn('O48'));
    await flush();
    expect(pc('O48').querySelector('.pc__msg')!.textContent).toBe('Other items of this order are not ready yet');
    m.unmount();
    const held = shellWith({ grants: PASS, bills: paid, views: { O48: ov('O48', [sline('O48-L1', 'O48'), sline('COLA', 'O48', { stage: null, fired: false })]) } });
    held.raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: view([card('O48', 'done', meta('O48', { pickup_readiness: { all_engine_lines_done: true, station_less_hold_until: null } }))]) } });
    show(held.shell);
    await flush();
    m.click(customerBtn('O48'));
    await flush();
    expect(pc('O48').querySelector('.pc__msg')!.textContent).toBe("Pickup at 1:30 PM — use 'Customer is here' at the counter");
    expect(s.enqueued).toEqual([]);
    expect(held.enqueued).toEqual([]);
  });

  it('[tests 120, 122] 403 outside_scope → its toast; 409 ITEM_WRONG_STAGE removed → re-read and retry once with the lines still live', async () => {
    vi.useFakeTimers();
    try {
      const paid = () => openOrders([{ order_id: 'O48', order_type: 'takeaway', bill: { state: 'paid', due_minor: 0 } }]);
      const views: Record<string, OrderViewBody> = { O48: ov('O48', [sline('O48-L1', 'O48'), sline('NAAN', 'O48')]) };
      const answers = [
        { status: 'refused', error: { kind: 'api', status: 409, code: 'ITEM_WRONG_STAGE', details: { order_item_id: 'NAAN', stage: 'removed' } } },
        { status: 'sent', result: { served: 1, skipped: [] } },
        { status: 'refused', error: { kind: 'api', status: 403, code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', order_ids: ['O48'] } } },
      ];
      const s = shellWith({ grants: PASS, views, bills: paid, enqueue: () => answers.shift() });
      s.raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: view([card('O48', 'done')]) } });
      show(s.shell);
      await vi.advanceTimersByTimeAsync(0);
      m.click(customerBtn('O48'));
      await vi.advanceTimersByTimeAsync(0);
      // the Naan was removed meanwhile
      views['O48'] = ov('O48', [sline('O48-L1', 'O48'), sline('NAAN', 'O48', { live_units: 0, removed_units: 1, stage: 'removed' })]);
      await vi.advanceTimersByTimeAsync(5_000);
      await flush();
      expect(s.enqueued.map((e) => (e.payload as { lines: Array<{ order_item_ids: string[] }> }).lines[0]!.order_item_ids)).toEqual([['O48-L1', 'NAAN'], ['O48-L1']]);
      m.click(customerBtn('O48'));
      await vi.advanceTimersByTimeAsync(5_000);
      await flush();
      expect(s.toasts).toEqual(['This order is not one of yours — hand over at the counter']);
    } finally {
      vi.useRealTimers();
    }
  });
});
