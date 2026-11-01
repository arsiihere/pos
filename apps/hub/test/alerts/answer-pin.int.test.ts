import { verify } from '@node-rs/argon2';
import type { DirectoryInput, PosEvent } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineAlertKind, APPROVAL_TIER_STEPS } from '../../src/alerts/kinds';
import { alerts, type RaiseInput } from '../../src/alerts/raise';
import { activity } from '../../src/auth/session-store';
import { currentDirectory } from '../../src/auth/guards';
import type { CommandCtx, CommandDef } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { payloadHash } from '../../src/lib/hash';
import { aDirectory, PIN, pinHash } from '../helpers/fixtures';
import { createTestHub, endSessionNow, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { FAKE_EFFECT_EVENT, fakeApply, registerFakes, resetFakes } from './fakes';

// 01d task 23: AnswerRequest with `pin` and `in_person` — §6.2 pinCheck row / Processing / Race, §3.3 rules
// 2–4 (all of (a)–(d), "What a guesser learns", "PIN never stored"), §3.10 `pin_use_failed`, §4.2
// `RequestPinFailed`, BF-1, BF-2; tests #11, #44, #54, #56 (hub), #60, #66; Review Focus 2.

// The argon2 verify the pipeline calls, counted (the real verify still runs).
vi.mock('@node-rs/argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@node-rs/argon2')>();
  return { ...actual, verify: vi.fn((hash: string, pin: string) => actual.verify(hash, pin)) };
});
const verifySpy = vi.mocked(verify);

const OWNER = 'S_OWNER'; // the requester's lead; an approver (R_OWNER), PIN.a
const MGR = 'S_MGR'; // approver (R_MGR), approve-void branch scope, PIN.b (or `mgrPin`)
const LEAD = 'S_LEAD'; // approver (R_LEAD), approve-void my_team scope, nobody below them, PIN.c
const CASH = 'S_CASH'; // the accept kinds' receiver, PIN.c
const WAIT = 'S_WAIT'; // requester: void-item requires approval by R_MGR, R_LEAD or R_OWNER
const TENANT = 'tenant-a';
const BRANCH = 'branch-1';
const WRONG = '5555';

