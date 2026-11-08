import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, sha256hex } from '@pos/domain/hash';
import { CONFIG_POLL_INTERVAL_MS, type EventDraft } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boot, type BootHandle } from '../../src/lib/boot';
import { loadBranchConfig } from '../../src/projections/branch-config';
import { registerEngineBootSteps } from '../../src/engine-host/boot-steps';
import { registerRestaurantBootSteps } from '../../src/sync/boot-steps';
import { branchConfig } from '../../src/sync/branch-config-holder';
import { stubConfigCloud, type StubConfigCloud } from '../helpers/stub-config-cloud';

const WALL = 1_761_000_000_000;
const BRANCH = 'branch-1';
const PROVISIONED = { tenant_id: 'tenant-a', branch_id: BRANCH, branch_name: 'Main', branch_api_key: 'key-1', confirmed_at: 1 };

registerEngineBootSteps();
registerRestaurantBootSteps();

function writeConfig(provisioned = true): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pos-poll-first-'));
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
      ...(provisioned ? { provisioned: PROVISIONED } : {}),
    }),
  );
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function snapshot(version: number, o: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...aBranchConfig({ branch_id: BRANCH, config_version: version }), ...o };
}

function okFetch(raw: Record<string, unknown>): { kind: 'ok'; text: string } {
  return { kind: 'ok', text: JSON.stringify({ data: { config: { snapshot_hash: sha256hex(canonicalJson(raw)), snapshot: raw }, directory: null } }) };
}

// One real macrotask turn: every microtask of an in-flight poll settles (setImmediate is not faked).
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('[01c AD-19] first config poll at boot without usable config (01a S28 b, §7.2)', () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    vi.useRealTimers();
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });
  async function start(path: string, cloud: StubConfigCloud): Promise<BootHandle> {
    const booted = await boot({ configPath: path, wallNow: () => WALL, monoNow: () => 0, ifaces: ['192.168.10.2'], configClient: cloud });
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

  it('[01c AD-19] no stored config → one poll at boot before any tick; the next after CONFIG_POLL_INTERVAL_MS', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    const cloud = stubConfigCloud();
    await start(cfg.path, cloud);
    await settle();
    expect(cloud.calls).toEqual([{ config_version: 0, directory_version: 0 }]);
    await vi.advanceTimersByTimeAsync(CONFIG_POLL_INTERVAL_MS - 1);
    expect(cloud.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(cloud.calls).toHaveLength(2);
  });

  it('[01c AD-19] a stored body of another snapshot_schema_version → one poll at boot applies the cloud schema-4 snapshot', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    const cloud = stubConfigCloud();
    const first = await start(cfg.path, cloud);
    await settle();
    const old = snapshot(9, { snapshot_schema_version: 1 });
    const oldHash = sha256hex(canonicalJson(old));
    first.deps.db
      .prepare('INSERT INTO config_snapshots (snapshot_hash, config_version, body, received_at) VALUES (?, ?, ?, ?)')
      .run(oldHash, 9, canonicalJson(old), WALL);
    const applied: EventDraft = {
      stream_type: 'hub',
      stream_id: BRANCH,
      event_type: 'BranchConfigApplied',
      schema_version: 1,
      payload: { config_version: 9, snapshot_schema_version: 1, snapshot_hash: oldHash, previous_config_version: null },
      occurred_at: WALL,
      actor_id: null,
      device_id: 'hub',
    };
    first.deps.writer.run((tx) => tx.append([applied]));
    await first.stop();

    const current = snapshot(9);
    cloud.next = async (q) => (q.config_version === 0 ? okFetch(current) : { kind: 'not_modified' });
    const calls = cloud.calls.length;
    const second = await start(cfg.path, cloud);
    await settle();
    expect(cloud.calls.slice(calls)).toEqual([{ config_version: 0, directory_version: 0 }]);
    expect(loadBranchConfig(second.deps.db, BRANCH).state).toBe('APPLIED');
    expect(branchConfig()?.config_version).toBe(9);
    expect(branchConfig()?.snapshot_schema_version).toBe(4);
  });

  it('[01c AD-19] a stored, applied schema-4 config → no poll at boot; the first poll is at CONFIG_POLL_INTERVAL_MS', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    const cloud = stubConfigCloud();
    cloud.respondWithSnapshot(snapshot(3));
    const first = await start(cfg.path, cloud);
    await settle();
    expect(branchConfig()?.config_version).toBe(3);
    await first.stop();

    cloud.next = { kind: 'not_modified' };
    const calls = cloud.calls.length;
    await start(cfg.path, cloud);
    await settle();
    expect(branchConfig()?.config_version).toBe(3);
    expect(cloud.calls).toHaveLength(calls);
    await vi.advanceTimersByTimeAsync(CONFIG_POLL_INTERVAL_MS - 1);
    expect(cloud.calls).toHaveLength(calls);
    await vi.advanceTimersByTimeAsync(1);
    expect(cloud.calls).toHaveLength(calls + 1);
  });

  it('[01c AD-19] an unprovisioned hub → no poll', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const cfg = writeConfig(false);
    cleanups.push(cfg.cleanup);
    const cloud = stubConfigCloud();
    await start(cfg.path, cloud);
    await settle();
    await vi.advanceTimersByTimeAsync(2 * CONFIG_POLL_INTERVAL_MS);
    expect(cloud.calls).toHaveLength(0);
  });
});
