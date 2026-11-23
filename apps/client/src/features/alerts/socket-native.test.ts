import { describe, expect, it } from 'vitest';
import type { DeviceType } from '@pos/domain';
import { createAlertConnection, type AlertConnectionDeps, type SocketLike } from './socket';
import { createAlertStore } from './store';
import { fakeTimers, recordingSink, view } from './test-fakes';

// 05b D-2 / M-8 / §3.5 (N-5) / D-4: the page socket inside the tablet app, and the earlier-day alerts_open row.

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
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  frame(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  drop(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code, reason: '' });
  }
}

function setup(deviceType: DeviceType, sessionToken: string | null, extra: Partial<AlertConnectionDeps> = {}) {
  const timers = fakeTimers();
  const sink = recordingSink(timers);
  const store = createAlertStore({ sink, timers, alwaysOn: false });
  const sockets: FakeSocket[] = [];
  const shown: string[] = [];
  const conn = createAlertConnection({
    url: 'ws://hub.local/ws',
    deviceType,
    deviceToken: 'dev-tok',
    sessionToken,
    store,
    timers,
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    onShown: (r) => shown.push(`${r.alert_id}:${r.step}`),
    ...extra,
  });
  return { timers, sink, store, sockets, conn, shown };
}

describe('[05b test 1, D-2, M-4] no alert mode inside the app', () => {
  for (const type of ['tablet', 'phone', 'cashier_kiosk'] as const) {
    it(`${type}: with PosNative the page never opens the alert-mode socket (signed out, after sign-out, after retry)`, () => {
      const { sockets, conn, timers } = setup(type, null, { nativeShell: true });
      expect(sockets).toHaveLength(0);
      expect(conn.mode()).toBe('none');
      conn.setSession('sess-1');
      expect(sockets).toHaveLength(1);
      sockets[0]!.open();
      expect(sockets[0]!.sent[0]).toEqual({ type: 'auth', device_token: 'dev-tok', session_token: 'sess-1' });
      conn.setSession(null);
      conn.retry();
      timers.advance(60_000);
      expect(sockets).toHaveLength(1);
      expect(conn.mode()).toBe('none');
    });
  }

  it('without PosNative: today — kiosk and phone open alert mode, the tablet does not', () => {
    expect(setup('cashier_kiosk', null).sockets).toHaveLength(1);
    expect(setup('phone', null).sockets).toHaveLength(1);
    expect(setup('tablet', null).sockets).toHaveLength(0);
  });
});

describe('[05b test 4, M-8] every row handed to the store is reported', () => {
  it('alert frames and catch-up rows call onShown with (alert_id, step)', () => {
    const { sockets, shown } = setup('tablet', 'sess-1', { nativeShell: true });
    sockets[0]!.open();
    sockets[0]!.frame({ type: 'catch_up', as_of_seq: 1, state: { alerts: { alerts: [{ ...view({ alert_id: 'A0' }), seen_by_me: false, from_business_day: null }] } } });
    sockets[0]!.frame({ type: 'alert', alert: view({ alert_id: 'A1', step: 0 }) });
    sockets[0]!.frame({ type: 'alert', alert: view({ alert_id: 'A1', step: 1 }) });
    expect(shown).toEqual(['A0:0', 'A1:0', 'A1:1']);
  });
});

describe('[05b §3.5, N-5] retry after a final close', () => {
  it('a 4403 ends the socket; retry() opens it again in the same mode', () => {
    const { sockets, conn } = setup('tablet', 'sess-1', { nativeShell: true });
    sockets[0]!.open();
    sockets[0]!.drop(4403);
    expect(sockets).toHaveLength(1);
    conn.retry();
    expect(sockets).toHaveLength(2);
    sockets[1]!.open();
    expect(sockets[1]!.sent[0]).toMatchObject({ session_token: 'sess-1' });
    conn.retry(); // already open: nothing
    expect(sockets).toHaveLength(2);
  });
});

describe('[05b D-4 client half; 01d §8.1] an earlier-day alerts_open row is listed without sound', () => {
  const row = { ...view({ alert_id: 'Y1', family: 'urgent', kind: 'call_waiter' }), seen_by_me: false, from_business_day: '2026-11-22' };
  delete (row as { card?: unknown }).card;

  it('the store lists it, plays nothing and starts no repeat', () => {
    const timers = fakeTimers();
    const sink = recordingSink(timers);
    const store = createAlertStore({ sink, timers, alwaysOn: false });
    store.onCatchUp([row]);
    timers.advance(60_000);
    expect(store.snapshot().rows.map((r) => [r.alert_id, r.from_business_day])).toEqual([['Y1', '2026-11-22']]);
    expect(sink.played).toEqual([]);
  });
});
