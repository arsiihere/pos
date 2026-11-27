import type { LineDetail } from '@pos/domain';
import type { WsServerMessage } from '@pos/events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HubResult } from '../../api/hub-admin';
import { flush, mount, type Mounted } from '../../../test/dom';
import type { OrderViewBody, SeatingLine } from '../staff/orders/contracts';
import { ShellContext, type Shell } from '../staff/shell/hooks';
import { createLiveBus } from '../staff/shell/live';
import type { PointLine, PointOrder, PointViewBody } from './contracts';
import { passLiveOf } from './live';
import { PassScreen } from './PassScreen';

// ⚠️ 03b v1.0.17 §3.4 (owner ruling 2026-11-28 "Pass bag = token"; QA BUG-8, BUG-9): a token's root and its addition
// are ONE Pass card. It drops back to Cooking when an addition cooks after Ready; "Handed to customer" hands over every
// order of the token in one tap (one MarkServed per order, one Undo); the one Due pill shows the token's total and "Ask
// a manager" sends one RequestUnpaidHandover per unpaid order (Approval ruling A: one order, its own amount).
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
const PASS = ['run-pass', 'mark-served'];


/** token 14: the root O1 (placed first) and its addition O2 */
const tok = { kind: 'token' as const, token: 14, date: null };
function tokOrder(order_id: string, stage: PointLine['stage'], placed: number, over: Partial<PointOrder> = {}): PointOrder {
  // ⚠️ v1.0.17 §8: a done order is marked ready (Bag ready), so "Handed to customer" is the card's one primary button
  const ready = stage === 'done' ? { at: BASE - 30_000, by: null, lines: [`${order_id}-L1`] } : null;
  return { order_id, identifier: tok, placed_at: BASE - placed, ready, lines: [line(`${order_id}-L1`, order_id, stage, { identifier: tok })], ...over };
}
const cards = () => [...m.container.querySelectorAll<HTMLElement>('article.pc')];
const hubRow = (order_id: string, bill: unknown, extra: Record<string, unknown> = {}) => ({ order_id, order_type: 'takeaway', token: 14, bill, ...extra });

describe('[03b v1.0.17 §3.4] Pass bag = token (BUG-8)', () => {
  it('a token\'s root and addition are one card; an addition after Ready drops it back to Cooking with no Ready band and no amber', async () => {
    const s = shellWith({ grants: ['run-pass'] });
    const root = tokOrder('O1', 'done', 600_000, { ready: { at: BASE - 400_000, by: null, lines: ['O1-L1'] }, bag_ready_since: BASE - 400_000, bag_ready_window_ms: 60_000 });
    s.raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: view([root]) } });
    show(s.shell);
    await flush();
    expect(cards()).toHaveLength(1);
    expect(cards()[0]!.classList.contains('pc--late')).toBe(true);
    // the addition arrives (its own order, same token) and cooks
    s.raw({ type: 'catch_up', as_of_seq: 2, state: { point_view: view([root, tokOrder('O2', 'cooking', 60_000)]) } });
    await flush();
    expect(cards()).toHaveLength(1);
    const c = cards()[0]!;
    expect(c.querySelectorAll('.pl')).toHaveLength(2);
    expect(c.querySelector('.rd')!.textContent).toBe('Cooking');
    expect(c.classList.contains('sent')).toBe(false);
    expect(c.classList.contains('pc--late')).toBe(false);
    expect(c.querySelector('.pc__rdy')).toBeNull();
    expect(c.querySelector('.pc__late')).toBeNull();
  });

  it('Handed to customer on the bag hands over every order: one Undo toast, then one MarkServed per order; Undo sends none', async () => {
    vi.useFakeTimers();
    try {
      const views = { O1: ov('O1', [sline('O1-L1', 'O1')]), O2: ov('O2', [sline('O2-L1', 'O2')]) };
      const paid = { state: 'paid', due_minor: 0 };
      const s = shellWith({ grants: PASS, views, bills: () => openOrders([hubRow('O1', paid), hubRow('O2', paid)]) });
      s.raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: view([tokOrder('O1', 'done', 600_000), tokOrder('O2', 'done', 60_000)]) } });
      show(s.shell);
      await vi.advanceTimersByTimeAsync(0);
      await flush();
      expect(cards()).toHaveLength(1);
      const btn = cards()[0]!.querySelector<HTMLButtonElement>('.btn--customer')!;
      expect(btn.disabled).toBe(false);
      m.click(btn);
      await vi.advanceTimersByTimeAsync(0);
      await flush();
      expect(m.container.querySelectorAll('.pass-undo')).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(5_000);
      await flush();
      expect(s.enqueued).toEqual([
        { type: 'MarkServed', payload: { lines: [{ order_id: 'O1', order_item_ids: ['O1-L1'] }], customer_handover: true } },
        { type: 'MarkServed', payload: { lines: [{ order_id: 'O2', order_item_ids: ['O2-L1'] }], customer_handover: true } },
      ]);
      m.click(cards()[0]!.querySelector<HTMLButtonElement>('.btn--customer')!);
      await vi.advanceTimersByTimeAsync(0);
      await flush();
      m.click(m.button('Undo', m.container.querySelector('.pass-undo')!));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(s.enqueued).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a paid root and an unpaid addition: greyed, ONE Due pill with the token total', async () => {
    const s = shellWith({ grants: PASS, bills: () => openOrders([hubRow('O1', { state: 'paid', due_minor: 0 }), hubRow('O2', { state: 'due', due_minor: 4_000 })]) });
    s.raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: view([tokOrder('O1', 'done', 600_000), tokOrder('O2', 'done', 60_000)]) } });
    show(s.shell);
    await flush();
    const c = cards()[0]!;
    expect(c.querySelector<HTMLButtonElement>('.btn--customer')!.disabled).toBe(true);
    expect([...c.querySelectorAll('.pc__due')].map((e) => e.textContent)).toEqual(['Due Rs 40 — customer pays at counter']);
  });
});

