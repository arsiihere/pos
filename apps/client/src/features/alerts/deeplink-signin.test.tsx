import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, row } from '../../../test/alert-rows';
import { flush, mount, reply, type Mounted } from '../../../test/dom';
import type { Device, PageMeta } from '../staff/api';
import type { OrderViewBody } from '../staff/orders/contracts';
import { StaffApp } from '../staff/StaffApp';
import { handOver, peekOrderView } from '../staff/orders/preload';
import type { SocketLike } from './socket';
import { fakeTimers, recordingSink } from './test-fakes';

// 01d v1.3.2 §3.13.4 row "9b notification tap while signed out", §3.13.7, §8.2 (L-3), test 91. Page half only (gap
// G-2: the Android intent is 01d-tablet-plan's): the app opens at #/inbox?focus=alert:<id> behind the sign-in
// screen; the sign-in keeps that hash (no landing on #/tables); the Inbox then glows the card once (dl cp7) and drops
// focus. A person whose inbox lacks the card: nothing glows, nothing breaks.

let scrolled: Element[] = [];
beforeEach(() => {
  scrolled = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
});
afterEach(() => vi.unstubAllGlobals());

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

const CARD = row({
  alert_id: 'A-9B',
  kind: 'engine_line_dropped',
  family: 'action',
  set: 'recipient',
  lock: { kind_label_key: 'alert.engine_line_dropped.lock', table_code: '4', point_code: null, requester_name: null },
});

function hub(inbox: unknown[]) {
  const calls: Array<{ method: string; path: string }> = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0]!;
    const method = init?.method ?? 'GET';
    calls.push({ method, path });
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
        return reply(200, { data: { requests: [] } });
      case 'GET /queries/my-requests':
        return reply(200, { data: { requests: [] } });
      case 'POST /commands/mark-alerts-seen':
        return reply(200, { data: { command_id: 'C', event_ids: [], result: { seen: [] } } });
      default:
        return reply(404, { error: { code: 'NOT_FOUND', message: `${method} ${path}`, details: {} } });
    }
  });
  return { fetch, calls };
}

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function openSignedOut(hash: string, inbox: unknown[]) {
  window.history.replaceState(null, '', hash); // the 9b notification opens the app at this hash
  const sockets: FakeSocket[] = [];
  const timers = fakeTimers();
  const h = hub(inbox);
  m = mount();
  m.render(
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
      wipeKeys={() => Promise.resolve()}
    />,
  );
  await flush();
  return { h, sockets, mm: m };
}

async function signIn(mm: Mounted, sockets: FakeSocket[]) {
  mm.click(mm.button('Imran'));
  const keys = mm.container.querySelector('.pin__keys')!;
  for (const d of '1234') mm.click([...keys.querySelectorAll('button')].find((b) => b.textContent === d));
  mm.click([...keys.querySelectorAll('button')].find((b) => b.textContent === 'Sign in'));
  await flush(8);
  for (const s of sockets) s.frame({ type: 'catch_up', as_of_seq: 0, state: {} });
  await flush(8);
}

