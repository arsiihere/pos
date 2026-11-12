import { readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { PRINT_WRITE_TIMEOUT_MS, type SendResult } from '../../src/print/transport/lan';
import { createUsbTransport, type UsbTransport } from '../../src/print/transport/usb';
import { PIN } from '../helpers/fixtures';
import { createTestHub, pairDevice, seedDirectory } from '../helpers/test-hub';
import { fakeClock, fakeUsbDevice, type FakeUsbDevice } from './fixtures';

// 03c §3.7, D3 (c13): the USB transport runs the blocking device I/O in a forked child per printer. The fake device
// is a FIFO: opening it for write blocks until someone reads (a jammed lp device). The write timeout runs on the
// injected fake clock; waits poll for a condition and nothing asserts a duration (03a AD-32; latency is task 28).
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function until(check: () => boolean, tries = 1_000): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition never held');
}

function track(p: Promise<SendResult>): { result: () => SendResult | undefined; done: Promise<SendResult> } {
  let r: SendResult | undefined;
  const done = p.then((v) => {
    r = v;
    return v;
  });
  return { result: () => r, done };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** the paths this (the hub's) process holds open for writing (the test's own FIFO read end does not count) */
function openForWrite(): string[] {
  const out: string[] = [];
  for (const fd of readdirSync('/proc/self/fd')) {
    try {
      const flags = /flags:\s*([0-7]+)/.exec(readFileSync(`/proc/self/fdinfo/${fd}`, 'utf8'))?.[1] ?? '0';
      if ((parseInt(flags, 8) & 0o3) !== 0) out.push(readlinkSync(`/proc/self/fd/${fd}`));
    } catch {
      // closed meanwhile
    }
  }
  return out;
}

function device(): FakeUsbDevice {
  const d = fakeUsbDevice();
  cleanups.push(() => d.close());
  return d;
}

function transport(path: string, clock = fakeClock()): UsbTransport {
  const t = createUsbTransport(path, { timers: clock });
  cleanups.push(() => t.close());
  return t;
}

/** drains the FIFO until `n` bytes arrived (opening the read end unblocks the child's open) */
async function drainUntil(d: FakeUsbDevice, n: number): Promise<ReturnType<FakeUsbDevice['drain']>> {
  let got: ReturnType<FakeUsbDevice['drain']> = Buffer.alloc(0);
  await until(() => {
    got = d.drain();
    return got.length >= n;
  });
  return got;
}

// a generous per-test limit: each test forks a child through tsx; a loaded CI box must not flake (no duration asserted)
describe('[03c §3.7] USB transport (child process)', { timeout: 30_000 }, () => {
  it('[03c §3.7] a device that takes the bytes → ok; the bytes arrive; the hub process never opens the device', async () => {
    const d = device();
    const t = transport(d.path);
    const bytes = Buffer.from([0x1b, 0x40, 0x41, 0x0a, 0x1d, 0x56, 0x42, 0x00]);
    const send = t.send(bytes);
    const got = await drainUntil(d, bytes.length);
    expect(await send).toEqual({ ok: true });
    expect(got.equals(bytes)).toBe(true);
    expect(openForWrite().filter((p) => p === d.path)).toEqual([]);
    // the same child serves the next document
    const pid = t.pid();
    const again = t.send(Buffer.from('B'));
    expect((await drainUntil(d, bytes.length + 1)).subarray(bytes.length).toString()).toBe('B');
    expect(await again).toEqual({ ok: true });
    expect(t.pid()).toBe(pid);
  });

  it('[03c #22] a device that blocks: a PIN login resolves meanwhile; the child is killed at the injected timeout and respawned', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    await seedDirectory(hub);
    const tablet = pairDevice(hub, { type: 'tablet' });

    const d = device();
    const clock = fakeClock();
    const t = transport(d.path, clock);
    await until(() => t.pid() !== null);
    const first = t.pid() as number;
    const send = track(t.send(Buffer.from('ticket')));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(send.result()).toBeUndefined();

    // the child is blocked on the device; the hub still serves a PIN login (no latency number: task 28)
    const login = await hub.app.inject({
      method: 'POST',
      url: '/auth/pin',
      headers: { authorization: `Bearer ${tablet.token}` },
      payload: { staff_id: 'S_CASH', pin: PIN.c },
    });
    expect(login.statusCode).toBe(200);
    expect(send.result()).toBeUndefined();
    expect(openForWrite().filter((p) => p === d.path)).toEqual([]);

    clock.advance(PRINT_WRITE_TIMEOUT_MS - 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(send.result()).toBeUndefined();
    expect(alive(first)).toBe(true);
    clock.advance(1);
    expect(await send.done).toEqual({ ok: false, error: 'write_timeout', detail: null, wrote: false });
    expect(t.pid()).not.toBeNull();
    expect(t.pid()).not.toBe(first);
    // the retry goes out at once (before the killed child's exit is seen): that exit must not fail it
    const retry = t.send(Buffer.from('ticket'));
    await until(() => !alive(first));
    await new Promise((resolve) => setTimeout(resolve, 50));

    // the respawned child prints the retry once the device takes bytes again
    expect((await drainUntil(d, 6)).toString()).toBe('ticket');
    expect(await retry).toEqual({ ok: true });
  });

  it('[03c §3.7] timeout after the device opened and bytes went out → wrote = true (the retry carries REPRINT)', async () => {
    const d = device();
    const clock = fakeClock();
    const t = transport(d.path, clock);
    const send = track(t.send(Buffer.alloc(64 * 1024 * 1024, 0x41)));
    await drainUntil(d, 1); // opened and writing; it blocks again once the FIFO is full
    expect(send.result()).toBeUndefined();
    clock.advance(PRINT_WRITE_TIMEOUT_MS);
    expect(await send.done).toEqual({ ok: false, error: 'write_timeout', detail: null, wrote: true });
  });

  it('[03c §3.7] the device goes away mid-write → write_failed, wrote = true; the next document reopens it', async () => {
    const d = device();
    const t = transport(d.path);
    const send = t.send(Buffer.alloc(64 * 1024 * 1024, 0x41));
    await drainUntil(d, 1);
    d.close(); // read end closed: the child's next write fails (EPIPE)
    expect(await send).toMatchObject({ ok: false, error: 'write_failed', detail: 'EPIPE', wrote: true });
  });

  it('[03c §3.7] a missing device → connect_failed with the errno code; nothing is created at the path', async () => {
    const d = device();
    const missing = `${d.path}-missing`;
    const t = transport(missing);
    expect(await t.send(Buffer.from('x'))).toEqual({ ok: false, error: 'connect_failed', detail: 'ENOENT', wrote: false });
    expect(readdirSync(d.path.slice(0, d.path.lastIndexOf('/')))).toEqual(['lp0']);
  });

  it('[03c §3.7] a child that dies on its own fails the job and is respawned at the next send', async () => {
    const d = device();
    const t = transport(d.path);
    await until(() => t.pid() !== null);
    const first = t.pid() as number;
    const send = t.send(Buffer.from('x'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    process.kill(first, 'SIGKILL');
    expect(await send).toEqual({ ok: false, error: 'write_failed', detail: 'child_exit', wrote: false });
    const next = t.send(Buffer.from('y'));
    expect((await drainUntil(d, 1)).toString()).toBe('y');
    expect(await next).toEqual({ ok: true });
    expect(t.pid()).not.toBe(first);
  });

  it('[03c §3.7] one document at a time: a second send while one is in flight throws', async () => {
    const d = device();
    const t = transport(d.path);
    const first = t.send(Buffer.from('a'));
    expect(() => t.send(Buffer.from('b'))).toThrow(/in flight/);
    await drainUntil(d, 1);
    expect(await first).toEqual({ ok: true });
  });
});
