import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PointLine, PointViewBody } from './contracts';
import { MIN, NOW, row as alertRow } from '../../../test/alert-rows';
import { flush, mount, reply, type Mounted } from '../../../test/dom';
import { navigate } from '../../app/router';
import { ARRIVAL_MS, tapAlert, type TapDeps, type TapRow } from '../alerts/deeplink-tap';
import { Inbox } from '../alerts/Inbox';
import type { SocketLike } from '../alerts/socket';
import { fakeTimers, recordingSink } from '../alerts/test-fakes';
import type { Device, PageMeta } from '../staff/api';
import { ShellContext, type Shell } from '../staff/shell/hooks';
import { matchStaffRoute } from '../staff/shell/routes';
import { createLiveBus } from '../staff/shell/live';
import { StaffApp } from '../staff/StaffApp';
import { passLiveOf } from './live';
import { passOpenedText, passPlace } from './pass-place';
import { PassScreen } from './PassScreen';

// 05a §8: PassScreen parses its route with the device's own type (the spy below records it).
vi.mock('../staff/shell/routes', async (original) => {
  const actual = await original<typeof import('../staff/shell/routes')>();
  return { ...actual, matchStaffRoute: vi.fn(actual.matchStaffRoute) };
});

// 01d v1.3 §3.13.5 rows Pass / Inbox, the devices table (Pass, m12), §3.13.7 lock panel; test 95. Integrator ruling
// (a) for cp7: a tap on #/pass whose order's Pass card is on the screen glows it in place (pass-place.ts, one block in
// tapAlert): no order-view read, no navigation, no sheet. `#/pass?focus=order:` and `#/inbox?focus=alert:` come only
// through the URL (no tap behind them): PassScreen and Inbox glow through the tap's own glowOnArrival. Runs the real
// tapAlert on a real PassScreen (the harness is states.test.tsx's).

function line(id: string, stage: PointLine['stage'], station_id = 'ST-T'): PointLine {
  return {
    order_item_id: id,
    order_id: 'O1',
    station_id,
    point_id: 'PT',
    identifier: { kind: 'table', label: 'T4' },
    order_type: 'dine_in',
    item_name: id,
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
    stage,
    handed_over: false,
  };
}
const VIEW: PointViewBody = {
  point_id: 'PT',
  stations: [{ station_id: 'ST-T', name: 'Tandoor', lanes: { lanes_on: 2, lane_count: 2 }, dark: false }],
  takeovers: [],
  orders: [
    { order_id: 'O1', identifier: { kind: 'table', label: 'T4' }, placed_at: 0, ready: null, lines: [line('NAAN', 'done')] },
    { order_id: 'O2', identifier: { kind: 'table', label: 'T9' }, placed_at: 0, ready: null, lines: [{ ...line('RAITA', 'added'), order_id: 'O2' }] },
  ],
};

function passShell() {
  const live = createLiveBus();
  const shell = {
    live,
    device: { token: 'DEV', id: 'D-P1', type: 'phone' },
    clock: { nowMs: () => 0, utcOffsetMs: 0 },
    api: {
      roster: () => new Promise(() => undefined),
      command: () => Promise.resolve({ ok: false, error: { kind: 'network' } }),
      query: () => Promise.resolve({ ok: false, error: { kind: 'network' } }),
    },
    permissions: { allowed: (p: string) => p === 'run-pass' },
    toasts: { show: () => undefined },
    online: true,
    portrait: false,
    me: { staff_id: 'S1', name: 'Asif' },
  } as unknown as Shell;
  passLiveOf(shell);
  live.frame({ type: 'catch_up', as_of_seq: 1, state: { point_view: VIEW } });
  return shell;
}

function tapDeps() {
  const orderView = vi.fn(async () => ({ ok: true as const, data: { kind: 'missing' as const } }));
  const deps = {
    orders: { orderView, zoneStock: vi.fn() } as never,
    tables: { tableMap: vi.fn() } as never,
    seen: vi.fn<() => void>(),
    openSheet: vi.fn<() => void>(),
    navigate: vi.fn((href: string) => navigate(href)),
    toast: vi.fn<(text: string) => void>(),
  } satisfies TapDeps;
  return { deps, orderView };
}

