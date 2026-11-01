import { verify } from '@node-rs/argon2';
import type { DirectoryInput, EventDraft, PosEvent } from '@pos/events';
import { anAttemptSent } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alerts, type RaiseInput } from '../../src/alerts/raise';
import { activity } from '../../src/auth/session-store';
import { currentDirectory } from '../../src/auth/guards';
import type { CommandCtx, CommandDef } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { aDirectory, PIN, pinHash } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, endSessionNow, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { FAKE_EFFECT_EVENT, fakeApply, registerFakes, resetFakes } from './fakes';

// 01d task 22: AnswerRequest — the answer rules (§3.3 rules 1, 3, 5, 6, 7), the session method and first
// answer wins (§6.2 Processing (0)–(10), Race), A4, A5, the §3.5 read-only contract and alert_id check;
// tests #6, #7, #8, #9, #18. PIN and in-person answers: answer-pin.int.test.ts (task 23).

// The argon2 verify the pipeline calls, counted (the real verify still runs).
vi.mock('@node-rs/argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@node-rs/argon2')>();
  return { ...actual, verify: vi.fn((hash: string, pin: string) => actual.verify(hash, pin)) };
});
const verifySpy = vi.mocked(verify);

const OWNER = 'S_OWNER'; // the requester's lead
const MGR = 'S_MGR'; // approver (R_MGR), approve-void branch scope, PIN.b
const LEAD = 'S_LEAD'; // approver (R_LEAD), approve-void my_team scope, nobody below them, PIN.c
const CASH = 'S_CASH'; // the accept kinds' receiver
const WAIT = 'S_WAIT'; // requester: void-item requires approval by R_MGR or R_LEAD
const TENANT = 'tenant-a';
const BRANCH = 'branch-1';

async function directory(o: { version?: number; approvers?: string[] } = {}): Promise<DirectoryInput> {
  const base = await aDirectory({ directory_version: o.version ?? 1 });
  const approvers = o.approvers ?? ['R_MGR', 'R_LEAD'];
  const roles = base.roles.map((role) =>
    role.role_id === 'R_WAIT'
      ? {
          ...role,
          permissions: [
            { permission: 'void-item' as const, grant_type: 'requires_approval' as const, approver_role_id: approvers[0] ?? null, approver_role_ids: approvers, scope: 'branch' as const },
          ],
        }
      : role,
  );
  roles.push({
    role_id: 'R_LEAD',
    name: 'Lead',
    session_idle_ttl_ms: 3_600_000,
    permissions: [{ permission: 'approve-void', grant_type: 'allowed', approver_role_id: null, approver_role_ids: [], scope: 'my_team' }],
  });
  const staff = base.staff.map((s) => (s.staff_id === WAIT ? { ...s, lead_staff_id: OWNER } : s));
  staff.push({ staff_id: LEAD, display_name: 'Lead', pin_hash: await pinHash(PIN.c), role_ids: ['R_LEAD'], denied_permissions: [], lead_staff_id: null, floor_ids: [] });
  return { ...base, roles, staff };
}

interface Seat {
  staffId: string;
  deviceId: string;
  deviceToken: string;
  sessionId: string;
  sessionToken: string;
}

interface World {
  hub: TestHub;
  clients: WsClient[];
}

async function world(cleanups: Array<() => Promise<void>>): Promise<World> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  await seedDirectory(hub, await directory());
  return { hub, clients: [] };
}

