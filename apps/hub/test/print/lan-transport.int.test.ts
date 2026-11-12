import { createServer, Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LAN_CLOSE_DEADLINE_MS,
  LAN_CONNECT_TIMEOUT_MS,
  PRINT_WRITE_TIMEOUT_MS,
  parseLanAddress,
  sendLan,
  type SendResult,
} from '../../src/print/transport/lan';
import { fakeClock, fakeLanPrinter, type FakeLanPrinter } from './fixtures';

// 03c §3.7 (c12): the LAN transport. Connect timeout 3 s, then a hard 10 s write timer from the first byte to the
// flush that progress never resets. Every timer runs on the injected fake clock; waits poll for a condition and
// nothing asserts a duration (03a AD-32).
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition never held');
}

/** a settled flag on a send, so a test can say "still pending" without waiting on it */
function track(p: Promise<SendResult>): { result: () => SendResult | undefined; done: Promise<SendResult> } {
  let r: SendResult | undefined;
  const done = p.then((v) => {
    r = v;
    return v;
  });
  return { result: () => r, done };
}

/** a few loop turns so socket events queued by the kernel are delivered */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 10));
}

async function printer(): Promise<FakeLanPrinter> {
  const p = await fakeLanPrinter();
  cleanups.push(() => p.close());
  return p;
}

// larger than every loopback send + receive buffer, so a printer that does not read really holds the write
const BIG = Buffer.alloc(64 * 1024 * 1024, 0x41);

