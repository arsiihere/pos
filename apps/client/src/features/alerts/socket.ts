import type { DeviceType } from '@pos/domain';
import { AlertsCatchUpPart, WsServerMessage, type WsClientMessage } from '@pos/events';
import type { AlertStore, IncomingRow, Timers } from './store';

// 01d §8.1, §3.7, §6 batch 3 (00 §6.21, H-1): the page's hub socket. Signed in, it is the staff-session socket
// (`auth` with `session_token`); with no session, the kiosk and phone pages open alert mode (`auth` with the
// device token only) and close it on sign-in. The tablet's page never opens alert mode (only the 9b background
// service does, else the two close each other with 4409 in a loop), and neither does the KDS page.
// Alert frames go to the store; one `receipt delivered` per (alert_id, step) shown. Browser WebSocket, no library.

/** §8.2 / §5.4: reconnect backoff, capped at 5 s */
export const BACKOFF_MS = [500, 1_000, 2_000, 4_000] as const;
export const MAX_BACKOFF_MS = 5_000;

/**
 * 00 §6.21 / §3.7: closes after which reconnecting cannot help; no reconnect. 4409 (controller ruling, review fix
 * round 1): another alert-mode socket opened for this device token. The hub sends `alerts_open` right after auth,
 * so reconnecting would let two pages replace each other every backoff step.
 */
const FINAL_CLOSES = new Set([4401, 4403, 4409, 4426]);
export const REPLACED_REASON = 'open on another tab/screen';

