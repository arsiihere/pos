import { describe, expect, it, vi } from 'vitest';
import type { DeviceType } from '@pos/domain';
import { createAlertConnection, MAX_BACKOFF_MS, type AlertConnectionDeps, type SocketLike } from './socket';
import { createAlertStore } from './store';
import { fakeTimers, recordingSink, view, type FakeTimers } from './test-fakes';

// 01d §8.1, §3.7, §6 batch 3: the client's hub socket. A fake WebSocket is injected; timers are manual.

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  closedWith: number | null = null;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(code?: number): void {
    this.closedWith = code ?? 1000;
    this.readyState = 3;
  }
  // test side
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  frame(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  drop(code: number, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

const LOCK = { kind_label_key: 'alert.void_approval.lock', table_code: '12', point_code: null, requester_name: 'Hamza' };
const CARD = { ...LOCK, kind_label_key: 'alert.void_approval.card', details: { amount: 220_000 } };

function setup(deviceType: DeviceType, sessionToken: string | null, extra: Partial<AlertConnectionDeps> = {}) {
  const timers: FakeTimers = fakeTimers();
  const store = createAlertStore({ sink: recordingSink(timers), timers, alwaysOn: deviceType === 'cashier_kiosk' });
  const sockets: FakeSocket[] = [];
  const onBindingRoute = vi.fn();
  const onEnded = vi.fn();
  const conn = createAlertConnection({
    url: 'ws://hub.local/ws',
    deviceType,
    deviceToken: 'dev-tok',
    sessionToken,
    store,
    timers,
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    onBindingRoute,
    onEnded,
    ...extra,
  });
  const last = (): FakeSocket => sockets[sockets.length - 1]!;
  return { timers, store, sockets, last, conn, onBindingRoute, onEnded };
}

const catchUp = (alerts: unknown[]) => ({ type: 'catch_up', as_of_seq: 7, state: { hub: {}, alerts: { alerts } } });
const alertsOpen = (alerts: unknown[], until: number | null = null) => ({ type: 'alerts_open', alerts, binding_route_until: until });

describe('alert socket', () => {
  it('[01d §8.1] signed in → staff-session socket: auth with session_token, frames and catch_up.alerts fed to the store', () => {
    const { last, store, conn } = setup('tablet', 'sess-1');
    last().open();
    expect(last().url).toBe('ws://hub.local/ws');
    expect(last().sent[0]).toEqual({ type: 'auth', device_token: 'dev-tok', session_token: 'sess-1' });
    expect(conn.mode()).toBe('session');
    expect(conn.isUp()).toBe(false); // nothing is sent before auth succeeds (00 §6.21): up on the first frame

    last().frame(catchUp([{ ...view({ alert_id: 'A0', card: CARD }), seen_by_me: false, from_business_day: null }]));
    expect(conn.isUp()).toBe(true);
    expect(store.snapshot().rows.map((r) => r.alert_id)).toEqual(['A0']);

    last().frame({ type: 'alert', alert: view({ alert_id: 'A1', raised_at: 5, card: CARD }) });
    expect(store.snapshot().rows.map((r) => r.alert_id)).toEqual(['A1', 'A0']);
    expect(store.snapshot().rows[0]?.card).toEqual(CARD);

    last().frame({ type: 'alert_seen', alert_id: 'A1' });
    expect(store.snapshot().rows[0]?.seen_by_me).toBe(true);

    last().frame({ type: 'alert_closed', alert_id: 'A1', reason: 'answered', decision: 'approve', by_name: 'Imran' });
    expect(store.snapshot().rows[0]).toMatchObject({ state: 'closed', by_name: 'Imran', decision: 'approve' });
  });

  it('[01d §8.1] a staff catch-up with no alerts part is not an empty open set (nothing closed)', () => {
    const { last, store, timers } = setup('tablet', 'sess-1');
    last().open();
    last().frame(catchUp([{ ...view({ alert_id: 'A0' }), seen_by_me: false, from_business_day: null }]));
    last().drop(1011);
    timers.advance(MAX_BACKOFF_MS);
    last().open();
    last().frame({ type: 'catch_up', as_of_seq: 9, state: { hub: {} } });
    expect(store.snapshot().rows[0]?.state).toBe('open');
  });

  it('[01d §8.1, §3.7] device type tablet never sends an alert-mode auth (the page; only the 9b service does)', () => {
    const { sockets, conn, timers } = setup('tablet', null);
    expect(sockets).toHaveLength(0);
    expect(conn.mode()).toBe('none');
    timers.advance(60_000);
    expect(sockets).toHaveLength(0);
    // sign-in opens the staff socket; sign-out does not fall back to alert mode
    conn.setSession('sess-1');
    expect(sockets).toHaveLength(1);
    sockets[0]!.open();
    expect(sockets[0]!.sent[0]).toMatchObject({ session_token: 'sess-1' });
    conn.setSession(null);
    expect(sockets[0]!.closedWith).toBe(1000);
    timers.advance(60_000);
    expect(sockets).toHaveLength(1);
    expect(conn.mode()).toBe('none');
  });

  it('[01d §3.7] the KDS page never opens alert mode either (its station socket gets device-target alerts)', () => {
    const { sockets } = setup('kds', null);
    expect(sockets).toHaveLength(0);
  });

  it.each(['cashier_kiosk', 'phone'] as const)(
    '[01d §8.1, §3.7] %s with no session opens alert mode and closes it on sign-in',
    (deviceType) => {
      const { sockets, conn, store, onBindingRoute } = setup(deviceType, null);
      expect(sockets).toHaveLength(1);
      sockets[0]!.open();
      expect(sockets[0]!.sent[0]).toEqual({ type: 'auth', device_token: 'dev-tok' });
      expect(conn.mode()).toBe('alert');
      sockets[0]!.frame(alertsOpen([{ alert_id: 'A1', kind: 'test_alert', family: 'info', step: 0, lock: LOCK, raised_at: 1 }], 9_000));
      expect(conn.isUp()).toBe(true);
      expect(store.snapshot().rows.map((r) => r.alert_id)).toEqual(['A1']);
      expect(onBindingRoute).toHaveBeenCalledWith(9_000);

      conn.setSession('sess-9');
      expect(sockets[0]!.closedWith).toBe(1000);
      expect(conn.isUp()).toBe(false);
      expect(sockets).toHaveLength(2);
      sockets[1]!.open();
      expect(sockets[1]!.sent[0]).toEqual({ type: 'auth', device_token: 'dev-tok', session_token: 'sess-9' });
      expect(conn.mode()).toBe('session');
      // a late close event of the old alert-mode socket changes nothing
      sockets[0]!.drop(1000);
      expect(sockets).toHaveLength(2);

      // sign-out → alert mode again
      conn.setSession(null);
      expect(sockets).toHaveLength(3);
      sockets[2]!.open();
      expect(sockets[2]!.sent[0]).toEqual({ type: 'auth', device_token: 'dev-tok' });
    },
  );

  it('[01d §3.7, G1-13e] entering alert mode drops every card held from the signed-in session', () => {
    const { sockets, conn, store } = setup('cashier_kiosk', 'sess-1');
    sockets[0]!.open();
    sockets[0]!.frame(catchUp([]));
    sockets[0]!.frame({ type: 'alert', alert: view({ alert_id: 'A1', card: CARD, answers: ['approve', 'reject'], needs_pin: 'always' }) });
    expect(store.snapshot().rows[0]?.card).toEqual(CARD);
    conn.setSession(null);
    expect(store.snapshot().rows).toEqual([]);
    expect(JSON.stringify(store.snapshot())).not.toContain('220000');
  });

  it('[01d §8.1, §8.2] reconnects with backoff that never exceeds 5 s, and resets after a good connection', () => {
    const { sockets, timers, conn } = setup('phone', null);
    const opened: number[] = [];
    sockets[0]!.open();
    for (let i = 0; i < 8; i++) {
      const before = sockets.length;
      sockets[sockets.length - 1]!.drop(1011);
      expect(conn.isUp()).toBe(false);
      let waited = 0;
      while (sockets.length === before) {
        timers.advance(100);
        waited += 100;
        expect(waited).toBeLessThanOrEqual(MAX_BACKOFF_MS);
      }
      opened.push(waited);
    }
    expect(Math.max(...opened)).toBeLessThanOrEqual(5_000);
    expect(opened[opened.length - 1]).toBe(MAX_BACKOFF_MS);
    expect(opened[0]).toBeLessThan(opened[opened.length - 1]!);

    // a connection that authenticates resets the backoff
    const s = sockets[sockets.length - 1]!;
    s.open();
    s.frame(alertsOpen([]));
    s.drop(1012);
    let waited = 0;
    const before = sockets.length;
    while (sockets.length === before) {
      timers.advance(100);
      waited += 100;
    }
    expect(waited).toBe(opened[0]);
  });

  it('[01d §3.7] 4401 / 4403 / 4409 end the socket: onEnded, no reconnect (4409 even after a frame)', () => {
    for (const code of [4401, 4403, 4409]) {
      const b = setup('phone', null);
      b.sockets[0]!.open();
      b.sockets[0]!.frame(alertsOpen([])); // the hub sends alerts_open right after an alert-mode auth
      b.sockets[0]!.drop(code, code === 4409 ? '' : 'device_revoked');
      b.timers.advance(60_000);
      expect(b.sockets).toHaveLength(1);
      expect(b.onEnded).toHaveBeenCalledWith(code, code === 4409 ? 'open on another tab/screen' : 'device_revoked');
      expect(b.conn.isUp()).toBe(false);
    }
  });

  it('[01d §6 batch 3] receipt delivered sent once per (alert_id, step) shown, also after a reconnect', () => {
    const { sockets, timers } = setup('tablet', 'sess-1');
    sockets[0]!.open();
    sockets[0]!.frame(catchUp([{ ...view({ alert_id: 'A0' }), seen_by_me: false, from_business_day: null }]));
    sockets[0]!.frame({ type: 'alert', alert: view({ alert_id: 'A1' }) });
    sockets[0]!.frame({ type: 'alert', alert: view({ alert_id: 'A1' }) }); // duplicate frame
    sockets[0]!.frame({ type: 'alert', alert: view({ alert_id: 'A1', step: 1, escalation: true }) });
    const receipts = (s: FakeSocket) => s.sent.filter((m) => m.type === 'receipt');
    expect(receipts(sockets[0]!)).toEqual([
      { type: 'receipt', alert_id: 'A0', kind: 'delivered', step: 0 },
      { type: 'receipt', alert_id: 'A1', kind: 'delivered', step: 0 },
      { type: 'receipt', alert_id: 'A1', kind: 'delivered', step: 1 },
    ]);
    sockets[0]!.drop(1011);
    timers.advance(MAX_BACKOFF_MS);
    sockets[1]!.open();
    sockets[1]!.frame(
      catchUp([
        { ...view({ alert_id: 'A1', step: 1, escalation: true }), seen_by_me: false, from_business_day: null },
        { ...view({ alert_id: 'A2' }), seen_by_me: false, from_business_day: null },
      ]),
    );
    expect(receipts(sockets[1]!)).toEqual([{ type: 'receipt', alert_id: 'A2', kind: 'delivered', step: 0 }]);
  });

  it('[01d §6 batch 3] alert-mode receipts for alerts_open rows; nothing but auth and receipts is ever sent', () => {
    const { sockets } = setup('cashier_kiosk', null);
    sockets[0]!.open();
    sockets[0]!.frame(alertsOpen([{ alert_id: 'A1', kind: 'test_alert', family: 'info', step: 2, lock: LOCK, raised_at: 1 }]));
    sockets[0]!.frame({ type: 'alert', alert: view({ alert_id: 'A2' }) });
    expect(sockets[0]!.sent.map((m) => m.type)).toEqual(['auth', 'receipt', 'receipt']);
    expect(sockets[0]!.sent[1]).toEqual({ type: 'receipt', alert_id: 'A1', kind: 'delivered', step: 2 });
  });

  it('[01d §8.1] binding_route frames are passed to the header callback', () => {
    const { sockets, onBindingRoute } = setup('tablet', 'sess-1');
    sockets[0]!.open();
    sockets[0]!.frame(catchUp([]));
    sockets[0]!.frame({ type: 'binding_route', until: 123_000 });
    sockets[0]!.frame({ type: 'binding_route', until: null });
    expect(onBindingRoute.mock.calls).toEqual([[123_000], [null]]);
  });

  it('[01d §8.1] a later lock frame for an alert held as a card replaces the card (kiosk becomes a device target at step 1)', () => {
    const { sockets, store } = setup('cashier_kiosk', 'sess-1');
    sockets[0]!.open();
    sockets[0]!.frame(catchUp([]));
    sockets[0]!.frame({
      type: 'alert',
      alert: view({ alert_id: 'A1', card: CARD, answers: ['approve', 'reject'], needs_pin: 'always', raised_device_id: 'D1' }),
    });
    expect(store.snapshot().rows[0]?.card).toEqual(CARD);
    sockets[0]!.frame({ type: 'alert', alert: view({ alert_id: 'A1', step: 1 }) }); // lock only
    const row = store.snapshot().rows[0]!;
    expect(row.step).toBe(1);
    expect(row.card).toBeUndefined();
    expect(row.answers).toBeUndefined();
    expect(row.needs_pin).toBeUndefined();
    expect(row.raised_device_id).toBeUndefined();
  });

  it('[01d §3.12; AD-163] catch-up after a reconnect: an earlier card frame, then a lock catch-up row → lock', () => {
    const { sockets, store, timers } = setup('cashier_kiosk', 'sess-1');
    sockets[0]!.open();
    sockets[0]!.frame(catchUp([]));
    sockets[0]!.frame({ type: 'alert', alert: view({ alert_id: 'A1', card: CARD, answers: ['approve', 'reject'], raised_device_id: 'D1' }) });
    expect(store.snapshot().rows[0]?.card).toEqual(CARD);
    sockets[0]!.drop(1011);
    timers.advance(MAX_BACKOFF_MS);
    sockets[1]!.open();
    sockets[1]!.frame(catchUp([{ ...view({ alert_id: 'A1', step: 1 }), seen_by_me: false, from_business_day: null }]));
    const row = store.snapshot().rows[0]!;
    expect(row).toMatchObject({ step: 1, lock: LOCK, state: 'open' });
    expect(row.card).toBeUndefined();
    expect(row.answers).toBeUndefined();
    expect(row.raised_device_id).toBeUndefined();
  });

  it('[01d §3.12; AD-163] an alerts_open lock row replaces a held card', () => {
    const { sockets, store } = setup('phone', null);
    // a card already in the store (e.g. fed by another source before alert mode)
    store.onAlert(view({ alert_id: 'A1', card: CARD, needs_pin: 'always' }));
    sockets[0]!.open();
    sockets[0]!.frame(alertsOpen([{ alert_id: 'A1', kind: 'void_approval', family: 'urgent', step: 0, lock: LOCK, raised_at: 0 }]));
    const row = store.snapshot().rows[0]!;
    expect(row.card).toBeUndefined();
    expect(row.needs_pin).toBeUndefined();
    expect(row.lock).toEqual(LOCK);
  });

  describe('[01d §8.1] a session change resets what the page holds (review fix round 1)', () => {
    const personal = (id: string) => ({ ...view({ alert_id: id, kind: 'pin_use_failed', family: 'info', set: 'recipient', card: CARD }), seen_by_me: true, from_business_day: null });

    it('(a) a direct switch from session A to session B keeps none of A\'s cards or rows', () => {
      const { sockets, store, conn } = setup('cashier_kiosk', 'sess-A');
      sockets[0]!.open();
      sockets[0]!.frame(catchUp([personal('P1')]));
      expect(store.snapshot().rows).toHaveLength(1);
      conn.setSession('sess-B');
      expect(store.snapshot().rows).toEqual([]);
    });

    it('(b) after sign-out, A\'s personal notices are not left as closed lock rows for the next person', () => {
      const { sockets, store, conn } = setup('cashier_kiosk', 'sess-A');
      sockets[0]!.open();
      sockets[0]!.frame(catchUp([personal('P1')]));
      conn.setSession(null);
      sockets[1]!.open();
      sockets[1]!.frame(alertsOpen([]));
      expect(store.snapshot().rows).toEqual([]);
    });

    it('(c) A\'s seen_by_me does not carry over to B', () => {
      const { sockets, store, conn } = setup('cashier_kiosk', 'sess-A');
      sockets[0]!.open();
      sockets[0]!.frame(catchUp([{ ...view({ alert_id: 'A1' }), seen_by_me: true, from_business_day: null }]));
      conn.setSession('sess-B');
      sockets[1]!.open();
      sockets[1]!.frame(catchUp([{ ...view({ alert_id: 'A1' }), seen_by_me: false, from_business_day: null }]));
      expect(store.snapshot().rows[0]?.seen_by_me).toBe(false);
      expect(store.snapshot().unseen).toBe(1);
    });

    it('(d) receipts are sent again for the new session; device-target sounds do not replay', () => {
      const timers = fakeTimers();
      const sink = recordingSink(timers);
      const store = createAlertStore({ sink, timers, alwaysOn: true });
      const sockets: FakeSocket[] = [];
      const conn = createAlertConnection({
        url: 'ws://hub.local/ws',
        deviceType: 'cashier_kiosk',
        deviceToken: 'dev-tok',
        sessionToken: 'sess-A',
        store,
        timers,
        createSocket: (url) => {
          const s = new FakeSocket(url);
          sockets.push(s);
          return s;
        },
      });
      sockets[0]!.open();
      sockets[0]!.frame({ type: 'alert', alert: view({ alert_id: 'K1' }) });
      expect(sink.played).toHaveLength(1);
      conn.setSession('sess-B');
      sockets[1]!.open();
      sockets[1]!.frame(catchUp([{ ...view({ alert_id: 'K1' }), seen_by_me: false, from_business_day: null }]));
      expect(sockets[1]!.sent.filter((m) => m.type === 'receipt')).toEqual([{ type: 'receipt', alert_id: 'K1', kind: 'delivered', step: 0 }]);
      expect(sink.played).toHaveLength(1);
    });
  });

  it('[01d §8.1] malformed or unknown frames are ignored; other frames go to onFrame', () => {
    const onFrame = vi.fn();
    const { sockets, store, conn } = setup('tablet', 'sess-1', { onFrame });
    sockets[0]!.open();
    sockets[0]!.onmessage?.({ data: 'not json' });
    sockets[0]!.frame({ type: 'alert', alert: { alert_id: 'A1' } });
    expect(store.snapshot().rows).toHaveLength(0);
    sockets[0]!.frame(catchUp([]));
    sockets[0]!.frame({ type: 'event', seq: 8, event: { event_id: 'E', event_type: 'X', schema_version: 1, payload: {} } });
    expect(onFrame.mock.calls.map((c) => (c[0] as { type: string }).type)).toEqual(['catch_up', 'event']);
    expect(conn.isUp()).toBe(true);
  });

  it('[01d §8.1] subscribe reports up / down; dispose closes and stops reconnecting', () => {
    const { sockets, conn, timers } = setup('phone', null);
    const states: boolean[] = [];
    conn.subscribe(() => states.push(conn.isUp()));
    sockets[0]!.open();
    sockets[0]!.frame(alertsOpen([]));
    sockets[0]!.drop(1011);
    expect(states).toEqual([true, false]);
    conn.dispose();
    timers.advance(60_000);
    expect(sockets).toHaveLength(1);
  });
});