describe('[03c §3.7] LAN transport', () => {
  it('[03c #20] written and flushed → ok; the printer got every byte; the socket is closed afterwards', async () => {
    const p = await printer();
    const clock = fakeClock();
    const bytes = Buffer.from([0x1b, 0x40, 0x41, 0x42, 0x0a, 0x1d, 0x56, 0x42, 0x00]);
    const result = await sendLan(p.address, bytes, { timers: clock });
    expect(result).toEqual({ ok: true });
    await until(() => p.receivedLength() === bytes.length);
    expect(p.received().equals(bytes)).toBe(true);
    await until(() => p.connections() === 0);
    await until(() => clock.pending() === 0); // the close deadline is cleared once the socket closes
  });

  it('[03c #20] a printer that talks back on connect and reads late still gets the whole document (no RST truncation)', async () => {
    const doc = Buffer.alloc(2 * 1024 * 1024, 0x42); // larger than the printer's receive buffer
    let received = 0;
    let closed = false;
    const server = createServer((s) => {
      s.on('error', () => undefined);
      s.write(Buffer.alloc(32, 0x12)); // status / ASB bytes the host never asked for
      s.pause();
      s.on('data', (d: Buffer) => (received += d.length));
      s.on('close', () => (closed = true));
      setTimeout(() => s.resume(), 200); // reads late
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const clock = fakeClock();
    expect(await sendLan(`127.0.0.1:${port}`, doc, { timers: clock })).toEqual({ ok: true });
    await until(() => closed);
    expect(received).toBe(doc.length);
    await until(() => clock.pending() === 0);
  });

  it('[03c §3.7] after the ack a printer that never closes its side is destroyed at the close deadline', async () => {
    const peers: Socket[] = [];
    const server = createServer({ allowHalfOpen: true }, (s) => {
      peers.push(s);
      s.on('error', () => undefined);
      s.resume(); // reads everything, never ends its side
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => {
      for (const s of peers) s.destroy();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const clock = fakeClock();
    const ours = new Socket();
    const result = sendLan('127.0.0.1:' + String(port), Buffer.from('ticket'), {
      timers: clock,
      socket: () => ours.connect(port, '127.0.0.1'),
    });
    expect(await result).toEqual({ ok: true });
    await settle();
    expect(ours.destroyed).toBe(false); // half-open: waiting for the printer
    expect(clock.pending()).toBe(1);
    clock.advance(LAN_CLOSE_DEADLINE_MS - 1);
    expect(ours.destroyed).toBe(false);
    clock.advance(1);
    expect(ours.destroyed).toBe(true);
    expect(clock.pending()).toBe(0);
  });

  it('[03c #21] a printer that stops reading: the job fails at the hard 10 s timer, not before; the socket is destroyed', async () => {
    const p = await printer();
    p.stall();
    const clock = fakeClock();
    const send = track(sendLan(p.address, BIG, { timers: clock }));
    await until(() => p.connections() === 1);
    await settle();
    expect(send.result()).toBeUndefined();
    clock.advance(LAN_CONNECT_TIMEOUT_MS); // the connect timer was cleared at connect
    await settle();
    expect(send.result()).toBeUndefined();
    clock.advance(PRINT_WRITE_TIMEOUT_MS - LAN_CONNECT_TIMEOUT_MS - 1);
    await settle();
    expect(send.result()).toBeUndefined();
    clock.advance(1);
    expect(await send.done).toEqual({ ok: false, error: 'write_timeout', detail: null, wrote: true });
    // destroyed: once the printer reads again it sees the connection end before the document does
    p.resume();
    await until(() => p.connections() === 0);
    expect(p.receivedLength()).toBeLessThan(BIG.length);
    expect(clock.pending()).toBe(0);
  });

  it('[03c #21] a printer that reads 1 byte a second: progress never resets the timer; fails at 10 s', async () => {
    const p = await printer();
    p.slowRead(1);
    const clock = fakeClock();
    const send = track(sendLan(p.address, BIG, { timers: clock }));
    await until(() => p.connections() === 1);
    await settle();
    let last = p.receivedLength();
    for (let s = 0; s < 9; s += 1) {
      await until(() => {
        p.tick();
        return p.receivedLength() > last;
      });
      last = p.receivedLength();
      clock.advance(1_000);
      await settle();
      expect(send.result()).toBeUndefined();
    }
    clock.advance(999);
    await settle();
    expect(send.result()).toBeUndefined();
    expect(p.receivedLength()).toBeGreaterThanOrEqual(9);
    clock.advance(1);
    expect(await send.done).toEqual({ ok: false, error: 'write_timeout', detail: null, wrote: true });
    p.resume();
    await until(() => p.connections() === 0);
    expect(p.receivedLength()).toBeLessThan(BIG.length);
  });

  it('[03c §3.7] connect never completes → connect_timeout at 3 s, nothing written', async () => {
    const clock = fakeClock();
    const never = new Socket(); // never connects
    cleanups.push(() => void never.destroy());
    const send = track(sendLan('127.0.0.1:9100', Buffer.from('x'), { timers: clock, socket: () => never }));
    await settle();
    clock.advance(LAN_CONNECT_TIMEOUT_MS - 1);
    await settle();
    expect(send.result()).toBeUndefined();
    clock.advance(1);
    expect(await send.done).toEqual({ ok: false, error: 'connect_timeout', detail: null, wrote: false });
    expect(never.destroyed).toBe(true);
    expect(clock.pending()).toBe(0);
  });

  it('[03c §3.7] connection refused → connect_failed with the errno code, nothing written, timers cleared', async () => {
    const free = createServer();
    await new Promise<void>((resolve) => free.listen(0, '127.0.0.1', resolve));
    const address = free.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    await new Promise<void>((resolve) => free.close(() => resolve()));
    const clock = fakeClock();
    const result = await sendLan(`127.0.0.1:${port}`, Buffer.from('x'), { timers: clock });
    expect(result).toEqual({ ok: false, error: 'connect_failed', detail: 'ECONNREFUSED', wrote: false });
    expect(clock.pending()).toBe(0);
  });

  it('[03c §3.7] the printer drops the connection mid-write → write_failed, wrote = true', async () => {
    const p = await printer();
    p.stall();
    const clock = fakeClock();
    const send = track(sendLan(p.address, BIG, { timers: clock }));
    await until(() => p.connections() === 1);
    await settle();
    await p.close();
    const result = await send.done;
    expect(result).toMatchObject({ ok: false, error: 'write_failed', wrote: true });
    expect(clock.pending()).toBe(0);
  });

  it('[03c §3.2] address host:port; port defaults to 9100; a port outside 1–65535 is rejected', () => {
    expect(parseLanAddress('192.168.1.50:9101')).toEqual({ host: '192.168.1.50', port: 9101 });
    expect(parseLanAddress('192.168.1.50')).toEqual({ host: '192.168.1.50', port: 9100 });
    for (const bad of ['192.168.1.50:0', '192.168.1.50:65536', '192.168.1.50:91a', '192.168.1.50:', '192.168.1.50:9.5']) {
      expect(() => parseLanAddress(bad)).toThrow(RangeError);
    }
  });

  it('[03c §3.7] a bad port never reaches connect → connect_failed, nothing written, no timer left', async () => {
    const clock = fakeClock();
    for (const bad of ['127.0.0.1:70000', '127.0.0.1:abc']) {
      expect(await sendLan(bad, Buffer.from('x'), { timers: clock })).toEqual({
        ok: false,
        error: 'connect_failed',
        detail: 'EINVAL',
        wrote: false,
      });
    }
    expect(clock.pending()).toBe(0);
  });
});
