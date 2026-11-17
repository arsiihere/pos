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

// 02b v1.0.11 §8 Late cards (O18; Q-10, H5; §10 #35) and the release sheet (02b-C04 TableViewLate, ReleaseSheet).

const cu = (order_id: string, placed_at: number, table_key: string): CatchUpOrder => ({
  order_id,
  order_type: 'dine_in',
  table_key,
  business_date: '2026-11-13',
  token: null,
  car_number: null,
  car_type: null,
  order_note: null,
  placed_by: 'ST-ALI',
  placed_at,
  follow_up: false,
  cancelled: false,
  cancelled_at: null,
  billed: false,
  billed_at: null,
  day_closed_at: null,
  sent_after_reconnect: false,
  has_phone: false,
  lines: [],
});

const row = (alert_id: string, table_code: string, minutes: number): LateAlertRow => ({
  alert_id,
  kind: 'slip_warning',
  state: 'open',
  lock: { table_code },
  card: { details: { minutes_late: minutes, lines: [{ name: 'Karahi', quantity: 1, state: 'cooking' }] } },
});

// F4 (O1, older) and F5 (O2) were joined after each had a slip warning
const o1 = sorder('O1', at(20, 0), [sline('Karahi', { stage: 'cooking' }), sline('Naan', { stage: 'done', units: 6, live_units: 6 })]);
const o2 = sorder('O2', at(20, 5), [sline('Kebab', { name: 'Seekh Kebab', stage: 'added', units: 4, live_units: 4 })]);
const merged = { orders: [o1, o2], total_minor: 0 };

