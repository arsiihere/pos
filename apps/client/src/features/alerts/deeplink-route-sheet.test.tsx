import { aBranchConfig } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, row as alertRow } from '../../../test/alert-rows';
import { flush, mount, reply, type Mounted } from '../../../test/dom';
import type { Device, PageMeta } from '../staff/api';
import type { Draft, OrderViewBody } from '../staff/orders/contracts';
import { createMemoryDraftStore } from '../staff/orders/drafts/memory-drafts';
import { DraftStoreContext } from '../staff/orders/order-screen/OrderScreen';
import type { TableMapBody } from '../staff/tables/contracts';
import { StaffApp } from '../staff/StaffApp';
import type { SocketLike } from './socket';
import { fakeTimers, recordingSink } from './test-fakes';

// 01d v1.3.2 §3.13.2 rule 6 (DL Q-A (a), Q-B (a)), tests 86 (b) and 99, with the real 02a / 02b screens: TableSheet
// (loading and loaded), OrderView and OrderScreen with its real useTableLock. No screen is a probe here.


let scrolled: Element[] = [];
beforeEach(() => {
  scrolled = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  window.history.replaceState(null, '', '#/inbox');
});
afterEach(() => vi.unstubAllGlobals());


const MAP: TableMapBody = {
  as_of_seq: 1,
  floors: [
    {
      floor_id: 'F1',
      name: 'Main',
      archived: false,
      zones: [
        {
          zone_id: null,
          name: null,
          tables: [
            {
              table_id: 'T4', name: 'T4', seats: 4, archived: false, state: 'SEATED', seating_id: 'S4', party_size: 2, primary_table_id: 'T4',
              joined_table_names: [], holder: { staff_id: 'S-IMRAN', name: 'Imran' }, assignee: null, lock: null, opened_at: 0, bill_requested_at: null, live_order_count: 1,
            },
          ],
        },
      ],
    },
  ],
};

function body(over: Partial<OrderViewBody> = {}): OrderViewBody {
  return {
    order_id: 'O1',
    placed_by: { staff_id: 'ST-1', name: 'Hamza' },
    placed_at: 0,
    follow_up: false,
    cancelled: false,
    billed: false,
    has_phone: false,
    promise_ms: null,
    lines: [
      {
        order_item_id: 'L1', order_id: 'O1', parent_order_item_id: null, line_kind: 'item', item_id: 'I1', deal_id: null, name: 'Karahi', sale_unit: 'piece',
        quantity: 2, units: 2, live_units: 2, comped_units: 0, removed_units: 0, voided_units: 0, returned_units: 0, refundable_minor: 0, comp_minor: 0,
        comp_voided_minor: 0, removed_minor: 0, refund_minor: 0, line_total_minor: 0, billed_minor: 0, return_of: null, served_from_zone_id: null,
        zone_served: false, added_at: 0, served_at: null, served_source: null, is_food: true, kitchen_note: null, stage: 'cooking', fired: true,
      },
    ],
    order_type: 'dine_in',
    seating_id: 'S4',
    ...over,
  };
}

const ORDER_T = { type: 'order' as const, order_id: 'O1' };

const SERVED = alertRow({
  alert_id: 'A-SERVED',
  kind: 'served_card',
  family: 'info',
  set: 'recipient',
  raised_at: NOW - 60_000,
  lock: { kind_label_key: 'alert.served_card.lock', table_code: '4', point_code: null, requester_name: null },
  target: ORDER_T,
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));


