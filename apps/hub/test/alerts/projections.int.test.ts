import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EventDraft, PosEvent } from '@pos/events';
import {
  aBusinessDayClosed,
  aBusinessDayOpened,
  aPresenceSet,
  aRequestAnswered,
  aSessionEnded,
  aSessionStarted,
  aStaffDirectoryApplied,
  anAlertClosed,
  anAlertRaised,
  anAttemptSent,
} from '@pos/events/testing';
import type Database from 'better-sqlite3';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineAlertKind, unregisterAlertKind } from '../../src/alerts/kinds';
import { openDb } from '../../src/db/connection';
import { runMigrations } from '../../src/db/migrate';
import { createAuthGeneration } from '../../src/engine-host/auth-generation';
import { createStateHolder } from '../../src/engine-host/state-holder';
import { createWriter, type Writer } from '../../src/engine-host/writer';
import { boot } from '../../src/lib/boot';
import { fixedClock, T } from '../../src/lib/clock';
import { testIdGen } from '../../src/lib/ids';
import { bindAlertProjectionLog, countStuckAlerts, registerAlertProjections } from '../../src/projections/alerts';
import { createProjectionRegistry, type Projection, type ProjectionRegistry } from '../../src/projections/registry';
import { freshDb } from '../helpers/db';
import { createLogCapture } from '../helpers/log-capture';
import { offlineCloud } from '../helpers/stub-cloud';
import { stubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub } from '../helpers/test-hub';
import { FAKE_STEP_1_MS, registerFakes, resetFakes } from './fakes';

const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const TENANT = 'tenant-1';
const BRANCH = 'branch-1';
const ALI = 'S_ALI';
const BILAL = 'S_BILAL';
const SANA = 'S_SANA';
const LOCAL_KINDS = ['t_exp_long', 't_exp_short', 't_notice'] as const;
const EXP_LONG_MS = 90_000;
const EXP_SHORT_MS = 30_000;

interface Counted {
  projection: string;
  event_type: string;
  reads: number;
  total: number;
}

interface Harness {
  db: Database.Database;
  clock: ReturnType<typeof fixedClock>;
  writer: Writer;
  registry: ProjectionRegistry;
  counted: Counted[];
  logs: unknown[];
  append(...events: PosEvent[]): PosEvent[];
}

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

function raised(alertId: string, kind: string, o: Record<string, unknown> = {}, envelope: Partial<PosEvent> = {}): PosEvent {
  return anAlertRaised({
    ...envelope,
    payload: { alert_id: alertId, kind, dedupe_key: `key:${alertId}`, ...o },
  });
}

function person(staffId: string, set = 'recipient') {
  return { staff_id: staffId, device_id: null, for_staff_id: null, set };
}

function step(event: 'AttemptSent' | 'EscalationStepped', alertId: string, index: number, recipients: unknown[]): PosEvent {
  return anAttemptSent({ event_type: event, payload: { alert_id: alertId, step: index, recipients, routes: [] } });
}

function hubEvent(eventType: string, payload: Record<string, unknown>): PosEvent {
  return { ...anAlertClosed(), event_type: eventType, payload };
}

async function harness(cleanups: Array<() => void>, at = T): Promise<Harness> {
  const fx = freshDb();
  cleanups.push(fx.cleanup);
  const clock = fixedClock(at);
  await runMigrations(fx.db, { dir: migrations, clock });
  const counted: Counted[] = [];
  const logs: unknown[] = [];
  const registry = countingRegistry(fx.db, counted);
  registerAlertProjections(registry);
  bindAlertProjectionLog(registry, (line) => logs.push(line));
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
  return {
    db: fx.db,
    clock,
    writer,
    registry,
    counted,
    logs,
    append(...events) {
      return writer.run((tx) => tx.append(events.map(draft))).appended;
    },
  };
}