async function directory(o: { mgrPin?: string } = {}): Promise<DirectoryInput> {
  const base = await aDirectory({ directory_version: 1 });
  const approvers = ['R_MGR', 'R_LEAD', 'R_OWNER'];
  const roles = base.roles.map((role) =>
    role.role_id === 'R_WAIT'
      ? {
          ...role,
          permissions: [
            { permission: 'void-item' as const, grant_type: 'requires_approval' as const, approver_role_id: 'R_MGR', approver_role_ids: approvers, scope: 'branch' as const },
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
  const mgrHash = o.mgrPin === undefined ? undefined : await pinHash(o.mgrPin);
  const staff = base.staff.map((s) => {
    if (s.staff_id === WAIT) return { ...s, lead_staff_id: OWNER };
    if (s.staff_id === MGR && mgrHash !== undefined) return { ...s, pin_hash: mgrHash };
    return s;
  });
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

async function world(cleanups: Array<() => Promise<void>>, o: { mgrPin?: string } = {}): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  await seedDirectory(hub, await directory(o));
  return hub;
}

function seat(hub: TestHub, staffId: string, name: string = staffId): Seat {
  const device = pairDevice(hub, { type: 'tablet', name });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { staffId, deviceId: device.deviceId, deviceToken: device.token, sessionId: session.sessionId, sessionToken: session.token };
}

/** A new session on a seat's device (the old one ended). */
function reseat(hub: TestHub, s: Seat): Seat {
  const session = openSession(hub, { kind: 'staff', staffId: s.staffId, deviceId: s.deviceId });
  return { ...s, sessionId: session.sessionId, sessionToken: session.token };
}

/** A request raised by a command handler on the requester's seat (raised_device_id = that device). */
function raiseAs(hub: TestHub, s: Seat, input: RaiseInput): string {
  return hub.deps.writer.run((tx) => {
    const ctx = {
      tx,
      state: tx.state,
      clock: tx.clock,
      ids: tx.ids,
      secrets: hub.deps.secrets,
      actor: { kind: 'staff', staffId: s.staffId, stationId: null, sessionId: s.sessionId, deviceId: s.deviceId },
      permission: null,
      branch: { tenantId: TENANT, branchId: BRANCH },
      directory: currentDirectory(hub.app),
      config: hub.deps.config,
    } as unknown as CommandCtx;
    const result = alerts.raise(ctx, input);
    tx.append(result.events);
    return result.alert_id;
  }).result;
}

/** The requester withdraws (WithdrawRequest is a later task: its event, as the command will write it). */
function withdraw(hub: TestHub, alertId: string, n: number): void {
  hub.deps.writer.run((tx) => {
    tx.append([
      {
        stream_type: 'order',
        stream_id: `O${n}`,
        event_type: 'RequestWithdrawn',
        schema_version: 1,
        payload: { alert_id: alertId, by_staff_id: WAIT },
        occurred_at: hub.clock.branchNow(),
        actor_id: WAIT,
        device_id: 'test',
      },
    ]);
  });
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
  request: { approver_role_ids: ['R_MGR', 'R_LEAD', 'R_OWNER'] },
});

let commandNo = 0;
function answer(hub: TestHub, s: Seat, payload: Record<string, unknown>, commandId = `cmd-${(commandNo += 1)}`) {
  return hub.app.inject({
    method: 'POST',
    url: '/commands/answer-request',
    headers: { authorization: `Bearer ${s.deviceToken}`, 'x-session-token': s.sessionToken },
    payload: {
      command_id: commandId,
      tenant_id: TENANT,
      branch_id: BRANCH,
      command_type: 'AnswerRequest',
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: s.staffId,
      device_id: s.deviceId,
    },
  });
}

const inPerson = (alertId: string, answerer: string, pin: string, decision = 'approve') => ({
  alert_id: alertId,
  decision,
  method: 'in_person',
  answerer_staff_id: answerer,
  pin,
});
const byPin = (alertId: string, pin: string, decision = 'approve') => ({ alert_id: alertId, decision, method: 'pin', pin });

function eventsOf(hub: TestHub, type: string): PosEvent[] {
  return (hub.deps.db.prepare('SELECT * FROM events WHERE event_type = ? ORDER BY seq').all(type) as Array<Record<string, unknown>>).map(
    (row) => ({ ...row, payload: JSON.parse(row.payload as string) }) as unknown as PosEvent,
  );
}

const pinUseFailed = (hub: TestHub): PosEvent[] => eventsOf(hub, 'AlertRaised').filter((e) => e.payload.kind === 'pin_use_failed');

function alertRow(hub: TestHub, id: string): Record<string, unknown> {
  return hub.deps.db.prepare('SELECT * FROM alerts WHERE alert_id = ?').get(id) as Record<string, unknown>;
}

function counts(hub: TestHub): { events: number; commands: number } {
  return {
    events: hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get() as number,
    commands: hub.deps.db.prepare('SELECT COUNT(*) FROM processed_commands').pluck().get() as number,
  };
}

function lockouts(hub: TestHub, staffId: string, deviceId: string): { staff: number; device: number } {
  const read = (type: string, id: string): number =>
    (hub.deps.db.prepare('SELECT failed_count FROM auth_lockouts WHERE subject_type = ? AND subject_id = ?').pluck().get(type, id) as
      | number
      | undefined) ?? 0;
  return { staff: read('staff', staffId), device: read('device', deviceId) };
}

/** The response body a guesser sees, without the per-request id (and with the alert id masked when given). */
function bodyOf(response: { json(): unknown }, maskId?: string): unknown {
  const body = response.json() as { error?: Record<string, unknown> };
  const text = JSON.stringify(body.error === undefined ? body : { ...body, error: { ...body.error, request_id: '<req>' } });
  return JSON.parse(maskId === undefined ? text : text.replaceAll(maskId, '<id>'));
}

type AnswerDef = CommandDef & { pinHooks: NonNullable<CommandDef['pinHooks']> };
const answerDef = (hub: TestHub): AnswerDef => commandRegistry(hub.app).byPath('answer-request') as AnswerDef;

/** Runs `fn` once, inside the first command's betweenVerifyAndWriter (re-entrant calls pass through). */
function duringArgon2(hub: TestHub, fn: () => Promise<void> | void): { entered: () => number } {
  let entered = 0;
  hub.deps.testHooks = {
    async betweenVerifyAndWriter() {
      entered += 1;
      if (entered === 1) await fn();
    },
  };
  return { entered: () => entered };
}

describe('01d AnswerRequest: PIN and in person, counted failures, pin_use_failed (task 23)', () => {
  const cleanups: Array<() => Promise<void>> = [];
  beforeEach(() => registerFakes());
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    resetFakes();
    activity.drain();
    activity.drainDevices();
    verifySpy.mockClear();
  });

  it('[01d #11] a money kind with method session → 422 REQUEST_PIN_REQUIRED; an accept kind with method session → 200 without a PIN', async () => {
    const hub = await world(cleanups);
    const wait = seat(hub, WAIT);
    const mgr = seat(hub, MGR);
    const cash = seat(hub, CASH);
    const money = raiseAs(hub, wait, voidInput());
    const refused = await answer(hub, mgr, { alert_id: money, decision: 'approve', method: 'session' });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error).toMatchObject({ code: 'REQUEST_PIN_REQUIRED', details: { alert_id: money, kind: 't_approval' } });
    const accept = raiseAs(hub, wait, acceptInput());
    const ok = await answer(hub, cash, { alert_id: accept, decision: 'accept', method: 'session' });
    expect(ok.statusCode).toBe(200);
    expect(verifySpy).not.toHaveBeenCalled();
    expect(lockouts(hub, MGR, mgr.deviceId)).toEqual({ staff: 0, device: 0 });
  });

  it('[01d #44] decision outside answers → 400 from preRead; in person with an unknown answerer → 404 STAFF_NOT_FOUND, not counted; a retried answered command_id replays 200 without argon2', async () => {
    const hub = await world(cleanups);
    const wait = seat(hub, WAIT);
    const id = raiseAs(hub, wait, voidInput());
    const before = counts(hub);
    const decision = await answer(hub, wait, inPerson(id, MGR, PIN.b, 'accept'));
    expect(decision.statusCode).toBe(400);
    expect(decision.json().error).toMatchObject({ code: 'VALIDATION_FAILED', details: { issues: [{ path: 'decision' }] } });
    const unknown = await answer(hub, wait, inPerson(id, 'S_NOBODY', PIN.b));
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error).toMatchObject({ code: 'STAFF_NOT_FOUND', details: { staff_id: 'S_NOBODY' } });
    expect(verifySpy).not.toHaveBeenCalled();
    expect(lockouts(hub, 'S_NOBODY', wait.deviceId)).toEqual({ staff: 0, device: 0 });
    expect(counts(hub)).toEqual(before);
    // the answer, then its retry: the stored 200, no PIN check
    const first = await answer(hub, wait, inPerson(id, MGR, PIN.b), 'cmd-44');
    expect(first.statusCode).toBe(200);
    verifySpy.mockClear();
    const again = await answer(hub, wait, inPerson(id, MGR, PIN.b), 'cmd-44');
    expect(again.statusCode).toBe(200);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.json()).toEqual(first.json());
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('[01d §3.3 rule 2] in person from a device other than raised_device_id → 403 in_person_elsewhere from preRead, no PIN verified, nothing counted', async () => {
    const hub = await world(cleanups);
    const wait = seat(hub, WAIT, 'wait-tab');
    const mgr = seat(hub, MGR, 'mgr-tab');
    const id = raiseAs(hub, wait, voidInput());
    const before = counts(hub);
    for (const pin of [PIN.b, WRONG]) {
      const response = await answer(hub, mgr, inPerson(id, MGR, pin));
      expect(response.statusCode).toBe(403);
      expect(response.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'in_person_elsewhere' } });
      expect(JSON.stringify(response.json())).not.toContain(pin);
    }
    // §3.3 rule 4 (b) order: an unknown answerer is 404 before the device check
    expect((await answer(hub, mgr, inPerson(id, 'S_NOBODY', PIN.b))).json().error.code).toBe('STAFF_NOT_FOUND');
    expect(verifySpy).not.toHaveBeenCalled();
    expect(lockouts(hub, MGR, mgr.deviceId)).toEqual({ staff: 0, device: 0 });
    expect(counts(hub)).toEqual(before);
    expect(alertRow(hub, id).state).toBe('open');
  });

  it('[01d §6.2] in person on the raising device: the named answerer answers, on_requester_device true; the device lockout subject is this (= the raising) device', async () => {
    const hub = await world(cleanups);
    const wait = seat(hub, WAIT, 'wait-tab');
    const mgr = seat(hub, MGR, 'mgr-tab');
    const id = raiseAs(hub, wait, voidInput());
    const wrong = await answer(hub, wait, inPerson(id, MGR, WRONG));
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe('PIN_INVALID');
    expect(JSON.stringify(wrong.json())).not.toContain(WRONG);
    // counted on the named answerer and on the raising device, never on the answerer's own device
    expect(lockouts(hub, MGR, wait.deviceId)).toEqual({ staff: 1, device: 1 });
    expect(lockouts(hub, MGR, mgr.deviceId).device).toBe(0);
    const failed = eventsOf(hub, 'RequestPinFailed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      stream_type: 'audit',
      stream_id: id,
      payload: {
        alert_id: id,
        subject_stream_type: 'order',
        subject_stream_id: 'O1',
        answerer_staff_id: MGR,
        method: 'in_person',
        device_id: wait.deviceId,
        requester_staff_id: WAIT,
        outcome: 'pin_invalid',
        error_code: 'PIN_INVALID',
      },
    });

    const ok = await answer(hub, wait, inPerson(id, MGR, PIN.b));
    expect(ok.statusCode).toBe(200);
    const answered = eventsOf(hub, 'RequestAnswered');
    expect(answered).toHaveLength(1);
    expect(answered[0]).toMatchObject({
      actor_id: WAIT,
      device_id: wait.deviceId,
      payload: { alert_id: id, decision: 'approve', answerer_staff_id: MGR, method: 'in_person', device_id: wait.deviceId, on_requester_device: true },
    });
    const applied = fakeApply.calls.filter((c) => c.fn === 'apply' && c.alert_id === id).at(-1);
    expect(applied?.answer).toMatchObject({ answerer_staff_id: MGR, method: 'in_person', device_id: wait.deviceId });
    expect(alertRow(hub, id)).toMatchObject({ state: 'closed', close_reason: 'answered', decision: 'approve', closed_by_staff_id: MGR });
    // a match resets the named answerer's counter; the device counter stays
    expect(lockouts(hub, MGR, wait.deviceId)).toEqual({ staff: 0, device: 1 });
    expect(pinUseFailed(hub)).toHaveLength(0);
  });

  it('[01d #54] in person on a random ULID, a closed request, out of range, self → 404 / 409 / 403, the same response for a correct and a wrong PIN; no argon2, nothing counted, nothing written', async () => {
    const hub = await world(cleanups);
    const wait = seat(hub, WAIT, 'wait-tab');
    const mgr = seat(hub, MGR, 'mgr-tab');
    const open = raiseAs(hub, wait, voidInput(1));
    const closed = raiseAs(hub, wait, voidInput(2));
    expect((await answer(hub, mgr, byPin(closed, PIN.b, 'reject'))).statusCode).toBe(200);
    verifySpy.mockClear();
    const before = counts(hub);
    const cases: Array<[string, Record<string, unknown>, Record<string, unknown>, number, string]> = [
      ['random', inPerson('01J0000000000000000000NONE', MGR, PIN.b), inPerson('01J0000000000000000000NONE', MGR, WRONG), 404, 'ALERT_NOT_FOUND'],
      ['closed', inPerson(closed, MGR, PIN.b), inPerson(closed, MGR, WRONG), 409, 'REQUEST_NOT_PENDING'],
      ['out_of_range', inPerson(open, LEAD, PIN.c), inPerson(open, LEAD, WRONG), 403, 'PERMISSION_DENIED'],
      ['self', inPerson(open, WAIT, PIN.a), inPerson(open, WAIT, WRONG), 403, 'PERMISSION_DENIED'],
    ];
    for (const [name, right, wrong, status, code] of cases) {
      const a = await answer(hub, wait, right);
      const b = await answer(hub, wait, wrong);
      expect(a.statusCode, name).toBe(status);
      expect(a.json().error.code, name).toBe(code);
      expect(b.statusCode, name).toBe(status);
      expect(bodyOf(b), name).toEqual(bodyOf(a));
    }
    expect(verifySpy).not.toHaveBeenCalled();
    for (const who of [MGR, LEAD, WAIT]) expect(lockouts(hub, who, wait.deviceId)).toEqual({ staff: 0, device: 0 });
    expect(counts(hub)).toEqual(before);
  });

  it('[01d #54] race: answered by someone else while argon2 runs → 409 for both PINs, each counted once, one RequestPinFailed answer_failed each; the correct one raises pin_use_failed and resets nothing', async () => {
    const hub = await world(cleanups);
    const wait = seat(hub, WAIT, 'wait-tab');
    const owner = seat(hub, OWNER, 'owner-tab');
    const results: Array<{ status: number; body: Record<string, unknown>; delta: { staff: number; device: number } }> = [];
    for (const [n, pin] of [
      [1, PIN.b],
      [2, WRONG],
    ] as const) {
      const id = raiseAs(hub, wait, voidInput(n));
      const before = lockouts(hub, MGR, wait.deviceId);
      duringArgon2(hub, async () => {
        expect((await answer(hub, owner, byPin(id, PIN.a))).statusCode).toBe(200);
      });
      const response = await answer(hub, wait, inPerson(id, MGR, pin), `cmd-54-${n}`);
      const after = lockouts(hub, MGR, wait.deviceId);
      const body = bodyOf(response, id) as Record<string, unknown>;
      results.push({ status: response.statusCode, body, delta: { staff: after.staff - before.staff, device: after.device - before.device } });
      const failed = eventsOf(hub, 'RequestPinFailed').filter((e) => e.payload.alert_id === id);
      expect(failed).toHaveLength(1);
      expect(failed[0]?.payload).toEqual({
        alert_id: id,
        subject_stream_type: 'order',
        subject_stream_id: `O${n}`,
        answerer_staff_id: MGR,
        method: 'in_person',
        device_id: wait.deviceId,
        requester_staff_id: WAIT,
        outcome: 'answer_failed',
        error_code: 'REQUEST_NOT_PENDING',
      });
    }
    // what a guesser learns: the same status, body and counter delta for both PINs
    expect(results[0]?.status).toBe(409);
    expect(results[1]?.status).toBe(409);
    expect(results[1]?.body).toEqual(results[0]?.body);
    expect(results[0]?.delta).toEqual({ staff: 1, device: 1 });
    expect(results[1]?.delta).toEqual({ staff: 1, device: 1 });
    // a correct PIN on the failed path resets nothing (2 failures stay)
    expect(lockouts(hub, MGR, wait.deviceId)).toEqual({ staff: 2, device: 2 });
    // only the correct PIN's attempt raised pin_use_failed, to the PIN owner, hidden from the sending seat
    const notices = pinUseFailed(hub);
    expect(notices).toHaveLength(1);
    const first = eventsOf(hub, 'RequestPinFailed')[0]?.payload.alert_id as string;
    expect(notices[0]).toMatchObject({
      stream_type: 'order',
      stream_id: 'O1',
      payload: {
        kind: 'pin_use_failed',
        family: 'info',
        target: { kind: 'person', staff_id: MGR },
        dedupe_key: `pin_use_failed:${first}:cmd-54-1`,
        hidden_from: { session_id: wait.sessionId, device_id: wait.deviceId },
        request: null,
        details: null,
      },
    });
    const row = alertRow(hub, notices[0]?.payload.alert_id as string);
    expect(row).toMatchObject({ state: 'open', hidden_session_id: wait.sessionId, hidden_device_id: wait.deviceId });
    expect(JSON.stringify(eventsOf(hub, 'RequestPinFailed'))).not.toContain(PIN.b);
    expect(JSON.stringify(notices)).not.toContain(PIN.b);
  });

  it('[01d #60] (a) accept on an approval kind → 400 before argon2; (g′) pin 1234567 → 400 from payload Zod; nothing counted', async () => {
    const hub = await world(cleanups);
    const wait = seat(hub, WAIT);
    const mgr = seat(hub, MGR);
    const id = raiseAs(hub, wait, voidInput());
    const before = counts(hub);
    const a = await answer(hub, mgr, byPin(id, PIN.b, 'accept'));
    expect(a.statusCode).toBe(400);
    expect(a.json().error.details).toMatchObject({ issues: [{ path: 'decision' }] });
    const g = await answer(hub, mgr, byPin(id, '1234567'));
    expect(g.statusCode).toBe(400);
    expect(g.json().error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(g.json())).not.toContain('1234567');
    expect(verifySpy).not.toHaveBeenCalled();
    expect(lockouts(hub, MGR, mgr.deviceId)).toEqual({ staff: 0, device: 0 });
    expect(counts(hub)).toEqual(before);
  });

  it('[01d #60] (b′) logout during argon2: both in-person PINs get the M39 error, each counted once, one RequestPinFailed SESSION_EXPIRED each, exactly one write transaction; the correct one raises pin_use_failed there', async () => {
    const hub = await world(cleanups);
    let wait = seat(hub, WAIT, 'wait-tab');
    const results: Array<{ status: number; code: string; writes: number; delta: { staff: number; device: number } }> = [];
    for (const [n, pin] of [
      [1, PIN.b],
      [2, WRONG],
    ] as const) {
      const id = raiseAs(hub, wait, voidInput(n));
      const before = lockouts(hub, MGR, wait.deviceId);
      const sessionId = wait.sessionId;
      let writes: ReturnType<typeof vi.spyOn> | undefined;
      duringArgon2(hub, () => {
        endSessionNow(hub, sessionId);
        writes = vi.spyOn(hub.deps.writer, 'run');
      });
      const response = await answer(hub, wait, inPerson(id, MGR, pin));
      const after = lockouts(hub, MGR, wait.deviceId);
      results.push({
        status: response.statusCode,
        code: response.json().error.code as string,
        writes: writes?.mock.calls.length ?? -1,
        delta: { staff: after.staff - before.staff, device: after.device - before.device },
      });
      writes?.mockRestore();
      const failed = eventsOf(hub, 'RequestPinFailed').filter((e) => e.payload.alert_id === id);
      expect(failed).toHaveLength(1);
      expect(failed[0]?.payload).toMatchObject({ outcome: 'answer_failed', error_code: 'SESSION_EXPIRED', method: 'in_person', answerer_staff_id: MGR });
      expect(alertRow(hub, id).state).toBe('open');
      wait = reseat(hub, wait);
    }
    expect(results).toEqual([
      { status: 401, code: 'SESSION_EXPIRED', writes: 1, delta: { staff: 1, device: 1 } },
      { status: 401, code: 'SESSION_EXPIRED', writes: 1, delta: { staff: 1, device: 1 } },
    ]);
    const notices = pinUseFailed(hub);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.payload).toMatchObject({ target: { kind: 'person', staff_id: MGR }, values: { error_code: 'SESSION_EXPIRED' } });
    // in the counting transaction: the notice and the record share one commit
    const failedSeq = (eventsOf(hub, 'RequestPinFailed')[0] as unknown as { seq: number }).seq;
    const noticeSeq = (notices[0] as unknown as { seq: number }).seq;
    expect(Math.abs(noticeSeq - failedSeq)).toBeLessThan(5);
    expect(eventsOf(hub, 'RequestAnswered')).toHaveLength(0);
  });

  it('[01d #60] (c′) an apply that always refuses → its error from preRead, no argon2, nothing counted, no RequestPinFailed', async () => {
    const hub = await world(cleanups);
    const wait = seat(hub, WAIT);
    const mgr = seat(hub, MGR);
    const id = raiseAs(hub, wait, voidInput());
    fakeApply.mode = 'throw';
    for (const [who, payload] of [
      [mgr, byPin(id, PIN.b)],
      [mgr, byPin(id, WRONG)],
      [wait, inPerson(id, MGR, PIN.b)],
      [wait, inPerson(id, MGR, WRONG)],
    ] as const) {
      const response = await answer(hub, who, payload);
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('ITEM_WRONG_STAGE');
    }
    expect(verifySpy).not.toHaveBeenCalled();
    expect(lockouts(hub, MGR, mgr.deviceId)).toEqual({ staff: 0, device: 0 });
    expect(lockouts(hub, MGR, wait.deviceId).device).toBe(0);
    expect(eventsOf(hub, 'RequestPinFailed')).toHaveLength(0);
  });

  it('[01d #60] (c″, d′) withdraw and re-raise during argon2: each guess counted once; the fifth locks the named answerer out (StaffPinLockedOut in that transaction), the next is 429 before argon2; the 10th device failure → 429 DEVICE_LOCKED_OUT', async () => {
    const hub = await world(cleanups);
    const wait = seat(hub, WAIT, 'wait-tab');
    for (let n = 1; n <= 5; n += 1) {
      const id = raiseAs(hub, wait, voidInput(n));
      duringArgon2(hub, () => withdraw(hub, id, n));
      const response = await answer(hub, wait, inPerson(id, MGR, n % 2 === 0 ? PIN.b : WRONG));
      expect(response.statusCode, `attempt ${n}`).toBe(409);
      expect(lockouts(hub, MGR, wait.deviceId)).toEqual({ staff: n, device: n });
      const failed = eventsOf(hub, 'RequestPinFailed').filter((e) => e.payload.alert_id === id);
      expect(failed.map((e) => e.payload.error_code)).toEqual(['REQUEST_NOT_PENDING']);
      const locked = eventsOf(hub, 'StaffPinLockedOut');
      if (n < 5) {
        expect(locked).toHaveLength(0);
      } else {
        // written in the fifth attempt's transaction, with its RequestPinFailed
        expect(locked).toHaveLength(1);
        expect(locked[0]?.payload).toMatchObject({ staff_id: MGR, failed_count: 5 });
        const seq = (e: PosEvent): number => (e as unknown as { seq: number }).seq;
        expect(Math.abs(seq(locked[0] as PosEvent) - seq(failed[0] as PosEvent))).toBeLessThan(5);
      }
    }
    // the in-person correct PINs (attempts 2 and 4) each raised pin_use_failed
    expect(pinUseFailed(hub)).toHaveLength(2);
    hub.deps.testHooks = {};
    const id6 = raiseAs(hub, wait, voidInput(6));
    verifySpy.mockClear();
    const locked = await answer(hub, wait, inPerson(id6, MGR, PIN.b));
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('PIN_LOCKED_OUT');
    expect(verifySpy).not.toHaveBeenCalled();
    // five more failures from the device (another answerer, wrong PIN): the tenth locks the device
    for (let n = 6; n <= 10; n += 1) {
      const response = await answer(hub, wait, inPerson(id6, OWNER, WRONG));
      expect(response.statusCode).toBe(401);
    }
    expect(lockouts(hub, OWNER, wait.deviceId).device).toBe(10);
    expect(eventsOf(hub, 'DevicePinLockedOut')).toHaveLength(1);
    verifySpy.mockClear();
    const device = await answer(hub, wait, inPerson(id6, OWNER, PIN.a));
    expect(device.statusCode).toBe(429);
    expect(device.json().error.code).toBe('DEVICE_LOCKED_OUT');
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('[01d #60] (e′) prepare succeeding: a wrong PIN is counted with RequestPinFailed pin_invalid; a right PIN resets the staff counter', async () => {
    const hub = await world(cleanups);
    const wait = seat(hub, WAIT);
    const mgr = seat(hub, MGR);
    const id = raiseAs(hub, wait, voidInput());
    const wrong = await answer(hub, mgr, byPin(id, WRONG));
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error).toMatchObject({ code: 'PIN_INVALID', details: { attempts_remaining: 4 } });
    expect(eventsOf(hub, 'RequestPinFailed').map((e) => e.payload)).toEqual([
      {
        alert_id: id,
        subject_stream_type: 'order',
        subject_stream_id: 'O1',
        answerer_staff_id: MGR,
        method: 'pin',
        device_id: mgr.deviceId,
        requester_staff_id: WAIT,
        outcome: 'pin_invalid',
        error_code: 'PIN_INVALID',
      },
    ]);
    expect(lockouts(hub, MGR, mgr.deviceId)).toEqual({ staff: 1, device: 1 });
    expect(pinUseFailed(hub)).toHaveLength(0);
    expect((await answer(hub, mgr, byPin(id, PIN.b))).statusCode).toBe(200);
    expect(lockouts(hub, MGR, mgr.deviceId)).toEqual({ staff: 0, device: 1 });
    expect(eventsOf(hub, 'RequestPinFailed')).toHaveLength(1);
  });

  it('[01d #60] (f′) a retry of an answered command_id racing the first (IdempotentReplay in prepare) → the stored 200, nothing counted', async () => {
    const hub = await world(cleanups);
    const wait = seat(hub, WAIT);
    const mgr = seat(hub, MGR);
    const id = raiseAs(hub, wait, voidInput());
    let inner: Awaited<ReturnType<typeof answer>> | undefined;
    const hook = duringArgon2(hub, async () => {
      inner = await answer(hub, mgr, byPin(id, PIN.b), 'cmd-f');
    });
    const outer = await answer(hub, mgr, byPin(id, PIN.b), 'cmd-f');
    expect(hook.entered()).toBe(2);
    expect(inner?.statusCode).toBe(200);
    expect(outer.statusCode).toBe(200);
    expect(outer.headers['idempotent-replay']).toBe('true');
    expect(outer.json()).toEqual(inner?.json());
    expect(lockouts(hub, MGR, mgr.deviceId)).toEqual({ staff: 0, device: 0 });
    expect(eventsOf(hub, 'RequestPinFailed')).toHaveLength(0);
    expect(eventsOf(hub, 'RequestAnswered')).toHaveLength(1);
    expect(pinUseFailed(hub)).toHaveLength(0);
  });

  it('[01d BF-1] two managers approve one t_approval at once with pin: the loser gets 409, one counted failure, RequestPinFailed REQUEST_NOT_PENDING, no pin_use_failed; in person, the same race raises pin_use_failed', async () => {
    const hub = await world(cleanups);
    const wait = seat(hub, WAIT, 'wait-tab');
    const mgr = seat(hub, MGR, 'mgr-tab');
    const owner = seat(hub, OWNER, 'owner-tab');
    // method pin, both correct PINs
    const id = raiseAs(hub, wait, voidInput(1));
    let inner: Awaited<ReturnType<typeof answer>> | undefined;
    const hook = duringArgon2(hub, async () => {
      inner = await answer(hub, owner, byPin(id, PIN.a), 'cmd-bf1-owner');
    });
    const loser = await answer(hub, mgr, byPin(id, PIN.b), 'cmd-bf1-mgr');
    expect(hook.entered()).toBe(2); // both verified their PIN before either wrote
    expect(inner?.statusCode).toBe(200);
    expect(loser.statusCode).toBe(409);
    expect(loser.json().error).toMatchObject({ code: 'REQUEST_NOT_PENDING', details: { answered_by_staff_id: OWNER, answered_by_name: 'Owner' } });
    expect(lockouts(hub, MGR, mgr.deviceId)).toEqual({ staff: 1, device: 1 });
    expect(lockouts(hub, OWNER, owner.deviceId)).toEqual({ staff: 0, device: 0 });
    const failed = eventsOf(hub, 'RequestPinFailed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.payload).toMatchObject({ alert_id: id, answerer_staff_id: MGR, method: 'pin', device_id: mgr.deviceId, outcome: 'answer_failed', error_code: 'REQUEST_NOT_PENDING' });
    expect(pinUseFailed(hub)).toHaveLength(0);
    expect(eventsOf(hub, 'RequestAnswered')).toHaveLength(1);

    // in person on the raising device, the same race: a correct PIN raises pin_use_failed to its owner
    const id2 = raiseAs(hub, wait, voidInput(2));
    duringArgon2(hub, async () => {
      expect((await answer(hub, owner, byPin(id2, PIN.a))).statusCode).toBe(200);
    });
    const inPersonLoser = await answer(hub, wait, inPerson(id2, MGR, PIN.b), 'cmd-bf1-ip');
    expect(inPersonLoser.statusCode).toBe(409);
    expect(eventsOf(hub, 'RequestPinFailed').filter((e) => e.payload.alert_id === id2).map((e) => e.payload.error_code)).toEqual(['REQUEST_NOT_PENDING']);
    const notices = pinUseFailed(hub);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.payload).toMatchObject({
      target: { kind: 'person', staff_id: MGR },
      dedupe_key: `pin_use_failed:${id2}:cmd-bf1-ip`,
      hidden_from: { session_id: wait.sessionId, device_id: wait.deviceId },
      values: { request_alert_id: id2, request_kind: 't_approval', error_code: 'REQUEST_NOT_PENDING', device_id: wait.deviceId },
    });
  });

  it('[01d BF-1] method pin with an error other than REQUEST_NOT_PENDING still raises pin_use_failed on a match', async () => {
    const hub = await world(cleanups);
    const wait = seat(hub, WAIT);
    const mgr = seat(hub, MGR);
    const id = raiseAs(hub, wait, voidInput());
    duringArgon2(hub, () => {
      fakeApply.mode = 'throw';
    });
    const response = await answer(hub, mgr, byPin(id, PIN.b), 'cmd-bf1-apply');
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('ITEM_WRONG_STAGE');
    expect(eventsOf(hub, 'RequestPinFailed').map((e) => e.payload.error_code)).toEqual(['ITEM_WRONG_STAGE']);
    const notices = pinUseFailed(hub);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.payload).toMatchObject({ hidden_from: { session_id: mgr.sessionId, device_id: mgr.deviceId }, dedupe_key: `pin_use_failed:${id}:cmd-bf1-apply` });
    expect(lockouts(hub, MGR, mgr.deviceId)).toEqual({ staff: 1, device: 1 });
  });

  it('[01d BF-2] onPrepareFailed made to throw → the client still gets the prepare error for both PINs, never a 500', async () => {
    const hub = await world(cleanups);
    const wait = seat(hub, WAIT, 'wait-tab');
    const owner = seat(hub, OWNER, 'owner-tab');
    const def = answerDef(hub);
    const original = def.pinHooks.onPrepareFailed;
    def.pinHooks.onPrepareFailed = () => {
      throw new Error('forced onPrepareFailed failure');
    };
    try {
      const bodies: unknown[] = [];
      for (const [n, pin] of [
        [1, PIN.b],
        [2, WRONG],
      ] as const) {
        const id = raiseAs(hub, wait, voidInput(n));
        duringArgon2(hub, async () => {
          expect((await answer(hub, owner, byPin(id, PIN.a))).statusCode).toBe(200);
        });
        const response = await answer(hub, wait, inPerson(id, MGR, pin));
        expect(response.statusCode).toBe(409);
        expect(response.json().error.code).toBe('REQUEST_NOT_PENDING');
        bodies.push(bodyOf(response, id));
      }
      expect(bodies[1]).toEqual(bodies[0]);
      expect(hub.logs()).toContain('checkPin counting transaction failed');
      expect(eventsOf(hub, 'RequestPinFailed')).toHaveLength(0);
      expect(pinUseFailed(hub)).toHaveLength(0);
    } finally {
      def.pinHooks.onPrepareFailed = original;
    }
  });

  it('[01d RF-2] payload iff cases → 400 from payload Zod: argon2 never called, nothing counted, the PIN never echoed', async () => {
    const hub = await world(cleanups);
    const wait = seat(hub, WAIT);
    const mgr = seat(hub, MGR);
    const id = raiseAs(hub, wait, voidInput());
    const pin = '86429';
    const before = counts(hub);
    const cases: Array<[string, Seat, Record<string, unknown>]> = [
      ['answerer_staff_id with pin', mgr, { alert_id: id, decision: 'approve', method: 'pin', pin, answerer_staff_id: MGR }],
      ['answerer_staff_id with session', mgr, { alert_id: id, decision: 'approve', method: 'session', answerer_staff_id: MGR }],
      ['pin with session', mgr, { alert_id: id, decision: 'approve', method: 'session', pin }],
      ['in_person without answerer_staff_id', wait, { alert_id: id, decision: 'approve', method: 'in_person', pin }],
    ];
    for (const [name, who, payload] of cases) {
      const response = await answer(hub, who, payload);
      expect(response.statusCode, name).toBe(400);
      expect(response.json().error.code, name).toBe('VALIDATION_FAILED');
      expect(response.body, name).not.toContain(pin);
    }
    expect(verifySpy).not.toHaveBeenCalled();
    expect(lockouts(hub, MGR, mgr.deviceId)).toEqual({ staff: 0, device: 0 });
    expect(lockouts(hub, MGR, wait.deviceId)).toEqual({ staff: 0, device: 0 });
    expect(counts(hub)).toEqual(before);
    expect(hub.logs()).not.toMatch(/(?<![\d.])86429(?!\d)/);
  });

  it('[01d #56 hub] PIN 4711 is never stored: payload_hash without pin, no processed_commands column, event payload or log line has it; a replay with another PIN replays the stored 200', async () => {
    const hub = await world(cleanups, { mgrPin: '4711' });
    const wait = seat(hub, WAIT, 'wait-tab');
    const mgr = seat(hub, MGR, 'mgr-tab');
    const pinAnswer = raiseAs(hub, wait, voidInput(1));
    const payload = byPin(pinAnswer, '4711');
    const first = await answer(hub, mgr, payload, 'cmd-56');
    expect(first.statusCode).toBe(200);
    // a wrong in-person attempt and an in-person answer, also never stored
    const ip = raiseAs(hub, wait, voidInput(2));
    expect((await answer(hub, wait, inPerson(ip, MGR, '4712'))).statusCode).toBe(401);
    expect((await answer(hub, wait, inPerson(ip, MGR, '4711'))).statusCode).toBe(200);
    const row = hub.deps.db.prepare("SELECT * FROM processed_commands WHERE command_id = 'cmd-56'").get() as Record<string, unknown>;
    const withoutPin: Record<string, unknown> = { ...payload };
    delete withoutPin.pin;
    expect(row.payload_hash).toBe(payloadHash(withoutPin));
    expect(row.payload_hash).toBe(payloadHash(payload, 'pin'));
    expect(row.payload_hash).not.toBe(payloadHash(payload));
    for (const r of hub.deps.db.prepare('SELECT * FROM processed_commands').all() as Array<Record<string, unknown>>) {
      for (const value of Object.values(r)) expect(String(value)).not.toContain('4711');
    }
    for (const p of hub.deps.db.prepare('SELECT payload FROM events').pluck().all() as string[]) {
      expect(p).not.toContain('4711');
      expect(p).not.toContain('4712');
    }
    expect(hub.logs()).not.toMatch(/(?<![\d.])471[12](?!\d)/);
    // the replay does not depend on the PIN (H-9)
    verifySpy.mockClear();
    const replay = await answer(hub, mgr, byPin(pinAnswer, '0000'), 'cmd-56');
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(first.json());
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('[01d #66] read-only apply on the PIN path: append / onCommit / UPDATE / missing or other alert_id fail in preRead with no PIN verified and nothing written; in prepare nothing is answered; startup checks', async () => {
    const hub = await world(cleanups);
    const wait = seat(hub, WAIT);
    const mgr = seat(hub, MGR);
    const id = raiseAs(hub, wait, voidInput());
    const before = counts(hub);
    for (const mode of ['append', 'onCommit', 'write', 'no_alert_id', 'other_alert_id'] as const) {
      fakeApply.mode = mode;
      for (const [who, payload] of [
        [mgr, byPin(id, PIN.b)],
        [wait, inPerson(id, MGR, PIN.b)],
      ] as const) {
        const response = await answer(hub, who, payload);
        expect(response.statusCode, mode).toBe(500);
        expect(response.json().error.code, mode).toBe('INTERNAL_ERROR');
      }
    }
    expect(verifySpy).not.toHaveBeenCalled();
    expect(counts(hub)).toEqual(before);
    expect(lockouts(hub, MGR, mgr.deviceId)).toEqual({ staff: 0, device: 0 });
    // in prepare (state changed while argon2 ran): never answered; the failure is counted (rule 4 (d))
    fakeApply.mode = 'ok';
    duringArgon2(hub, () => {
      fakeApply.mode = 'write';
    });
    const late = await answer(hub, mgr, byPin(id, PIN.b));
    expect(late.statusCode).toBe(500);
    expect(eventsOf(hub, 'RequestAnswered')).toHaveLength(0);
    expect(eventsOf(hub, FAKE_EFFECT_EVENT)).toHaveLength(0);
    expect(eventsOf(hub, 'RequestPinFailed').map((e) => e.payload.error_code)).toEqual(['INTERNAL_ERROR']);
    expect(alertRow(hub, id).state).toBe('open');
    // startup checks (m4)
    const base = {
      steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target' as const, set: 'recipient' as const }] }],
      closes_on: 'owner' as const,
      values_schema: z.object({}),
      details_schema: null,
      lead_fallback: false,
      expires_at_day_close: true,
      labels: { card: 'c', lock: 'l' },
    };
    expect(() =>
      defineAlertKind({
        ...base,
        kind: 'k66_silent_urgent',
        family: 'urgent',
        subject: 'order',
        silent: true,
        request: { answers: ['accept', 'decline'], right: { mode: 'named' }, needs_pin: 'never', apply: () => [] },
      }),
    ).toThrow(/silent/);
    expect(() =>
      defineAlertKind({
        ...base,
        kind: 'k66_no_escalation',
        family: 'action',
        subject: 'order',
        silent: false,
        steps: APPROVAL_TIER_STEPS.filter((s) => s.escalation !== true),
        request: { answers: ['approve', 'reject'], right: { mode: 'approval', base_permission: 'void-item' }, needs_pin: 'always', apply: () => [] },
      }),
    ).toThrow(/escalation/);
  });
});
