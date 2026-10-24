/// <reference types="node" />
import * as fs from 'node:fs';
import { dirname } from 'node:path';
import type { HubConfig } from './schema.js';

type FsImpl = Pick<typeof fs, 'writeFileSync' | 'fsyncSync' | 'renameSync' | 'openSync' | 'closeSync'>;

export function writeHubConfigAtomic(path: string, cfg: HubConfig, fsImpl?: FsImpl): void {
  const io = fsImpl ?? fs;
  const tmp = `${path}.tmp`;
  const fd = io.openSync(tmp, 'w', 0o600);
  try {
    io.writeFileSync(fd, JSON.stringify(cfg));
    io.fsyncSync(fd);
  } catch (error) {
    io.closeSync(fd);
    remove(tmp);
    throw error;
  }
  io.closeSync(fd);
  fs.chmodSync(tmp, 0o600);
  try {
    io.renameSync(tmp, path);
  } catch (error) {
    remove(tmp);
    throw error;
  }
  const dirFd = fs.openSync(dirname(path), 'r');
  try {
    fs.fsyncSync(dirFd);
  } finally {
    fs.closeSync(dirFd);
  }
}

function remove(path: string): void {
  try {
    fs.unlinkSync(path);
  } catch {
    // Temp file was already gone.
  }
}
