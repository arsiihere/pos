import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { kindOf } from '../../src/alerts/kinds';
import { boot, registerHubProjections } from '../../src/lib/boot';
import type { Projection, ProjectionRegistry } from '../../src/projections/registry';
import { VOID_KIND } from '../../src/voids/contracts';
import { offlineCloud } from '../helpers/stub-cloud';
import { stubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub } from '../helpers/test-hub';

// 04 phase 0 P0.7 (04 §6.6, §3.6, §5): projection `audit` is registered inside registerHubProjections (a no-op fold
// until a2, the real fold since); catchUp writes its first checkpoint row (H-2).

const WALL = 1_761_000_000_000;

function auditCheckpoint(db: { prepare(sql: string): { get(...a: unknown[]): unknown } }, branch: string): unknown {
  return db.prepare('SELECT last_seq FROM projection_checkpoints WHERE branch_id = ? AND projection = ?').get(branch, 'audit');
}

describe('[04 §6.6] projection audit (phase 0 skeleton)', () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[04 §6.6] registerHubProjections registers `audit` once, after 03c print; the a2 fold with reset', () => {
    const seen: Projection[] = [];
    const recording = { register: (p: Projection) => seen.push(p), afterCatchUp: () => undefined } as unknown as ProjectionRegistry;
    registerHubProjections(recording);
    const names = seen.map((p) => p.name);
    expect(names.filter((name) => name === 'audit')).toHaveLength(1);
    expect(names.indexOf('audit')).toBeGreaterThan(names.indexOf('print_config'));
    const audit = seen.find((p) => p.name === 'audit')!;
    // a2 (04 §6.6, AD-2): the real fold — mapped event types + its lookups — with reset.
    expect(audit.eventTypes).toEqual(expect.arrayContaining(['AlertRaised', 'RequestAnswered', 'OrderPlaced', 'ItemVoided']));
    expect(audit.reset).toBeTypeOf('function');
  });

  it('[04 §6.6, §3.6] createTestHub: catchUp writes the audit checkpoint row on the writer branch', async () => {
    const hub = await createTestHub({ provisioned: true });
    cleanups.push(() => hub.close());
    expect(auditCheckpoint(hub.deps.db, hub.deps.config.provisioned!.branch_id)).toEqual({ last_seq: 0 });
  });

  it('[04 §6.6] a booted hub registers kind void_approval and projection audit without throwing; boot writes the checkpoint', async () => {
    const cfg = writeConfig(await freePort());
    cleanups.push(cfg.cleanup);
    const booted = await boot({
      configPath: cfg.path,
      wallNow: () => WALL,
      monoNow: () => 0,
      listen: true,
      configClient: stubConfigCloud(),
      cloudClient: offlineCloud(),
    });
    cleanups.push(() => booted.stop());
    expect(kindOf(VOID_KIND)?.kind).toBe('void_approval');
    const maxSeq = (booted.deps.db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events').get() as { seq: number }).seq;
    expect(auditCheckpoint(booted.deps.db, 'branch-1')).toEqual({ last_seq: maxSeq });
    expect(Object.keys(booted.deps.projections.catchUp(booted.deps.db, 'branch-1').replayed)).toContain('audit');
  });
});

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address !== null ? address.port : 0));
    });
  });
}

function writeConfig(port: number): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pos-audit-wiring-'));
  const dataDir = join(dir, 'data');
  const backupDir = join(dir, 'backup');
  mkdirSync(dataDir);
  mkdirSync(backupDir);
  const path = join(dir, 'config.json');
  writeFileSync(
    path,
    JSON.stringify({
      cloud_base_url: 'https://cloud.example',
      http_port: port,
      data_dir: dataDir,
      backup_dir: backupDir,
      min_client_version: '1.0.0',
      backup_encryption_key: Buffer.alloc(32, 7).toString('base64'),
      advertised_host: '192.168.10.2',
      provisioned: { tenant_id: 'tenant-a', branch_id: 'branch-1', branch_name: 'Main', branch_api_key: 'test-branch-api-key' },
    }),
  );
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
