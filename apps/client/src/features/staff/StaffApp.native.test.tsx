import 'fake-indexeddb/auto';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW } from '../../../test/alert-rows';
import { flush, mount, reply, type Mounted } from '../../../test/dom';
import type { SocketLike } from '../alerts/socket';
import { fakeTimers, recordingSink, view, type FakeTimers } from '../alerts/test-fakes';
import type { ConfirmRevoked, NativeBridge, NativeHealth, NativeInfo, NativeState } from '../native/bridge';
import type { Device, PageMeta } from './api';
import { StaffApp } from './StaffApp';

// 05b §8.3 (D-2, M-8, M-13, M-14, M-18, M-21, §3.5 N-5, N-9): the staff page inside the tablet app, with a fake
// PosNative. Gate tests 1, 4, 5, 6 at the shell level, the staff-build reload / banner and "Update the app".

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
const TABLET: Device = { token: 'DEV-TOK', id: 'D-T3', type: 'tablet' };
const DEVICE_BLOCK = { device_id: 'D-T3', screens: ['dine_in', 'takeaway'], access: 'everyone' as const, point_id: 'PT-1' };

interface FakeNative extends NativeBridge {
  calls: Array<[string, unknown]>;
  fire(s: Partial<NativeState>): void;
  confirmAnswer: ConfirmRevoked | null;
  infoAnswer: NativeInfo | null;
  healthAnswer: NativeHealth | null;
}

function fakeNative(): FakeNative {
  let listener: ((s: NativeState) => void) | null = null;
  const calls: Array<[string, unknown]> = [];
  const n: FakeNative = {
    calls,
    confirmAnswer: { revoked: true, reason: 'DEVICE_REVOKED' },
    infoAnswer: { native_api: 1, version_code: 1, version_name: '1.0.0', device_owner: false },
    healthAnswer: null,
    fire: (s) => listener?.({ paired: true, alert_socket: 'up', binding_route_until: null, update_ready: false, ...s }),
    info: async () => (calls.push(['info', null]), n.infoAnswer),
    confirmRevoked: async () => (calls.push(['confirmRevoked', null]), n.confirmAnswer),
    setSession: async (s) => void calls.push(['setSession', s]),
    setDeviceContext: async (c) => void calls.push(['setDeviceContext', c]),
    reportShown: async (r) => void calls.push(['reportShown', r]),
    health: async () => (calls.push(['health', null]), n.healthAnswer),
    openSetting: async (o) => void calls.push(['openSetting', o]),
    setWakeLock: async (o) => void calls.push(['setWakeLock', o]),
    checkForUpdate: async () => (calls.push(['checkForUpdate', null]), { state: 'none' as const }),
    onState: (fn) => {
      listener = fn;
      return () => {
        listener = null;
      };
    },
  };
  return n;
}

const of = (n: FakeNative, name: string) => n.calls.filter(([c]) => c === name).map(([, a]) => a);

interface HubOpts {
  roster?: () => Response;
  staffBuild?: string | null;
}

function hub(o: HubOpts = {}) {
  const calls: Array<{ method: string; path: string }> = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0]!;
    const method = init?.method ?? 'GET';
    calls.push({ method, path });
    switch (`${method} ${path}`) {
      case 'GET /health':
        return reply(200, { data: { status: 'ready', provisioned: true, hub_version: '0.0.0', ...(o.staffBuild === undefined ? {} : { staff_build: o.staffBuild }) } });
      case 'GET /queries/staff-roster':
        return o.roster?.() ?? reply(200, { data: { staff: [{ staff_id: 'S-IMRAN', display_name: 'Imran', locked_until: null }], active_session: null } });
      case 'POST /auth/pin':
        return reply(200, { data: { session_token: 'SESS-1', session_id: 'X1', staff_id: 'S-IMRAN', display_name: 'Imran', role_ids: [], idle_ttl_ms: 600_000 } });
      case 'GET /queries/session':
        return reply(200, { data: { permissions: {}, device: DEVICE_BLOCK } });
      case 'GET /queries/alerts-inbox':
        return reply(200, { data: { alerts: [] }, meta: { next_cursor: null } });
      case 'GET /queries/branch-config':
        return reply(200, { data: { config_version: 1, snapshot_hash: 'h', snapshot: { engine_settings: {} }, hub_time: { now_ms: NOW, utc_offset_ms: 0 } } });
      case 'GET /queries/requests-to-answer':
      case 'GET /queries/my-requests':
        return reply(200, { data: { requests: [] } });
      case 'GET /queries/table-map':
        return reply(200, { data: { as_of_seq: 0, floors: [] } });
      case 'POST /auth/logout':
        return reply(200, { data: { already_ended: false } });
      default:
        return reply(404, { error: { code: 'NOT_FOUND', message: `${method} ${path}`, details: {} } });
    }
  });
  return { fetch, calls };
}

