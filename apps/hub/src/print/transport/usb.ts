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

const CHILD = fileURLToPath(new URL('./usb-child.ts', import.meta.url));
// the hub runs as `node --import tsx` (deploy/hub.service); the child loads the same loader by absolute URL, so it
// works from any cwd and under the test runner
const TSX = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

export interface UsbTransportOptions {
  timers?: PrintTimers;
  writeTimeoutMs?: number;
}

export interface UsbTransport {
  /** one document; never rejects (failures resolve `{ ok: false }`); throws if a send is already in flight */
  send(bytes: Uint8Array): Promise<SendResult>;
  /** the current child's pid (null before the first spawn completes or after close) */
  pid(): number | null;
  /** kills the child; the transport is unusable afterwards */
  close(): void;
}

type FromChild =
  | { type: 'ready' }
  | { type: 'writing'; id: number }
  | { type: 'done'; id: number; ok: true }
  | { type: 'done'; id: number; ok: false; code: string | null; opened: boolean; wrote: boolean };

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
}

export function createUsbTransport(devicePath: string, o: UsbTransportOptions = {}): UsbTransport {
  const timers = o.timers ?? nodeTimers;
  const timeoutMs = o.writeTimeoutMs ?? PRINT_WRITE_TIMEOUT_MS;
  let child: Child | null = null;
  let current: InFlight | null = null;
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
      if (m.type === 'ready') {
        markReady(true);
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
    });
    return c;
  };

  const kill = (c: Child): void => {
    c.alive = false;
    if (child === c) child = null;
    c.proc.kill('SIGKILL');
  };

  child = spawn();

  return {
    send(bytes) {
      if (closed) throw new Error('usb transport closed');
      if (current !== null) throw new Error('usb transport: a send is already in flight');
      const c = child !== null && child.alive ? child : (child = spawn());
      const id = nextId++;
      return new Promise<SendResult>((resolve) => {
        const job: InFlight = {
          id,
          child: c,
          writing: false,
          finish(result) {
            if (current !== job) return;
            current = null;
            timers.clearTimer(timer);
            resolve(result);
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
          c.proc.send({ type: 'job', id, bytes });
        });
      });
    },
    pid: () => child?.proc.pid ?? null,
    close() {
      closed = true;
      if (child !== null) kill(child);
      current?.finish({ ok: false, error: 'write_failed', detail: 'closed', wrote: current.writing });
    },
  };
}
