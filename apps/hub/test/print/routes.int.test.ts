import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SendResult } from '../../src/print/transport/lan';
import { createUsbTransport } from '../../src/print/transport/usb';
import { createPrintWorker, type PrinterTransport } from '../../src/print/worker';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { FX, appendOrder, append as kdsAppend, fireLines, openDay } from '../kds/fixtures';
import { STATUS, fakeClock, fakeLanPrinter, fakeUsbDevice, type FakeLanPrinter } from './fixtures';

// 03c §6.4, §6.5, §3.10 (task c19): POST /admin/print/test (outside the FIFO, ≤ 8 s, status read-back incl. USB via the
// child, C3-1) and POST /admin/print/jobs/:job_id/cancel, through the real admin routes. Tests #27 (test half), #52.
// Real LAN fake printer on 127.0.0.1; USB devices are a plain file (writes land, nothing answers) and a pty driven by a
// small python relay that answers DLE EOT (a printer with status). No timing asserts.

let hub: TestHub;
let device: { deviceId: string; token: string };
let admin: { token: string };
let noDevices: { token: string };
const cleanups: Array<() => Promise<void> | void> = [];

beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
  const directory = await aDirectory();
  directory.staff.push({ ...directory.staff.find((s) => s.staff_id === 'S_MGR')!, staff_id: 'S_NODEV', display_name: 'No devices', denied_permissions: ['manage-devices'] });
  await seedDirectory(hub, directory);
  openDay(hub);
  device = pairDevice(hub, { type: 'tablet' });
  admin = openSession(hub, { kind: 'admin', staffId: 'S_MGR', deviceId: device.deviceId });
  noDevices = openSession(hub, { kind: 'admin', staffId: 'S_NODEV', deviceId: device.deviceId });
});
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
  swapBranchConfig(null);
  await hub.close();
});