let m: Mounted;
let sockets: FakeSocket[];
let wiped: number;
let pairs: string[];
let reloads: number;
let timers: FakeTimers;
beforeEach(() => {
  sockets = [];
  wiped = 0;
  pairs = [];
  reloads = 0;
  window.location.hash = '';
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => m?.unmount());

function render(native: FakeNative | null, h = hub(), device: Device = TABLET, staffBuild: string | null = null) {
  timers = fakeTimers();
  m = mount();
  m.render(
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
      wipeKeys={async () => {
        wiped += 1;
      }}
      goToPair={(p) => pairs.push(p)}
      native={native}
      staffBuild={staffBuild}
      reload={() => (reloads += 1)}
    />,
  );
  return h;
}

function typePin(): void {
  const keys = m.container.querySelector('.pin__keys')!;
  for (const d of '1234') m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === d));
  m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === 'Sign in'));
}

async function signIn(): Promise<void> {
  await flush();
  m.click(m.button('Imran'));
  typePin();
  await flush(8);
}

async function signOutOnMe(): Promise<void> {
  act(() => {
    window.location.hash = '#/me';
  });
  await flush();
  m.click(m.button('Sign out'));
  await flush(4);
}

async function until(ok: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !ok(); i += 1) {
    await new Promise((r) => setTimeout(r, 20));
    await flush();
  }
}

describe('[05b test 1, D-2] no alert-mode socket inside the app', () => {
  for (const type of ['tablet', 'phone', 'cashier_kiosk'] as const) {
    it(`${type}: signed out with PosNative → no socket; signed in → the session socket only; signed out again → none`, async () => {
      render(fakeNative(), hub(), { ...TABLET, type });
      await flush();
      expect(sockets).toHaveLength(0);
      await signIn();
      expect(sockets).toHaveLength(1);
      sockets[0]!.readyState = 1;
      sockets[0]!.onopen?.({});
      expect(sockets[0]!.sent[0]).toMatchObject({ type: 'auth', session_token: 'SESS-1' });
      await signOutOnMe();
      expect(sockets).toHaveLength(1);
    });
  }

  it('without PosNative a kiosk opens alert mode signed out (today)', async () => {
    render(null, hub(), { ...TABLET, type: 'cashier_kiosk' });
    await flush();
    expect(sockets).toHaveLength(1);
  });
});

describe('[05b test 5, M-21, N-1] setSession and setDeviceContext', () => {
  it('page load, sign-in (with the device block), device_profile push, needs_context, sign-out', async () => {
    const n = fakeNative();
    render(n);
    await flush();
    expect(of(n, 'setSession')).toEqual([{ signed_in: false }]);
    expect(of(n, 'setDeviceContext')).toEqual([]); // no profile known yet on a first load
    await signIn();
    expect(of(n, 'setSession').at(-1)).toEqual({ signed_in: true, staff_id: 'S-IMRAN' });
    expect(of(n, 'setDeviceContext').at(-1)).toEqual({ always_on: true, language: 'en', lock_task: true });
    // the 05a device_profile push: listed, no point (after the first frame's session re-read)
    sockets[0]!.frame({ type: 'catch_up', as_of_seq: 0, state: {} });
    await flush(4);
    sockets[0]!.frame({ type: 'device_profile', screens: ['dine_in'], access: 'listed', point_id: null });
    await flush();
    expect(of(n, 'setDeviceContext').at(-1)).toEqual({ always_on: false, language: 'en', lock_task: false });
    // :alerts restarted → both again
    const before = n.calls.length;
    n.fire({ needs_context: true });
    await flush();
    expect(n.calls.slice(before).map(([c, a]) => [c, a])).toEqual([
      ['setSession', { signed_in: true, staff_id: 'S-IMRAN' }],
      ['setDeviceContext', { always_on: false, language: 'en', lock_task: false }],
    ]);
    await signOutOnMe();
    expect(of(n, 'setSession').at(-1)).toEqual({ signed_in: false });
  });

  it('a later page load sends the last known device context at once (persisted on this device)', async () => {
    const first = fakeNative();
    render(first);
    await signIn();
    m.unmount();
    const n = fakeNative();
    render(n);
    await flush();
    expect(of(n, 'setDeviceContext')).toEqual([{ always_on: true, language: 'en', lock_task: true }]);
  });

  it('the session socket ending the session (4401) and an idle sign-out tell native signed_in: false', async () => {
    const n = fakeNative();
    n.confirmAnswer = { revoked: false, reason: '200' };
    render(n);
    await signIn();
    sockets[0]!.frame({ type: 'catch_up', as_of_seq: 0, state: {} });
    sockets[0]!.onclose?.({ code: 4401, reason: 'session ended' });
    await flush(4);
    expect(of(n, 'setSession').at(-1)).toEqual({ signed_in: false });
    expect(m.button('Imran')).toBeTruthy();
  });
});

