import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, VOID_CARD, requestRow } from '../../../test/alert-rows';
import { flush, mount, reply, type Mounted } from '../../../test/dom';
import type { SocketLike } from '../alerts/socket';
import { fakeTimers, recordingSink } from '../alerts/test-fakes';
import type { Device, PageMeta } from './api';
import { readPageMeta } from './api';
import { StaffApp } from './StaffApp';

// 01d task 41, §8.1: the /staff/ shell. Sign-in (roster tiles → PIN, POST /auth/pin) opens the staff socket;
// the nav shows Requests to approvers and Test alert only with manage-devices; AnswerRequest goes with the
// envelope ids from the page and the session from the sign-in (task 40's context()); a signed-out kiosk shows
// lock text only, never details.

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

let m: Mounted;
let sockets: FakeSocket[];
beforeEach(() => {
  sockets = [];
  window.location.hash = '';
});
afterEach(() => m?.unmount());

const UP = { type: 'catch_up', as_of_seq: 0, state: {} }; // a valid first frame on a staff socket: the socket is up
const EMPTY_INBOX = () => reply(200, { data: { alerts: [] }, meta: { next_cursor: null } });

function hub(
  o: {
    permissions?: Record<string, { grant: string }>;
    requests?: unknown[];
    answer?: Response;
    /** replies for alerts-inbox, in order (then empty) */
    inbox?: Array<() => Response | Promise<Response>>;
    /** the hub clock branch-config reports (S47 re-sync) */
    hubNow?: number;
  } = {},
) {
  const inbox = [...(o.inbox ?? [])];
  const calls: Array<{ method: string; path: string; headers: Record<string, string>; body: unknown }> = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0]!;
    const method = init?.method ?? 'GET';
    calls.push({ method, path, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body === undefined ? undefined : JSON.parse(init.body as string) });
    switch (`${method} ${path}`) {
      case 'GET /queries/staff-roster':
        return reply(200, { data: { staff: [{ staff_id: 'S-IMRAN', display_name: 'Imran', locked_until: null }], active_session: null } });
      case 'POST /auth/pin':
        return reply(200, { data: { session_token: 'SESS-1', session_id: 'X1', staff_id: 'S-IMRAN', display_name: 'Imran', role_ids: [], idle_ttl_ms: 600_000 } });
      case 'GET /queries/session':
        return reply(200, { data: { permissions: o.permissions ?? {} } });
      case 'GET /queries/alerts-inbox':
        return (inbox.shift() ?? EMPTY_INBOX)();
      case 'GET /queries/branch-config':
        return reply(200, { data: { config_version: 1, snapshot_hash: 'h', snapshot: {}, hub_time: { now_ms: o.hubNow ?? NOW, utc_offset_ms: 0 } } });
      case 'GET /queries/requests-to-answer':
        return reply(200, { data: { requests: o.requests ?? [] } });
      case 'POST /commands/answer-request':
        return o.answer ?? reply(200, { data: { result: { alert_id: 'R1', decision: 'approve', answered_at: NOW } } });
      case 'POST /commands/mark-alerts-seen':
        return reply(200, { data: { result: { seen: [] } } });
      case 'POST /auth/logout':
        return reply(200, { data: { already_ended: false } });
      default:
        throw new Error(`no route ${method} ${path}`);
    }
  });
  return { fetch, calls };
}

function render(device: Device, fetch: (u: string, i?: RequestInit) => Promise<Response>) {
  const timers = fakeTimers();
  lastTimers = timers;
  m = mount();
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
}

async function signIn(): Promise<void> {
  await flush();
  m.click(m.button('Imran'));
  const keys = m.container.querySelector('.pin__keys')!;
  for (const d of '1234') m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === d));
  m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === 'Sign in'));
  await flush(8);
}

