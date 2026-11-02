/// <reference types="node" />
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function run(dir: string, env: Record<string, string> = {}) {
  return spawnSync('bash', [join(dir, 'apps/hub/deploy/ship-client.sh'), 'hub.lan'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, ...env, PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}` },
  });
}

// A hub that answers: the service is stopped, the checkout is at HEAD; every other call is logged, and the
// staging copy of FAIL_BUILD fails.
function recordingSsh(dir: string): string {
  const log = join(dir, 'ssh.log');
  writeFileSync(
    join(dir, 'bin/ssh'),
    [
      '#!/usr/bin/env bash',
      'shift',
      'cmd="$*"',
      'case "$cmd" in',
      '  "systemctl is-active hub") echo inactive; exit 0 ;;',
      '  git*rev-parse*) echo "$LOCAL_HEAD"; exit 0 ;;',
      'esac',
      'cat > /dev/null',
      `echo "$cmd" >> '${log}'`,
      'if [ -n "$FAIL_BUILD" ] && [[ "$cmd" == *"tar -C"*"$FAIL_BUILD.new"* ]]; then exit 1; fi',
      'exit 0',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  return log;
}

function head(dir: string): string {
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
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

  it('[01d task 41] stages both builds, then swaps both', () => {
    const dir = checkout(['admin-stock', 'staff']);
    dirs.push(dir);
    const log = recordingSsh(dir);
    const r = run(dir, { LOCAL_HEAD: head(dir), FAIL_BUILD: '' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const calls = readFileSync(log, 'utf8').trim().split('\n');
    const kinds = calls.map((c) => (c.includes('tar -C') ? 'stage' : c.includes("mv '") ? 'swap' : 'other'));
    expect(kinds).toEqual(['stage', 'stage', 'swap', 'swap']);
  });

  it('[01d task 41] a failed staging copy swaps nothing', () => {
    const dir = checkout(['admin-stock', 'staff']);
    dirs.push(dir);
    const log = recordingSsh(dir);
    const r = run(dir, { LOCAL_HEAD: head(dir), FAIL_BUILD: 'staff' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('copy of staff to hub.lan failed; nothing was swapped');
    expect(readFileSync(log, 'utf8')).not.toContain("mv '");
  });
});
