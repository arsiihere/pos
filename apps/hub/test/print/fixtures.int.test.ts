import { open } from 'node:fs/promises';
import { connect, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { STATUS, fakeClock, fakeLanPrinter, fakeUsbDevice, type FakeLanPrinter } from './fixtures';

// 03c phase 0 P0.12: the print fixtures do what they say. Waits poll for a condition; nothing asserts a duration.
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

async function client(p: FakeLanPrinter): Promise<{ socket: Socket; answers: number[] }> {
  const socket = connect(p.port, p.host);
  const answers: number[] = [];
  socket.on('data', (d: Buffer) => answers.push(...d));
  socket.on('error', () => undefined);
  await new Promise((resolve) => socket.once('connect', resolve));
  cleanups.push(() => void socket.destroy());
  return { socket, answers };
}

describe('[03c P0.12] fake LAN printer', () => {
  it('[03c P0.12] records the bytes and answers each DLE EOT with the scripted status; null = no answer', async () => {
    const p = await fakeLanPrinter();
    cleanups.push(() => p.close());
    expect(p.address).toBe(`127.0.0.1:${p.port}`);
    const { socket, answers } = await client(p);
    socket.write(Buffer.from([0x1b, 0x40, 0x41, 0x10, 0x04, 0x01]));
    await until(() => answers.length === 1);
    expect(answers).toEqual([STATUS.online]);
    expect([...p.received()]).toEqual([0x1b, 0x40, 0x41, 0x10, 0x04, 0x01]);
    p.setStatus(STATUS.paperOut);
    socket.write(Buffer.from([0x10, 0x04, 0x04]));
    await until(() => answers.length === 2);
    expect(answers[1]).toBe(STATUS.paperOut);
    p.setStatus(null);
    socket.write(Buffer.from([0x10, 0x04, 0x04, 0x42]));
    await until(() => p.received().length === 13);
    expect(answers).toHaveLength(2);
    expect(p.connections()).toBe(1);
  });

  it('[03c P0.12, #21] stall: a large write does not drain; resume lets it through', async () => {
    const p = await fakeLanPrinter();
    cleanups.push(() => p.close());
    const { socket } = await client(p);
    await until(() => p.connections() === 1);
    p.stall();
    // 16 MB: well above the loopback socket buffers (send + receive, a few MB with autotuning), small enough to move
    // fast once read again. The fake's byte counter is polled, never a concatenation of everything received.
    const big = Buffer.alloc(16 * 1024 * 1024, 0x41);
    socket.write(big);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(socket.writableLength).toBeGreaterThan(0);
    expect(p.receivedLength()).toBeLessThan(big.length);
    p.resume();
    await until(() => p.receivedLength() === big.length);
    expect(p.received().length).toBe(big.length);
  });

  it('[03c P0.12, #21] slowRead(1): one byte per tick', async () => {
    const p = await fakeLanPrinter();
    cleanups.push(() => p.close());
    const { socket } = await client(p);
    await until(() => p.connections() === 1);
    p.slowRead(1);
    socket.write(Buffer.from('abcdef'));
    await until(() => {
      p.tick();
      return p.received().length > 0;
    });
    const before = p.received().length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    p.tick();
    expect(p.received().length).toBe(before + 1);
    p.tick();
    expect(p.received().toString()).toBe('abcdef'.slice(0, before + 2));
  });
});

describe('[03c P0.12] fake blocking USB device', () => {
  it('[03c P0.12, #22] opening the device for write blocks until it is drained; drain returns the bytes', async () => {
    const usb = fakeUsbDevice();
    cleanups.push(() => usb.close());
    let opened = false;
    const pending = open(usb.path, 'w').then((h) => {
      opened = true;
      return h;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(opened).toBe(false);
    expect(usb.drain().length).toBe(0);
    const handle = await pending;
    cleanups.push(() => handle.close());
    await handle.write(Buffer.from('ticket'));
    expect(usb.drain().toString()).toBe('ticket');
  });
});

describe('[03c P0.12] fake clock', () => {
  it('[03c P0.12] timers fire in due order on advance; cleared timers never fire; now moves', () => {
    const c = fakeClock(1_000);
    const fired: string[] = [];
    c.setTimer(() => fired.push('b'), 10_000);
    const a = c.setTimer(() => fired.push('a'), 3_000);
    c.setTimer(() => fired.push('a2'), 3_000);
    c.setTimer(() => c.setTimer(() => fired.push('nested'), 1_000), 1_000);
    c.clearTimer(a);
    c.advance(2_999);
    expect(fired).toEqual(['nested']);
    expect(c.now()).toBe(3_999);
    c.advance(1);
    expect(fired).toEqual(['nested', 'a2']);
    c.advance(7_000);
    expect(fired).toEqual(['nested', 'a2', 'b']);
    expect(c.now()).toBe(11_000);
    expect(c.pending()).toBe(0);
  });
});