let lastTimers: ReturnType<typeof fakeTimers>;
const TABLET: Device = { token: 'DEV-TOK', id: 'D-T3', type: 'tablet' };
const KIOSK: Device = { token: 'DEV-TOK', id: 'D-K1', type: 'cashier_kiosk' };

describe('[01d task 41] staff entry', () => {
  it('reads the envelope ids and the hub clock from the page meta', () => {
    const doc = document.implementation.createHTMLDocument('x');
    doc.head.innerHTML =
      '<meta name="pos-tenant-id" content="T1"><meta name="pos-branch-id" content="B1"><meta name="pos-branch-name" content="Gulberg"><meta name="pos-hub-now-ms" content="5"><meta name="pos-hub-utc-offset-ms" content="18000000">';
    expect(readPageMeta(doc)).toEqual({ tenantId: 'T1', branchId: 'B1', branchName: 'Gulberg', hubNowMs: 5, utcOffsetMs: 18_000_000 });
    expect(readPageMeta(document.implementation.createHTMLDocument('y'))).toBeNull();
  });

  it('signs in with the roster and the PIN; the staff socket opens; Test alert only with manage-devices', async () => {
    const h = hub();
    render(TABLET, h.fetch);
    // the tablet page opens no socket while signed out (§3.7)
    expect(sockets.length).toBe(0);
    expect(m.text()).toContain('Who is signing in?');
    await signIn();
    expect(h.calls.find((c) => c.path === '/auth/pin')!.body).toEqual({ staff_id: 'S-IMRAN', pin: '1234', takeover: false });
    expect(sockets.length).toBe(1);
    expect(m.text()).toContain('Inbox');
    expect(m.text()).not.toContain('Test alert');
    expect(m.text()).not.toContain('Requests');
    m.unmount();

    // approve-void alone no longer shows Requests (AD-T41-10 review fix): only the hub's list does
    render(TABLET, hub({ permissions: { 'approve-void': { grant: 'allowed' } } }).fetch);
    await signIn();
    expect(m.text()).not.toContain('Requests');
    m.unmount();

    render(TABLET, hub({ permissions: { 'manage-devices': { grant: 'allowed' } }, requests: [requestRow({ alert_id: 'R1' })] }).fetch);
    await signIn();
    expect(m.text()).toContain('Test alert');
    expect(m.text()).toContain('Requests');
  });

  it('AnswerRequest carries the page ids and the signed-in session (context filled from the sign-in)', async () => {
    const h = hub({ permissions: { 'approve-void': { grant: 'allowed' } }, requests: [requestRow({ alert_id: 'R1' })] });
    render(TABLET, h.fetch);
    await signIn();
    sockets[0]!.frame(UP);
    await flush();
    m.click(m.button('Requests'));
    await flush();
    m.click(m.container.querySelector('[data-alert="R1"]'));
    m.click(m.button('Approve'));
    const keys = m.container.querySelector('.pin__keys')!;
    for (const d of '1234') m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === d));
    m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === 'Approve'));
    await flush(8);
    const post = h.calls.find((c) => c.path === '/commands/answer-request')!;
    expect(post.headers['X-Session-Token']).toBe('SESS-1');
    expect(post.headers['Authorization']).toBe('Bearer DEV-TOK');
    expect(post.body).toMatchObject({ tenant_id: 'TEN-1', branch_id: 'BR-1', device_id: 'D-T3', actor_id: 'S-IMRAN', command_type: 'AnswerRequest' });
    // tapping the card marked it seen (batched MarkAlertsSeen)
    await new Promise((r) => setTimeout(r, 300));
    await flush();
    expect(h.calls.find((c) => c.path === '/commands/mark-alerts-seen')!.body).toMatchObject({ payload: { alert_ids: ['R1'] } });
  });

  it('a signed-out kiosk shows the lock text of the alert-mode rows, never details', async () => {
    render(KIOSK, hub().fetch);
    await flush();
    expect(sockets.length).toBe(1);
    sockets[0]!.frame({
      type: 'alert',
      alert: { alert_id: 'A1', kind: 'void_approval', family: 'urgent', step: 0, escalation: false, set: 'recipient', for_staff_id: null, lock: { kind_label_key: 'alert.void_approval.lock', table_code: '12', requester_name: 'Hamza' }, card: VOID_CARD, raised_at: NOW - 120_000 },
    });
    await flush();
    const panel = m.container.querySelector('.lockp')!;
    expect(panel.textContent).toContain('Sign in to see details');
    expect(panel.textContent).toContain('T12 · Request · Hamza');
    expect(m.text()).not.toMatch(/2,200|Karahi/);
  });

  it('[01d F01; frames LockKiosk, LockPhone] the lock panel lists urgent lines first, then newest, at most 3', async () => {
    render(KIOSK, hub().fetch);
    await flush();
    const lock = (table: string, key: string, requester: string | null) => ({ kind_label_key: key, table_code: table, requester_name: requester });
    const view = (id: string, family: 'urgent' | 'info', minutesAgo: number, l: ReturnType<typeof lock>) => ({
      alert_id: id, kind: family === 'urgent' ? 'void_approval' : 'test_alert', family, step: 0, raised_at: NOW - minutesAgo * 60_000, lock: l,
    });
    sockets[0]!.frame({
      type: 'alerts_open',
      binding_route_until: null,
      alerts: [
        view('I1', 'info', 0, lock('', 'alert.test_alert.lock', 'Imran')), // newest, not urgent
        view('I2', 'info', 1, lock('', 'alert.test_alert.lock', 'Sana')),
        view('U1', 'urgent', 2, lock('12', 'alert.void_approval.lock', 'Hamza')),
        view('U2', 'urgent', 5, lock('4', 'alert.void_approval.lock', 'Ali')),
      ],
    });
    await flush();
    const lines = [...m.container.querySelectorAll('.lockp .lockp__r')].map((r) => r.textContent ?? '');
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain('T12 · Request · Hamza');
    expect(lines[1]).toContain('T4 · Request · Ali');
    expect(lines[2]).toContain('Test alert · from Imran');
    expect(m.container.querySelector('.lockp')!.textContent).not.toContain('Sana');
  });

  it('sign out ends the session and returns to the tiles', async () => {
    const h = hub();
    render(TABLET, h.fetch);
    await signIn();
    m.click(m.button('Imran — sign out'));
    await flush();
    expect(h.calls.some((c) => c.path === '/auth/logout' && c.headers['X-Session-Token'] === 'SESS-1')).toBe(true);
    expect(m.text()).toContain('Who is signing in?');
  });
});