/** The part of the browser WebSocket this client uses (so a test can inject a fake). */
export interface SocketLike {
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

const OPEN = 1;

export type SocketMode = 'session' | 'alert' | 'none';

export interface AlertConnectionDeps {
  /** e.g. `ws://<hub>/ws` (the hub is plain HTTP on the LAN) */
  url: string;
  /** from the pairing store (`pos-device` / `device` key `device_type`) */
  deviceType: DeviceType;
  deviceToken: string;
  /** the staff or station session, when one is signed in */
  sessionToken?: string | null;
  store: AlertStore;
  timers: Timers;
  createSocket?: (url: string) => SocketLike;
  /** BF-5: the bound-tablet route deadline (`binding_route`, `alerts_open.binding_route_until`), for the header (task 42) */
  onBindingRoute?: (until: number | null) => void;
  /**
   * The socket closed for good and will not reconnect: 4401 (session ended or token rotated; the reason is the
   * hub's), 4403 (device revoked), 4409 (reason `REPLACED_REASON`), 4426 (client upgrade required).
   * Contract: on 4401 the caller signs the page out and calls `setSession(null)` (which opens alert mode on a kiosk
   * or phone); on 4409 it shows "open on another tab/screen" and calls `setSession` again only on a person's action
   * (e.g. a Reconnect tap); on 4403 / 4426 it shows the device's revoked / update page. Until then the page is
   * offline (`isUp()` false: the PIN pad stays disabled).
   */
  onEnded?: (code: number, reason: string) => void;
  /** `catch_up`, `event` and `error` frames, for the other features on this socket */
  onFrame?: (frame: WsServerMessage) => void;
}

export interface AlertConnection {
  /** sign-in (a token) or sign-out (null); reopens the socket in the matching mode */
  setSession(token: string | null): void;
  mode(): SocketMode;
  /** authenticated: the hub has sent its first frame (nothing is sent before auth succeeds, 00 §6.21) */
  isUp(): boolean;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export function hubSocketUrl(loc: { host: string } = location): string {
  return `ws://${loc.host}/ws`;
}

export function createAlertConnection(deps: AlertConnectionDeps): AlertConnection {
  const createSocket = deps.createSocket ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
  let session = deps.sessionToken ?? null;
  let socket: SocketLike | null = null;
  let up = false;
  let attempt = 0;
  let retry: unknown = null;
  let disposed = false;
  /** §6 batch 3: `alert_id:step` already receipted (in memory; the hub drops repeats too) */
  const receipted = new Set<string>();
  const listeners = new Set<() => void>();

  function modeFor(token: string | null): SocketMode {
    if (token !== null) return 'session';
    // §3.7 m13: only the hub-served kiosk and phone pages; never the tablet page, never the KDS page
    return deps.deviceType === 'cashier_kiosk' || deps.deviceType === 'phone' ? 'alert' : 'none';
  }

  function setUp(next: boolean): void {
    if (up === next) return;
    up = next;
    for (const fn of [...listeners]) fn();
  }

  function detach(s: SocketLike): void {
    s.onopen = null;
    s.onmessage = null;
    s.onclose = null;
    s.onerror = null;
  }

  function closeCurrent(): void {
    if (retry !== null) {
      deps.timers.clearTimeout(retry);
      retry = null;
    }
    if (socket !== null) {
      const s = socket;
      socket = null;
      detach(s);
      s.close(1000);
    }
    setUp(false);
  }

  function send(s: SocketLike, message: WsClientMessage): boolean {
    if (s.readyState !== OPEN) return false;
    s.send(JSON.stringify(message));
    return true;
  }

  function receipt(s: SocketLike, row: { alert_id: string; step: number }): void {
    const key = `${row.alert_id}:${row.step}`;
    if (receipted.has(key)) return;
    if (send(s, { type: 'receipt', alert_id: row.alert_id, kind: 'delivered', step: row.step })) receipted.add(key);
  }

  function onMessage(s: SocketLike, data: unknown): void {
    let raw: unknown;
    try {
      raw = JSON.parse(String(data));
    } catch {
      return;
    }
    const parsed = WsServerMessage.safeParse(raw);
    if (!parsed.success) return;
    const frame = parsed.data;
    attempt = 0; // authenticated: the backoff starts again from the first step
    setUp(true);
    switch (frame.type) {
      case 'alert':
        deps.store.onAlert(frame.alert);
        receipt(s, frame.alert);
        return;
      case 'alert_seen':
        deps.store.onSeen(frame.alert_id);
        return;
      case 'alert_closed':
        deps.store.onClosed(frame);
        return;
      case 'alerts_open':
        deps.store.onCatchUp(frame.alerts as IncomingRow[]);
        for (const row of frame.alerts) receipt(s, row);
        deps.onBindingRoute?.(frame.binding_route_until);
        return;
      case 'binding_route':
        deps.onBindingRoute?.(frame.until);
        return;
      case 'catch_up': {
        // H-7: the `alerts` part is the complete open set for this socket; a socket without the part keeps the rows
        const part = AlertsCatchUpPart.safeParse(frame.state.alerts);
        if (part.success) {
          deps.store.onCatchUp(part.data.alerts);
          for (const row of part.data.alerts) receipt(s, row);
        }
        deps.onFrame?.(frame);
        return;
      }
      default:
        deps.onFrame?.(frame);
    }
  }

  function scheduleReconnect(): void {
    const ms = attempt < BACKOFF_MS.length ? BACKOFF_MS[attempt]! : MAX_BACKOFF_MS;
    attempt += 1;
    retry = deps.timers.setTimeout(() => {
      retry = null;
      open();
    }, ms);
  }

  function open(): void {
    if (disposed) return;
    const mode = modeFor(session);
    if (mode === 'none') return;
    const token = session;
    const s = createSocket(deps.url);
    socket = s;
    s.onopen = () => {
      send(s, token === null ? { type: 'auth', device_token: deps.deviceToken } : { type: 'auth', device_token: deps.deviceToken, session_token: token });
    };
    s.onmessage = (ev) => onMessage(s, ev.data);
    s.onerror = () => {}; // the close event follows
    s.onclose = (ev) => {
      if (socket !== s) return;
      socket = null;
      detach(s);
      setUp(false);
      if (FINAL_CLOSES.has(ev.code)) {
        deps.onEnded?.(ev.code, ev.code === 4409 ? REPLACED_REASON : ev.reason);
        return;
      }
      scheduleReconnect(); // 1011, 1012, 4409, a dropped network: try again, ≤ 5 s apart
    };
  }

  open();

  return {
    setSession(token) {
      if (disposed || token === session) return;
      session = token;
      attempt = 0;
      closeCurrent();
      // §8.1 / G1-13e: any session change (in, out, or another person) drops the last person's rows (cards,
      // personal notices, seen) and the receipt set, so the new socket's receipts are recorded for the new person.
      // The store keeps its shown set, so a device-target alert heard here does not sound again.
      deps.store.reset();
      receipted.clear();
      open();
    },
    mode: () => (socket === null && retry === null ? 'none' : modeFor(session)),
    isUp: () => up,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      closeCurrent();
      listeners.clear();
    },
  };
}
