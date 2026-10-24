import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const cleanups: Array<() => void> = [];

describe('hub entry', () => {
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('[00 §7.7] node --import tsx src/main.ts reads POS_HUB_CONFIG, the systemd ExecStart form', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pos-main-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const configPath = join(dir, 'config.json');
    writeFileSync(configPath, '{}');
    const run = spawnSync(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
      cwd: join(import.meta.dirname, '../..'),
      env: { ...process.env, POS_HUB_CONFIG: configPath },
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).not.toContain('/etc/pos-hub');
    expect(run.stderr).toMatch(/Invalid input/);
  }, 40_000);
});
