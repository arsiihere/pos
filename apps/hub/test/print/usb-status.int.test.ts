import { closeSync, constants, mkdtempSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPrintStatus } from '../../src/print/status';
import { createUsbTransport, usbStatus } from '../../src/print/transport/usb';
import { createPrintWorker } from '../../src/print/worker';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { FX, appendOrder, append as kdsAppend, fireLines, openDay } from '../kds/fixtures';
import { STATUS, fakeClock, fakeUsbDevice } from './fixtures';

// 03c §3.7, D3 (c19; integrator ruling (b) on #72, C3-1): a USB printer whose test print proved status
// (supports_status = 1) is read periodically through the worker's own USB child — one process per device, never a
// second open — and a read never interleaves with a job write. The answering device is a pty driven by a python3
// relay; the blocking device is the FIFO fake. Waits poll a condition; no timing asserts.

let hub: TestHub | undefined;
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
  swapBranchConfig(null);
  await hub?.close();
  hub = undefined;
});

async function until(check: () => boolean, tries = 1_000): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition never held');
}

/** This process's live usb-child processes (from /proc): one per device means no second open. */
function usbChildren(): number[] {
  const out: number[] = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^[0-9]+$/.test(entry)) continue;
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      if (ppid === process.pid && readFileSync(`/proc/${entry}/cmdline`, 'utf8').includes('usb-child')) out.push(Number(entry));
    } catch {
      // gone
    }
  }
  return out;
}

const DLE_EOT = (b: Buffer): number => {
  let n = 0;
  for (let i = 0; i + 1 < b.length; i += 1) if (b[i] === 0x10 && b[i + 1] === 0x04) n += 1;
  return n;
};

/** A pty whose master side answers every DLE EOT with `answer` and collects the rest (a USB printer with status). */
async function ptyPrinter(answer: number): Promise<{ path: string; received(): Promise<Buffer> }> {
  const dir = mkdtempSync(join(tmpdir(), 'pos-pty-'));
  const out = join(dir, 'out');
  writeFileSync(out, '');
  const script = `
import os, pty, sys, tty, select
m, s = pty.openpty()
tty.setraw(s)
print(os.ttyname(s), flush=True)
out = open(sys.argv[1], 'ab', buffering=0)
buf = b''
while True:
    r, _, _ = select.select([m, sys.stdin], [], [])
    if sys.stdin in r and not sys.stdin.buffer.read1(1):
        break
    if m in r:
        d = os.read(m, 4096)
        out.write(d)
        buf += d
        while b'\\x10\\x04' in buf:
            i = buf.index(b'\\x10\\x04')
            if len(buf) < i + 3:
                break
            os.write(m, bytes([${answer}]))
            buf = buf[i + 3:]
`;
  const proc: ChildProcess = spawn('python3', ['-c', script, out], { stdio: ['pipe', 'pipe', 'inherit'] });
  const path = await new Promise<string>((resolve) => proc.stdout!.once('data', (d: Buffer) => resolve(d.toString().trim())));
  cleanups.push(() => {
    proc.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    path,
    received: async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return readFileSync(out);
    },
  };
}

