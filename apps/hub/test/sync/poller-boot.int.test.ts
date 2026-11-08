import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, sha256hex } from '@pos/domain/hash';
import type { EngineState } from '@pos/engine';
import { BranchConfigSnapshotSchemaV3, type EventDraft } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stationExists } from '../../src/auth/station-validator';
import { openDb } from '../../src/db/connection';
import { boot, type BootHandle } from '../../src/lib/boot';
import { loadBranchConfig } from '../../src/projections/branch-config';
import { registerEngineBootSteps } from '../../src/engine-host/boot-steps';
import { registerRestaurantBootSteps } from '../../src/sync/boot-steps';
import { branchConfig } from '../../src/sync/branch-config-holder';
import type { ConfigFetch } from '../../src/sync/config-client';
import { configPoller } from '../../src/sync/config-poller';
import { stubConfigCloud, type StubConfigCloud } from '../helpers/stub-config-cloud';

const WALL = 1_761_000_000_000;
const BRANCH = 'branch-1';

registerEngineBootSteps();
registerRestaurantBootSteps();

function writeConfig(): { path: string; dataDir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pos-poll-boot-'));
  const dataDir = join(dir, 'data');
  const backupDir = join(dir, 'backup');
  mkdirSync(dataDir);
  mkdirSync(backupDir);
  const path = join(dir, 'config.json');
  writeFileSync(
    path,
    JSON.stringify({
      cloud_base_url: 'https://cloud.example',
      http_port: 3000,
      data_dir: dataDir,
      backup_dir: backupDir,
      min_client_version: '1.0.0',
      backup_encryption_key: Buffer.alloc(32, 7).toString('base64'),
      advertised_host: '192.168.10.2',
      provisioned: { tenant_id: 'tenant-a', branch_id: BRANCH, branch_name: 'Main', branch_api_key: 'key-1', confirmed_at: 1 },
    }),
  );
  return { path, dataDir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function snapshot(version: number, o: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...aBranchConfig({ branch_id: BRANCH, config_version: version }), ...o };
}

function appliedDraft(version: number, hash: string, schema = 3): EventDraft {
  return {
    stream_type: 'hub',
    stream_id: BRANCH,
    event_type: 'BranchConfigApplied',
    schema_version: 1,
    payload: { config_version: version, snapshot_schema_version: schema, snapshot_hash: hash, previous_config_version: null },
    occurred_at: WALL,
    actor_id: null,
    device_id: 'hub',
  };
}

describe('config at boot (S5, S15) and the poll timer (§7.2)', () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    vi.useRealTimers();
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });
  async function start(path: string, wall: number, cloud: StubConfigCloud): Promise<BootHandle> {
    const booted = await boot({ configPath: path, wallNow: () => wall, monoNow: () => 0, ifaces: ['192.168.10.2'], configClient: cloud });
    let stopped = false;
    cleanups.push(async () => {
      if (!stopped) await booted.stop();
    });
    const stop = booted.stop.bind(booted);
    booted.stop = async () => {
      stopped = true;
      await stop();
    };
    return booted;
  }
  const rows = (b: BootHandle) => ({
    config: b.deps.db.prepare('SELECT * FROM branch_config').all(),
    availability: b.deps.db.prepare('SELECT * FROM item_availability ORDER BY item_id').all(),
  });

  it('[01a §10 #47] restart: boot step 5 loads the config; a projection rebuild gives identical branch_config and item_availability rows', async () => {
    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    const cloud = stubConfigCloud();
    const first = await start(cfg.path, WALL, cloud);
    expect(branchConfig()).toBeNull();
    cloud.respondWithSnapshot(snapshot(3));
    expect((await configPoller(first.app).pollOnce()).outcome).toBe('applied');
    first.deps.writer.run((tx) =>
      tx.append([
        { ...appliedDraft(1, '0'.repeat(64)), stream_type: 'stock', stream_id: 'I1', event_type: 'ItemMadeUnavailable', payload: { item_id: 'I1' } },
      ]),
    );
    const applied = branchConfig();
    const before = rows(first);
    expect(before.config).toHaveLength(1);
    expect(before.availability).toHaveLength(1);
    await first.stop();

    const second = await start(cfg.path, WALL + 60_000, cloud);
    expect(branchConfig()).toEqual(applied);
    expect(rows(second)).toEqual(before);
    await second.stop();

    const db = openDb(join(cfg.dataDir, 'hub.sqlite'));
    db.prepare(`DELETE FROM projection_checkpoints WHERE projection IN ('branch_config', 'item_availability')`).run();
    db.close();
    const third = await start(cfg.path, WALL + 120_000, cloud);
    expect(rows(third)).toEqual(before);
    expect(branchConfig()).toEqual(applied);
  });

  it('[01a §10 #48] cloud-only restore: BranchConfigApplied without its body → BODY_MISSING, the poll sends config_version=0 and applies; same for a stored body of another schema version', async () => {
    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    const cloud = stubConfigCloud();
    const first = await start(cfg.path, WALL, cloud);
    const raw = snapshot(7);
    const hash = sha256hex(canonicalJson(raw));
    // R32: the event is in the log, its body is not
    first.deps.writer.run((tx) => tx.append([appliedDraft(7, hash)]));
    await first.stop();

    const second = await start(cfg.path, WALL + 60_000, cloud);
    expect(loadBranchConfig(second.deps.db, BRANCH).state).toBe('BODY_MISSING');
    expect(branchConfig()).toBeNull();
    const respond: ConfigFetch = {
      kind: 'ok',
      text: JSON.stringify({ data: { config: { snapshot_hash: hash, snapshot: raw }, directory: null } }),
    };
    cloud.next = async (q) => (q.config_version === 0 ? respond : { kind: 'not_modified' });
    expect((await configPoller(second.app).pollOnce()).outcome).toBe('applied');
    expect(cloud.calls.at(-1)).toEqual({ config_version: 0, directory_version: 0 });
    expect(loadBranchConfig(second.deps.db, BRANCH).state).toBe('APPLIED');
    expect(branchConfig()).toEqual(BranchConfigSnapshotSchemaV3.parse(raw));
    await second.stop();

    // a stored body whose snapshot_schema_version is not ours (after a breaking release)
    const cfg2 = writeConfig();
    cleanups.push(cfg2.cleanup);
    const cloud2 = stubConfigCloud();
    const third = await start(cfg2.path, WALL, cloud2);
    const old = snapshot(9, { snapshot_schema_version: 1 });
    const oldHash = sha256hex(canonicalJson(old));
    third.deps.db
      .prepare('INSERT INTO config_snapshots (snapshot_hash, config_version, body, received_at) VALUES (?, ?, ?, ?)')
      .run(oldHash, 9, canonicalJson(old), WALL);
    third.deps.writer.run((tx) => tx.append([appliedDraft(9, oldHash, 1)]));
    await third.stop();

    const fourth = await start(cfg2.path, WALL + 60_000, cloud2);
    expect(loadBranchConfig(fourth.deps.db, BRANCH).state).toBe('BODY_MISSING');
    expect(branchConfig()).toBeNull();
    const current = snapshot(9);
    const currentHash = sha256hex(canonicalJson(current));
    cloud2.next = async (q) =>
      q.config_version === 0
        ? { kind: 'ok', text: JSON.stringify({ data: { config: { snapshot_hash: currentHash, snapshot: current }, directory: null } }) }
        : { kind: 'not_modified' };
    expect((await configPoller(fourth.app).pollOnce()).outcome).toBe('applied');
    expect(cloud2.calls.at(-1)).toEqual({ config_version: 0, directory_version: 0 });
    expect(loadBranchConfig(fourth.deps.db, BRANCH).state).toBe('APPLIED');
    expect(branchConfig()?.config_version).toBe(9);
  });

  it('[01a §10 #124] the step-3 fold reaches the state holder; a branch_config projection behind the log is caught up before step 5 loads the config', async () => {
    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    const cloud = stubConfigCloud();
    const first = await start(cfg.path, WALL, cloud);
    first.deps.writer.run((tx) =>
      tx.append([
        { ...appliedDraft(1, '0'.repeat(64)), stream_type: 'stock', stream_id: 'I1', event_type: 'StockSet', payload: { item_id: 'I1', on_hand: 6, unit: 'piece' } },
      ]),
    );
    cloud.respondWithSnapshot(snapshot(3));
    await configPoller(first.app).pollOnce();
    const v3Seq = first.deps.writer.lastSeq();
    const v3Row = first.deps.db.prepare('SELECT * FROM branch_config').get() as Record<string, unknown>;
    // v4 adds a station, so the validator shows which config it reads
    const v4 = aBranchConfig({ branch_id: BRANCH, config_version: 4 });
    cloud.respondWithSnapshot({ ...v4, stations: [...v4.stations, { ...v4.stations[0]!, station_id: 'S4', name: 'Tandoor' }] });
    await configPoller(first.app).pollOnce();
    expect(branchConfig()?.config_version).toBe(4);
    await first.stop();

    // as after a USB restore plus the cloud tail: the projection and its checkpoint stop at v3
    const db = openDb(join(cfg.dataDir, 'hub.sqlite'));
    db.prepare(`UPDATE branch_config SET config_version = ?, snapshot_hash = ?, applied_at = ? WHERE branch_id = ?`).run(
      v3Row.config_version,
      v3Row.snapshot_hash,
      v3Row.applied_at,
      BRANCH,
    );
    db.prepare(`UPDATE projection_checkpoints SET last_seq = ? WHERE projection = 'branch_config'`).run(v3Seq);
    db.close();

    const second = await start(cfg.path, WALL + 60_000, cloud);
    expect((second.deps.state.get() as EngineState).stock.I1).toMatchObject({ on_hand: 6, unit: 'piece' });
    expect(branchConfig()?.config_version).toBe(4);
    expect(second.deps.db.prepare('SELECT config_version FROM branch_config').pluck().get()).toBe(4);
    expect(second.deps.writer.run((tx) => stationExists(tx, 'S4')).result).toBe(true);
  });

  it('[01a §7.2] after stop() no poll runs and a late in-flight result does not swap', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    const cloud = stubConfigCloud();
    const booted = await start(cfg.path, WALL, cloud);
    cloud.respondWithSnapshot(snapshot(3));
    // step 6 polled once at boot (no config yet, 01c AD-19) and started the 60 s timer
    expect(cloud.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(cloud.calls).toHaveLength(2);
    expect(branchConfig()?.config_version).toBe(3);

    // an in-flight poll that resolves after stop() does not swap and writes nothing
    let release: (f: ConfigFetch) => void = () => undefined;
    cloud.next = () =>
      new Promise<ConfigFetch>((resolve) => {
        release = resolve;
      });
    const poller = configPoller(booted.app);
    const pending = poller.pollOnce();
    const events = booted.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get();
    poller.stop();
    const v4 = snapshot(4);
    release({
      kind: 'ok',
      text: JSON.stringify({ data: { config: { snapshot_hash: sha256hex(canonicalJson(v4)), snapshot: v4 }, directory: null } }),
    });
    await pending;
    expect(branchConfig()?.config_version).toBe(3);
    expect(booted.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get()).toBe(events);

    // no further poll: neither the timer nor a direct call reaches the cloud
    const calls = cloud.calls.length;
    await vi.advanceTimersByTimeAsync(180_000);
    await poller.pollOnce();
    expect(cloud.calls).toHaveLength(calls);
    expect(branchConfig()?.config_version).toBe(3);
  });

  it('[01a §7.2] closing the app stops the poller', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    const cloud = stubConfigCloud();
    const booted = await start(cfg.path, WALL, cloud);
    const poller = configPoller(booted.app);
    await booted.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    await poller.pollOnce();
    // only step 6's boot poll (no config yet, 01c AD-19)
    expect(cloud.calls).toHaveLength(1);
  });
});