// The hub's statementCounter idea, scoped to one projection's `apply`: counts every statement run
// (get / all / run) while that apply is on the stack, and separately the reading ones.
function countingRegistry(db: Database.Database, counted: Counted[]): ProjectionRegistry {
  const registry = createProjectionRegistry();
  let current: Counted | null = null;
  const prepare = db.prepare.bind(db);
  db.prepare = ((sql: string) => {
    const statement = prepare(sql);
    const wrap =
      <A extends unknown[], R>(original: (...args: A) => R) =>
      (...args: A): R => {
        if (current !== null) {
          current.total += 1;
          if (statement.reader) current.reads += 1;
        }
        return original(...args);
      };
    statement.get = wrap(statement.get.bind(statement));
    statement.all = wrap(statement.all.bind(statement));
    statement.run = wrap(statement.run.bind(statement));
    return statement;
  }) as typeof db.prepare;
  const register = registry.register.bind(registry);
  registry.register = (projection: Projection) => {
    register({
      ...projection,
      apply(tx, event, mode) {
        const entry: Counted = { projection: projection.name, event_type: event.event_type, reads: 0, total: 0 };
        current = entry;
        try {
          projection.apply(tx, event, mode);
        } finally {
          current = null;
          counted.push(entry);
        }
      },
    });
  };
  return registry;
}

function alertRow(db: Database.Database, alertId: string): Record<string, unknown> {
  return db.prepare('SELECT * FROM alerts WHERE alert_id = ?').get(alertId) as Record<string, unknown>;
}

function recipients(db: Database.Database, alertId: string): unknown[] {
  return db
    .prepare(
      `SELECT staff_id, device_id, for_staff_id, recipient_set, step FROM alert_recipients
       WHERE alert_id = ? ORDER BY step, rowid`,
    )
    .all(alertId);
}

function inbox(db: Database.Database, alertId: string): unknown[] {
  return db.prepare('SELECT staff_id, first_at, moved_to FROM alert_inbox WHERE alert_id = ? ORDER BY staff_id').all(alertId);
}

function dump(db: Database.Database): Record<string, unknown[]> {
  const tables = ['alerts', 'alert_recipients', 'alert_inbox', 'request_seen', 'alert_flags', 'alert_receipts', 'presence_today'];
  const out: Record<string, unknown[]> = {};
  for (const table of tables) {
    const rows = db.prepare(`SELECT * FROM ${table}`).all();
    out[table] = rows.map((row) => JSON.stringify(row)).sort();
  }
  return out;
}

function defineLocalKinds(): void {
  // closes_on after_ms beyond step 1 → next_due_at is step 1, then the expiry.
  defineAlertKind({
    kind: 't_exp_long',
    family: 'info',
    subject: 'hub',
    steps: [
      { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] },
      { at: { ms: FAKE_STEP_1_MS }, to: [{ target: 'raised_target', set: 'recipient' }] },
    ],
    closes_on: { after_ms: EXP_LONG_MS },
    values_schema: z.object({}),
    details_schema: null,
    lead_fallback: true,
    expires_at_day_close: true,
    silent: false,
    labels: { card: 'alert.t_exp_long.card', lock: 'alert.t_exp_long.lock' },
    request: null,
  });
  // closes_on after_ms before step 1 → the expiry is the earlier time.
  defineAlertKind({
    kind: 't_exp_short',
    family: 'info',
    subject: 'hub',
    steps: [
      { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] },
      { at: { ms: FAKE_STEP_1_MS }, to: [{ target: 'raised_target', set: 'recipient' }] },
    ],
    closes_on: { after_ms: EXP_SHORT_MS },
    values_schema: z.object({}),
    details_schema: null,
    lead_fallback: true,
    expires_at_day_close: true,
    silent: false,
    labels: { card: 'alert.t_exp_short.card', lock: 'alert.t_exp_short.lock' },
    request: null,
  });
  // A personal notice (§3.10): not expired at day close.
  defineAlertKind({
    kind: 't_notice',
    family: 'info',
    subject: 'hub',
    steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] }],
    closes_on: 'seen',
    values_schema: z.object({}),
    details_schema: null,
    lead_fallback: false,
    expires_at_day_close: false,
    silent: true,
    labels: { card: 'alert.t_notice.card', lock: 'alert.t_notice.lock' },
    request: null,
  });
}

