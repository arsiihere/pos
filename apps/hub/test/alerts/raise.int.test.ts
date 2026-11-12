import { fileURLToPath } from 'node:url';
import { DomainError } from '@pos/domain';
import type { EventDraft, PosEvent } from '@pos/events';
import { aBusinessDayClosed, aDevicePaired, aDeviceRevoked, anAlertClosed, aPresenceSet, aSessionEnded, aSessionStarted } from '@pos/events/testing';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { alerts, bindAlertEnv, type AlertCtx, type RaiseInput } from '../../src/alerts/raise';
import { unregisterTargetResolver } from '../../src/alerts/targets';
import { StaffDirectory, type DirectoryCore } from '../../src/auth/staff-directory';
import type { CommandCtx } from '../../src/commands/registry';
import { runMigrations } from '../../src/db/migrate';
import { createAuthGeneration } from '../../src/engine-host/auth-generation';
import { readOnlyTx } from '../../src/engine-host/read-only-tx';
import { createStateHolder } from '../../src/engine-host/state-holder';
import { createWriter, type Writer, type WriterTx } from '../../src/engine-host/writer';
import { fixedClock, T } from '../../src/lib/clock';
import { testIdGen } from '../../src/lib/ids';
import { registerAlertProjections } from '../../src/projections/alerts';
import { createProjectionRegistry } from '../../src/projections/registry';
import type { ConnectedSession, WsHub } from '../../src/ws/server';
import { freshDb } from '../helpers/db';
import { statementCounter } from '../helpers/statement-counter';
import { fakePager, fakeTableOwner, fakeZoneOrderTaker, registerFakes, resetFakes } from './fakes';

// 01d §6.1 raise, §4.2 raise / raiseMany, §3.5 "Several raises" and the fixed reads, G1-9d shortcut,
// §3.12 details, BF-6, tests #15, #20, #47, on a migrated hub database with the alert projections.

const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const BRANCH = 'branch-1';
const OWNER = 'S_OWNER';
const IMRAN = 'S_IMRAN'; // manager, approve-void branch scope (answerer)
const KAMRAN = 'S_KAMRAN'; // lead of ALI, approve-void my_team (answerer)
const ZAIN = 'S_ZAIN'; // approve-void my_team, ALI not in his team (informed)
const ALI = 'S_ALI'; // waiter, void-item requires approval
const TAB = 'D_TAB';
const KIOSK = 'D_KIOSK';
const ALI_DEV = 'D_ALI';

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
    { role_id: 'R1', name: 'r1', session_idle_ttl_ms: 300_000, permissions: [] },
    {
      role_id: 'R2',
      name: 'r2',
      session_idle_ttl_ms: 300_000,
      permissions: [
        grant({ permission: 'approve-void', grant_type: 'allowed', scope: 'branch' }),
        grant({ permission: 'force-release-table-lock', grant_type: 'allowed', scope: 'branch' }),
      ],
    },
    { role_id: 'R3', name: 'r3', session_idle_ttl_ms: 300_000, permissions: [grant({ permission: 'approve-void', grant_type: 'allowed', scope: 'my_team' })] },
    {
      role_id: 'R4',
      name: 'r4',
      session_idle_ttl_ms: 300_000,
      permissions: [grant({ permission: 'void-item', grant_type: 'requires_approval', approver_role_ids: ['R2', 'R3'], scope: 'own_tables' })],
    },
  ],
  staff: [person(OWNER, ['R1'], null), person(IMRAN, ['R2'], OWNER), person(KAMRAN, ['R3'], IMRAN), person(ZAIN, ['R3'], IMRAN), person(ALI, ['R4'], KAMRAN)],
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

interface FakeWs {
  sessions: ConnectedSession[];
  alert: Array<{ deviceId: string; deviceType: 'tablet' | 'phone' | 'cashier_kiosk' | 'kds' }>;
}

