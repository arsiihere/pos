import 'fake-indexeddb/auto';
import type { LineDetail } from '@pos/domain';
import type { KdsStationBody } from '@pos/events';
import { act, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDeviceKey } from '../../api/hub-admin';
import { createHubClock } from '../../app/hub-clock';
import { flush, mount, reply, type Mounted } from '../../../test/dom';
import type { SocketLike } from '../alerts/socket';
import { fakeTimers, recordingSink, type FakeTimers } from '../alerts/test-fakes';
import { KdsApp } from './KdsApp';
import type { KdsPage } from './session';
import { registerLineAction } from './slots';

// 03b v1.0.8 §8 (Q-42), §3.3, #72; 00 v1.9.2 §8.2, §8.4, M53 (K1): the /kds/ shell — station session, the device-key
// rules, the socket states. The pairing store is a real (fake-indexeddb) `pos-device`, so wipes and keeps are proven.

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
    act(() => this.onopen?.({}));
  }
  frame(obj: unknown): void {
    this.readyState = 1;
    act(() => this.onmessage?.({ data: JSON.stringify(obj) }));
  }
  drop(code: number, reason = ''): void {
    this.readyState = 3;
    act(() => this.onclose?.({ code, reason }));
  }
}

const ST = 'ST-TANDOOR';
const PAGE: KdsPage = {
  meta: { tenantId: 'TEN-1', branchId: 'BR-1', branchName: 'Gulberg', hubNowMs: 1_000_000, utcOffsetMs: 0 },
  clock: createHubClock({ now_ms: 1_000_000, utc_offset_ms: 0 }, () => 0),
};

function detail(id: string): LineDetail {
  return {
    order_item_id: id,
    order_id: `O-${id}`,
    station_id: ST,
    point_id: 'P1',
    identifier: { kind: 'table', label: `T-${id}` },
    order_type: 'dine_in',
    item_name: 'Naan',
    units: 2,
    line_kind: 'item',
    for_parent: null,
    deal_name: null,
    options: [],
    kitchen_note: null,
    order_note: null,
    return_of: null,
    cook_ms: 120_000,
    prep_ms: 0,
    from_stock: false,
    placed_by_name: null,
  };
}

function catchUp(ids: string[]) {
  const body: KdsStationBody = {
    station_id: ST,
    day_open: true,
    sound_volume: 70,
    has_printer: true,
    lanes: { lanes_on: 1, lane_count: 1 },
    now: ids.map((id) => ({ ...detail(id), stage: 'cooking', fired_at: 900_000, started_at: 950_000, mark: null, done_undone: false })),
    details: [],
  };
  return { type: 'catch_up', as_of_seq: 3, state: { kds_station: body } };
}

function putDeviceKeys(keys: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pos-device', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('device');
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('device', 'readwrite');
      for (const [k, v] of Object.entries(keys)) tx.objectStore('device').put(v, k);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

const PAIRED = { token: 'DEV-KDS', device_id: 'D-K1', device_type: 'kds' };
const SESSION = (n = 1) => reply(200, { data: { session_token: `SS-${n}`, session_id: `SID-${n}`, station_id: ST } });
const ERR = (status: number, code: string) => reply(status, { error: { code, message: 'x' } });

let m: Mounted;
let sockets: FakeSocket[];
let timers: FakeTimers;
let goes: string[];
beforeEach(async () => {
  sockets = [];
  goes = [];
  timers = fakeTimers();
  await putDeviceKeys(PAIRED);
});
afterEach(async () => {
  m?.unmount();
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase('pos-device');
    r.onsuccess = () => resolve();
    r.onerror = () => resolve();
  });
});

/** replies to POST /auth/station in order (the last one repeats) */
function start(replies: Array<() => Response | Promise<Response>>, o: { page?: KdsPage | null; strict?: boolean } = {}) {
  const queue = [...replies];
  const fetch = vi.fn(async (url: string) => {
    expect(url).toBe('/auth/station');
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    return next();
  });
  m = mount();
  const app = (
    <KdsApp
      page={o.page === undefined ? PAGE : o.page}
      fetch={fetch}
      timers={timers}
      sink={recordingSink(timers)}
      createSocket={() => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      }}
      go={(p) => goes.push(p)}
    />
  );
  m.render(o.strict === true ? <StrictMode>{app}</StrictMode> : app);
  return fetch;
}

