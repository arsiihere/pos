/// <reference types="node" />
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { issueAdminBootstrap } from '../../src/auth/bootstrap-tokens';
import { writeHubConfigAtomic } from '../../src/config/write';
import { sha256hex } from '../../src/lib/hash';
import { runIssueAdminBootstrap } from '../../src/setup/issue-admin-bootstrap';
import { afterEach, describe, expect, it } from 'vitest';
import { PIN } from '../helpers/fixtures';
import { createTestHub, seedDirectory, type TestHub } from '../helpers/test-hub';

const cleanups: Array<() => Promise<void>> = [];

describe('issue-admin-bootstrap CLI', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #127] after the setup token expires, the CLI prints a new link that opens an admin session; the old link → 401 PAIRING_TOKEN_INVALID; a second run expires the first CLI token; AdminBootstrapTokenIssued { issued_by: \'cli\' } written; works while a TestHub holds the same database file open', async () => {
    const hub = await open();
    await seedDirectory(hub);
    const configPath = writeConfig(hub);
    const setup = hub.deps.writer.run((tx) =>
      issueAdminBootstrap(tx, 'setup', { clock: hub.deps.clock, ids: hub.deps.ids, secrets: hub.deps.secrets }),
    ).result;
    hub.clock.advance(1_800_000);

    const first = await runCli(hub, configPath, ownerUid(hub));
    expect(first.output).toContain(first.url);
    expect(first.output).toContain(new Date(first.expires_at).toISOString());
    expect(first.output.split('\n').length).toBeGreaterThan(3);
    expect(first.url.startsWith('http://192.168.10.2:3000/admin/bootstrap#t=')).toBe(true);
    const opened = await bootstrap(hub, tokenOf(first.url), PIN.a);
    expect(opened.statusCode).toBe(200);
    const session = hub.deps.db
      .prepare('SELECT device_id, kind FROM staff_sessions WHERE session_id = ?')
      .get(opened.json().data.session_id) as { device_id: string | null; kind: string };
    expect(session).toEqual({ device_id: null, kind: 'admin' });
    const old = await bootstrap(hub, setup.token, PIN.a);
    expect(old.statusCode).toBe(401);
    expect(old.json().error.code).toBe('PAIRING_TOKEN_INVALID');
    expect(cliIssues(hub)).toHaveLength(1);

    const replacement = await runCli(hub, configPath, ownerUid(hub));
    const second = await runCli(hub, configPath, ownerUid(hub));
    const expired = hub.deps.db
      .prepare('SELECT expires_at FROM admin_bootstrap_tokens WHERE token_hash = ?')
      .get(sha256hex(tokenOf(replacement.url))) as { expires_at: number };
    hub.clock.set(expired.expires_at);
    const reused = await bootstrap(hub, tokenOf(replacement.url), PIN.a);
    expect(reused.statusCode).toBe(401);
    expect(reused.json().error.code).toBe('PAIRING_TOKEN_INVALID');
    const openedAgain = await bootstrap(hub, tokenOf(second.url), PIN.a);
    expect(openedAgain.statusCode).toBe(200);
    expect(cliIssues(hub).length).toBeGreaterThanOrEqual(3);
  });

  it('[00 §6.34] refuses when unprovisioned and when run as another uid', async () => {
    const bare = await open(false);
    await expect(runCli(bare, writeConfig(bare), ownerUid(bare))).rejects.toThrow('run setup instead');

    const hub = await open();
    const before = cliIssues(hub).length;
    await expect(runCli(hub, writeConfig(hub), ownerUid(hub) + 1)).rejects.toThrow();
    expect(cliIssues(hub)).toHaveLength(before);
  });
});

async function open(provisioned = true): Promise<TestHub> {
  const hub = await createTestHub({ provisioned });
  cleanups.push(() => hub.close());
  return hub;
}

function writeConfig(hub: TestHub): string {
  const configPath = join(hub.deps.config.data_dir, 'config.json');
  writeHubConfigAtomic(configPath, hub.deps.config);
  return configPath;
}

function ownerUid(hub: TestHub): number {
  return statSync(hub.deps.config.data_dir).uid;
}

async function runCli(
  hub: TestHub,
  configPath: string,
  uid: number,
): Promise<{ url: string; expires_at: number; output: string }> {
  let output = '';
  const out = new Writable({
    write(chunk, _encoding, callback) {
      output += String(chunk);
      callback();
    },
  });
  const issued = await runIssueAdminBootstrap({
    configPath,
    wallNow: () => hub.clock.branchNow(),
    monoNow: () => 0,
    uid,
    out,
  });
  return { ...issued, output };
}

function bootstrap(hub: TestHub, token: string, pin: string) {
  return hub.app.inject({
    method: 'POST',
    url: '/admin/auth/bootstrap',
    payload: { bootstrap_token: token, staff_id: 'S_OWNER', pin },
  });
}

function tokenOf(url: string): string {
  return url.slice(url.indexOf('#t=') + 3);
}

function cliIssues(hub: TestHub): Array<{ issued_by: string }> {
  return (
    hub.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'AdminBootstrapTokenIssued'`).all() as Array<{
      payload: string;
    }>
  )
    .map((row) => JSON.parse(row.payload) as { issued_by: string })
    .filter((payload) => payload.issued_by === 'cli');
}