interface Harness {
  db: Database.Database;
  writer: Writer;
  ws: FakeWs;
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
    tenantId: 'tenant-1',
    branchId: BRANCH,
    projections: registry,
    state,
    authGeneration: createAuthGeneration(),
    publish: () => undefined,
  });
  const ws: FakeWs = { sessions: [], alert: [] };
  const hub = { connectedSessions: () => ws.sessions, alertSockets: () => ws.alert } as unknown as WsHub;
  bindAlertEnv(fx.db, { directory: () => dir, ws: () => hub });
  insertDevice(fx.db, KIOSK, 'cashier_kiosk');
  insertDevice(fx.db, ALI_DEV, 'tablet');
  return { db: fx.db, writer, ws };
}

function insertDevice(db: Database.Database, deviceId: string, type: string): void {
  db.prepare(
    `INSERT INTO devices (device_id, branch_id, token_hash, device_name, device_type, station_id, owner_staff_id, paired_at, paired_by)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, 'S_ADMIN')`,
  ).run(deviceId, BRANCH, `hash-${deviceId}`, deviceId, type, T);
}

function insertSession(db: Database.Database, o: { id: string; staff: string; device: string; last: number; ended?: boolean }): void {
  db.prepare(
    `INSERT INTO staff_sessions (session_id, branch_id, token_hash, kind, staff_id, device_id, idle_ttl_ms, started_at, last_activity_at, ended_at, end_reason)
     VALUES (?, ?, ?, 'staff', ?, ?, 300000, ?, ?, ?, ?)`,
  ).run(o.id, BRANCH, `tok-${o.id}`, o.staff, o.device, o.last, o.last, o.ended === true ? o.last + 300_000 : null, o.ended === true ? 'idle_timeout' : null);
}

/** A command ctx whose `permission` getter throws: `raise` never reads it (§4.2, v0.4 m7). */
function cmdCtx(tx: WriterTx, staffId: string = ALI, deviceId: string = ALI_DEV): AlertCtx {
  const ctx = {
    tx,
    state: {},
    clock: tx.clock,
    ids: tx.ids,
    actor: { kind: 'staff', staffId, stationId: null, sessionId: 'SESS', deviceId },
    branch: { tenantId: 'tenant-1', branchId: BRANCH },
    directory: dir,
    get permission(): never {
      throw new Error('raise read ctx.permission');
    },
  };
  return ctx as unknown as CommandCtx;
}

const display = { kind_label_key: 'alert.k' };
const voidInput = (over: Partial<RaiseInput> = {}): RaiseInput => ({
  kind: 't_approval',
  subject: { stream_type: 'order', stream_id: 'O1' },
  target: { kind: 'answerers' },
  values: { order_id: 'O1' },
  display,
  details: { item: 'Mutton platter', quantity: 1, amount: 480_000, reason: 'customer changed mind' },
  dedupe_key: 'void:O1:L1',
  requester_staff_id: ALI,
  request: { approver_role_ids: ['R2', 'R3'] },
  ...over,
});
const infoInput = (over: Partial<RaiseInput> = {}): RaiseInput => ({
  kind: 't_info',
  subject: { stream_type: 'hub', stream_id: BRANCH },
  target: { kind: 'person', staff_id: IMRAN },
  display,
  dedupe_key: 'info:1',
  ...over,
});

function types(events: EventDraft[]): string[] {
  return events.map((e) => e.event_type);
}

function errorOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

