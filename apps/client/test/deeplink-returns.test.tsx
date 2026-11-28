import { aBranchConfig } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, requestRow, row as alertRow } from './alert-rows';
import { flush, mount, reply, type Mounted } from './dom';
import type { Device, PageMeta } from '../src/features/staff/api';
import type { Draft, OrderViewBody } from '../src/features/staff/orders/contracts';
import { createMemoryDraftStore } from '../src/features/staff/orders/drafts/memory-drafts';
import { DraftStoreContext } from '../src/features/staff/orders/order-screen/OrderScreen';
import { PHONE_QUERY } from '../src/features/staff/shell/layout';
import type { MapTile, TableMapBody } from '../src/features/staff/tables/contracts';
import { StaffApp } from '../src/features/staff/StaffApp';
import type { SocketLike } from '../src/features/alerts/socket';
import { fakeTimers, recordingSink } from '../src/features/alerts/test-fakes';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

// A slow return (#273 review): while `hold.until` is set, the open check waits for it before it answers.
const hold = vi.hoisted(() => ({ until: null as Promise<void> | null }));
vi.mock('../src/features/alerts/deeplink-check', async (original) => {
  const real = await original<typeof import('../src/features/alerts/deeplink-check')>();
  return {
    ...real,
    checkTarget: async (...a: Parameters<typeof real.checkTarget>) => {
      if (hold.until !== null) await hold.until;
      return real.checkTarget(...a);
    },
  };
});

// 01d v1.3.3 §3.13.2 rule 6 "Layering" and "Close returns", §3.13.6a, §3.13.7 "Where a return lands" (DL Q-K (c)),
// tests 100–105, with the real TableSheet, TableMap, OrderView and OrderScreen (real useTableLock) and the real
// staff CSS. jsdom has no layout, so `document.elementFromPoint` is emulated from the one stacking context (.pu.staff):
// the element on top is the one whose layer (its ancestor that is a child of .pu.staff) has the highest computed
// z-index; the real hit test is t1's Playwright e2e.

// the staff entry's CSS, in the order apps/client/src/app/ui-kit-staff.ts imports it (read from that file, as #98's
// test does; vitest serves a CSS import as '')
const root = resolvePath(__dirname, '../../..') + '/';
const uiKitStaff = readFileSync(root + 'apps/client/src/app/ui-kit-staff.ts', 'utf8');
const IMPORTS = [...uiKitStaff.matchAll(/^import\s+['"]([^'"]+)['"];/gm)].map((x) => x[1]!);
const CSS = IMPORTS.map((i) => readFileSync(root + i.replace(/^(\.\.\/)+/, ''), 'utf8'));
const staff02Css = readFileSync(root + 'packages/ui-kit/components/staff-02-additions.css', 'utf8');

