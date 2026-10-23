/// <reference types="node" />
import * as fs from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { type HubConfig, isProvisioned } from '../config/schema.js';
import { encryptFile } from '../lib/crypto-file.js';
import type { SecretGen } from '../lib/secrets.js';

export function makePreMigrateBackup(o: {
  db: Database.Database;
  config: HubConfig;
  secrets: SecretGen;
}): (from: number, to: number) => Promise<void> {
  return async (from, to) => {
    if (!isProvisioned(o.config) || o.config.backup_encryption_key === undefined) return;
    const base = `pre-migrate-${from}-${to}.sqlite`;
    const plain = join(o.config.data_dir, base);
    const key = Buffer.from(o.config.backup_encryption_key, 'base64');
    const iv = o.secrets.bytes(12);
    let failure: unknown;
    try {
      await o.db.backup(plain);
      fs.chmodSync(plain, 0o600);
      try {
        await encryptFile(plain, join(o.config.backup_dir, `${base}.enc`), key, iv);
      } catch {
        await encryptFile(plain, join(o.config.data_dir, `${base}.enc`), key, iv);
      }
    } catch (error) {
      failure = error;
    }
    try {
      fs.unlinkSync(plain);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && failure === undefined) failure = error;
    }
    if (failure !== undefined) throw failure;
  };
}

const PLAINTEXT = /^pre-migrate-.+\.sqlite$/;

export function deleteLeftoverPlaintext(dataDir: string): string[] {
  const removed: string[] = [];
  for (const name of fs.readdirSync(dataDir)) {
    if (!PLAINTEXT.test(name)) continue;
    const path = join(dataDir, name);
    fs.unlinkSync(path);
    removed.push(path);
  }
  removed.sort();
  return removed;
}
