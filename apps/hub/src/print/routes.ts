import { DomainError, type Doc } from '@pos/domain';
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { currentDirectory } from '../auth/guards.js';
import type { HubDeps } from '../server.js';
import { encodeDoc } from './escpos.js';
import { clock12 } from './render/jobs.js';
import { createPrintStatus, parseStatus, readLanStatus, recoverSuspects, type PrinterStatus, type PrintStatus } from './status.js';
import { nodeTimers, sendLan, type PrintTimers } from './transport/lan.js';
import { usbBusy } from './transport/usb.js';
import { hubTime } from '../lib/hub-time.js';

// 03c §6.4, §6.5, §3.10 (task c19): the hub admin print routes (admin session; `manage-devices` checked in the handler).
// - POST /admin/print/test { printer_id } — outside the FIFO (its own LAN connection / its own USB child, never the
//   worker's queue, so a stuck head never delays it), ≤ 8 s: LAN connect 3 s + write 3 s + status 2 s; USB one child
//   for the print and the status read-back (usb-child.ts `status`, C3-1), killed at the 8 s deadline; while the worker's
//   own child is using the device (usblp allows one open) the answer is `{ printed: false, error: 'busy' }`. Answer
//   `{ printed, status, error }`. The reading goes through c15's applyStatus (printer_runtime, suspect marking, a bad
//   reading raises printer_problem); `supports_status` is learned (1 on an answer, 0 when it printed and nothing
//   answered); a test that printed with a clean or unknown status triggers suspect recovery (§3.5).
//   Errors: 404 PRINTER_NOT_FOUND (unknown or archived).
// - POST /admin/print/jobs/:job_id/cancel — a pending job (sent or not) → cancelled now (`last_error 'manager'`);
//   404 PRINT_JOB_NOT_FOUND { job_id }, 409 PRINT_JOB_NOT_PENDING { job_id, state: 'acked' | 'cancelled' }. A job in
//   flight is not interrupted: the worker's guarded ack leaves it cancelled. 1 statement (+1 to name the error).

export const TEST_PRINT_DEADLINE_MS = 8_000;
const LAN_TEST = { connectTimeoutMs: 3_000, writeTimeoutMs: 3_000, statusTimeoutMs: 2_000 } as const;

export interface TestPrintResult {
  printed: boolean;
  status: PrinterStatus;
  error: string | null;
}

interface PrinterRow {
  printer_id: string;
  name: string;
  connection: 'lan' | 'usb';
  address: string;
  paper_width_mm: number;
}

const CHILD = fileURLToPath(new URL('./transport/usb-child.ts', import.meta.url));
const TSX = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

type FromChild =
  | { type: 'ready' }
  | { type: 'writing'; id: number }
  | { type: 'done'; id: number; ok: boolean; code?: string | null }
  | { type: 'status'; id: number; eot1: number | null; eot4: number | null };

/**
 * A USB test print in its own child (usb-child.ts): the document, then the DLE EOT read-back on the device. The child
 * is killed at the deadline or when done; never rejects.
 */
