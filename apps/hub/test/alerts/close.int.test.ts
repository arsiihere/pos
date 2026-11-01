import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EventDraft, PosEvent } from '@pos/events';
import { anAlertRaised, aRequestAnswered } from '@pos/events/testing';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kindOf } from '../../src/alerts/kinds';
import { alerts, bindAlertEnv, type AlertCtx, type RaiseInput } from '../../src/alerts/raise';
import { StaffDirectory, type DirectoryCore } from '../../src/auth/staff-directory';
import type { CommandCtx } from '../../src/commands/registry';
import { openDb } from '../../src/db/connection';
import { runMigrations } from '../../src/db/migrate';
import { createAuthGeneration } from '../../src/engine-host/auth-generation';
import { readOnlyTx } from '../../src/engine-host/read-only-tx';
import { createStateHolder } from '../../src/engine-host/state-holder';
import { createWriter, type Writer, type WriterTx } from '../../src/engine-host/writer';
import { boot } from '../../src/lib/boot';
import { fixedClock, T } from '../../src/lib/clock';
import { testIdGen } from '../../src/lib/ids';
import { registerAlertProjections } from '../../src/projections/alerts';
import { createProjectionRegistry } from '../../src/projections/registry';
import type { WsHub } from '../../src/ws/server';
import { freshDb } from '../helpers/db';
import { createLogCapture } from '../helpers/log-capture';
import { statementCounter } from '../helpers/statement-counter';
import { offlineCloud } from '../helpers/stub-cloud';
import { stubConfigCloud } from '../helpers/stub-config-cloud';
import { registerFakes, resetFakes } from './fakes';

// 01d §6.1 close, §4.2 close / closeMany / listOpen / byDedupeKey / tickCtx, §3.3 "Close by the owning
// module", §3.10 request_result, test #14, on a migrated hub database with the alert projections.

const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const TENANT = 'tenant-1';
const BRANCH = 'branch-1';
const IMRAN = 'S_IMRAN'; // manager, approve-void branch scope
const ALI = 'S_ALI'; // waiter, void-item requires approval
const ALI_DEV = 'D_ALI';
const IMRAN_DEV = 'D_IMRAN';

type Grant = DirectoryCore['roles'][number]['permissions'][number];
const grant = (g: Omit<Grant, 'approver_role_ids'> & { approver_role_ids?: string[] }): Grant => ({ ...g, approver_role_ids: g.approver_role_ids ?? [] });
const person = (staff_id: string, role_ids: string[], lead_staff_id: string | null): DirectoryCore['staff'][number] => ({
  staff_id,
  display_name: staff_id,
  pin_hash: 'h',
  role_ids,
  denied_permissions: [],
  lead_staff_id,
  floor_ids: [],
});

const dir = StaffDirectory.fromInput({
  directory_version: 1,
  roles: [
    { role_id: 'R2', name: 'r2', session_idle_ttl_ms: 300_000, permissions: [grant({ permission: 'approve-void', grant_type: 'allowed', scope: 'branch' })] },
    {
      role_id: 'R4',
      name: 'r4',
      session_idle_ttl_ms: 300_000,
      permissions: [grant({ permission: 'void-item', grant_type: 'requires_approval', approver_role_ids: ['R2'], scope: 'own_tables' })],
    },
  ],
  staff: [person(IMRAN, ['R2'], null), person(ALI, ['R4'], IMRAN)],
  responsibilities: [],
});

function draft(event: PosEvent): EventDraft {
  return {
    stream_type: event.stream_type,
    stream_id: event.stream_id,
    event_type: event.event_type,
    schema_version: event.schema_version,
    payload: event.payload,
    occurred_at: event.occurred_at,
    actor_id: event.actor_id,
    device_id: event.device_id,
  };
}

interface Harness {
  db: Database.Database;
  writer: Writer;
  clock: ReturnType<typeof fixedClock>;
}

