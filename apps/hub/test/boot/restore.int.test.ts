import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/db/connection';
import { runMigrations } from '../../src/db/migrate';
import { boot } from '../../src/lib/boot';
import { fixedClock } from '../../src/lib/clock';
import { sha256hex } from '../../src/lib/hash';
import { registerAccessReconcile, restoreEmptyStaffSessions } from '../../src/projections/access-reconcile';
import { createTestHub } from '../helpers/test-hub';
import { offlineCloud } from '../helpers/stub-cloud';
import { stubConfigCloud } from '../helpers/stub-config-cloud';

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const WALL = 1_761_000_000_000;
const BRANCH = 'branch-1';
const TENANT = 'tenant-a';
const HOST = '192.168.10.2:3000';

describe('access reconciliation', () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #87] backup → revoke, force-logout, pair → restore copy + tail → revoked token 403, ended session 401, pairing token consumed, tablet paired after the copy 401', async () => {
    const original = writeConfig();
    const copy = writeConfig();
    cleanups.push(original.cleanup, copy.cleanup);
    const db = openDb(join(original.dataDir, 'hub.sqlite'));
    await runMigrations(db, { dir: migrationsDir, clock: fixedClock(WALL) });
    db.prepare(
      `INSERT INTO devices (
        device_id, branch_id, token_hash, device_name, device_type, station_id, owner_staff_id, paired_at, paired_by
      ) VALUES (?, ?, ?, 'revoked-tablet', 'tablet', NULL, NULL, ?, 'S_MGR')`,
    ).run('dev-revoked', BRANCH, sha256hex('token-revoked'), WALL);
    db.prepare(
      `INSERT INTO devices (
        device_id, branch_id, token_hash, device_name, device_type, station_id, owner_staff_id, paired_at, paired_by
      ) VALUES (?, ?, ?, 'session-tablet', 'tablet', NULL, NULL, ?, 'S_MGR')`,
    ).run('dev-session', BRANCH, sha256hex('token-session'), WALL);
    db.prepare(
      `INSERT INTO staff_sessions (
        session_id, branch_id, token_hash, kind, staff_id, station_id, device_id,
        idle_ttl_ms, started_at, last_activity_at
      ) VALUES ('sess-open', ?, ?, 'staff', 'S_MGR', NULL, 'dev-session', 3600000, ?, ?)`,
    ).run(BRANCH, sha256hex('session-open'), WALL, WALL);
    db.prepare(
      `INSERT INTO pairing_tokens (
        pairing_token_id, branch_id, token_hash, device_type, owner_staff_id, created_by, created_at, expires_at
      ) VALUES ('pair-before', ?, ?, 'tablet', NULL, 'S_MGR', ?, ?)`,
    ).run(BRANCH, sha256hex('pair-token'), WALL, WALL + 600_000);
    db.pragma('wal_checkpoint(TRUNCATE)');
    copyFileSync(join(original.dataDir, 'hub.sqlite'), join(copy.dataDir, 'hub.sqlite'));

    db.prepare('UPDATE devices SET revoked_at = ?, revoked_by = ? WHERE device_id = ?').run(WALL, 'S_MGR', 'dev-revoked');
    db.prepare('UPDATE staff_sessions SET ended_at = ?, end_reason = ?, ended_by = ? WHERE session_id = ?').run(
      WALL,
      'forced',
      'S_MGR',
      'sess-open',
    );
    db.prepare(
      `INSERT INTO devices (
        device_id, branch_id, token_hash, device_name, device_type, station_id, owner_staff_id, paired_at, paired_by
      ) VALUES ('dev-after', ?, ?, 'after-tablet', 'tablet', NULL, NULL, ?, 'S_MGR')`,
    ).run(BRANCH, sha256hex('token-after'), WALL);
    db.prepare('UPDATE pairing_tokens SET consumed_at = ?, device_id = ? WHERE pairing_token_id = ?').run(
      WALL,
      'dev-after',
      'pair-before',
    );
    insertEvent(db, {
      eventId: 'evt-revoked',
      streamType: 'hub',
      streamId: 'dev-revoked',
      eventType: 'DeviceRevoked',
      payload: { device_id: 'dev-revoked', reason: null, cause: 'manual' },
      deviceId: 'hub',
    });
    insertEvent(db, {
      eventId: 'evt-forced',
      streamType: 'staff',
      streamId: 'S_MGR',
      eventType: 'SessionEnded',
      payload: {
        session_id: 'sess-open',
        kind: 'staff',
        staff_id: 'S_MGR',
        station_id: null,
        reason: 'forced',
        ended_by: 'S_MGR',
      },
      deviceId: 'dev-session',
    });
    insertEvent(db, {
      eventId: 'evt-paired',
      streamType: 'hub',
      streamId: 'dev-after',
      eventType: 'DevicePaired',
      payload: {
        device_id: 'dev-after',
        device_name: 'after-tablet',
        device_type: 'tablet',
        station_id: null,
        owner_staff_id: null,
        pairing_token_id: 'pair-before',
        pairing_request_id: null,
      },
      deviceId: 'hub',
    });
    copyTail(db, join(copy.dataDir, 'hub.sqlite'));
    db.close();

    const booted = await boot({ configPath: copy.path, wallNow: () => WALL, monoNow: () => 0, configClient: stubConfigCloud(), cloudClient: offlineCloud() });
    cleanups.push(() => booted.stop());
    const revoked = await booted.app.inject({
      method: 'GET',
      url: '/queries/test-page',
      headers: { host: HOST, authorization: 'Bearer token-revoked' },
    });
    const ended = await booted.app.inject({
      method: 'GET',
      url: '/queries/test-quiet',
      headers: { host: HOST, authorization: 'Bearer token-session', 'x-session-token': 'session-open' },
    });
    const pairedAfter = await booted.app.inject({
      method: 'GET',
      url: '/queries/test-page',
      headers: { host: HOST, authorization: 'Bearer token-after' },
    });
    const consumed = booted.deps.db.prepare('SELECT consumed_at FROM pairing_tokens WHERE pairing_token_id = ?').get('pair-before') as {
      consumed_at: number | null;
    };
    expect(revoked.statusCode).toBe(403);
    expect(revoked.json().error.code).toBe('DEVICE_REVOKED');
    expect(ended.statusCode).toBe(401);
    expect(ended.json().error.code).toBe('SESSION_EXPIRED');
    expect(consumed.consumed_at).toBe(WALL);
    expect(pairedAfter.statusCode).toBe(401);
    expect(pairedAfter.json().error.code).toBe('DEVICE_TOKEN_INVALID');
  });

  it('[00 §10 #88] tail SessionStarted with no row → hub_restored; empty staff_sessions with session events → step 4b runs; a normal boot writes no SessionEnded', async () => {
    const tail = await bootSeeded((db) => {
      db.prepare(
        `INSERT INTO staff_sessions (
          session_id, branch_id, token_hash, kind, staff_id, station_id, device_id,
          idle_ttl_ms, started_at, last_activity_at
        ) VALUES ('sess-kept', ?, ?, 'staff', 'S_MGR', NULL, 'dev-kept', 3600000, ?, ?)`,
      ).run(BRANCH, sha256hex('session-kept'), WALL, WALL);
      insertEvent(db, {
        eventId: 'evt-tail-start',
        streamType: 'staff',
        streamId: 'S_NEW',
        eventType: 'SessionStarted',
        payload: {
          session_id: 'sess-tail',
          kind: 'staff',
          staff_id: 'S_NEW',
          station_id: null,
          device_id: 'dev-kept',
          idle_ttl_ms: 3_600_000,
        },
        deviceId: 'dev-kept',
      });
    });
    expect(sessionEnds(tail.db)).toEqual([{ session_id: 'sess-tail', reason: 'hub_restored' }]);
    expect(tail.db.prepare(`SELECT device_id FROM events WHERE event_type = 'SessionEnded'`).pluck().get()).toBe('hub');
    await tail.stop();

    const cloudOnly = await bootSeeded((db) => {
      insertEvent(db, {
        eventId: 'evt-cloud-start',
        streamType: 'staff',
        streamId: 'S_NEW',
        eventType: 'SessionStarted',
        payload: {
          session_id: 'sess-cloud',
          kind: 'staff',
          staff_id: 'S_NEW',
          station_id: null,
          device_id: null,
          idle_ttl_ms: 3_600_000,
        },
        deviceId: 'hub',
      });
      db.prepare(
        `INSERT INTO projection_checkpoints (branch_id, projection, last_seq) VALUES (?, 'access_reconcile', 1)`,
      ).run(BRANCH);
    });
    expect(sessionEnds(cloudOnly.db)).toEqual([{ session_id: 'sess-cloud', reason: 'hub_restored' }]);
    await cloudOnly.stop();

    const normal = await bootSeeded((db) => {
      db.prepare(
        `INSERT INTO staff_sessions (
          session_id, branch_id, token_hash, kind, staff_id, station_id, device_id,
          idle_ttl_ms, started_at, last_activity_at
        ) VALUES ('sess-live', ?, ?, 'staff', 'S_MGR', NULL, 'dev-live', 3600000, ?, ?)`,
      ).run(BRANCH, sha256hex('session-live'), WALL, WALL);
      insertEvent(db, {
        eventId: 'evt-live-start',
        streamType: 'staff',
        streamId: 'S_MGR',
        eventType: 'SessionStarted',
        payload: {
          session_id: 'sess-live',
          kind: 'staff',
          staff_id: 'S_MGR',
          station_id: null,
          device_id: 'dev-live',
          idle_ttl_ms: 3_600_000,
        },
        deviceId: 'dev-live',
      });
      db.prepare(
        `INSERT INTO projection_checkpoints (branch_id, projection, last_seq) VALUES (?, 'access_reconcile', 1)`,
      ).run(BRANCH);
    });
    expect(sessionEnds(normal.db)).toEqual([]);
    await normal.stop();
  });

  it('[00 §10 #128] a live /devices/pair rotation keeps the new token_hash (the new token works after the live access_reconcile apply); the same event in boot catch-up sets \'rotated:<event_id>\'', async () => {
    const h = await createTestHub();
    const dir = h.deps.config.data_dir;
    const late: { booted?: Awaited<ReturnType<typeof boot>> } = {};
    cleanups.push(async () => {
      if (late.booted !== undefined) {
        await late.booted.stop();
        rmSync(dir, { recursive: true, force: true });
        return;
      }
      await h.close();
    });
    registerAccessReconcile({ projections: h.deps.projections, writer: h.deps.writer, clock: h.deps.clock });
    const device = h.deps.ids.next();
    const oldToken = h.deps.secrets.token256();
    const newToken = h.deps.secrets.token256();
    h.deps.db
      .prepare(
        `INSERT INTO devices (
          device_id, branch_id, token_hash, device_name, device_type, station_id, owner_staff_id, paired_at, paired_by
        ) VALUES (?, 'branch-1', ?, 'tablet', 'tablet', NULL, NULL, ?, 'S_MGR')`,
      )
      .run(device, sha256hex(oldToken), h.clock.branchNow());
    h.deps.writer.run((tx) => {
      tx.db.prepare('UPDATE devices SET token_hash = ? WHERE device_id = ?').run(sha256hex(newToken), device);
      tx.append([
        {
          stream_type: 'hub',
          stream_id: device,
          event_type: 'DeviceTokenRotated',
          schema_version: 1,
          payload: { device_id: device, pair_request_id: 'req-live' },
          occurred_at: h.clock.branchNow(),
          actor_id: null,
          device_id: device,
        },
      ]);
    });
    const liveHash = h.deps.db.prepare('SELECT token_hash FROM devices WHERE device_id = ?').pluck().get(device);
    const live = await h.app.inject({
      method: 'GET',
      url: '/queries/test-page',
      headers: { authorization: `Bearer ${newToken}` },
    });
    expect(liveHash).toBe(sha256hex(newToken));
    expect(live.statusCode).toBe(200);
    const eventId = h.deps.db.prepare(`SELECT event_id FROM events WHERE event_type = 'DeviceTokenRotated'`).pluck().get() as string;
    h.deps.db.prepare(`UPDATE projection_checkpoints SET last_seq = 0 WHERE projection = 'access_reconcile'`).run();
    const configPath = join(dir, 'config.json');
    writeFileSync(configPath, JSON.stringify(configBody(dir)));
    await h.app.close();
    h.deps.readDb.close();
    h.deps.db.close();
    late.booted = await boot({ configPath, wallNow: () => WALL, monoNow: () => 0, configClient: stubConfigCloud(), cloudClient: offlineCloud() });
    const caughtUp = late.booted.deps.db.prepare('SELECT token_hash FROM devices WHERE device_id = ?').pluck().get(device);
    expect(caughtUp).toBe(`rotated:${eventId}`);
  });

  it('[00 §3.1 M48] an empty staff_sessions table probes session streams instead of counting the event log', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const seen: string[] = [];
    const prepare = hub.deps.db.prepare.bind(hub.deps.db);
    hub.deps.db.prepare = ((sql: string) => {
      seen.push(sql);
      return prepare(sql);
    }) as typeof hub.deps.db.prepare;
    restoreEmptyStaffSessions(hub.deps.db, hub.deps.writer, hub.clock, BRANCH);
    const eventSql = seen.filter((sql) => sql.includes('FROM events'));
    expect(eventSql.some((sql) => /COUNT\s*\(\s*\*\s*\)/i.test(sql))).toBe(false);
    expect(eventSql.some((sql) => sql.includes('stream_type') && sql.includes('LIMIT 1'))).toBe(true);
  });

  it('[00 §10 #68] cloud-only restore: SessionStarted without SessionEnded and empty staff_sessions → SessionEnded hub_restored', async () => {
    const booted = await bootSeeded((db) => {
      insertEvent(db, {
        eventId: 'evt-68',
        streamType: 'staff',
        streamId: 'S_NEW',
        eventType: 'SessionStarted',
        payload: {
          session_id: 'sess-68',
          kind: 'admin',
          staff_id: 'S_NEW',
          station_id: null,
          device_id: null,
          idle_ttl_ms: 3_600_000,
        },
        deviceId: 'hub',
      });
      db.prepare(
        `INSERT INTO projection_checkpoints (branch_id, projection, last_seq) VALUES (?, 'access_reconcile', 1)`,
      ).run(BRANCH);
    });
    expect(sessionEnds(booted.db)).toEqual([{ session_id: 'sess-68', reason: 'hub_restored' }]);
    await booted.stop();
  });
});