export function usbTestPrint(devicePath: string, bytes: Uint8Array, o: { timers?: PrintTimers; deadlineMs?: number } = {}): Promise<TestPrintResult> {
  const timers = o.timers ?? nodeTimers;
  return new Promise<TestPrintResult>((resolve) => {
    const proc = fork(CHILD, [devicePath], { execArgv: ['--import', TSX], serialization: 'advanced', stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    let printed = false;
    let settled = false;
    const finish = (r: TestPrintResult): void => {
      if (settled) return;
      settled = true;
      timers.clearTimer(timer);
      proc.kill('SIGKILL');
      resolve(r);
    };
    const timer = timers.setTimer(() => finish({ printed, status: 'unknown', error: printed ? null : 'write_timeout' }), o.deadlineMs ?? TEST_PRINT_DEADLINE_MS);
    proc.on('error', () => finish({ printed, status: 'unknown', error: printed ? null : 'write_failed:child' }));
    proc.on('exit', () => finish({ printed, status: 'unknown', error: printed ? null : 'write_failed:child_exit' }));
    proc.on('message', (m: FromChild) => {
      if (m.type === 'ready') proc.send({ type: 'job', id: 1, bytes });
      else if (m.type === 'done') {
        if (!m.ok) {
          finish({ printed: false, status: 'unknown', error: `write_failed:${m.code ?? 'unknown'}` });
          return;
        }
        printed = true;
        proc.send({ type: 'status', id: 2 });
      } else if (m.type === 'status') finish({ printed, status: parseStatus(m.eot1, m.eot4), error: null });
    });
  });
}

/** A LAN test print on its own connection, then a status read: ≤ 3 + 3 + 2 s. Never rejects. */
export async function lanTestPrint(address: string, bytes: Uint8Array, o: { timers?: PrintTimers } = {}): Promise<TestPrintResult> {
  const sent = await sendLan(address, bytes, { timers: o.timers, connectTimeoutMs: LAN_TEST.connectTimeoutMs, writeTimeoutMs: LAN_TEST.writeTimeoutMs });
  const status = await readLanStatus(address, { timers: o.timers, timeoutMs: LAN_TEST.statusTimeoutMs });
  return sent.ok ? { printed: true, status, error: null } : { printed: false, status, error: sent.detail === null ? sent.error : `${sent.error}:${sent.detail}` };
}

function testDoc(p: PrinterRow, at: number, utc_offset_ms: number): Doc {
  return {
    blocks: [
      { text: 'TEST PRINT', size: 2, bold: true, align: 'center' },
      { text: p.name, align: 'center' },
      { text: clock12(at, utc_offset_ms), align: 'center' },
      { rule: true },
      { text: `${p.connection.toUpperCase()}  ${p.paper_width_mm} mm` },
      { cut: true },
    ],
  };
}

function requireManageDevices(app: FastifyInstance, request: FastifyRequest): void {
  const staffId = request.session?.staff_id ?? null;
  const resolution = staffId === null ? ({ grant: 'not_granted' } as const) : currentDirectory(app).resolve(staffId, 'manage-devices');
  if (resolution.grant !== 'allowed') throw new DomainError('PERMISSION_DENIED', { permission: 'manage-devices', grant: resolution.grant });
}

function invalid(field: string, error: z.ZodError): never {
  throw new DomainError('VALIDATION_FAILED', { field, issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
}

export interface PrintRouteOptions {
  timers?: PrintTimers;
}

const TestBody = z.object({ printer_id: z.string().min(1) });
const JobParams = z.object({ job_id: z.string().min(1) });

/** Called once per server from lane C4's register(). */
export function registerPrintRoutes(app: FastifyInstance, deps: HubDeps, o: PrintRouteOptions = {}): void {
  let status: PrintStatus | null = null;
  const statusPart = (): PrintStatus | null => {
    const branch_id = deps.config.provisioned?.branch_id;
    if (branch_id === undefined) return null;
    // only applyStatus is used (its hooks never run here); the worker's own instance does the loop (c16)
    status ??= createPrintStatus({ db: deps.db, writer: deps.writer, clock: deps.clock, branch_id, log: app.log });
    return status;
  };

  app.post('/admin/print/test', { config: { group: 'admin' } }, async (request) => {
    requireManageDevices(app, request);
    const body = TestBody.safeParse(request.body ?? {});
    if (!body.success) invalid('printer_id', body.error);
    const p = deps.db
      .prepare('SELECT printer_id, name, connection, address, paper_width_mm FROM printers WHERE printer_id = ? AND archived_at IS NULL')
      .get(body.data.printer_id) as PrinterRow | undefined;
    if (p === undefined) throw new DomainError('PRINTER_NOT_FOUND', { printer_id: body.data.printer_id });
    const at = deps.clock.branchNow();
    const width = p.paper_width_mm === 58 ? 32 : 48;
    const bytes = encodeDoc(testDoc(p, at, hubTime(deps.clock).utc_offset_ms), width);
    // usblp allows one open (c19 review): while the worker's child uses the device, the test reports `busy` and never
    // opens it; otherwise its own child prints and reads back (a worker job starting meanwhile fails EBUSY and retries)
    const result: TestPrintResult =
      p.connection === 'lan'
        ? await lanTestPrint(p.address, bytes, { timers: o.timers })
        : usbBusy(p.address)
          ? { printed: false, status: 'unknown', error: 'busy' }
          : await usbTestPrint(p.address, bytes, { timers: o.timers });
    const done = deps.clock.branchNow();
    statusPart()?.applyStatus(p.printer_id, result.status, done);
    deps.db.transaction(() => {
      if (result.printed && result.status === 'unknown') {
        // printed and nothing answered: no status support learned (a later LAN answer sets it back to 1)
        deps.db.prepare('UPDATE printer_runtime SET supports_status = 0 WHERE printer_id = ?').run(p.printer_id);
        // §3.5 "or a test print prints": recovery without a clean reading (applyStatus recovers on a clean one)
        recoverSuspects(deps.db, p.printer_id, done);
      }
      if (!result.printed) {
        deps.db
          .prepare(
            `INSERT INTO printer_runtime (printer_id, last_error) VALUES (?, ?)
             ON CONFLICT (printer_id) DO UPDATE SET last_error = excluded.last_error`,
          )
          .run(p.printer_id, result.error);
      }
    })();
    app.log.info({ printer_id: p.printer_id, printed: result.printed, status: result.status }, 'print.test');
    return { data: result };
  });

  app.post('/admin/print/jobs/:job_id/cancel', { config: { group: 'admin' } }, async (request) => {
    requireManageDevices(app, request);
    const params = JobParams.safeParse(request.params);
    if (!params.success) invalid('job_id', params.error);
    const { job_id } = params.data;
    const at = deps.clock.branchNow();
    const row = deps.db
      .prepare(`UPDATE print_jobs SET cancelled_at = ?, last_error = 'manager' WHERE job_id = ? AND acked_at IS NULL AND cancelled_at IS NULL RETURNING job_id`)
      .get(at, job_id);
    if (row === undefined) {
      const state = deps.db.prepare('SELECT CASE WHEN acked_at IS NOT NULL THEN \'acked\' ELSE \'cancelled\' END FROM print_jobs WHERE job_id = ?').pluck().get(job_id) as
        | 'acked'
        | 'cancelled'
        | undefined;
      if (state === undefined) throw new DomainError('PRINT_JOB_NOT_FOUND', { job_id });
      throw new DomainError('PRINT_JOB_NOT_PENDING', { job_id, state });
    }
    app.log.info({ job_id }, 'print.job_cancelled');
    return { data: { job_id, cancelled_at: at } };
  });
}
