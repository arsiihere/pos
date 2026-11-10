import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BranchConfig, EventDraft } from '@pos/events';
import { anAlertRaised } from '@pos/events/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { kindOf } from '../../src/alerts/kinds';
import { alerts } from '../../src/alerts/raise';
import { currentDirectory } from '../../src/auth/guards';
import type { CommandCtx } from '../../src/commands/registry';
import { openDb } from '../../src/db/connection';
import { runMigrations } from '../../src/db/migrate';
import type { WriterTx } from '../../src/engine-host/writer';
import { boot } from '../../src/lib/boot';
import { fixedClock, T } from '../../src/lib/clock';
import { zoneAlertDrafts } from '../../src/orders/zone-alerts';
import { createLogCapture } from '../helpers/log-capture';
import { statementCounter } from '../helpers/statement-counter';
import { offlineCloud } from '../helpers/stub-cloud';
import { stubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub, seedDirectory, type TestHub } from '../helpers/test-hub';
import { FX, fixtureMenu, openDay } from './fixtures';

// 02b §6.13 kinds zone_stock_low / zone_stock_out, §3.10 Alerts, §6.19 (stream table, 'zone:' + zone_id), §11 step 15.
// The kinds come only through the static chain server.ts -> orders/index.ts -> orders/zone-kinds.ts (test-hub and boot
// both import server.ts); neither this file nor src/orders/zone-alerts.ts imports zone-kinds.ts.

let hub: TestHub | undefined;
const cleanups: Array<() => void> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const c of cleanups.splice(0)) c();
  await hub?.close();
  hub = undefined;
});

type Change = { zone_id: string; item_id: string; before: number; after: number };
const Z2 = 'Z2';
const Z2_ITEM = FX.zoneItem;

/** fixtureMenu plus a second zone Z2 stocking the same item (threshold 3). */
function twoZoneMenu(): BranchConfig {
  const menu = fixtureMenu();
  const floor = menu.floors[0]!;
  const z1 = floor.zones[0]!;
  return { ...menu, floors: [{ ...floor, zones: [z1, { ...z1, zone_id: Z2, name: 'Back', sort_order: 1, routes: [], stock_items: [{ item_id: Z2_ITEM, threshold: 3 }] }] }] };
}

async function started(menu?: BranchConfig): Promise<TestHub> {
  hub = await createTestHub();
  await seedDirectory(hub);
  openDay(hub, menu === undefined ? {} : { menu });
  return hub;
}

function ctxOf(h: TestHub, tx: WriterTx): CommandCtx {
  return {
    tx,
    state: tx.state,
    clock: tx.clock,
    ids: tx.ids,
    actor: { kind: 'device', staffId: 'S_MGR', stationId: null, sessionId: 'SESS', deviceId: 'D1' },
    branch: { tenantId: 'tenant-a', branchId: 'branch-1' },
    directory: currentDirectory(h.app),
    permission: null,
    queuedAt: null,
  } as unknown as CommandCtx;
}

/** Runs zoneAlertDrafts in one writer transaction and appends what it returns. */
function run(h: TestHub, changes: Change[]): EventDraft[] {
  return h.deps.writer.run((tx) => {
    const drafts = zoneAlertDrafts(ctxOf(h, tx), changes);
    if (drafts.length > 0) tx.append(drafts);
    return drafts;
  }).result;
}

const change = (before: number, after: number): Change => ({ zone_id: FX.zone, item_id: FX.zoneItem, before, after });
const openRows = (h: TestHub) =>
  h.deps.db
    .prepare(`SELECT kind, dedupe_key, subject_stream_type, subject_stream_id FROM alerts WHERE state = 'open' ORDER BY kind`)
    .all() as Array<{ kind: string; dedupe_key: string; subject_stream_type: string; subject_stream_id: string }>;
const raisedOf = (drafts: EventDraft[]) => drafts.filter((d) => d.event_type === 'AlertRaised').map((d) => d.payload);
const LOW_KEY = `zone_low:${FX.zone}:${FX.zoneItem}`;
const OUT_KEY = `zone_out:${FX.zone}:${FX.zoneItem}`;