// 01d task 42, §3.7 / §8.1 (B05), BF-5: the tablet alerts header in the brand block. Tablets only, signed in or not.
describe('[01d #57 client] tablet alerts header in the shell', () => {
  const bind = () => m.container.querySelector('header.top .brand .bind')?.textContent ?? null;

  it('[01d #57 client] shows "Alerts: none" on a signed-out tablet, and nothing on a kiosk', async () => {
    render(TABLET, hub().fetch);
    await flush();
    expect(bind()).toBe('Alerts: none');
    m.unmount();
    render(KIOSK, hub().fetch);
    await flush();
    expect(m.container.querySelector('.bind')).toBeNull();
  });

  it('[01d #57 client] a sign-in refreshes it: the signed-in person, 2 h after now', async () => {
    render(TABLET, hub().fetch);
    await signIn();
    expect(bind()).toBe('Alerts: Imran — pauses at 4:04 PM');
  });

  it('[01d BF-5] binding_route frames on the staff socket replace the deadline; null clears it', async () => {
    render(TABLET, hub().fetch);
    await signIn();
    sockets[0]!.frame({ type: 'binding_route', until: NOW + 30 * 60_000 });
    await flush();
    expect(bind()).toBe('Alerts: Imran — pauses at 2:34 PM');
    sockets[0]!.frame({ type: 'binding_route', until: NOW + 90 * 60_000 });
    await flush();
    expect(bind()).toBe('Alerts: Imran — pauses at 3:34 PM');
    sockets[0]!.frame({ type: 'binding_route', until: null });
    await flush();
    expect(bind()).toBe('Alerts: none');
  });

  it('[01d #57 client] signing out ends the binding (logout), so the header reads none', async () => {
    render(TABLET, hub().fetch);
    await signIn();
    m.click(m.button('Imran — sign out'));
    await flush();
    expect(bind()).toBe('Alerts: none');
  });
});

