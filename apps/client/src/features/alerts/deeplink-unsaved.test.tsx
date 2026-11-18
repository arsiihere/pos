import type { AlertLinkTarget } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, row as alertRow } from '../../../test/alert-rows';
import { flush, mount, reply, type Mounted } from '../../../test/dom';
import type { HubResult } from '../../api/hub-admin';
import type { Device, PageMeta } from '../staff/api';
import type { OrderViewAnswer, OrderViewBody } from '../staff/orders/contracts';
import { createMemoryDraftStore } from '../staff/orders/drafts/memory-drafts';
import { DraftStoreContext } from '../staff/orders/order-screen/OrderScreen';
import type { TableMapBody } from '../staff/tables/contracts';
import { StaffApp } from '../staff/StaffApp';
import { pageDialogOpen, tapAlert, type TapDeps, type TapRow } from './deeplink-tap';
import type { SocketLike } from './socket';
import { fakeTimers, recordingSink } from './test-fakes';

// 01d v1.3 §3.13.2 rule 6 (M5, DL-K1), §3.13.5 kiosk, §12.8 Back chip: unfinished work. A banner's Open never tears
// down a page dialog; a tap from the order screen navigates and the draft stays; the tap releases no lock; the kiosk
// gets a one-level Back chip.

vi.mock('../staff/tables/map/TableMap', () => ({
  TableMap: () => <div className="map"><div data-table="T4" /></div>,
}));
vi.mock('../staff/tables/sheet/TableSheet', () => ({
  TableSheet: ({ seating_id }: { table_id: string; seating_id: string | null }) => (
    <div data-seating={seating_id ?? ''}>
      <div className="ol" data-line="L1" />
    </div>
  ),
}));

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
              joined_table_names: [], holder: null, assignee: null, lock: null, opened_at: 0, bill_requested_at: null, live_order_count: 1,
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

function fakes(view: HubResult<OrderViewAnswer> = { ok: true, data: { kind: 'order', order: body() } }) {
  const order: string[] = [];
  const log = { order, toasts: [] as string[], navigated: [] as string[] };
  const deps: TapDeps = {
    orders: { orderView: () => Promise.resolve(view), zoneStock: () => Promise.resolve({ ok: true, data: [] }) },
    tables: { tableMap: () => Promise.resolve({ ok: true, data: MAP }) },
    heldMap: () => MAP,
    seen: () => void order.push('seen'),
    openSheet: () => void order.push('sheet'),
    navigate: (href) => (order.push('navigate'), log.navigated.push(href)),
    toast: (text) => (order.push('toast'), log.toasts.push(text)),
    arrive: () => void order.push('glow'),
  };
  return { deps, log };
}

const tapRow = (kind: string, target: AlertLinkTarget, over: Partial<TapRow> = {}): TapRow => ({
  alert_id: 'R1',
  kind,
  raised_at: 1_000,
  state: 'open',
  lock: { kind_label_key: `alert.${kind}.lock`, table_code: 'T4' },
  target,
  ...over,
});


const ORDER_T: AlertLinkTarget = { type: 'order', order_id: 'O1' };

describe('[01d v1.3 §3.13.2 rule 6] a page dialog is open', () => {
  it('[01d #86] (a) the Send dialog (any aria-modal="true") open: a banner Open does not navigate and opens the detail as in v1.2.5', async () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    try {
      const banner = fakes();
      expect(await tapAlert(tapRow('served_card', ORDER_T), { ...banner.deps, source: 'banner' })).toBe('sheet');
      expect(banner.log.order).toEqual(['seen', 'sheet']);
      // Inbox and Requests taps come from their own routes: unaffected
      const list = fakes();
      expect(await tapAlert(tapRow('served_card', ORDER_T), { ...list.deps, source: 'list' })).toBe('navigated');
      expect(list.log.order).toEqual(['seen', 'navigate', 'glow']);
    } finally {
      dialog.remove();
    }
    // no dialog: the banner follows the general rule
    const free = fakes();
    expect(await tapAlert(tapRow('served_card', ORDER_T), { ...free.deps, source: 'banner' })).toBe('navigated');
  });
});

describe('[01d v1.3.1 §3.13.2 rule 6; #257 review] the dialog check runs again after the check', () => {
  it('a popup that opened while the check ran holds a banner tap back too', async () => {
    let open = false;
    const { deps, log } = fakes();
    const orderView = deps.orders.orderView;
    deps.orders = { ...deps.orders, orderView: (id) => ((open = true), orderView(id)) };
    expect(await tapAlert(tapRow('served_card', ORDER_T), { ...deps, source: 'banner', dialogOpen: () => open })).toBe('sheet');
    expect(log.order).toEqual(['seen', 'sheet']);
  });
});

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

// ------------------------------------------------------------------------------------------------ the shell

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
const TABLET: Device = { token: 'DEV-TOK', id: 'D-T3', type: 'tablet' };

