import { spawn } from 'node:child_process';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { dropScratchDatabases, scratchDatabaseAt } from './scratch-db';

// 01b R-3: a crashed run never drops its scratch databases; the next run drops those whose pid is dead.

const baseUrl = process.env.DATABASE_URL ?? 'postgres://pos:pos@127.0.0.1:5433/pos_test';
const admin = new pg.Pool({ connectionString: baseUrl, max: 1 });
const alive = `pos_test_0005_${process.pid}_999999`;

afterAll(async () => {
  await admin.query(`DROP DATABASE IF EXISTS ${alive} WITH (FORCE)`);
  await admin.end();
  await dropScratchDatabases();
}, 40_000);

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function exists(name: string): Promise<boolean> {
  const { rows } = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [name]);
  return rows.length > 0;
}

describe('[01b R-3] scratch databases left by a dead run', () => {
  it('[01b R-3] the first scratchDatabaseAt drops pos_test_0005_* of a dead pid and keeps a live pid', async () => {
    const child = spawn(process.execPath, ['-e', '']);
    const deadPid = child.pid as number;
    await new Promise((resolve) => child.on('exit', resolve));
    if (isAlive(deadPid)) return;
    const dead = `pos_test_0005_${deadPid}_1`;
    await admin.query(`DROP DATABASE IF EXISTS ${dead} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dead}`);
    await admin.query(`DROP DATABASE IF EXISTS ${alive} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${alive}`);

    await scratchDatabaseAt(4);

    expect(await exists(dead)).toBe(false);
    expect(await exists(alive)).toBe(true);
  }, 40_000);
});

async function terminate(where: string, params: unknown[]): Promise<number> {
  const { rows } = await admin.query<{ n: string }>(
    `SELECT count(pg_terminate_backend(pid)) AS n FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND ${where}`,
    params,
  );
  return Number(rows[0]?.n ?? 0);
}

async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('condition never held');
}

describe('[01b R-3, G-12] scratch database names and pool errors', () => {
  it('[01b R-3, G-12] a second scratchDatabaseAt in the same process never drops the first one\'s database', async () => {
    vi.resetModules();
    const one = (await import('./scratch-db')) as typeof import('./scratch-db');
    vi.resetModules();
    const two = (await import('./scratch-db')) as typeof import('./scratch-db');
    try {
      const first = await one.scratchDatabaseAt(4);
      const firstName = new URL(first.url).pathname.slice(1);
      const second = await two.scratchDatabaseAt(4);
      expect(new URL(second.url).pathname.slice(1)).not.toBe(firstName);
      expect(await exists(firstName)).toBe(true);
      expect((await first.pool.query<{ n: number }>('SELECT 1 AS n')).rows[0]?.n).toBe(1);
    } finally {
      await two.dropScratchDatabases();
      await one.dropScratchDatabases();
    }
  }, 40_000);

  it('[01b R-3, G-12] the sweep drops a dead pid\'s database in the current name form', async () => {
    const child = spawn(process.execPath, ['-e', '']);
    const deadPid = child.pid as number;
    await new Promise((resolve) => child.on('exit', resolve));
    if (isAlive(deadPid)) return;
    const dead = `pos_test_0005_${deadPid}_1_deadbeef`;
    await admin.query(`DROP DATABASE IF EXISTS ${dead} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dead}`);
    vi.resetModules();
    const fresh = (await import('./scratch-db')) as typeof import('./scratch-db');
    try {
      await fresh.scratchDatabaseAt(4);
      expect(await exists(dead)).toBe(false);
    } finally {
      await fresh.dropScratchDatabases();
    }
  }, 40_000);

  it('[01b R-3, G-12] an admin-terminated connection (57P01) raises no unhandled error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { url, pool } = await scratchDatabaseAt(4);
      const name = new URL(url).pathname.slice(1);
      await pool.query('SELECT 1');
      expect(pool.idleCount).toBeGreaterThan(0);
      expect(await terminate('datname = $1', [name])).toBeGreaterThan(0);
      await until(() => pool.totalCount === 0);
      expect(await terminate('application_name = $1', [`pos_scratch_admin_${process.pid}`])).toBeGreaterThan(0);
      await until(() => warn.mock.calls.filter((c) => String(c.join(' ')).includes('57P01')).length >= 2);
      expect((await scratchDatabaseAt(4)).url).toContain('pos_test_0005_');
    } finally {
      warn.mockRestore();
    }
  }, 40_000);
});