const approvalRequest = {
  answers: ['approve', 'reject'],
  right_mode: 'approval',
  base_permission: 'void-item',
  range_permission: 'approve-void',
  approver_role_ids: ['R_MGR'],
  receiver_staff_id: null,
  needs_pin: 'always',
};

describe('01d alerts projections', () => {
  const cleanups: Array<() => void> = [];
  beforeAll(() => {
    registerFakes();
    defineLocalKinds();
  });
  afterAll(() => {
    resetFakes();
    for (const kind of LOCAL_KINDS) unregisterAlertKind(kind);
  });
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('[01d §5.2] AlertRaised → alerts row: envelope device / seq, hidden_from split, step -1, next_due_at = step 0 time', async () => {
    const h = await harness(cleanups);
    const [event] = h.append(
      raised(
        'A1',
        't_two_step',
        {
          requester_staff_id: SANA,
          values: { note: 1 },
          details: { reason: 'secret reason' },
          hidden_from: { session_id: 'sess-9', device_id: 'dev-9' },
          request: null,
        },
        { device_id: 'dev-raiser' },
      ),
    );
    expect(alertRow(h.db, 'A1')).toEqual({
      alert_id: 'A1',
      kind: 't_two_step',
      family: 'info',
      subject_stream_type: 'hub',
      subject_stream_id: '01J00000000000000000000003',
      dedupe_key: 'key:A1',
      requester_staff_id: SANA,
      raised_device_id: 'dev-raiser',
      raised_seq: event!.seq,
      hidden_session_id: 'sess-9',
      hidden_device_id: 'dev-9',
      target_json: JSON.stringify({ kind: 'person', staff_id: '01J00000000000000000000004' }),
      values_json: JSON.stringify({ note: 1 }),
      display_json: JSON.stringify({ kind_label_key: 'alert.test_alert.lock' }),
      details_json: JSON.stringify({ reason: 'secret reason' }),
      request_json: null,
      step: -1,
      next_due_at: T,
      expire_due: 0,
      state: 'open',
      close_reason: null,
      decision: null,
      closed_by_staff_id: null,
      raised_at: T,
      closed_at: null,
    });
    h.append(raised('A2', 't_approval', { request: approvalRequest, values: { order_id: 'O1' } }));
    const request = alertRow(h.db, 'A2');
    expect(request.hidden_session_id).toBeNull();
    expect(request.hidden_device_id).toBeNull();
    expect(request.details_json).toBeNull();
    expect(JSON.parse(request.request_json as string)).toEqual(approvalRequest);
  });

  it('[01d §5.2] AttemptSent step 0 → alert_recipients (a no-route person too), alert_inbox, next_due_at = next step', async () => {
    const h = await harness(cleanups);
    h.append(raised('A1', 't_two_step'));
    h.clock.advance(5);
    h.append(
      step('AttemptSent', 'A1', 0, [
        person(ALI),
        person(BILAL),
        { staff_id: null, device_id: 'dev-lead', for_staff_id: ALI, set: 'recipient' },
      ]),
    );
    expect(recipients(h.db, 'A1')).toEqual([
      { staff_id: ALI, device_id: null, for_staff_id: null, recipient_set: 'recipient', step: 0 },
      { staff_id: BILAL, device_id: null, for_staff_id: null, recipient_set: 'recipient', step: 0 },
      { staff_id: null, device_id: 'dev-lead', for_staff_id: ALI, recipient_set: 'recipient', step: 0 },
    ]);
    // routes: [] — neither person has a route; both are rows and inbox rows (v0.5 N5).
    expect(inbox(h.db, 'A1')).toEqual([
      { staff_id: ALI, first_at: T + 5, moved_to: null },
      { staff_id: BILAL, first_at: T + 5, moved_to: null },
    ]);
    const row = alertRow(h.db, 'A1');
    expect(row.step).toBe(0);
    expect(row.next_due_at).toBe(T + FAKE_STEP_1_MS);
    h.append(step('AttemptSent', 'A1', 1, [person(ALI), person(BILAL)]));
    expect(alertRow(h.db, 'A1')).toMatchObject({ step: 1, next_due_at: null });
  });

  it('[01d §3.5] next_due_at = the earlier of the next step and raised_at + after_ms; null when neither', async () => {
    const h = await harness(cleanups);
    h.append(raised('LONG', 't_exp_long'), raised('SHORT', 't_exp_short'), raised('INFO', 't_info'));
    for (const id of ['LONG', 'SHORT', 'INFO']) expect(alertRow(h.db, id).next_due_at).toBe(T);
    h.append(
      step('AttemptSent', 'LONG', 0, [person(ALI)]),
      step('AttemptSent', 'SHORT', 0, [person(ALI)]),
      step('AttemptSent', 'INFO', 0, [person(ALI)]),
    );
    expect(alertRow(h.db, 'LONG').next_due_at).toBe(T + FAKE_STEP_1_MS);
    expect(alertRow(h.db, 'SHORT').next_due_at).toBe(T + EXP_SHORT_MS);
    expect(alertRow(h.db, 'INFO').next_due_at).toBeNull();
    h.append(step('AttemptSent', 'LONG', 1, [person(ALI)]));
    expect(alertRow(h.db, 'LONG').next_due_at).toBe(T + EXP_LONG_MS);
  });

  it('[01d §5.2] StepSkipped then EscalationStepped (G1-9d shortcut) → step 2 rows, next_due_at null after the last step', async () => {
    const h = await harness(cleanups);
    h.append(
      raised('A1', 't_approval', { request: approvalRequest, values: { order_id: 'O1' } }),
      { ...hubEvent('StepSkipped', { alert_id: 'A1', step: 0, reason: 'shortcut' }) },
      { ...hubEvent('StepSkipped', { alert_id: 'A1', step: 1, reason: 'shortcut' }) },
      step('EscalationStepped', 'A1', 2, [person(BILAL, 'answerer'), person(SANA, 'informed')]),
    );
    expect(alertRow(h.db, 'A1')).toMatchObject({ step: 2, next_due_at: null, state: 'open' });
    expect(recipients(h.db, 'A1')).toEqual([
      { staff_id: BILAL, device_id: null, for_staff_id: null, recipient_set: 'answerer', step: 2 },
      { staff_id: SANA, device_id: null, for_staff_id: null, recipient_set: 'informed', step: 2 },
    ]);
  });

  it('[01d §5.2] a later step dropping a person sets moved_to; recipients are cumulative (G1-11c, M2)', async () => {
    const h = await harness(cleanups);
    h.append(raised('A1', 't_two_step'), step('AttemptSent', 'A1', 0, [person(ALI), person(SANA)]));
    h.clock.advance(FAKE_STEP_1_MS);
    h.append(step('AttemptSent', 'A1', 1, [person(BILAL), person(SANA)]));
    expect(inbox(h.db, 'A1')).toEqual([
      { staff_id: ALI, first_at: T, moved_to: BILAL },
      { staff_id: BILAL, first_at: T + FAKE_STEP_1_MS, moved_to: null },
      { staff_id: SANA, first_at: T, moved_to: null },
    ]);
    expect(recipients(h.db, 'A1')).toHaveLength(4);
  });

  it('[01d §3.2] RequestAnswered / RequestWithdrawn / AlertClosed → closed with reason, decision, closed_by_staff_id', async () => {
    const h = await harness(cleanups);
    h.append(
      raised('ANS', 't_approval', { request: approvalRequest, values: { order_id: 'O1' } }),
      raised('WD', 't_approval', { request: approvalRequest, values: { order_id: 'O2' } }),
      raised('CL', 't_info'),
    );
    h.clock.advance(7);
    h.append(
      aRequestAnswered({ payload: { alert_id: 'ANS', decision: 'reject', answerer_staff_id: BILAL } }),
      hubEvent('RequestWithdrawn', { alert_id: 'WD', by_staff_id: SANA }),
      anAlertClosed({ payload: { alert_id: 'CL', reason: 'obsolete', by_staff_id: ALI, note: 'n' } }),
    );
    expect(alertRow(h.db, 'ANS')).toMatchObject({
      state: 'closed',
      close_reason: 'answered',
      decision: 'reject',
      closed_by_staff_id: BILAL,
      closed_at: T + 7,
      next_due_at: null,
    });
    expect(alertRow(h.db, 'WD')).toMatchObject({
      state: 'closed',
      close_reason: 'withdrawn',
      decision: null,
      closed_by_staff_id: SANA,
      closed_at: T + 7,
      next_due_at: null,
    });
    expect(alertRow(h.db, 'CL')).toMatchObject({
      state: 'closed',
      close_reason: 'obsolete',
      decision: null,
      closed_by_staff_id: ALI,
      closed_at: T + 7,
      next_due_at: null,
    });
    // CLOSED is terminal: a second close does not rewrite it.
    h.clock.advance(1);
    h.append(anAlertClosed({ payload: { alert_id: 'ANS', reason: 'expired', by_staff_id: null, note: null } }));
    expect(alertRow(h.db, 'ANS')).toMatchObject({ close_reason: 'answered', closed_at: T + 7 });
  });

  it('[01d §5.2] RequestSeen → request_seen row and the seer’s inbox row (v0.5 N3)', async () => {
    const h = await harness(cleanups);
    h.append(
      raised('A1', 't_approval', { request: approvalRequest, values: { order_id: 'O1' } }),
      step('AttemptSent', 'A1', 0, [person(ALI, 'answerer')]),
    );
    h.clock.advance(3);
    h.append(hubEvent('RequestSeen', { alert_id: 'A1', staff_id: BILAL, device_id: 'dev-b' }));
    h.clock.advance(3);
    h.append(
      hubEvent('RequestSeen', { alert_id: 'A1', staff_id: BILAL, device_id: 'dev-b' }),
      hubEvent('RequestSeen', { alert_id: 'A1', staff_id: ALI, device_id: 'dev-a' }),
    );
    expect(h.db.prepare('SELECT alert_id, staff_id, at FROM request_seen ORDER BY staff_id').all()).toEqual([
      { alert_id: 'A1', staff_id: BILAL, at: T + 3 },
      { alert_id: 'A1', staff_id: ALI, at: T + 6 },
    ].sort((a, b) => a.staff_id.localeCompare(b.staff_id)));
    expect(inbox(h.db, 'A1')).toEqual([
      { staff_id: ALI, first_at: T, moved_to: null },
      { staff_id: BILAL, first_at: T + 3, moved_to: null },
    ]);
  });

  it('[01d §3.5 day close] BusinessDayClosed → expire_due on open non-request expires_at_day_close kinds only; hidden_device_id cleared on every open alert', async () => {
    const h = await harness(cleanups);
    const hidden = { session_id: 'sess-x', device_id: 'dev-x' };
    h.append(
      raised('INFO', 't_info', { hidden_from: hidden }),
      raised('REQ', 't_approval', { request: approvalRequest, values: { order_id: 'O1' }, hidden_from: hidden }),
      raised('NOTICE', 't_notice', { hidden_from: hidden }),
      raised('DONE', 't_info', { hidden_from: hidden }),
      step('AttemptSent', 'INFO', 0, [person(ALI)]),
      step('AttemptSent', 'REQ', 0, [person(ALI, 'answerer')]),
      step('AttemptSent', 'NOTICE', 0, [person(ALI)]),
      anAlertClosed({ payload: { alert_id: 'DONE', reason: 'done', by_staff_id: null, note: null } }),
    );
    const req = alertRow(h.db, 'REQ');
    h.clock.advance(1_000);
    h.append(aBusinessDayClosed());
    expect(alertRow(h.db, 'INFO')).toMatchObject({ expire_due: 1, next_due_at: T + 1_000, hidden_device_id: null, hidden_session_id: 'sess-x' });
    expect(alertRow(h.db, 'REQ')).toMatchObject({ expire_due: 0, next_due_at: req.next_due_at, hidden_device_id: null, hidden_session_id: 'sess-x' });
    expect(alertRow(h.db, 'NOTICE')).toMatchObject({ expire_due: 0, next_due_at: null, hidden_device_id: null, hidden_session_id: 'sess-x' });
    expect(alertRow(h.db, 'DONE')).toMatchObject({ expire_due: 0, next_due_at: null, hidden_device_id: 'dev-x', state: 'closed' });
    const close = h.counted.filter((c) => c.projection === 'alerts' && c.event_type === 'BusinessDayClosed');
    // One statement for the expiry, one for clearing hidden_device_id; no read.
    expect(close).toEqual([{ projection: 'alerts', event_type: 'BusinessDayClosed', reads: 0, total: 2 }]);
  });

  it('[01d §5.2] alert_flags: no_approver dirty on each of its five events; reset re-inserts (no_approver, 1)', async () => {
    const h = await harness(cleanups);
    const dirty = () => h.db.prepare(`SELECT dirty FROM alert_flags WHERE name = 'no_approver'`).pluck().get();
    expect(dirty()).toBe(1);
    for (const event of [aSessionStarted(), aSessionEnded(), aStaffDirectoryApplied(), aBusinessDayOpened(), aBusinessDayClosed()]) {
      h.db.prepare(`UPDATE alert_flags SET dirty = 0`).run();
      h.append(event);
      expect(dirty(), event.event_type).toBe(1);
    }
    h.db.prepare('DELETE FROM alert_flags').run();
    h.db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'alert_flags'`).run();
    const fresh = createProjectionRegistry();
    registerAlertProjections(fresh);
    fresh.catchUp(h.db, BRANCH);
    expect(h.db.prepare('SELECT name, dirty FROM alert_flags').all()).toEqual([{ name: 'no_approver', dirty: 1 }]);
  });

  it('[01d §5.2] alert_receipts: AlertDelivered twice → one row; AlertSeen → a seen row at step -1', async () => {
    const h = await harness(cleanups);
    const delivered = {
      alert_id: 'A1',
      subject_stream_type: 'hub',
      subject_stream_id: BRANCH,
      staff_id: ALI,
      device_id: 'dev-a',
      route: 'screen',
      step: 0,
    };
    const audit = (eventType: string, payload: Record<string, unknown>): PosEvent => ({
      ...hubEvent(eventType, payload),
      stream_type: 'audit',
      stream_id: 'A1',
    });
    h.append(audit('AlertDelivered', delivered));
    h.clock.advance(10);
    h.append(audit('AlertDelivered', delivered));
    const seen = { ...delivered } as Record<string, unknown>;
    delete seen.step;
    h.append(audit('AlertSeen', seen), audit('AlertDelivered', { ...delivered, staff_id: null, device_id: 'dev-kds' }));
    expect(h.db.prepare('SELECT * FROM alert_receipts ORDER BY kind, staff_id').all()).toEqual([
      { alert_id: 'A1', staff_id: '', device_id: 'dev-kds', kind: 'delivered', step: 0, at: T + 10 },
      { alert_id: 'A1', staff_id: ALI, device_id: 'dev-a', kind: 'delivered', step: 0, at: T },
      { alert_id: 'A1', staff_id: ALI, device_id: 'dev-a', kind: 'seen', step: -1, at: T + 10 },
    ]);
  });

  it('[01d §3.11] PresenceSet upserts presence_today; BusinessDayClosed clears it', async () => {
    const h = await harness(cleanups);
    h.append(aPresenceSet({ payload: { staff_ids: [ALI, BILAL], present: true, set_by: SANA } }));
    h.clock.advance(4);
    h.append(aPresenceSet({ payload: { staff_ids: [BILAL], present: false, set_by: ALI } }));
    expect(h.db.prepare('SELECT * FROM presence_today ORDER BY staff_id').all()).toEqual([
      { staff_id: ALI, present: 1, set_by: SANA, at: T },
      { staff_id: BILAL, present: 0, set_by: ALI, at: T + 4 },
    ]);
    h.append(aBusinessDayClosed());
    expect(h.db.prepare('SELECT COUNT(*) FROM presence_today').pluck().get()).toBe(0);
  });

  it('[01d §3.5 M10] alerts projection reads ≤ 2 statements per step / close event, fixed whatever the recipient count', async () => {
    const h = await harness(cleanups);
    const many = Array.from({ length: 20 }, (_, i) => person(`S_${i}`));
    h.append(raised('ONE', 't_two_step'), raised('MANY', 't_two_step'), raised('REQ', 't_approval', { request: approvalRequest, values: { order_id: 'O' } }));
    h.counted.length = 0;
    h.append(step('AttemptSent', 'ONE', 0, [person(ALI)]));
    const one = h.counted.find((c) => c.projection === 'alerts')!;
    h.counted.length = 0;
    h.append(step('AttemptSent', 'MANY', 0, many));
    const twenty = h.counted.find((c) => c.projection === 'alerts')!;
    expect(twenty.total).toBe(one.total);
    h.counted.length = 0;
    h.append(step('AttemptSent', 'MANY', 1, [person(ALI)]));
    const dropping = h.counted.find((c) => c.projection === 'alerts')!;
    h.counted.length = 0;
    h.append(
      hubEvent('StepSkipped', { alert_id: 'REQ', step: 0, reason: 'shortcut' }),
      step('EscalationStepped', 'REQ', 2, many),
      hubEvent('RequestSeen', { alert_id: 'REQ', staff_id: ALI, device_id: 'dev-a' }),
      aRequestAnswered({ payload: { alert_id: 'REQ' } }),
      hubEvent('RequestWithdrawn', { alert_id: 'ONE', by_staff_id: ALI }),
      anAlertClosed({ payload: { alert_id: 'MANY' } }),
    );
    const rest = h.counted.filter((c) => c.projection === 'alerts');
    for (const entry of [one, twenty, dropping, ...rest]) expect(entry.reads, entry.event_type).toBeLessThanOrEqual(2);
    expect(rest.map((c) => c.event_type)).toEqual([
      'StepSkipped',
      'EscalationStepped',
      'RequestSeen',
      'RequestAnswered',
      'RequestWithdrawn',
      'AlertClosed',
    ]);
    expect({ one: one.reads, dropping: dropping.reads, total: dropping.total }).toEqual({ one: 2, dropping: 2, total: one.total + 1 });
  });

  it('[01d §5.2] reset + replay gives identical tables', async () => {
    const h = await harness(cleanups);
    h.append(
      raised('A1', 't_two_step', { hidden_from: { session_id: 's', device_id: 'd' } }),
      step('AttemptSent', 'A1', 0, [person(ALI), person(SANA)]),
      raised('A2', 't_approval', { request: approvalRequest, values: { order_id: 'O1' } }),
      step('AttemptSent', 'A2', 0, [person(BILAL, 'answerer')]),
      hubEvent('RequestSeen', { alert_id: 'A2', staff_id: SANA, device_id: 'dev-s' }),
      aPresenceSet({ payload: { staff_ids: [ALI], present: true, set_by: SANA } }),
    );
    h.clock.advance(FAKE_STEP_1_MS);
    h.append(
      step('AttemptSent', 'A1', 1, [person(BILAL)]),
      aRequestAnswered({ payload: { alert_id: 'A2' } }),
      { ...hubEvent('AlertDelivered', { alert_id: 'A1', subject_stream_type: 'hub', subject_stream_id: BRANCH, staff_id: ALI, device_id: 'd1', route: 'screen', step: 0 }), stream_type: 'audit', stream_id: 'A1' },
      aSessionStarted(),
    );
    h.db.prepare(`UPDATE alert_flags SET dirty = 0`).run();
    h.append(raised('A3', 't_info'), aBusinessDayClosed(), aPresenceSet({ payload: { staff_ids: [BILAL], present: true, set_by: SANA } }));
    const live = dump(h.db);
    h.db
      .prepare(
        `DELETE FROM projection_checkpoints WHERE projection IN ('alerts', 'alert_flags', 'alert_receipts', 'presence_today')`,
      )
      .run();
    const fresh = createProjectionRegistry();
    registerAlertProjections(fresh);
    const replayed = fresh.catchUp(h.db, BRANCH).replayed;
    expect(replayed.alerts).toBeGreaterThan(0);
    expect(dump(h.db)).toEqual(live);
  });

  it('[01d §3.5 AD-123] a step whose targets cannot be computed retires the alert: next_due_at NULL, one live error line (no values); replay gives the same rows and logs nothing', async () => {
    const h = await harness(cleanups);
    h.append(
      raised('P1', 't_point_like', { family: 'action', values: { point_id: '', table_id: 'T-SECRET' } }),
      step('AttemptSent', 'P1', 0, [person(ALI)]),
      raised('D1', 't_info'), // one step, sent: next_due_at NULL legitimately, not stuck
      step('AttemptSent', 'D1', 0, [person(ALI)]),
    );
    expect(alertRow(h.db, 'P1')).toMatchObject({ state: 'open', step: 0, next_due_at: null });
    expect(alertRow(h.db, 'D1')).toMatchObject({ state: 'open', step: 0, next_due_at: null });
    expect(h.logs).toEqual([{ alert_id: 'P1', kind: 't_point_like', error: 'alert_stuck', err: { name: 'Error', code: null } }]);
    expect(JSON.stringify(h.logs)).not.toMatch(/T-SECRET|point_id/);
    expect(countStuckAlerts(h.db)).toBe(1);
    const live = dump(h.db);
    h.db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'alerts'`).run();
    const fresh = createProjectionRegistry();
    registerAlertProjections(fresh);
    const replayLogs: unknown[] = [];
    bindAlertProjectionLog(fresh, (line) => replayLogs.push(line));
    expect(fresh.catchUp(h.db, BRANCH).replayed.alerts).toBe(4);
    expect(dump(h.db)).toEqual(live);
    expect(countStuckAlerts(h.db)).toBe(1);
    expect(replayLogs).toEqual([]);
    expect(h.logs).toHaveLength(1);
  });

  it('[01d §3.5 AD-123] positive control: a computable step 1 → next_due_at = its time, no line, not counted stuck', async () => {
    const h = await harness(cleanups);
    h.append(raised('W1', 't_point_like', { family: 'action', values: { point_id: 'P', table_id: 'T' } }), step('AttemptSent', 'W1', 0, [person(ALI)]));
    expect(alertRow(h.db, 'W1')).toMatchObject({ next_due_at: T + FAKE_STEP_1_MS });
    expect(h.logs).toEqual([]);
    expect(countStuckAlerts(h.db)).toBe(0);
  });

  it('[01d §5.2] buildHubServer wiring: an appended AlertRaised lands in alerts on the test hub', async () => {
    const hub = await createTestHub();
    cleanups.push(() => void hub.close());
    hub.deps.writer.run((tx) => tx.append([draft(raised('W1', 't_info'))]));
    expect(alertRow(hub.deps.db, 'W1')).toMatchObject({ kind: 't_info', state: 'open' });
  });

  it('[01d P-8] an AlertRaised of an unregistered kind replayed at boot: boot completes, row open with next_due_at NULL, one unknown_kind log line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pos-01d-p8-'));
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
    const gone = raised('GONE', 'removed_kind', { details: { reason: 'do-not-log-me' } });
    insertRaw(db, 1, gone);
    insertRaw(db, 2, step('AttemptSent', 'GONE', 0, [person(ALI)]));
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
      expect(alertRow(booted.deps.db, 'GONE')).toMatchObject({ kind: 'removed_kind', state: 'open', step: 0, next_due_at: null });
      const lines = capture
        .text()
        .split('\n')
        .filter((line) => line.includes('unknown_kind'));
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toMatchObject({ alert_id: 'GONE', kind: 'removed_kind', error: 'unknown_kind' });
      expect(capture.text()).not.toContain('do-not-log-me');
    } finally {
      await booted.stop();
    }
  });
});

function insertRaw(db: Database.Database, seq: number, event: PosEvent): void {
  db.prepare(
    `INSERT INTO events (
      event_id, tenant_id, branch_id, stream_type, stream_id, event_type,
      schema_version, payload, occurred_at, recorded_at, actor_id, device_id, seq
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL, ?, ?)`,
  ).run(`evt-${seq}`, TENANT, BRANCH, event.stream_type, event.stream_id, event.event_type, JSON.stringify(event.payload), T, T, event.device_id, seq);
}
