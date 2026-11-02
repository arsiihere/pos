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

function hub(o: { permissions?: Record<string, { grant: string }>; requests?: unknown[]; answer?: Response } = {}) {
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
        return reply(200, { data: { alerts: [] }, meta: { next_cursor: null } });
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

    render(TABLET, hub({ permissions: { 'manage-devices': { grant: 'allowed' }, 'approve-void': { grant: 'allowed' } } }).fetch);
    await signIn();
    expect(m.text()).toContain('Test alert');
    expect(m.text()).toContain('Requests');
  });

  it('AnswerRequest carries the page ids and the signed-in session (context filled from the sign-in)', async () => {
    const h = hub({ permissions: { 'approve-void': { grant: 'allowed' } }, requests: [requestRow({ alert_id: 'R1' })] });
    render(TABLET, h.fetch);
    await signIn();
    sockets[0]!.frame({ type: 'alerts_open', alerts: [], binding_route_until: null });
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

  it('[01d BF-5] alerts_open and binding_route frames set the deadline; null clears it', async () => {
    render(TABLET, hub().fetch);
    await signIn();
    sockets[0]!.frame({ type: 'alerts_open', alerts: [], binding_route_until: NOW + 30 * 60_000 });
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
