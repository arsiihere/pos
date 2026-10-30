import { spawn } from 'node:child_process';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
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