function sessionEnds(db: Database.Database): Array<{ session_id: string; reason: string }> {
  const rows = db.prepare(`SELECT payload FROM events WHERE event_type = 'SessionEnded' ORDER BY seq`).all() as Array<{
    payload: string;
  }>;
  return rows.map((row) => {
    const payload = JSON.parse(row.payload) as { session_id: string; reason: string };
    return { session_id: payload.session_id, reason: payload.reason };
  });
}

async function bootSeeded(seed: (db: Database.Database) => void): Promise<{ db: Database.Database; stop: () => Promise<void> }> {
  const cfg = writeConfig();
  const db = openDb(join(cfg.dataDir, 'hub.sqlite'));
  await runMigrations(db, { dir: migrationsDir, clock: fixedClock(WALL) });
  seed(db);
  db.close();
  const booted = await boot({ configPath: cfg.path, wallNow: () => WALL + 10_000, monoNow: () => 0, configClient: stubConfigCloud(), cloudClient: offlineCloud() });
  return {
    db: booted.deps.db,
    async stop() {
      await booted.stop();
      cfg.cleanup();
    },
  };
}

function insertEvent(
  db: Database.Database,
  o: {
    eventId: string;
    streamType: string;
    streamId: string;
    eventType: string;
    payload: unknown;
    deviceId: string;
  },
): void {
  const seq = (
    db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE branch_id = ?').get(BRANCH) as { seq: number }
  ).seq + 1;
  db.prepare(
    `INSERT INTO events (
      event_id, tenant_id, branch_id, stream_type, stream_id, event_type,
      schema_version, payload, occurred_at, recorded_at, actor_id, device_id, seq
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL, ?, ?)`,
  ).run(o.eventId, TENANT, BRANCH, o.streamType, o.streamId, o.eventType, JSON.stringify(o.payload), WALL, WALL, o.deviceId, seq);
}