describe('[05b test 4, M-8] reportShown once per (alert_id, step) shown', () => {
  it('a repeated frame is reported once; the next step again', async () => {
    const n = fakeNative();
    render(n);
    await signIn();
    const s = sockets[0]!;
    s.frame({ type: 'catch_up', as_of_seq: 0, state: {} });
    s.frame({ type: 'alert', alert: view({ alert_id: 'A1', step: 0 }) });
    s.frame({ type: 'alert', alert: view({ alert_id: 'A1', step: 0 }) });
    s.frame({ type: 'alert', alert: view({ alert_id: 'A1', step: 1 }) });
    await flush();
    expect(of(n, 'reportShown')).toEqual([
      { alert_id: 'A1', step: 0 },
      { alert_id: 'A1', step: 1 },
    ]);
  });
});

describe('[05b test 6, §3.5, N-5, N-9] unpair triggers go through confirmRevoked', () => {
  const revokedRoster = () => reply(403, { error: { code: 'DEVICE_REVOKED', message: 'revoked', details: {} } });

  it('page DEVICE_REVOKED → confirmRevoked; revoked: true → wipe and /pair', async () => {
    const n = fakeNative();
    render(n, hub({ roster: revokedRoster }));
    await until(() => wiped > 0 && pairs.length > 0);
    expect(of(n, 'confirmRevoked')).toHaveLength(1);
    expect(wiped).toBe(1);
    expect(pairs).toEqual(['/pair']);
  });

  it('page DEVICE_REVOKED, revoked: false (guest Wi-Fi) → keys kept, the 00 §8.4 text shown, checked again', async () => {
    const n = fakeNative();
    n.confirmAnswer = { revoked: false, reason: 'GUEST_NETWORK_FORBIDDEN' };
    render(n, hub({ roster: revokedRoster }));
    await until(() => m.text().includes('Connect to the staff Wi-Fi'));
    expect(m.text()).toContain('Connect to the staff Wi-Fi');
    expect(wiped).toBe(0);
    expect(m.text()).not.toContain('This screen must be paired again');
    timers.advance(5_000);
    await flush(4);
    expect(of(n, 'confirmRevoked').length).toBeGreaterThanOrEqual(2);
    n.confirmAnswer = { revoked: false, reason: 'HOST_NOT_ALLOWED' };
    timers.advance(5_000);
    await flush(4);
    expect(m.text()).toContain('Open the hub by its address');
    expect(wiped).toBe(0);
  });

  it('no answer → "Can\'t reach the hub", keys kept', async () => {
    const n = fakeNative();
    n.confirmAnswer = null;
    render(n, hub({ roster: revokedRoster }));
    await until(() => m.text().includes("Can't reach the hub"));
    expect(wiped).toBe(0);
  });

  it('a session-socket 4403 → confirmRevoked; revoked: true → wipe; revoked: false → the socket is opened again later', async () => {
    const n = fakeNative();
    n.confirmAnswer = { revoked: false, reason: '200' };
    render(n);
    await signIn();
    sockets[0]!.onclose?.({ code: 4403, reason: 'revoked' });
    await flush(4);
    expect(of(n, 'confirmRevoked')).toHaveLength(1);
    expect(wiped).toBe(0);
    timers.advance(5_000);
    await flush(4);
    expect(sockets).toHaveLength(2); // retried
    n.confirmAnswer = { revoked: true, reason: 'DEVICE_REVOKED' };
    sockets[1]!.onclose?.({ code: 4403, reason: 'revoked' });
    await until(() => wiped > 0);
    expect(wiped).toBe(1);
  });

  it('without PosNative: today — DEVICE_REVOKED wipes at once', async () => {
    render(null, hub({ roster: revokedRoster }));
    await until(() => wiped > 0);
    expect(wiped).toBe(1);
    expect(pairs).toEqual([]); // the PairAgain button, not an automatic /pair
  });

  it('state paired: false with page keys → confirmRevoked; NO_NATIVE_TOKEN → offered once through /pair (resumePaired sets the token)', async () => {
    const n = fakeNative();
    n.confirmAnswer = { revoked: false, reason: 'NO_NATIVE_TOKEN' };
    render(n);
    await flush();
    n.fire({ paired: false, alert_socket: 'down' });
    await flush(4);
    expect(of(n, 'confirmRevoked')).toHaveLength(1);
    expect(pairs).toEqual(['/pair']);
    expect(wiped).toBe(0);
    // a second paired: false in this tab is not offered again
    n.fire({ paired: false, alert_socket: 'down' });
    await flush(4);
    expect(pairs).toEqual(['/pair']);
    expect(wiped).toBe(0);
  });

  it('state paired: false, revoked: true → wipe, then /pair (no page keys left)', async () => {
    const n = fakeNative();
    render(n);
    await flush();
    n.fire({ paired: false, alert_socket: 'down' });
    await until(() => pairs.length > 0);
    expect(wiped).toBe(1);
    expect(pairs).toEqual(['/pair']);
  });
});

