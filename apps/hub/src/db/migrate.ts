/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { Clock } from '../lib/clock.js';
import { sha256hex } from '../lib/hash.js';

export class MigrationChecksumError extends Error {
  constructor(name: string) {
    super(`migration checksum mismatch: ${name}`);
    this.name = 'MigrationChecksumError';
  }
}

interface MigrationFile {
  version: number;
  name: string;
  path: string;
}

export async function runMigrations(
  db: Database.Database,
  opts: {
    dir: string;
    clock: Clock;
    backup?: (from: number, to: number) => Promise<void>;
  },
): Promise<{ from: number; to: number; applied: string[] }> {
  db.exec(
    `CREATE TABLE IF NOT EXISTS migration_checksums (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )`,
  );
  const files = listMigrations(opts.dir);
  const from = Number(db.pragma('user_version', { simple: true }));
  if (from > files.length) throw new Error(`database version ${from} is ahead of ${opts.dir}`);
  for (const file of files) {
    if (file.version > from) break;
    const checksum = sha256hex(readFileSync(file.path));
    const stored = db.prepare('SELECT name, checksum FROM migration_checksums WHERE version = ?').get(file.version) as
      | { name: string; checksum: string }
      | undefined;
    if (stored === undefined || stored.name !== file.name || stored.checksum !== checksum) {
      throw new MigrationChecksumError(file.name);
    }
  }
  const pending = files.filter((file) => file.version > from);
  if (pending.length > 0 && from > 0 && opts.backup !== undefined) {
    await opts.backup(from, pending[pending.length - 1]!.version);
  }
  const applied: string[] = [];
  for (const file of pending) {
    applyFile(db, file, opts.clock);
    applied.push(file.name);
  }
  return { from, to: from + applied.length, applied };
}

function applyFile(db: Database.Database, file: MigrationFile, clock: Clock): void {
  const bytes = readFileSync(file.path);
  const sql = bytes.toString('utf8');
  const first = sql.split('\n', 1)[0]?.replace(/\r$/, '') ?? '';
  const fkOff = first === '-- migrate:foreign-keys-off';
  if (fkOff) db.pragma('foreign_keys = OFF');
  try {
    const run = db.transaction(() => {
      db.exec(sql);
      db.prepare(
        'INSERT INTO migration_checksums (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
      ).run(file.version, file.name, sha256hex(bytes), clock.branchNow());
      db.pragma(`user_version = ${file.version}`);
      if (fkOff) {
        const violations = db.pragma('foreign_key_check');
        if (Array.isArray(violations) && violations.length > 0) {
          throw new Error(`foreign_key_check failed in ${file.name}`);
        }
      }
    });
    run.immediate();
  } finally {
    if (fkOff) db.pragma('foreign_keys = ON');
  }
}

function listMigrations(dir: string): MigrationFile[] {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => {
      const match = /^(\d{4})_.+\.sql$/.exec(name);
      if (match === null) throw new Error(`migration name must be NNNN_snake.sql: ${name}`);
      return { version: Number(match[1]), name, path: join(dir, name) };
    })
    .sort((a, b) => a.version - b.version);
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i]!;
    if (file.version !== i + 1) throw new Error(`migration versions must be sequential: ${file.name}`);
  }
  return files;
}