async function settle(): Promise<void> {
  await flush(12);
}

describe('[00 §8.4] device keys', () => {
  it('[00 §8.4] 401 DEVICE_TOKEN_INVALID, 403 DEVICE_REVOKED and WS 4403 wipe the device keys → /pair; 403 DEVICE_TYPE_NOT_ALLOWED keeps them and shows "This device isn\'t a kitchen screen" with a /staff/ link', async () => {
    // 401 on /auth/station
    start([() => ERR(401, 'DEVICE_TOKEN_INVALID')]);
    await settle();
    expect(await readDeviceKey('token')).toBeNull();
    expect(await readDeviceKey('device_id')).toBeNull();
    expect(await readDeviceKey('device_type')).toBeNull();
    expect(m.text()).toContain('This screen must be paired again');
    m.click(m.button('Show pairing code'));
    expect(goes).toEqual(['/pair']);
    m.unmount();

    // 403 DEVICE_REVOKED on /auth/station
    await putDeviceKeys(PAIRED);
    start([() => ERR(403, 'DEVICE_REVOKED')]);
    await settle();
    expect(await readDeviceKey('token')).toBeNull();
    expect(m.text()).toContain('This screen must be paired again');
    m.unmount();

    // revoked kds token while live: DeviceRevoked on the socket, then WS close 4403 → wipe → /pair (00 §6.14)
    await putDeviceKeys(PAIRED);
    goes = [];
    const live = start([() => SESSION()]);
    await settle();
    sockets[0]!.frame(catchUp(['A']));
    sockets[0]!.frame({ type: 'event', seq: 9, event: { event_id: 'E9', event_type: 'DeviceRevoked', schema_version: 1, payload: { device_id: 'D-K1' } } });
    sockets[0]!.drop(4403);
    await settle();
    expect(await readDeviceKey('token')).toBeNull();
    expect(await readDeviceKey('device_type')).toBeNull();
    expect(m.text()).toContain('This screen must be paired again');
    m.click(m.button('Show pairing code'));
    expect(goes).toEqual(['/pair']);
    timers.advance(10_000);
    expect(sockets).toHaveLength(1); // no reconnect
    expect(live).toHaveBeenCalledTimes(1);
    m.unmount();

    // 403 DEVICE_TYPE_NOT_ALLOWED: the keys stay
    await putDeviceKeys({ ...PAIRED, device_type: 'tablet' });
    sockets = [];
    start([() => ERR(403, 'DEVICE_TYPE_NOT_ALLOWED')]);
    await settle();
    expect(await readDeviceKey('token')).toBe('DEV-KDS');
    expect(await readDeviceKey('device_id')).toBe('D-K1');
    expect(m.text()).toContain("This device isn't a kitchen screen");
    const link = m.container.querySelector<HTMLAnchorElement>('a[href="/staff/"]');
    expect(link?.textContent).toContain('Open the staff screen');
    expect(sockets).toHaveLength(0);
  });

  it('[00 §8.4] a network failure on /auth/station keeps the stored kds token; the call is tried again and the screen opens', async () => {
    const fetch = start([() => Promise.reject(new TypeError('Failed to fetch')), () => ERR(500, 'INTERNAL_ERROR'), () => SESSION()]);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await readDeviceKey('token')).toBe('DEV-KDS');
    expect(await readDeviceKey('device_type')).toBe('kds');
    expect(m.text()).toContain("Can't reach the hub — retrying…");
    expect(sockets).toHaveLength(0);
    timers.advance(500);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await readDeviceKey('token')).toBe('DEV-KDS');
    expect(m.text()).toContain("Can't reach the hub — retrying…"); // a 5xx is the same
    timers.advance(1_000);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sockets).toHaveLength(1);
    sockets[0]!.open();
    expect(sockets[0]!.sent[0]).toEqual({ type: 'auth', device_token: 'DEV-KDS', session_token: 'SS-1' });
  });

  it('[00 §8.4] WS 4403 without DeviceRevoked (guest network before auth) keeps the keys: /auth/station answers GUEST_NETWORK_FORBIDDEN → "Connect to the staff Wi-Fi", tried again until it opens', async () => {
    const fetch = start([() => SESSION(1), () => ERR(403, 'GUEST_NETWORK_FORBIDDEN'), () => SESSION(2)]);
    await settle();
    sockets[0]!.frame(catchUp(['A']));
    sockets[0]!.drop(4403);
    await settle();
    // re-sign-in through the same backoff (never at once, never a loop)
    expect(fetch).toHaveBeenCalledTimes(1);
    timers.advance(500);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await readDeviceKey('token')).toBe('DEV-KDS');
    expect(await readDeviceKey('device_id')).toBe('D-K1');
    expect(await readDeviceKey('device_type')).toBe('kds');
    expect(m.text()).toContain('Connect to the staff Wi-Fi');
    expect(m.text()).not.toContain('paired again');
    timers.advance(1_000);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sockets).toHaveLength(2);
  });

  it('[00 §8.4] /auth/station codes: 426 update, HOST_NOT_ALLOWED, HUB_NOT_PROVISIONED (opens by itself), another 4xx its errors.<code> with Try again; the keys stay', async () => {
    let fetch = start([() => ERR(426, 'CLIENT_UPGRADE_REQUIRED')]);
    await settle();
    expect(m.text()).toContain('Update the app');
    m.button('Reload');
    timers.advance(10_000);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    m.unmount();

    fetch = start([() => ERR(403, 'HOST_NOT_ALLOWED')]);
    await settle();
    expect(m.text()).toContain('Open the hub by its address');
    timers.advance(10_000);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    m.unmount();

    fetch = start([() => ERR(409, 'HUB_NOT_PROVISIONED'), () => SESSION()]);
    await settle();
    expect(m.text()).toContain('The hub is being set up');
    timers.advance(500);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(1);
    m.unmount();

    fetch = start([() => ERR(400, 'VALIDATION_FAILED'), () => SESSION(2)]);
    await settle();
    expect(m.text()).not.toContain("Can't reach the hub");
    expect(m.text()).toContain('Try again');
    timers.advance(10_000);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    m.click(m.button('Try again'));
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(2);
    expect(await readDeviceKey('token')).toBe('DEV-KDS');
  });

  it('[00 §8.4] SERVICE_UNAVAILABLE retries once after retry_after_ms, then "Hub busy, try again"', async () => {
    const busy = () => reply(503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'x', details: { retry_after_ms: 1_500 } } });
    const fetch = start([busy, busy, () => SESSION()]);
    await settle();
    expect(m.text()).not.toContain('Hub busy');
    timers.advance(1_499);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    timers.advance(1);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(m.text()).toContain('Hub busy, try again.');
    timers.advance(60_000);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    m.click(m.button('Try again'));
    await settle();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sockets).toHaveLength(1);
  });

  it('[00 §8.4] the pairing store cannot be read → nothing wiped, read again after the backoff', async () => {
    let reads = 0;
    const readKey = vi.fn(async (key: string) => {
      reads += 1;
      if (reads === 1) throw new Error('IDB broken');
      return readDeviceKey(key);
    });
    const fetch = vi.fn(async () => SESSION());
    m = mount();
    m.render(<KdsApp page={PAGE} fetch={fetch} timers={timers} sink={recordingSink(timers)} readKey={readKey} createSocket={() => new FakeSocket()} />);
    await settle();
    expect(fetch).not.toHaveBeenCalled();
    timers.advance(500);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await readDeviceKey('token')).toBe('DEV-KDS');
  });

  it('[03b §8] page meta missing with a stored token → a reload message, never "pair again" (/pair would send it straight back)', async () => {
    const fetch = start([() => SESSION()], { page: null });
    await settle();
    expect(fetch).not.toHaveBeenCalled();
    expect(m.text()).toContain("This page didn't load right");
    expect(m.text()).not.toContain('paired again');
    expect(await readDeviceKey('token')).toBe('DEV-KDS');
  });

  it('[00 §8.4] no stored token → pair again, nothing sent', async () => {
    await new Promise<void>((resolve) => {
      const r = indexedDB.deleteDatabase('pos-device');
      r.onsuccess = () => resolve();
    });
    const fetch = start([() => SESSION()]);
    await settle();
    expect(fetch).not.toHaveBeenCalled();
    expect(m.text()).toContain('This screen must be paired again');
  });
});

