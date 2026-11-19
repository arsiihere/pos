import type { AlertLinkTarget } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, row as alertRow } from '../../../test/alert-rows';
import { flush, mount, reply, type Mounted } from '../../../test/dom';
import type { HubResult } from '../../api/hub-admin';
import type { Device, PageMeta } from '../staff/api';
import type { OrderViewAnswer, OrderViewBody } from '../staff/orders/contracts';
import type { TableMapBody } from '../staff/tables/contracts';
import { StaffApp } from '../staff/StaffApp';
import { tapAlert, type TapDeps, type TapRow } from './deeplink-tap';
import type { SocketLike } from './socket';
import { fakeTimers, recordingSink } from './test-fakes';

// 01d v1.3 §3.13.2 rule 5 (DL Q-3 (a), B3), §3.13.4 (full / partial void): a notice (the six notice kinds: copy
// kinds 14–17) glows its place, then NoticeSheet on top with all of today's facts. Not open or not checkable →
// NoticeSheet over the current screen, never the toast, so no notice loses its facts.

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

const LINE_T: AlertLinkTarget = { type: 'order_line', order_id: 'O1', order_item_id: 'L1' };

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



const NOTICES = ['pin_use_failed', 'answered_on_requester_device', 'request_result', 'approval_receipt'] as const;