/** a lock-only `ready_to_serve` escalation row, as a Pass tablet gets it as a `point` target (no card, no answers) */
const readyRow = (order_id: string): TapRow => ({
  alert_id: 'RTS1',
  kind: 'ready_to_serve',
  raised_at: NOW - 2 * MIN,
  state: 'open',
  lock: { kind_label_key: 'alert.ready_to_serve.lock', table_code: null, point_code: 'Pass', requester_name: null } as never,
  target: { type: 'order', order_id },
});

let scrolls: Element[] = [];
let views: Mounted[] = [];
const glowing = () => [...document.querySelectorAll('.pos-glow')];
/** the tap's arrival waits a frame / a hash change task: let them run */
const settle = async (ms = 30) => {
  await new Promise((r) => setTimeout(r, ms));
  await flush();
};
beforeEach(() => {
  scrolls = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolls.push(this);
  };
});
afterEach(async () => {
  for (const v of views) v.unmount();
  views = [];
  window.location.hash = '';
  await settle(0);
});

function showPass(shell: Shell) {
  const m = mount();
  views.push(m);
  m.render(
    <ShellContext.Provider value={shell}>
      <PassScreen />
    </ShellContext.Provider>,
  );
  return m;
}

describe('[01d #95] Pass and Inbox places', () => {
  it('[01d #95] signed-in Pass tablet: a lock-only ready_to_serve row glows its card in place: no order-view, no navigation, no sheet, one glow', async () => {
    window.location.hash = '/pass';
    await settle(0);
    const m = showPass(passShell());
    await flush();
    const { deps, orderView } = tapDeps();
    expect(await tapAlert(readyRow('O1'), deps)).toBe('navigated');
    await settle();
    const card = m.container.querySelector<HTMLElement>('article.pc[data-order="O1"]')!;
    expect(orderView).not.toHaveBeenCalled();
    expect(deps.navigate).not.toHaveBeenCalled();
    expect(deps.openSheet).not.toHaveBeenCalled();
    expect(deps.toast).not.toHaveBeenCalled();
    expect(deps.seen).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('#/pass');
    expect(glowing()).toEqual([card]);
    // one glow: the tap's; PassScreen adds none (the hash has no focus)
    expect(scrolls).toEqual([card]);
  });

  it('[01d #95] the in-place path only for an order whose card is rendered and shown on #/pass; else the normal check runs', async () => {
    window.location.hash = '/pass';
    await settle(0);
    const m = showPass(passShell());
    await flush();
    expect(passPlace({ type: 'order', order_id: 'O1' })).toBe(m.container.querySelector('article.pc[data-order="O1"]'));
    // another order (no card), another target type
    expect(passPlace({ type: 'order', order_id: 'O9' })).toBeNull();
    expect(passPlace({ type: 'order_line', order_id: 'O1', order_item_id: 'NAAN' })).toBeNull();
    // §3.13.6 n4: one label for the tap and the URL path: the card's identifier as shown; never an empty name
    expect(passOpenedText('O2')).toBe('Opened Pass card T9');
    expect(passOpenedText('O9', 'T12')).toBe('Opened Pass card T12');
    expect(passOpenedText('O9')).toBe('Opened Pass card O9');
    expect(passOpenedText('O9', '  ')).toBe('Opened Pass card O9');
    // a hidden card
    const card = m.container.querySelector<HTMLElement>('article.pc[data-order="O2"]')!;
    card.parentElement!.hidden = true;
    expect(passPlace({ type: 'order', order_id: 'O2' })).toBeNull();
    card.parentElement!.hidden = false;
    card.style.display = 'none';
    expect(passPlace({ type: 'order', order_id: 'O2' })).toBeNull();
    // not on #/pass (the card's screen still mounted for this check)
    window.location.hash = '/inbox';
    expect(passPlace({ type: 'order', order_id: 'O1' })).toBeNull();
    // through the tap: the normal path (the open check reads order-view)
    const { deps, orderView } = tapDeps();
    await tapAlert(readyRow('O1'), deps);
    expect(orderView).toHaveBeenCalledTimes(1);
  });

  it('[01d #95 rule 4] a row this viewer can answer, tapped on the Pass: the card glows in place, then AnswerSheet on top', async () => {
    window.location.hash = '/pass';
    await settle(0);
    const m = showPass(passShell());
    await flush();
    const { deps, orderView } = tapDeps();
    const slip: TapRow = { ...readyRow('O1'), alert_id: 'SW1', kind: 'slip_warning', answers: ['accept', 'decline'] };
    expect(await tapAlert(slip, deps)).toBe('navigated');
    await settle();
    expect(glowing()).toEqual([m.container.querySelector('article.pc[data-order="O1"]')]);
    expect(deps.openSheet).toHaveBeenCalledTimes(1);
    expect(orderView).not.toHaveBeenCalled();
    expect(deps.navigate).not.toHaveBeenCalled();
    expect(deps.seen).toHaveBeenCalledTimes(1);
  });

  it('[01d #95] a stale tap does nothing on the Pass either', async () => {
    window.location.hash = '/pass';
    await settle(0);
    showPass(passShell());
    await flush();
    const { deps, orderView } = tapDeps();
    expect(await tapAlert(readyRow('O1'), { ...deps, isCurrent: () => false })).toBe('stale');
    await settle();
    expect(glowing()).toEqual([]);
    expect(deps.seen).toHaveBeenCalledTimes(1);
    expect(orderView).not.toHaveBeenCalled();
    expect(deps.navigate).not.toHaveBeenCalled();
  });

  it('[01d §3.13.5] #/pass?focus=order:<id> (through the URL, no tap) glows that card once and drops focus', async () => {
    window.location.hash = '/pass?focus=order:O2';
    await settle(0);
    const m = showPass(passShell());
    await settle();
    const card = m.container.querySelector('article.pc[data-order="O2"]');
    expect(glowing()).toEqual([card]);
    expect(scrolls).toEqual([card]);
    expect(window.location.hash).toBe('#/pass');
    // a later focus on the open screen, by a hash change
    navigate('/pass?focus=order:O1');
    await settle();
    expect(scrolls).toEqual([card, m.container.querySelector('article.pc[data-order="O1"]')]);
  });

  it('[05a §8] PassScreen parses #/pass with the device\'s own type, not the literal \'tablet\'', async () => {
    window.location.hash = '/pass?focus=order:O2';
    await settle(0);
    vi.mocked(matchStaffRoute).mockClear();
    showPass(passShell());
    await settle();
    const types = vi.mocked(matchStaffRoute).mock.calls.map((c) => c[1]);
    expect(types.length).toBeGreaterThan(0);
    expect(new Set(types)).toEqual(new Set(['phone']));
  });

  it('[01d §3.13.7] Inbox: #/inbox?focus=alert:<id> glows that card only and opens nothing; no such card → nothing', async () => {
    window.location.hash = '/inbox?focus=alert:A2';
    await settle(0);
    const onOpen = vi.fn();
    const rows = [alertRow({ alert_id: 'A1' }), alertRow({ alert_id: 'A2', kind: 'test_alert', family: 'info', lock: { kind_label_key: 'alert.test_alert.lock', table_code: null, point_code: null, requester_name: 'Sana' } })];
    const m = mount();
    views.push(m);
    m.render(<Inbox rows={rows} loading={false} offlineAt={null} nowMs={NOW} utcOffsetMs={0} onOpen={onOpen} />);
    await settle();
    const card = m.container.querySelector('[data-alert="A2"]');
    expect(card).not.toBeNull();
    expect(glowing()).toEqual([card]);
    expect(onOpen).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#/inbox');
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
    // a card this person does not have: nothing glows, nothing opens, and `focus` is still dropped once the arrival
    // window is over
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      navigate('/inbox?focus=alert:NOPE');
      // jsdom's hashchange is its own task, not a faked timer
      await vi.waitFor(() => expect(window.location.hash).toBe('#/inbox?focus=alert:NOPE'));
      await new Promise<void>((r) => window.addEventListener('hashchange', () => r(), { once: true }));
      await vi.advanceTimersByTimeAsync(ARRIVAL_MS + 10);
    } finally {
      vi.useRealTimers();
    }
    expect(scrolls).toEqual([card]);
    expect(onOpen).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#/inbox');
  });

  it('[01d §3.13.5] a normal tap from the Inbox glows exactly once: its own place, never an Inbox card', async () => {
    window.location.hash = '/inbox';
    await settle(0);
    // the tapped row is itself an Inbox card: the Inbox must not glow it (only #/inbox?focus=alert: does)
    const rows = [alertRow({ alert_id: 'ZS1', kind: 'zone_stock_low', family: 'info', lock: { kind_label_key: 'alert.zone_stock_low.lock', table_code: null, point_code: null, requester_name: null } })];
    const m = mount();
    views.push(m);
    m.render(<Inbox rows={rows} loading={false} offlineAt={null} nowMs={NOW} utcOffsetMs={0} onOpen={() => undefined} />);
    const card = m.container.querySelector<HTMLElement>('[data-alert="ZS1"]')!;
    expect(card).not.toBeNull();
    const classes: string[] = [];
    const watch = new MutationObserver(() => classes.push(card.className));
    watch.observe(card, { attributes: true, attributeFilter: ['class'] });
    // the zone row the tap lands on
    const place = document.createElement('div');
    place.className = 'zs';
    place.dataset.zoneItem = 'FH:raita';
    document.body.appendChild(place);
    const { deps } = tapDeps();
    deps.orders = { orderView: vi.fn(), zoneStock: vi.fn(async () => ({ ok: true, data: [{ zone_id: 'FH', name: 'Hall', items: [{ item_id: 'raita', name: 'Raita', on_hand: 1, threshold: 4 }] }] })) } as never;
    expect(await tapAlert({ ...readyRow('x'), alert_id: 'ZS1', kind: 'zone_stock_low', target: { type: 'zone_item', zone_id: 'FH', item_id: 'raita' } }, deps)).toBe('navigated');
    await settle(60);
    // back on the Inbox afterwards (a hash change with no focus): still nothing there
    navigate('/inbox');
    await settle(60);
    watch.disconnect();
    expect(scrolls).toEqual([place]);
    expect(glowing()).toEqual([place]);
    expect(classes.some((c) => c.includes('pos-glow'))).toBe(false);
    place.remove();
  });
});

