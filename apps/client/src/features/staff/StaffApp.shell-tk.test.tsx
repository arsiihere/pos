import 'fake-indexeddb/auto';
import { act, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aShiftClosed } from '@pos/events/testing';
import { NOW } from '../../../test/alert-rows';
import { flush, mount, reply, type Mounted } from '../../../test/dom';
import type { SocketLike } from '../alerts/socket';
import { fakeTimers, recordingSink } from '../alerts/test-fakes';
import type { Device, PageMeta } from './api';
import { useShell } from './shell/hooks';
import { StaffApp } from './StaffApp';

// 02b-TK A2 item 1 (frames ShellAnatomy, PersonMenu, DayNotStarted; MAPPING TK-SH01–03): the staff shell around the
// Takeaway tab — the context slot the screen fills, the Live / Hub offline pill, the person chip's menu (Switch user =
// 00 HPA v1.12.4 §6.9 takeover, POST /auth/pin with takeover: true; Lock = the idle-lock screen now; My shift; Sign
// out = POST /auth/logout), the day banner (catch-up business_day) and the shift banner (05 v1.0.34 §6.16 404).

// the Takeaway tab: a probe that fills the context slot as the order screen does (the screen's own wiring is tested
// with it, takeaway-tk-shell.test.tsx); its unmount stands for the order screen's auto-hold (02b-TK C1-5)
const probe = vi.hoisted(() => ({ mounts: 0, unmounts: 0, rush: null as { on: boolean; count: number } | null, toggles: 0 }));
vi.mock('./orders/takeaway/TakeawayHome', () => ({
  TakeawayHome: () => {
    const shell = useShell();
    useEffect(() => {
      probe.mounts += 1;
      shell.contextSlot?.set({ label: 'New takeaway', token: null, name: 'Usman', sub: 'Token after Send' });
      // 02b-TK A2 item 4: the screen's rush state for the pill (its own wiring: takeaway-rush.test.tsx)
      if (probe.rush !== null) shell.rush?.set({ ...probe.rush, toggle: () => (probe.toggles += 1) });
      return () => {
        probe.unmounts += 1;
        shell.contextSlot?.set(null);
        shell.rush?.set(null);
      };
    }, [shell.contextSlot, shell.rush]);
    return <div data-probe="takeaway-home" />;
  },
}));

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

const META: PageMeta = { tenantId: 'TEN-1', branchId: 'BR-1', branchName: 'Lake City', hubNowMs: NOW, utcOffsetMs: 0 };
const KIOSK: Device = { token: 'DEV-TOK', id: 'D-K1', type: 'cashier_kiosk' };
const ALLOWED = { grant: 'allowed', scope: { kind: 'branch' } };
const PEOPLE = { 'S-IMRAN': 'Imran', 'S-SANA': 'Sana' } as Record<string, string>;

let m: Mounted;
let sockets: FakeSocket[];
beforeEach(() => {
  sockets = [];
  probe.mounts = 0;
  probe.unmounts = 0;
  probe.rush = null;
  probe.toggles = 0;
  window.location.hash = '';
  window.localStorage.clear();
});
afterEach(() => m?.unmount());

function hub(o: { permissions?: Record<string, unknown>; shift?: () => Response } = {}) {
  const calls: Array<{ method: string; path: string; body: unknown; headers: Record<string, string> }> = [];
  let n = 0;
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0]!;
    const method = init?.method ?? 'GET';
    const body = init?.body === undefined ? undefined : (JSON.parse(init.body as string) as Record<string, unknown>);
    calls.push({ method, path, body, headers: (init?.headers ?? {}) as Record<string, string> });
    switch (`${method} ${path}`) {
      case 'GET /queries/staff-roster':
        return reply(200, { data: { staff: Object.entries(PEOPLE).map(([staff_id, display_name]) => ({ staff_id, display_name, locked_until: null })), active_session: null } });
      case 'POST /auth/pin': {
        n += 1;
        const id = String(body?.['staff_id']);
        return reply(200, { data: { session_token: `SESS-${n}`, session_id: `X${n}`, staff_id: id, display_name: PEOPLE[id], role_ids: [], idle_ttl_ms: 600_000 } });
      }
      case 'GET /queries/session':
        return reply(200, { data: { permissions: { 'take-order': { grant: 'allowed', scope: 'branch' }, ...(o.permissions ?? {}) }, device: { device_id: 'D-K1', screens: ['takeaway', 'dine_in'], access: 'everyone', point_id: null } } });
      case 'GET /queries/shift':
        return (o.shift ?? (() => reply(404, { error: { code: 'SHIFT_NOT_FOUND', details: {} } })))();
      case 'GET /queries/alerts-inbox':
        return reply(200, { data: { alerts: [] }, meta: { next_cursor: null } });
      case 'GET /queries/branch-config':
        return reply(200, { data: { config_version: 1, snapshot_hash: 'h', snapshot: {}, hub_time: { now_ms: NOW, utc_offset_ms: 0 } } });
      case 'GET /queries/requests-to-answer':
        return reply(200, { data: { requests: [] } });
      case 'POST /auth/logout':
        return reply(200, { data: { already_ended: false } });
      default:
        throw new Error(`no route ${method} ${path}`);
    }
  });
  return { fetch, calls };
}

