import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/connection';
import { runMigrations } from '../../src/db/migrate';
import { boot } from '../../src/lib/boot';
import { fixedClock, T } from '../../src/lib/clock';
import { registerPrintBootSteps, resumePrintQueue } from '../../src/print/boot';
import { createLogCapture } from '../helpers/log-capture';
import { statementCounter } from '../helpers/statement-counter';
import { offlineCloud } from '../helpers/stub-cloud';
import { stubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub } from '../helpers/test-hub';
import { fakeLanPrinter } from './fixtures';

// 03c §3.7, F §5.8 step 5, H-11 (task c16): resumePrintQueue at boot step 5 and the worker started after listen,
// end to end through the real boot(). The printer is a real TCP fake on 127.0.0.1; waits poll for a condition.
const TENANT = 'tenant-a';
const BRANCH = 'branch-1';
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 1_000; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition never held');
}

describe('[03c §3.7] resumePrintQueue (boot step 5)', () => {
  it('[03c #24] sent-not-acked → is_reprint = 1, sent_at NULL; acked / cancelled / unsent rows untouched; 1 statement', async () => {
    const hub = await createTestHub({ provisioned: true });
    cleanups.push(() => hub.close());
    const ins = hub.deps.db.prepare(
      `INSERT INTO print_jobs (job_id, kind, printer_id, payload, created_at, sent_at, acked_at, cancelled_at) VALUES (?, 'document', 'PR1', '{}', 1, ?, ?, ?)`,
    );
    ins.run('SENT', 5, null, null);
    ins.run('ACKED', 5, 6, null);
    ins.run('CANCELLED', 5, null, 6);
    ins.run('WAITING', null, null, null);
    const counter = statementCounter(hub.deps.db);
    expect(resumePrintQueue({ db: hub.deps.db })).toBe(1);
    expect(counter.count).toBe(1);
    expect(hub.deps.db.prepare('SELECT job_id, sent_at, is_reprint FROM print_jobs ORDER BY job_id').all()).toEqual([
      { job_id: 'ACKED', sent_at: 5, is_reprint: 0 },
      { job_id: 'CANCELLED', sent_at: 5, is_reprint: 0 },
      { job_id: 'SENT', sent_at: null, is_reprint: 1 },
      { job_id: 'WAITING', sent_at: null, is_reprint: 0 },
    ]);
  });
});

describe('[03c §3.7, H-11] restart end to end', () => {
  it('[03c #24] a hub that stopped mid-print boots, re-sends the job once with REPRINT through the worker it started after listen, and stops it', async () => {
    const p = await fakeLanPrinter();
    cleanups.push(() => p.close());
    const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
    const dir = mkdtempSync(join(tmpdir(), 'pos-03c-boot-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const dataDir = join(dir, 'data');
    mkdirSync(dataDir);
    const configPath = join(dir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        cloud_base_url: 'https://cloud.example',
        http_port: 3000,
        data_dir: dataDir,
        backup_dir: dataDir,
        min_client_version: '1.0.0',
        backup_encryption_key: Buffer.alloc(32, 7).toString('base64'),
        advertised_host: '192.168.10.2',
        provisioned: { tenant_id: TENANT, branch_id: BRANCH, branch_name: 'Main', branch_api_key: 'k' },
      }),
    );
    const db = openDb(join(dataDir, 'hub.sqlite'));
    await runMigrations(db, { dir: migrations, clock: fixedClock(T) });
    // the printer comes from the event log (print_config is rebuilt at boot); the job row is the worker's own state
    db.prepare(
      `INSERT INTO events (event_id, tenant_id, branch_id, stream_type, stream_id, event_type, schema_version, payload,
                           occurred_at, recorded_at, actor_id, device_id, seq)
       VALUES ('evt-1', ?, ?, 'hub', ?, 'PrinterSaved', 1, ?, ?, ?, NULL, 'hub-admin', 1)`,
    ).run(
      TENANT,
      BRANCH,
      BRANCH,
      JSON.stringify({ printer_id: 'PR1', name: 'Bill printer', connection: 'lan', address: p.address, paper_width_mm: 80, archived: false }),
      T,
      T,
    );
    db.prepare(
      `INSERT INTO print_jobs (job_id, kind, printer_id, payload, created_at, sent_at, sent_printer_id) VALUES ('DOC', 'document', 'PR1', ?, ?, ?, 'PR1')`,
    ).run(JSON.stringify({ doc: { blocks: [{ text: 'BILL 42' }, { cut: true }] } }), T, T);
    db.close();

    registerPrintBootSteps();
    const capture = createLogCapture();
    const booted = await boot({
      configPath,
      wallNow: () => T + 10_000,
      monoNow: () => 0,
      logStream: capture.stream,
      configClient: stubConfigCloud(),
      cloudClient: offlineCloud(),
    });
    let stopped = false;
    cleanups.push(async () => {
      if (!stopped) await booted.stop();
    });
    expect(booted.step()).toBe('8');
    const row = () =>
      booted.deps.db.prepare('SELECT is_reprint, acked_at, sent_printer_id FROM print_jobs WHERE job_id = ?').get('DOC') as {
        is_reprint: number;
        acked_at: number | null;
        sent_printer_id: string | null;
      };
    await until(() => row().acked_at !== null);
    expect(row()).toMatchObject({ is_reprint: 1, sent_printer_id: 'PR1' });
    await until(() => p.received().toString('latin1').includes('BILL 42'));
    const text = p.received().toString('latin1');
    expect(text).toContain('REPRINT');
    expect(text.split('BILL 42')).toHaveLength(2); // once
    await booted.stop();
    stopped = true;
    // stopped: the job is never printed again (no loop left running); a status read already on the wire may still land
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(p.received().toString('latin1').split('BILL 42')).toHaveLength(2);
  }, 30_000); // a real boot under a loaded CI box; no duration is asserted
});