// §3.13.7: signed out, the lock panel is not tappable (Pass tablet, kiosk, phone: one lock panel in the shell).
class FakeSocket implements SocketLike {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(): void {
    this.readyState = 3;
  }
  frame(obj: unknown): void {
    this.readyState = 1;
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

const META: PageMeta = { tenantId: 'TEN-1', branchId: 'BR-1', branchName: 'Gulberg', hubNowMs: NOW, utcOffsetMs: 0 };

describe('[01d #95] signed out: the lock panel', () => {
  it('[01d #95] a signed-out Pass tablet: no alert line is tappable, a ready_to_serve point line included; nothing navigates, nothing is sent', async () => {
    const sockets: FakeSocket[] = [];
    const calls: string[] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.split('?')[0]!;
      calls.push(`${init?.method ?? 'GET'} ${path}`);
      if (path === '/queries/staff-roster') return reply(200, { data: { staff: [{ staff_id: 'S-IMRAN', display_name: 'Imran', locked_until: null }], active_session: null } });
      return reply(200, { data: {} });
    });
    const timers = fakeTimers();
    const device: Device = { token: 'DEV-TOK', id: 'D-P1', type: 'tablet' }; // the Pass tablet
    const m = mount();
    views.push(m);
    m.render(
      <StaffApp
        device={device}
        meta={META}
        fetch={fetch}
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
    // whatever socket a signed-out tablet has gets the point's lock-only line
    for (const sock of sockets)
      sock.frame({
        type: 'alerts_open',
        binding_route_until: null,
        alerts: [
          {
            alert_id: 'RTS1',
            kind: 'ready_to_serve',
            family: 'action',
            step: 2,
            raised_at: NOW - MIN,
            lock: { kind_label_key: 'alert.ready_to_serve.lock', table_code: null, point_code: 'Pass', requester_name: null },
            target: { type: 'order', order_id: 'O1' },
          },
        ],
      });
    await flush();
    // the sign-in screen is up; no alert row is a control (StaffApp draws lock lines for kiosk / phone only, and they
    // are never tappable either: see the lock panel test in StaffApp.test.tsx)
    expect(m.text()).toContain('Imran');
    expect(m.container.querySelectorAll('[data-alert]')).toHaveLength(0);
    for (const r of m.container.querySelectorAll('.lockp__r')) expect(r.querySelectorAll('button, a, [role="button"], [tabindex]')).toHaveLength(0);
    const before = window.location.hash;
    for (const r of m.container.querySelectorAll<HTMLElement>('.lockp__r')) r.click();
    await flush();
    expect(window.location.hash).toBe(before);
    expect(calls.filter((c) => c.includes('mark-alerts-seen') || c.includes('order-view'))).toEqual([]);
    expect(document.querySelector('.pos-glow')).toBeNull();
  });
});
