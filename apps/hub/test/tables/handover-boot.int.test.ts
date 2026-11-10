import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { anAlertRaised } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/connection';
import { runMigrations } from '../../src/db/migrate';
import { boot } from '../../src/lib/boot';
import { fixedClock, T } from '../../src/lib/clock';
import { createLogCapture } from '../helpers/log-capture';
import { offlineCloud } from '../helpers/stub-cloud';
import { stubConfigCloud } from '../helpers/stub-config-cloud';

// 02a v1.1.3 §3.9, §11 step 12: the table_handover kind is registered at module top level, so a hub that boots with an
// open handover in its event log replays it as a known kind. Deliberately its own file: it imports NOTHING from
// src/tables/ (nor test-hub, which registers tables), so the kinds are loaded only by the real static import chain
// lib/boot.ts -> server.ts -> tables/index.ts -> tables/kinds.ts. A broken chain would make this test fail instead of
// being masked by a test-side import.

const TENANT = 'tenant-a';
const BRANCH = 'branch-1';
const ALI = 'S_ALI';
const SARA = 'S_SARA';

describe('02a §11 step 12: kinds at module top level', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const c of cleanups.splice(0)) c();
  });

  it('[02a §11 step 12] an open table_handover replayed at boot is a known kind: step 0 due at raised_at, no unknown_kind line', async () => {
    const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
    const dir = mkdtempSync(join(tmpdir(), 'pos-02a-kinds-'));
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
    const raised = anAlertRaised({
      stream_type: 'table',
      stream_id: 'T1',
      payload: {
        alert_id: 'HO1',
        kind: 'table_handover',
        family: 'action',
        subject_stream_type: 'table',
        subject_stream_id: 'T1',
        dedupe_key: 'table_handover:SEAT1',
        requester_staff_id: ALI,
        target: { kind: 'person', staff_id: SARA },
        values: { table_id: 'T1', seating_id: 'SEAT1', from_staff_id: ALI },
        display: { kind_label_key: 'alert.table_handover.lock', table_code: 'Table 1', requester_name: 'Ali' },
        details: {},
        request: {
          answers: ['accept', 'decline'],
          right_mode: 'named',
          base_permission: null,
          range_permission: null,
          approver_role_ids: [],
          receiver_staff_id: SARA,
          needs_pin: 'never',
        },
      },
    });
    db.prepare(
      `INSERT INTO events (
        event_id, tenant_id, branch_id, stream_type, stream_id, event_type,
        schema_version, payload, occurred_at, recorded_at, actor_id, device_id, seq
      ) VALUES ('evt-1', ?, ?, ?, ?, ?, 2, ?, ?, ?, ?, ?, 1)`,
    ).run(TENANT, BRANCH, raised.stream_type, raised.stream_id, raised.event_type, JSON.stringify(raised.payload), T, T, ALI, raised.device_id);
    db.close();
    const capture = createLogCapture();
    const booted = await boot({
      configPath,
      wallNow: () => T + 10_000,
      monoNow: () => 0,
      logStream: capture.stream,
      configClient: stubConfigCloud(),
      cloudClient: offlineCloud(),
    });
    try {
      expect(booted.step()).toBe('8');
      const row = booted.deps.db.prepare('SELECT kind, state, step, next_due_at FROM alerts WHERE alert_id = ?').get('HO1');
      // a known kind has step 0 pending at raised_at; the P-8 unknown-kind path would persist next_due_at NULL
      expect(row).toEqual({ kind: 'table_handover', state: 'open', step: -1, next_due_at: T });
      expect(capture.text()).not.toContain('unknown_kind');
    } finally {
      await booted.stop();
    }
  });
});
