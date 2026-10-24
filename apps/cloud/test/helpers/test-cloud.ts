/// <reference types="node" />
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { createPool, migrate } from '../../src/db/migrate';
import { fixedClock } from '../../src/lib/clock';
import { loadCloudEnv, type CloudEnv } from '../../src/lib/env';
import { testIdGen } from '../../src/lib/ids';
import { testSecrets } from '../../src/lib/secrets';
import { buildCloudServer } from '../../src/server';

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

export interface TestCloud {
  app: FastifyInstance;
  pool: pg.Pool;
  env: CloudEnv;
  clock: ReturnType<typeof fixedClock>;
  logs(): string;
  close(): Promise<void>;
}

export async function createTestCloud(o?: { captureLogs?: boolean }): Promise<TestCloud> {
  const env = loadCloudEnv({
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://pos:pos@127.0.0.1:5433/pos_test',
    JWT_SECRET: 'j'.repeat(32),
    REFRESH_TOKEN_SECRET: 'r'.repeat(32),
    PORT: '3001',
    HUB_MIN_VERSION: '1.0.0',
  });
  const pool = createPool(env.DATABASE_URL);
  const clock = fixedClock(1_761_000_000_000);
  await migrate(pool, migrationsDir, clock);
  const chunks: Buffer[] = [];
  const logStream = o?.captureLogs === true ? new PassThrough() : undefined;
  if (logStream !== undefined) {
    logStream.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
  }
  const app = buildCloudServer({
    pool,
    env,
    clock,
    ids: testIdGen(),
    secrets: testSecrets(),
    logStream,
  });
  return {
    app,
    pool,
    env,
    clock,
    logs: () => Buffer.concat(chunks).toString('utf8'),
    async close() {
      await app.close();
      await pool.end();
    },
  };
}

export async function truncateAll(pool: pg.Pool): Promise<void> {
  const tables = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations' ORDER BY tablename`,
  );
  if (tables.rows.length === 0) return;
  const list = tables.rows.map((row) => `"${row.tablename}"`).join(', ');
  await pool.query(`TRUNCATE ${list} CASCADE`);
}