describe('[03c §3.7, C3-1] USB status reads through the worker\'s child (c19)', () => {
  it('[03c §3.7] a proven USB printer is read after its acks through the same child; no second open', { timeout: 30_000 }, async () => {
    hub = await createTestHub({ provisioned: true });
    openDay(hub);
    const pty = await ptyPrinter(STATUS.online);
    const branch = hub.deps.config.provisioned!.branch_id;
    kdsAppend(
      hub,
      [
        { stream_type: 'hub', stream_id: branch, event_type: 'PrinterSaved', payload: { printer_id: 'PU1', name: 'PU1', connection: 'usb', address: pty.path, paper_width_mm: 80, archived: false } },
        { stream_type: 'hub', stream_id: branch, event_type: 'StationOutputSet', payload: { station_id: FX.station, mode: 'both', printer_id: 'PU1', show_taker: true, show_order_id: true } },
      ],
      { actor: null },
    );
    hub.deps.db.prepare(`INSERT INTO printer_runtime (printer_id, supports_status) VALUES ('PU1', 1)`).run(); // proven at its test print
    const h = hub;
    const status = createPrintStatus({ db: h.deps.db, writer: h.deps.writer, clock: h.clock, branch_id: branch });
    const w = createPrintWorker({ db: h.deps.db, state: h.deps.state, clock: h.clock, timers: fakeClock(), hooks: status.hooks });
    cleanups.push(() => {
      w.stop();
      status.stop();
    });
    const runtime = () => h.deps.db.prepare(`SELECT last_status, last_status_at FROM printer_runtime WHERE printer_id = 'PU1'`).get() as { last_status: string | null; last_status_at: number | null };
    const acked = () => h.deps.db.prepare('SELECT COUNT(*) FROM print_jobs WHERE acked_at IS NOT NULL').pluck().get() as number;

    appendOrder(h, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.naan, quantity: 1 }] });
    fireLines(h, FX.station, ['A1']);
    w.pass();
    await until(() => acked() === 1);
    await until(() => runtime().last_status === 'clean'); // the pass after the ack read it
    const first = runtime().last_status_at;
    expect(DLE_EOT(await pty.received())).toBe(2); // DLE EOT 1 + 4, once
    await until(() => usbChildren().length === 1); // earlier tests' SIGKILLed children have exited
    expect(usbChildren()).toHaveLength(1);

    h.clock.advance(10_000); // ≤ 1 read per 10 s per printer
    appendOrder(h, { order_type: 'takeaway', lines: [{ order_item_id: 'B1', item_id: FX.naan, quantity: 1 }] });
    fireLines(h, FX.station, ['B1']);
    w.pass();
    await until(() => acked() === 2);
    await until(() => runtime().last_status_at !== first);
    expect(runtime().last_status).toBe('clean');
    expect(DLE_EOT(await pty.received())).toBe(4);
    expect(usbChildren()).toHaveLength(1); // the same child did both prints and both reads
  });

  it('[03c §3.7, D3] a read never interleaves with a job write (IPC order): status is sent only after the job\'s done, and a send waits for a read', { timeout: 30_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pos-usbfile-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, 'lp0'); // a plain file: writes land, nothing answers, nothing else reads it
    writeFileSync(file, '');
    const trace: string[] = [];
    const t = createUsbTransport(file, { timers: fakeClock(), trace: (dir, m) => m.type !== 'ready' && trace.push(`${dir}:${m.type}:${m.id}`) });
    cleanups.push(() => t.close());
    const sending = t.send(new Uint8Array(64 * 1024).fill(0x41));
    const reading = t.status(); // asked while the job is in flight
    expect(t.busy()).toBe(true);
    await Promise.all([sending, reading]);
    const reading2 = t.status(); // and a send asked while a read is in flight waits for it
    const sending2 = t.send(Uint8Array.of(0x42));
    await Promise.all([reading2, sending2]);
    expect(trace).toEqual([
      'out:job:1',
      'in:writing:1',
      'in:done:1',
      'out:status:2',
      'in:status:2',
      'out:status:3',
      'in:status:3',
      'out:job:4',
      'in:writing:4',
      'in:done:4',
    ]);
    expect(t.busy()).toBe(false);
  });

  it('[03c §3.7, usblp one open] the child never holds more than one descriptor on the device (job, then status read)', { timeout: 30_000 }, async () => {
    const dev = fakeUsbDevice(); // a FIFO: the job's write blocks until drained
    cleanups.push(() => dev.close());
    const t = createUsbTransport(dev.path, { timers: fakeClock() });
    cleanups.push(() => t.close());
    await until(() => t.pid() !== null);
    const pid = t.pid()!;
    let max = 0;
    const seen: number[] = [];
    const sample = setInterval(() => {
      let n = 0;
      try {
        for (const fd of readdirSync(`/proc/${pid}/fd`)) {
          try {
            if (readlinkSync(`/proc/${pid}/fd/${fd}`) === dev.path) n += 1;
          } catch {
            // closed meanwhile
          }
        }
      } catch {
        return;
      }
      seen.push(n);
      max = Math.max(max, n);
    }, 1);
    cleanups.push(() => clearInterval(sample));
    // our own read end, opened before the job and not read yet: the child's open succeeds and its write then blocks
    // with the job's descriptor open, so the sampler sees it whatever the machine's load
    const reader = openSync(dev.path, constants.O_RDONLY | constants.O_NONBLOCK);
    cleanups.push(() => closeSync(reader));
    const sending = t.send(new Uint8Array(512 * 1024).fill(0x41));
    const reading = t.status();
    await until(() => seen.includes(1));
    let sent = false;
    void sending.then(() => (sent = true));
    const chunk = Buffer.alloc(65_536);
    await until(() => {
      try {
        while (readSync(reader, chunk, 0, chunk.length, null) > 0);
      } catch {
        // EAGAIN: nothing more right now
      }
      return sent;
    }, 3_000);
    await reading;
    await until(() => seen.length > 0 && seen[seen.length - 1] === 0); // nothing held between jobs
    clearInterval(sample);
    expect(seen).toContain(1); // the job's (and the read's) one descriptor was seen
    expect(max).toBe(1);
  });

  it('[03c §3.7] a failed read is unknown: no live transport (never a second open), a missing device', { timeout: 30_000 }, async () => {
    await until(() => usbChildren().length === 0); // earlier tests' SIGKILLed children have exited
    expect(await usbStatus('/dev/pos-printer-none')).toBeNull();
    expect(usbChildren()).toHaveLength(0);
    const dir = mkdtempSync(join(tmpdir(), 'pos-usbgone-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const t = createUsbTransport(join(dir, 'lp0'), { timers: fakeClock() });
    cleanups.push(() => t.close());
    expect(await usbStatus(join(dir, 'lp0'))).toEqual({ eot1: null, eot4: null });
    t.close();
    expect(await usbStatus(join(dir, 'lp0'))).toBeNull(); // closed: unregistered
  });
});
