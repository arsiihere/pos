import { fork, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PRINT_WRITE_TIMEOUT_MS, nodeTimers, type PrintTimers, type SendResult } from './lan.js';

// 03c §3.7, D3 (c13): the USB transport. One child process per USB printer (usb-child.ts, `child_process.fork`)
// does the blocking device I/O; the hub process never opens the device, so a jammed printer never touches the
// hub's event loop or libuv thread pool. The parent sends the bytes over IPC and waits ≤ 10 s (injected timers);
// on timeout it kills the child (SIGKILL), respawns it at once and takes the failure path. A child that dies on
// its own is respawned at the next send (no respawn loop). One document at a time: the worker's FIFO per printer
// (c14) never sends the next before this one settles.
// c19 (integrator ruling (b) on #72, C3-1; §3.7 "USB only if its test print proved status"): the same child also does the
// status reads, between jobs and never during a write (`status()` waits for the job in flight; a send waits for the
// read in flight). One process per device (D3): status.ts reaches the worker's transport through `usbStatus(path)`,
// which never forks a child of its own — no transport for that path → no answer.

const CHILD = fileURLToPath(new URL('./usb-child.ts', import.meta.url));
// the hub runs as `node --import tsx` (deploy/hub.service); the child loads the same loader by absolute URL, so it
// works from any cwd and under the test runner
const TSX = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

export interface UsbTransportOptions {
  timers?: PrintTimers;
  writeTimeoutMs?: number;
  /** test seam: every IPC message, in order (`out` = parent → child, `in` = child → parent) */
  trace?: (direction: 'out' | 'in', message: { type: string; id?: number }) => void;
}

/** The raw DLE EOT 1 / DLE EOT 4 answers (null = no answer). */
export interface UsbStatusAnswer {
  eot1: number | null;
  eot4: number | null;
}

/** §3.7 status timeout. */
export const USB_STATUS_TIMEOUT_MS = 2_000;

export interface UsbTransport {
  /** one document; never rejects (failures resolve `{ ok: false }`); throws if a send is already in flight */
  send(bytes: Uint8Array): Promise<SendResult>;
  /** one status read-back on the device, after the job in flight (never during a write); null on failure / timeout */
  status(): Promise<UsbStatusAnswer | null>;
  /** a job or a status read is in flight: the child may hold the device (usblp: one open) */
  busy(): boolean;
  /** the current child's pid (null before the first spawn completes or after close) */
  pid(): number | null;
  /** kills the child; the transport is unusable afterwards */
  close(): void;
}

type FromChild =
  | { type: 'ready' }
  | { type: 'writing'; id: number }
  | { type: 'done'; id: number; ok: true }
  | { type: 'done'; id: number; ok: false; code: string | null; opened: boolean; wrote: boolean }
  | { type: 'status'; id: number; eot1: number | null; eot4: number | null };

interface Child {
  proc: ChildProcess;
  ready: Promise<boolean>;
  alive: boolean;
}

interface InFlight {
  id: number;
  child: Child;
  writing: boolean;
  finish(result: SendResult): void;
  done: Promise<void>;
}

interface StatusRead {
  id: number;
  child: Child;
  finish(answer: UsbStatusAnswer | null): void;
  done: Promise<void>;
}

/** The worker's live USB transports by device path (status.ts reads through them; nothing else opens the device). */
const live = new Map<string, UsbTransport>();

/** The worker's child for `devicePath` is using the device now (c19's test print reports `busy` instead of opening it). */
export function usbBusy(devicePath: string): boolean {
  return live.get(devicePath)?.busy() ?? false;
}

/** §3.7 status read through the worker's own child for `devicePath`; no live transport → null (never a second open). */
export function usbStatus(devicePath: string): Promise<UsbStatusAnswer | null> {
  const t = live.get(devicePath);
  return t === undefined ? Promise.resolve(null) : t.status();
}