describe('[02b v1.0.26 owner 2026-11-28 Q9] one bill, one request, one amount', () => {
  it('root and addition on ONE bill: the pill shows the bill due once; Ask a manager is one tap and sends one request', async () => {
    const s = shellWith({ grants: PASS, bills: () => openOrders([hubRow('O1', { state: 'due', due_minor: 12_000, key: 'K1' }), hubRow('O2', { state: 'due', due_minor: 12_000, key: 'K1' })]) });
    const command = vi.fn(async (_type: string, p: { order_id: string }) => ({ ok: true, data: { alert_id: `AL-${p.order_id}`, is_requester: true } }));
    (s.shell.api as unknown as { command: typeof command }).command = command;
    s.raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: view([tokOrder('O1', 'done', 600_000), tokOrder('O2', 'done', 60_000)]) } });
    show(s.shell);
    await flush();
    const c = cards()[0]!;
    expect([...c.querySelectorAll('.pc__due')].map((e) => e.textContent)).toEqual(['Due Rs 120 — customer pays at counter']);
    m.click(c.querySelector<HTMLButtonElement>('[data-ask]'));
    await flush();
    expect(m.container.querySelector('.pass-ask')).toBeNull();
    expect(command.mock.calls.map((call) => call.slice(0, 2))).toEqual([['RequestUnpaidHandover', { order_id: 'O1' }]]);
    expect(c.querySelector('[data-ask]')!.textContent).toContain('Waiting for a manager…');
  });
});

describe('[03b v1.0.17 §3.4; 02b v1.0.26 Q9] Ask a manager on a bag with two bills (BUG-9)', () => {
  it('two unpaid bills (no shared key): one pill with the total; the sheet sends one RequestUnpaidHandover per bill, each with its own amount', async () => {
    const s = shellWith({ grants: PASS, bills: () => openOrders([hubRow('O1', { state: 'due', due_minor: 8_000 }), hubRow('O2', { state: 'due', due_minor: 4_000 })]) });
    const command = vi.fn(async (_type: string, p: { order_id: string }) => ({ ok: true, data: { alert_id: `AL-${p.order_id}`, is_requester: true } }));
    (s.shell.api as unknown as { command: typeof command }).command = command;
    s.raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: view([tokOrder('O1', 'done', 600_000), tokOrder('O2', 'done', 60_000)]) } });
    show(s.shell);
    await flush();
    const c = cards()[0]!;
    expect([...c.querySelectorAll('.pc__due')].map((e) => e.textContent)).toEqual(['Due Rs 120 — customer pays at counter']);
    const asks = [...c.querySelectorAll<HTMLButtonElement>('[data-ask]')];
    expect(asks).toHaveLength(1);
    // the card shows no per-order breakdown; the small button opens the sheet that does (v1.0.17 §8)
    expect(c.querySelector('[data-unpaid]')).toBeNull();
    m.click(asks[0]!);
    await flush();
    m.click(m.container.querySelector<HTMLButtonElement>('.pass-ask [data-ask-send]'));
    await flush();
    expect(command.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['RequestUnpaidHandover', { order_id: 'O1' }],
      ['RequestUnpaidHandover', { order_id: 'O2' }],
    ]);
    const rows = [...m.container.querySelectorAll('.pass-ask [data-unpaid]')].map((e) => e.textContent ?? '');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('#14 · Rs 80');
    expect(rows[1]).toContain('#14 · Rs 40 (addition)');
    for (const r of rows) expect(r).toContain('Waiting for a manager…');
  });

  it('one order approved, the other still due: still greyed; both approved → enabled', async () => {
    let approved: string[] = [];
    const s = shellWith({ grants: PASS, bills: () => openOrders([hubRow('O1', { state: 'due', due_minor: 8_000 }, { unpaid_handover_approved: approved.includes('O1') }), hubRow('O2', { state: 'due', due_minor: 4_000 }, { unpaid_handover_approved: approved.includes('O2') })]) });
    s.raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: view([tokOrder('O1', 'done', 600_000), tokOrder('O2', 'done', 60_000)]) } });
    show(s.shell);
    await flush();
    approved = ['O1'];
    s.raw({ type: 'event', seq: 2, event: { event_id: 'E2', event_type: 'UnpaidHandoverApproved', schema_version: 1, payload: { order_id: 'O1', alert_id: 'AL1', approved_by_staff_id: 'S_MGR', due_minor: 8_000 } } } as WsServerMessage);
    await new Promise((r) => setTimeout(r, 1_100));
    await flush();
    expect(cards()[0]!.querySelector<HTMLButtonElement>('.btn--customer')!.disabled).toBe(true);
    approved = ['O1', 'O2'];
    s.raw({ type: 'event', seq: 3, event: { event_id: 'E3', event_type: 'UnpaidHandoverApproved', schema_version: 1, payload: { order_id: 'O2', alert_id: 'AL2', approved_by_staff_id: 'S_MGR', due_minor: 4_000 } } } as WsServerMessage);
    await new Promise((r) => setTimeout(r, 1_100));
    await flush();
    expect(cards()[0]!.querySelector<HTMLButtonElement>('.btn--customer')!.disabled).toBe(false);
  });
});