function render(fetch: (u: string, i?: RequestInit) => Promise<Response>) {
  const timers = fakeTimers();
  m = mount();
  m.render(
    <StaffApp
      device={KIOSK}
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
}

async function pin(name: string): Promise<void> {
  await flush();
  m.click(m.button(name, m.container.querySelector('.who')!));
  const keys = m.container.querySelector('.pin__keys')!;
  for (const d of '1234') m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === d));
  m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === 'Sign in'));
  await flush(10);
}

const chip = () => m.container.querySelector<HTMLButtonElement>('header.top button.me')!;
const item = (label: string) => [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')].find((b) => (b.textContent ?? '').startsWith(label))!;
const home = () => m.container.querySelector('[data-probe="takeaway-home"]');

describe('[02b-TK TK-SH01] the shell around the Takeaway tab', () => {
  it('[frame ShellAnatomy] the context slot the screen fills stands in the bar; the Live pill turns "Hub offline" (red)', async () => {
    render(hub().fetch);
    await pin('Imran');
    expect(window.location.hash).toBe('#/takeaway');
    expect(m.container.querySelector('header.top .tk-ctx b')?.textContent).toBe('New takeaway · Usman');
    expect(m.container.querySelector('header.top .tk-ctx small')?.textContent).toBe('Token after Send');
    sockets.at(-1)!.frame({ type: 'catch_up', as_of_seq: 0, state: {} });
    await flush();
    expect(m.container.querySelector('header.top .live.tk-live')?.textContent).toBe('Live');
    sockets.at(-1)!.onclose?.({ code: 1006, reason: '' });
    await flush();
    const off = m.container.querySelector('header.top .live.tk-live--off');
    expect(off?.textContent).toBe('Hub offline');
    // another screen: no context slot (the screen cleared it)
    window.location.hash = '#/inbox';
    await flush();
    expect(m.container.querySelector('.tk-ctx')).toBeNull();
  });
});

describe('[02b-TK A2 item 4] the Live / Rush pill', () => {
  it('[frames HomeRush, ShellAnatomy] the takeaway screen in rush: "Rush mode · 40" (.tk-live--rush); a tap toggles it; offline wins', async () => {
    probe.rush = { on: true, count: 40 };
    render(hub().fetch);
    await pin('Imran');
    sockets.at(-1)!.frame({ type: 'catch_up', as_of_seq: 0, state: {} });
    await flush();
    const pill = m.container.querySelector<HTMLButtonElement>('header.top button.live.tk-live.tk-live--rush');
    expect(pill?.textContent).toBe('Rush mode · 40');
    expect(pill?.getAttribute('aria-pressed')).toBe('true');
    m.click(pill);
    expect(probe.toggles).toBe(1);
    sockets.at(-1)!.onclose?.({ code: 1006, reason: '' });
    await flush();
    expect(m.container.querySelector('header.top .tk-live--rush')).toBeNull();
    expect(m.container.querySelector('header.top .live.tk-live--off')?.textContent).toBe('Hub offline');
  });

  it('[frame ShellAnatomy] not in rush: the pill reads Live and is the toggle; another screen: a plain Live pill', async () => {
    probe.rush = { on: false, count: 3 };
    render(hub().fetch);
    await pin('Imran');
    sockets.at(-1)!.frame({ type: 'catch_up', as_of_seq: 0, state: {} });
    await flush();
    const pill = m.container.querySelector<HTMLButtonElement>('header.top button.live.tk-live');
    expect(pill?.textContent).toBe('Live');
    expect(pill?.getAttribute('aria-pressed')).toBe('false');
    m.click(pill);
    expect(probe.toggles).toBe(1);
    window.location.hash = '#/inbox';
    await flush();
    expect(m.container.querySelector('header.top button.live')).toBeNull();
    expect(m.container.querySelector('header.top span.live.tk-live')?.textContent).toBe('Live');
  });
});

describe('[02b-TK TK-SH02] the person chip menu in the shell', () => {
  it('[frame PersonMenu] one tap on the chip opens the menu and never signs out; Sign out (in the menu) does', async () => {
    const h = hub();
    render(h.fetch);
    await pin('Imran');
    m.click(chip());
    await flush();
    expect(h.calls.some((c) => c.path === '/auth/logout')).toBe(false);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    m.click(item('Sign out'));
    await flush();
    expect(h.calls.some((c) => c.path === '/auth/logout' && c.headers['X-Session-Token'] === 'SESS-1')).toBe(true);
    // the screen went away first (its unsent cart is held: 02b-TK C1-5), then the tiles
    expect(probe.unmounts).toBeGreaterThan(0);
    expect(m.text()).toContain('Who is signing in?');
  });

  it('[00 HPA §6.9 M20] Switch user: the screen goes (cart auto-held), the name tiles + PIN; the PIN goes with takeover: true; Back returns', async () => {
    const h = hub();
    render(h.fetch);
    await pin('Imran');
    expect(home()).not.toBeNull();
    m.click(chip());
    m.click(item('Switch user'));
    await flush();
    expect(home()).toBeNull();
    expect(probe.unmounts).toBe(1);
    expect(m.container.querySelector('.who')).not.toBeNull();
    // Back: the same person's screen again, nothing sent
    m.click(m.button('Back', m.container.querySelector('.signin__switch')!));
    await flush();
    expect(home()).not.toBeNull();
    expect(h.calls.filter((c) => c.path === '/auth/pin')).toHaveLength(1);
    m.click(chip());
    m.click(item('Switch user'));
    await pin('Sana');
    const pins = h.calls.filter((c) => c.path === '/auth/pin');
    expect(pins).toHaveLength(2);
    expect(pins[1]!.body).toMatchObject({ staff_id: 'S-SANA', takeover: true });
    // the old session is not logged out by the page: the takeover ends it on the hub
    expect(h.calls.some((c) => c.path === '/auth/logout')).toBe(false);
    expect(chip().textContent).toContain('Sana');
    expect(home()).not.toBeNull();
  });

  it('[02b §8 Device idle lock] Lock screen: the idle-lock screen now — the session leaves the page (logout sent)', async () => {
    const h = hub();
    render(h.fetch);
    await pin('Imran');
    m.click(chip());
    m.click(item('Lock screen'));
    // the drain reads the device's queue store (IndexedDB) first, then the logout goes
    for (let i = 0; i < 20 && !h.calls.some((c) => c.path === '/auth/logout'); i += 1) await act(() => new Promise((r) => setTimeout(r, 10)));
    await flush(8);
    const lock = m.container.querySelector('.idle');
    expect(lock).not.toBeNull();
    expect(lock?.textContent).toContain('Screen locked');
    expect(h.calls.some((c) => c.path === '/auth/logout' && c.headers['X-Session-Token'] === 'SESS-1')).toBe(true);
  });
});

describe('[02b-TK TK-SH01, TK-SH03] the day / shift banners under the bar', () => {
  it('[frame DayNotStarted] the catch-up says no open day: the banner on the Takeaway tab (Ask the manager), not on the Inbox', async () => {
    render(hub().fetch);
    await pin('Imran');
    sockets.at(-1)!.frame({ type: 'catch_up', as_of_seq: 0, state: { stock: { business_day: null } } });
    await flush();
    const b = m.container.querySelector('.tk-banner.tk-banner--warn');
    expect(b?.textContent).toContain('Day not started');
    expect(b?.textContent).toContain('Ask the manager to start the day');
    window.location.hash = '#/inbox';
    await flush();
    expect(m.container.querySelector('.tk-banner')).toBeNull();
  });

  it('[05 §6.16] a take-payment holder with no open shift (404 SHIFT_NOT_FOUND): the shift banner; Open my shift → #/shift?back=/takeaway (02b v1.0.30 QK-9)', async () => {
    const h = hub({ permissions: { 'take-payment': ALLOWED, 'manage-own-shift': ALLOWED } });
    render(h.fetch);
    await pin('Imran');
    await flush();
    expect(h.calls.some((c) => c.path === '/queries/shift')).toBe(true);
    const b = m.container.querySelector('.tk-banner.tk-banner--warn')!;
    expect(b.textContent).toContain('No shift open — cash can’t be taken');
    m.click(m.button('Open my shift', b));
    await flush();
    // ⚠️ 02b v1.0.30 QK-9: the shift screen returns to Takeaway once the shift is open
    expect(window.location.hash).toBe('#/shift?back=%2Ftakeaway');
  });

  it('[05 §6.16] an open shift: no banner; the menu\'s My shift says when it opened and the float; ShiftClosed reads again', async () => {
    let state = 'open';
    const h = hub({
      permissions: { 'take-payment': ALLOWED, 'manage-own-shift': ALLOWED },
      shift: () => (state === 'open' ? reply(200, { data: { shift_id: 'SH1', state: 'open', opened_at: NOW - 3_600_000, float_minor: 500_000 } }) : reply(404, { error: { code: 'SHIFT_NOT_FOUND', details: {} } })),
    });
    render(h.fetch);
    await pin('Imran');
    await flush();
    expect(m.container.querySelector('.tk-banner')).toBeNull();
    m.click(chip());
    expect(item('My shift').textContent).toContain('Opened 1:04 PM · float Rs 5,000');
    m.click(chip());
    state = 'closed';
    sockets.at(-1)!.frame({ type: 'catch_up', as_of_seq: 1, state: {} });
    sockets.at(-1)!.frame({ type: 'event', seq: 2, event: aShiftClosed() });
    await flush(8);
    expect(m.container.querySelector('.tk-banner')?.textContent).toContain('No shift open');
  });

  it('[05 §6.16] without take-payment no shift banner shows', async () => {
    const h = hub({ permissions: { 'manage-own-shift': ALLOWED } });
    render(h.fetch);
    await pin('Imran');
    await flush();
    expect(m.container.querySelector('.tk-banner')).toBeNull();
  });
});
