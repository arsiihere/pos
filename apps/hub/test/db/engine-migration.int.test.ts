import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { ENGINE_REPLAY_EVENTS } from '@pos/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate';
import { fixedClock, T } from '../../src/lib/clock';
import { freshDb } from '../helpers/db';

const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

// §5.1 index statements, verbatim (sqlite_master keeps the CREATE text as written).
const INDEXES: Record<string, string> = {
  eng_snap_branch: 'CREATE INDEX eng_snap_branch ON engine_snapshots (branch_id, taken_at DESC)',
  eng_ckpt_branch: 'CREATE INDEX eng_ckpt_branch ON engine_checkpoints (branch_id, last_seq DESC)',
  events_branch_stream: 'CREATE INDEX events_branch_stream ON events (branch_id, stream_type, seq)',
};

const COLUMNS: Record<string, Array<[name: string, type: string, notNull: number, pk: number]>> = {
  engine_snapshots: [
    ['snapshot_id', 'TEXT', 0, 1],
    ['branch_id', 'TEXT', 1, 0],
    ['taken_at', 'INTEGER', 1, 0],
    ['last_seq', 'INTEGER', 1, 0],
    ['engine_version', 'INTEGER', 1, 0],
    ['state_json', 'TEXT', 1, 0],
  ],
  engine_checkpoints: [
    ['checkpoint_id', 'TEXT', 0, 1],
    ['branch_id', 'TEXT', 1, 0],
    ['taken_at', 'INTEGER', 1, 0],
    ['last_seq', 'INTEGER', 1, 0],
    ['checkpoint_schema', 'INTEGER', 1, 0],
    ['body_json', 'TEXT', 1, 0],
  ],
};

describe('hub migration 0007_engine', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('[03a §5.1] migrates a 0006 database to 0007, keeping its events', async () => {
    const { db, result } = await from0006();
    expect(result).toEqual({ from: 6, to: 7, applied: ['0007_engine.sql'] });
    expect(db.pragma('user_version', { simple: true })).toBe(7);
    expect(db.prepare('SELECT event_id FROM events ORDER BY seq').pluck().all()).toEqual(['E1', 'E2']);
  });

  it('[03a §5.1] both tables hold the §5.1 columns', async () => {
    const { db } = await from0006();
    for (const [table, columns] of Object.entries(COLUMNS)) {
      const rows = db.pragma(`table_info(${table})`) as Array<{ name: string; type: string; notnull: number; pk: number }>;
      expect(rows.map((row) => [row.name, row.type, row.notnull, row.pk])).toEqual(columns);
    }
  });

  it('[03a §5.1] the three indexes exist with the §5.1 names and definitions', async () => {
    const { db } = await from0006();
    for (const [name, sql] of Object.entries(INDEXES)) {
      expect(db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?").pluck().get(name)).toBe(sql);
    }
  });

  it('[03a §3.12] each of the four replay statements is served by events_branch_stream', async () => {
    const { db } = await from0006();
    for (const [stream, types] of Object.entries(ENGINE_REPLAY_EVENTS)) {
      const sql = `SELECT * FROM events WHERE branch_id = ? AND stream_type = ? AND seq > ? AND event_type IN (${list(types)}) ORDER BY seq`;
      const plan = queryPlan(db, sql, ['branch-1', stream, 0]);
      expect(plan).toContain('USING INDEX events_branch_stream (branch_id=? AND stream_type=? AND seq>?)');
      expect(plan).not.toContain('TEMP B-TREE');
    }
  });

  it('[03a §3.12] the two stock_version reads are served by events_branch_stream', async () => {
    const { db } = await from0006();
    const reads: Array<[stream: string, types: readonly string[]]> = [
      ['stock', ENGINE_REPLAY_EVENTS.stock],
      ['hub', ENGINE_REPLAY_EVENTS.hub],
    ];
    for (const [stream, types] of reads) {
      const sql = `SELECT seq FROM events WHERE branch_id = ? AND stream_type = '${stream}' AND event_type IN (${list(types)}) ORDER BY seq DESC LIMIT 1`;
      const plan = queryPlan(db, sql, ['branch-1']);
      expect(plan).toContain('USING INDEX events_branch_stream (branch_id=? AND stream_type=?)');
      expect(plan).not.toContain('TEMP B-TREE');
    }
  });

  async function from0006(): Promise<{ db: Database.Database; result: Awaited<ReturnType<typeof runMigrations>> }> {
    const handle = freshDb();
    cleanups.push(handle.cleanup);
    const { db, dir } = handle;
    const upTo6 = copyUpTo(dir, '0006');
    await runMigrations(db, { dir: upTo6, clock: fixedClock(T) });
    expect(db.pragma('user_version', { simple: true })).toBe(6);
    insertEvent(db, 'E1', 'order', 1);
    insertEvent(db, 'E2', 'audit', 2);
    // Stops at 0007: later migrations are not this test's subject. The runner re-checks 0001–0006's checksums.
    const result = await runMigrations(db, { dir: copyUpTo(dir, '0007'), clock: fixedClock(T) });
    return { db, result };
  }
});

function copyUpTo(parent: string, last: string): string {
  const target = join(parent, `migrations-${last}`);
  mkdirSync(target);
  for (const name of readdirSync(migrations)) {
    if (name.endsWith('.sql') && name.slice(0, 4) <= last) copyFileSync(join(migrations, name), join(target, name));
  }
  return target;
}

function list(types: readonly string[]): string {
  return types.map((type) => `'${type}'`).join(', ');
}

function queryPlan(db: Database.Database, sql: string, params: unknown[]): string {
  const rows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>;
  return rows.map((row) => row.detail).join('\n');
}

function insertEvent(db: Database.Database, eventId: string, streamType: string, seq: number): void {
  db.prepare(
    `INSERT INTO events (
      event_id, tenant_id, branch_id, stream_type, stream_id, event_type, schema_version, payload,
      occurred_at, recorded_at, actor_id, device_id, seq
    ) VALUES (?, 'tenant-1', 'branch-1', ?, 's-1', 'Test', 1, '{}', ?, ?, NULL, 'hub', ?)`,
  ).run(eventId, streamType, T, T, seq);
}