describe('01d alerts.raise / raiseMany', () => {
  const cleanups: Array<() => void> = [];
  beforeEach(() => registerFakes());
  afterEach(() => {
    resetFakes();
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('[01d #15] raise twice with one dedupe_key → second deduped, no events; after close, raise again → new alert', async () => {
    const h = await harness(cleanups);
    const first = h.writer.run((tx) => {
      const r = alerts.raise(cmdCtx(tx), infoInput());
      tx.append(r.events);
      return r;
    }).result;
    expect(first.deduped).toBe(false);
    expect(types(first.events)).toEqual(['AlertRaised', 'AttemptSent']);

    const second = h.writer.run((tx) => alerts.raise(cmdCtx(tx, KAMRAN), infoInput())).result;
    expect(second).toEqual({ alert_id: first.alert_id, events: [], deduped: true, requester_staff_id: null });

    h.writer.run((tx) => tx.append([draft(anAlertClosed({ payload: { alert_id: first.alert_id } }))]));
    const third = h.writer.run((tx) => {
      const r = alerts.raise(cmdCtx(tx), infoInput());
      tx.append(r.events);
      return r;
    }).result;
    expect(third.deduped).toBe(false);
    expect(third.alert_id).not.toBe(first.alert_id);
    expect(h.db.prepare(`SELECT COUNT(*) AS n FROM alerts WHERE state = 'open'`).get()).toEqual({ n: 1 });
  });

  it('[01d #47] same key twice in one transaction → second returns the first alert_id deduped; one AlertRaised; no constraint error', async () => {
    const h = await harness(cleanups);
    const { result, appended } = h.writer.run((tx) => {
      const a = alerts.raise(cmdCtx(tx), infoInput());
      const b = alerts.raise(cmdCtx(tx), infoInput());
      tx.append([...a.events, ...b.events]);
      return { a, b };
    });
    expect(result.b).toEqual({ alert_id: result.a.alert_id, events: [], deduped: true, requester_staff_id: null });
    expect(appended.filter((e) => e.event_type === 'AlertRaised')).toHaveLength(1);
  });

  it('[01d §4.2] the same key under two kinds gives two alerts; a deduped raise returns the open one’s requester', async () => {
    const h = await harness(cleanups);
    const [a, b] = h.writer.run((tx) => {
      const x = alerts.raise(cmdCtx(tx), infoInput({ dedupe_key: 'k', requester_staff_id: ALI }));
      const y = alerts.raise(cmdCtx(tx), infoInput({ kind: 't_action', subject: { stream_type: 'table', stream_id: 'T12' }, dedupe_key: 'k' }));
      tx.append([...x.events, ...y.events]);
      return [x, y];
    }).result;
    expect(a?.deduped).toBe(false);
    expect(b?.deduped).toBe(false);
    expect(a?.alert_id).not.toBe(b?.alert_id);
    const again = h.writer.run((tx) => alerts.raise(cmdCtx(tx, KAMRAN), infoInput({ dedupe_key: 'k', requester_staff_id: KAMRAN }))).result;
    expect(again).toEqual({ alert_id: a?.alert_id, events: [], deduped: true, requester_staff_id: ALI });
  });

  it('[01d §6.1] AlertRaised payload: request part copied, details stored, envelope device = the raising device', async () => {
    const h = await harness(cleanups);
    h.ws.sessions = [{ staffId: IMRAN, deviceId: 'D_IMRAN', sessionId: 'S1', kind: 'staff', stationId: null }];
    const r = h.writer.run((tx) => alerts.raise(cmdCtx(tx), voidInput())).result;
    expect(types(r.events)).toEqual(['AlertRaised', 'AttemptSent']);
    const raised = r.events[0] as EventDraft;
    expect(raised).toMatchObject({ stream_type: 'order', stream_id: 'O1', actor_id: ALI, device_id: ALI_DEV, occurred_at: T });
    expect(raised.payload).toEqual({
      alert_id: r.alert_id,
      kind: 't_approval',
      family: 'urgent',
      subject_stream_type: 'order',
      subject_stream_id: 'O1',
      dedupe_key: 'void:O1:L1',
      requester_staff_id: ALI,
      target: { kind: 'answerers' },
      values: { order_id: 'O1' },
      display,
      details: { item: 'Mutton platter', quantity: 1, amount: 480_000, reason: 'customer changed mind' },
      hidden_from: null,
      request: {
        answers: ['approve', 'reject'],
        right_mode: 'approval',
        base_permission: 'void-item',
        range_permission: 'approve-void',
        approver_role_ids: ['R2', 'R3'],
        receiver_staff_id: null,
        needs_pin: 'always',
      },
    });
    expect(r.events[1]?.payload).toEqual({
      alert_id: r.alert_id,
      step: 0,
      recipients: [
        { staff_id: IMRAN, device_id: null, for_staff_id: null, set: 'answerer' },
        { staff_id: KAMRAN, device_id: null, for_staff_id: null, set: 'answerer' },
      ],
      routes: [{ staff_id: IMRAN, route: 'screen', ref: 'D_IMRAN' }],
    });
  });

  it('[01d §6.1] a tick ctx (no actor) raises with device_id hub and actor null', async () => {
    const h = await harness(cleanups);
    const r = h.writer.run((tx) =>
      alerts.raise({ tx, now: T + 5, actor_id: null, device_id: 'hub', session: null, permission: null }, infoInput()),
    ).result;
    expect(r.events[0]).toMatchObject({ actor_id: null, device_id: 'hub', occurred_at: T + 5 });
    expect(r.requester_staff_id).toBeNull();
  });

  it('[01d §6.1] values / details failing the kind’s schema → VALIDATION_FAILED values_invalid / details_invalid', async () => {
    const h = await harness(cleanups);
    h.writer.run((tx) => {
      const values = errorOf(() => alerts.raise(cmdCtx(tx), voidInput({ values: { order_id: 7 } })));
      expect(values).toBeInstanceOf(DomainError);
      expect(values).toMatchObject({ code: 'VALIDATION_FAILED', details: { issue: 'values_invalid' } });
      const details = errorOf(() => alerts.raise(cmdCtx(tx), voidInput({ details: { item: 'x', quantity: 1, reason: 'r' } })));
      expect(details).toMatchObject({ code: 'VALIDATION_FAILED', details: { issue: 'details_invalid' } });
      // the details values are never in the error (§7)
      expect(JSON.stringify((details as DomainError).details)).not.toContain('"x"');
      const extra = errorOf(() => alerts.raise(cmdCtx(tx), infoInput({ details: { reason: 'secret' } })));
      expect(extra).toMatchObject({ code: 'VALIDATION_FAILED', details: { issue: 'details_invalid' } });
    });
  });

  it('[01d §6.1] approval kind without approver_role_ids, named kind without receiver_staff_id → Error (programming error)', async () => {
    const h = await harness(cleanups);
    h.writer.run((tx) => {
      const approval = errorOf(() => alerts.raise(cmdCtx(tx), voidInput({ request: {} })));
      expect(approval).toBeInstanceOf(Error);
      expect(approval).not.toBeInstanceOf(DomainError);
      const named = errorOf(() =>
        alerts.raise(cmdCtx(tx), {
          kind: 't_accept',
          subject: { stream_type: 'table', stream_id: 'T12' },
          target: { kind: 'person', staff_id: KAMRAN },
          display,
          dedupe_key: 'handover:T12',
          requester_staff_id: ALI,
        }),
      );
      expect(named).toBeInstanceOf(Error);
      expect(named).not.toBeInstanceOf(DomainError);
      expect(() => alerts.raise(cmdCtx(tx), infoInput({ kind: 't_nope' }))).toThrow(/t_nope/);
    });
  });

  it('[01d §6.1] named kind: receiver copied into the request part; raise never reads ctx.permission', async () => {
    const h = await harness(cleanups);
    const r = h.writer.run((tx) =>
      alerts.raise(cmdCtx(tx), {
        kind: 't_accept',
        subject: { stream_type: 'table', stream_id: 'T12' },
        target: { kind: 'person', staff_id: KAMRAN },
        display,
        dedupe_key: 'handover:T12',
        requester_staff_id: ALI,
        request: { receiver_staff_id: KAMRAN },
      }),
    ).result;
    expect(r.events[0]?.payload).toMatchObject({
      request: { right_mode: 'named', base_permission: null, range_permission: null, approver_role_ids: [], receiver_staff_id: KAMRAN, needs_pin: 'never' },
    });
    // a named kind never takes the shortcut, even with no route
    expect(types(r.events)).toEqual(['AlertRaised', 'AttemptSent']);
  });

  it('[01d §6.1] an unregistered resolver kind → VALIDATION_FAILED target_unavailable', async () => {
    const h = await harness(cleanups);
    unregisterTargetResolver('point');
    h.writer.run((tx) => {
      const error = errorOf(() => alerts.raise(cmdCtx(tx), infoInput({ target: { kind: 'point', point_id: 'P1' } })));
      expect(error).toMatchObject({ code: 'VALIDATION_FAILED', details: { issue: 'target_unavailable' } });
    });
  });

  it('[01d #20] Imran idled out, bound tablet connected, present and active within 2 h → step 0 reaches the tablet, no shortcut', async () => {
    const h = await harness(cleanups);
    insertDevice(h.db, TAB, 'tablet');
    insertSession(h.db, { id: 'S_OLD', staff: IMRAN, device: TAB, last: T - 3_600_000, ended: true });
    h.db.prepare('INSERT INTO device_bindings (device_id, staff_id, session_id, since) VALUES (?, ?, ?, ?)').run(TAB, IMRAN, 'S_OLD', T - 3_600_000);
    h.ws.alert = [{ deviceId: TAB, deviceType: 'tablet' }];
    const r = h.writer.run((tx) => alerts.raise(cmdCtx(tx), voidInput())).result;
    expect(types(r.events)).toEqual(['AlertRaised', 'AttemptSent']);
    expect(r.events[1]?.payload).toMatchObject({ step: 0, routes: [{ staff_id: IMRAN, route: 'alert_connection', ref: TAB }] });
  });

  it('[01d #20] no answerer has a route → StepSkipped shortcut 0 and 1, EscalationStepped 2 with its list; request stays pending', async () => {
    const h = await harness(cleanups);
    const { result: r } = h.writer.run((tx) => {
      const out = alerts.raise(cmdCtx(tx), voidInput());
      tx.append(out.events);
      return out;
    });
    expect(types(r.events)).toEqual(['AlertRaised', 'StepSkipped', 'StepSkipped', 'EscalationStepped']);
    expect(r.events.map((e) => e.payload)).toMatchObject([
      {},
      { alert_id: r.alert_id, step: 0, reason: 'shortcut' },
      { alert_id: r.alert_id, step: 1, reason: 'shortcut' },
      {
        alert_id: r.alert_id,
        step: 2,
        recipients: [
          { staff_id: IMRAN, device_id: null, for_staff_id: null, set: 'answerer' },
          { staff_id: KAMRAN, device_id: null, for_staff_id: null, set: 'answerer' },
          { staff_id: ZAIN, device_id: null, for_staff_id: null, set: 'informed' },
          { staff_id: null, device_id: KIOSK, for_staff_id: null, set: 'recipient' },
        ],
        routes: [],
      },
    ]);
    expect(h.db.prepare('SELECT state, step, next_due_at FROM alerts WHERE alert_id = ?').get(r.alert_id)).toEqual({
      state: 'open',
      step: 2,
      next_due_at: null,
    });
  });

  it('[01d #20] a registered route counts as a route for the shortcut; a requester-only answerer set takes it', async () => {
    const h = await harness(cleanups);
    fakePager.refs.set(KAMRAN, ['P-7']);
    const paged = h.writer.run((tx) => alerts.raise(cmdCtx(tx), voidInput())).result;
    expect(types(paged.events)).toEqual(['AlertRaised', 'AttemptSent']);
    expect(paged.events[1]?.payload).toMatchObject({ routes: [{ staff_id: KAMRAN, route: 'pager', ref: 'P-7' }] });
    // §3.3 rule 5: empty answerers (Kamran's void-item needs no approval, so nobody may answer) → shortcut,
    // even though Kamran himself has a screen route.
    h.ws.sessions = [{ staffId: KAMRAN, deviceId: 'D_K', sessionId: 'SK', kind: 'staff', stationId: null }];
    const self = h.writer.run((tx) =>
      alerts.raise(cmdCtx(tx), voidInput({ dedupe_key: 'void:self', requester_staff_id: KAMRAN })),
    ).result;
    expect(types(self.events)).toEqual(['AlertRaised', 'StepSkipped', 'StepSkipped', 'EscalationStepped']);
  });

  it('[01d §4.2] statements: raise ≤ 6 + R + T; raiseMany of 20 = one raise; 20 single raises read the fixed set once', async () => {
    const h = await harness(cleanups);
    for (let i = 0; i < 20; i += 1) fakeTableOwner.owners.set(`T${i}`, i % 2 === 0 ? KAMRAN : IMRAN);
    fakeZoneOrderTaker.takers.set('T0', ZAIN);
    fakePager.refs.set(OWNER, ['P-1']);
    const tableInput = (i: number): RaiseInput => ({
      kind: 't_action',
      subject: { stream_type: 'table', stream_id: `T${i}` },
      target: { kind: 'table_team', table_id: `T${i}` },
      display,
      dedupe_key: `act:${i}`,
    });
    const counter = statementCounter(h.db);
    // R = 1 (fakePager), T = 2 (table_team + zone_order_taker for the lead_fallback kind)
    const bound = 6 + 1 + 2;
    const measured = h.writer.run((tx) => {
      counter.reset();
      alerts.raise(cmdCtx(tx), tableInput(0));
      const single = counter.count;
      counter.reset();
      alerts.raiseMany(
        cmdCtx(tx),
        Array.from({ length: 20 }, (_, i) => tableInput(i + 100)),
      );
      const many = counter.count;
      return { single, many };
    }).result;
    expect(measured.single).toBeLessThanOrEqual(bound);
    expect(measured.single).toBe(9);
    // the fixed reads are cached from the first raise: raiseMany = dedupe + R + T
    expect(measured.many).toBe(1 + 1 + 2);

    const loop = h.writer.run((tx) => {
      counter.reset();
      const first = (() => {
        alerts.raise(cmdCtx(tx), tableInput(0));
        return counter.count;
      })();
      counter.reset();
      for (let i = 1; i < 20; i += 1) alerts.raise(cmdCtx(tx), tableInput(i));
      return { first, rest: counter.count };
    }).result;
    expect(loop.first).toBe(9);
    expect(loop.rest).toBeLessThanOrEqual(19 * (1 + 1 + 2));

    const fresh = h.writer.run((tx) => {
      counter.reset();
      alerts.raiseMany(
        cmdCtx(tx),
        Array.from({ length: 20 }, (_, i) => tableInput(i + 200)),
      );
      return counter.count;
    }).result;
    expect(fresh).toBe(measured.single);
  });

  it('[01d BF-6] SessionStarted for Imran on tablet T in the transaction, then raise → his new session is a route', async () => {
    const h = await harness(cleanups);
    insertDevice(h.db, TAB, 'tablet');
    h.ws.alert = [{ deviceId: TAB, deviceType: 'tablet' }];
    const { result } = h.writer.run((tx) => {
      const before = alerts.raise(cmdCtx(tx), infoInput({ dedupe_key: 'before' }));
      insertSession(tx.db, { id: 'S_NEW', staff: IMRAN, device: TAB, last: T });
      tx.append([
        draft(
          aSessionStarted({
            stream_id: IMRAN,
            payload: { session_id: 'S_NEW', kind: 'staff', staff_id: IMRAN, station_id: null, device_id: TAB, idle_ttl_ms: 300_000 },
          }),
        ),
      ]);
      const after = alerts.raise(cmdCtx(tx), infoInput({ dedupe_key: 'after' }));
      return { before, after };
    });
    expect(result.before.events[1]?.payload).toMatchObject({ routes: [] });
    expect(result.after.events[1]?.payload).toMatchObject({ routes: [{ staff_id: IMRAN, route: 'alert_connection', ref: TAB }] });
  });

  it.each([
    ['SessionStarted', () => aSessionStarted({ payload: { session_id: 'S9', staff_id: KAMRAN, device_id: 'D_X' } })],
    ['SessionEnded', () => aSessionEnded({ payload: { session_id: 'S9', staff_id: KAMRAN } })],
    ['DeviceRevoked', () => aDeviceRevoked({ stream_id: 'D_X', payload: { device_id: 'D_X' } })],
    ['PresenceSet', () => aPresenceSet({ payload: { staff_ids: [KAMRAN], present: false, set_by: IMRAN } })],
    ['DevicePaired', () => aDevicePaired({ stream_id: 'D_NEW', payload: { device_id: 'D_NEW', device_type: 'tablet' } })],
    ['BusinessDayClosed', () => aBusinessDayClosed()],
  ])('[01d BF-6] appending %s in the transaction drops the cached fixed reads; other events keep them', async (_type, event) => {
    const h = await harness(cleanups);
    const counter = statementCounter(h.db);
    const counts = h.writer.run((tx) => {
      counter.reset();
      const first = alerts.raise(cmdCtx(tx), infoInput({ dedupe_key: 'a' }));
      const cold = counter.count;
      tx.append(first.events);
      counter.reset();
      alerts.raise(cmdCtx(tx), infoInput({ dedupe_key: 'b' }));
      const warm = counter.count;
      tx.append([draft(event())]);
      counter.reset();
      alerts.raise(cmdCtx(tx), infoInput({ dedupe_key: 'c' }));
      return { cold, warm, dropped: counter.count };
    }).result;
    expect(counts.warm).toBe(counts.cold - 5);
    expect(counts.dropped).toBe(counts.cold);
  });
  it('[01d BF-6] a day-close transaction: BusinessDayClosed appended, then a raise routes on fresh reads', async () => {
    const h = await harness(cleanups);
    insertDevice(h.db, TAB, 'tablet');
    insertSession(h.db, { id: 'S_IM', staff: IMRAN, device: TAB, last: T });
    h.db.prepare('INSERT INTO device_bindings (device_id, staff_id, session_id, since) VALUES (?, ?, ?, ?)').run(TAB, IMRAN, 'S_IM', T);
    h.ws.alert = [{ deviceId: TAB, deviceType: 'tablet' }];
    const { result } = h.writer.run((tx) => {
      const before = alerts.raise(cmdCtx(tx), infoInput({ dedupe_key: 'before' }));
      // the day close ends session-set tablet bindings (§3.7)
      tx.append([draft(aBusinessDayClosed())]);
      const after = alerts.raise(cmdCtx(tx), infoInput({ dedupe_key: 'after' }));
      return { before, after };
    });
    expect(result.before.events[1]?.payload).toMatchObject({ routes: [{ staff_id: IMRAN, route: 'alert_connection', ref: TAB }] });
    expect(result.after.events[1]?.payload).toMatchObject({ routes: [] });
  });

  it('[01d §3.3 rule 4(d)] a raise through readOnlyTx(tx) (the PIN prepare view) returns drafts and writes nothing', async () => {
    const h = await harness(cleanups);
    h.ws.sessions = [{ staffId: IMRAN, deviceId: 'D_IMRAN', sessionId: 'S1', kind: 'staff', stationId: null }];
    const changes = (): number => (h.db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    const { result, appended } = h.writer.run((tx) => {
      const before = changes();
      const view = readOnlyTx(tx);
      const approval = alerts.raise(cmdCtx(view), voidInput());
      const many = alerts.raiseMany(cmdCtx(view), [infoInput({ dedupe_key: 'ro1' }), infoInput({ dedupe_key: 'ro1' })]);
      return { approval, many, written: changes() - before };
    });
    expect(types(result.approval.events)).toEqual(['AlertRaised', 'AttemptSent']);
    expect(result.many[0]?.deduped).toBe(false);
    expect(result.many[1]).toMatchObject({ alert_id: result.many[0]?.alert_id, deduped: true });
    expect(result.written).toBe(0);
    expect(appended).toEqual([]);
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM alerts').get()).toEqual({ n: 0 });
  });
});

describe('01d §3.4.3 "for" rows and alert_inbox (task 17 fix)', () => {
  const cleanups: Array<() => void> = [];
  beforeEach(() => registerFakes());
  afterEach(() => {
    resetFakes();
    for (const cleanup of cleanups.splice(0)) cleanup();
  });
  const toAli = infoInput({ target: { kind: 'person', staff_id: ALI }, dedupe_key: 'info:ali' });
  const inbox = (db: Database.Database, alertId: string): string[] =>
    (db.prepare('SELECT staff_id FROM alert_inbox WHERE alert_id = ? ORDER BY staff_id').all(alertId) as Array<{ staff_id: string }>).map(
      (r) => r.staff_id,
    );
  const recipientRows = (db: Database.Database, alertId: string) =>
    db
      .prepare('SELECT step, staff_id, for_staff_id FROM alert_recipients WHERE alert_id = ? ORDER BY step, rowid')
      .all(alertId);

  it('[01d §3.4.3] a "for Ali" step: the lead has the inbox row, Ali has none; a later step reaching Ali gives him his', async () => {
    const h = await harness(cleanups);
    h.ws.sessions = [{ staffId: KAMRAN, deviceId: 'D_K', sessionId: 'SK', kind: 'staff', stationId: null }];
    const { result: r } = h.writer.run((tx) => {
      const out = alerts.raise(cmdCtx(tx, IMRAN), toAli);
      tx.append(out.events);
      return out;
    });
    expect(r.events[1]?.payload).toMatchObject({
      step: 0,
      recipients: [{ staff_id: KAMRAN, device_id: null, for_staff_id: ALI, set: 'recipient' }],
      routes: [{ staff_id: KAMRAN, route: 'screen', ref: 'D_K' }],
    });
    expect(recipientRows(h.db, r.alert_id)).toEqual([{ step: 0, staff_id: KAMRAN, for_staff_id: ALI }]);
    expect(inbox(h.db, r.alert_id)).toEqual([KAMRAN]);

    // a later step (the tick's AttemptSent) reaching Ali directly: Ali signed in now
    h.ws.sessions = [{ staffId: ALI, deviceId: ALI_DEV, sessionId: 'SA', kind: 'staff', stationId: null }];
    const step0 = r.events[1] as EventDraft;
    h.writer.run((tx) => {
      const later = alerts.raise(cmdCtx(tx, IMRAN), { ...toAli, dedupe_key: 'info:ali:probe' });
      const routed = later.events[1]?.payload as { recipients: unknown[]; routes: unknown[] };
      tx.append([{ ...step0, payload: { alert_id: r.alert_id, step: 1, recipients: routed.recipients, routes: routed.routes } }]);
    });
    expect(recipientRows(h.db, r.alert_id)).toEqual([
      { step: 0, staff_id: KAMRAN, for_staff_id: ALI },
      { step: 1, staff_id: ALI, for_staff_id: null },
    ]);
    expect(inbox(h.db, r.alert_id)).toEqual([ALI, KAMRAN]);
  });

  it('[01d §3.4.3] the fallback chain finds nobody: Ali is a no-route row and keeps his inbox row', async () => {
    const h = await harness(cleanups);
    const { result: r } = h.writer.run((tx) => {
      const out = alerts.raise(cmdCtx(tx, IMRAN), toAli);
      tx.append(out.events);
      return out;
    });
    expect(r.events[1]?.payload).toMatchObject({
      recipients: [{ staff_id: ALI, device_id: null, for_staff_id: null, set: 'recipient' }],
      routes: [],
    });
    expect(recipientRows(h.db, r.alert_id)).toEqual([{ step: 0, staff_id: ALI, for_staff_id: null }]);
    expect(inbox(h.db, r.alert_id)).toEqual([ALI]);
  });

  it('[01d §3.4.3] a request kind with no route: no fallback, the person keeps the row and the inbox row', async () => {
    const h = await harness(cleanups);
    h.ws.sessions = [{ staffId: IMRAN, deviceId: 'D_I', sessionId: 'SI', kind: 'staff', stationId: null }];
    const { result: r } = h.writer.run((tx) => {
      const out = alerts.raise(cmdCtx(tx, IMRAN), {
        kind: 't_accept',
        subject: { stream_type: 'table', stream_id: 'T1' },
        target: { kind: 'person', staff_id: ALI },
        display,
        dedupe_key: 'accept:ali',
        requester_staff_id: IMRAN,
        request: { receiver_staff_id: ALI },
      });
      tx.append(out.events);
      return out;
    });
    expect(recipientRows(h.db, r.alert_id)).toEqual([{ step: 0, staff_id: ALI, for_staff_id: null }]);
    expect(inbox(h.db, r.alert_id)).toEqual([ALI]);
  });
});
