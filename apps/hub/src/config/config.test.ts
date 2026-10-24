import * as fs from 'node:fs';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadHubConfig } from './load';
import { ConfigError, DEFAULT_CONFIG_PATH, HubConfigSchema, isConfirmed, isProvisioned } from './schema';
import { writeHubConfigAtomic } from './write';

const minimal = {
  cloud_base_url: 'https://api.example-pos.app/v1',
  http_port: 3000,
  data_dir: '/var/lib/pos-hub',
  backup_dir: '/media/POSBACKUP',
  min_client_version: '1.0.0',
};

describe('hub config', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('[00 §3.10] defaults fill auth limits, cors_origins and maintenance_hour', () => {
    expect(DEFAULT_CONFIG_PATH).toBe('/etc/pos-hub/config.json');
    dir = mkdtempSync(join(tmpdir(), 'pos-cfg-'));
    const path = join(dir, 'config.json');
    writeFileSync(path, JSON.stringify(minimal));
    const cfg = loadHubConfig(path);
    expect(cfg.auth).toEqual({
      pin_max_failures: 5,
      device_max_failures: 10,
      device_failure_window_ms: 300_000,
      pin_lockout_ms: 900_000,
      argon2_concurrency: 2,
      admin_argon2_concurrency: 1,
    });
    expect(cfg.cors_origins).toEqual(['http://localhost']);
    expect(cfg.maintenance_hour).toBe(4);
  });

  it('[00 §3.10] missing or malformed config fails naming the field (Review Focus 3)', () => {
    dir = mkdtempSync(join(tmpdir(), 'pos-cfg-'));
    const path = join(dir, 'config.json');
    expect(() => loadHubConfig(join(dir, 'missing.json'))).toThrow(ConfigError);

    writeFileSync(path, JSON.stringify({ ...minimal, cloud_base_url: undefined }));
    expect(fieldOf(() => loadHubConfig(path))).toBe('cloud_base_url');

    writeFileSync(path, JSON.stringify({ ...minimal, http_port: '3000' }));
    expect(fieldOf(() => loadHubConfig(path))).toBe('http_port');

    writeFileSync(path, JSON.stringify({ ...minimal, maintenance_hour: 24 }));
    expect(fieldOf(() => loadHubConfig(path))).toBe('maintenance_hour');
  });

  it('[00 §10 #122] atomic write: mode 0600, no .tmp left, a crash before rename leaves the old file intact', () => {
    dir = mkdtempSync(join(tmpdir(), 'pos-cfg-'));
    const path = join(dir, 'config.json');
    const cfg = HubConfigSchema.parse(minimal);
    writeHubConfigAtomic(path, cfg);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(fs.existsSync(`${path}.tmp`)).toBe(false);
    const before = readFileSync(path, 'utf8');

    expect(() =>
      writeHubConfigAtomic(path, { ...cfg, http_port: 9 }, {
        writeFileSync: fs.writeFileSync,
        fsyncSync: fs.fsyncSync,
        openSync: fs.openSync,
        closeSync: fs.closeSync,
        renameSync() {
          throw new Error('crash');
        },
      }),
    ).toThrow('crash');
    expect(readFileSync(path, 'utf8')).toBe(before);
    expect(fs.existsSync(`${path}.tmp`)).toBe(false);
  });

  it('[00 §3.2] isProvisioned / isConfirmed', () => {
    dir = mkdtempSync(join(tmpdir(), 'pos-cfg-'));
    const blank = HubConfigSchema.parse(minimal);
    expect(isProvisioned(blank)).toBe(false);
    expect(isConfirmed(blank)).toBe(false);

    const provisioned = HubConfigSchema.parse({
      ...minimal,
      provisioned: { tenant_id: 't', branch_id: 'b', branch_name: 'Main', branch_api_key: 'k' },
    });
    expect(isProvisioned(provisioned)).toBe(true);
    expect(isConfirmed(provisioned)).toBe(false);

    const confirmed = HubConfigSchema.parse({
      ...minimal,
      provisioned: { tenant_id: 't', branch_id: 'b', branch_name: 'Main', branch_api_key: 'k', confirmed_at: 1_761_000_000_000 },
    });
    expect(isProvisioned(confirmed)).toBe(true);
    expect(isConfirmed(confirmed)).toBe(true);

    const noKey = HubConfigSchema.parse({
      ...minimal,
      provisioned: { tenant_id: 't', branch_id: 'b', branch_name: 'Main', branch_api_key: '' },
    });
    expect(isProvisioned(noKey)).toBe(false);
  });
});

function fieldOf(run: () => void): string | undefined {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).field;
  }
  throw new Error('expected ConfigError');
}