// review fix round 1 (tasks 41–42)
describe('[01d task 41 fixes] live sheet, inbox retry, sessions, clock', () => {
  async function openR1(o: Parameters<typeof hub>[0] = {}) {
    const h = hub({ requests: [requestRow({ alert_id: 'R1' })], ...o });
    render(TABLET, h.fetch);
    await signIn();
    sockets[0]!.frame(UP);
    await flush();
    m.click(m.button('Requests'));
    await flush();
    m.click(m.container.querySelector('[data-alert="R1"]'));
    return h;
  }

  it('[01d §8.1] an alert_closed while the sheet is open shows who answered and turns the buttons off', async () => {
    await openR1();
    const dlg = () => m.container.querySelector('.dlg')!;
    expect((m.button('Approve', dlg()) as HTMLButtonElement).disabled).toBe(false);
    sockets[0]!.frame({ type: 'alert_closed', alert_id: 'R1', reason: 'answered', decision: 'approve', by_name: 'Sana' });
    await flush(6);
    expect(dlg().textContent).toContain('Approved by Sana');
    expect((m.button('Approve', dlg()) as HTMLButtonElement).disabled).toBe(true);
    expect((m.button('Reject', dlg()) as HTMLButtonElement).disabled).toBe(true);
  });

  it('[01d §3.12; AD-163] a lock view that replaces the held card drops the details from the open sheet', async () => {
    await openR1();
    expect(m.container.querySelector('.dlg')!.textContent).toContain('Chicken Karahi');
    sockets[0]!.frame({
      type: 'alert',
      alert: { alert_id: 'R1', kind: 'void_approval', family: 'urgent', step: 1, escalation: false, set: 'informed', for_staff_id: null, lock: { kind_label_key: 'alert.void_approval.lock', table_code: '12', requester_name: 'Hamza' }, raised_at: NOW - 120_000 },
    });
    await flush(6);
    expect(m.container.querySelector('.dlg')!.textContent).not.toMatch(/Karahi|2,200|changed/);
  });

  it('[01d §8.1] a failed inbox read stops the skeleton, and the inbox is read again when the socket is up and after a reconnect', async () => {
    const h = hub({ inbox: [() => reply(503, { error: { code: 'SERVICE_UNAVAILABLE', details: {} } })] });
    render(TABLET, h.fetch);
    await signIn();
    // the app lands on the map (02a §8): look at the inbox to see its skeleton stop
    act(() => {
      window.location.hash = '#/inbox';
    });
    await flush();
    expect(m.container.querySelectorAll('.sk').length).toBe(0);
    const reads = () => h.calls.filter((c) => c.path === '/queries/alerts-inbox').length;
    expect(reads()).toBe(1);
    sockets[0]!.frame(UP);
    await flush(6);
    expect(reads()).toBe(2);
    // the socket drops, then reconnects (backoff on the injected timers)
    act(() => sockets[0]!.onclose?.({ code: 1006, reason: '' }));
    await flush();
    act(() => lastTimers.advance(600));
    await flush();
    sockets[sockets.length - 1]!.frame(UP);
    await flush(6);
    expect(reads()).toBe(3);
  });

  it('[01d task 41] an inbox reply from an earlier session is dropped', async () => {
    let release: (r: Response) => void = () => {};
    const stale = new Promise<Response>((resolve) => (release = resolve));
    const old = { alert_id: 'OLD', kind: 'test_alert', family: 'info', step: 0, escalation: false, set: 'recipient', for_staff_id: null, lock: { kind_label_key: 'alert.test_alert.lock', requester_name: 'Arif' }, raised_at: NOW, seen_by_me: false, moved_to_name: null, for_staff_name: null, state: 'open', close_reason: null };
    render(TABLET, hub({ inbox: [() => stale] }).fetch);
    await signIn();
    m.click(m.button('Imran — sign out'));
    await flush();
    await signIn();
    release(reply(200, { data: { alerts: [old] }, meta: { next_cursor: null } }));
    await flush(6);
    expect(m.container.querySelector('[data-alert="OLD"]')).toBeNull();
  });

  it('[01d S47] the hub clock is re-synced from branch-config hub_time after sign-in', async () => {
    render(TABLET, hub({ hubNow: NOW + 60 * 60_000 }).fetch);
    expect(m.container.querySelector('.clock')!.textContent).toBe('2:04 PM');
    await signIn();
    expect(m.container.querySelector('.clock')!.textContent).toBe('3:04 PM');
  });

  it('[01d #57 client; AD-T42-2] local activity (an accepted command) moves the header deadline to hub-now + 2 h', async () => {
    await openR1();
    const bind = () => m.container.querySelector('header.top .brand .bind')?.textContent ?? null;
    sockets[0]!.frame({ type: 'binding_route', until: NOW + 30 * 60_000 });
    await flush();
    expect(bind()).toBe('Alerts: Imran — pauses at 2:34 PM');
    // tapping the card sent MarkAlertsSeen (batched, 250 ms); the hub counts the command as activity
    await new Promise((r) => setTimeout(r, 300));
    await flush(6);
    expect(bind()).toBe('Alerts: Imran — pauses at 4:04 PM');
  });

  it('[01d task 41] the toast shows its tone: info for "Already rejected by …"', async () => {
    await openR1({ answer: reply(409, { error: { code: 'REQUEST_NOT_PENDING', details: { close_reason: 'answered', decision: 'reject', answered_by_name: 'Sana' } } }) });
    m.click(m.button('Approve', m.container.querySelector('.dlg')!));
    const keys = m.container.querySelector('.pin__keys')!;
    for (const d of '1234') m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === d));
    m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === 'Approve'));
    await flush(8);
    const toast = m.container.querySelector('.toast')!;
    expect(toast.className).toContain('toast--info');
    expect(toast.textContent).toContain('Already rejected by Sana.');
  });
});