describe('[01d v1.3 §3.13.2 rule 5] NoticeSheet on top (DL Q-3 (a))', () => {
  it('[01d §3.13.2 rule 5] every notice kind: open → navigate, glow, then the sheet on top', async () => {
    for (const kind of NOTICES) {
      const { deps, log } = fakes();
      expect(await tapAlert(tapRow(kind, LINE_T, { state: 'closed' }), deps), kind).toBe('navigated');
      expect(log.order, kind).toEqual(['seen', 'navigate', 'glow', 'sheet']);
    }
  });

  it('[01d #83] a full void\'s approved result (no live units) and a notice whose order-view fails → the sheet over the current screen, no toast', async () => {
    const full = body();
    full.lines[0]!.live_units = 0;
    full.lines[0]!.voided_units = 2;
    const cases: Array<[string, HubResult<OrderViewAnswer>]> = [
      ['full void', { ok: true, data: { kind: 'order', order: full } }],
      ['NETWORK', { ok: false, error: { kind: 'network' } }],
      ['403', { ok: false, error: { kind: 'api', status: 403, code: 'PERMISSION_DENIED', details: { reason: 'outside_scope' } } }],
      ['500', { ok: false, error: { kind: 'api', status: 500, code: 'INTERNAL', details: {} } }],
      ['404', { ok: false, error: { kind: 'api', status: 404, code: 'ORDER_NOT_FOUND', details: {} } }],
    ];
    for (const kind of NOTICES) {
      for (const [name, view] of cases) {
        const { deps, log } = fakes(view);
        expect(await tapAlert(tapRow(kind, LINE_T, { state: 'closed' }), deps), `${kind} ${name}`).toBe('sheet');
        expect(log.order, `${kind} ${name}`).toEqual(['seen', 'sheet']);
        expect(log.toasts).toEqual([]);
      }
    }
  });

  it('[01d #88] m4: a void of 1 of 3 approved → the result opens the line (2 live units), glows it, then the sheet', async () => {
    const partial = body();
    partial.lines[0]!.units = 3;
    partial.lines[0]!.live_units = 2;
    partial.lines[0]!.voided_units = 1;
    const { deps, log } = fakes({ ok: true, data: { kind: 'order', order: partial } });
    expect(await tapAlert(tapRow('request_result', LINE_T, { state: 'closed' }), deps)).toBe('navigated');
    expect(log.order).toEqual(['seen', 'navigate', 'glow', 'sheet']);
    expect(log.navigated).toEqual(['/tables/T4?seating_id=S4&focus=line%3AL1']);
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

function shellHub(inbox: unknown[], view: (url: string) => Response | Promise<Response>) {
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
        return reply(200, { data: { config_version: 1, snapshot_hash: 'h', snapshot: {}, hub_time: { now_ms: NOW, utc_offset_ms: 0 } } });
      case 'GET /queries/requests-to-answer':
        return reply(200, { data: { requests: [] } });
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

async function shell(inbox: unknown[], view: (url: string) => Response | Promise<Response>) {
  const sockets: FakeSocket[] = [];
  window.location.hash = '';
  const h = shellHub(inbox, view);
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
  window.location.hash = '#/inbox';
  await flush(8);
  return { h, m };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const notice = (kind: string, over: Record<string, unknown> = {}) =>
  alertRow({
    alert_id: `N-${kind}`,
    kind,
    family: 'info',
    set: 'recipient',
    raised_at: NOW - 60_000,
    lock: { kind_label_key: `alert.${kind}.lock`, table_code: '4', point_code: null, requester_name: 'Hamza' },
    card: { kind_label_key: `alert.${kind}.card`, table_code: '4', point_code: null, requester_name: 'Hamza', device_name: 'Tablet 3', details: { item: 'Karahi', reason: 'Not ours' } },
    target: LINE_T,
    ...over,
  });

describe('[01d v1.3 §3.13.2 rule 5] in the staff shell', () => {
  it('[01d #83] pin_use_failed, answered_on_requester_device, a rejected result with a note, an approved result, approval_receipt: navigate, glow, then NoticeSheet with its facts', async () => {
    const rows = [
      notice('pin_use_failed'),
      notice('answered_on_requester_device'),
      notice('request_result', { alert_id: 'N-rejected', outcome: 'rejected' }),
      notice('request_result', { alert_id: 'N-approved', outcome: 'approved' }),
      notice('approval_receipt', {
        card: { kind_label_key: 'alert.approval_receipt.card', table_code: '4', point_code: null, requester_name: 'Hamza', device_name: 'Tablet 3', details: { item: 'Karahi', amount: 220_000 } },
      }),
    ];
    const { m } = await shell(rows, () => reply(200, { data: body() }));
    for (const r of rows) {
      window.location.hash = '#/inbox';
      await flush(8);
      m.click(m.container.querySelector(`.inbox [data-alert="${r.alert_id}"], [data-alert="${r.alert_id}"]`));
      await flush(8);
      await wait(40);
      await flush(4);
      expect(window.location.hash, r.alert_id).toBe('#/tables/T4?seating_id=S4');
      expect(m.container.querySelector('[data-line="L1"]')?.classList.contains('pos-glow'), r.alert_id).toBe(true);
      const sheet = m.container.querySelector('[aria-modal="true"]');
      expect(sheet, r.alert_id).not.toBeNull();
      expect(sheet!.textContent, r.alert_id).toContain('Tablet 3');
      const notYou = sheet!.textContent!.includes('Not you?');
      expect(notYou, r.alert_id).toBe(r.kind === 'pin_use_failed' || r.kind === 'answered_on_requester_device');
      // the closer's note (details.reason) is a fact of the sheet (#256 Q-1 ruling: a Reason row)
      if (r.alert_id === 'N-rejected') expect(sheet!.textContent).toContain('ReasonNot ours');
      // every sheet shows its time; the receipt its amount (#256 review A-2)
      const facts = [...sheet!.querySelectorAll('.fact')].map((f) => f.textContent);
      expect(facts, r.alert_id).toContain('When2:03 PM');
      if (r.kind === 'approval_receipt') expect(facts).toContain('AmountRs 2,200');
      m.click(m.button('Close', sheet!));
      await flush(4);
    }
  });

  it('[01d §3.13.2 rule 5; #256 Q-1] NoticeSheet shows the closer\'s note (details.reason) as a Reason fact; none without one', async () => {
    const withNote = notice('request_result', { alert_id: 'N-note', outcome: 'rejected' });
    const noNote = notice('request_result', {
      alert_id: 'N-plain',
      outcome: 'approved',
      card: { kind_label_key: 'alert.request_result.card', table_code: '4', point_code: null, requester_name: 'Hamza', device_name: null, details: { item: 'Karahi' } },
    });
    const { m } = await shell([withNote, noNote], () => reply(503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'x', details: {} } }));
    for (const [r, note] of [[withNote, true], [noNote, false]] as const) {
      window.location.hash = '#/inbox';
      await flush(8);
      m.click(m.container.querySelector(`[data-alert="${r.alert_id}"]`));
      await flush(8);
      await wait(40);
      const sheet = m.container.querySelector('[aria-modal="true"]')!;
      const facts = [...sheet.querySelectorAll('.fact')].map((f) => f.textContent);
      expect(facts.includes('ReasonNot ours'), r.alert_id).toBe(note);
      m.click(m.button('Close', sheet));
      await flush(4);
    }
  });

  it('[01d #83] a notice whose order-view fails: NoticeSheet over the Inbox, no navigation, no toast', async () => {
    const { m } = await shell([notice('pin_use_failed')], () => reply(503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'x', details: {} } }));
    window.location.hash = '#/inbox';
    await flush(8);
    m.click(m.container.querySelector('[data-alert="N-pin_use_failed"]'));
    await flush(8);
    await wait(40);
    expect(window.location.hash).toBe('#/inbox');
    expect(m.container.querySelector('.toast')).toBeNull();
    expect(m.container.querySelector('[aria-modal="true"]')?.textContent).toContain('Not you?');
    expect(scrolled).toEqual([]);
  });
});

describe('[01d v1.3.1 §3.13.2 rule 5; #256 review] races around the sheet', () => {
  it('a late notice never replaces an open AnswerSheet in the middle of a PIN entry', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const late = notice('pin_use_failed');
    const request = alertRow({
      alert_id: 'R2',
      kind: 'void_approval',
      family: 'urgent',
      set: 'answerer',
      raised_at: NOW - 30_000,
      answers: ['approve', 'reject'],
      needs_pin: 'always',
      lock: { kind_label_key: 'alert.void_approval.lock', table_code: '4', point_code: null, requester_name: 'Hamza' },
      card: { kind_label_key: 'alert.void_approval.card', table_code: '4', point_code: null, requester_name: 'Hamza', device_name: null, details: { item: 'Seekh Kabab', quantity: 1, amount: 50_000, reason: 'Wrong' } },
    });
    const { m } = await shell([late, request], async () => {
      await gate;
      return reply(200, { data: body() });
    });
    window.location.hash = '#/inbox';
    await flush(8);
    m.click(m.container.querySelector('[data-alert="N-pin_use_failed"]'));
    await flush(4);
    m.click(m.container.querySelector('[data-alert="R2"]'));
    await flush(4);
    m.click(m.button('Approve', m.container.querySelector('[aria-modal="true"]')!));
    const keys = m.container.querySelector('.pin__keys')!;
    for (const d of '12') m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === d));
    const pinStep = m.container.querySelector('[aria-modal="true"]')!.innerHTML;
    release(); // the notice's check lands now
    await flush(8);
    await wait(60);
    expect(window.location.hash).toBe('#/inbox');
    expect(m.container.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);
    expect(m.container.querySelector('[aria-modal="true"]')!.innerHTML).toBe(pinStep);
    expect(m.container.textContent).not.toContain('Not you?');
  });
});
