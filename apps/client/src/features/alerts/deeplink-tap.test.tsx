import type { AlertLinkTarget } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, requestRow, row } from '../../../test/alert-rows';
import { flush, mount, reply, type Mounted } from '../../../test/dom';
import type { HubResult } from '../../api/hub-admin';
import type { Device, PageMeta } from '../staff/api';
import type { OrderViewAnswer, OrderViewBody, ZoneStockBody } from '../staff/orders/contracts';
import type { TableMapBody } from '../staff/tables/contracts';
import { StaffApp } from '../staff/StaffApp';
import { navigate } from '../../app/router';
import { tapAlert, type TapDeps, type TapRow } from './deeplink-tap';
import { LiveRegion } from './LiveRegion';
import type { SocketLike } from './socket';
import { fakeTimers, recordingSink } from './test-fakes';

// 01d v1.3 §3.13.2 rules 1–3, 7; §3.13.7; §8.1 (L-3): the one tap rule of every surface. Part A drives tapAlert with
// fakes of the reads and a real DOM; part B drives the staff shell's surfaces (Inbox card, banner Open, CallCard).

// the place screens are probes: they render the §3.13.5 data attributes the real screens carry (02a / 02b §8)
const probe = vi.hoisted(() => ({ glowMs: '1500ms', unfoldDelayMs: 0 }));
vi.mock('../staff/tables/map/TableMap', () => ({
  TableMap: () => <div className="map" data-probe="map"><div data-table="T4" /></div>,
}));
// the sheet holds a folded served round O1 (02b Round: .rnd > .rnd__h[aria-expanded="false"]); like OrdersPart (cp4)
// it unfolds the round when the route's focus names it
vi.mock('../staff/tables/sheet/TableSheet', async () => {
  const { useEffect, useState } = await import('react');
  const { useHashRoute } = await import('../../app/router');
  return {
    TableSheet: ({ seating_id }: { table_id: string; seating_id: string | null }) => {
      const route = useHashRoute();
      const wanted = decodeURIComponent(route).includes('focus=order:O1');
      const [open, setOpen] = useState(false);
      useEffect(() => {
        if (!wanted) return;
        const t = setTimeout(() => setOpen(true), probe.unfoldDelayMs);
        return () => clearTimeout(t);
      }, [wanted]);
      return (
        <div data-seating={seating_id ?? ''}>
          <div className="ol" data-line="L1" ref={(el) => el?.style.setProperty('--motion-glow', probe.glowMs)} />
          <div className="rnd" data-order="O1">
            <div className="rnd__h" aria-expanded={open ? 'true' : 'false'} />
          </div>
        </div>
      );
    },
  };
});