class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send(): void {}
  close(): void {
    this.readyState = 3;
  }
  frame(obj: unknown): void {
    this.readyState = 1;
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

const META: PageMeta = { tenantId: 'TEN-1', branchId: 'BR-1', branchName: 'Gulberg', hubNowMs: NOW, utcOffsetMs: 0 };
const KIOSK: Device = { token: 'DEV-TOK', id: 'D-K1', type: 'cashier_kiosk' };

type Extra = Record<string, (url: string, body: unknown) => Response | Promise<Response>>;

function shellHub(inbox: unknown[], view: () => Response, extra: Extra = {}) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0]!;
    const method = init?.method ?? 'GET';
    const sent: unknown = init?.body === undefined ? undefined : JSON.parse(init.body as string);
    calls.push({ method, path, body: sent });
    const more = extra[`${method} ${path}`];
    if (more !== undefined) return more(url, sent);
    switch (`${method} ${path}`) {
      case 'GET /queries/staff-roster':
        return reply(200, { data: { staff: [{ staff_id: 'S-IMRAN', display_name: 'Imran', locked_until: null }], active_session: null } });
      case 'POST /auth/pin':
        return reply(200, { data: { session_token: 'SESS-1', session_id: 'X1', staff_id: 'S-IMRAN', display_name: 'Imran', role_ids: [], idle_ttl_ms: 600_000 } });
      case 'GET /queries/session':
        return reply(200, { data: { permissions: { 'approve-void': { grant: 'allowed' }, 'take-order': { grant: 'allowed' } } } });
      case 'GET /queries/alerts-inbox':
        return reply(200, { data: { alerts: inbox }, meta: { next_cursor: null } });
      case 'GET /queries/branch-config':
        return reply(200, { data: { config_version: 1, snapshot_hash: 'h', snapshot: aBranchConfig(), hub_time: { now_ms: NOW, utc_offset_ms: 0 } } });
      case 'GET /queries/requests-to-answer':
        return reply(200, { data: { requests: [] } });
      case 'GET /queries/my-requests':
        return reply(200, { data: { requests: [] } });
      case 'GET /queries/table-map':
        return reply(200, { data: MAP });
      case 'GET /queries/order-view':
        return view();
      case 'POST /commands/answer-request':
        return reply(200, { data: { result: { alert_id: 'R1', decision: 'approve', answered_at: NOW } } });
      case 'GET /queries/seating-orders':
        return reply(200, { data: { orders: [], total_minor: 0 } });
      case 'POST /commands/open-table':
        return reply(200, { data: { command_id: 'C', event_ids: [], result: { seating_id: 'S4', changed: false } } });
      case 'POST /commands/release-table-lock':
        return reply(200, { data: { command_id: 'C', event_ids: [], result: { released: true } } });
      case 'POST /commands/touch-table-lock':
        return reply(200, { data: { command_id: 'C', event_ids: [], result: { touched: true } } });
      case 'POST /commands/mark-alerts-seen':
        return reply(200, { data: { command_id: 'C', event_ids: [], result: { seen: [] } } });
      default:
        return reply(404, { error: { code: 'NOT_FOUND', message: `${method} ${path}`, details: {} } });
    }
  });
  return { fetch, calls };
}

let mm: Mounted | null = null;
afterEach(() => {
  mm?.unmount();
  mm = null;
});

async function shell(inbox: unknown[], view: () => Response, drafts = createMemoryDraftStore(), device: Device = KIOSK, extra: Extra = {}) {
  const sockets: FakeSocket[] = [];
  window.location.hash = '';
  const h = shellHub(inbox, view, extra);
  const timers = fakeTimers();
  mm = mount();
  mm.render(
    <DraftStoreContext.Provider value={drafts}>
    <StaffApp
      device={device}
      meta={META}
      fetch={h.fetch}
      createSocket={() => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      }}
      sink={recordingSink(timers)}
      timers={timers}
    />
    </DraftStoreContext.Provider>,
  );
  await flush();
  const m = mm;
  m.click(m.button('Imran'));
  const keys = m.container.querySelector('.pin__keys')!;
  for (const d of '1234') m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === d));
  m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === 'Sign in'));
  await flush(8);
  for (const s of sockets) s.frame({ type: 'catch_up', as_of_seq: 0, state: {} });
  await flush(4);
  return { h, m, sockets };
}



