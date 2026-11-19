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

// 01d v1.3 §3.13.2 rule 4 (DL Q-1 (a), B2), §3.13.4 (kiosk lock-only, element not rendered, offline): a request the
// viewer can answer opens its place, glows it, then AnswerSheet on top. Only "the request is closed" stops the sheet;
// every other result opens AnswerSheet over the current screen as today, with no navigation, glow or toast.

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
  window.history.replaceState(null, '', '#/requests');
});
afterEach(() => vi.unstubAllGlobals());

const LINE_T: AlertLinkTarget = { type: 'order_line', order_id: 'O1', order_item_id: 'L1' };
const TABLE_T: AlertLinkTarget = { type: 'table', table_id: 'T4', seating_id: 'S4' };

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

describe('[01d v1.3 §3.13.2 rule 4] AnswerSheet on top (DL Q-1 (a))', () => {
  it('[01d #80] (a) an approver\'s void_approval: navigate to the line, glow, then AnswerSheet; (b) a table_handover receiver: the table sheet, then Accept / Decline', async () => {
    const a = fakes();
    expect(await tapAlert(tapRow('void_approval', LINE_T, { answers: ['approve', 'reject'] }), a.deps)).toBe('navigated');
    expect(a.log.order).toEqual(['seen', 'navigate', 'glow', 'sheet']);
    expect(a.log.navigated).toEqual(['/tables/T4?seating_id=S4&focus=line%3AL1']);
    const b = fakes();
    expect(await tapAlert(tapRow('table_handover', TABLE_T, { can_answer: true }), b.deps)).toBe('navigated');
    expect(b.log.order).toEqual(['seen', 'navigate', 'glow', 'sheet']);
    expect(b.log.navigated).toEqual(['/tables/T4?seating_id=S4&focus=table']);
  });

  it('[01d #80] (c) a closed request opens no sheet and shows the toast (the only result that stops the sheet, B2)', async () => {
    const { deps, log } = fakes();
    expect(await tapAlert(tapRow('void_approval', LINE_T, { answers: ['approve', 'reject'], state: 'closed' }), deps)).toBe('not_open');
    expect(log.order).toEqual(['seen', 'toast']);
    expect(log.toasts).toEqual(['This item is no longer open.']);
  });

  it('[01d #81] B2: 403 outside_scope, 5xx, NETWORK, not open (cancelled), { kind: missing } → AnswerSheet over the current screen; no navigation, glow or toast', async () => {
    const cases: Array<[string, HubResult<OrderViewAnswer>]> = [
      ['403 outside_scope', { ok: false, error: { kind: 'api', status: 403, code: 'PERMISSION_DENIED', details: { reason: 'outside_scope' } } }],
      ['5xx', { ok: false, error: { kind: 'api', status: 503, code: 'SERVICE_UNAVAILABLE', details: {} } }],
      ['NETWORK', { ok: false, error: { kind: 'network' } }],
      ['cancelled', { ok: true, data: { kind: 'order', order: body({ cancelled: true }) } }],
      ['404', { ok: false, error: { kind: 'api', status: 404, code: 'ORDER_NOT_FOUND', details: {} } }],
      ['missing (G-3)', { ok: true, data: { kind: 'missing' } }],
    ];
    for (const [name, view] of cases) {
      const { deps, log } = fakes(view);
      expect(await tapAlert(tapRow('void_approval', LINE_T, { answers: ['approve', 'reject'] }), deps), name).toBe('sheet');
      expect(log.order, name).toEqual(['seen', 'sheet']);
    }
  });

  it('[01d §3.13.2 rule 4; #255 review] the check hangs: past the timeout AnswerSheet opens over the current screen; the late result is dropped', async () => {
    let land: (v: HubResult<OrderViewAnswer>) => void = () => {};
    const hanging = new Promise<HubResult<OrderViewAnswer>>((r) => (land = r));
    const { deps, log } = fakes();
    deps.orders = { ...deps.orders, orderView: () => hanging };
    expect(await tapAlert(tapRow('void_approval', LINE_T, { answers: ['approve', 'reject'] }), { ...deps, checkTimeoutMs: 20 })).toBe('sheet');
    expect(log.order).toEqual(['seen', 'sheet']);
    land({ ok: true, data: { kind: 'order', order: body() } });
    await new Promise((r) => setTimeout(r, 10));
    expect(log.order).toEqual(['seen', 'sheet']); // no late navigation, glow or second sheet
    // a stale tap that times out opens nothing
    const stale = fakes();
    stale.deps.orders = { ...stale.deps.orders, orderView: () => new Promise(() => {}) };
    expect(await tapAlert(tapRow('void_approval', LINE_T, { answers: ['approve'] }), { ...stale.deps, checkTimeoutMs: 20, isCurrent: () => false })).toBe('stale');
    expect(stale.log.order).toEqual(['seen']);
  });

  it('[01d §3.13.2 rule 4] a viewer who may not answer only navigates: a kiosk\'s lock-only row, an informed row (can_answer false)', async () => {
    for (const over of [{}, { can_answer: false }, { answers: [] }] as Array<Partial<TapRow>>) {
      const { deps, log } = fakes();
      expect(await tapAlert(tapRow('void_approval', LINE_T, over), deps)).toBe('navigated');
      expect(log.order).toEqual(['seen', 'navigate', 'glow']);
    }
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

async function approveWithPin(m: Mounted): Promise<void> {
  m.click(m.button('Approve'));
  const keys = m.container.querySelector('.pin__keys')!;
  for (const d of '1234') m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === d));
  m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === 'Approve'));
  await flush(8);
}