let scrolled: Element[] = [];
/** for a round: was its header unfolded when it was scrolled to (and glowed)? */
let unfoldedAtScroll: Array<string | null> = [];
beforeEach(() => {
  scrolled = [];
  unfoldedAtScroll = [];
  probe.unfoldDelayMs = 0;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
    if (this.classList.contains('rnd')) unfoldedAtScroll.push(this.querySelector(':scope > .rnd__h')?.getAttribute('aria-expanded') ?? null);
  };
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  window.history.replaceState(null, '', '#/inbox');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ----------------------------------------------------------------------------------------------- part A

const LINE_T: AlertLinkTarget = { type: 'order_line', order_id: 'O1', order_item_id: 'L1' };
const ZONE_T: AlertLinkTarget = { type: 'zone_item', zone_id: 'Z1', item_id: 'I9' };
const TABLE_T: AlertLinkTarget = { type: 'table', table_id: 'T5', seating_id: 'S5' };
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

function fakes(o: { view?: HubResult<OrderViewAnswer>; zones?: HubResult<ZoneStockBody[]>; map?: TableMapBody } = {}) {
  const log = { seen: 0, sheet: 0, navigated: [] as string[], toasts: [] as string[], reads: [] as string[] };
  const deps: TapDeps = {
    orders: {
      orderView: (id) => (log.reads.push(`order-view ${id}`), Promise.resolve(o.view ?? { ok: true, data: { kind: 'order', order: body() } })),
      zoneStock: () => (log.reads.push('zone-stock'), Promise.resolve(o.zones ?? { ok: true, data: [] })),
    },
    tables: { tableMap: () => (log.reads.push('table-map'), Promise.resolve({ ok: true, data: o.map ?? MAP })) },
    heldMap: () => o.map ?? MAP,
    seen: () => void (log.seen += 1),
    openSheet: () => void (log.sheet += 1),
    navigate: (href) => {
      log.navigated.push(href);
      window.location.hash = href;
    },
    toast: (text) => void log.toasts.push(text),
  };
  return { deps, log };
}

const tapRow = (kind: string, target: AlertLinkTarget | null | undefined, over: Partial<TapRow> = {}): TapRow => ({
  alert_id: 'A1',
  kind,
  raised_at: 1_000,
  state: 'open',
  lock: { kind_label_key: `alert.${kind}.lock`, table_code: 'T4' },
  card: { kind_label_key: `alert.${kind}.card`, table_code: 'T4', details: { item: 'Karahi' } },
  ...(target === undefined ? {} : { target }),
  ...over,
});

describe('[01d v1.3 §3.13.2] tapAlert', () => {
  let m: Mounted | null = null;
  afterEach(() => {
    m?.unmount();
    m = null;
    document.body.querySelectorAll('[data-test-place]').forEach((el) => el.remove());
  });

  it('[01d #74] open: navigate to the §3.13.5 hash, scroll the place, glow it for --motion-glow (1500ms), "Opened …", seen once, focus dropped by replaceState', async () => {
    vi.useFakeTimers();
    m = mount();
    m.render(<LiveRegion />);
    const { deps, log } = fakes();
    const lengthBefore = window.history.length;
    const outcome = await tapAlert(tapRow('engine_line_dropped', LINE_T), deps);
    expect(outcome).toBe('navigated');
    expect(log.navigated).toEqual(['/tables/T4?seating_id=S4&focus=line%3AL1']);
    expect(log.seen).toBe(1);
    expect(log.sheet).toBe(0);
    expect(log.reads).toEqual(['order-view O1']); // the held map: no table-map
    const lengthAfterNavigate = window.history.length;
    // the screen renders the place after its own read
    const place = document.createElement('div');
    place.className = 'ol';
    place.dataset['line'] = 'L1';
    place.dataset['testPlace'] = '';
    place.style.setProperty('--motion-glow', '1500ms');
    document.body.appendChild(place);
    await vi.advanceTimersByTimeAsync(40); // the hashchange, then the next frame (the screen has rendered the focus)
    expect(scrolled).toEqual([place]);
    expect(place.classList.contains('pos-glow')).toBe(true);
    await flush(2); // the live region re-renders
    expect(document.querySelector('[role="status"][aria-live="polite"]')?.textContent).toBe('Opened item Karahi');
    expect(window.location.hash).toBe('#/tables/T4?seating_id=S4'); // focus consumed, seating kept
    expect(window.history.length).toBe(lengthAfterNavigate); // replaceState: no entry for the consume
    expect(lengthAfterNavigate).toBeGreaterThanOrEqual(lengthBefore);
    await vi.advanceTimersByTimeAsync(1_459);
    expect(place.classList.contains('pos-glow')).toBe(true);
    await vi.advanceTimersByTimeAsync(41);
    expect(place.classList.contains('pos-glow')).toBe(false);
    expect(log.toasts).toEqual([]);
  });

  it('[01d §3.13.2 rule 2; #253 review] the old screen holds a matching element: it is not glowed; the new screen\'s is', async () => {
    // a tiny router: #/orders shows the list row button.oo[data-order=O1]; #/orders/O1 shows OrderView's root
    const host = document.createElement('div');
    host.dataset['testPlace'] = '';
    document.body.appendChild(host);
    const draw = () => {
      host.innerHTML = window.location.hash.startsWith('#/orders/O1') ? '<div class="ov" data-order="O1"></div>' : '<button class="oo" data-order="O1"></button>';
    };
    window.history.replaceState(null, '', '#/orders');
    draw();
    window.addEventListener('hashchange', draw);
    try {
      const oldRow = host.querySelector('button.oo')!;
      const takeaway = body({ order_type: 'takeaway', seating_id: null });
      const { deps } = fakes({ view: { ok: true, data: { kind: 'order', order: takeaway } } });
      expect(await tapAlert(tapRow('served_card', { type: 'order', order_id: 'O1' }), { ...deps, navigate })).toBe('navigated');
      await new Promise((r) => setTimeout(r, 60));
      const view = host.querySelector('div.ov')!;
      expect(scrolled).not.toContain(oldRow);
      expect(scrolled).toEqual([view]);
      expect(view.classList.contains('pos-glow')).toBe(true);
      expect(window.location.hash).toBe('#/orders/O1');
    } finally {
      window.removeEventListener('hashchange', draw);
    }
  });

  it('[01d §3.13.3 m5; #247 review] an open slip with no order place left → today\'s tap (its sheet), never "no longer open"', async () => {
    const { deps, log } = fakes({ view: { ok: true, data: { kind: 'order', order: body({ cancelled: true }) } } });
    expect(await tapAlert(tapRow('slip_warning', { type: 'order', order_id: 'O1' }), deps)).toBe('sheet');
    expect(log).toMatchObject({ seen: 1, sheet: 1, navigated: [], toasts: [] });
  });

  it('[01d §3.13.4] the place never renders: no glow, no toast; focus is still dropped', async () => {
    vi.useFakeTimers();
    const { deps, log } = fakes();
    await tapAlert(tapRow('engine_line_dropped', LINE_T), deps);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(scrolled).toEqual([]);
    expect(log.toasts).toEqual([]);
    expect(window.location.hash).toBe('#/tables/T4?seating_id=S4');
  });

  it('[01d #75] not open (404, cancelled, billed, line missing, live_units 0, ready_to_serve all served, table unresolved, zone item missing, closed request): toast, route unchanged, no sheet, seen', async () => {
    const lineGone = body({ lines: [] });
    const zeroUnits = body();
    zeroUnits.lines[0]!.live_units = 0;
    const allServed = body();
    allServed.lines[0]!.served_at = 5;
    const cases: Array<[string, TapRow, Parameters<typeof fakes>[0]]> = [
      ['404', tapRow('engine_line_dropped', LINE_T), { view: { ok: false, error: { kind: 'api', status: 404, code: 'ORDER_NOT_FOUND', details: {} } } }],
      ['cancelled', tapRow('engine_line_dropped', LINE_T), { view: { ok: true, data: { kind: 'order', order: body({ cancelled: true }) } } }],
      ['billed', tapRow('served_card', { type: 'order', order_id: 'O1' }), { view: { ok: true, data: { kind: 'order', order: body({ billed: true }) } } }],
      ['line missing', tapRow('engine_line_dropped', LINE_T), { view: { ok: true, data: { kind: 'order', order: lineGone } } }],
      ['live_units 0', tapRow('engine_line_dropped', LINE_T), { view: { ok: true, data: { kind: 'order', order: zeroUnits } } }],
      ['ready_to_serve all served', tapRow('ready_to_serve', { type: 'order', order_id: 'O1' }), { view: { ok: true, data: { kind: 'order', order: allServed } } }],
      ['table unresolved', tapRow('call_waiter', TABLE_T), {}],
      ['zone item missing', tapRow('zone_stock_low', ZONE_T), { zones: { ok: true, data: [{ zone_id: 'Z1', name: 'Counter', items: [] }] } }],
      ['closed request (row state / alert_closed)', tapRow('comp', LINE_T, { state: 'closed' }), {}],
    ];
    for (const [name, r, o] of cases) {
      window.history.replaceState(null, '', '#/inbox');
      const { deps, log } = fakes(o);
      expect(await tapAlert(r, deps), name).toBe('not_open');
      expect(log.toasts, name).toEqual(['This item is no longer open.']);
      expect(log.navigated, name).toEqual([]);
      expect(window.location.hash, name).toBe('#/inbox');
      expect(log.sheet, name).toBe(0);
      expect(log.seen, name).toBe(1);
    }
  });

  it('[01d #75] DL Q-2 (a): a served comp / void_approval line is open', async () => {
    const served = body();
    served.lines[0]!.served_at = 5;
    served.lines[0]!.stage = 'served';
    for (const kind of ['comp', 'void_approval']) {
      const { deps, log } = fakes({ view: { ok: true, data: { kind: 'order', order: served } } });
      expect(await tapAlert(tapRow(kind, LINE_T), deps), kind).toBe('navigated');
      expect(log.toasts, kind).toEqual([]);
    }
  });

  it('[01d §3.13.2 rule 2] cannot check: the existing text of the error, stay, seen; never a guess', async () => {
    const cases: Array<[HubResult<OrderViewAnswer>, string]> = [
      [{ ok: false, error: { kind: 'network' } }, 'No connection to the hub — try again.'],
      [{ ok: false, error: { kind: 'api', status: 403, code: 'PERMISSION_DENIED', details: { reason: 'outside_scope' } } }, 'This table is outside your floors'],
      [{ ok: false, error: { kind: 'api', status: 500, code: 'INTERNAL', details: {} } }, 'That did not work. Try again.'],
    ];
    for (const [view, text] of cases) {
      const { deps, log } = fakes({ view });
      expect(await tapAlert(tapRow('engine_line_dropped', LINE_T), deps)).toBe('cannot_check');
      expect(log.toasts).toEqual([text]);
      expect(log.navigated).toEqual([]);
      expect(log.seen).toBe(1);
    }
  });

  it('[01d #78] target null keeps today\'s tap: station_overload, kds_offline, printer_problem, no_approver, test_alert, a pre-v1.3 request_result', async () => {
    for (const [kind, target] of [
      ['station_overload', null],
      ['kds_offline', null],
      ['printer_problem', null],
      ['no_approver', null],
      ['test_alert', null],
      ['request_result', undefined], // a row raised before v1.3: no key at all
    ] as const) {
      const { deps, log } = fakes();
      expect(await tapAlert(tapRow(kind, target), deps), kind).toBe('sheet');
      expect(log, kind).toMatchObject({ seen: 1, sheet: 1, navigated: [], toasts: [], reads: [] });
    }
  });

  it('[01d §3.13.2 rule 4] a viewer who may not answer (a kiosk\'s lock-only row: no answers, can_answer false) navigates, no sheet', async () => {
    const { deps, log } = fakes();
    expect(await tapAlert(tapRow('void_approval', LINE_T, { can_answer: false }), deps)).toBe('navigated');
    expect(log.sheet).toBe(0);
  });

  it('[01d §3.13.2] a stale tap (a newer tap, a session or route change during the check) does nothing after the check', async () => {
    let current = true;
    const { deps, log } = fakes();
    const pending = tapAlert(tapRow('engine_line_dropped', LINE_T), { ...deps, isCurrent: () => current });
    current = false; // e.g. a second tap came in while the order-view read was in flight
    expect(await pending).toBe('stale');
    expect(log).toMatchObject({ seen: 1, sheet: 0, navigated: [], toasts: [] });
  });

  it('[01d §3.13.3] the request closed while the check ran (live row or alert_closed) → "no longer open", no navigation', async () => {
    const { deps, log } = fakes();
    expect(await tapAlert(tapRow('comp', LINE_T), { ...deps, stateNow: () => 'closed' })).toBe('not_open');
    expect(log.toasts).toEqual(['This item is no longer open.']);
    expect(log.navigated).toEqual([]);
    // not a request kind: its own closed state is not the place's (served_card, call_waiter, …)
    const other = fakes();
    expect(await tapAlert(tapRow('served_card', { type: 'order', order_id: 'O1' }), { ...other.deps, stateNow: () => 'closed' })).toBe('navigated');
  });

  it('[01d §3.13.3] a zone target lands on #/zones?focus=item:… with one zone-stock read; a table target on the table sheet', async () => {
    const zones: ZoneStockBody[] = [{ zone_id: 'Z1', name: 'Counter', items: [{ item_id: 'I9', name: 'Coke', on_hand: 1, threshold: 5 }] }];
    const z = fakes({ zones: { ok: true, data: zones } });
    expect(await tapAlert(tapRow('zone_stock_low', ZONE_T), z.deps)).toBe('navigated');
    expect(z.log.navigated).toEqual(['/zones?focus=item%3AZ1%3AI9']);
    expect(z.log.reads).toEqual(['zone-stock']);
    const tb = fakes();
    expect(await tapAlert(tapRow('call_waiter', { type: 'table', table_id: 'T4', seating_id: 'S4' }), tb.deps)).toBe('navigated');
    expect(tb.log.navigated).toEqual(['/tables/T4?seating_id=S4&focus=table']);
    expect(tb.log.reads).toEqual([]);
  });
});

// ----------------------------------------------------------------------------------------------- part B

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

const DROPPED = row({
  alert_id: 'A-DROP',
  kind: 'engine_line_dropped',
  family: 'action',
  set: 'recipient',
  lock: { kind_label_key: 'alert.engine_line_dropped.lock', table_code: '4', point_code: null, requester_name: null },
  card: { kind_label_key: 'alert.engine_line_dropped.card', table_code: '4', point_code: null, requester_name: null, device_name: null, details: { item: 'Karahi' } },
  target: LINE_T,
});
const CALL = row({
  alert_id: 'A-CALL',
  kind: 'call_waiter',
  family: 'action',
  set: 'recipient',
  lock: { kind_label_key: 'alert.call_waiter.lock', table_code: '4', point_code: null, requester_name: null },
  target: { type: 'table', table_id: 'T4', seating_id: 'S4' },
});

const hubRequests: { rows: unknown[] } = { rows: [] };

function shellHub(
  inbox: unknown[],
  orderView: (url: string) => Response | Promise<Response> = () => reply(200, { data: body() }),
  seenReplies: Array<() => Response> = [],
) {
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
        return reply(200, { data: { permissions: {} } });
      case 'GET /queries/alerts-inbox':
        return reply(200, { data: { alerts: inbox }, meta: { next_cursor: null } });
      case 'GET /queries/branch-config':
        return reply(200, { data: { config_version: 1, snapshot_hash: 'h', snapshot: {}, hub_time: { now_ms: NOW, utc_offset_ms: 0 } } });
      case 'GET /queries/requests-to-answer':
        return reply(200, { data: { requests: hubRequests.rows } });
      case 'GET /queries/my-requests':
        return reply(200, { data: { requests: [] } });
      case 'GET /queries/table-map':
        return reply(200, { data: MAP });
      case 'GET /queries/order-view':
        return orderView(url);
      case 'POST /commands/mark-alerts-seen':
        return (seenReplies.shift() ?? (() => reply(200, { data: { command_id: 'C', event_ids: [], result: { seen: [] } } })))();
      default:
        return reply(404, { error: { code: 'NOT_FOUND', message: `${method} ${path}`, details: {} } });
    }
  });
  return { fetch, calls };
}