describe('[02b §8 Late cards] late cards', () => {
  it('[02b #35 O18] open_slips: merge after both warnings → one card; one ReleaseItems for all its orders', async () => {
    const s = part({
      body: merged,
      openSlips: [
        { alert_id: 'W1', order_ids: ['O1'] },
        { alert_id: 'W2', order_ids: ['O2'] },
      ],
      catchUpOrders: [cu('O1', at(20, 0), 'dine_in:S4'), cu('O2', at(20, 5), 'dine_in:S5')],
      rows: [row('W1', 'F4', 6), row('W2', 'F5', 4)],
      tiles: [tile('F4', { joined_table_names: ['F4', 'F5'] }), tile('F5')],
    });
    await flush();
    const cards = s.m.container.querySelectorAll('.lc');
    expect(cards).toHaveLength(1);
    expect(cards[0]!.querySelector('.lc__h')?.textContent).toBe('F4 + F5 — about 6 min late');
    s.m.click(s.m.button("Send what's ready", cards[0]!));
    const dlg = s.m.container.querySelector('.dlg')!;
    expect(dlg.textContent).toContain('2 late groups on this table');
    s.m.click(s.m.button('Send', dlg.querySelector('.acts')!));
    await flush();
    const rel = s.command.mock.calls.filter((c) => c[0] === 'ReleaseItems');
    expect(rel).toHaveLength(1);
    expect(rel[0]![1]).toEqual({ order_ids: ['O1', 'O2'], released: ['Naan'], expedite: [] });
    expect(s.m.container.querySelector('.lc')).toBeNull();
  });

  it("[02b #35 S-7] after a split each warning sits under its oldest order's table", async () => {
    // one warning for O1 + O2; the seating was split: O2 now on another table (this seating holds only O2)
    const slips = [{ alert_id: 'W1', order_ids: ['O1', 'O2'] }];
    const catchUp = [cu('O1', at(20, 0), 'dine_in:S9'), cu('O2', at(20, 5), 'dine_in:S4')];
    const here = part({ body: { orders: [o2], total_minor: 0 }, openSlips: slips, catchUpOrders: catchUp, table_ids: ['F5'], tiles: [tile('F5')] });
    await flush();
    expect(here.m.container.querySelector('.lc')).toBeNull();
    here.m.unmount();
    const oldest = part({ body: { orders: [o1], total_minor: 0 }, openSlips: slips, catchUpOrders: catchUp, table_ids: ['F4'], tiles: [tile('F4')] });
    await flush();
    expect(oldest.m.container.querySelectorAll('.lc')).toHaveLength(1);
    expect(oldest.m.container.querySelector('.lc__h')?.textContent).toBe('F4 — running late');
  });

  it('[02b Q-10] no open_slips: each late card answered alone (AnswerRequest accept / decline)', async () => {
    const s = part({ body: merged, rows: [row('W1', 'F4', 6), row('W2', 'F5', 4), row('W9', 'R1', 9)] });
    await flush();
    const cards = [...s.m.container.querySelectorAll('.lc')];
    expect(cards.map((c) => c.querySelector('.lc__h')?.textContent)).toEqual(['F4 + F5 — about 6 min late', 'F4 + F5 — about 4 min late']);
    s.m.click(s.m.button("Send what's ready", cards[0]!));
    await flush();
    expect(s.command).toHaveBeenCalledWith('AnswerRequest', { alert_id: 'W1', decision: 'accept', method: 'session' }, { commandId: expect.any(String) });
    // no sheet in the interim: the hub pre-ticks
    expect(s.m.container.querySelector('.dlg')).toBeNull();
    s.m.click(s.m.button('Wait', s.m.container.querySelector('.lc')!));
    await flush();
    expect(s.command).toHaveBeenCalledWith('AnswerRequest', { alert_id: 'W2', decision: 'decline', method: 'session' }, { commandId: expect.any(String) });
    expect(s.command.mock.calls.some((c) => c[0] === 'ReleaseItems')).toBe(false);
    expect(s.m.container.querySelector('.lc')).toBeNull();
  });

  it("[02b §8 Table view] Send what's ready: ready lines and their partners", async () => {
    const naan = sline('Naan', { item_id: 'NAAN', stage: 'done', units: 6, live_units: 6 });
    const karahi = sline('Karahi', { name: 'Chicken Karahi — Full', item_id: 'KARAHI', stage: 'cooking' });
    const kebab = sline('Kebab', { name: 'Seekh Kebab', item_id: 'KEBAB', stage: 'added', units: 4, live_units: 4 });
    const served = sline('Raita', { item_id: 'RAITA', stage: 'served', served_at: NOW - 60_000 });
    const s = part({
      body: { orders: [sorder('O1', at(20, 0), [naan, karahi, kebab, served])], total_minor: 0 },
      openSlips: [{ alert_id: 'W1', order_ids: ['O1'] }],
      catchUpOrders: [cu('O1', at(20, 0), 'dine_in:S4')],
      tiles: [tile('F4', { joined_table_names: ['F4', 'F5'] }), tile('F5')],
      config: {
        items: [
          { item_id: 'NAAN', category_id: 'BREAD' },
          { item_id: 'KARAHI', category_id: 'MAIN' },
          { item_id: 'KEBAB', category_id: 'BBQ' },
        ],
        goes_with: [{ source_kind: 'category', source_id: 'BREAD', target_kind: 'item', target_id: 'KARAHI', excluded: false }],
      },
    });
    await flush();
    s.m.click(s.m.button("Send what's ready", s.m.container.querySelector('.lc')!));
    const rows = [...s.m.container.querySelectorAll('.dlg .ckr')].map((r) => [r.getAttribute('data-line'), r.getAttribute('aria-checked'), r.querySelector('small')?.textContent]);
    expect(rows).toEqual([
      ['Naan', 'true', 'Send now'],
      ['Karahi', 'true', 'Goes with the Naan · hurry it'],
      ['Kebab', 'false', 'Hurry it'],
    ]);
    s.m.click(s.m.button('Send', s.m.container.querySelector('.dlg .acts')!));
    await flush();
    expect(s.command.mock.calls.find((c) => c[0] === 'ReleaseItems')?.[1]).toEqual({ order_ids: ['O1'], released: ['Naan'], expedite: ['Karahi'] });
  });
});

