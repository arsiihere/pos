/// <reference types="node" />
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// 01d task 41 (01a S39 d): ship-client.sh ships admin-stock and staff, and refuses before any ssh when either
// build is missing. The script has no other test, so it runs in a throwaway git checkout with a fake `ssh`
// that fails the test if it is ever called.
const SCRIPT = fileURLToPath(new URL('../../deploy/ship-client.sh', import.meta.url));

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
}

function checkout(builds: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'ship-client-'));
  mkdirSync(join(dir, 'apps/hub/deploy'), { recursive: true });
  copyFileSync(SCRIPT, join(dir, 'apps/hub/deploy/ship-client.sh'));
  writeFileSync(join(dir, '.gitignore'), 'dist/\nbin/\n');
  git(dir, 'init', '-q');
  git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.');
  git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init');
  for (const build of builds) {
    mkdirSync(join(dir, 'apps/client/dist', build), { recursive: true });
    writeFileSync(join(dir, 'apps/client/dist', build, 'index.html'), '<!doctype html>');
  }
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'bin/ssh'), '#!/usr/bin/env bash\necho "ssh must not run" >&2\nexit 99\n', { mode: 0o755 });
  return dir;
}

function run(dir: string) {
  return spawnSync('bash', [join(dir, 'apps/hub/deploy/ship-client.sh'), 'hub.lan'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}` },
  });
}

describe('ship-client.sh', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('[01d task 41] parses (bash -n)', () => {
    expect(spawnSync('bash', ['-n', SCRIPT]).status).toBe(0);
  });

  it('[01d task 41] refuses when dist/staff/index.html is missing, before any ssh', () => {
    const dir = checkout(['admin-stock']);
    dirs.push(dir);
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('build output missing: apps/client/dist/staff/index.html');
    expect(r.stderr).not.toContain('ssh must not run');
  });

  it('[01a S39 d] still refuses when dist/admin-stock/index.html is missing', () => {
    const dir = checkout(['staff']);
    dirs.push(dir);
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('build output missing: apps/client/dist/admin-stock/index.html');
  });

  it('[01d task 41] with both builds it goes on to the hub check (the fake ssh answers)', () => {
    const dir = checkout(['admin-stock', 'staff']);
    dirs.push(dir);
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('ssh must not run');
  });
});