const media = { phone: false };
let scrolled: Element[] = [];
beforeEach(() => {
  hold.until = null;
  scrolled = [];
  media.phone = false;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === PHONE_QUERY && media.phone, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  document.head.innerHTML = '';
  for (const css of CSS) {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = '';
});

const tile = (over: Partial<MapTile> & { table_id: string }): MapTile => ({
  name: over.table_id,
  seats: 4,
  archived: false,
  state: 'SEATED',
  seating_id: null,
  party_size: 2,
  primary_table_id: null,
  joined_table_names: [],
  holder: { staff_id: 'S-IMRAN', name: 'Imran' },
  assignee: null,
  lock: null,
  opened_at: 0,
  bill_requested_at: null,
  live_order_count: 1,
  ...over,
});
const mapOf = (tiles: MapTile[], as_of_seq = 50): TableMapBody => ({ as_of_seq, floors: [{ floor_id: 'F1', name: 'Main', archived: false, zones: [{ zone_id: null, name: null, tables: tiles }] }] });
const TWO_TABLES = () => mapOf([tile({ table_id: 'T4', seating_id: 'S4', primary_table_id: 'T4' }), tile({ table_id: 'T5', seating_id: 'S5', primary_table_id: 'T5' })]);

function body(over: Partial<OrderViewBody> = {}): OrderViewBody {
  return {
    order_id: 'O9',
    placed_by: { staff_id: 'ST-1', name: 'Hamza' },
    placed_at: 0,
    follow_up: false,
    cancelled: false,
    billed: false,
    has_phone: false,
    promise_ms: null,
    lines: [
      {
        order_item_id: 'L9', order_id: 'O9', parent_order_item_id: null, line_kind: 'item', item_id: 'I1', deal_id: null, name: 'Karahi', sale_unit: 'piece',
        quantity: 2, units: 2, live_units: 2, comped_units: 0, removed_units: 0, voided_units: 0, returned_units: 0, refundable_minor: 0, comp_minor: 0,
        comp_voided_minor: 0, removed_minor: 0, refund_minor: 0, line_total_minor: 0, billed_minor: 0, return_of: null, served_from_zone_id: null,
        zone_served: false, added_at: 0, served_at: null, served_source: null, is_food: true, kitchen_note: null, stage: 'cooking', fired: true,
      },
    ],
    order_type: 'takeaway',
    seating_id: null,
    ...over,
  };
}

const CALL = (id: string, table: 'T4' | 'T5' = 'T4') =>
  alertRow({
    alert_id: id,
    kind: 'call_waiter',
    family: 'action',
    set: 'recipient',
    raised_at: NOW - 60_000,
    lock: { kind_label_key: 'alert.call_waiter.lock', table_code: table.slice(1), point_code: null, requester_name: null },
    target: { type: 'table', table_id: table, seating_id: table === 'T4' ? 'S4' : 'S5' },
  });
const TAKEAWAY_LINE = alertRow({
  alert_id: 'A-TK',
  kind: 'engine_line_dropped',
  family: 'action',
  set: 'recipient',
  raised_at: NOW - 60_000,
  lock: { kind_label_key: 'alert.engine_line_dropped.lock', table_code: null, point_code: null, requester_name: null },
  target: { type: 'order_line', order_id: 'O9', order_item_id: 'L9' },
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
const TABLET: Device = { token: 'DEV-TOK', id: 'D-T3', type: 'tablet' };
const PHONE: Device = { token: 'DEV-TOK', id: 'D-P1', type: 'phone' };

interface HubState {
  map: TableMapBody;
  requests: unknown[];
  inbox: unknown[];
}

function shellHub(state: HubState) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0]!;
    const method = init?.method ?? 'GET';
    const sent: unknown = init?.body === undefined ? undefined : JSON.parse(init.body as string);
    calls.push({ method, path, body: sent });
    switch (`${method} ${path}`) {
      case 'GET /queries/staff-roster':
        return reply(200, { data: { staff: [{ staff_id: 'S-IMRAN', display_name: 'Imran', locked_until: null }], active_session: null } });
      case 'POST /auth/pin':
        return reply(200, { data: { session_token: 'SESS-1', session_id: 'X1', staff_id: 'S-IMRAN', display_name: 'Imran', role_ids: [], idle_ttl_ms: 600_000 } });
      case 'GET /queries/session':
        return reply(200, { data: { permissions: { 'take-order': { grant: 'allowed' }, 'void-item': { grant: 'allowed', scope: 'branch' }, 'mark-served': { grant: 'allowed', scope: 'branch' }, 'boost-order': { grant: 'allowed', scope: 'branch' } } } });
      case 'GET /queries/alerts-inbox':
        return reply(200, { data: { alerts: state.inbox }, meta: { next_cursor: null } });
      case 'GET /queries/branch-config':
        return reply(200, { data: { config_version: 1, snapshot_hash: 'h', snapshot: aBranchConfig(), hub_time: { now_ms: NOW, utc_offset_ms: 0 } } });
      case 'GET /queries/requests-to-answer':
        return reply(200, { data: { requests: state.requests } });
      case 'GET /queries/my-requests':
        return reply(200, { data: { requests: [] } });
      case 'GET /queries/table-map':
        return reply(200, { data: state.map });
      case 'GET /queries/order-view':
        return reply(200, { data: body() });
      case 'GET /queries/open-orders':
        // O9's head (a takeaway, token 57): OrderView's line actions need it
        return reply(200, { data: { orders: [{ order_id: 'O9', order_type: 'takeaway', table_key: 'takeaway', token: 57, car_number: null, car_type: null, has_phone: false, placed_at: 0, business_date: '2026-11-18', from_date: null, ready: { n: 0, m: 1 }, promise_ms: null, abandoned: false }] } });
      case 'GET /queries/seating-orders': {
        // S4 holds one order O4 with a cooking line L4 (Void and Mark served offered)
        const seating = new URL(url, 'http://x').searchParams.get('seating_id');
        if (seating !== 'S4') return reply(200, { data: { orders: [], total_minor: 0 } });
        const o = body({ order_id: 'O4', order_type: 'dine_in', seating_id: 'S4' });
        o.lines[0]!.order_item_id = 'L4';
        o.lines[0]!.order_id = 'O4';
        const seatingOrder: Partial<OrderViewBody> = { ...o };
        delete seatingOrder.order_type;
        delete seatingOrder.seating_id;
        return reply(200, { data: { orders: [seatingOrder], total_minor: 0 } });
      }
      case 'POST /commands/open-table': {
        const p = (sent as { payload: { table_id: string } }).payload;
        return reply(200, { data: { command_id: 'C', event_ids: [], result: { seating_id: p.table_id === 'T5' ? 'S5' : 'S4', changed: false } } });
      }
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

async function shell(o: { device?: Device; inbox?: unknown[]; requests?: unknown[]; map?: TableMapBody; drafts?: ReturnType<typeof createMemoryDraftStore> } = {}) {
  const state: HubState = { map: o.map ?? TWO_TABLES(), requests: o.requests ?? [], inbox: o.inbox ?? [] };
  const sockets: FakeSocket[] = [];
  window.location.hash = '';
  const h = shellHub(state);
  const timers = fakeTimers();
  mm = mount();
  mm.render(
    <DraftStoreContext.Provider value={o.drafts ?? createMemoryDraftStore()}>
      <StaffApp
        device={o.device ?? TABLET}
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
  // a phone signs in its owner only: no tile, the PIN pad at once
  const tileBtn = m.buttons().find((b) => b.textContent?.includes('Imran'));
  if (tileBtn !== undefined) m.click(tileBtn);
  const keys = m.container.querySelector('.pin__keys')!;
  for (const d of '1234') m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === d));
  m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === 'Sign in'));
  await flush(8);
  // the catch-up's tables part is the held table map (02a §6.17), as on a real socket
  for (const s of sockets) s.frame({ type: 'catch_up', as_of_seq: 0, state: { tables: state.map } });
  await flush(4);
  await wait(300);
  await flush(4);
  const go = async (hash: string) => {
    window.location.hash = hash;
    await flush(10);
    await wait(40);
    await flush(4);
  };
  const banner = async (row: ReturnType<typeof alertRow>) => {
    for (const s of sockets) s.frame({ type: 'alert', alert: row });
    await flush(4);
    const card = m.container.querySelector(`.abns [data-alert="${row.alert_id}"]`)!;
    m.click(m.button('Open', card));
    await flush(10);
    await wait(80);
    await flush(4);
  };
  const tapRow = async (id: string) => {
    m.click(m.container.querySelector(`[data-alert="${id}"]`));
    await flush(10);
    await wait(80);
    await flush(4);
  };
  const closeSheet = async () => {
    m.click(m.container.querySelector('section.tv button.dlg__x'));
    await flush(10);
    await wait(40);
    await flush(4);
  };
  const seen = () => h.calls.filter((c) => c.path === '/commands/mark-alerts-seen').length;
  const commands = (from = 0) => h.calls.slice(from).filter((c) => c.path.startsWith('/commands/')).map((c) => c.path);
  return { h, m, sockets, state, go, banner, tapRow, closeSheet, seen, commands };
}