describe('[01d v1.3.2 §3.13.2 rule 6] the real route screens', () => {
  it('[01d #99] TableSheet (loading, then loaded) and OrderView carry data-route-sheet; a banner Open deep-links from each; a popup over TableSheet holds it back', async () => {
    let releaseMap: () => void = () => {};
    const mapGate = new Promise<void>((r) => (releaseMap = r));
    const { m, sockets } = await shell([], () => reply(200, { data: body() }), createMemoryDraftStore(), KIOSK, {
      // the table map is held back, so TableSheet shows its loading branch (no tile yet)
      'GET /queries/table-map': async () => {
        await mapGate;
        return reply(200, { data: MAP });
      },
      // O9 is a takeaway order (#/orders/O9, no map needed); O1 is dine-in at T4 / S4
      'GET /queries/order-view': (url) =>
        reply(200, { data: url.includes('order_id=O1') ? body() : body({ order_id: 'O9', order_type: 'takeaway', seating_id: null }) }),
    });
    const banner = async (id: string, target: { type: 'order'; order_id: string }) => {
      for (const s of sockets) s.frame({ type: 'alert', alert: { ...SERVED, alert_id: id, target } });
      await flush(4);
      m.click(m.button('Open', m.container.querySelector(`.abns [data-alert="${id}"]`)!));
      await flush(8);
      await wait(60);
      await flush(4);
    };
    // TableSheet loading: its loading section.tv is what is on screen
    window.location.hash = '#/tables/T4?seating_id=S4';
    await flush(8);
    const loading = m.container.querySelector('section.tv[aria-label="Loading…"]');
    expect(loading).not.toBeNull();
    expect(loading!.getAttribute('aria-modal')).toBe('true');
    expect(loading!.hasAttribute('data-route-sheet')).toBe(true);
    await banner('A-1', { type: 'order', order_id: 'O9' });
    expect(window.location.hash).toMatch(/^#\/orders\/O9/); // deep-linked from the loading sheet
    // OrderView
    expect(m.container.querySelector('section.tv[data-order="O9"]')?.hasAttribute('data-route-sheet')).toBe(true);
    releaseMap();
    await flush(8);
    await banner('A-2', { type: 'order', order_id: 'O1' });
    expect(window.location.hash).toMatch(/^#\/tables\/T4\?seating_id=S4/); // from OrderView to O1's table
    // TableSheet loaded
    await wait(40);
    await flush(8);
    const loaded = m.container.querySelector('section.tv[aria-modal="true"]:not([aria-label="Loading…"])');
    expect(loaded).not.toBeNull();
    expect(loaded!.hasAttribute('data-route-sheet')).toBe(true);
    await banner('A-3', { type: 'order', order_id: 'O9' });
    expect(window.location.hash).toMatch(/^#\/orders\/O9/);
    // a popup over TableSheet: the same tap does not navigate
    window.location.hash = '#/tables/T4?seating_id=S4';
    await flush(8);
    await wait(40);
    const popup = document.createElement('div');
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'true');
    document.body.appendChild(popup);
    try {
      await banner('A-4', { type: 'order', order_id: 'O9' });
      expect(window.location.hash).toBe('#/tables/T4?seating_id=S4');
    } finally {
      popup.remove();
    }
  });

  it('[01d #86] (b) from the real OrderScreen (real useTableLock): navigate, ReleaseTableLock once for T4 / S4, the draft kept; reopening from the table sheet (Add items → OpenTable) brings the cart back; #/held does not list it', async () => {
    const drafts = createMemoryDraftStore();
    const draft: Draft = { draft_id: 'DR1', device_id: 'D-K1', staff_id: 'S-IMRAN', order_type: 'dine_in', seating_id: 'S4', table_id: 'T4', cart: { lines: [{ key: 'L1', item_id: 'I3', quantity: 2, options: [] }] }, updated_at: NOW, held: false };
    await drafts.put(draft);
    const { h, m, sockets } = await shell([], () => reply(200, { data: body() }), drafts);
    window.location.hash = '#/order/dine_in/S4';
    await flush(12);
    await wait(40);
    const cartText = m.container.querySelector('.osc')!.textContent!;
    expect(cartText).toContain('2×');
    const before = h.calls.length;
    for (const s of sockets) s.frame({ type: 'alert', alert: SERVED });
    await flush(4);
    m.click(m.button('Open', m.container.querySelector('.abns [data-alert="A-SERVED"]')!));
    await flush(8);
    await wait(60);
    await flush(4);
    expect(window.location.hash).toMatch(/^#\/tables\/T4\?seating_id=S4(&|$)/);
    const releases = h.calls.slice(before).filter((c) => c.path === '/commands/release-table-lock');
    expect(releases).toHaveLength(1);
    expect(releases[0]!.body).toMatchObject({ payload: { table_id: 'T4', seating_id: 'S4' } });
    expect(await drafts.list('D-K1', 'S-IMRAN')).toMatchObject([{ draft_id: 'DR1', held: false, cart: draft.cart }]);
    // reopen from the real table sheet: Add items → OpenTable (the lock is taken again) → the order screen, cart intact
    await wait(40);
    await flush(8);
    const mid = h.calls.length;
    m.click(m.button('Add items'));
    await flush(12);
    await wait(40);
    expect(h.calls.slice(mid).map((c) => c.path)).toContain('/commands/open-table');
    expect(window.location.hash).toBe('#/order/dine_in/S4');
    expect(m.container.querySelector('.osc')!.textContent).toContain('2×');
    // #/held lists held drafts only
    window.location.hash = '#/held';
    await flush(12);
    await wait(40);
    expect(m.container.textContent).toContain('Held on this screen0');
  });
});