describe('[02b §6.13] kinds zone_stock_low and zone_stock_out', () => {
  it('[02b §6.13] both kinds are defined exactly as §6.13', async () => {
    await started();
    for (const name of ['zone_stock_low', 'zone_stock_out']) {
      const kind = kindOf(name);
      expect(kind, name).toBeDefined();
      expect(kind).toMatchObject({
        kind: name,
        family: 'info',
        subject: 'table',
        steps: [
          {
            at: { ms: 0 },
            to: [
              { target: 'raised_target', set: 'recipient' },
              { target: { kind: 'managers' }, set: 'recipient' },
            ],
          },
        ],
        closes_on: 'owner',
        details_schema: null,
        lead_fallback: false,
        expires_at_day_close: true,
        silent: false,
        labels: { card: `alert.${name}.card`, lock: `alert.${name}.lock` },
        request: null,
      });
      expect(kind!.steps).toHaveLength(1);
      expect(kind!.skip_requester).toBeUndefined();
      const values = kind!.values_schema;
      expect(Object.keys(values.shape).sort()).toEqual(['item_id', 'on_hand', 'threshold', 'zone_id']);
      expect(values.safeParse({ zone_id: 'Z1', item_id: 'I1', on_hand: 0, threshold: 0 }).success).toBe(true);
      for (const bad of [
        { zone_id: '', item_id: 'I1', on_hand: 0, threshold: 0 },
        { zone_id: 'Z1', item_id: '', on_hand: 0, threshold: 0 },
        { zone_id: 'Z1', item_id: 'I1', on_hand: -1, threshold: 0 },
        { zone_id: 'Z1', item_id: 'I1', on_hand: 1.5, threshold: 0 },
        { zone_id: 'Z1', item_id: 'I1', on_hand: 0, threshold: -1 },
      ]) {
        expect(values.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
      }
    }
  });
});

describe('[02b #14 alerts] zoneAlertDrafts (§3.10 Alerts)', () => {
  it('[02b #14 alerts] a count from above threshold to <= it raises zone_stock_low to manage-zone-stock (+ managers at step 0)', async () => {
    const h = await started();
    const drafts = run(h, [change(3, 2)]); // threshold 2
    expect(raisedOf(drafts)).toEqual([
      expect.objectContaining({
        kind: 'zone_stock_low',
        family: 'info',
        subject_stream_type: 'table',
        subject_stream_id: `zone:${FX.zone}`,
        dedupe_key: LOW_KEY,
        target: { kind: 'permission', permission: 'manage-zone-stock' },
        values: { zone_id: FX.zone, item_id: FX.zoneItem, on_hand: 2, threshold: 2 },
        display: { kind_label_key: 'alert.zone_stock_low.lock' },
        details: null,
        request: null,
      }),
    ]);
    // §6.19: on stream table / 'zone:' + zone_id; step 0 sent at raise
    for (const d of drafts) expect([d.stream_type, d.stream_id]).toEqual(['table', `zone:${FX.zone}`]);
    expect(drafts.map((d) => d.event_type)).toEqual(['AlertRaised', 'AttemptSent']);
    expect(openRows(h)).toEqual([{ kind: 'zone_stock_low', dedupe_key: LOW_KEY, subject_stream_type: 'table', subject_stream_id: `zone:${FX.zone}` }]);
  });

  it('[02b #14 alerts] no crossing, no alert: above → above, at/below → lower (not 0), unknown zone item', async () => {
    const h = await started();
    expect(run(h, [change(9, 3), change(2, 1), { zone_id: FX.zone, item_id: FX.naan, before: 5, after: 0 }])).toEqual([]);
    expect(openRows(h)).toEqual([]);
  });

  it('[02b #14 alerts] reaching 0 raises zone_stock_out while the low alert is open; both stay open', async () => {
    const h = await started();
    run(h, [change(3, 2)]);
    const drafts = run(h, [change(2, 0)]);
    expect(raisedOf(drafts)).toEqual([
      expect.objectContaining({
        kind: 'zone_stock_out',
        subject_stream_type: 'table',
        subject_stream_id: `zone:${FX.zone}`,
        dedupe_key: OUT_KEY,
        target: { kind: 'permission', permission: 'manage-zone-stock' },
        values: { zone_id: FX.zone, item_id: FX.zoneItem, on_hand: 0, threshold: 2 },
        display: { kind_label_key: 'alert.zone_stock_out.lock' },
      }),
    ]);
    expect(openRows(h).map((r) => [r.kind, r.dedupe_key])).toEqual([
      ['zone_stock_low', LOW_KEY],
      ['zone_stock_out', OUT_KEY],
    ]);
  });

  it('[02b #14 alerts] above threshold straight to 0 raises both', async () => {
    const h = await started();
    expect(raisedOf(run(h, [change(5, 0)])).map((p) => [p.kind, p.dedupe_key])).toEqual([
      ['zone_stock_low', LOW_KEY],
      ['zone_stock_out', OUT_KEY],
    ]);
  });

  it('[02b #14 alerts] back above the threshold closes both done; still <= threshold closes nothing', async () => {
    const h = await started();
    run(h, [change(5, 0)]);
    expect(run(h, [change(0, 2)])).toEqual([]);
    const ids = h.deps.db.prepare(`SELECT alert_id FROM alerts WHERE state = 'open' ORDER BY kind`).all() as Array<{ alert_id: string }>;
    const drafts = run(h, [change(2, 3)]);
    expect(drafts.map((d) => [d.event_type, d.payload.alert_id, d.payload.reason])).toEqual(ids.map((r) => ['AlertClosed', r.alert_id, 'done']));
    expect(openRows(h)).toEqual([]);
    // a later drop raises a fresh low alert
    expect(raisedOf(run(h, [change(3, 1)])).map((p) => p.kind)).toEqual(['zone_stock_low']);
  });

  it('[02b #14 alerts] one listOpen per zone subject zone:<id>, whatever the number of changes', async () => {
    const h = await started(twoZoneMenu());
    const spy = vi.spyOn(alerts, 'listOpen');
    const counter = statementCounter(h.deps.db);
    const drafts = h.deps.writer.run((tx) => {
      counter.reset();
      const out = zoneAlertDrafts(ctxOf(h, tx), [
        change(9, 8),
        { zone_id: Z2, item_id: Z2_ITEM, before: 9, after: 8 },
        change(8, 7),
        { zone_id: Z2, item_id: Z2_ITEM, before: 8, after: 7 },
      ]);
      return { out, statements: counter.count };
    }).result;
    expect(drafts.out).toEqual([]);
    expect(drafts.statements).toBe(2);
    expect(spy.mock.calls.map(([, o]) => o)).toEqual([
      { subject: { stream_type: 'table', stream_id: `zone:${FX.zone}` } },
      { subject: { stream_type: 'table', stream_id: `zone:${Z2}` } },
    ]);
  });

  it('[02b #14 alerts] uses each zone own threshold (Z2 threshold 3)', async () => {
    const h = await started(twoZoneMenu());
    const drafts = run(h, [{ zone_id: Z2, item_id: Z2_ITEM, before: 4, after: 3 }]);
    expect(raisedOf(drafts)).toEqual([
      expect.objectContaining({ kind: 'zone_stock_low', dedupe_key: `zone_low:${Z2}:${Z2_ITEM}`, subject_stream_id: `zone:${Z2}`, values: { zone_id: Z2, item_id: Z2_ITEM, on_hand: 3, threshold: 3 } }),
    ]);
  });
});

describe('[02b §6.13] kinds at module top level', () => {
  it('[02b §6.13] open zone_stock_low / zone_stock_out replayed at boot are known kinds (no unknown_kind line)', async () => {
    const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
    const dir = mkdtempSync(join(tmpdir(), 'pos-02b-zone-kinds-'));
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
        provisioned: { tenant_id: 'tenant-a', branch_id: 'branch-1', branch_name: 'Main', branch_api_key: 'k' },
      }),
    );
    const db = openDb(join(dataDir, 'hub.sqlite'));
    await runMigrations(db, { dir: migrations, clock: fixedClock(T) });
    const insert = db.prepare(
      `INSERT INTO events (
        event_id, tenant_id, branch_id, stream_type, stream_id, event_type,
        schema_version, payload, occurred_at, recorded_at, actor_id, device_id, seq
      ) VALUES (?, 'tenant-a', 'branch-1', ?, ?, ?, 2, ?, ?, ?, NULL, ?, ?)`,
    );
    [
      { alert_id: 'ZL1', kind: 'zone_stock_low', dedupe_key: 'zone_low:Z1:I_COLA', on_hand: 2 },
      { alert_id: 'ZO1', kind: 'zone_stock_out', dedupe_key: 'zone_out:Z1:I_COLA', on_hand: 0 },
    ].forEach((a, i) => {
      const raised = anAlertRaised({
        stream_type: 'table',
        stream_id: 'zone:Z1',
        payload: {
          alert_id: a.alert_id,
          kind: a.kind,
          family: 'info',
          subject_stream_type: 'table',
          subject_stream_id: 'zone:Z1',
          dedupe_key: a.dedupe_key,
          requester_staff_id: null,
          target: { kind: 'permission', permission: 'manage-zone-stock' },
          values: { zone_id: 'Z1', item_id: 'I_COLA', on_hand: a.on_hand, threshold: 2 },
          display: { kind_label_key: `alert.${a.kind}.lock` },
          details: null,
          request: null,
        },
      });
      insert.run(`evt-${i + 1}`, raised.stream_type, raised.stream_id, raised.event_type, JSON.stringify(raised.payload), T, T, raised.device_id, i + 1);
    });
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
        { alert_id: 'ZL1', kind: 'zone_stock_low', state: 'open', step: -1, next_due_at: T },
        { alert_id: 'ZO1', kind: 'zone_stock_out', state: 'open', step: -1, next_due_at: T },
      ]);
      expect(capture.text()).not.toContain('unknown_kind');
    } finally {
      await booted.stop();
    }
  });
});