describe('[03b §8] station socket', () => {
  it('[03b §8] WS close 4401 with REPLACED_REASON → "Open in another window", no reconnect loop (M53)', async () => {
    // 00 §6.11: the hub closes a replaced station socket 4401 with close reason `replaced`
    const fetch = start([() => SESSION(1), () => SESSION(2)]);
    await settle();
    sockets[0]!.frame(catchUp(['A']));
    sockets[0]!.drop(4401, 'replaced');
    await settle();
    expect(m.text()).toContain('This screen is open in another window');
    timers.advance(60_000);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1); // no /auth/station of its own
    expect(sockets).toHaveLength(1); // no reconnect
    m.click(m.button('Use this window'));
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(2);
    sockets[1]!.open();
    expect(sockets[1]!.sent[0]).toEqual({ type: 'auth', device_token: 'DEV-KDS', session_token: 'SS-2' });
  });

  it('[00 §8.4] another 4401 (the session ended) → a new station session after the backoff; repeated closes never loop', async () => {
    const fetch = start([() => SESSION(1), () => SESSION(2), () => SESSION(3), () => SESSION(4)]);
    await settle();
    sockets[0]!.frame(catchUp(['A']));
    sockets[0]!.drop(4401, 'logout');
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    timers.advance(500);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(2);
    // the new socket closes 4401 before it ever came up: the next try waits longer (1 s), then 2 s
    sockets[1]!.drop(4401, '');
    await settle();
    timers.advance(999);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    timers.advance(1);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(3);
    sockets[2]!.drop(4401, '');
    await settle();
    timers.advance(1_999);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(3);
    timers.advance(1);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('[03b §8] StrictMode: one POST /auth/station and one socket auth', async () => {
    const fetch = start([() => SESSION(1), () => SESSION(2)], { strict: true });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    for (const s of sockets) if (s.onopen !== null) s.open();
    const auths = sockets.flatMap((s) => s.sent.filter((f) => f['type'] === 'auth'));
    expect(auths).toEqual([{ type: 'auth', device_token: 'DEV-KDS', session_token: 'SS-1' }]);
  });

  it('[03b #72] socket down → Reconnecting banner, every tap disabled, rows stay', async () => {
    const off = registerLineAction((_l, ctx) => (ctx.has_printer ? { key: 'reprint', label: 'Reprint', run: async () => {} } : null));
    try {
      start([() => SESSION()]);
      await settle();
      // 03b-F02: the skeleton until the first catch-up
      expect(m.container.querySelectorAll('.kl.s-ph')).toHaveLength(3);
      sockets[0]!.frame(catchUp(['A', 'B']));
      expect(m.text()).toContain('Live');
      expect(m.text()).toContain('T-A');
      expect(m.text()).toContain('T-B');
      expect(m.buttons().filter((b) => b.textContent === 'Reprint').every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);

      sockets[0]!.drop(1006);
      expect(m.text()).toContain('Reconnecting… buttons are off until the hub is back');
      expect(m.text()).toContain('T-A');
      expect(m.text()).toContain('T-B');
      const buttons = m.container.querySelectorAll<HTMLButtonElement>('main button');
      expect(buttons.length).toBe(2);
      for (const b of buttons) expect(b.disabled).toBe(true);
      expect(m.container.querySelectorAll('.kl.s-off')).toHaveLength(2);

      // it comes back by itself; the catch-up replaces the rows
      timers.advance(500);
      expect(sockets).toHaveLength(2);
      sockets[1]!.frame(catchUp(['B']));
      expect(m.text()).not.toContain('Reconnecting…');
      expect(m.text()).not.toContain('T-A');
      for (const b of m.container.querySelectorAll<HTMLButtonElement>('main button')) expect(b.disabled).toBe(false);
    } finally {
      off();
    }
  });
});