/** The emulated hit test: the computed z-index of `el`'s layer (its ancestor that is a child of .pu.staff). */
function layerZ(el: Element): number {
  const root = el.closest('.pu.staff')!;
  let layer: Element = el;
  while (layer.parentElement !== null && layer.parentElement !== root) layer = layer.parentElement;
  const z = getComputedStyle(layer).zIndex;
  return z === '' || z === 'auto' ? 0 : Number(z);
}
const wrapperOf = (m: Mounted) => m.container.querySelector('section.tv')!.parentElement!;

describe('[01d v1.3.3 §3.13.6a] layers of the staff shell', () => {
  it('[01d #100] the CSS: staff-02-additions.css is the last layer and holds the two rules', () => {
    expect(IMPORTS.at(-1)).toMatch(/components\/staff-02-additions\.css$/);
    expect(staff02Css).toContain(':where(.pu) .scrim--route { z-index: 10; }');
  });

  for (const [name, device, phone] of [
    ['landscape side panel', TABLET, false],
    ['phone bottom sheet', PHONE, true],
  ] as const) {
    it(`[01d #100] (${name}) TableSheet's wrapper carries scrim--route at z-index 10, below the banners (20); a banner's Open is on top and deep-links`, async () => {
      media.phone = phone;
      const s = await shell({ device });
      await s.go('#/tables/T4?seating_id=S4');
      const wrapper = wrapperOf(s.m);
      expect(wrapper.classList.contains('scrim--route')).toBe(true);
      expect(wrapper.classList.contains(phone ? 'scrim--sheet' : 'scrim--side')).toBe(true);
      expect(getComputedStyle(wrapper).zIndex).toBe('10');
      for (const x of s.sockets) x.frame({ type: 'alert', alert: CALL('A-C5', 'T5') });
      await flush(4);
      const open = s.m.button('Open', s.m.container.querySelector('.abns [data-alert="A-C5"]')!);
      expect(getComputedStyle(open.closest('.abns')!).zIndex).toBe('20');
      expect(layerZ(open)).toBeGreaterThan(layerZ(s.m.container.querySelector('section.tv')!)); // Open is the top element
      s.m.click(open);
      await flush(10);
      await wait(80);
      await flush(4);
      expect(window.location.hash).toMatch(/^#\/tables\/T5\?seating_id=S5/);
    });
  }

  /** A real popup is portalled to the shell root (.pu.staff): outside the route sheet's subtree, its layer at 30. */
  const expectPopupAboveBanners = (s: Awaited<ReturnType<typeof shell>>, popup: Element, what: string, alert = 'A-C5') => {
    const root = s.m.container.querySelector('.pu.staff')!;
    const scrim = popup.closest('.scrim')!;
    expect(scrim.parentElement, what).toBe(root); // directly under .pu.staff
    expect(s.m.container.querySelector('section.tv')!.parentElement!.contains(popup), what).toBe(false); // not in the sheet's wrapper
    expect(getComputedStyle(scrim).zIndex, what).toBe('30');
    const open = s.m.button('Open', s.m.container.querySelector(`.abns [data-alert="${alert}"]`)!);
    expect(layerZ(popup), what).toBeGreaterThan(layerZ(open)); // the Open is not on top
    return open;
  };

  it('[01d #100; #273 review] real popups opened inside TableSheet (Void, Mark served) render under .pu.staff above the banners; rule 6 holds the Open back', async () => {
    const s = await shell();
    await s.go('#/tables/T4?seating_id=S4');
    for (const x of s.sockets) x.frame({ type: 'alert', alert: CALL('A-C5', 'T5') });
    await flush(4);
    // Void, from the line's controls in the sheet's orders part
    s.m.click(s.m.container.querySelector('.ol[data-line="L4"]'));
    await flush(4);
    s.m.click(s.m.button('Void', s.m.container.querySelector('.ol__ctrl')!));
    await flush(8);
    const voidDlg = s.m.container.querySelector('.dlg--v')!;
    expect(voidDlg).not.toBeNull();
    const open = expectPopupAboveBanners(s, voidDlg, 'void');
    s.m.click(open);
    await flush(10);
    await wait(80);
    expect(window.location.hash).toBe('#/tables/T4?seating_id=S4'); // rule 6: a popup is open
    s.m.key(voidDlg, 'Escape');
    await flush(8);
    expect(s.m.container.querySelector('.dlg--v')).toBeNull(); // Escape still closes the portalled popup
    // rule 6 showed the alert's own sheet instead of leaving: close it (banners wait behind a dialog)
    const alertSheet = [...s.m.container.querySelectorAll('.dlg')].find((d) => d.textContent!.includes('T5'))!;
    expect(alertSheet).toBeDefined();
    s.m.click(s.m.button('Close', alertSheet));
    await flush(8);
    for (const x of s.sockets) x.frame({ type: 'alert', alert: CALL('A-C6', 'T5') });
    await flush(4);
    // Mark served, from the sheet's own actions
    const mark = s.m.buttons().find((b) => b.textContent === 'Mark served' && b.closest('section.tv') !== null);
    expect(mark).toBeDefined();
    s.m.click(mark);
    await flush(8);
    const served = [...s.m.container.querySelectorAll('[role="dialog"][aria-modal="true"]')].find((d) => !d.hasAttribute('data-route-sheet'))!;
    expect(served).toBeDefined();
    expectPopupAboveBanners(s, served, 'mark served', 'A-C6');
  });

  it('[01d #100; #273 review] real popups opened inside OrderView (Mark served, Void) render under .pu.staff; Boost confirms in place in the view (02b-D36, no popup)', async () => {
    const s = await shell();
    await s.go('#/orders/O9');
    for (const x of s.sockets) x.frame({ type: 'alert', alert: CALL('A-C5', 'T5') });
    await flush(4);
    s.m.click(s.m.button('Mark served', s.m.container.querySelector('section.tv')!));
    await flush(8);
    const served = [...s.m.container.querySelectorAll('[role="dialog"][aria-modal="true"]')].find((d) => !d.hasAttribute('data-route-sheet'))!;
    expectPopupAboveBanners(s, served, 'mark served');
    s.m.key(served, 'Escape');
    s.m.click(s.m.button('Cancel', served));
    await flush(8);
    s.m.click(s.m.container.querySelector('.ol[data-line="L9"]'));
    await flush(4);
    s.m.click(s.m.button('Void', s.m.container.querySelector('.ol__ctrl')!));
    await flush(8);
    expectPopupAboveBanners(s, s.m.container.querySelector('.dlg--v')!, 'void');
    s.m.key(s.m.container.querySelector('.dlg--v'), 'Escape');
    await flush(8);
    // Boost: a confirm in place, part of the view (not a modal); it stays in the sheet
    s.m.click(s.m.button('Boost', s.m.container.querySelector('section.tv')!));
    await flush(4);
    const confirm = s.m.container.querySelector('.confirm')!;
    expect(confirm.getAttribute('aria-modal')).toBeNull();
    expect(confirm.closest('section.tv')).not.toBeNull();
  });

  it('[01d #100] TableSheet loading (the table map not yet read) carries scrim--route too', async () => {
    const s = await shell({ map: mapOf([]) });
    await s.go('#/tables/T4?seating_id=S4');
    const loading = s.m.container.querySelector('section.tv[aria-label="Loading…"]');
    expect(loading).not.toBeNull();
    expect(loading!.parentElement!.classList.contains('scrim--route')).toBe(true);
    expect(getComputedStyle(loading!.parentElement!).zIndex).toBe('10');
  });

  it('[01d #101] kiosk: a deep link from #/inbox lands on TableSheet; the Back chip div.abk > button.chip is outside .top, at 20, on top of the sheet; it returns to #/inbox and goes', async () => {
    const s = await shell({ device: KIOSK, inbox: [CALL('A-C4')] });
    await s.go('#/inbox');
    await s.tapRow('A-C4');
    expect(window.location.hash).toMatch(/^#\/tables\/T4\?seating_id=S4/);
    const chip = s.m.container.querySelector<HTMLElement>('.abk > button.chip')!;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain('Back');
    expect(chip.closest('.top')).toBeNull();
    const abk = chip.parentElement!;
    expect(getComputedStyle(abk).zIndex).toBe('20');
    expect(getComputedStyle(abk).position).toBe('absolute');
    expect(layerZ(chip)).toBeGreaterThan(layerZ(s.m.container.querySelector('section.tv')!));
    s.m.click(chip);
    await flush(10);
    await wait(40);
    expect(window.location.hash).toBe('#/inbox');
    expect(s.m.container.querySelector('.abk')).toBeNull();
  });

  it('[01d #101] a tablet and a phone show no chip', async () => {
    for (const [device, phone] of [[TABLET, false], [PHONE, true]] as const) {
      media.phone = phone;
      const s = await shell({ device, inbox: [CALL('A-C4')] });
      await s.go('#/inbox');
      await s.tapRow('A-C4');
      expect(window.location.hash, device.type).toMatch(/^#\/tables\/T4/);
      expect(s.m.container.querySelector('.abk'), device.type).toBeNull();
      mm!.unmount();
      mm = null;
    }
  });
});

describe('[01d v1.3.3 §3.13.2 rule 6] close returns', () => {
  for (const [device, phone] of [[TABLET, false], [PHONE, true], [KIOSK, false]] as const) {
    it(`[01d #102] (${device.type}) a deep-linked TableSheet from #/inbox: its close and Escape go back to #/inbox, not #/tables; the record goes; no second MarkAlertsSeen`, async () => {
      media.phone = phone;
      const s = await shell({ device, inbox: [CALL('A-C4')] });
      await s.go('#/inbox');
      await s.tapRow('A-C4');
      await wait(300);
      const seenAfterTap = s.seen();
      const glowsAfterTap = scrolled.length;
      expect(window.location.hash).toMatch(/^#\/tables\/T4/);
      await s.closeSheet();
      expect(window.location.hash).toBe('#/inbox');
      expect(s.m.container.querySelector('.abk')).toBeNull();
      expect(scrolled).toHaveLength(glowsAfterTap); // nothing glows on a return
      // Escape, the same way
      await s.tapRow('A-C4');
      s.m.key(s.m.container.querySelector('section.tv'), 'Escape');
      await flush(10);
      await wait(40);
      expect(window.location.hash).toBe('#/inbox');
      await wait(300);
      expect(s.seen()).toBe(seenAfterTap); // one MarkAlertsSeen per alert (cs7); none for a return
    });
  }

  it('[01d #102] from #/requests and from #/zones the close returns there; #/requests with its rows gone closes to #/tables (fallback), and the record goes', async () => {
    const informed = requestRow({ alert_id: 'R-C4', kind: 'table_handover', answers: null, can_answer: false, target: { type: 'table', table_id: 'T4', seating_id: 'S4' } });
    const s = await shell({ requests: [informed] });
    await s.go('#/requests');
    await s.tapRow('R-C4');
    expect(window.location.hash).toMatch(/^#\/tables\/T4/);
    await s.closeSheet();
    expect(window.location.hash).toBe('#/requests');
    // #/zones: a banner from there
    await s.go('#/zones');
    await s.banner(CALL('A-Z'));
    expect(window.location.hash).toMatch(/^#\/tables\/T4/);
    await s.closeSheet();
    expect(window.location.hash).toBe('#/zones');
    // the start can no longer be shown: the request list is empty by the time of the close
    await s.go('#/requests');
    await s.tapRow('R-C4');
    s.state.requests = [];
    for (const x of s.sockets) x.frame({ type: 'alert_closed', alert_id: 'R-C4', reason: 'answered', decision: 'accept', by_name: 'Sana' });
    await flush(10);
    await wait(40);
    await s.closeSheet();
    expect(window.location.hash).toBe('#/tables');
  });

  it('[01d #103] a TableSheet opened by a tile tap closes to #/tables; after a deep link, a later navigation clears the record and that sheet also closes to #/tables', async () => {
    const s = await shell({ inbox: [CALL('A-C4')] });
    await s.go('#/tables');
    s.m.click(s.m.container.querySelector('[data-table="T4"]'));
    await flush(10);
    await wait(40);
    expect(window.location.hash).toBe('#/tables/T4?seating_id=S4');
    await s.closeSheet();
    expect(window.location.hash).toBe('#/tables');
    // a deep link, then the sheet's own action (Add items → OrderScreen), then back to the sheet from the map
    await s.go('#/inbox');
    await s.tapRow('A-C4');
    s.m.click(s.m.button('Add items'));
    await flush(12);
    await wait(60);
    expect(window.location.hash).toBe('#/order/dine_in/S4');
    await s.go('#/tables');
    s.m.click(s.m.container.querySelector('[data-table="T4"]'));
    await flush(10);
    await wait(40);
    await s.closeSheet();
    expect(window.location.hash).toBe('#/tables');
  });

  for (const device of [TABLET, KIOSK]) {
    it(`[01d #104] (${device.type}) a deep-linked OrderView (takeaway line) from #/inbox closes back to #/inbox; one opened from its route closes as today`, async () => {
      const s = await shell({ device, inbox: [TAKEAWAY_LINE] });
      await s.go('#/inbox');
      await s.tapRow('A-TK');
      expect(window.location.hash).toMatch(/^#\/orders\/O9/);
      // OrderView is a route sheet too (§3.13.6a): under the alert layer
      expect(wrapperOf(s.m).classList.contains('scrim--route')).toBe(true);
      expect(getComputedStyle(wrapperOf(s.m)).zIndex).toBe('10');
      await s.closeSheet();
      expect(window.location.hash).toBe('#/inbox');
      await s.go('#/orders/O9');
      await s.closeSheet();
      expect(window.location.hash).toBe(device.type === 'cashier_kiosk' ? '#/' : '#/orders');
    });
  }
});

describe('[01d v1.3.3 §3.13.2 rule 6; #273 review] a late return is dropped', () => {
  const slowReturn = async (device: Device) => {
    const s = await shell({ device });
    await s.go('#/order/dine_in/S5');
    await s.banner(CALL('A-C4'));
    expect(window.location.hash).toMatch(/^#\/tables\/T4/);
    // the return for a dine-in start runs the open check on S5's table: make it slow
    let release: () => void = () => {};
    hold.until = new Promise<void>((r) => (release = r));
    return {
      s,
      release: () => {
        hold.until = null;
        release();
      },
    };
  };

  it('the route changed while returnTarget was pending: the late result does not navigate', async () => {
    const { s, release } = await slowReturn(TABLET);
    s.m.click(s.m.container.querySelector('section.tv button.dlg__x'));
    await flush(4);
    await s.go('#/held'); // the person goes elsewhere first
    release();
    await flush(8);
    await wait(60);
    expect(window.location.hash).toBe('#/held');
  });

  it('a second close came after the first: the first close\'s late result does not navigate', async () => {
    const { s, release } = await slowReturn(KIOSK);
    s.m.click(s.m.container.querySelector('.abk > button.chip')); // Back: a return waits for the map
    await flush(4);
    s.m.click(s.m.container.querySelector('section.tv button.dlg__x')); // then the close: the sheet's own close
    await flush(8);
    await wait(40);
    expect(window.location.hash).toBe('#/tables');
    release();
    await flush(8);
    await wait(60);
    expect(window.location.hash).toBe('#/tables'); // not the Back chip's late #/tables/T5?seating_id=S5
  });
});

describe('[01d v1.3.3 §3.13.7] where a return lands: a dine-in OrderScreen start', () => {
  const draftOn = async (seating: string, table: string) => {
    const drafts = createMemoryDraftStore();
    const draft: Draft = { draft_id: 'DR1', device_id: '', staff_id: 'S-IMRAN', order_type: 'dine_in', seating_id: seating, table_id: table, cart: { lines: [{ key: 'L1', item_id: 'I3', quantity: 2, options: [] }] }, updated_at: NOW, held: false };
    return { drafts, draft };
  };

  for (const via of ['close', 'back'] as const) {
    it(`[01d #105] (${via}) from the real dine-in OrderScreen of S5 (T5), a banner deep-links to T4's sheet: ReleaseTableLock once; the ${via} lands on #/tables/T5?seating_id=S5, with no OrderScreen, OpenTable or TouchTableLock; Add items there brings the cart back`, async () => {
      const { drafts, draft } = await draftOn('S5', 'T5');
      const device = via === 'back' ? KIOSK : TABLET;
      await drafts.put({ ...draft, device_id: device.id });
      const s = await shell({ device, drafts });
      await s.go('#/order/dine_in/S5');
      expect(s.m.container.querySelector('.osc')!.textContent).toContain('2×');
      const before = s.h.calls.length;
      await s.banner(CALL('A-C4'));
      expect(window.location.hash).toMatch(/^#\/tables\/T4\?seating_id=S4/);
      expect(s.commands(before).filter((p) => p === '/commands/release-table-lock')).toHaveLength(1);
      const mid = s.h.calls.length;
      if (via === 'close') await s.closeSheet();
      else {
        s.m.click(s.m.container.querySelector('.abk > button.chip'));
        await flush(10);
        await wait(40);
      }
      expect(window.location.hash).toBe('#/tables/T5?seating_id=S5');
      expect(s.m.container.querySelector('.osc')).toBeNull();
      expect(s.commands(mid).filter((p) => p === '/commands/open-table' || p === '/commands/touch-table-lock')).toEqual([]);
      // that table sheet was reached normally: its own close is today's
      if (via === 'close') {
        await s.closeSheet();
        expect(window.location.hash).toBe('#/tables');
        await s.go('#/tables/T5?seating_id=S5');
      }
      s.m.click(s.m.button('Add items'));
      await flush(12);
      await wait(60);
      expect(s.commands(mid)).toContain('/commands/open-table');
      expect(window.location.hash).toBe('#/order/dine_in/S5');
      expect(s.m.container.querySelector('.osc')!.textContent).toContain('2×');
    });
  }

  it('[01d #105] (c) a merge absorbed S5 into S4 (primary T4) before the return → #/tables/T4?seating_id=S4; S5 closed with no tile → #/tables', async () => {
    const { drafts, draft } = await draftOn('S5', 'T5');
    await drafts.put({ ...draft, device_id: TABLET.id });
    const s = await shell({ drafts });
    await s.go('#/order/dine_in/S5');
    // a deep link to a zone row (a route that is not T5 / T4), then the merge, then back
    await s.banner(CALL('A-C4'));
    s.state.map = mapOf([tile({ table_id: 'T4', seating_id: 'S4', primary_table_id: 'T4', opened_at: 0 }), tile({ table_id: 'T5', seating_id: 'S4', primary_table_id: 'T4', opened_at: 0 })], 60);
    for (const x of s.sockets) x.frame({ type: 'event', seq: 5, event: { event_id: 'E1', event_type: 'TablesMerged', schema_version: 1, payload: {} } });
    await wait(400); // the map store's debounced read
    await flush(4);
    await s.closeSheet();
    expect(window.location.hash).toBe('#/tables/T4?seating_id=S4');
    // again from S5's screen with S5 gone and T5 free: the return lands on the map
    s.state.map = mapOf([tile({ table_id: 'T4', seating_id: 'S4', primary_table_id: 'T4' }), tile({ table_id: 'T5', state: 'FREE', seating_id: null, primary_table_id: null, opened_at: null })], 70);
    for (const x of s.sockets) x.frame({ type: 'event', seq: 6, event: { event_id: 'E2', event_type: 'TableCleaned', schema_version: 1, payload: {} } });
    await wait(400);
    await s.go('#/order/dine_in/S5');
    await s.banner(CALL('A-C4b'));
    await s.closeSheet();
    expect(window.location.hash).toBe('#/tables');
  });

  it('[01d #105] (d) a takeaway OrderScreen start: the close and the Back chip both return to it, with its draft', async () => {
    const drafts = createMemoryDraftStore();
    await drafts.put({ draft_id: 'D1', device_id: KIOSK.id, staff_id: 'S-IMRAN', order_type: 'takeaway', cart: { lines: [{ key: 'L1', item_id: 'I3', quantity: 2, options: [] }] }, updated_at: NOW, held: false });
    const s = await shell({ device: KIOSK, drafts });
    for (const via of ['close', 'back'] as const) {
      await s.go('#/order/takeaway/D1');
      // L-CLIENT-6a item 5: a takeaway line carries its stepper ("− 2 +")
      expect(s.m.container.querySelector('.osc .ln .step output')?.textContent, via).toBe('2');
      await s.banner(CALL(`A-T${via}`));
      expect(window.location.hash, via).toMatch(/^#\/tables\/T4/);
      if (via === 'close') await s.closeSheet();
      else {
        s.m.click(s.m.container.querySelector('.abk > button.chip'));
        await flush(10);
        await wait(40);
      }
      expect(window.location.hash, via).toBe('#/order/takeaway/D1');
      await flush(8);
      await wait(40);
      // L-CLIENT-6a item 5: a takeaway line carries its stepper ("− 2 +")
      expect(s.m.container.querySelector('.osc .ln .step output')?.textContent, via).toBe('2');
    }
  });
});