describe('[01d v1.3 §3.13.2 rule 4] in the staff shell', () => {
  it('[01d #80] (a) a requests row the approver can answer: the line\'s table sheet, the line glows, AnswerSheet on top', async () => {
    const { m } = await shell([requestRow({ alert_id: 'R1', target: LINE_T })], () => reply(200, { data: body() }));
    m.click(m.container.querySelector('[data-alert="R1"]'));
    await flush(8);
    await wait(40);
    await flush(4);
    expect(window.location.hash).toBe('#/tables/T4?seating_id=S4');
    expect(m.container.querySelector('[data-line="L1"]')?.classList.contains('pos-glow')).toBe(true);
    expect(m.container.querySelector('[aria-modal="true"]')).not.toBeNull();
    expect(m.button('Approve')).toBeTruthy();
  });

  it('[01d #81] B2: order-view 403 outside_scope → AnswerSheet over #/requests, no navigation, no glow, no toast, and the answer is sent', async () => {
    const { h, m } = await shell([requestRow({ alert_id: 'R1', target: LINE_T })], () =>
      reply(403, { error: { code: 'PERMISSION_DENIED', message: 'x', details: { reason: 'outside_scope' } } }),
    );
    m.click(m.container.querySelector('[data-alert="R1"]'));
    await flush(8);
    await wait(40);
    expect(window.location.hash).toBe('#/requests');
    expect(scrolled).toEqual([]);
    expect(m.container.querySelector('.toast')).toBeNull();
    expect(m.container.querySelector('[aria-modal="true"]')).not.toBeNull();
    await approveWithPin(m);
    expect(h.calls.some((c) => c.path === '/commands/answer-request')).toBe(true);
  });
});

describe('[01d v1.3.1 §3.13.2 rule 4; #255 review] races around the sheet', () => {
  it('the PIN race: tap R1 (its check in flight), open R2 and start its PIN; R1\'s check lands: R2\'s sheet and PIN step stay, and AnswerRequest goes to R2', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const r1 = requestRow({ alert_id: 'R1', target: LINE_T });
    const r2 = requestRow({ alert_id: 'R2', raised_at: NOW - 60_000, card: { ...requestRow({ alert_id: 'x' }).card!, details: { item: 'Seekh Kabab', quantity: 1, amount: 50_000, reason: 'Wrong' } } });
    const { h, m } = await shell([r1, r2], async () => {
      await gate;
      return reply(200, { data: body() });
    });
    m.click(m.container.querySelector('[data-alert="R1"]'));
    await flush(4);
    m.click(m.container.querySelector('[data-alert="R2"]'));
    await flush(4);
    let sheet = m.container.querySelector('[aria-modal="true"]')!;
    expect(sheet.textContent).toContain('Seekh Kabab');
    m.click(m.button('Approve', sheet));
    const keys = m.container.querySelector('.pin__keys')!;
    for (const d of '12') m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === d));
    const pinStep = m.container.querySelector('[aria-modal="true"]')!.innerHTML;
    release(); // R1's check lands now
    await flush(8);
    await wait(40);
    expect(window.location.hash).toBe('#/requests'); // R1 did not navigate
    sheet = m.container.querySelector('[aria-modal="true"]')!;
    expect(sheet.innerHTML).toBe(pinStep); // the same sheet, same step, two digits in
    const keysNow = m.container.querySelector('.pin__keys')!;
    expect(keysNow).not.toBeNull(); // still the PIN step
    for (const d of '34') m.click([...keysNow.querySelectorAll('button')].find((b) => b.textContent === d));
    m.click([...keysNow.querySelectorAll('button')].find((b) => b.textContent === 'Approve'));
    await flush(8);
    const posts = h.calls.filter((c) => c.path === '/commands/answer-request');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toMatchObject({ payload: { alert_id: 'R2' } });
  });

  it('a hung check: after 3 s (CHECK_TIMEOUT_MS) AnswerSheet opens over #/requests; the late result neither navigates nor reopens', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { m } = await shell([requestRow({ alert_id: 'R1', target: LINE_T })], async () => {
      await gate;
      return reply(200, { data: body() });
    });
    m.click(m.container.querySelector('[data-alert="R1"]'));
    await flush(4);
    expect(m.container.querySelector('[aria-modal="true"]')).toBeNull();
    await wait(3_100);
    await flush(4);
    expect(m.container.querySelector('[aria-modal="true"]')).not.toBeNull();
    release();
    await flush(8);
    await wait(40);
    expect(window.location.hash).toBe('#/requests');
    expect(scrolled).toEqual([]);
  }, 10_000);
});
