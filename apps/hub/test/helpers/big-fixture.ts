/// <reference types="node" />
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, openReadOnly } from '../../src/db/connection';
import { registerHubProjections } from '../../src/lib/boot';
import { sha256hex } from '../../src/lib/hash';
import type { ProjectionRegistry } from '../../src/projections/registry';

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const BRANCH = 'branch-1';
const TENANT = 'tenant-a';
const BASE = 1_700_000_000_000;
const CHUNK = 50_000;
// R4: every projection boot registers, checkpointed at n so the budget boot replays nothing.
// 04 §4.5 H-2 (G-3): derived from registerHubProjections through a recording stub registry, plus access_reconcile
// (registered by boot after step 3a, outside registerHubProjections).
export const PROJECTIONS: readonly string[] = [...registeredNames(), 'access_reconcile'];
const PROJECTIONS_SQL = PROJECTIONS.map((name) => `'${name}'`).join(', ');
// The cache is keyed on the migration files and the projection list, so a new migration or projection
// builds a fresh fixture instead of reusing one with an older schema.
const CACHE_KEY = sha256hex(
  Buffer.from(
    JSON.stringify({
      migrations: readdirSync(migrationsDir)
        .filter((name) => name.endsWith('.sql'))
        .sort()
        .map((name) => [name, sha256hex(readFileSync(join(migrationsDir, name)))]),
      projections: PROJECTIONS,
    }),
  ),
).slice(0, 16);
const CACHE = join(tmpdir(), `pos-big-fixture-v1-${CACHE_KEY}.sqlite`);

export function buildBigFixture(path: string, n = 1_000_000): void {
  if (!complete(CACHE, n)) {
    rmSync(CACHE, { force: true });
    rmSync(`${CACHE}-wal`, { force: true });
    rmSync(`${CACHE}-shm`, { force: true });
    fill(CACHE, n);
  }
  copyFileSync(CACHE, path);
}

function complete(path: string, n: number): boolean {
  if (!existsSync(path)) return false;
  try {
    const db = openReadOnly(path);
    try {
      const seq = db.prepare('SELECT MAX(seq) AS seq FROM events WHERE branch_id = ?').get(BRANCH) as {
        seq: number | null;
      };
      const checkpoints = db
        .prepare(`SELECT last_seq FROM projection_checkpoints WHERE branch_id = ? AND projection IN (${PROJECTIONS_SQL})`)
        .all(BRANCH) as Array<{ last_seq: number }>;
      const live = db.prepare('SELECT COUNT(*) AS n FROM staff_sessions').get() as { n: number };
      return (
        seq.seq === n &&
        checkpoints.length === PROJECTIONS.length &&
        checkpoints.every((row) => row.last_seq === n) &&
        live.n > 0
      );
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

function fill(path: string, n: number): void {
  const db = openDb(path);
  try {
    db.pragma('synchronous = OFF');
    applyMigrations(db);
    const insert = db.prepare(
      `INSERT INTO events (
        event_id, tenant_id, branch_id, stream_type, stream_id, event_type,
        schema_version, payload, occurred_at, recorded_at, actor_id, device_id, seq
      ) VALUES (?, ?, ?, 'hub', ?, 'TestNooped', 1, '{"command_id":"c"}', ?, ?, NULL, 'hub', ?)`,
    );
    const writeChunk = db.transaction((start: number, end: number) => {
      for (let seq = start; seq <= end; seq += 1) {
        const at = BASE + seq;
        insert.run(`evt-${seq}`, TENANT, BRANCH, BRANCH, at, at, seq);
      }
    });
    for (let start = 1; start <= n; start += CHUNK) writeChunk.immediate(start, Math.min(n, start + CHUNK - 1));
    const checkpoint = db.prepare(`INSERT INTO projection_checkpoints (branch_id, projection, last_seq) VALUES (?, ?, ?)`);
    for (const projection of PROJECTIONS) checkpoint.run(BRANCH, projection, n);
    db.prepare(
      `INSERT INTO staff_sessions (
        session_id, branch_id, token_hash, kind, staff_id, station_id, device_id,
        idle_ttl_ms, started_at, last_activity_at
      ) VALUES ('sess-budget', ?, ?, 'staff', 'S_MGR', NULL, 'dev-budget', 3600000, ?, ?)`,
    ).run(BRANCH, sha256hex('budget-session'), BASE, BASE);
    db.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
}

function applyMigrations(db: ReturnType<typeof openDb>): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS migration_checksums (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )`,
  );
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const name of files) {
    const version = Number(name.slice(0, name.indexOf('_')));
    const bytes = readFileSync(join(migrationsDir, name));
    const sql = bytes.toString('utf8');
    const fkOff = (sql.split('\n', 1)[0]?.replace(/\r$/, '') ?? '') === '-- migrate:foreign-keys-off';
    if (fkOff) db.pragma('foreign_keys = OFF');
    try {
      const run = db.transaction(() => {
        db.exec(sql);
        db.prepare('INSERT INTO migration_checksums (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)').run(
          version,
          name,
          sha256hex(bytes),
          0,
        );
        db.pragma(`user_version = ${version}`);
      });
      run.immediate();
    } finally {
      if (fkOff) db.pragma('foreign_keys = ON');
    }
  }
}

function registeredNames(): string[] {
  const names: string[] = [];
  const recorder: ProjectionRegistry = {
    register(projection) {
      names.push(projection.name);
    },
    applyAll() {},
    catchUp() {
      return { replayed: {} };
    },
    afterCatchUp() {},
  };
  registerHubProjections(recorder);
  return names;
}