const branch = (): string => hub.deps.config.provisioned!.branch_id;
function printer(printer_id: string, connection: 'lan' | 'usb', address: string, archived = false): void {
  kdsAppend(hub, [{ stream_type: 'hub', stream_id: branch(), event_type: 'PrinterSaved', payload: { printer_id, name: `Kitchen ${printer_id}`, connection, address, paper_width_mm: 80, archived } }], {
    actor: null,
  });
}
function output(printer_id: string): void {
  kdsAppend(hub, [{ stream_type: 'hub', stream_id: branch(), event_type: 'StationOutputSet', payload: { station_id: FX.station, mode: 'both', printer_id, show_taker: true, show_order_id: true } }], {
    actor: null,
  });
}
async function lan(status: number | null = STATUS.online): Promise<FakeLanPrinter> {
  const p = await fakeLanPrinter({ status });
  cleanups.push(() => p.close());
  return p;
}
async function post(url: string, payload: unknown, session = admin): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await hub.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${device.token}`, 'x-admin-session': session.token }, payload: payload as object });
  return { status: r.statusCode, body: r.json() as Record<string, unknown> };
}
const runtime = (printer_id: string) =>
  hub.deps.db.prepare('SELECT supports_status, last_status, last_clean_at, last_error FROM printer_runtime WHERE printer_id = ?').get(printer_id) as
    | { supports_status: number | null; last_status: string | null; last_clean_at: number | null; last_error: string | null }
    | undefined;
const errorOf = (body: Record<string, unknown>) => body.error as { code: string; details: Record<string, unknown> };

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

describe('[03c §6.4] POST /admin/print/test (c19)', () => {
  it('[03c #27] bypasses a stuck head: the head job stays in flight, the test prints on its own connection; clean → supports_status 1', async () => {
    const p = await lan();
    printer('PR1', 'lan', p.address);
    output('PR1');
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.naan, quantity: 2 }] });
    fireLines(hub, FX.station, ['A1']);
    const stuck: PrinterTransport = { send: () => new Promise<SendResult>(() => undefined), close: () => undefined };
    const w = createPrintWorker({ db: hub.deps.db, state: hub.deps.state, clock: hub.clock, timers: fakeClock(), transportFor: () => stuck });
    cleanups.push(() => w.stop());
    w.pass(); // the head is now in flight and never settles
    const head = () => hub.deps.db.prepare(`SELECT sent_at IS NOT NULL AS sent, acked_at, cancelled_at FROM print_jobs WHERE kind = 'kitchen'`).get();
    expect(head()).toEqual({ sent: 1, acked_at: null, cancelled_at: null });
    const r = await post('/admin/print/test', { printer_id: 'PR1' });
    expect(r).toEqual({ status: 200, body: { data: { printed: true, status: 'clean', error: null } } });
    expect(p.received().toString('latin1')).toContain('TEST PRINT');
    expect(head()).toEqual({ sent: 1, acked_at: null, cancelled_at: null });
    expect(runtime('PR1')).toMatchObject({ supports_status: 1, last_status: 'clean' });
    expect(hub.deps.db.prepare(`SELECT COUNT(*) FROM print_jobs WHERE kind = 'test'`).pluck().get()).toBe(0);
  });

  it('[03c #27] a clean test print triggers suspect recovery: one REPRINT per ticket with a live line', async () => {
    const p = await lan();
    printer('PR1', 'lan', p.address);
    output('PR1');
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.naan, quantity: 2 }] });
    fireLines(hub, FX.station, ['A1']);
    const at = hub.clock.branchNow();
    hub.deps.db.prepare(`UPDATE print_jobs SET sent_at = ?, sent_printer_id = 'PR1', acked_at = ?, suspect_at = ? WHERE kind = 'kitchen'`).run(at, at, at);
    const r = await post('/admin/print/test', { printer_id: 'PR1' });
    expect(r.body).toEqual({ data: { printed: true, status: 'clean', error: null } });
    const jobs = hub.deps.db.prepare('SELECT kind, is_reprint, suspect_resolved_at IS NOT NULL AS resolved FROM print_jobs ORDER BY created_at, job_id').all();
    expect(jobs).toEqual([
      { kind: 'kitchen', is_reprint: 0, resolved: 1 },
      { kind: 'reprint', is_reprint: 1, resolved: 0 },
    ]);
  });

  it('[03c §6.4, §3.7] paper end at the test → printed, status paper_out, printer_problem raised; no answer → unknown, supports_status 0', async () => {
    const out = await lan(STATUS.paperOut);
    printer('PR1', 'lan', out.address);
    expect((await post('/admin/print/test', { printer_id: 'PR1' })).body).toEqual({ data: { printed: true, status: 'paper_out', error: null } });
    expect(runtime('PR1')).toMatchObject({ supports_status: 1, last_status: 'paper_out' });
    expect(hub.deps.db.prepare(`SELECT COUNT(*) FROM alerts WHERE kind = 'printer_problem' AND state = 'open'`).pluck().get()).toBe(1);
    const mute = await lan(null);
    printer('PR2', 'lan', mute.address);
    expect((await post('/admin/print/test', { printer_id: 'PR2' })).body).toEqual({ data: { printed: true, status: 'unknown', error: null } });
    expect(runtime('PR2')).toMatchObject({ supports_status: 0, last_status: 'unknown' });
  });

  it('[03c §6.4] a LAN printer that refuses → printed false with the error; last_error kept', async () => {
    const p = await lan();
    const address = p.address;
    await p.close();
    printer('PR1', 'lan', address);
    const r = await post('/admin/print/test', { printer_id: 'PR1' });
    expect(r.body).toEqual({ data: { printed: false, status: 'unknown', error: 'connect_failed:ECONNREFUSED' } });
    expect(runtime('PR1')?.last_error).toBe('connect_failed:ECONNREFUSED');
  });

  it('[03c §3.7, C3-1] USB read-back through the child: a device that answers → status learned (supports_status 1)', { timeout: 20_000 }, async () => {
    const pty = await ptyPrinter(STATUS.online);
    printer('PU1', 'usb', pty.path);
    const r = await post('/admin/print/test', { printer_id: 'PU1' });
    expect(r.body).toEqual({ data: { printed: true, status: 'clean', error: null } });
    expect((await pty.received()).toString('latin1')).toContain('TEST PRINT');
    expect(runtime('PU1')).toMatchObject({ supports_status: 1, last_status: 'clean' });
  });

  it('[03c §3.7, C3-1] USB device with no status (nothing answers) → printed, unknown, supports_status 0; missing device → printed false', { timeout: 20_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pos-usbfile-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, 'lp0');
    writeFileSync(file, '');
    printer('PU1', 'usb', file);
    expect((await post('/admin/print/test', { printer_id: 'PU1' })).body).toEqual({ data: { printed: true, status: 'unknown', error: null } });
    expect(readFileSync(file).toString('latin1')).toContain('TEST PRINT');
    expect(runtime('PU1')).toMatchObject({ supports_status: 0 });
    printer('PU2', 'usb', join(dir, 'missing'));
    expect((await post('/admin/print/test', { printer_id: 'PU2' })).body).toEqual({ data: { printed: false, status: 'unknown', error: 'write_failed:ENOENT' } });
  });

  it('[03c §6.4, usblp one open] a USB printer whose worker child is printing → { printed: false, error: busy }; the device is not opened', { timeout: 20_000 }, async () => {
    const dev = fakeUsbDevice();
    cleanups.push(() => dev.close());
    const worker = createUsbTransport(dev.path, { timers: fakeClock() }); // the worker's child, stuck in a write
    cleanups.push(() => worker.close());
    const sending = worker.send(new Uint8Array(512 * 1024).fill(0x41));
    printer('PU1', 'usb', dev.path);
    expect((await post('/admin/print/test', { printer_id: 'PU1' })).body).toEqual({ data: { printed: false, status: 'unknown', error: 'busy' } });
    let sent = false;
    void sending.then(() => (sent = true));
    for (let i = 0; i < 300 && !sent; i += 1) {
      dev.drain();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(sent).toBe(true);
  });

  it('[03c §6.4, §3.10] unknown / archived printer → 404 PRINTER_NOT_FOUND; manage-devices required (403)', async () => {
    printer('PR1', 'lan', '192.168.1.50:9100', true);
    for (const id of ['PR1', 'NOPE']) {
      const r = await post('/admin/print/test', { printer_id: id });
      expect(r.status).toBe(404);
      expect(errorOf(r.body)).toMatchObject({ code: 'PRINTER_NOT_FOUND', details: { printer_id: id } });
    }
    const r = await post('/admin/print/test', { printer_id: 'PR1' }, noDevices);
    expect(r.status).toBe(403);
    expect(errorOf(r.body).code).toBe('PERMISSION_DENIED');
    expect((await post('/admin/print/test', {})).status).toBe(400);
  });
});

describe('[03c §6.5] POST /admin/print/jobs/:job_id/cancel (c19)', () => {
  it('[03c #52] unknown → 404 PRINT_JOB_NOT_FOUND; acked / cancelled → 409 PRINT_JOB_NOT_PENDING { state }; pending → cancelled', async () => {
    const ins = hub.deps.db.prepare(`INSERT INTO print_jobs (job_id, kind, printer_id, payload, created_at, acked_at, cancelled_at, sent_at) VALUES (?, 'document', 'PR1', '{}', 1, ?, ?, ?)`);
    ins.run('ACKED', 5, null, 4);
    ins.run('GONE', null, 5, null);
    ins.run('WAIT', null, null, null);
    ins.run('FLIGHT', null, null, 4);
    const missing = await post('/admin/print/jobs/NOPE/cancel', {});
    expect(missing.status).toBe(404);
    expect(errorOf(missing.body)).toMatchObject({ code: 'PRINT_JOB_NOT_FOUND', details: { job_id: 'NOPE' } });
    for (const [job_id, state] of [['ACKED', 'acked'], ['GONE', 'cancelled']] as const) {
      const r = await post(`/admin/print/jobs/${job_id}/cancel`, {});
      expect(r.status).toBe(409);
      expect(errorOf(r.body)).toMatchObject({ code: 'PRINT_JOB_NOT_PENDING', details: { job_id, state } });
    }
    for (const job_id of ['WAIT', 'FLIGHT']) {
      const r = await post(`/admin/print/jobs/${job_id}/cancel`, {});
      expect(r).toEqual({ status: 200, body: { data: { job_id, cancelled_at: hub.clock.branchNow() } } });
    }
    expect(hub.deps.db.prepare(`SELECT job_id, last_error FROM print_jobs WHERE cancelled_at = ? ORDER BY job_id`).all(hub.clock.branchNow())).toEqual([
      { job_id: 'FLIGHT', last_error: 'manager' },
      { job_id: 'WAIT', last_error: 'manager' },
    ]);
    const denied = await post('/admin/print/jobs/WAIT/cancel', {}, noDevices);
    expect(denied.status).toBe(403);
  });
});