describe('[02b §8 Late cards] retries — review #185', () => {
  const slipsBoth = [
    { alert_id: 'W1', order_ids: ['O1'] },
    { alert_id: 'W2', order_ids: ['O2'] },
  ];
  const base = {
    body: merged,
    openSlips: slipsBoth,
    catchUpOrders: [cu('O1', at(20, 0), 'dine_in:S4'), cu('O2', at(20, 5), 'dine_in:S5')],
    tiles: [tile('F4', { joined_table_names: ['F4', 'F5'] }), tile('F5')],
    // the signed-in person was sent both warnings (named receiver)
    rows: [row('W1', 'F4', 6), row('W2', 'F5', 4)],
  };

  it("[02b §6.5] Send what's ready: a lost reply is sent again with the same command_id; the card clears once", async () => {
    let n = 0;
    const s = part({ ...base, command: async (type) => (type === 'ReleaseItems' && ++n === 1 ? { ok: false, error: { kind: 'network' } } : ok({ alerts_closed: 2 })) });
    await flush();
    s.m.click(s.m.button("Send what's ready", s.m.container.querySelector('.lc')!));
    s.m.click(s.m.button('Send', s.m.container.querySelector('.dlg .acts')!));
    await flush();
    expect(s.shell.toasts.current()?.text).toBe('No answer from the hub — try again');
    expect(s.m.container.querySelector('.dlg')).not.toBeNull();
    s.m.click(s.m.button('Send', s.m.container.querySelector('.dlg .acts')!));
    await flush();
    const rel = s.command.mock.calls.filter((c) => c[0] === 'ReleaseItems');
    expect(rel).toHaveLength(2);
    expect(rel[1]![2]?.commandId).toBe(rel[0]![2]?.commandId);
    expect(rel[1]![1]).toEqual(rel[0]![1]);
    expect(s.m.container.querySelector('.lc')).toBeNull();
  });

  it('[02b §8 Late cards] Wait on a grouped card: a lost reply on the 2nd alert is retried with its own id; the 1st is not resent', async () => {
    let second = 0;
    const s = part({
      ...base,
      command: async (type, payload) => {
        if (type === 'AnswerRequest' && (payload as { alert_id: string }).alert_id === 'W2' && ++second === 1) return { ok: false, error: { kind: 'network' } };
        return ok({});
      },
    });
    await flush();
    s.m.click(s.m.button('Wait', s.m.container.querySelector('.lc')!));
    await flush();
    expect(s.m.container.querySelector('.lc')).not.toBeNull();
    s.m.click(s.m.button('Wait', s.m.container.querySelector('.lc')!));
    await flush();
    const answers = s.command.mock.calls.filter((c) => c[0] === 'AnswerRequest').map((c) => [(c[1] as { alert_id: string }).alert_id, c[2]?.commandId]);
    expect(answers.map((a) => a[0])).toEqual(['W1', 'W2', 'W2']);
    expect(answers[2]![1]).toBe(answers[1]![1]);
    expect(s.m.container.querySelector('.lc')).toBeNull();
  });

  it('[02b §8 Late cards] an alert closed meanwhile (REQUEST_NOT_PENDING) counts as answered', async () => {
    const s = part({ ...base, command: async (type, payload) => (type === 'AnswerRequest' && (payload as { alert_id: string }).alert_id === 'W1' ? { ok: false, error: { kind: 'api', status: 409, code: 'REQUEST_NOT_PENDING', details: {} } } : ok({})) });
    await flush();
    s.m.click(s.m.button('Wait', s.m.container.querySelector('.lc')!));
    await flush();
    expect(s.m.container.querySelector('.lc')).toBeNull();
  });
});

