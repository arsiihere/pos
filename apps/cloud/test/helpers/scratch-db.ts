import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createPool, migrate } from '../../src/db/migrate';
import { fixedClock } from '../../src/lib/clock';

// 01b §5.1 tests: a scratch database per test, migrated only up to `lastVersion`, so a later
// migration meets the data it will meet in a real upgrade. Dropped by dropScratchDatabases().

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const baseUrl = process.env.DATABASE_URL ?? 'postgres://pos:pos@127.0.0.1:5433/pos_test';
const clock = fixedClock(1_761_000_000_000);

let admin: pg.Pool | null = null;
const created: string[] = [];
const pools: pg.Pool[] = [];
const dirs: string[] = [];
let counter = 0;
let swept = false;

// G-12: a server-side kill (57P01, e.g. another run's DROP … WITH (FORCE)) of an idle pooled
// connection must not become an unhandled 'error' event. Log the code only and go on; the pool
// replaces the client on the next query.
function onPoolError(error: Error): void {
  console.warn(`scratch-db pool error ${(error as Error & { code?: string }).code ?? 'unknown'} (ignored)`);
}

function adminPool(): pg.Pool {
  if (admin === null) {
    admin = new pg.Pool({ connectionString: baseUrl, max: 1, application_name: `pos_scratch_admin_${process.pid}` });
    admin.on('error', onPoolError);
  }
  return admin;
}

function migrationsUpTo(lastVersion: number): string {
  const dir = mkdtempSync(join(tmpdir(), `pos-cloud-upto-${lastVersion}-`));
  dirs.push(dir);
  for (const name of readdirSync(migrationsDir)) {
    const match = /^(\d{4})_.+\.sql$/.exec(name);
    if (match !== null && Number(match[1]) <= lastVersion) copyFileSync(join(migrationsDir, name), join(dir, name));
  }
  return dir;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// 01b R-3: once per process, drop scratch databases left by a run whose pid is no longer running.
// Assumes every run shares this host's pid namespace (tests do not run in a container).
async function sweepDeadRuns(): Promise<void> {
  const { rows } = await adminPool().query<{ datname: string }>(
    `SELECT datname FROM pg_database WHERE datname LIKE 'pos\\_test\\_0005\\_%'`,
  );
  for (const { datname } of rows) {
    // Current form pos_test_0005_<pid>_<counter>_<random>; the older pos_test_0005_<pid>_<counter> too.
    const match = /^pos_test_0005_(\d+)_\d+(?:_[0-9a-f]+)?$/.exec(datname);
    if (match !== null && !pidAlive(Number(match[1]))) await adminPool().query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
  }
}

export async function scratchDatabaseAt(lastVersion: number): Promise<{ url: string; pool: pg.Pool }> {
  if (!swept) {
    swept = true;
    await sweepDeadRuns();
  }
  counter += 1;
  // G-12: a random suffix, so a second instance of this module in the same process (same pid,
  // counter from 1 again) can never pick, and drop, a name another instance still uses.
  const name = `pos_test_0005_${process.pid}_${counter}_${randomBytes(4).toString('hex')}`;
  await adminPool().query(`CREATE DATABASE ${name}`);
  created.push(name);
  const parsed = new URL(baseUrl);
  parsed.pathname = `/${name}`;
  const url = parsed.toString();
  const pool = createPool(url);
  pool.on('error', onPoolError);
  pools.push(pool);
  await migrate(pool, migrationsUpTo(lastVersion), clock);
  return { url, pool };
}

export async function dropScratchDatabases(): Promise<void> {
  for (const pool of pools.splice(0)) await pool.end();
  for (const name of created.splice(0)) await adminPool().query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (admin !== null) {
    await admin.end();
    admin = null;
  }
}
