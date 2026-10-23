/// <reference types="node" />
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type pg from 'pg';
import type { Clock } from '../lib/clock.js';
import { createPool } from './client.js';

export { createPool };

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

export async function migrate(
  pool: pg.Pool,
  dir: string,
  clock: Clock,
): Promise<{ applied: string[] }> {
  const files = listMigrations(dir);
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    const present = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schema_migrations'`,
    );
    const stored = new Map<number, { version: number; name: string; checksum: string }>();
    if (present.rows.length > 0) {
      const existing = await client.query<{ version: number; name: string; checksum: string }>(
        `SELECT version, name, checksum FROM schema_migrations ORDER BY version`,
      );
      for (const row of existing.rows) stored.set(row.version, row);
    }
    for (const file of files) {
      const row = stored.get(file.version);
      if (row === undefined) continue;
      const checksum = sha256(readFileSync(file.path));
      if (row.name !== file.name || row.checksum !== checksum) throw new MigrationChecksumError(file.name);
    }
    for (const file of files) {
      if (stored.has(file.version)) continue;
      const bytes = readFileSync(file.path);
      await client.query('BEGIN');
      try {
        await client.query(bytes.toString('utf8'));
        await client.query(
          `INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES ($1, $2, $3, $4)`,
          [file.version, file.name, sha256(bytes), clock.branchNow()],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      applied.push(file.name);
    }
    return { applied };
  } finally {
    client.release();
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

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
