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

// 05 §10 #89 (task 9), §6.30: the 05 kinds register at module top level, so an open 05 alert in the event log replays
// at boot as a known kind (01d §3.5 / P-8). Deliberately its own file: it imports NOTHING from src/billing/ (nor
// test-hub), so the kinds are loaded only by the real static chain lib/boot.ts -> server.ts -> billing/index.ts ->
// billing/kinds/index.ts (the 02a handover-boot.int.test.ts pattern).

const TENANT = 'tenant-a';
const BRANCH = 'branch-1';
const CASH = 'S_CASH';

describe('[05 #89] 05 kinds at module top level', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const c of cleanups.splice(0)) c();
  });

  it('[05 #89] an open discount request, petty_cash request and fiscal_outbox_stuck alert replayed at boot are known kinds: step 0 due at raised_at, no unknown_kind line', async () => {
    const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
    const dir = mkdtempSync(join(tmpdir(), 'pos-05-kinds-'));
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
    const request = (right_mode: 'approval' | 'holders', base_permission: string, approver_role_ids: string[]) => ({
      answers: ['approve', 'reject'],
      right_mode,
      base_permission,
      range_permission: null,
      approver_role_ids,
      receiver_staff_id: null,
      needs_pin: 'always',
    });
    const raised = [
      anAlertRaised({
        stream_type: 'bill',
        stream_id: 'B1',
        payload: {
          alert_id: 'DISC1',
          kind: 'discount',
          family: 'urgent',
          subject_stream_type: 'bill',
          subject_stream_id: 'B1',
          dedupe_key: 'discount:B1',
          requester_staff_id: CASH,
          target: { kind: 'answerers' },
          values: { bill_id: 'B1', kind: 'percent', value: 1_000, reason_code: 'regular_customer', note_id: null, has_note: false },
          display: { kind_label_key: 'alert.discount.lock' },
          details: { amount: 50_000, reason: 'regular_customer', identifier: 'T4' },
          request: request('approval', 'apply-discount', ['R_MGR']),
        },
      }),
      anAlertRaised({
        stream_type: 'shift',
        stream_id: 'SH1',
        payload: {
          alert_id: 'PETTY1',
          kind: 'petty_cash',
          family: 'urgent',
          subject_stream_type: 'shift',
          subject_stream_id: 'SH1',
          dedupe_key: 'petty:CMD1',
          requester_staff_id: CASH,
          target: { kind: 'answerers' },
          values: { entry_id: 'E1', kind: 'out', shift_id: 'SH1', amount_minor: 600_000, category_id: 'supplies', has_paid_to: false, advance_staff_id: null, has_note: false },
          display: { kind_label_key: 'alert.petty_cash.lock' },
          details: { amount: 600_000, reason: 'supplies' },
          request: request('holders', 'close-shift-for-others', []),
        },
      }),
      anAlertRaised({
        payload: {
          alert_id: 'STUCK1',
          kind: 'fiscal_outbox_stuck',
          family: 'action',
          subject_stream_type: 'hub',
          subject_stream_id: BRANCH,
          dedupe_key: `fiscal_stuck:${BRANCH}`,
          requester_staff_id: null,
          target: { kind: 'managers' },
          values: {},
          display: { kind_label_key: 'alert.fiscal_outbox_stuck.lock' },
          details: { quantity: 1, minutes_late: 31 },
          request: null,
        },
      }),
    ];
    const insert = db.prepare(
      `INSERT INTO events (
        event_id, tenant_id, branch_id, stream_type, stream_id, event_type,
        schema_version, payload, occurred_at, recorded_at, actor_id, device_id, seq
      ) VALUES (?, ?, ?, ?, ?, ?, 5, ?, ?, ?, ?, ?, ?)`,
    );
    raised.forEach((e, i) => insert.run(`evt-${i + 1}`, TENANT, BRANCH, e.stream_type, e.stream_id, e.event_type, JSON.stringify(e.payload), T, T, CASH, e.device_id, i + 1));
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
      const rows = booted.deps.db.prepare(`SELECT alert_id, kind, state, step, next_due_at FROM alerts ORDER BY alert_id`).all();
      // a known kind has step 0 pending at raised_at; the P-8 unknown-kind path would persist next_due_at NULL
      expect(rows).toEqual([
        { alert_id: 'DISC1', kind: 'discount', state: 'open', step: -1, next_due_at: T },
        { alert_id: 'PETTY1', kind: 'petty_cash', state: 'open', step: -1, next_due_at: T },
        { alert_id: 'STUCK1', kind: 'fiscal_outbox_stuck', state: 'open', step: -1, next_due_at: T },
      ]);
      expect(capture.text()).not.toContain('unknown_kind');
    } finally {
      await booted.stop();
    }
  });
});
