// 03c shared test fixtures (phase 0 P0.12): a fake LAN printer (a real TCP socket on 127.0.0.1 with scripted status
// answers, stall and slow read), a fake blocking USB device (a FIFO nobody reads until drained) and a fake clock with
// timers (no timing asserts: transports and the worker take the clock, tests advance it). 03c §3.7, §10.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, openSync, readSync, closeSync, rmSync, constants } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export { FX, appendOrder, fixtureMenu, openDay, openSeating } from '../orders/fixtures';

const DLE = 0x10;
const EOT = 0x04;

/** ESC/POS real-time status answer bytes (DLE EOT n). `online` answers 0x12 to both n = 1 and n = 4. */
export const STATUS = {
  online: 0x12,
  /** DLE EOT 4: paper end sensor (bits 5 and 6) */
  paperOut: 0x72,
  /** DLE EOT 1: offline (bit 3) */
  offline: 0x1a,
} as const;

export interface FakeLanPrinter {
  host: string;
  port: number;
  /** `host:port`, as SavePrinter stores it */
  address: string;
  /** every byte received, status requests included */
  received(): Buffer;
  /** the answer to the next DLE EOT requests (one byte per request); `null` = no answer (a printer that never replies) */
  setStatus(byte: number | null): void;
  /** stop reading: the kernel buffers fill and a large write never drains (03c #21) */
  stall(): void;
  /** read again at full speed */
  resume(): void;
  /** read `bytes` per `tick()` call only (1 byte / s when the test ticks once per fake second) */
  slowRead(bytes: number): void;
  tick(): void;
  /** sockets currently open */
  connections(): number;
  close(): Promise<void>;
}

export async function fakeLanPrinter(o: { status?: number | null } = {}): Promise<FakeLanPrinter> {
  const chunks: Buffer[] = [];
  const sockets = new Set<Socket>();
  let status: number | null = o.status === undefined ? STATUS.online : o.status;
  let mode: { kind: 'full' } | { kind: 'stalled' } | { kind: 'slow'; bytes: number } = { kind: 'full' };

  const take = (socket: Socket, data: Buffer): void => {
    chunks.push(data);
    for (let i = 0; i + 1 < data.length; i += 1) {
      if (data[i] === DLE && data[i + 1] === EOT && status !== null) socket.write(Buffer.from([status]));
    }
  };
  const pull = (socket: Socket, max: number): void => {
    const data = socket.read(Math.min(max, socket.readableLength)) as Buffer | null;
    if (data !== null) take(socket, data);
  };

  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    socket.on('readable', () => {
      if (mode.kind !== 'full') return;
      let data: Buffer | null;
      while ((data = socket.read() as Buffer | null) !== null) take(socket, data);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    host: '127.0.0.1',
    port,
    address: `127.0.0.1:${port}`,
    received: () => Buffer.concat(chunks),
    setStatus(byte) {
      status = byte;
    },
    stall() {
      mode = { kind: 'stalled' };
      for (const s of sockets) s.pause();
    },
    resume() {
      mode = { kind: 'full' };
      for (const s of sockets) {
        s.resume();
        s.emit('readable');
      }
    },
    slowRead(bytes) {
      mode = { kind: 'slow', bytes };
      for (const s of sockets) s.pause();
    },
    tick() {
      if (mode.kind !== 'slow') return;
      for (const s of sockets) pull(s, mode.bytes);
    },
    connections: () => sockets.size,
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export interface FakeUsbDevice {
  /** the device path a usb printer stores (a FIFO): a write blocks until drain() opens the read end */
  path: string;
  /** opens the read end (non-blocking) and returns what has been written so far; call again for more */
  drain(): Buffer;
  close(): void;
}

/** A blocking USB device: `open(path, 'w')` and every write block until someone reads (03c #22, a jammed lp device). */
export function fakeUsbDevice(): FakeUsbDevice {
  const dir = mkdtempSync(join(tmpdir(), 'pos-usb-'));
  const path = join(dir, 'lp0');
  const made = spawnSync('mkfifo', [path]);
  if (made.status !== 0) throw new Error(`fakeUsbDevice: mkfifo failed: ${made.stderr.toString()}`);
  let fd: number | null = null;
  const chunks: Buffer[] = [];
  return {
    path,
    drain() {
      fd ??= openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
      const buffer = Buffer.alloc(65_536);
      for (;;) {
        let n: number;
        try {
          n = readSync(fd, buffer, 0, buffer.length, null);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EAGAIN') break;
          throw error;
        }
        if (n === 0) break;
        chunks.push(Buffer.from(buffer.subarray(0, n)));
      }
      return Buffer.concat(chunks);
    },
    close() {
      if (fd !== null) closeSync(fd);
      fd = null;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface FakeClock {
  now(): number;
  setTimer(fn: () => void, ms: number): number;
  clearTimer(id: number): void;
  /** moves time forward, firing every timer due by then in due order (ties: creation order) */
  advance(ms: number): void;
  pending(): number;
}

/** An injected clock with timers (03c §3.7: connect 3 s, hard write timer 10 s, status reads), advanced by the test. */
export function fakeClock(start = 1_761_000_000_000): FakeClock {
  let now = start;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimer(fn, ms) {
      const id = next++;
      timers.set(id, { at: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        let due: [number, { at: number; fn: () => void }] | undefined;
        for (const entry of timers) if (entry[1].at <= until && (due === undefined || entry[1].at < due[1].at)) due = entry;
        if (due === undefined) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = until;
    },
    pending: () => timers.size,
  };
}
