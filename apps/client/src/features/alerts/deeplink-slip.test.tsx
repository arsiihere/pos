import type { AlertLinkTarget } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, requestRow } from '../../../test/alert-rows';
import { flush, mount, reply, type Mounted } from '../../../test/dom';
import type { HubResult } from '../../api/hub-admin';
import type { Device, PageMeta } from '../staff/api';
import type { OrderViewAnswer, OrderViewBody } from '../staff/orders/contracts';
import type { TableMapBody } from '../staff/tables/contracts';
import { StaffApp } from '../staff/StaffApp';
import { tapAlert, type TapDeps, type TapRow } from './deeplink-tap';
import type { SocketLike } from './socket';
import { fakeTimers, recordingSink } from './test-fakes';

// 01d v1.3.2 §3.13.2 rule 4 "slip_warning" (M3), §3.13.5 row "A dine-in slip", test 85: a dine-in slip answers in
// place, in its LateCard (no AnswerSheet); with no LateCard rendered AnswerSheet opens on top; a takeaway / parking
// slip goes to #/orders/<id>, glows the order block and opens AnswerSheet on top.

vi.mock('../staff/tables/map/TableMap', () => ({
  TableMap: () => <div className="map"><div data-table="T4" /></div>,
}));
// the table sheet's orders part: a round of O1 and, when `probe.lateCard`, the LateCard of slip A-SLIP (LateCard.tsx:
// data-alerts is the comma list of the group's alert ids)
const probe = vi.hoisted(() => ({ lateCard: true, round: true }));
vi.mock('../staff/tables/sheet/TableSheet', () => ({
  TableSheet: ({ seating_id }: { table_id: string; seating_id: string | null }) => (
    <div data-seating={seating_id ?? ''}>
      {probe.round && (
        <div className="rnd" data-order="O1">
          {probe.lateCard && <div className="lc" data-alerts="A-OTHER,A-SLIP" />}
        </div>
      )}
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
  probe.lateCard = true;
  probe.round = true;
  window.history.replaceState(null, '', '#/requests');
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

const SLIP_T: AlertLinkTarget = { type: 'order', order_id: 'O1' };
const slipRow = (over: Record<string, unknown> = {}) =>
  requestRow({
    alert_id: 'A-SLIP',
    kind: 'slip_warning',
    family: 'action',
    answers: ['accept', 'decline'],
    needs_pin: 'never',
    lock: { kind_label_key: 'alert.slip_warning.lock', table_code: '4', point_code: null, requester_name: null },
    card: { kind_label_key: 'alert.slip_warning.card', table_code: '4', point_code: null, requester_name: null, device_name: null, details: { minutes_late: 6 } },
    target: SLIP_T,
    ...over,
  });

describe('[01d v1.3.2 §3.13.2 rule 4 slip_warning (M3)] the tap rule', () => {
  it('[01d #85] (a) dine-in: the LateCard renders → navigate, glow it, no AnswerSheet; (c) no LateCard → AnswerSheet on top', async () => {
    const a = fakes();
    a.deps.arrive = () => (a.log.order.push('glow'), Promise.resolve(true));
    expect(await tapAlert(tapRow('slip_warning', SLIP_T, { alert_id: 'A-SLIP', answers: ['accept', 'decline'] }), a.deps)).toBe('navigated');
    await Promise.resolve();
    expect(a.log.navigated).toEqual(['/tables/T4?seating_id=S4&focus=late%3AA-SLIP']);
    expect(a.log.order).toEqual(['seen', 'navigate', 'glow']);
    const c = fakes();
    c.deps.arrive = () => (c.log.order.push('glow'), Promise.resolve(false));
    expect(await tapAlert(tapRow('slip_warning', SLIP_T, { alert_id: 'A-SLIP', answers: ['accept', 'decline'] }), c.deps)).toBe('navigated');
    await Promise.resolve();
    await Promise.resolve();
    expect(c.log.order).toEqual(['seen', 'navigate', 'glow', 'sheet']);
    // a stale tap opens nothing late
    const st = fakes();
    let current = true;
    st.deps.arrive = () => new Promise<boolean>((r) => setTimeout(() => r(false), 5));
    await tapAlert(tapRow('slip_warning', SLIP_T, { alert_id: 'A-SLIP', answers: ['accept'] }), { ...st.deps, isCurrent: () => current });
    current = false;
    await new Promise((r) => setTimeout(r, 20));
    expect(st.log.order).toEqual(['seen', 'navigate']);
  });

  it('[01d §3.13.2; #263 review 2] every tap that navigates settles: a non-slip tap at once, a dine-in slip once its wait is over (no route left held)', async () => {
    const plain = fakes({ ok: true, data: { kind: 'order', order: body() } });
    let n = 0;
    expect(await tapAlert(tapRow('served_card', SLIP_T), { ...plain.deps, settled: () => void (n += 1) })).toBe('navigated');
    expect(n).toBe(1); // right after the navigation
    const request = fakes();
    let r = 0;
    expect(await tapAlert(tapRow('void_approval', { type: 'order_line', order_id: 'O1', order_item_id: 'L1' }, { answers: ['approve'] }), { ...request.deps, settled: () => void (r += 1) })).toBe('navigated');
    expect(r).toBe(1);
    const slip = fakes();
    let land: (v: boolean) => void = () => {};
    slip.deps.arrive = () => new Promise<boolean>((res) => (land = res));
    let k = 0;
    await tapAlert(tapRow('slip_warning', SLIP_T, { alert_id: 'A-SLIP', answers: ['accept'] }), { ...slip.deps, settled: () => void (k += 1) });
    expect(k).toBe(0); // still waiting for its LateCard
    land(true);
    await new Promise((res) => setTimeout(res, 5));
    expect(k).toBe(1);
  });

  it('[01d §3.13.2 rule 6; #263 review] a popup opened during the wait: no AnswerSheet on top of it (the slip stays answerable from its row)', async () => {
    let dialog = false;
    const { deps, log } = fakes();
    let land: (v: boolean) => void = () => {};
    deps.arrive = () => (log.order.push('glow'), new Promise<boolean>((r) => (land = r)));
    await tapAlert(tapRow('slip_warning', SLIP_T, { alert_id: 'A-SLIP', answers: ['accept', 'decline'] }), { ...deps, dialogOpen: () => dialog });
    dialog = true; // e.g. the void sheet with its PIN pad
    land(false);
    await new Promise((r) => setTimeout(r, 10));
    expect(log.order).toEqual(['seen', 'navigate', 'glow']);
  });

  it('[01d §3.13.3; #263 review] the slip closed during the wait: "no longer open", no AnswerSheet', async () => {
    let state: 'open' | 'closed' = 'open';
    const { deps, log } = fakes();
    let land: (v: boolean) => void = () => {};
    deps.arrive = () => (log.order.push('glow'), new Promise<boolean>((r) => (land = r)));
    await tapAlert(tapRow('slip_warning', SLIP_T, { alert_id: 'A-SLIP', answers: ['accept', 'decline'] }), { ...deps, stateNow: () => state });
    state = 'closed';
    land(false);
    await new Promise((r) => setTimeout(r, 10));
    expect(log.order).toEqual(['seen', 'navigate', 'glow', 'toast']);
    expect(log.toasts).toEqual(['This item is no longer open.']);
  });

  it('[01d #85] (b) takeaway / parking: #/orders/<id>?focus=order:<id>, the order block glows, AnswerSheet on top at once', async () => {
    const { deps, log } = fakes({ ok: true, data: { kind: 'order', order: body({ order_type: 'takeaway', seating_id: null }) } });
    expect(await tapAlert(tapRow('slip_warning', SLIP_T, { alert_id: 'A-SLIP', answers: ['accept', 'decline'] }), deps)).toBe('navigated');
    expect(log.navigated).toEqual(['/orders/O1?focus=order%3AO1']);
    expect(log.order).toEqual(['seen', 'navigate', 'glow', 'sheet']);
  });
});

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
const TABLET: Device = { token: 'DEV-TOK', id: 'D-T3', type: 'tablet' };

function shellHub(requests: unknown[], view: (url: string) => Response | Promise<Response>) {
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
        return reply(200, { data: { alerts: [] }, meta: { next_cursor: null } });
      case 'GET /queries/branch-config':
        return reply(200, { data: { config_version: 1, snapshot_hash: 'h', snapshot: {}, hub_time: { now_ms: NOW, utc_offset_ms: 0 } } });
      case 'GET /queries/requests-to-answer':
        return reply(200, { data: { requests } });
      case 'GET /queries/my-requests':
        return reply(200, { data: { requests: [] } });
      case 'GET /queries/table-map':
        return reply(200, { data: MAP });
      case 'GET /queries/order-view':
        return view(url);
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

async function shell(requests: unknown[], view: (url: string) => Response | Promise<Response>) {
  const sockets: FakeSocket[] = [];
  window.location.hash = '';
  const h = shellHub(requests, view);
  const timers = fakeTimers();
  mm = mount();
  mm.render(
    <StaffApp
      device={TABLET}
      meta={META}
      fetch={h.fetch}
      createSocket={() => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      }}
      sink={recordingSink(timers)}
      timers={timers}
    />,
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
  window.location.hash = '#/requests';
  await flush(8);
  return { h, m };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));



describe('[01d v1.3.2 §3.13.2 rule 4 slip_warning (M3)] in the staff shell', () => {
  it('[01d #85] (a) dine-in: the LateCard whose data-alerts holds the id glows (not the round); no AnswerSheet', async () => {
    const { m } = await shell([slipRow()], () => reply(200, { data: body() }));
    m.click(m.container.querySelector('[data-alert="A-SLIP"]'));
    await flush(8);
    await wait(60);
    await flush(4);
    const late = m.container.querySelector<HTMLElement>('.lc[data-alerts="A-OTHER,A-SLIP"]')!;
    expect(scrolled).toEqual([late]);
    expect(late.classList.contains('pos-glow')).toBe(true);
    expect(m.container.querySelector('.rnd[data-order="O1"]')!.classList.contains('pos-glow')).toBe(false);
    expect(m.container.querySelector('[aria-modal="true"]:not([data-route-sheet])')).toBeNull();
  });

  it('[01d #85] (c) dine-in: the sheet has loaded (the order\'s round is on screen) with no LateCard → AnswerSheet on top at once, not after the arrival wait', async () => {
    probe.lateCard = false;
    const { m } = await shell([slipRow()], () => reply(200, { data: body() }));
    m.click(m.container.querySelector('[data-alert="A-SLIP"]'));
    await flush(8);
    await wait(100);
    await flush(4);
    expect(window.location.hash).toMatch(/^#\/tables\/T4\?seating_id=S4/);
    expect(m.container.querySelector('[aria-modal="true"]:not([data-route-sheet])')).not.toBeNull();
    expect(m.button('Accept')).toBeTruthy();
  });

  it('[01d #85] (c) the order never shows on the screen: AnswerSheet opens after the arrival wait', async () => {
    probe.round = false;
    const { m } = await shell([slipRow()], () => reply(200, { data: body() }));
    m.click(m.container.querySelector('[data-alert="A-SLIP"]'));
    await flush(8);
    await wait(100);
    expect(m.container.querySelector('[aria-modal="true"]:not([data-route-sheet])')).toBeNull();
    await wait(4_100); // ARRIVAL_MS
    await flush(4);
    expect(m.container.querySelector('[aria-modal="true"]:not([data-route-sheet])')).not.toBeNull();
  }, 10_000);

  it('[01d §3.13.2; #263 review] a route change during the wait: no AnswerSheet ever opens', async () => {
    probe.round = false;
    const { m } = await shell([slipRow()], () => reply(200, { data: body() }));
    m.click(m.container.querySelector('[data-alert="A-SLIP"]'));
    await flush(8);
    await wait(100);
    window.location.hash = '#/held'; // the person goes elsewhere while the sheet is still loading
    await flush(8);
    await wait(4_200);
    await flush(4);
    expect(window.location.hash).toBe('#/held');
    expect(m.container.querySelector('[aria-modal="true"]:not([data-route-sheet])')).toBeNull();
  }, 10_000);

  it('[01d #85] (b) takeaway: #/orders/<id>, the order block glows, AnswerSheet (Accept / Decline) on top, and the answer is sent', async () => {
    const { h, m } = await shell([slipRow()], () => reply(200, { data: body({ order_type: 'takeaway', seating_id: null }) }));
    m.click(m.container.querySelector('[data-alert="A-SLIP"]'));
    await flush(8);
    await wait(60);
    await flush(4);
    expect(window.location.hash).toBe('#/orders/O1');
    const block = m.container.querySelector<HTMLElement>('section.tv[data-order="O1"]')!;
    expect(scrolled).toContain(block);
    const sheet = m.container.querySelector('[aria-modal="true"]:not([data-route-sheet])')!;
    expect(sheet).not.toBeNull();
    m.click(m.button('Accept', sheet));
    await flush(8);
    const post = h.calls.find((c) => c.path === '/commands/answer-request');
    expect(post?.body).toMatchObject({ payload: { alert_id: 'A-SLIP', decision: 'accept' } });
  });

  it('[01d §3.13.2; #263 review 2] slip A still waiting, then slip B: A\'s late settle does not make B stale; B\'s AnswerSheet opens', async () => {
    probe.lateCard = false; // the sheet shows O1's round only: A (order O2) waits, B (order O1) is loaded without a card
    const a = slipRow({ alert_id: 'A-SLIPA', target: { type: 'order', order_id: 'O2' } });
    const b = slipRow({ alert_id: 'A-SLIPB', raised_at: NOW - 30_000 });
    const { m } = await shell([a, b], (url) => reply(200, { data: body({ order_id: url.includes('order_id=O2') ? 'O2' : 'O1' }) }));
    m.click(m.container.querySelector('[data-alert="A-SLIPA"]'));
    await flush(8);
    await wait(60);
    expect(m.container.querySelector('[aria-modal="true"]:not([data-route-sheet])')).toBeNull(); // A waits
    window.location.hash = '#/requests'; // back
    await flush(8);
    m.click(m.container.querySelector('[data-alert="A-SLIPB"]'));
    await flush(8);
    await wait(120);
    await flush(4);
    expect(window.location.hash).toMatch(/^#\/tables\/T4\?seating_id=S4/);
    expect(m.container.querySelector('[aria-modal="true"]:not([data-route-sheet])')).not.toBeNull(); // B's AnswerSheet
  });


});