export function createUsbTransport(devicePath: string, o: UsbTransportOptions = {}): UsbTransport {
  const timers = o.timers ?? nodeTimers;
  const timeoutMs = o.writeTimeoutMs ?? PRINT_WRITE_TIMEOUT_MS;
  let child: Child | null = null;
  let current: InFlight | null = null;
  let reading: StatusRead | null = null;
  let sendWaiting = false;
  let nextId = 1;
  let closed = false;

  const spawn = (): Child => {
    const proc = fork(CHILD, [devicePath], {
      execArgv: ['--import', TSX],
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    let markReady: (ok: boolean) => void = () => undefined;
    const c: Child = { proc, alive: true, ready: new Promise<boolean>((resolve) => (markReady = resolve)) };
    proc.on('message', (m: FromChild) => {
      o.trace?.('in', m);
      if (m.type === 'ready') {
        markReady(true);
        return;
      }
      if (m.type === 'status') {
        if (reading !== null && m.id === reading.id) reading.finish({ eot1: m.eot1, eot4: m.eot4 });
        return;
      }
      if (current === null || m.id !== current.id) return;
      if (m.type === 'writing') {
        current.writing = true;
        return;
      }
      if (m.ok) current.finish({ ok: true });
      else current.finish({ ok: false, error: m.opened ? 'write_failed' : 'connect_failed', detail: m.code, wrote: m.wrote });
    });
    proc.on('error', () => undefined);
    proc.on('exit', () => {
      c.alive = false;
      markReady(false);
      if (child === c) child = null;
      // died on its own mid-job (a kill at timeout has already settled its job; a later job belongs to the respawn)
      if (current?.child === c) current.finish({ ok: false, error: 'write_failed', detail: 'child_exit', wrote: current.writing });
      if (reading?.child === c) reading.finish(null);
    });
    return c;
  };

  const kill = (c: Child): void => {
    c.alive = false;
    if (child === c) child = null;
    c.proc.kill('SIGKILL');
  };

  /** the job itself (c13): over IPC, ≤ timeoutMs, kill + respawn at timeout */
  const startSend = (bytes: Uint8Array): Promise<SendResult> => {
    const c = child !== null && child.alive ? child : (child = spawn());
    const id = nextId++;
    let markDone: () => void = () => undefined;
    const done = new Promise<void>((resolve) => (markDone = resolve));
    return new Promise<SendResult>((resolve) => {
      const job: InFlight = {
        id,
        child: c,
        writing: false,
        done,
        finish(result) {
          if (current !== job) return;
          current = null;
          timers.clearTimer(timer);
          resolve(result);
          markDone();
        },
      };
      current = job;
      const timer = timers.setTimer(() => {
        // `writing` comes from the child right after it opened the device (or found it open) and before the
        // first byte: opened ⇒ bytes may be out ⇒ the retry carries REPRINT (§3.7); still blocked in open ⇒ none
        const wrote = job.writing;
        job.finish({ ok: false, error: 'write_timeout', detail: null, wrote });
        kill(c);
        if (!closed) child = spawn();
      }, timeoutMs);
      void c.ready.then((ok) => {
        if (current !== job) return;
        if (!ok || !c.alive) {
          job.finish({ ok: false, error: 'write_failed', detail: 'child_exit', wrote: false });
          return;
        }
        o.trace?.('out', { type: 'job', id });
        c.proc.send({ type: 'job', id, bytes });
      });
    });
  };

  child = spawn();

  const transport: UsbTransport = {
    send(bytes) {
      if (closed) throw new Error('usb transport closed');
      if (current !== null || sendWaiting) throw new Error('usb transport: a send is already in flight');
      // a status read in flight finishes first: the child never interleaves a read with this write
      if (reading !== null) {
        sendWaiting = true;
        return reading.done.then(() => {
          sendWaiting = false;
          if (closed) return { ok: false, error: 'write_failed', detail: 'closed', wrote: false } as SendResult;
          return startSend(bytes);
        });
      }
      return startSend(bytes);
    },
    status() {
      if (closed) return Promise.resolve(null);
      if (reading !== null) return reading.done.then(() => null); // one read at a time; the caller reads again later
      // after the job in flight (never during a write)
      const after = current?.done ?? Promise.resolve();
      let finish: (a: UsbStatusAnswer | null) => void = () => undefined;
      let markDone: () => void = () => undefined;
      const result = new Promise<UsbStatusAnswer | null>((resolve) => (finish = resolve));
      const read: StatusRead = { id: 0, child: null as unknown as Child, finish: (a) => end(a), done: new Promise<void>((resolve) => (markDone = resolve)) };
      reading = read;
      void after.then(() => {
        if (reading !== read) return;
        if (closed) {
          end(null);
          return;
        }
        const c = child !== null && child.alive ? child : (child = spawn());
        read.id = nextId++;
        read.child = c;
        const timer = timers.setTimer(() => {
          end(null);
          kill(c);
          if (!closed) child = spawn();
        }, USB_STATUS_TIMEOUT_MS);
        read.finish = (a) => {
          timers.clearTimer(timer);
          end(a);
        };
        void c.ready.then((ok) => {
          if (reading !== read) return;
          if (!ok || !c.alive) {
            read.finish(null);
            return;
          }
          o.trace?.('out', { type: 'status', id: read.id });
          c.proc.send({ type: 'status', id: read.id });
        });
      });
      function end(a: UsbStatusAnswer | null): void {
        if (reading !== read) return;
        reading = null;
        finish(a);
        markDone();
      }
      return result;
    },
    busy: () => current !== null || reading !== null || sendWaiting,
    pid: () => child?.proc.pid ?? null,
    close() {
      closed = true;
      if (live.get(devicePath) === transport) live.delete(devicePath);
      if (child !== null) kill(child);
      current?.finish({ ok: false, error: 'write_failed', detail: 'closed', wrote: current.writing });
      reading?.finish(null);
    },
  };
  live.set(devicePath, transport);
  return transport;
}
