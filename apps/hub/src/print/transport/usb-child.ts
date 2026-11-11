import { closeSync, constants, openSync, writeSync } from 'node:fs';

// 03c §3.7, D3 (c13): the USB printer child process, one per USB printer (`child_process.fork` by usb.ts, device
// path in argv[2]). It does the blocking device open and writes, so a jammed printer blocks only this process; the
// hub never opens the device. Node builtins only. IPC (advanced serialization), parent → child
// `{ type: 'job', id, bytes }`; child → parent `{ type: 'ready' }`, `{ type: 'writing', id }` (sent and flushed
// before the first byte goes to the device), `{ type: 'done', id, ok, code?, opened?, wrote? }`.

type Job = { type: 'job'; id: number; bytes: Uint8Array };

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

function run(job: Job): void {
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
    send({ type: 'done', id: job.id, ok: true });
  });
}

process.on('message', (message: Job) => {
  if (message.type === 'job') run(message);
});
// the hub went away: nothing more will come
process.on('disconnect', () => process.exit(0));
send({ type: 'ready' });