function seat(w: World, staffId: string, name: string = staffId): Seat {
  const device = pairDevice(w.hub, { type: 'tablet', name });
  const session = openSession(w.hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { staffId, deviceId: device.deviceId, deviceToken: device.token, sessionId: session.sessionId, sessionToken: session.token };
}

async function socketOf(w: World, s: Seat): Promise<WsClient> {
  const ws = await connectWs(w.hub.app);
  ws.send({ type: 'auth', device_token: s.deviceToken, session_token: s.sessionToken });
  await ws.untilCount(1);
  expect(ws.messages[0]).toMatchObject({ type: 'catch_up' });
  w.clients.push(ws);
  return ws;
}

async function until(client: WsClient, pred: (m: Record<string, unknown>) => boolean): Promise<void> {
  for (let i = 0; i < 50 && !(client.messages as Array<Record<string, unknown>>).some(pred); i += 1) {
    await client.untilCount(client.messages.length + 1);
  }
}

/** A request raised by a command handler on the requester's seat (raised_device_id = that device). */
function raiseAs(w: World, s: Seat, input: RaiseInput): string {
  return w.hub.deps.writer.run((tx) => {
    const ctx = {
      tx,
      state: tx.state,
      clock: tx.clock,
      ids: tx.ids,
      secrets: w.hub.deps.secrets,
      actor: { kind: 'staff', staffId: s.staffId, stationId: null, sessionId: s.sessionId, deviceId: s.deviceId },
      permission: null,
      branch: { tenantId: TENANT, branchId: BRANCH },
      directory: currentDirectory(w.hub.app),
      config: w.hub.deps.config,
    } as unknown as CommandCtx;
    const result = alerts.raise(ctx, input);
    tx.append(result.events);
    return result.alert_id;
  }).result;
}

const display = { kind_label_key: 'alert.t.lock', table_code: '12', requester_name: 'Order taker' };
const acceptInput = (n = 1): RaiseInput => ({
  kind: 't_accept',
  subject: { stream_type: 'table', stream_id: `T${n}` },
  target: { kind: 'person', staff_id: CASH },
  display,
  dedupe_key: `accept:T${n}`,
  requester_staff_id: WAIT,
  request: { receiver_staff_id: CASH },
});
const voidInput = (n = 1): RaiseInput => ({
  kind: 't_approval',
  subject: { stream_type: 'order', stream_id: `O${n}` },
  target: { kind: 'answerers' },
  values: { order_id: `O${n}` },
  display,
  details: { item: 'Mutton platter', quantity: 1, amount: 480_000, reason: 'customer changed mind' },
  dedupe_key: `void:O${n}:L1`,
  requester_staff_id: WAIT,
  request: { approver_role_ids: ['R_MGR', 'R_LEAD'] },
});

let commandNo = 0;
function answer(w: World, s: Seat, payload: Record<string, unknown>, commandId = `cmd-${(commandNo += 1)}`) {
  return w.hub.app.inject({
    method: 'POST',
    url: '/commands/answer-request',
    headers: { authorization: `Bearer ${s.deviceToken}`, 'x-session-token': s.sessionToken },
    payload: {
      command_id: commandId,
      tenant_id: TENANT,
      branch_id: BRANCH,
      command_type: 'AnswerRequest',
      payload,
      occurred_at: w.hub.clock.branchNow(),
      actor_id: s.staffId,
      device_id: s.deviceId,
    },
  });
}

function eventsOf(w: World, type: string): PosEvent[] {
  return (
    w.hub.deps.db.prepare('SELECT * FROM events WHERE event_type = ? ORDER BY seq').all(type) as Array<Record<string, unknown>>
  ).map((row) => ({ ...row, payload: JSON.parse(row.payload as string) }) as unknown as PosEvent);
}

function alertRow(w: World, id: string): { state: string; close_reason: string | null; decision: string | null; closed_by_staff_id: string | null } {
  return w.hub.deps.db.prepare('SELECT state, close_reason, decision, closed_by_staff_id FROM alerts WHERE alert_id = ?').get(id) as {
    state: string;
    close_reason: string | null;
    decision: string | null;
    closed_by_staff_id: string | null;
  };
}

function counts(w: World): { events: number; commands: number } {
  return {
    events: w.hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get() as number,
    commands: w.hub.deps.db.prepare('SELECT COUNT(*) FROM processed_commands').pluck().get() as number,
  };
}

function lockouts(w: World, staffId: string, deviceId: string): { staff: number; device: number } {
  const read = (type: string, id: string): number =>
    (w.hub.deps.db.prepare('SELECT failed_count FROM auth_lockouts WHERE subject_type = ? AND subject_id = ?').pluck().get(type, id) as
      | number
      | undefined) ?? 0;
  return { staff: read('staff', staffId), device: read('device', deviceId) };
}

type AnswerDef = CommandDef & { preRead: NonNullable<CommandDef['preRead']> };

/** Counts the statements of each preRead call (the read-only view's prepares go through the hub db). */
function countPreRead(w: World): { calls: number[]; restore(): void } {
  const def = commandRegistry(w.hub.app).byPath('answer-request') as AnswerDef;
  const counter = statementCounter(w.hub.deps.db);
  const original = def.preRead;
  const calls: number[] = [];
  def.preRead = (db, payload, ctx) => {
    counter.reset();
    try {
      original.call(def, db, payload, ctx);
    } finally {
      calls.push(counter.count);
    }
  };
  return {
    calls,
    restore() {
      def.preRead = original;
    },
  };
}

describe('01d AnswerRequest: rules, session answers, first answer wins (task 22)', () => {
  const cleanups: Array<() => Promise<void>> = [];
  beforeEach(() => registerFakes());
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    resetFakes();
    activity.drain();
    activity.drainDevices();
    verifySpy.mockClear();
  });

  it('[01d §6.2] preRead order on t_accept with method session: 404, 409, 400, 403 self, 403 not_receiver; 1 statement each, nothing written', async () => {
    const w = await world(cleanups);
    const wait = seat(w, WAIT);
    const cash = seat(w, CASH);
    const owner = seat(w, OWNER);
    const open = raiseAs(w, wait, acceptInput(1));
    const closed = raiseAs(w, wait, acceptInput(2));
    expect((await answer(w, cash, { alert_id: closed, decision: 'decline', method: 'session' })).statusCode).toBe(200);
    // a plain info alert has no request part → 404 too
    const info = raiseAs(w, wait, { kind: 't_info', subject: { stream_type: 'hub', stream_id: BRANCH }, target: { kind: 'person', staff_id: CASH }, display, dedupe_key: 'info:1' });
    const before = counts(w);
    const probe = countPreRead(w);
    const cases: Array<[Seat, Record<string, unknown>, number, string, Record<string, unknown>]> = [
      [cash, { alert_id: '01J0000000000000000000NONE', decision: 'accept', method: 'session' }, 404, 'ALERT_NOT_FOUND', { alert_id: '01J0000000000000000000NONE' }],
      [cash, { alert_id: info, decision: 'accept', method: 'session' }, 404, 'ALERT_NOT_FOUND', { alert_id: info }],
      [
        cash,
        { alert_id: closed, decision: 'accept', method: 'session' },
        409,
        'REQUEST_NOT_PENDING',
        { alert_id: closed, state: 'closed', close_reason: 'answered', decision: 'decline', answered_by_staff_id: CASH, answered_by_name: 'Cashier' },
      ],
      [cash, { alert_id: open, decision: 'approve', method: 'session' }, 400, 'VALIDATION_FAILED', {}],
      [wait, { alert_id: open, decision: 'accept', method: 'session' }, 403, 'PERMISSION_DENIED', { reason: 'self' }],
      [owner, { alert_id: open, decision: 'accept', method: 'session' }, 403, 'PERMISSION_DENIED', { reason: 'not_receiver' }],
    ];
    for (const [who, payload, status, code, details] of cases) {
      const response = await answer(w, who, payload);
      expect(response.statusCode, code).toBe(status);
      expect(response.json().error.code).toBe(code);
      expect(response.json().error.details).toMatchObject(details);
    }
    expect(probe.calls).toEqual([1, 1, 1, 1, 1, 1]);
    probe.restore();
    expect(counts(w)).toEqual(before);
    expect(fakeApply.calls.filter((c) => c.alert_id === open)).toEqual([]);
    expect(alertRow(w, open).state).toBe('open');
  });

  it('[01d §6.2] a money kind with method session is 422 REQUEST_PIN_REQUIRED from preRead (rule 3, before self and right)', async () => {
    const w = await world(cleanups);
    const wait = seat(w, WAIT);
    const owner = seat(w, OWNER); // not an approver: rule 3 answers first
    const id = raiseAs(w, wait, voidInput());
    for (const who of [owner, wait]) {
      const response = await answer(w, who, { alert_id: id, decision: 'approve', method: 'session' });
      expect(response.statusCode).toBe(422);
      expect(response.json().error).toMatchObject({ code: 'REQUEST_PIN_REQUIRED', details: { alert_id: id, kind: 't_approval' } });
    }
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('[01d §6.2] success: RequestAnswered { on_requester_device: false }, the effect, request_result to the requester, closed answered, alert_closed to every recipient of every step; 1 preRead statement', async () => {
    const w = await world(cleanups);
    const wait = seat(w, WAIT, 'wait-tab');
    const cash = seat(w, CASH, 'cash-tab');
    const owner = seat(w, OWNER, 'owner-tab');
    const waitWs = await socketOf(w, wait);
    const cashWs = await socketOf(w, cash);
    const ownerWs = await socketOf(w, owner);
    const id = raiseAs(w, wait, { ...acceptInput(), kind: 't_handover_like', values: { table_id: 'T1' } });
    // step 1 as the tick will write it: the receiver again and the requester's lead, informed
    w.hub.deps.writer.run((tx) => {
      const step = anAttemptSent({
        stream_type: 'table',
        stream_id: 'T1',
        payload: {
          alert_id: id,
          step: 1,
          recipients: [
            { staff_id: CASH, device_id: null, for_staff_id: null, set: 'answerer' },
            { staff_id: OWNER, device_id: null, for_staff_id: null, set: 'informed' },
          ],
          routes: [],
        },
      });
      tx.append([{ ...step, payload: step.payload } as EventDraft]);
    });
    const probe = countPreRead(w);
    const response = await answer(w, cash, { alert_id: id, decision: 'accept', method: 'session' }, 'cmd-ok');
    probe.restore();
    expect(response.statusCode).toBe(200);
    expect(probe.calls).toEqual([1]);
    const answered = eventsOf(w, 'RequestAnswered');
    expect(answered).toHaveLength(1);
    expect(answered[0]).toMatchObject({
      stream_type: 'table',
      stream_id: 'T1',
      actor_id: CASH,
      device_id: cash.deviceId,
      payload: { alert_id: id, decision: 'accept', answerer_staff_id: CASH, method: 'session', device_id: cash.deviceId, on_requester_device: false },
    });
    const body = response.json() as { data: { event_ids: string[]; result: unknown } };
    expect(body.data.result).toEqual({ alert_id: id, decision: 'accept', answered_at: w.hub.clock.branchNow() });
    // the kind's apply ran on the answer with typed facts, and its effect carries alert_id
    const applied = fakeApply.calls.filter((c) => c.fn === 'apply' && c.alert_id === id);
    expect(applied.length).toBeGreaterThanOrEqual(1);
    expect(applied.at(-1)?.answer).toEqual({ decision: 'accept', answerer_staff_id: CASH, method: 'session', device_id: cash.deviceId, answered_at: w.hub.clock.branchNow() });
    expect(eventsOf(w, FAKE_EFFECT_EVENT).map((e) => e.payload)).toEqual([{ alert_id: id }]);
    // request_result to the requester, in the same transaction
    const results = eventsOf(w, 'AlertRaised').filter((e) => e.payload.kind === 'request_result');
    expect(results).toHaveLength(1);
    expect(results[0]?.payload).toMatchObject({
      target: { kind: 'person', staff_id: WAIT },
      values: { request_alert_id: id, request_kind: 't_handover_like', close_reason: 'answered', decision: 'accept', by_staff_id: CASH },
      dedupe_key: `request_result:${id}`,
    });
    const eventIds = new Set(body.data.event_ids);
    expect(eventIds.has(answered[0]!.event_id)).toBe(true);
    expect(eventIds.has(results[0]!.event_id)).toBe(true);
    expect(alertRow(w, id)).toEqual({ state: 'closed', close_reason: 'answered', decision: 'accept', closed_by_staff_id: CASH });
    // alert_closed after commit: the receiver (step 0 and 1), the lead (step 1 only), the requester
    const closedFrame = { type: 'alert_closed', alert_id: id, reason: 'answered', decision: 'accept', by_name: 'Cashier' };
    for (const client of [cashWs, ownerWs, waitWs]) {
      await until(client, (m) => m.type === 'alert_closed' && m.alert_id === id);
      expect(client.messages.filter((m) => (m as { type: string }).type === 'alert_closed')).toEqual([closedFrame]);
    }
    await until(waitWs, (m) => m.type === 'alert' && (m.alert as { kind: string }).kind === 'request_result');
    expect(waitWs.messages.some((m) => (m as { type: string; alert?: { kind: string } }).alert?.kind === 'request_result')).toBe(true);
  });

  it('[01d §6.2] an answer from the raising device sets on_requester_device: true', async () => {
    const w = await world(cleanups);
    const wait = seat(w, WAIT);
    const id = raiseAs(w, wait, acceptInput());
    // the requester signs out and the receiver signs in on the requester's tablet
    endSessionNow(w.hub, wait.sessionId);
    const shared = openSession(w.hub, { kind: 'staff', staffId: CASH, deviceId: wait.deviceId });
    const there: Seat = { ...wait, staffId: CASH, sessionId: shared.sessionId, sessionToken: shared.token };
    expect((await answer(w, there, { alert_id: id, decision: 'accept', method: 'session' })).statusCode).toBe(200);
    expect(eventsOf(w, 'RequestAnswered')[0]?.payload).toMatchObject({ device_id: wait.deviceId, on_requester_device: true });
  });

  it('[01d #6] two AnswerRequest at once on one request: one 200, one 409 REQUEST_NOT_PENDING { answered_by_name }; one RequestAnswered', async () => {
    const w = await world(cleanups);
    const wait = seat(w, WAIT);
    const first = seat(w, CASH, 'cash-1');
    const second = seat(w, CASH, 'cash-2');
    const id = raiseAs(w, wait, acceptInput());
    let entered = 0;
    let inner: Awaited<ReturnType<typeof answer>> | undefined;
    // both pass preRead (the request is open for both), then both run into the writer
    w.hub.deps.testHooks = {
      async betweenGuardAndWriter() {
        entered += 1;
        if (entered === 1) inner = await answer(w, second, { alert_id: id, decision: 'decline', method: 'session' }, 'cmd-race-2');
      },
    };
    const outer = await answer(w, first, { alert_id: id, decision: 'accept', method: 'session' }, 'cmd-race-1');
    expect(entered).toBe(2);
    expect(inner?.statusCode).toBe(200);
    expect(outer.statusCode).toBe(409);
    expect(outer.json().error).toMatchObject({
      code: 'REQUEST_NOT_PENDING',
      details: { alert_id: id, state: 'closed', close_reason: 'answered', decision: 'decline', answered_by_staff_id: CASH, answered_by_name: 'Cashier' },
    });
    expect(eventsOf(w, 'RequestAnswered')).toHaveLength(1);
    expect(eventsOf(w, FAKE_EFFECT_EVENT)).toHaveLength(1);
    expect(eventsOf(w, 'AlertRaised').filter((e) => e.payload.kind === 'request_result')).toHaveLength(1);
    expect(w.hub.deps.db.prepare("SELECT COUNT(*) FROM processed_commands WHERE command_id LIKE 'cmd-race-%'").pluck().get()).toBe(1);
  });

  it('[01d §6.2] answer vs. alerts.close: the request closed obsolete between preRead and the writer → 409, nothing answered', async () => {
    const w = await world(cleanups);
    const wait = seat(w, WAIT);
    const cash = seat(w, CASH);
    const id = raiseAs(w, wait, acceptInput());
    w.hub.deps.testHooks = {
      async betweenGuardAndWriter() {
        w.hub.deps.writer.run((tx) => {
          tx.append(alerts.close(alerts.tickCtx(tx, w.hub.clock.branchNow()), id, 'obsolete', 'table closed'));
        });
      },
    };
    const response = await answer(w, cash, { alert_id: id, decision: 'accept', method: 'session' });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.details).toMatchObject({ close_reason: 'obsolete', decision: null, answered_by_staff_id: null, answered_by_name: null });
    expect(eventsOf(w, 'RequestAnswered')).toHaveLength(0);
  });

  it('[01d #7] apply throws → no 200, no RequestAnswered, the request still pending, the error code passed through (preRead and the writer)', async () => {
    const w = await world(cleanups);
    const wait = seat(w, WAIT);
    const cash = seat(w, CASH);
    const id = raiseAs(w, wait, acceptInput());
    const before = counts(w);
    // (a) refused by apply in preRead
    fakeApply.mode = 'throw';
    const pre = await answer(w, cash, { alert_id: id, decision: 'accept', method: 'session' });
    expect(pre.statusCode).toBe(409);
    expect(pre.json().error).toMatchObject({ code: 'ITEM_WRONG_STAGE', details: { reason: 'fake_apply' } });
    // (b) state changed between preRead and the writer: apply refuses inside the transaction (A4)
    fakeApply.mode = 'ok';
    w.hub.deps.testHooks = {
      async betweenGuardAndWriter() {
        fakeApply.mode = 'throw';
      },
    };
    const late = await answer(w, cash, { alert_id: id, decision: 'accept', method: 'session' });
    expect(late.statusCode).toBe(409);
    expect(late.json().error.code).toBe('ITEM_WRONG_STAGE');
    expect(fakeApply.calls.filter((c) => c.alert_id === id).length).toBe(3); // preRead (a), preRead (b), handle (b)
    expect(counts(w)).toEqual(before);
    expect(eventsOf(w, 'RequestAnswered')).toHaveLength(0);
    expect(alertRow(w, id).state).toBe('open');
  });

  it('[01d §3.5] apply drafts without the alert_id (or with another one) → 500, nothing written; a write in apply → 500', async () => {
    const w = await world(cleanups);
    const wait = seat(w, WAIT);
    const cash = seat(w, CASH);
    const id = raiseAs(w, wait, acceptInput());
    const before = counts(w);
    for (const mode of ['no_alert_id', 'other_alert_id', 'write', 'append', 'onCommit'] as const) {
      fakeApply.mode = mode;
      const response = await answer(w, cash, { alert_id: id, decision: 'accept', method: 'session' });
      expect(response.statusCode, mode).toBe(500);
      expect(response.json().error.code).toBe('INTERNAL_ERROR');
    }
    expect(counts(w)).toEqual(before);
    expect(w.hub.deps.db.prepare('SELECT step FROM alerts WHERE alert_id = ?').pluck().get(id)).toBe(0);
    expect(alertRow(w, id).state).toBe('open');
  });

  it('[01d #8] right removed between the step and the answer (directory apply) → 403 not_approver, no PIN verified', async () => {
    const w = await world(cleanups);
    const wait = seat(w, WAIT);
    const mgr = seat(w, MGR);
    const id = raiseAs(w, wait, voidInput()); // MGR is an answerer at step 0
    await seedDirectory(w.hub, await directory({ version: 2, approvers: ['R_LEAD'] }));
    const response = await answer(w, mgr, { alert_id: id, decision: 'approve', method: 'pin', pin: PIN.b });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'not_approver' } });
    expect(JSON.stringify(response.json())).not.toContain(PIN.b);
    expect(verifySpy).not.toHaveBeenCalled();
    expect(lockouts(w, MGR, mgr.deviceId)).toEqual({ staff: 0, device: 0 });
    expect(eventsOf(w, 'RequestAnswered')).toHaveLength(0);
  });

  it('[01d §3.3 rule 6] A5: the right removed while the command waits for the writer → 403 not_approver from the authoritative check', async () => {
    const w = await world(cleanups);
    const wait = seat(w, WAIT);
    const mgr = seat(w, MGR);
    const id = raiseAs(w, wait, voidInput());
    const next = await directory({ version: 2, approvers: ['R_LEAD'] });
    w.hub.deps.testHooks = {
      async betweenGuardAndWriter() {
        await seedDirectory(w.hub, next);
      },
    };
    const response = await answer(w, mgr, { alert_id: id, decision: 'approve', method: 'pin', pin: PIN.b });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.details).toMatchObject({ reason: 'not_approver' });
    expect(eventsOf(w, 'RequestAnswered')).toHaveLength(0);
    expect(alertRow(w, id).state).toBe('open');
  });

  it('[01d #9] a my_team answerer for a requester outside the team → 403 out_of_range (no PIN verified); a branch-scope answerer → 200', async () => {
    const w = await world(cleanups);
    const wait = seat(w, WAIT);
    const lead = seat(w, LEAD);
    const mgr = seat(w, MGR);
    const id = raiseAs(w, wait, voidInput());
    const probe = countPreRead(w);
    const refused = await answer(w, lead, { alert_id: id, decision: 'approve', method: 'pin', pin: PIN.c });
    probe.restore();
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'out_of_range' } });
    expect(probe.calls).toEqual([1]);
    expect(verifySpy).not.toHaveBeenCalled();
    expect(lockouts(w, LEAD, lead.deviceId)).toEqual({ staff: 0, device: 0 });

    const ok = await answer(w, mgr, { alert_id: id, decision: 'approve', method: 'pin', pin: PIN.b });
    expect(ok.statusCode).toBe(200);
    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect(eventsOf(w, 'RequestAnswered')[0]?.payload).toMatchObject({ alert_id: id, answerer_staff_id: MGR, method: 'pin', on_requester_device: false });
    expect(alertRow(w, id)).toMatchObject({ state: 'closed', close_reason: 'answered', decision: 'approve' });
    expect(JSON.stringify(eventsOf(w, 'RequestAnswered'))).not.toContain(PIN.b);
  });

  it('[01d §6.2] method pin goes through checkPin: a wrong PIN → 401 PIN_INVALID, counted, nothing answered (no PIN-free path)', async () => {
    const w = await world(cleanups);
    const wait = seat(w, WAIT);
    const mgr = seat(w, MGR);
    const id = raiseAs(w, wait, voidInput());
    const response = await answer(w, mgr, { alert_id: id, decision: 'approve', method: 'pin', pin: '5555' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('PIN_INVALID');
    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect(lockouts(w, MGR, mgr.deviceId)).toEqual({ staff: 1, device: 1 });
    expect(eventsOf(w, 'RequestAnswered')).toHaveLength(0);
    expect(alertRow(w, id).state).toBe('open');
    // the session method on a pin kind can never skip the PIN (rule 3)
    expect((await answer(w, mgr, { alert_id: id, decision: 'approve', method: 'session' })).statusCode).toBe(422);
  });

  it('[01d §6.2] a station session → 403 PERMISSION_DENIED { session_kind: station }', async () => {
    const w = await world(cleanups);
    const wait = seat(w, WAIT);
    const id = raiseAs(w, wait, acceptInput());
    const kds = pairDevice(w.hub, { type: 'kds', stationId: 'station-1' });
    const station = openSession(w.hub, { kind: 'station', stationId: 'station-1', deviceId: kds.deviceId });
    const response = await w.hub.app.inject({
      method: 'POST',
      url: '/commands/answer-request',
      headers: { authorization: `Bearer ${kds.token}`, 'x-session-token': station.token },
      payload: {
        command_id: 'cmd-station',
        tenant_id: TENANT,
        branch_id: BRANCH,
        command_type: 'AnswerRequest',
        payload: { alert_id: id, decision: 'accept', method: 'session' },
        occurred_at: w.hub.clock.branchNow(),
        actor_id: null,
        device_id: kds.deviceId,
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { session_kind: 'station' } });
  });

  it('[01d #18] answer idempotency: the same command_id replays the stored 200, nothing new written', async () => {
    const w = await world(cleanups);
    const wait = seat(w, WAIT);
    const cash = seat(w, CASH);
    const mgr = seat(w, MGR);
    const accept = raiseAs(w, wait, acceptInput());
    const first = await answer(w, cash, { alert_id: accept, decision: 'accept', method: 'session' }, 'cmd-idem');
    expect(first.statusCode).toBe(200);
    const before = counts(w);
    const again = await answer(w, cash, { alert_id: accept, decision: 'accept', method: 'session' }, 'cmd-idem');
    expect(again.statusCode).toBe(200);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.json()).toEqual(first.json());
    expect(counts(w)).toEqual(before);
    // with a PIN: the replay needs no argon2 (rule 4 (a))
    const money = raiseAs(w, wait, voidInput(2));
    expect((await answer(w, mgr, { alert_id: money, decision: 'reject', method: 'pin', pin: PIN.b }, 'cmd-idem-pin')).statusCode).toBe(200);
    verifySpy.mockClear();
    const replay = await answer(w, mgr, { alert_id: money, decision: 'reject', method: 'pin', pin: PIN.b }, 'cmd-idem-pin');
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(verifySpy).not.toHaveBeenCalled();
    expect(eventsOf(w, 'RequestAnswered')).toHaveLength(2);
  });
});
