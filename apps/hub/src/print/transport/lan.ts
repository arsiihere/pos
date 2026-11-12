import { Socket } from 'node:net';

// 03c §3.7 (c12): the LAN transport. One document per connection: connect (3 s), then one write with a HARD 10 s
// timer from the first byte to the flush. The timer is a plain timer that progress never resets (`socket.setTimeout`
// is an idle timer, and a printer reading 1 byte a second would never trip it); on expiry the socket is destroyed
// and the caller takes the failure path. Addresses are IPv4 literals (§3.2), so `connect` does no DNS lookup and
// nothing here runs on the libuv thread pool. Timers are injected (tests pass a fake clock).

export const LAN_CONNECT_TIMEOUT_MS = 3_000;
export const PRINT_WRITE_TIMEOUT_MS = 10_000;
export const LAN_DEFAULT_PORT = 9100;
/** after the ack, how long a printer may take to read the rest and close before the socket is destroyed */
export const LAN_CLOSE_DEADLINE_MS = 60_000;

/** Injected timers (03c §3.7: "timeouts are injected"); the print fixtures' fake clock fits this shape. */
export interface PrintTimers {
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(id: unknown): void;
}

export const nodeTimers: PrintTimers = {
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (id) => clearTimeout(id as NodeJS.Timeout),
};

export type SendError = 'connect_timeout' | 'connect_failed' | 'write_timeout' | 'write_failed';

/**
 * `ok` = the whole document was written and flushed within the timeout (the ack, D4). On failure, `wrote` says
 * whether any byte may have gone out (the worker sets `is_reprint = 1`, §3.7); `detail` is the errno code, if any.
 */
export type SendResult = { ok: true } | { ok: false; error: SendError; detail: string | null; wrote: boolean };

export interface LanSendOptions {
  timers?: PrintTimers;
  connectTimeoutMs?: number;
  writeTimeoutMs?: number;
  /** test seam: a socket sendLan does not connect itself (one that never connects proves the connect timeout) */
  socket?: () => Socket;
}

/** `host:port` as SavePrinter stores it (§3.2); a bare host means port 9100. A port outside 1–65535 throws. */
export function parseLanAddress(address: string): { host: string; port: number } {
  const i = address.lastIndexOf(':');
  if (i < 0) return { host: address, port: LAN_DEFAULT_PORT };
  const raw = address.slice(i + 1);
  const port = /^[0-9]{1,5}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw Object.assign(new RangeError(`invalid printer port`), { code: 'EINVAL' });
  }
  return { host: address.slice(0, i), port };
}

/** Sends one document to a LAN printer. Never rejects: every failure resolves as `{ ok: false }`. */
export function sendLan(address: string, bytes: Uint8Array, o: LanSendOptions = {}): Promise<SendResult> {
  const timers = o.timers ?? nodeTimers;
  const socket = o.socket?.() ?? new Socket();
  return new Promise<SendResult>((resolve) => {
    let settled = false;
    let wrote = false;
    let timer: unknown = null;
    const stopTimer = (): void => {
      if (timer !== null) timers.clearTimer(timer);
      timer = null;
    };
    const finish = (result: SendResult): void => {
      if (settled) return;
      settled = true;
      stopTimer();
      resolve(result);
    };
    const fail = (error: SendError, detail: string | null): void => {
      finish({ ok: false, error, detail, wrote });
      socket.destroy();
    };

    // errors after the result (a late RST, the destroy) are expected and ignored
    socket.on('error', (err: NodeJS.ErrnoException) => {
      fail(wrote ? 'write_failed' : 'connect_failed', err.code ?? null);
    });
    let closeDeadline: unknown = null;
    socket.on('close', () => {
      if (closeDeadline !== null) timers.clearTimer(closeDeadline);
      closeDeadline = null;
      fail(wrote ? 'write_failed' : 'connect_failed', 'closed');
    });

    timer = timers.setTimer(() => {
      timer = null;
      fail('connect_timeout', null);
    }, o.connectTimeoutMs ?? LAN_CONNECT_TIMEOUT_MS);

    socket.once('connect', () => {
      if (settled) return;
      stopTimer();
      // read and discard whatever the printer sends (status bytes, ASB): unread received data makes the kernel
      // answer our close with an RST, which drops the part of the document still in the send buffer
      socket.resume();
      timer = timers.setTimer(() => {
        timer = null;
        fail('write_timeout', null);
      }, o.writeTimeoutMs ?? PRINT_WRITE_TIMEOUT_MS);
      wrote = true;
      socket.write(bytes, (err) => {
        if (err) {
          fail('write_failed', (err as NodeJS.ErrnoException).code ?? null);
          return;
        }
        finish({ ok: true });
        // a graceful FIN: the kernel delivers the rest of the document as the printer reads it. A printer that
        // never closes its side is destroyed at the deadline, so no half-open socket stays behind
        socket.end();
        closeDeadline = timers.setTimer(() => {
          closeDeadline = null;
          socket.destroy();
        }, LAN_CLOSE_DEADLINE_MS);
      });
    });

    if (o.socket === undefined) {
      try {
        const { host, port } = parseLanAddress(address);
        socket.connect({ host, port });
      } catch (err) {
        fail('connect_failed', (err as NodeJS.ErrnoException).code ?? null);
      }
    }
  });
}