async function harness(cleanups: Array<() => void>): Promise<Harness> {
  const fx = freshDb();
  cleanups.push(fx.cleanup);
  const clock = fixedClock(T);
  await runMigrations(fx.db, { dir: migrations, clock });
  const registry = createProjectionRegistry();
  registerAlertProjections(registry);
  const state = createStateHolder({});
  state.setReducer((current) => current);
  const writer = createWriter({
    db: fx.db,
    clock,
    ids: testIdGen(),
    tenantId: TENANT,
    branchId: BRANCH,
    projections: registry,
    state,
    authGeneration: createAuthGeneration(),
    publish: () => undefined,
  });
  const hub = { connectedSessions: () => [], alertSockets: () => [] } as unknown as WsHub;
  bindAlertEnv(fx.db, { directory: () => dir, ws: () => hub });
  return { db: fx.db, writer, clock };
}

function cmdCtx(tx: WriterTx, staffId: string = IMRAN, deviceId: string = IMRAN_DEV): AlertCtx {
  const ctx = {
    tx,
    state: {},
    clock: tx.clock,
    ids: tx.ids,
    actor: { kind: 'staff', staffId, stationId: null, sessionId: 'SESS', deviceId },
    branch: { tenantId: TENANT, branchId: BRANCH },
    directory: dir,
    get permission(): never {
      throw new Error('close read ctx.permission');
    },
  };
  return ctx as unknown as CommandCtx;
}

const display = { kind_label_key: 'alert.t_approval.kind', table_code: '12', requester_name: 'Ali' };
const voidInput = (n: number | string = 1): RaiseInput => ({
  kind: 't_approval',
  subject: { stream_type: 'order', stream_id: `O${n}` },
  target: { kind: 'answerers' },
  values: { order_id: `O${n}` },
  display,
  details: { item: 'Mutton platter', quantity: 1, amount: 480_000, reason: 'customer changed mind' },
  dedupe_key: `void:O${n}:L1`,
  requester_staff_id: ALI,
  request: { approver_role_ids: ['R2'] },
});
const infoInput = (key: string, stream_id = BRANCH): RaiseInput => ({
  kind: 't_info',
  subject: { stream_type: 'hub', stream_id },
  target: { kind: 'person', staff_id: IMRAN },
  display: { kind_label_key: 'alert.t_info.kind' },
  dedupe_key: key,
});

/** Raises (as ALI on his tablet) and appends; returns the alert ids. */
function raiseAll(h: Harness, inputs: RaiseInput[]): string[] {
  return h.writer.run((tx) => {
    const results = alerts.raiseMany(cmdCtx(tx, ALI, ALI_DEV), inputs);
    tx.append(results.flatMap((r) => r.events));
    return results.map((r) => r.alert_id);
  }).result;
}

function types(events: EventDraft[]): string[] {
  return events.map((e) => e.event_type);
}

function row(db: Database.Database, alertId: string): Record<string, unknown> | undefined {
  return db.prepare('SELECT * FROM alerts WHERE alert_id = ?').get(alertId) as Record<string, unknown> | undefined;
}