describe('[02b §8 Late cards] permissions and stale cards — review #185 round 2', () => {
  const slips = [{ alert_id: 'W1', order_ids: ['O1'] }];
  const base = { body: merged, openSlips: slips, catchUpOrders: [cu('O1', at(20, 0), 'dine_in:S4')], tiles: [tile('F4', { joined_table_names: ['F4', 'F5'] }), tile('F5')] };
  const buttons = (s: ReturnType<typeof part>) => [...(s.m.container.querySelector('.lc')?.querySelectorAll('button') ?? [])].map((b) => b.textContent);

  it("[02b §8 Late cards] Wait only for the slip's named receiver; Send what's ready only with mark-served; else read-only", async () => {
    const none = part({ ...base, perms: { 'take-order': { grant: 'allowed', scope: 'branch' } } });
    await flush();
    expect(none.m.container.querySelector('.lc')).not.toBeNull();
    expect(buttons(none)).toEqual([]);
    none.m.unmount();
    const receiver = part({ ...base, rows: [row('W1', 'F4', 6)], perms: { 'take-order': { grant: 'allowed', scope: 'branch' } } });
    await flush();
    expect(buttons(receiver)).toEqual(['Wait']);
    receiver.m.unmount();
    const server = part({ ...base });
    await flush();
    expect(buttons(server)).toEqual(["Send what's ready"]);
  });

  it('[02b §8 Late cards] a card goes on an ItemsReleased frame with its alert_id, when its orders have nothing left, and a catch-up replaces open_slips', async () => {
    const s = part({ ...base, rows: [row('W1', 'F4', 6)] });
    await flush();
    expect(s.m.container.querySelector('.lc')).not.toBeNull();
    s.frame(50, 'ItemsReleased', { order_id: 'O1', alert_id: 'W1' });
    expect(s.m.container.querySelector('.lc')).toBeNull();
    s.m.unmount();

    // every line of the slip's order is served: nothing to send or hurry
    const servedO1 = sorder('O1', at(20, 0), [sline('Karahi', { stage: 'served', served_at: NOW - 60_000 })]);
    const t = part({ ...base, body: { orders: [servedO1, o2], total_minor: 0 } });
    await flush();
    expect(t.m.container.querySelector('.lc')).toBeNull();
    t.m.unmount();

    // SlipWarned adds a warning; a new catch-up (no open slips) replaces it
    const u = part({ ...base, openSlips: [] });
    await flush();
    u.frame(51, 'SlipWarned', { alert_id: 'W2', order_ids: ['O2'], table_key: 'dine_in:S4' });
    expect(u.m.container.querySelector('.lc')).not.toBeNull();
    act(() => u.live.frame({ type: 'catch_up', as_of_seq: 60, state: { orders: { orders: [], zone_stock: [], open_slips: [] } } } as never));
    expect(u.m.container.querySelector('.lc')).toBeNull();
  });

  it('[02b §8 Late cards] offline: Wait / Send what\'s ready say "Needs the hub" and send nothing', async () => {
    const s = part({ ...base, rows: [row('W1', 'F4', 6)], online: false });
    await flush();
    s.m.click(s.m.button('Wait', s.m.container.querySelector('.lc')!));
    expect(s.shell.toasts.current()?.text).toBe('Needs the hub');
    s.m.click(s.m.button("Send what's ready", s.m.container.querySelector('.lc')!));
    expect(s.m.container.querySelector('.dlg')).toBeNull();
    expect(s.command).not.toHaveBeenCalled();
  });
});

describe('[02b Q-10] interim card ids — review #185 fold', () => {
  it('[02b Q-10] a lost-reply Wait then Send what\'s ready uses a new command_id (another payload)', async () => {
    let n = 0;
    const s = part({ body: merged, rows: [row('W1', 'F4', 6)], command: async () => (++n === 1 ? { ok: false, error: { kind: 'network' } } : ok({})) });
    await flush();
    s.m.click(s.m.button('Wait', s.m.container.querySelector('.lc')!));
    await flush();
    s.m.click(s.m.button("Send what's ready", s.m.container.querySelector('.lc')!));
    await flush();
    const [a, b] = s.command.mock.calls.filter((c) => c[0] === 'AnswerRequest');
    expect((a![1] as { decision: string }).decision).toBe('decline');
    expect((b![1] as { decision: string }).decision).toBe('accept');
    expect(b![2]?.commandId).not.toBe(a![2]?.commandId);
  });
});
