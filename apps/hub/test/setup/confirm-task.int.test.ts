import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadHubConfig } from '../../src/config/load';
import type { HubConfig } from '../../src/config/schema';
import { writeHubConfigAtomic } from '../../src/config/write';
import { fixedClock } from '../../src/lib/clock';
import { startConfirmTask } from '../../src/setup/confirm-task';
import { CloudError, CloudUnreachableError, stubCloud } from '../helpers/stub-cloud';

describe('confirm task', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    vi.useRealTimers();
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('[00 §3.1 M41] confirm task writes confirmed_at and stops; retries after a 401, a 503, and a network error', async () => {
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), 'pos-confirm-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const configPath = join(dir, 'config.json');
    const clock = fixedClock(1_761_000_000_000);
    const config = hubConfig(dir);
    writeHubConfigAtomic(configPath, config);
    const cloud = stubCloud();
    const seen: string[] = [];
    cloud.confirmHub = async (apiKey, body) => {
      cloud.confirmCalls.push({ apiKey, body });
      const attempt = cloud.confirmCalls.length;
      if (attempt === 1) throw new CloudError(401, 'BRANCH_API_KEY_INVALID', {});
      if (attempt === 2) throw new CloudUnreachableError();
      if (attempt === 3) throw new CloudError(503, 'SERVICE_UNAVAILABLE', {});
      seen.push('ok');
      return { data: { branch_id: 'branch-1', hub_confirmed_at: 5 } };
    };
    const errors: string[] = [];
    const stop = startConfirmTask({
      cloud,
      config,
      configPath,
      clock,
      log: {
        error: () => {
          errors.push('error');
        },
      },
    });
    cleanups.push(stop);
    await vi.advanceTimersByTimeAsync(0);
    expect(cloud.confirmCalls).toHaveLength(1);
    expect(loadHubConfig(configPath).provisioned?.confirmed_at).toBeUndefined();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(cloud.confirmCalls).toHaveLength(2);
    expect(loadHubConfig(configPath).provisioned?.confirmed_at).toBeUndefined();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(cloud.confirmCalls).toHaveLength(3);
    expect(loadHubConfig(configPath).provisioned?.confirmed_at).toBeUndefined();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(cloud.confirmCalls).toHaveLength(4);
    expect(cloud.confirmCalls.every((call) => call.apiKey === 'branch-key-plain' && call.body.hub_version === '0.0.0')).toBe(
      true,
    );
    expect(loadHubConfig(configPath).provisioned?.confirmed_at).toBe(1_761_000_000_000);
    expect(config.provisioned?.confirmed_at).toBe(1_761_000_000_000);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(cloud.confirmCalls).toHaveLength(4);
    expect(errors.length).toBeGreaterThanOrEqual(3);
    expect(seen).toEqual(['ok']);
    stop();
  });
});

function hubConfig(dir: string): HubConfig {
  return {
    cloud_base_url: 'https://cloud.example',
    http_port: 3000,
    data_dir: dir,
    backup_dir: dir,
    min_client_version: '1.0.0',
    cors_origins: ['http://localhost'],
    maintenance_hour: 4,
    auth: {
      pin_max_failures: 5,
      device_max_failures: 10,
      device_failure_window_ms: 300_000,
      pin_lockout_ms: 900_000,
      argon2_concurrency: 2,
      admin_argon2_concurrency: 1,
    },
    advertised_host: '192.168.10.2',
    provisioned: {
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      branch_api_key: 'branch-key-plain',
    },
    backup_encryption_key: Buffer.alloc(32, 3).toString('base64'),
  };
}
