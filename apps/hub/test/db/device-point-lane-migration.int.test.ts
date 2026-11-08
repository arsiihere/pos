import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate';
import { fixedClock, T } from '../../src/lib/clock';
import { freshDb } from '../helpers/db';

const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

describe('hub migration 0008_device_point_lane', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('[00 H-5, H-6] migrates a 0007 database to 0008 and adds the nullable point_id and lane_label columns', async () => {
    const { db, result } = await from0007();
    expect(result).toEqual({ from: 7, to: 8, applied: ['0008_device_point_lane.sql'] });
    expect(db.pragma('user_version', { simple: true })).toBe(8);
    const cols = db.pragma('table_info(devices)') as Array<{ name: string; type: string; notnull: number; dflt_value: unknown; pk: number }>;
    const added = cols.filter((col) => col.name === 'point_id' || col.name === 'lane_label');
    expect(added.map((col) => [col.name, col.type, col.notnull, col.dflt_value, col.pk])).toEqual([
      ['point_id', 'TEXT', 0, null, 0],
      ['lane_label', 'TEXT', 0, null, 0],
    ]);
  });

  it('[00 H-5, H-6] devices that existed before 0008 keep point_id and lane_label NULL', async () => {
    const { db } = await from0007();
    expect(db.prepare('SELECT device_id, point_id, lane_label FROM devices ORDER BY device_id').all()).toEqual([
      { device_id: 'dev-1', point_id: null, lane_label: null },
      { device_id: 'dev-2', point_id: null, lane_label: null },
    ]);
  });

  async function from0007(): Promise<{ db: Database.Database; result: Awaited<ReturnType<typeof runMigrations>> }> {
    const handle = freshDb();
    cleanups.push(handle.cleanup);
    const { db, dir } = handle;
    await runMigrations(db, { dir: copyUpTo(dir, '0007'), clock: fixedClock(T) });
    expect(db.pragma('user_version', { simple: true })).toBe(7);
    const device = db.prepare(
      `INSERT INTO devices (device_id, branch_id, token_hash, device_name, device_type, station_id, paired_at, paired_by)
       VALUES (?, 'branch-1', ?, ?, ?, ?, ?, 'admin')`,
    );
    device.run('dev-1', 'tok-1', 'Tablet 1', 'tablet', null, T);
    device.run('dev-2', 'tok-2', 'Grill KDS', 'kds', 'st-1', T);
    // Stops at 0008: later migrations are not this test's subject. The runner re-checks 0001–0007's checksums.
    const result = await runMigrations(db, { dir: copyUpTo(dir, '0008'), clock: fixedClock(T) });
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
