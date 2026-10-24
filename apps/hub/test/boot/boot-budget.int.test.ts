import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/connection';
import { boot } from '../../src/lib/boot';
import { buildBigFixture } from '../helpers/big-fixture';

const N = 1_000_000;
const BRANCH = 'branch-1';
const DECOY_AT = 1;

describe('boot budget', () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it.skipIf(process.env.POS_SKIP_BIG === '1')(
    '[00 §10 #100] 00\'s boot steps on 1 M events within 5 s; 3a uses the max-seq row; a projection with checkpoint = MAX(seq) is not replayed',
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
      db.prepare(`UPDATE projection_checkpoints SET last_seq = ? WHERE branch_id = ? AND projection = 'access_reconcile'`).run(
        N + 1,
        BRANCH,
      );
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
      const booted = await boot({ configPath, wallNow: () => DECOY_AT, monoNow: () => 0 });
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
    },
    600_000,
  );
});
