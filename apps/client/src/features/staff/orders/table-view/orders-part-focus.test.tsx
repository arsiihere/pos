import { act } from 'react';
import { afterEach, beforeEach, vi } from 'vitest';
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
import { glowOnArrival } from '../../../alerts/deeplink-tap';
import { LiveRegion } from '../../../alerts/LiveRegion';
import { navigate } from '../../../../app/router';

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
  /** hold the seating-orders answers until release() */
  hold?: boolean;
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
  const held: Array<() => void> = [];
  const orders = {
    seatingOrders: vi.fn(() => (o.hold === true ? new Promise((r) => held.push(() => r(ok(body)))) : Promise.resolve(ok(body)))),
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
    api: { command, query: vi.fn(async () => ({ ok: true as const, data: { orders: [] } })) /* 04 pending-voids */ },
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
    release: () => act(() => held.splice(0).forEach((r) => r())),
  };
}


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

// 01d v1.3 §3.13.2 rule 2 (unfold), §3.13.5 rows order / line / slip, DL Q-2 (a); 02b v1.0.15 §8 (forceOpen, m6).
// Integrator ruling (Cs #253): the tap owns the glow. The orders part only makes the place render and findable: on
// a `focus=order:` / `line:` hash it unfolds the round that holds it through forceOpen, once per new focus (a focus
// nonce), and never glows or drops `focus` itself. These tests run the real tap half (`glowOnArrival`, as the tap
// calls it right after navigating) over the real orders part. The harness is late.test.tsx's.

// F4 (O1, older) and F5 (O2) were joined after each had a slip warning (late.test.tsx)
const o1 = sorder('O1', at(20, 0), [sline('Karahi', { stage: 'cooking' }), sline('Naan', { stage: 'done', units: 6, live_units: 6 })]);
const o2 = sorder('O2', at(20, 5), [sline('Kebab', { name: 'Seekh Kebab', stage: 'added', units: 4, live_units: 4 })]);
const merged = { orders: [o1, o2], total_minor: 0 };

const HERE = '/tables/F4?seating_id=S4';
const served = (id: string, over: Partial<SeatingLine> = {}) => sline(id, { stage: 'served', served_at: NOW - 60_000, ...over });
// O1: fully served (folds); O2: still cooking
const o1s = sorder('O1', at(20, 0), [served('Karahi'), served('Naan', { units: 4, live_units: 4 })]);
const o2c = sorder('O2', at(20, 5), [sline('Kebab', { stage: 'cooking' })]);
const body2 = { orders: [o1s, o2c], total_minor: 0 };

const scrolled: Element[] = [];
let live: Mounted | null = null;
beforeEach(() => {
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
  live = mount();
  live.render(<LiveRegion />);
});
afterEach(() => {
  live?.unmount();
  live = null;
});

const q = (s: ReturnType<typeof part>, sel: string) => s.m.container.querySelector<HTMLElement>(sel);
const linesOf = (s: ReturnType<typeof part>, order_id: string) => [...s.m.container.querySelectorAll<HTMLElement>(`.rnd[data-order="${order_id}"] .ol[data-line]`)].map((l) => l.dataset.line);
const said = () => document.querySelector('[aria-live="polite"]')?.textContent ?? '';

/** The tap: navigate to the place's hash, then wait for its element (deeplink-tap.ts). */
/** jsdom fires hashchange as a task: let it run, then the reads settle */
const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  await flush();
};

/** The tap's real sequence (tapAlert `case 'open'`): navigate, then wait for the place (no hashchange of our own). */
function tap(href: string, focus: Parameters<typeof glowOnArrival>[1], label: string) {
  const moving = window.location.hash !== `#${href}`;
  navigate(href);
  return glowOnArrival(href, focus, label, { moving });
}