let sockets: FakeSocket[] = [];
let shellMount: Mounted | null = null;
afterEach(() => {
  shellMount?.unmount();
  shellMount = null;
});

afterEach(() => {
  hubRequests.rows = [];
});

async function signedInShell(inbox: unknown[], orderView?: (url: string) => Response | Promise<Response>, seenReplies?: Array<() => Response>) {
  sockets = [];
  window.location.hash = '';
  const h = shellHub(inbox, orderView, seenReplies);
  const timers = fakeTimers();
  shellMount = mount();
  shellMount.render(
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
  const mm = shellMount;
  mm.click(mm.button('Imran'));
  const keys = mm.container.querySelector('.pin__keys')!;
  for (const d of '1234') mm.click([...keys.querySelectorAll('button')].find((b) => b.textContent === d));
  mm.click([...keys.querySelectorAll('button')].find((b) => b.textContent === 'Sign in'));
  await flush(8);
  for (const s of sockets) s.frame({ type: 'catch_up', as_of_seq: 0, state: {} });
  await flush(4);
  return { h, mm };
}

const seenCalls = (h: ReturnType<typeof shellHub>) => h.calls.filter((c) => c.path === '/commands/mark-alerts-seen').map((c) => c.body as { payload?: { alert_ids: string[] } });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('[01d v1.3 §3.13.7] the staff shell\'s surfaces use the tap rule', () => {
  it('[01d #74] an Inbox card of a linked kind: the line\'s table sheet opens, the line glows, "Opened …", MarkAlertsSeen once, focus dropped', async () => {
    const { h, mm } = await signedInShell([DROPPED]);
    window.location.hash = '#/inbox';
    await flush(4);
    mm.click(mm.container.querySelector('[data-alert="A-DROP"]'));
    await flush(8);
    await wait(40);
    await flush(4);
    const line = mm.container.querySelector<HTMLElement>('[data-line="L1"]');
    expect(line).not.toBeNull();
    expect(scrolled).toContain(line);
    expect(line!.classList.contains('pos-glow')).toBe(true);
    expect(window.location.hash).toBe('#/tables/T4?seating_id=S4');
    expect(mm.container.querySelector('[role="status"][aria-live="polite"]')?.textContent).toBe('Opened item Karahi');
    expect(h.calls.filter((c) => c.path === '/queries/order-view')).toHaveLength(1);
    await wait(300); // the 250 ms seen flush
    expect(seenCalls(h).map((b) => JSON.stringify(b))).toHaveLength(1);
    expect(JSON.stringify(seenCalls(h)[0])).toContain('A-DROP');
    // the sheet of today's tap does not open (it is a notice kind with a place)
    expect(mm.container.querySelector('[aria-modal="true"]')).toBeNull();
  });

  it('[01d §3.13.5] focus is consumed once: re-renders after the glow (replaceState fires no hashchange) never glow again', async () => {
    probe.glowMs = '30ms'; // a short glow, so it ends inside the test (real timers)
    const { mm } = await signedInShell([DROPPED]);
    window.location.hash = '#/inbox';
    await flush(4);
    mm.click(mm.container.querySelector('[data-alert="A-DROP"]'));
    await flush(8);
    await wait(40);
    await flush(4);
    const line = mm.container.querySelector<HTMLElement>('[data-line="L1"]')!;
    expect(scrolled).toEqual([line]);
    // the glow ends; the page re-renders many times (frames, a store change, the clock) with the same route
    await wait(60);
    expect(line.classList.contains('pos-glow')).toBe(false);
    probe.glowMs = '1500ms';
    for (const s of sockets) {
      s.frame({ type: 'alert', alert: { ...CALL, alert_id: 'A-OTHER' } });
      s.frame({ type: 'catch_up', as_of_seq: 1, state: {} });
    }
    await flush(8);
    await wait(20);
    await flush(4);
    expect(scrolled).toEqual([line]); // one glow per tap: the tap is the nonce, never the route
    expect(line.classList.contains('pos-glow')).toBe(false);
    expect(window.location.hash).toBe('#/tables/T4?seating_id=S4');
  });

  it('[01d §3.13.2] two rapid taps: only the second one navigates, even when the first one\'s check lands last', async () => {
    let releaseO1: () => void = () => {};
    const o1Gate = new Promise<void>((r) => (releaseO1 = r));
    const second = { ...DROPPED, alert_id: 'A-TWO', raised_at: DROPPED.raised_at + 1, target: { type: 'order_line' as const, order_id: 'O2', order_item_id: 'L2' } };
    const orderView = async (url: string) => {
      if (url.includes('order_id=O1')) await o1Gate;
      const id = url.includes('order_id=O2') ? 'O2' : 'O1';
      const b = body({ order_id: id });
      b.lines[0]!.order_item_id = id === 'O2' ? 'L2' : 'L1';
      return reply(200, { data: b });
    };
    const { mm } = await signedInShell([DROPPED, second], orderView);
    window.location.hash = '#/inbox';
    await flush(4);
    mm.click(mm.container.querySelector('[data-alert="A-DROP"]'));
    await flush(4);
    mm.click(mm.container.querySelector('[data-alert="A-TWO"]'));
    await flush(8);
    expect(window.location.hash).toContain('focus=line%3AL2');
    releaseO1();
    await flush(8);
    await wait(40);
    expect(window.location.hash).toContain('L2');
    expect(window.location.hash).not.toContain('L1');
    expect(mm.container.querySelector('.toast')).toBeNull();
  });

  it('[01d §3.13.2] a check that lands after sign-out does nothing (no navigation, no toast)', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { mm } = await signedInShell([DROPPED], async () => {
      await gate;
      return reply(200, { data: body() });
    });
    window.location.hash = '#/inbox';
    await flush(4);
    mm.click(mm.container.querySelector('[data-alert="A-DROP"]'));
    await flush(4);
    mm.click(mm.button('Imran — sign out'));
    await flush(8);
    const after = window.location.hash;
    release();
    await flush(8);
    await wait(40);
    expect(window.location.hash).toBe(after);
    expect(window.location.hash).not.toContain('/tables/T4');
    expect(mm.container.querySelector('.toast')).toBeNull();
  });

  it('[01d #76 (a); #253 review] the table sheet is already open with a folded served round: the round unfolds, then glows (real tap sequence)', async () => {
    const SERVED = row({
      alert_id: 'A-SERVED',
      kind: 'served_card',
      family: 'action',
      set: 'recipient',
      lock: { kind_label_key: 'alert.served_card.lock', table_code: '4', point_code: null, requester_name: null },
      target: { type: 'order', order_id: 'O1' },
    });
    const { mm } = await signedInShell([]);
    window.location.hash = '#/tables/T4?seating_id=S4';
    await flush(8);
    const head = () => mm.container.querySelector('.rnd > .rnd__h')!;
    expect(head().getAttribute('aria-expanded')).toBe('false');
    for (const s of sockets) s.frame({ type: 'alert', alert: SERVED });
    await flush(4);
    mm.click(mm.button('Open', mm.container.querySelector('.abns [data-alert="A-SERVED"]')!));
    await flush(8);
    await wait(60);
    await flush(4);
    const round = mm.container.querySelector<HTMLElement>('.rnd[data-order="O1"]')!;
    expect(head().getAttribute('aria-expanded')).toBe('true');
    expect(scrolled).toContain(round);
    expect(round.classList.contains('pos-glow')).toBe(true);
    expect(window.location.hash).toBe('#/tables/T4?seating_id=S4');
  });

  it('[01d §3.13.3; #253 review 2] a request seen only on #/requests closes during the check (alert_closed, then the list drops it) → "no longer open", no navigation', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    hubRequests.rows = [requestRow({ alert_id: 'R-INF', answers: null, can_answer: false, target: LINE_T })]; // informed: it navigates
    const { mm } = await signedInShell([], async () => {
      await gate;
      return reply(200, { data: body() });
    });
    window.location.hash = '#/requests';
    await flush(8);
    mm.click(mm.container.querySelector('[data-alert="R-INF"]'));
    await flush(4);
    hubRequests.rows = []; // the hub lists open requests only
    for (const s of sockets) s.frame({ type: 'alert_closed', alert_id: 'R-INF', reason: 'answered', decision: 'approve', by_name: 'Sana' });
    await flush(8);
    release();
    await flush(8);
    await wait(60);
    expect(window.location.hash).toBe('#/requests');
    expect(mm.container.querySelector('.toast')?.textContent).toContain('This item is no longer open.');
  });

  it('[01d §3.13.2; #253 review 2] a route change during the check makes the tap stale: no navigation, no toast', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { mm } = await signedInShell([DROPPED], async () => {
      await gate;
      return reply(200, { data: body() });
    });
    window.location.hash = '#/inbox';
    await flush(4);
    mm.click(mm.container.querySelector('[data-alert="A-DROP"]'));
    await flush(4);
    window.location.hash = '#/held'; // the person goes elsewhere while the read is in flight
    await flush(8);
    release();
    await flush(8);
    await wait(60);
    expect(window.location.hash).toBe('#/held');
    expect(mm.container.querySelector('.toast')).toBeNull();
    expect(scrolled).toEqual([]);
  });

  it('[01d #76 (a); #253 review 2] the round unfolds a few frames late: it glows only once unfolded', async () => {
    probe.unfoldDelayMs = 80; // several animation frames after the route renders
    const SERVED = row({
      alert_id: 'A-SERVED2',
      kind: 'served_card',
      family: 'action',
      set: 'recipient',
      lock: { kind_label_key: 'alert.served_card.lock', table_code: '4', point_code: null, requester_name: null },
      target: { type: 'order', order_id: 'O1' },
    });
    const { mm } = await signedInShell([]);
    window.location.hash = '#/tables/T4?seating_id=S4';
    await flush(8);
    for (const s of sockets) s.frame({ type: 'alert', alert: SERVED });
    await flush(4);
    mm.click(mm.button('Open', mm.container.querySelector('.abns [data-alert="A-SERVED2"]')!));
    await flush(8);
    await wait(40);
    expect(unfoldedAtScroll).toEqual([]); // still folded: not glowed yet
    await wait(120);
    await flush(4);
    expect(unfoldedAtScroll).toEqual(['true']);
    expect(mm.container.querySelector('.rnd[data-order="O1"]')?.classList.contains('pos-glow')).toBe(true);
  });

  it('[01d #90] m10: a second tap on the same Inbox row after the 250 ms flush navigates and glows again, and sends no second MarkAlertsSeen', async () => {
    const { h, mm } = await signedInShell([DROPPED]);
    for (let n = 0; n < 2; n += 1) {
      window.location.hash = '#/inbox';
      await flush(4);
      mm.click(mm.container.querySelector('[data-alert="A-DROP"]'));
      await flush(8);
      await wait(40);
      await flush(4);
      expect(window.location.hash, `tap ${n + 1}`).toBe('#/tables/T4?seating_id=S4');
      const line = mm.container.querySelector<HTMLElement>('[data-line="L1"]');
      expect(line?.classList.contains('pos-glow'), `tap ${n + 1}`).toBe(true);
      await wait(300); // past the 250 ms flush
    }
    expect(scrolled.length).toBeGreaterThanOrEqual(2);
    expect(seenCalls(h)).toHaveLength(1);
  });

  it('[01d §3.13.2 rule 3] a failed MarkAlertsSeen is sent again by the next tap; after an ok reply, never again', async () => {
    const { h, mm } = await signedInShell([DROPPED], undefined, [() => reply(500, { error: { code: 'INTERNAL', message: 'x', details: {} } })]);
    for (let n = 0; n < 3; n += 1) {
      window.location.hash = '#/inbox';
      await flush(4);
      mm.click(mm.container.querySelector('[data-alert="A-DROP"]'));
      await flush(8);
      await wait(300); // past the 250 ms flush and the reply
      await flush(4);
    }
    // tap 1: sent, 500 → tap 2: sent again, ok → tap 3: nothing
    expect(seenCalls(h)).toHaveLength(2);
  });

  it('[01d §3.13.2 rule 3] the once-per-alert set is per session: after a sign-out and a sign-in the same alert is sent again', async () => {
    const { h, mm } = await signedInShell([DROPPED]);
    window.location.hash = '#/inbox';
    await flush(4);
    mm.click(mm.container.querySelector('[data-alert="A-DROP"]'));
    await flush(8);
    await wait(300);
    expect(seenCalls(h)).toHaveLength(1);
    mm.click(mm.button('Imran — sign out'));
    await flush(8);
    mm.click(mm.button('Imran'));
    const keys = mm.container.querySelector('.pin__keys')!;
    for (const d of '1234') mm.click([...keys.querySelectorAll('button')].find((b) => b.textContent === d));
    mm.click([...keys.querySelectorAll('button')].find((b) => b.textContent === 'Sign in'));
    await flush(8);
    for (const s of sockets) s.frame({ type: 'catch_up', as_of_seq: 0, state: {} });
    await flush(4);
    window.location.hash = '#/inbox';
    await flush(8);
    mm.click(mm.container.querySelector('[data-alert="A-DROP"]'));
    await flush(8);
    await wait(300);
    expect(seenCalls(h)).toHaveLength(2);
  });

  it('[01d #74] a banner Open and the CallCard go through the same rule', async () => {
    const { mm } = await signedInShell([]);
    window.location.hash = '#/inbox';
    await flush(4);
    for (const s of sockets) s.frame({ type: 'alert', alert: { ...DROPPED, card: DROPPED.card } });
    await flush(4);
    const banner = mm.container.querySelector('.abns [data-alert="A-DROP"]');
    expect(banner).not.toBeNull();
    mm.click(mm.button('Open', banner!));
    await flush(8);
    await wait(40);
    await flush(4);
    expect(window.location.hash).toBe('#/tables/T4?seating_id=S4');
    expect(mm.container.querySelector('[data-line="L1"]')?.classList.contains('pos-glow')).toBe(true);

    window.location.hash = '#/inbox';
    await flush(4);
    for (const s of sockets) s.frame({ type: 'alert', alert: CALL });
    await flush(4);
    const call = mm.container.querySelector('.abns [data-alert="A-CALL"]');
    expect(call).not.toBeNull();
    mm.click(mm.button('Open', call!));
    await flush(8);
    await wait(40);
    await flush(4);
    expect(window.location.hash).toBe('#/tables/T4?seating_id=S4');
    expect(mm.container.querySelector('[data-table="T4"]')?.classList.contains('pos-glow')).toBe(true);
  });
});