// 02a §8 Top bar (20b; frame 02a-C10)
describe('[02a §8 Top bar] staff shell', () => {
  function phoneMedia() {
    const real = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes('max-width: 760px'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    return () => {
      window.matchMedia = real;
    };
  }

  it('[02a §8 Top bar] after sign-in the app lands on #/tables (kiosk: #/); Requests (n) only from the hub list, Inbox, person chip', async () => {
    render(TABLET, hub({ requests: [requestRow({ alert_id: 'R1' })] }).fetch);
    await signIn();
    expect(window.location.hash).toBe('#/tables');
    const top = m.container.querySelector('header.top')!;
    expect(m.button('Requests', top).querySelector('.badge')?.textContent).toBe('1');
    expect(m.button('Inbox', top)).toBeTruthy();
    expect(m.button('Imran — sign out', top)).toBeTruthy();
    // no floors until the map store is wired: no floor control
    expect(top.querySelector('.seg')).toBeNull();
    m.unmount();

    render(KIOSK, hub().fetch);
    await signIn();
    expect(window.location.hash).toBe('#/');
    expect(m.container.querySelector('header.top .bind')).toBeNull();
    expect(m.text()).not.toContain('Requests');
  });

  it('[02a §8 Top bar] phone: top bar + tabs Tables · Orders · Inbox · Me; Me holds sign out', async () => {
    const restore = phoneMedia();
    try {
      const h = hub();
      render({ ...TABLET, type: 'phone' }, h.fetch);
      await flush();
      // the phone signs in its owner only: the roster has one person, the pad opens at once
      const keys = m.container.querySelector('.pin__keys')!;
      for (const d of '1234') m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === d));
      m.click([...keys.querySelectorAll('button')].find((b) => b.textContent === 'Sign in'));
      await flush(8);
      expect(m.container.querySelector('header.ph-top h1')?.textContent).toBe('Tables');
      expect([...m.container.querySelectorAll('nav.tabbar a.tab')].map((a) => a.textContent)).toEqual(['Tables', 'Orders', 'Inbox', 'Me']);
      expect(m.container.querySelector('nav.tabbar a[aria-current="page"]')?.textContent).toBe('Tables');
      act(() => {
        window.location.hash = '#/me';
      });
      await flush();
      expect(m.container.querySelector('header.ph-top h1')?.textContent).toBe('Me');
      m.click(m.button('Sign out'));
      await flush();
      expect(h.calls.some((c) => c.path === '/auth/logout')).toBe(true);
      expect(m.container.querySelector('nav.tabbar')).toBeNull();
    } finally {
      restore();
    }
  });
});