describe('[01d §3.13.5] orders part focus', () => {
  it('[01d #76] a served_card (order) target in a fully served round: the round unfolds through forceOpen and the tap glows it', async () => {
    const s = part({ body: body2 });
    await flush();
    expect(linesOf(s, 'O1')).toEqual([]); // folded: every line served
    const arrived = tap(`${HERE}&focus=order:O1`, { kind: 'order', order_id: 'O1' }, 'Opened order F4');
    await settle();
    expect(await arrived).toBe(true);
    await flush();
    const round = q(s, '.rnd[data-order="O1"]')!;
    expect(linesOf(s, 'O1')).toEqual(['Karahi', 'Naan']);
    // glowed once unfolded, not while folded (cs6 skips a place inside a folded round)
    expect(round.classList.contains('pos-glow')).toBe(true);
    expect(scrolled).toEqual([round]);
    expect(said()).toBe('Opened order F4');
    expect(window.location.hash).toBe(`#${HERE}`);
  });

  it('[01d #76] a comp (order_line) target in a fully served round: the round unfolds, the tap finds and glows the line', async () => {
    // the tap navigates before the sheet loads: the orders part mounts on the focus hash
    window.location.hash = `${HERE}&focus=line:Naan`;
    const arrived = glowOnArrival(`${HERE}&focus=line:Naan`, { kind: 'line', order_item_id: 'Naan' }, 'Opened item Naan');
    const s = part({ body: body2 });
    await settle();
    expect(await arrived).toBe(true);
    const line = q(s, '.rnd[data-order="O1"] .ol[data-line="Naan"]');
    expect(line).not.toBeNull();
    expect(line!.classList.contains('pos-glow')).toBe(true);
    expect(q(s, '.rnd[data-order="O1"]')!.classList.contains('pos-glow')).toBe(false);
    expect(scrolled).toEqual([line]);
    expect(window.location.hash).toBe(`#${HERE}`);
  });

  it('[01d §3.13.5] a line in an open round needs no unfold; the folded served round stays folded', async () => {
    window.location.hash = `${HERE}&focus=line:Kebab`;
    const s = part({ body: body2 });
    await flush();
    expect(linesOf(s, 'O2')).toEqual(['Kebab']);
    expect(linesOf(s, 'O1')).toEqual([]);
  });

  it('[01d §3.13.2 rule 4] a dine-in slip: the tap finds the LateCard whose data-alerts holds the alert, not the round', async () => {
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
    const late = tap(`${HERE}&focus=late:W2`, { kind: 'late', alert_id: 'W2' }, 'Opened late order F4 + F5');
    await settle();
    expect(await late).toBe(true);
    const card = q(s, '.lc')!;
    expect(card.dataset.alerts!.split(',')).toContain('W2');
    expect(card.classList.contains('pos-glow')).toBe(true);
    expect(s.m.container.querySelector('.rnd.pos-glow')).toBeNull();
  });

  it('[01d #76] ruling: the orders part never glows or drops focus itself (the tap owns the glow), it only unfolds', async () => {
    window.location.hash = `${HERE}&focus=order:O1`;
    const s = part({ body: body2 });
    await flush();
    expect(linesOf(s, 'O1')).toEqual(['Karahi', 'Naan']);
    expect(s.m.container.querySelector('.pos-glow')).toBeNull();
    expect(scrolled).toEqual([]);
    expect(said()).toBe('');
    expect(window.location.hash).toBe(`#${HERE}&focus=order:O1`);
  });

  it('[01d §3.13.4] a focus on a line this seating does not have unfolds nothing', async () => {
    for (const focus of ['line:GONE', 'order:O9', 'late:W9']) {
      window.location.hash = `${HERE}&focus=${focus}`;
      const s = part({ body: body2 });
      await flush();
      expect(linesOf(s, 'O1'), focus).toEqual([]);
      expect(s.m.container.querySelector('.pos-glow'), focus).toBeNull();
      s.m.unmount();
      current = null;
    }
  });

  it('[01d §3.13.3] the round unfolds only once the seating-orders read answers', async () => {
    window.location.hash = `${HERE}&focus=line:Naan`;
    const s = part({ body: body2, hold: true });
    await flush();
    expect(s.m.container.querySelector('.rnd')).toBeNull();
    s.release();
    await flush();
    expect(linesOf(s, 'O1')).toEqual(['Karahi', 'Naan']);
  });

  it('[01d §3.13.2] a second deep link to a round the person folded again reopens it (focus nonce)', async () => {
    const s = part({ body: body2 });
    await flush();
    const first = tap(`${HERE}&focus=order:O1`, { kind: 'order', order_id: 'O1' }, 'Opened order F4');
    await settle();
    expect(await first).toBe(true);
    expect(linesOf(s, 'O1')).toEqual(['Karahi', 'Naan']);
    expect(window.location.hash).toBe(`#${HERE}`);
    // the person folds it
    s.m.click(q(s, '.rnd[data-order="O1"] .rnd__h'));
    expect(linesOf(s, 'O1')).toEqual([]);
    // the very same tap again: the same focus string reopens it
    const again = tap(`${HERE}&focus=order:O1`, { kind: 'order', order_id: 'O1' }, 'Opened order F4');
    await settle();
    expect(await again).toBe(true);
    expect(linesOf(s, 'O1')).toEqual(['Karahi', 'Naan']);
    // folded again; a line of it, from another alert
    s.m.click(q(s, '.rnd[data-order="O1"] .rnd__h'));
    const line = tap(`${HERE}&focus=line:Naan`, { kind: 'line', order_item_id: 'Naan' }, 'Opened item Naan');
    await settle();
    expect(await line).toBe(true);
    expect(linesOf(s, 'O1')).toEqual(['Karahi', 'Naan']);
    expect(q(s, '.ol[data-line="Naan"]')!.classList.contains('pos-glow')).toBe(true);
  });

  it('[01d §3.13.2] the folded state the tap can see: a folded served round has .rnd__h[aria-expanded="false"], "true" once forced open', async () => {
    const s = part({ body: body2 });
    await flush();
    const head = () => q(s, '.rnd[data-order="O1"] > .rnd__h')!;
    expect(head().getAttribute('aria-expanded')).toBe('false');
    // a round that is not all served never folds and has no aria-expanded
    expect(q(s, '.rnd[data-order="O2"] > .rnd__h')!.hasAttribute('aria-expanded')).toBe(false);
    navigate(`${HERE}&focus=order:O1`);
    await settle();
    expect(head().getAttribute('aria-expanded')).toBe('true');
  });

  it('[01d §3.13.5] `focus=table` and no focus: the orders part is as before', async () => {
    for (const hash of [`${HERE}&focus=table`, HERE]) {
      window.location.hash = hash;
      const s = part({ body: body2 });
      await flush();
      expect(linesOf(s, 'O1'), hash).toEqual([]);
      expect(window.location.hash, hash).toBe(`#${hash}`);
      s.m.unmount();
      current = null;
    }
  });

  it('[01d §3.13.5] the hashchange listener goes with the orders part: unmounted, a later focus is not its', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const s = part({ body: body2 });
    await flush();
    const mine = add.mock.calls.filter((c) => c[0] === 'hashchange').map((c) => c[1]);
    expect(mine.length).toBeGreaterThan(0);
    s.m.unmount();
    current = null;
    for (const fn of mine) expect(remove.mock.calls.some((c) => c[0] === 'hashchange' && c[1] === fn), 'removed on unmount').toBe(true);
    navigate(`${HERE}&focus=order:O1`);
    await settle();
    expect(window.location.hash).toBe(`#${HERE}&focus=order:O1`);
    add.mockRestore();
    remove.mockRestore();
  });
});