describe('[05b M-18] red bar when the alert service is disconnected for 60 s', () => {
  it('not up for 60 s → the bar on the sign-in screen and signed in; up → gone', async () => {
    const n = fakeNative();
    render(n);
    await flush();
    n.fire({ alert_socket: 'down' });
    await flush();
    timers.advance(59_000);
    await flush();
    expect(m.container.querySelector('[data-native="alerts-down"]')).toBeNull();
    n.fire({ alert_socket: 'connecting' });
    timers.advance(1_000);
    await flush();
    expect(m.container.querySelector('[data-native="alerts-down"]')).not.toBeNull();
    await signIn();
    expect(m.container.querySelector('[data-native="alerts-down"]')).not.toBeNull();
    n.fire({ alert_socket: 'up' });
    await flush();
    expect(m.container.querySelector('[data-native="alerts-down"]')).toBeNull();
  });
});

describe('[05b M-13, O-17] staff build', () => {
  it('differs while signed out → reload; no PosNative → no check at all', async () => {
    const h = render(fakeNative(), hub({ staffBuild: 'NEW' }), TABLET, 'OLD');
    await until(() => reloads > 0);
    expect(reloads).toBe(1);
    expect(h.calls.some((c) => c.path === '/health')).toBe(true);
    m.unmount();
    const h2 = render(null, hub({ staffBuild: 'NEW' }), TABLET, 'OLD');
    await flush(6);
    expect(h2.calls.some((c) => c.path === '/health')).toBe(false);
  });

  it('differs while signed in (socket reconnect) → banner; reload at sign-out', async () => {
    let build = 'OLD';
    const h = hub();
    const base = h.fetch.getMockImplementation()!;
    h.fetch.mockImplementation(async (url: string, init?: RequestInit) =>
      url.startsWith('/health') ? reply(200, { data: { status: 'ready', staff_build: build } }) : base(url, init),
    );
    render(fakeNative(), h, TABLET, 'OLD');
    await signIn();
    build = 'NEW';
    sockets[0]!.frame({ type: 'catch_up', as_of_seq: 0, state: {} });
    await until(() => m.text().includes('Update ready'));
    expect(m.text()).toContain('Update ready — sign out to load it');
    expect(reloads).toBe(0);
    await signOutOnMe();
    expect(reloads).toBe(1);
  });

  it('same, or the hub sends none → nothing', async () => {
    render(fakeNative(), hub({ staffBuild: null }), TABLET, 'OLD');
    await flush(8);
    timers.advance(600_000);
    await flush(8);
    expect(reloads).toBe(0);
  });
});

describe('[05b M-14] Update the app', () => {
  it('native_api below MIN_NATIVE_API → the banner and checkForUpdate()', async () => {
    const n = fakeNative();
    n.infoAnswer = { native_api: 0, version_code: 1, version_name: '0.9', device_owner: false };
    render(n);
    await until(() => m.text().includes('Update the app'));
    expect(of(n, 'checkForUpdate')).toHaveLength(1);
  });

  it('native_api at the minimum → nothing', async () => {
    const n = fakeNative();
    render(n);
    await flush(6);
    expect(m.text()).not.toContain('Update the app');
    expect(of(n, 'checkForUpdate')).toHaveLength(0);
  });
});

describe('[05b C-1, M-18] Me → device health', () => {
  it('the card is on the Me screen inside the app only', async () => {
    const n = fakeNative();
    render(n);
    await signIn();
    act(() => {
      window.location.hash = '#/me';
    });
    await flush();
    expect(m.container.querySelector('[data-native="health"]')).not.toBeNull();
    m.unmount();
    render(null);
    await signIn();
    act(() => {
      window.location.hash = '#/me';
    });
    await flush();
    expect(m.button('Sign out')).toBeTruthy();
    expect(m.container.querySelector('[data-native="health"]')).toBeNull();
  });
});