describe('[01d v1.3.2 §3.13.4] 9b: focus kept through the sign-in', () => {
  it('[01d #91] the app opens at #/inbox?focus=alert:<id> behind the sign-in; after sign-in the card glows once and focus is dropped', async () => {
    const { mm, sockets } = await openSignedOut('#/inbox?focus=alert%3AA-9B', [CARD]);
    expect(mm.container.querySelector('.pin__keys, [data-staff], .tiles') ?? mm.button('Imran')).toBeTruthy(); // the sign-in screen
    expect(window.location.hash).toBe('#/inbox?focus=alert%3AA-9B'); // not rewritten by the sign-in screen
    await signIn(mm, sockets);
    await wait(80);
    await flush(4);
    const card = mm.container.querySelector<HTMLElement>('.inbox [data-alert="A-9B"], [data-alert="A-9B"]');
    expect(card).not.toBeNull();
    expect(scrolled).toEqual([card]); // once
    expect(card!.classList.contains('pos-glow')).toBe(true);
    expect(window.location.hash).toBe('#/inbox'); // focus dropped (replaceState)
    // a re-render (a new frame) never glows again
    for (const s of sockets) s.frame({ type: 'catch_up', as_of_seq: 1, state: {} });
    await flush(8);
    await wait(40);
    expect(scrolled).toEqual([card]);
  });

  it('[01d #91] a person whose inbox lacks the card: nothing glows, nothing breaks; focus is dropped after the wait', { timeout: 10_000 }, async () => {
    const { mm, sockets } = await openSignedOut('#/inbox?focus=alert%3AA-GONE', [CARD]);
    await signIn(mm, sockets);
    await wait(4_200); // past the arrival wait (ARRIVAL_MS)
    expect(window.location.hash).toBe('#/inbox'); // the sign-in kept the inbox route; the focus is dropped
    expect(scrolled).toEqual([]);
    expect(mm.container.querySelector('[data-alert="A-9B"]')).not.toBeNull(); // the inbox is there as usual
    expect(mm.container.querySelector('.pos-glow')).toBeNull();
  });

  it('[01d §3.13.4] without a focus the sign-in lands on #/tables as today', async () => {
    const { mm, sockets } = await openSignedOut('#/inbox', [CARD]);
    await signIn(mm, sockets);
    expect(window.location.hash).toBe('#/tables');
  });

  it('[01d §3.13.3 m3; dl cp6] a sign-out drops a held tap read (dropHandover): the next person reads fresh', async () => {
    const { mm, sockets } = await openSignedOut('#/inbox', [CARD]);
    await signIn(mm, sockets);
    window.history.replaceState(null, '', '#/inbox');
    const order = { order_id: 'O5', order_type: 'takeaway', seating_id: null } as unknown as OrderViewBody;
    handOver({ order_view: order });
    mm.click(mm.container.querySelector('header.top button.me')); // 02b-TK TK-SH02: the chip opens the menu
    mm.click(mm.button('Sign out', mm.container.querySelector('[role="menu"]')!));
    await flush(8);
    // on O5's own route (no screen there to take it while signed out), within the handover's 4 s: nothing is held
    window.history.replaceState(null, '', '#/orders/O5');
    expect(peekOrderView('O5')).toBeNull();
  });

  it('[01d §3.13.4; #264 review] only the 9b form is kept: a table, order or late focus at sign-in lands on #/tables as today', async () => {
    for (const hash of ['#/tables/T4?seating_id=S4&focus=table', '#/tables/T4?seating_id=S4&focus=order%3AO1', '#/tables/T4?seating_id=S4&focus=late%3AA1', '#/zones?focus=item%3AZ1%3AI1']) {
      const { mm, sockets } = await openSignedOut(hash, [CARD]);
      await signIn(mm, sockets);
      expect(window.location.hash, hash).toBe('#/tables');
      mm.unmount();
      m = null;
    }
  });

  it('[01d §3.13.4; #264 review] A signs out with a focus still in the hash: it is stripped, and B lands as today (no leak)', async () => {
    const { mm, sockets } = await openSignedOut('#/inbox', [CARD]);
    await signIn(mm, sockets); // A
    window.history.replaceState(null, '', '#/inbox?focus=alert%3AA-9B'); // A's focus, not consumed yet
    mm.click(mm.container.querySelector('header.top button.me')); // 02b-TK TK-SH02: the chip opens the menu
    mm.click(mm.button('Sign out', mm.container.querySelector('[role="menu"]')!));
    await flush(8);
    expect(window.location.hash).toBe('#/inbox'); // stripped at sign-out (replaceState)
    await signIn(mm, sockets); // B
    expect(window.location.hash).toBe('#/tables');
    expect(scrolled).toEqual([]);
  });

  it('[01d §3.13.4; #264 review] an unpair strips a focus too', async () => {
    const { mm, sockets } = await openSignedOut('#/inbox', [CARD]);
    await signIn(mm, sockets);
    window.history.replaceState(null, '', '#/inbox?focus=alert%3AA-9B');
    for (const s of sockets) s.onclose?.({ code: 4403, reason: '' }); // the hub revoked this device
    await flush(8);
    expect(window.location.hash).toBe('#/inbox');
  });

  it('[01d §3.13.3 m3; dl cp6; #264 review] a sign-in drops a tap read held from before it', async () => {
    // signed out, the hash already carries the 9b focus (so the sign-in lands nowhere and no hashchange drops it)
    const { mm, sockets } = await openSignedOut('#/inbox?focus=alert%3AA-GONE', [CARD]);
    handOver({ order_view: { order_id: 'O5', order_type: 'takeaway', seating_id: null } as unknown as OrderViewBody });
    await signIn(mm, sockets);
    window.history.replaceState(null, '', '#/orders/O5');
    expect(peekOrderView('O5')).toBeNull();
  });

  it('[01d §3.13.3 m3; dl cp6; #264 review] an unpair drops a held tap read', async () => {
    const { mm, sockets } = await openSignedOut('#/inbox', [CARD]);
    await signIn(mm, sockets);
    window.history.replaceState(null, '', '#/inbox');
    handOver({ order_view: { order_id: 'O5', order_type: 'takeaway', seating_id: null } as unknown as OrderViewBody });
    for (const s of sockets) s.onclose?.({ code: 4403, reason: '' });
    await flush(8);
    window.history.replaceState(null, '', '#/orders/O5');
    expect(peekOrderView('O5')).toBeNull();
  });
});
