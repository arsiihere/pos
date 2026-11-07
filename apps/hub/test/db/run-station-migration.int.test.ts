import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate';
import { fixedClock, T } from '../../src/lib/clock';
import { freshDb } from '../helpers/db';

const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

const SEEDED = [
  { responsibility: 'count_stock', station_id: 'ST_BAR', subject_kind: 'staff', subject_id: 'S_C' },
  { responsibility: 'count_stock', station_id: 'ST_GRILL', subject_kind: 'role', subject_id: 'R_GRILL' },
  { responsibility: 'count_stock', station_id: 'ST_GRILL', subject_kind: 'staff', subject_id: 'S_G1' },
];

describe('hub migration 0009_run_station', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('[01b B-4] migrates a 0008 database to 0009 and keeps every responsibility row', async () => {
    const { db, result } = await from0008();
    expect(result).toEqual({ from: 8, to: 9, applied: ['0009_run_station.sql'] });
    expect(db.pragma('user_version', { simple: true })).toBe(9);
    expect(all(db)).toEqual(SEEDED);
  });

  it('[01b B-4] the rebuilt table accepts run_station, still refuses any other kind, and keeps its columns and key', async () => {
    const { db } = await from0008();
    const insert = db.prepare('INSERT INTO responsibilities (responsibility, station_id, subject_kind, subject_id) VALUES (?, ?, ?, ?)');
    insert.run('run_station', 'ST_GRILL', 'staff', 'S_G1');
    expect(() => insert.run('cook', 'ST_GRILL', 'staff', 'S_G1')).toThrow(/CHECK constraint failed/);
    expect(() => insert.run('run_station', 'ST_GRILL', 'crew', 'S_G1')).toThrow(/CHECK constraint failed/);
    expect(() => insert.run('run_station', 'ST_GRILL', 'staff', 'S_G1')).toThrow(/UNIQUE constraint failed/);
    expect(all(db)).toEqual([...SEEDED, { responsibility: 'run_station', station_id: 'ST_GRILL', subject_kind: 'staff', subject_id: 'S_G1' }]);
    const cols = db.pragma('table_info(responsibilities)') as Array<{ name: string; type: string; notnull: number; pk: number }>;
    expect(cols.map((col) => [col.name, col.type, col.notnull, col.pk])).toEqual([
      ['responsibility', 'TEXT', 1, 1],
      ['station_id', 'TEXT', 1, 2],
      ['subject_kind', 'TEXT', 1, 3],
      ['subject_id', 'TEXT', 1, 4],
    ]);
    // No secondary index, as before (01b §5.2: the cache is read whole).
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'responsibilities' AND sql IS NOT NULL").all()).toEqual([]);
  });

  async function from0008(): Promise<{ db: Database.Database; result: Awaited<ReturnType<typeof runMigrations>> }> {
    const handle = freshDb();
    cleanups.push(handle.cleanup);
    const { db, dir } = handle;
    await runMigrations(db, { dir: copyUpTo(dir, '0008'), clock: fixedClock(T) });
    expect(db.pragma('user_version', { simple: true })).toBe(8);
    const insert = db.prepare('INSERT INTO responsibilities (responsibility, station_id, subject_kind, subject_id) VALUES (?, ?, ?, ?)');
    for (const row of SEEDED) insert.run(row.responsibility, row.station_id, row.subject_kind, row.subject_id);
    expect(() => insert.run('run_station', 'ST_GRILL', 'staff', 'S_G1')).toThrow(/CHECK constraint failed/);
    // Stops at 0009: later migrations are not this test's subject. The runner re-checks 0001–0008's checksums.
    const result = await runMigrations(db, { dir: copyUpTo(dir, '0009'), clock: fixedClock(T) });
    return { db, result };
  }
});

function all(db: Database.Database): unknown[] {
  return db.prepare('SELECT responsibility, station_id, subject_kind, subject_id FROM responsibilities ORDER BY responsibility, station_id, subject_kind, subject_id').all();
}

function copyUpTo(parent: string, last: string): string {
  const target = join(parent, `migrations-${last}`);
  mkdirSync(target);
  for (const name of readdirSync(migrations)) {
    if (name.endsWith('.sql') && name.slice(0, 4) <= last) copyFileSync(join(migrations, name), join(target, name));
  }
  return target;
}
