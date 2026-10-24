/// <reference types="node" />
import { createCipheriv, createDecipheriv, type DecipherGCM } from 'node:crypto';
import { closeSync, createReadStream, createWriteStream, fsyncSync, openSync, readSync, renameSync, unlinkSync } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const MAGIC = Buffer.from('POSENC1\n');

const HEADER = MAGIC.length + 12;
const TAG = 16;

export async function encryptFile(src: string, dst: string, key: Buffer, iv: Buffer): Promise<void> {
  const tmp = `${dst}.tmp`;
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  try {
    await pipeline(createReadStream(src), cipher, async function* (source) {
      yield Buffer.concat([MAGIC, iv]);
      for await (const chunk of source) yield chunk as Buffer;
      yield cipher.getAuthTag();
    }, createWriteStream(tmp, { mode: 0o600 }));
    syncFile(tmp);
    renameSync(tmp, dst);
  } catch (error) {
    removeTmp(tmp);
    throw error;
  }
}

export async function decryptFile(src: string, dst: string, key: Buffer): Promise<void> {
  const tmp = `${dst}.tmp`;
  const iv = readIv(src);
  const decipher = createDecipheriv('aes-256-gcm', key, iv) as DecipherGCM;
  try {
    await pipeline(
      createReadStream(src, { start: HEADER }),
      new HoldTag(decipher),
      decipher,
      createWriteStream(tmp, { mode: 0o600 }),
    );
    syncFile(tmp);
    renameSync(tmp, dst);
  } catch (error) {
    removeTmp(tmp);
    throw error;
  }
}

class HoldTag extends Transform {
  private pending = Buffer.alloc(0);

  constructor(private readonly decipher: DecipherGCM) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, cb: (error?: Error | null, data?: Buffer) => void): void {
    const buf = Buffer.concat([this.pending, chunk]);
    if (buf.length <= TAG) {
      this.pending = buf;
      cb();
      return;
    }
    this.pending = buf.subarray(buf.length - TAG);
    cb(null, buf.subarray(0, buf.length - TAG));
  }

  override _flush(cb: (error?: Error | null) => void): void {
    if (this.pending.length !== TAG) {
      cb(new Error('truncated ciphertext'));
      return;
    }
    this.decipher.setAuthTag(this.pending);
    cb();
  }
}

function readIv(src: string): Buffer {
  const fd = openSync(src, 'r');
  try {
    const header = Buffer.alloc(HEADER);
    if (readSync(fd, header) !== HEADER || !header.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error('bad magic');
    }
    return Buffer.from(header.subarray(MAGIC.length));
  } finally {
    closeSync(fd);
  }
}

function syncFile(path: string): void {
  const fd = openSync(path, 'r+');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function removeTmp(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // The temp file was never created, or already removed.
  }
}
