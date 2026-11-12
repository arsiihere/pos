import { closeSync, constants, openSync, readSync, writeSync } from 'node:fs';

// 03c §3.7, D3 (c13): the USB printer child process, one per USB printer (`child_process.fork` by usb.ts, device
// path in argv[2]). It does the blocking device open and writes, so a jammed printer blocks only this process; the
// hub never opens the device. Node builtins only. IPC (advanced serialization), parent → child
// `{ type: 'job', id, bytes }`; child → parent `{ type: 'ready' }`, `{ type: 'writing', id }` (sent and flushed
// before the first byte goes to the device), `{ type: 'done', id, ok, code?, opened?, wrote? }`.
// c19 (C3-1, owner 2026-11-11: the status read-back of §3.7 "USB only if its test print proved status"): parent → child
// `{ type: 'status', id }`; the child opens the device read-write and non-blocking on its own descriptor, sends
// DLE EOT 1 then DLE EOT 4 and waits ≤ STATUS_ANSWER_MS for each one-byte answer; child → parent
// `{ type: 'status', id, eot1, eot4 }` (null = no answer: a printer, file or device that never replies).
// usblp allows one open (c19 review): the child holds at most ONE descriptor on the device at any time — the job's
// write-only one only while a job is written (closed after it), the status read's O_RDWR | O_NONBLOCK one only for the
// read. Supported devices: usblp (`/dev/usb/lp*` and its udev symlinks), which pass bytes raw; a tty-like device is
// not put in raw mode here (no termios from Node), so it must already be raw (the tests' pty is set raw by its relay).

type Job = { type: 'job'; id: number; bytes: Uint8Array } | { type: 'status'; id: number };

/** per answer; two answers stay inside the 2 s status timeout (§3.7, §7) */
const STATUS_ANSWER_MS = 900;
const POLL_MS = 10;
const sleeper = new Int32Array(new SharedArrayBuffer(4));

const path = process.argv[2] ?? '';
let fd: number | null = null;

function send(message: Record<string, unknown>, then?: () => void): void {
  process.send?.(message, undefined, undefined, () => then?.());
}

function closeDevice(): void {
  if (fd === null) return;
  try {
    closeSync(fd);
  } catch {
    // already gone (unplugged)
  }
  fd = null;
}

/** One DLE EOT n on `sfd`, then the first answer byte within STATUS_ANSWER_MS (this process may block: it is the child). */
function ask(sfd: number, n: 1 | 4): number | null {
  try {
    writeSync(sfd, Uint8Array.of(0x10, 0x04, n));
  } catch {
    return null;
  }
  const one = Buffer.alloc(1);
  // a bounded number of short sleeps (no wall clock here, F §6.7): ≈ STATUS_ANSWER_MS
  for (let i = 0; i < STATUS_ANSWER_MS / POLL_MS; i += 1) {
    try {
      if (readSync(sfd, one, 0, 1, null) === 1) return one[0]!;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EAGAIN') return null;
    }
    Atomics.wait(sleeper, 0, 0, POLL_MS);
  }
  return null;
}

/** Stale input first (an earlier answer, or a plain file's own content), so only answers to our requests count. */
function drain(sfd: number): void {
  const chunk = Buffer.alloc(4_096);
  for (let i = 0; i < 64; i += 1) {
    try {
      if (readSync(sfd, chunk, 0, chunk.length, null) <= 0) return;
    } catch {
      return; // EAGAIN: nothing waiting
    }
  }
}

function status(id: number): void {
  closeDevice(); // at most one descriptor on the device at any time (usblp: one open)
  let sfd: number;
  try {
    // its own descriptor: never the job's write-only one; O_NOCTTY so a tty-like device never becomes ours
    sfd = openSync(path, constants.O_RDWR | constants.O_NONBLOCK | constants.O_NOCTTY);
  } catch {
    send({ type: 'status', id, eot1: null, eot4: null });
    return;
  }
  drain(sfd);
  const eot1 = ask(sfd, 1);
  const eot4 = eot1 === null ? null : ask(sfd, 4);
  try {
    closeSync(sfd);
  } catch {
    // gone
  }
  send({ type: 'status', id, eot1, eot4 });
}

function run(job: Extract<Job, { type: 'job' }>): void {
  if (fd === null) {
    try {
      // O_WRONLY without O_CREAT: a missing device (unplugged, dangling udev symlink) fails instead of creating a file
      fd = openSync(path, constants.O_WRONLY);
    } catch (error) {
      send({ type: 'done', id: job.id, ok: false, code: (error as NodeJS.ErrnoException).code ?? null, opened: false, wrote: false });
      return;
    }
  }
  const device = fd;
  send({ type: 'writing', id: job.id }, () => {
    let off = 0;
    try {
      while (off < job.bytes.length) off += writeSync(device, job.bytes, off, job.bytes.length - off);
    } catch (error) {
      closeDevice(); // reopened by the next job
      send({ type: 'done', id: job.id, ok: false, code: (error as NodeJS.ErrnoException).code ?? null, opened: true, wrote: off > 0 });
      return;
    }
    // usblp allows one open: the job's descriptor is closed after every job, so a status read (or the next job)
    // opens the only one (c19 review: the child never holds two descriptors on the device)
    closeDevice();
    send({ type: 'done', id: job.id, ok: true });
  });
}

process.on('message', (message: Job) => {
  if (message.type === 'job') run(message);
  else if (message.type === 'status') status(message.id);
});
// the hub went away: nothing more will come
process.on('disconnect', () => process.exit(0));
send({ type: 'ready' });