// 02a §8 Top bar / Table map wiring (IR-3, IR-5)
describe('[02a §8 Top bar] map wiring', () => {
  const tile = (table_id: string, name: string) => ({
    table_id, name, seats: 4, archived: false, state: 'FREE', seating_id: null, party_size: null, primary_table_id: null,
    joined_table_names: [], holder: null, assignee: null, lock: null, opened_at: null, bill_requested_at: null, live_order_count: 0,
  });
  const MAP = {
    as_of_seq: 1,
    floors: [
      { floor_id: 'FL1', name: 'Ground floor', archived: false, zones: [{ zone_id: 'Z1', name: 'A', tables: [tile('T1', 'T1'), tile('T2', 'T2')] }] },
      { floor_id: 'FL2', name: 'Rooftop', archived: false, zones: [{ zone_id: 'Z2', name: 'B', tables: [tile('T3', 'T3')] }] },
      { floor_id: 'FLX', name: 'Old', archived: true, zones: [] },
    ],
  };

  it('[02a §8 Top bar] the floor control lists the map store floors with counts and writes #/tables?floor=', async () => {
    render(TABLET, hub().fetch);
    await signIn();
    sockets[0]!.frame({ type: 'catch_up', as_of_seq: 1, state: { tables: MAP } });
    await flush(6);
    const seg = m.container.querySelector('header.top .seg')!;
    expect([...seg.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Ground floor2', 'Rooftop1']);
    m.click(m.button('Rooftop', seg));
    await flush();
    expect(window.location.hash).toBe('#/tables?floor=FL2');
    expect(m.container.querySelector('header.top .seg button[aria-pressed="true"]')?.textContent).toContain('Rooftop');
    // not on the inbox
    act(() => {
      window.location.hash = '#/inbox';
    });
    await flush();
    expect(m.container.querySelector('header.top .seg')).toBeNull();
  });

  it('[02a §8 Table map] the alert store rows reach the map (a call_waiter row shows in Needs you)', async () => {
    render(TABLET, hub().fetch);
    await signIn();
    sockets[0]!.frame({ type: 'catch_up', as_of_seq: 1, state: { tables: MAP } });
    sockets[0]!.frame({
      type: 'alert',
      alert: { alert_id: 'C1', kind: 'call_waiter', family: 'info', step: 0, escalation: false, set: 'recipient', for_staff_id: null, lock: { kind_label_key: 'alert.call_waiter.lock', table_code: 'T2', requester_name: 'Ali' }, raised_at: NOW - 120_000 },
    });
    await flush(6);
    expect(m.container.querySelector('.side2')?.textContent).toContain('T2');
  });
});