describe('01d alerts.close / closeMany / listOpen / byDedupeKey / tickCtx, request_result', () => {
  const cleanups: Array<() => void> = [];
  beforeEach(() => registerFakes());
  afterEach(() => {
    vi.restoreAllMocks();
    resetFakes();
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("[01d #14] alerts.close(…, 'obsolete') on a request → AlertClosed + request_result to the requester; close after answer → no events", async () => {
    const h = await harness(cleanups);
    const [req, answered] = raiseAll(h, [voidInput(1), voidInput(2)]) as [string, string];
    h.clock.advance(1_000);

    const { result: events, appended } = h.writer.run((tx) => {
      const out = alerts.close(cmdCtx(tx), req, 'obsolete', 'stale at day close');
      tx.append(out);
      return out;
    });
    expect(types(events)).toEqual(['AlertClosed', 'AlertRaised', 'AttemptSent']);
    expect(events[0]).toMatchObject({
      stream_type: 'order',
      stream_id: 'O1',
      actor_id: IMRAN,
      device_id: IMRAN_DEV,
      occurred_at: T + 1_000,
      payload: { alert_id: req, reason: 'obsolete', by_staff_id: IMRAN, note: 'stale at day close' },
    });
    const result = events[1] as EventDraft;
    const resultId = (result.payload as { alert_id: string }).alert_id;
    expect(result).toMatchObject({ stream_type: 'order', stream_id: 'O1', actor_id: IMRAN, device_id: IMRAN_DEV });
    expect(result.payload).toEqual({
      alert_id: resultId,
      kind: 'request_result',
      family: 'info',
      subject_stream_type: 'order',
      subject_stream_id: 'O1',
      dedupe_key: `request_result:${req}`,
      requester_staff_id: null,
      target: { kind: 'person', staff_id: ALI },
      values: { request_alert_id: req, request_kind: 't_approval', close_reason: 'obsolete', decision: null, by_staff_id: IMRAN },
      display,
      details: { reason: 'stale at day close' },
      hidden_from: null,
      request: null,
    });
    expect(events[2]?.payload).toMatchObject({
      alert_id: resultId,
      step: 0,
      recipients: [{ staff_id: ALI, device_id: null, for_staff_id: null, set: 'recipient' }],
    });
    expect(appended).toHaveLength(3);
    expect(row(h.db, req)).toMatchObject({ state: 'closed', close_reason: 'obsolete', closed_by_staff_id: IMRAN });
    expect(row(h.db, resultId)).toMatchObject({ kind: 'request_result', state: 'open', step: 0, next_due_at: null, raised_device_id: IMRAN_DEV });
    expect(h.db.prepare('SELECT staff_id FROM alert_inbox WHERE alert_id = ?').all(resultId)).toEqual([{ staff_id: ALI }]);

    // close after answer → no events
    h.writer.run((tx) =>
      tx.append([draft(aRequestAnswered({ stream_type: 'order', stream_id: 'O2', payload: { alert_id: answered, answerer_staff_id: IMRAN } }))]),
    );
    expect(row(h.db, answered)).toMatchObject({ state: 'closed', close_reason: 'answered' });
    expect(h.writer.run((tx) => alerts.close(cmdCtx(tx), answered, 'obsolete', 'late')).result).toEqual([]);
  });

  it("[01d §3.3] 'overridden' also raises request_result; 'done' / 'undone' raise none; a non-request gets none; closed → []", async () => {
    const h = await harness(cleanups);
    const [a, b, c, info] = raiseAll(h, [voidInput(1), voidInput(2), voidInput(3), infoInput('i1')]) as [string, string, string, string];
    const out = h.writer.run((tx) => {
      const r = {
        overridden: alerts.close(cmdCtx(tx), a, 'overridden'),
        done: alerts.close(cmdCtx(tx), b, 'done'),
        undone: alerts.close(cmdCtx(tx), c, 'undone'),
        info: alerts.close(cmdCtx(tx), info, 'obsolete', 'x'),
      };
      tx.append(Object.values(r).flat());
      return r;
    }).result;
    expect(types(out.overridden)).toEqual(['AlertClosed', 'AlertRaised', 'AttemptSent']);
    expect(out.overridden[0]?.payload).toEqual({ alert_id: a, reason: 'overridden', by_staff_id: IMRAN, note: null });
    expect(out.overridden[1]?.payload).toMatchObject({
      kind: 'request_result',
      values: { request_alert_id: a, close_reason: 'overridden', decision: null, by_staff_id: IMRAN },
      details: {},
    });
    expect(types(out.done)).toEqual(['AlertClosed']);
    expect(types(out.undone)).toEqual(['AlertClosed']);
    expect(types(out.info)).toEqual(['AlertClosed']);
    for (const id of [a, b, c, info]) expect(row(h.db, id)?.state).toBe('closed');
    expect(h.db.prepare(`SELECT COUNT(*) AS n FROM alerts WHERE kind = 'request_result'`).get()).toEqual({ n: 1 });
    // closing a closed alert, or an id the hub no longer has (retention), is a no-op
    expect(h.writer.run((tx) => alerts.close(cmdCtx(tx), a, 'obsolete')).result).toEqual([]);
    expect(h.writer.run((tx) => alerts.close(cmdCtx(tx), 'NO_SUCH_ALERT', 'done')).result).toEqual([]);
  });

  it('[01d §3.3] a second close of the same alert in one transaction returns [] (before or after the append)', async () => {
    const h = await harness(cleanups);
    const [a] = raiseAll(h, [voidInput(1)]) as [string];
    const r = h.writer.run((tx) => {
      const first = alerts.close(cmdCtx(tx), a, 'obsolete');
      const second = alerts.close(cmdCtx(tx), a, 'obsolete');
      const many = alerts.closeMany(cmdCtx(tx), [{ alert_id: a, reason: 'done' }]);
      tx.append(first);
      const after = alerts.close(cmdCtx(tx), a, 'done');
      return { first, second, many, after };
    }).result;
    expect(types(r.first)).toEqual(['AlertClosed', 'AlertRaised', 'AttemptSent']);
    expect(r.second).toEqual([]);
    expect(r.many).toEqual([]);
    expect(r.after).toEqual([]);
  });

  it("[01d §4.2] a reason outside done / obsolete / overridden / undone throws (the tick's 'expired' is not an owner close)", async () => {
    const h = await harness(cleanups);
    const [a] = raiseAll(h, [voidInput(1)]) as [string];
    expect(() => h.writer.run((tx) => alerts.close(cmdCtx(tx), a, 'expired' as never))).toThrow(/reason/);
    expect(row(h.db, a)?.state).toBe('open');
  });

  it('[01d §4.2] closeMany of 10 requests → one alert read and one raiseMany; the same statement count as one close', async () => {
    const h = await harness(cleanups);
    const ids = raiseAll(h, Array.from({ length: 11 }, (_, i) => voidInput(i + 1)));
    const one = ids.slice(0, 1);
    const ten = ids.slice(1);
    const spy = vi.spyOn(alerts, 'raiseMany');
    const counter = statementCounter(h.db);

    const measure = (batch: string[]): { count: number; events: EventDraft[] } =>
      h.writer.run((tx) => {
        counter.reset();
        const events = alerts.closeMany(
          cmdCtx(tx),
          batch.map((alert_id) => ({ alert_id, reason: 'obsolete' as const, note: 'day close' })),
        );
        const count = counter.count;
        tx.append(events);
        return { count, events };
      }).result;

    const single = measure(one);
    spy.mockClear();
    const many = measure(ten);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[1]).toHaveLength(10);
    // 1 alert read + raiseMany(request_result): 1 dedupe + 5 fixed reads + R 0 (person) + T 1 (fake pager)
    expect(single.count).toBe(8);
    expect(many.count).toBe(single.count);
    expect(many.events.filter((e) => e.event_type === 'AlertClosed')).toHaveLength(10);
    expect(many.events.filter((e) => e.event_type === 'AlertRaised')).toHaveLength(10);
    // each close is followed by its own request_result
    expect(types(many.events.slice(0, 3))).toEqual(['AlertClosed', 'AlertRaised', 'AttemptSent']);
    expect(h.db.prepare(`SELECT COUNT(*) AS n FROM alerts WHERE kind = 'request_result' AND state = 'open'`).get()).toEqual({ n: 11 });
  });

  it('[01d §4.2] closeMany of non-requests issues the alert read only (no raiseMany)', async () => {
    const h = await harness(cleanups);
    const ids = raiseAll(h, [infoInput('a'), infoInput('b'), infoInput('c')]);
    const spy = vi.spyOn(alerts, 'raiseMany');
    const counter = statementCounter(h.db);
    const r = h.writer.run((tx) => {
      counter.reset();
      const events = alerts.closeMany(
        cmdCtx(tx),
        ids.map((alert_id) => ({ alert_id, reason: 'done' as const })),
      );
      return { events, count: counter.count };
    }).result;
    expect(spy).not.toHaveBeenCalled();
    expect(r.count).toBe(1);
    expect(types(r.events)).toEqual(['AlertClosed', 'AlertClosed', 'AlertClosed']);
  });

  it('[01d §4.2] listOpen({ kind }) oldest first in 1 statement, as AlertRecord; subject narrows; closed alerts are left out', async () => {
    const h = await harness(cleanups);
    const [first] = raiseAll(h, [voidInput(1)]) as [string];
    h.clock.advance(1_000);
    const [second] = raiseAll(h, [voidInput(2)]) as [string];
    h.clock.advance(1_000);
    const [third, info] = raiseAll(h, [voidInput(3), infoInput('i1')]) as [string, string];
    h.writer.run((tx) => tx.append(alerts.close(cmdCtx(tx), third, 'done')));

    const counter = statementCounter(h.db);
    const listed = alerts.listOpen(h.db, { kind: 't_approval' });
    expect(counter.count).toBe(1);
    expect(listed.map((a) => a.alert_id)).toEqual([first, second]);
    expect(listed[0]).toEqual({
      alert_id: first,
      kind: 't_approval',
      family: 'urgent',
      subject: { stream_type: 'order', stream_id: 'O1' },
      dedupe_key: 'void:O1:L1',
      requester_staff_id: ALI,
      receiver_staff_id: null,
      raised_device_id: ALI_DEV,
      values: { order_id: 'O1' },
      display,
      details: { item: 'Mutton platter', quantity: 1, amount: 480_000, reason: 'customer changed mind' },
      step: 2, // no answerer has a route: the G1-9d shortcut wrote step 2 at raise
      raised_at: T,
    });

    counter.reset();
    const bySubject = alerts.listOpen(h.db, { kind: 't_approval', subject: { stream_type: 'order', stream_id: 'O2' } });
    expect(counter.count).toBe(1);
    expect(bySubject.map((a) => a.alert_id)).toEqual([second]);

    counter.reset();
    const all = alerts.listOpen(h.db, {});
    expect(counter.count).toBe(1);
    expect(all.map((a) => a.alert_id)).toEqual([first, second, info]);
    expect(all[2]).toMatchObject({ kind: 't_info', details: null, requester_staff_id: null });
  });

  it('[01d §4.2] byDedupeKey → the open alert id or null, 1 statement; namespaced by kind; null once closed', async () => {
    const h = await harness(cleanups);
    const [a] = raiseAll(h, [voidInput(1)]) as [string];
    const counter = statementCounter(h.db);
    expect(alerts.byDedupeKey(h.db, 't_approval', 'void:O1:L1')).toBe(a);
    expect(counter.count).toBe(1);
    counter.reset();
    expect(alerts.byDedupeKey(h.db, 't_info', 'void:O1:L1')).toBeNull();
    expect(counter.count).toBe(1);
    h.writer.run((tx) => tx.append(alerts.close(cmdCtx(tx), a, 'done')));
    expect(alerts.byDedupeKey(h.db, 't_approval', 'void:O1:L1')).toBeNull();
  });

  it("[01d §4.2] tickCtx(tx, now) = { tx, now, actor_id: null, device_id: 'hub', session: null, permission: null }; a raise through it has raised_device_id 'hub'", async () => {
    const h = await harness(cleanups);
    const [req] = raiseAll(h, [voidInput(1)]) as [string];
    const r = h.writer.run((tx) => {
      const ctx = alerts.tickCtx(tx, T + 7);
      expect(ctx).toEqual({ tx, now: T + 7, actor_id: null, device_id: 'hub', session: null, permission: null });
      const raised = alerts.raise(ctx, infoInput('tick'));
      const closed = alerts.close(ctx, req, 'obsolete');
      tx.append([...raised.events, ...closed]);
      return { raised, closed };
    }).result;
    expect(row(h.db, r.raised.alert_id)).toMatchObject({ raised_device_id: 'hub', state: 'open' });
    expect(r.closed[0]).toMatchObject({ actor_id: null, device_id: 'hub', occurred_at: T + 7, payload: { by_staff_id: null } });
    expect(r.closed[1]?.payload).toMatchObject({ kind: 'request_result', values: { by_staff_id: null } });
    expect(row(h.db, (r.closed[1]?.payload as { alert_id: string }).alert_id)).toMatchObject({ raised_device_id: 'hub' });
  });

  it("[01d §3.10] request_result kind: info, step 0 to the raised person, closes_on 'seen', lead_fallback false, labels (§3.12)", () => {
    const kind = kindOf('request_result');
    expect(kind).toMatchObject({
      kind: 'request_result',
      family: 'info',
      steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] }],
      closes_on: 'seen',
      lead_fallback: false,
      expires_at_day_close: true,
      silent: false,
      labels: { card: 'alert.request_result.card', lock: 'alert.request_result.lock' },
      request: null,
    });
    expect(kind?.details_schema?.safeParse({ amount: 1 }).success).toBe(false);
    expect(kind?.details_schema?.safeParse({ reason: 'x' }).success).toBe(true);
  });

  it('[01d §3.10] a request without a requester (tick-raised) closed obsolete gets no request_result', async () => {
    const h = await harness(cleanups);
    const [a] = h.writer.run((tx) => {
      const r = alerts.raiseMany(alerts.tickCtx(tx, T), [{ ...voidInput(1), requester_staff_id: null }]);
      tx.append(r.flatMap((x) => x.events));
      return r.map((x) => x.alert_id);
    }).result as [string];
    expect(types(h.writer.run((tx) => alerts.close(cmdCtx(tx), a, 'obsolete')).result)).toEqual(['AlertClosed']);
  });

  it('[01d §3.10 positive control] an AlertRaised of request_result replayed at boot is a known kind: no unknown_kind line', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pos-01d-rr-'));
    cleanups.push(() => rmSync(tmp, { recursive: true, force: true }));
    const dataDir = join(tmp, 'data');
    mkdirSync(dataDir);
    const configPath = join(tmp, 'config.json');
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
    const rr = anAlertRaised({
      stream_type: 'order',
      stream_id: 'O1',
      payload: {
        alert_id: 'RR1',
        kind: 'request_result',
        subject_stream_type: 'order',
        subject_stream_id: 'O1',
        dedupe_key: 'request_result:REQ1',
        target: { kind: 'person', staff_id: ALI },
        values: { request_alert_id: 'REQ1', request_kind: 'void', close_reason: 'answered', decision: 'approve', by_staff_id: IMRAN },
        display: { kind_label_key: 'alert.void.kind' },
        details: {},
      },
    });
    db.prepare(
      `INSERT INTO events (
        event_id, tenant_id, branch_id, stream_type, stream_id, event_type,
        schema_version, payload, occurred_at, recorded_at, actor_id, device_id, seq
      ) VALUES ('evt-1', ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL, ?, 1)`,
    ).run(TENANT, BRANCH, rr.stream_type, rr.stream_id, rr.event_type, JSON.stringify(rr.payload), T, T, rr.device_id);
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
      // only AlertRaised was replayed: a known kind has step 0 pending at raised_at (§3.5 M1); the P-8
      // unknown-kind path would persist next_due_at NULL
      expect(row(booted.deps.db, 'RR1')).toMatchObject({ kind: 'request_result', state: 'open', step: -1, next_due_at: T });
      expect(capture.text()).not.toContain('unknown_kind');
    } finally {
      await booted.stop();
    }
  });
  it('[01d §3.3 rule 4(d)] closeMany through readOnlyTx(tx) returns AlertClosed + the request_result raise drafts, writing nothing', async () => {
    const h = await harness(cleanups);
    const [a, b] = raiseAll(h, [voidInput('ro1'), voidInput('ro2')]) as [string, string];
    const changes = (): number => (h.db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    const { result, appended } = h.writer.run((tx) => {
      const before = changes();
      const events = alerts.closeMany(cmdCtx(readOnlyTx(tx)), [
        { alert_id: a, reason: 'obsolete', note: 'stale' },
        { alert_id: b, reason: 'overridden' },
      ]);
      return { events, written: changes() - before };
    });
    expect(types(result.events)).toEqual(['AlertClosed', 'AlertRaised', 'AttemptSent', 'AlertClosed', 'AlertRaised', 'AttemptSent']);
    expect(result.events[1]?.payload).toMatchObject({ kind: 'request_result', values: { request_alert_id: a, close_reason: 'obsolete' } });
    expect(result.written).toBe(0);
    expect(appended).toEqual([]);
    expect(row(h.db, a)).toMatchObject({ state: 'open' });
  });
});
