import { useContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW } from '../../../test/alert-rows';
import { flush, mount, reply, type Mounted } from '../../../test/dom';
import type { SocketLike } from '../alerts/socket';
import { fakeTimers, recordingSink } from '../alerts/test-fakes';
import type { Device, PageMeta } from './api';
import { pendingCompsOf } from './orders/actions/pending-comps';
import { queueOf } from './orders/queue/enqueue';
import { LateAlertsContext, type LateAlertRow } from './orders/late/late-groups';
import { useShell, type Shell } from './shell/hooks';
import { StaffApp } from './StaffApp';

// 02 combined wiring (02a v1.1.6 §8; 02b v1.0.11 §3.12, §8; IR-5, IR-7, IR-11, IR-12): what the staff shell connects
// between the lanes once 02a and 02b sit in one tree. The kiosk home is a probe here: it hands the test the shell
// the slots see and the late-card alert rows (LateAlertsContext), so the queue is driven exactly as a screen drives it.

const probe = vi.hoisted(() => ({ shell: null as Shell | null, late: [] as readonly LateAlertRow[] }));
vi.mock('./orders/lists/KioskHome', () => ({
  KioskHome: () => {
    probe.shell = useShell();
    probe.late = useContext(LateAlertsContext);
    return <div data-probe="kiosk-home" />;
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

const META: PageMeta = { tenantId: 'TEN-1', branchId: 'BR-1', branchName: 'Gulberg', hubNowMs: NOW, utcOffsetMs: 0 };
const TABLET: Device = { token: 'DEV-TOK', id: 'D-T3', type: 'tablet' };
const KIOSK: Device = { token: 'DEV-TOK', id: 'D-K1', type: 'cashier_kiosk' };

const SETTINGS = { zone_undo_ms: 30_000, slow_item_threshold_ms: 600_000, comp_reason_chips: [], queue_auto_send_max_ms: 14_400_000, table_lock_ttl_ms: 120_000, order_abandon_ms: 900_000 };

interface HubOpts {
  /** the login reply's idle TTL; the session query never carries one here (the IR-9 fallback must not be needed) */
  idleTtlMs?: number;
  settings?: Partial<typeof SETTINGS>;
  /** POST /commands/submit-order: 'down' = no answer (network), else the hub's reply */
  submit?: () => 'down' | Response;
  /** POST /auth/pin waits for this (the sign-in screen stays up) */
  pinGate?: Promise<void>;
  map?: unknown;
  permissions?: Record<string, { grant: string; scope?: string }>;
}

function hub(o: HubOpts = {}) {
  const calls: Array<{ method: string; path: string }> = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0]!;
    const method = init?.method ?? 'GET';
    calls.push({ method, path });
    switch (`${method} ${path}`) {
      case 'GET /queries/staff-roster':
        return reply(200, { data: { staff: [{ staff_id: 'S-IMRAN', display_name: 'Imran', locked_until: null }], active_session: null } });
      case 'POST /auth/pin':
        await o.pinGate;
        return reply(200, { data: { session_token: 'SESS-1', session_id: 'X1', staff_id: 'S-IMRAN', display_name: 'Imran', role_ids: [], idle_ttl_ms: o.idleTtlMs ?? 600_000 } });
      case 'GET /queries/session':
        return reply(200, { data: { permissions: o.permissions ?? {} } });
      case 'GET /queries/alerts-inbox':
        return reply(200, { data: { alerts: [] }, meta: { next_cursor: null } });
      case 'GET /queries/branch-config':
        return reply(200, { data: { config_version: 1, snapshot_hash: 'h', snapshot: { engine_settings: { ...SETTINGS, ...o.settings } }, hub_time: { now_ms: NOW, utc_offset_ms: 0 } } });
      case 'GET /queries/requests-to-answer':
        return reply(200, { data: { requests: [] } });
      case 'GET /queries/my-requests':
        return reply(200, { data: { requests: [] } });
      case 'GET /queries/table-map':
        return reply(200, { data: o.map ?? { as_of_seq: 0, floors: [] } });
      case 'POST /commands/submit-order': {
        const r = o.submit?.() ?? 'down';
        if (r === 'down') throw new TypeError('Failed to fetch');
        return r;
      }
      case 'POST /commands/mark-alerts-seen':
        return reply(200, { data: { command_id: 'C', event_ids: [], result: { seen: [] } } });
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
beforeEach(() => {
  sockets = [];
  wiped = 0;
  probe.shell = null;
  probe.late = [];
  window.location.hash = '';
});
afterEach(() => m?.unmount());

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
      wipeKeys={async () => {
        wiped += 1;
      }}
      goToPair={() => {}}
    />,
  );
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

const ORDER = { order_id: 'O-1', order_type: 'takeaway', lines: [] };
/** flushes until `ok` (IndexedDB work is real async in fake-indexeddb), at most ~2 s */
async function until(ok: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !ok(); i += 1) {
    await new Promise((r) => setTimeout(r, 20));
    await flush();
  }
}

const sock = () => sockets.at(-1)!;
const enqueueOrder = () => probe.shell!.enqueue('SubmitOrder', ORDER, { label: 'Takeaway' });

describe('[02 wiring] queue', () => {
  it('[02b §8 Queue; IR-7] the queued-and-sent-later token card is mounted at the root: it shows on the sign-in screen after the sign-in drain', async () => {
    let hubUp = false;
    let openPin: () => void = () => {};
    const h = hub({
      submit: () => (hubUp ? reply(200, { data: { command_id: 'C1', event_ids: [], result: { order_id: 'O-1', token: 57 } } }) : 'down'),
      pinGate: new Promise((r) => (openPin = r)),
    });
    render(KIOSK, h.fetch);
    await flush();
    m.click(m.button('Imran'));
    typePin();
    openPin();
    await flush(8);
    expect(m.container.querySelector('[data-probe="kiosk-home"]')).not.toBeNull();
    expect(await enqueueOrder()).toEqual({ status: 'queued', entry_id: expect.any(String) });
    // the socket ends the session (4401): the page is signed out, the entry still waits (this page's life)
    sock().frame({ type: 'catch_up', as_of_seq: 0, state: {} });
    sock().onclose?.({ code: 4401, reason: 'session ended' });
    await flush(4);
    expect(m.button('Imran')).toBeTruthy(); // the sign-in tiles
    // the next sign-in drains first (before POST /auth/pin, held here): the replay's 2xx brings the token
    hubUp = true;
    let release: () => void = () => {};
    h.fetch.mockClear();
    const gated = hub({ pinGate: new Promise((r) => (release = r)) });
    h.fetch.mockImplementation(async (url: string, init?: RequestInit) =>
      url.includes('/commands/submit-order') ? reply(200, { data: { command_id: 'C1', event_ids: [], result: { order_id: 'O-1', token: 57 } } }) : gated.fetch(url, init),
    );
    m.click(m.button('Imran'));
    typePin();
    await flush(8);
    expect(m.container.querySelector('.tokc .tk')?.textContent).toBe('57');
    expect(m.container.querySelector('.pin__keys')).not.toBeNull(); // still on the sign-in screen
    release();
    await flush(8);
    // signed in: the card stays until OK
    expect(m.container.querySelector('.tokc .tk')?.textContent).toBe('57');
    m.click(m.button('OK', m.container.querySelector('.tokc')!));
    await flush();
    expect(m.container.querySelector('.tokc')).toBeNull();
  });

  it('[02b §3.12; Task 28 wiring] the auto-send window is the branch queue_auto_send_max_ms from the shell config', async () => {
    let hubUp = false;
    const h = hub({ settings: { queue_auto_send_max_ms: 1 }, submit: () => (hubUp ? reply(200, { data: { command_id: 'C1', event_ids: [], result: { order_id: 'O-1', token: 57 } } }) : 'down') });
    render(KIOSK, h.fetch);
    await signIn();
    expect(probe.shell!.config.config()?.queue_auto_send_max_ms).toBe(1);
    expect((await enqueueOrder()).status).toBe('queued');
    await new Promise((r) => setTimeout(r, 15));
    hubUp = true;
    h.calls.length = 0;
    // the reconnect drain: the entry waited longer than 1 ms → the queue log, never sent
    sock().frame({ type: 'catch_up', as_of_seq: 0, state: {} });
    sock().onclose?.({ code: 1006, reason: '' });
    sockets.at(-1)!.frame({ type: 'catch_up', as_of_seq: 0, state: {} });
    await until(() => probe.shell!.enqueue.pendingCount() === 0);
    expect(h.calls.filter((c) => c.path === '/commands/submit-order')).toEqual([]);
    expect(probe.shell!.enqueue.pendingCount()).toBe(0);
    // review #193: it is in the queue log as too old, for "Send again"
    expect(queueOf(probe.shell!.enqueue)!.log().map((e) => [e.command_type, e.log_reason])).toEqual([['SubmitOrder', 'too_old']]);
  });

  it('[02a §8 Login; 02b §3.12; Task 28 wiring] DEVICE_REVOKED from a queued send wipes the pairing keys (hub-admin) once, keeps both queued entries, shows Pair again', async () => {
    let revoked = false;
    const h = hub({ submit: () => (revoked ? reply(403, { error: { code: 'DEVICE_REVOKED', message: 'revoked', details: {} } }) : 'down') });
    render(KIOSK, h.fetch);
    await signIn();
    expect((await enqueueOrder()).status).toBe('queued');
    expect((await probe.shell!.enqueue('SubmitOrder', { ...ORDER, order_id: 'O-2' }, { label: 'Takeaway 2' })).status).toBe('queued');
    const enqueue = probe.shell!.enqueue;
    // the hub is back and says the device is revoked: the drain stops at the first entry
    revoked = true;
    sock().frame({ type: 'catch_up', as_of_seq: 0, state: {} });
    sock().onclose?.({ code: 1006, reason: '' });
    sock().frame({ type: 'catch_up', as_of_seq: 0, state: {} });
    await until(() => wiped > 0);
    // review #193: the socket's 4403 after the revoke (twice) is no second wipe (StaffApp guards with a ref, so a 4403 in
    // the same tick as the revoke is one wipe too; that tick is not reachable from here)
    sock().onclose?.({ code: 4403, reason: 'revoked' });
    sock().onclose?.({ code: 4403, reason: 'revoked' });
    await flush(6);
    expect(wiped).toBe(1);
    expect(m.text()).toContain('This screen must be paired again');
    expect(enqueue.pendingCount()).toBe(2);
    expect(queueOf(enqueue)!.queued().map((e) => (e.payload as { order_id: string }).order_id)).toEqual(['O-1', 'O-2']);
  });

  it('[02b §3.12; IR-12] an entry that went straight to the queue log answers queued with logged: true', async () => {
    const h = hub({ submit: () => reply(401, { error: { code: 'SESSION_EXPIRED', message: 'gone', details: {} } }) });
    render(KIOSK, h.fetch);
    await signIn();
    expect(await enqueueOrder()).toEqual({ status: 'queued', entry_id: expect.any(String), logged: true });
  });
});

describe('[02 wiring] idle lock', () => {
  it('[02b §8 Device idle lock; IR-9] the TTL comes from the login reply (no session-query TTL needed); the lock\'s Sign in signs the page out', async () => {
    const h = hub({ idleTtlMs: 0 });
    render(TABLET, h.fetch);
    await signIn();
    await flush(4);
    const lock = m.container.querySelector('.idle');
    expect(lock).not.toBeNull();
    m.click(m.button('Sign in', lock as HTMLElement));
    // the drain reads the IndexedDB queue store first (real async): wait for the page to sign out
    await until(() => m.container.querySelector('.idle') === null);
    expect(m.container.querySelector('.idle')).toBeNull();
    // the sign-in screen again (roster tiles), and the owed logout went out
    expect(m.button('Imran')).toBeTruthy();
    expect(h.calls.some((c) => c.path === '/auth/logout')).toBe(true);
  });
});

describe('[02 wiring] alerts into 02b', () => {
  const slip = (alert_id: string) => ({
    alert_id, kind: 'slip_warning', family: 'action', step: 0, escalation: false, set: 'recipient', for_staff_id: null,
    lock: { kind_label_key: 'alert.slip_warning.lock', table_code: 'F4', requester_name: null }, raised_at: NOW - 60_000,
  });

  it('[02b §8 Late cards; IR-11] LateAlertsContext carries the alert store rows, open and closed', async () => {
    render(KIOSK, hub().fetch);
    await signIn();
    sock().frame({ type: 'catch_up', as_of_seq: 0, state: {} });
    sock().frame({ type: 'alert', alert: slip('SW1') });
    await flush(4);
    expect(probe.late.map((r) => [r.alert_id, r.state])).toEqual([['SW1', 'open']]);
    sock().frame({ type: 'alert_closed', alert_id: 'SW1', reason: 'done', decision: null, by_name: null });
    await flush(4);
    expect(probe.late.map((r) => [r.alert_id, r.state])).toEqual([['SW1', 'closed']]);
  });

  it('[02b §8 Table view; Task 28 wiring] a request_result alert row tells the pending-comp store once (resultSeen)', async () => {
    render(KIOSK, hub().fetch);
    await signIn();
    const seen = vi.spyOn(pendingCompsOf(probe.shell!), 'resultSeen');
    sock().frame({ type: 'catch_up', as_of_seq: 0, state: {} });
    sock().frame({
      type: 'alert',
      alert: { alert_id: 'RR1', kind: 'request_result', family: 'info', step: 0, escalation: false, set: 'recipient', for_staff_id: 'S-IMRAN', lock: { kind_label_key: 'alert.request_result.lock', table_code: 'F4', requester_name: null }, raised_at: NOW },
    });
    await flush(4);
    expect(seen).toHaveBeenCalledTimes(1);
    sock().frame({ type: 'alert', alert: slip('SW2') });
    await flush(4);
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe('[02 wiring] table map', () => {
  it('[02a §8 Table map; IR-5] New order on the map opens 02b\'s New order sheet (Takeaway · Parking)', async () => {
    render(TABLET, hub({ permissions: { 'take-order': { grant: 'allowed', scope: 'branch' } } }).fetch);
    await signIn();
    expect(window.location.hash).toBe('#/tables');
    const tile = {
      table_id: 'T1', name: 'T1', seats: 4, archived: false, state: 'FREE', seating_id: null, party_size: null, primary_table_id: null,
      joined_table_names: [], holder: null, assignee: null, lock: null, opened_at: null, bill_requested_at: null, live_order_count: 0,
    };
    const floors = [{ floor_id: 'FL1', name: 'Ground', archived: false, zones: [{ zone_id: 'Z1', name: 'A', tables: [tile] }] }];
    sock().frame({ type: 'catch_up', as_of_seq: 1, state: { tables: { as_of_seq: 1, floors } } });
    await flush(6);
    m.click(m.button('New order'));
    await flush();
    const dialog = m.container.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(m.button('Takeaway', dialog as HTMLElement)).toBeTruthy();
    expect(m.button('Parking', dialog as HTMLElement)).toBeTruthy();
    // review #193: unpairing closes it (Pair again only)
    sock().onclose?.({ code: 4403, reason: 'revoked' });
    await flush(6);
    expect(m.container.querySelector('[role="dialog"]')).toBeNull();
    expect(m.text()).toContain('This screen must be paired again');
  });
});