function shellHub(inbox: unknown[], view: () => Response) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0]!;
    const method = init?.method ?? 'GET';
    calls.push({ method, path, body: init?.body === undefined ? undefined : JSON.parse(init.body as string) });
    switch (`${method} ${path}`) {
      case 'GET /queries/staff-roster':
        return reply(200, { data: { staff: [{ staff_id: 'S-IMRAN', display_name: 'Imran', locked_until: null }], active_session: null } });
      case 'POST /auth/pin':
        return reply(200, { data: { session_token: 'SESS-1', session_id: 'X1', staff_id: 'S-IMRAN', display_name: 'Imran', role_ids: [], idle_ttl_ms: 600_000 } });
      case 'GET /queries/session':
        return reply(200, { data: { permissions: { 'approve-void': { grant: 'allowed' } } } });
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

async function shell(inbox: unknown[], view: () => Response, drafts = createMemoryDraftStore(), device: Device = KIOSK) {
  const sockets: FakeSocket[] = [];
  window.location.hash = '';
  const h = shellHub(inbox, view);
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


describe('[01d v1.3 §3.13.2 rule 6] the order screen and the kiosk Back chip', () => {
  it('[01d #86] (c) kiosk: after a deep-link navigation the Back chip returns to the hash the tap left; it goes at the next navigation of any kind', async () => {
    const { m } = await shell([SERVED], () => reply(200, { data: body() }));
    window.location.hash = '#/inbox';
    await flush(8);
    expect(m.container.querySelector('.abk .chip')).toBeNull();
    m.click(m.container.querySelector('[data-alert="A-SERVED"]'));
    await flush(8);
    await wait(40);
    await flush(4);
    expect(window.location.hash).toMatch(/^#\/tables\/T4\?seating_id=S4(&|$)/);
    m.click(m.container.querySelector('.abk .chip'));
    await flush(8);
    expect(window.location.hash).toBe('#/inbox');
    expect(m.container.querySelector('.abk .chip')).toBeNull();
    // again, then any other navigation drops the chip
    m.click(m.container.querySelector('[data-alert="A-SERVED"]'));
    await flush(8);
    await wait(40);
    await flush(4);
    expect(m.container.querySelector('.abk .chip')?.textContent).toContain('Back');
    window.location.hash = '#/tables';
    await flush(8);
    expect(m.container.querySelector('.abk .chip')).toBeNull();
  });

  it('[01d #86] (a) in the shell: a banner Open while a real popup is open is held back (the detail opens over it, no navigation)', async () => {
    const { m, sockets } = await shell([], () => reply(200, { data: body() }));
    window.location.hash = '#/inbox';
    await flush(8);
    const popup = document.createElement('div');
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'true'); // e.g. the Send dialog or a PIN pad
    document.body.appendChild(popup);
    try {
      for (const s of sockets) s.frame({ type: 'alert', alert: SERVED });
      await flush(4);
      m.click(m.button('Open', m.container.querySelector('.abns [data-alert="A-SERVED"]')!));
      await flush(8);
      await wait(60);
      expect(window.location.hash).toBe('#/inbox');
      expect(m.container.querySelector('[aria-modal="true"]')).not.toBeNull(); // the detail, over the screen
    } finally {
      popup.remove();
    }
  });

  it('[01d §3.13.2 rule 6; owner Q-A (a)] TableSheet and OrderView are route screens (data-route-sheet): a banner Open deep-links from them', async () => {
    const { m, sockets } = await shell([], () => reply(200, { data: body({ order_id: 'O9', order_type: 'takeaway', seating_id: null }) }));
    window.location.hash = '#/orders/O9';
    await flush(12);
    await wait(40);
    const view = m.container.querySelector('section.tv[aria-modal="true"]');
    expect(view?.hasAttribute('data-route-sheet')).toBe(true);
    for (const s of sockets) s.frame({ type: 'alert', alert: { ...SERVED, alert_id: 'A-S2', target: { type: 'order', order_id: 'O9' } } });
    await flush(4);
    m.click(m.button('Open', m.container.querySelector('.abns [data-alert="A-S2"]')!));
    await flush(8);
    await wait(60);
    // the same order's view: it is already the screen; the tap glows it in place (no dialog held it back)
    expect(scrolled).toContain(m.container.querySelector('section.tv[data-order="O9"]'));
    // and a route sheet alone does not count as a popup
    expect(pageDialogOpen()).toBe(false);
  });

  it('[01d §3.13.5 kiosk; #257 review] no Back chip off the kiosk, and none when the tap lands on the screen the person is on', async () => {
    const tablet = await shell([SERVED], () => reply(200, { data: body() }), createMemoryDraftStore(), TABLET);
    window.location.hash = '#/inbox';
    await flush(8);
    tablet.m.click(tablet.m.container.querySelector('[data-alert="A-SERVED"]'));
    await flush(8);
    await wait(60);
    expect(window.location.hash).toMatch(/^#\/tables\/T4\?seating_id=S4(&|$)/);
    expect(tablet.m.container.querySelector('.abk .chip')).toBeNull();
    tablet.m.unmount();
    mm = null;
    const kiosk = await shell([], () => reply(200, { data: body() }));
    window.location.hash = '#/tables/T4?seating_id=S4';
    await flush(8);
    for (const s of kiosk.sockets) s.frame({ type: 'alert', alert: { ...SERVED, alert_id: 'A-S3' } });
    await flush(4);
    kiosk.m.click(kiosk.m.button('Open', kiosk.m.container.querySelector('.abns [data-alert="A-S3"]')!));
    await flush(8);
    await wait(60);
    expect(window.location.hash).toMatch(/^#\/tables\/T4\?seating_id=S4(&|$)/);
    expect(kiosk.m.container.querySelector('.abk .chip')).toBeNull();
  });
});