function copyTail(source: Database.Database, destPath: string): void {
  const rows = source.prepare('SELECT * FROM events WHERE branch_id = ? ORDER BY seq').all(BRANCH) as Array<Record<string, unknown>>;
  const dest = openDb(destPath);
  const insert = dest.prepare(
    `INSERT INTO events (
      event_id, tenant_id, branch_id, stream_type, stream_id, event_type,
      schema_version, payload, occurred_at, recorded_at, actor_id, device_id, seq
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const copy = dest.transaction(() => {
    for (const row of rows) {
      insert.run(
        row.event_id,
        row.tenant_id,
        row.branch_id,
        row.stream_type,
        row.stream_id,
        row.event_type,
        row.schema_version,
        row.payload,
        row.occurred_at,
        row.recorded_at,
        row.actor_id,
        row.device_id,
        row.seq,
      );
    }
  });
  copy.immediate();
  dest.pragma('wal_checkpoint(TRUNCATE)');
  dest.close();
}

function writeConfig(): { path: string; dataDir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pos-restore-'));
  const dataDir = join(dir, 'data');
  mkdirSync(dataDir);
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify(configBody(dataDir)));
  return { path, dataDir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function configBody(dataDir: string): Record<string, unknown> {
  return {
    cloud_base_url: 'https://cloud.example',
    http_port: 3000,
    data_dir: dataDir,
    backup_dir: dataDir,
    min_client_version: '1.0.0',
    backup_encryption_key: Buffer.alloc(32, 7).toString('base64'),
    advertised_host: '192.168.10.2',
    provisioned: { tenant_id: TENANT, branch_id: BRANCH, branch_name: 'Main', branch_api_key: 'test-branch-api-key' },
  };
}
