import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/connection';
import { runMigrations } from '../../src/db/migrate';
import { boot } from '../../src/lib/boot';
import { fixedClock } from '../../src/lib/clock';
import { buildBigFixture, PROJECTIONS } from '../helpers/big-fixture';
import { offlineCloud } from '../helpers/stub-cloud';
import { stubConfigCloud } from '../helpers/stub-config-cloud';

const N = 1_000_000;
const BRANCH = 'branch-1';
const DECOY_AT = 1;
const WALL = 1_761_000_000_000;
const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

describe('boot budget', () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it.skipIf(process.env.POS_SKIP_BIG === '1')(
    '[00 §10 #100; 04 §4.5 H-2, G-4] every registered projection + access_reconcile, forced 3a alarm: 00\'s boot steps on 1 M events within 5 s; 3a uses the max-seq row; nothing replayed; every checkpoint = MAX(seq) after boot',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'pos-budget-'));
      cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
      const dataDir = join(dir, 'data');
      mkdirSync(dataDir);
      const dbPath = join(dataDir, 'hub.sqlite');
      buildBigFixture(dbPath, N);
      const db = openDb(dbPath);
      const earlier = db.prepare('SELECT recorded_at FROM events WHERE branch_id = ? AND seq = ?').get(BRANCH, N) as {
        recorded_at: number;
      };
      db.prepare(
        `INSERT INTO events (
          event_id, tenant_id, branch_id, stream_type, stream_id, event_type,
          schema_version, payload, occurred_at, recorded_at, actor_id, device_id, seq
        ) VALUES ('evt-decoy', 'tenant-a', ?, 'hub', ?, 'TestNooped', 1, '{"command_id":"decoy"}', ?, ?, NULL, 'hub', ?)`,
      ).run(BRANCH, BRANCH, DECOY_AT, DECOY_AT, N + 1);
      const advance = db.prepare(`UPDATE projection_checkpoints SET last_seq = ? WHERE branch_id = ? AND projection = ?`);
      for (const projection of PROJECTIONS) expect(advance.run(N + 1, BRANCH, projection).changes).toBe(1);
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
      const configPath = join(dir, 'config.json');
      writeFileSync(
        configPath,
        JSON.stringify({
          cloud_base_url: 'https://cloud.example',
          http_port: 3000,
          data_dir: dataDir,
          backup_dir: dataDir,
          min_client_version: '1.0.0',
          backup_encryption_key: Buffer.alloc(32, 7).toString('base64'),
          advertised_host: '192.168.10.2',
          provisioned: { tenant_id: 'tenant-a', branch_id: BRANCH, branch_name: 'Main', branch_api_key: 'test-branch-api-key' },
        }),
      );
      const started = performance.now();
      const booted = await boot({ configPath, wallNow: () => DECOY_AT, monoNow: () => 0, configClient: stubConfigCloud(), cloudClient: offlineCloud() });
      const elapsed = performance.now() - started;
      cleanups.push(() => booted.stop());
      const alarm = booted.deps.db
        .prepare(`SELECT payload FROM events WHERE event_type = 'ClockAlarm'`)
        .get() as { payload: string };
      const startedPayload = JSON.parse(
        (booted.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'HubStarted'`).get() as { payload: string })
          .payload,
      ) as { events_replayed: number };
      expect(elapsed).toBeLessThan(5_000);
      expect(earlier.recorded_at).toBeGreaterThan(DECOY_AT);
      expect(JSON.parse(alarm.payload).last_recorded_at).toBe(DECOY_AT);
      expect(booted.deps.clock.branchNow()).toBe(DECOY_AT + 1);
      expect(startedPayload.events_replayed).toBe(0);
      // G-4: the fixture seeded exactly the projections boot registers (catchUp writes a row for each), all at the tip.
      const maxSeq = booted.deps.db.prepare('SELECT MAX(seq) FROM events WHERE branch_id = ?').pluck().get(BRANCH) as number;
      const after = booted.deps.db
        .prepare('SELECT projection, last_seq FROM projection_checkpoints WHERE branch_id = ? ORDER BY projection')
        .all(BRANCH) as Array<{ projection: string; last_seq: number }>;
      expect(PROJECTIONS).toContain('access_reconcile');
      expect(after.map((row) => row.projection)).toEqual([...PROJECTIONS].sort());
      expect(after.every((row) => row.last_seq === maxSeq)).toBe(true);
    },
    600_000,
  );

  it('[00 §10 #162; 04 §4.5 H-2] boot with a forced 3a ClockAlarm after a migration deleted a checkpoint row → that projection is reset and replayed from seq 0; its row = MAX(seq)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pos-h2-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const dataDir = join(dir, 'data');
    mkdirSync(dataDir);
    const configPath = writeConfig(dir, dataDir);
    const db = openDb(join(dataDir, 'hub.sqlite'));
    await runMigrations(db, { dir: migrationsDir, clock: fixedClock(WALL) });
    const insert = db.prepare(
      `INSERT INTO events (
        event_id, tenant_id, branch_id, stream_type, stream_id, event_type,
        schema_version, payload, occurred_at, recorded_at, actor_id, device_id, seq
      ) VALUES (?, 'tenant-a', ?, ?, ?, ?, 1, ?, ?, ?, NULL, 'hub', ?)`,
    );
    insert.run('seed-1', BRANCH, 'hub', BRANCH, 'HubProvisioned', JSON.stringify({ tenant_id: 'tenant-a', branch_id: BRANCH, hub_version: '0' }), WALL, WALL, 1);
    const presence = { business_day_id: 'bd-1', staff_ids: ['S1', 'S2'], present: true, set_by: 'S_MGR' };
    insert.run('seed-2', BRANCH, 'staff', BRANCH, 'PresenceSet', JSON.stringify(presence), WALL, WALL, 2);
    db.close();
    // First boot (wall after the log): no alarm; catchUp writes every row.
    const first = await boot({ configPath, wallNow: () => WALL + 1_000, monoNow: () => 0, configClient: stubConfigCloud(), cloudClient: offlineCloud() });
    const fresh = presenceRows(first.deps.db);
    expect(fresh).toEqual([
      { staff_id: 'S1', present: 1, set_by: 'S_MGR', at: WALL },
      { staff_id: 'S2', present: 1, set_by: 'S_MGR', at: WALL },
    ]);
    await first.stop();
    // As a projection migration: delete the row; leave stale rows a reset must clear.
    const between = openDb(join(dataDir, 'hub.sqlite'));
    expect(between.prepare(`DELETE FROM projection_checkpoints WHERE branch_id = ? AND projection = 'presence_today'`).run(BRANCH).changes).toBe(1);
    between.prepare(`INSERT INTO presence_today (staff_id, present, set_by, at) VALUES ('STALE', 0, 'X', 1)`).run();
    const lastAt = between.prepare('SELECT recorded_at FROM events WHERE branch_id = ? ORDER BY seq DESC LIMIT 1').pluck().get(BRANCH) as number;
    between.close();
    // Forced alarm: wall before the last recorded_at, so 3a appends a ClockAlarm (a live applyAll) before step 4.
    expect(lastAt).toBeGreaterThan(WALL - 60_000);
    const second = await boot({ configPath, wallNow: () => WALL - 60_000, monoNow: () => 0, configClient: stubConfigCloud(), cloudClient: offlineCloud() });
    cleanups.push(() => second.stop());
    const types = second.deps.db.prepare('SELECT event_type FROM events WHERE branch_id = ? AND seq > 2 ORDER BY seq').pluck().all(BRANCH);
    expect(types).toContain('ClockAlarm');
    expect(presenceRows(second.deps.db)).toEqual(fresh);
    const started = second.deps.db
      .prepare(`SELECT payload FROM events WHERE event_type = 'HubStarted' ORDER BY seq DESC LIMIT 1`)
      .pluck()
      .get() as string;
    expect((JSON.parse(started) as { events_replayed: number }).events_replayed).toBe(1);
    const maxSeq = second.deps.db.prepare('SELECT MAX(seq) FROM events WHERE branch_id = ?').pluck().get(BRANCH) as number;
    expect(
      second.deps.db
        .prepare(`SELECT last_seq FROM projection_checkpoints WHERE branch_id = ? AND projection = 'presence_today'`)
        .pluck()
        .get(BRANCH),
    ).toBe(maxSeq);
  });
});

function presenceRows(db: Database.Database): unknown[] {
  return db.prepare('SELECT staff_id, present, set_by, at FROM presence_today ORDER BY staff_id').all();
}

function writeConfig(dir: string, dataDir: string): string {
  const configPath = join(dir, 'config.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      cloud_base_url: 'https://cloud.example',
      http_port: 3000,
      data_dir: dataDir,
      backup_dir: dataDir,
      min_client_version: '1.0.0',
      backup_encryption_key: Buffer.alloc(32, 7).toString('base64'),
      advertised_host: '192.168.10.2',
      provisioned: { tenant_id: 'tenant-a', branch_id: BRANCH, branch_name: 'Main', branch_api_key: 'test-branch-api-key' },
    }),
  );
  return configPath;
}
