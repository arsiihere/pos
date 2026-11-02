import { verify } from '@node-rs/argon2';
import type { DirectoryInput, EventDraft, PosEvent } from '@pos/events';
import { aBusinessDayClosed } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kindOf } from '../../src/alerts/kinds';
import { alerts, requestResultInput, type RaiseInput, type RaiseResult } from '../../src/alerts/raise';
import { activity } from '../../src/auth/session-store';
import { currentDirectory } from '../../src/auth/guards';
import type { CommandCtx } from '../../src/commands/registry';
import { aDirectory, PIN } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, endSessionNow, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { registerFakes, resetFakes } from './fakes';

// 01d task 24: the personal notices an answer raises — §3.3 rule 7 and "Cheating with a known PIN is
// detected", §3.10 `approval_receipt` (silent, the request's details), `answered_on_requester_device`
// (audible), "Personal notices", "Hidden from the answering seat", §6.2 Processing (8a), (9); test #12.
// Hiding in frames is ws-frames.ts's (task 20, by the alert row's hidden_* columns): asserted here on the
// DB (AlertRaised.hidden_from and the row), not by WS polling.

vi.mock('@node-rs/argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@node-rs/argon2')>();
  return { ...actual, verify: vi.fn((hash: string, pin: string) => actual.verify(hash, pin)) };
});
const verifySpy = vi.mocked(verify);

const OWNER = 'S_OWNER'; // Imran's lead in these tests (for the "for X" contrast), an approver
const MGR = 'S_MGR'; // "Imran": approver (R_MGR), approve-void branch scope, PIN.b
const CASH = 'S_CASH'; // the accept kinds' receiver, PIN.c
const WAIT = 'S_WAIT'; // "Hamza": requester; void-item requires approval by R_MGR or R_OWNER
const TENANT = 'tenant-a';
const BRANCH = 'branch-1';
const WRONG = '5555';
const DETAILS = { item: 'Mutton platter', quantity: 1, amount: 480_000, reason: 'customer changed mind' };

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory({ directory_version: 1 });
  const roles = base.roles.map((role) =>
    role.role_id === 'R_WAIT'
      ? {
          ...role,
          permissions: [
            {
              permission: 'void-item' as const,
              grant_type: 'requires_approval' as const,
              approver_role_id: 'R_MGR',
              approver_role_ids: ['R_MGR', 'R_OWNER'],
              scope: 'branch' as const,
            },
          ],
        }
      : role,
  );
  const staff = base.staff.map((s) => (s.staff_id === MGR ? { ...s, lead_staff_id: OWNER } : s));
  return { ...base, roles, staff };
}

interface Seat {
  staffId: string;
  deviceId: string;
  deviceToken: string;
  sessionId: string;
  sessionToken: string;
}

async function world(cleanups: Array<() => Promise<void>>): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  await seedDirectory(hub, await directory());
  return hub;
}

function seat(hub: TestHub, staffId: string, name: string = staffId): Seat {
  const device = pairDevice(hub, { type: 'tablet', name });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { staffId, deviceId: device.deviceId, deviceToken: device.token, sessionId: session.sessionId, sessionToken: session.token };
}

/**
 * `staffId` signs in on another seat's device (the cheat: signed in as the manager on Hamza's tablet);
 * one open session per device, so the seat's session ends first.
 */
function signInOn(hub: TestHub, on: Seat, staffId: string): Seat {
  endSessionNow(hub, on.sessionId);
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: on.deviceId });
  return { ...on, staffId, sessionId: session.sessionId, sessionToken: session.token };
}

function ctxOf(hub: TestHub, tx: Parameters<Parameters<TestHub['deps']['writer']['run']>[0]>[0], s: Seat): CommandCtx {
  return {
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
}

/** A request raised by a command handler on the requester's seat (raised_device_id = that device). */
function raiseAs(hub: TestHub, s: Seat, input: RaiseInput): string {
  return hub.deps.writer.run((tx) => {
    const result = alerts.raise(ctxOf(hub, tx, s), input);
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
  details: DETAILS,
  dedupe_key: `void:O${n}:L1`,
  requester_staff_id: WAIT,
  request: { approver_role_ids: ['R_MGR', 'R_OWNER'] },
});

let commandNo = 0;
function answer(hub: TestHub, s: Seat, payload: Record<string, unknown>) {
  return hub.app.inject({
    method: 'POST',
    url: '/commands/answer-request',
    headers: { authorization: `Bearer ${s.deviceToken}`, 'x-session-token': s.sessionToken },
    payload: {
      command_id: `pn-${(commandNo += 1)}`,
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

const inPerson = (alertId: string, answerer: string, pin: string) => ({ alert_id: alertId, decision: 'approve', method: 'in_person', answerer_staff_id: answerer, pin });
const byPin = (alertId: string, pin: string) => ({ alert_id: alertId, decision: 'approve', method: 'pin', pin });

function eventsOf(hub: TestHub, type: string): PosEvent[] {
  return (hub.deps.db.prepare('SELECT * FROM events WHERE event_type = ? ORDER BY seq').all(type) as Array<Record<string, unknown>>).map(
    (row) => ({ ...row, payload: JSON.parse(row.payload as string) }) as unknown as PosEvent,
  );
}

const raisedOf = (hub: TestHub, kind: string): PosEvent[] => eventsOf(hub, 'AlertRaised').filter((e) => e.payload.kind === kind);

function alertRow(hub: TestHub, id: string): Record<string, unknown> {
  return hub.deps.db.prepare('SELECT * FROM alerts WHERE alert_id = ?').get(id) as Record<string, unknown>;
}

function recipientsOf(hub: TestHub, id: string): Array<Record<string, unknown>> {
  return hub.deps.db
    .prepare('SELECT staff_id, device_id, for_staff_id, recipient_set, step FROM alert_recipients WHERE alert_id = ? ORDER BY rowid')
    .all(id) as Array<Record<string, unknown>>;
}

function lockouts(hub: TestHub, staffId: string, deviceId: string): { staff: number; device: number } {
  const read = (type: string, id: string): number =>
    (hub.deps.db.prepare('SELECT failed_count FROM auth_lockouts WHERE subject_type = ? AND subject_id = ?').pluck().get(type, id) as
      | number
      | undefined) ?? 0;
  return { staff: read('staff', staffId), device: read('device', deviceId) };
}

function eventIdsOf(response: { json(): unknown }): Set<string> {
  return new Set((response.json() as { data: { event_ids: string[] } }).data.event_ids);
}

const SECRET_TEXT = ['Mutton platter', 'customer changed mind', '480000'];

describe('01d personal notices: approval_receipt, answered_on_requester_device, hidden from the answering seat (task 24)', () => {
  const cleanups: Array<() => Promise<void>> = [];
  const clients: WsClient[] = [];
  beforeEach(() => registerFakes());
  afterEach(async () => {
    for (const client of clients.splice(0)) client.close();
    for (const cleanup of cleanups.splice(0)) await cleanup();
    resetFakes();
    activity.drain();
    activity.drainDevices();
    verifySpy.mockClear();
    vi.restoreAllMocks();
  });

  it('[01d #12] in person on the raising device: wrong PIN → 401 counted on the answerer and this device with RequestPinFailed; lockout → 429; right PIN → RequestAnswered in_person on_requester_device, answered_on_requester_device and approval_receipt to the answerer in the same transaction', async () => {
    const hub = await world(cleanups);
    const hamza = seat(hub, WAIT, 'Hamza tablet');
    const imran = seat(hub, MGR, 'Imran tablet'); // Imran's own tablet: never the lockout subject here
    const id = raiseAs(hub, hamza, voidInput());

    const wrong = await answer(hub, hamza, inPerson(id, MGR, WRONG));
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toMatchObject({ error: { code: 'PIN_INVALID' } });
    expect(lockouts(hub, MGR, hamza.deviceId)).toEqual({ staff: 1, device: 1 });
    expect(lockouts(hub, MGR, imran.deviceId).device).toBe(0);
    const failed = eventsOf(hub, 'RequestPinFailed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ stream_type: 'audit', stream_id: id });
    expect(failed[0]?.payload).toMatchObject({ alert_id: id, answerer_staff_id: MGR, method: 'in_person', device_id: hamza.deviceId, outcome: 'pin_invalid', error_code: 'PIN_INVALID' });
    expect(JSON.stringify(failed[0]?.payload)).not.toContain(WRONG);

    for (let i = 0; i < 4; i += 1) expect((await answer(hub, hamza, inPerson(id, MGR, WRONG))).statusCode).toBe(401);
    const locked = await answer(hub, hamza, inPerson(id, MGR, PIN.b));
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ error: { code: 'PIN_LOCKED_OUT' } });
    expect(raisedOf(hub, 'approval_receipt')).toHaveLength(0);
    expect(raisedOf(hub, 'answered_on_requester_device')).toHaveLength(0);

    // the lockout ends; Hamza signs in again on his tablet (his idle TTL is shorter than the lockout)
    hub.clock.advance(hub.deps.config.auth.pin_lockout_ms + 1);
    const again = signInOn(hub, hamza, WAIT);
    const ok = await answer(hub, again, inPerson(id, MGR, PIN.b));
    expect(ok.statusCode).toBe(200);
    const answered = eventsOf(hub, 'RequestAnswered');
    expect(answered).toHaveLength(1);
    expect(answered[0]?.payload).toEqual({
      alert_id: id,
      decision: 'approve',
      answerer_staff_id: MGR,
      method: 'in_person',
      device_id: hamza.deviceId,
      on_requester_device: true,
    });
    const notice = raisedOf(hub, 'answered_on_requester_device');
    const receipt = raisedOf(hub, 'approval_receipt');
    expect(notice).toHaveLength(1);
    expect(receipt).toHaveLength(1);
    for (const e of [notice[0], receipt[0]]) {
      expect(e?.payload).toMatchObject({ target: { kind: 'person', staff_id: MGR }, hidden_from: { session_id: again.sessionId, device_id: hamza.deviceId } });
    }
    // same transaction: every one of them is in this command's event ids
    const ids = eventIdsOf(ok);
    for (const e of [answered[0], notice[0], receipt[0]]) expect(ids.has(e?.event_id as string)).toBe(true);
  });

  it('[01d §3.10] a money answer by session is impossible (422); by pin from Imran’s own tablet → approval_receipt only, on_requester_device false, hidden from that session and device; details copied, never logged', async () => {
    const hub = await world(cleanups);
    const hamza = seat(hub, WAIT, 'Hamza tablet');
    const imran = seat(hub, MGR, 'Imran tablet');
    const id = raiseAs(hub, hamza, voidInput());

    const bySession = await answer(hub, imran, { alert_id: id, decision: 'approve', method: 'session' });
    expect(bySession.statusCode).toBe(422);
    expect(bySession.json()).toMatchObject({ error: { code: 'REQUEST_PIN_REQUIRED' } });
    expect(verifySpy).not.toHaveBeenCalled();

    const ok = await answer(hub, imran, byPin(id, PIN.b));
    expect(ok.statusCode).toBe(200);
    expect(eventsOf(hub, 'RequestAnswered')[0]?.payload).toMatchObject({ method: 'pin', device_id: imran.deviceId, on_requester_device: false });
    expect(raisedOf(hub, 'answered_on_requester_device')).toHaveLength(0);
    const receipts = raisedOf(hub, 'approval_receipt');
    expect(receipts).toHaveLength(1);
    const receipt = receipts[0] as PosEvent;
    expect(eventIdsOf(ok).has(receipt.event_id)).toBe(true);
    expect(receipt).toMatchObject({ stream_type: 'order', stream_id: 'O1', actor_id: MGR, device_id: imran.deviceId });
    expect(receipt.payload).toEqual({
      alert_id: receipt.payload.alert_id,
      kind: 'approval_receipt',
      family: 'info',
      subject_stream_type: 'order',
      subject_stream_id: 'O1',
      dedupe_key: `approval_receipt:${id}`,
      requester_staff_id: null,
      target: { kind: 'person', staff_id: MGR },
      values: { request_alert_id: id, request_kind: 't_approval', decision: 'approve', device_id: imran.deviceId, on_requester_device: false },
      display: { ...display, device_name: 'Imran tablet' }, // the request's lock-safe display + the answering device (§3.12, task 34 fix)
      details: DETAILS, // signed-in card only (§3.12)
      hidden_from: { session_id: imran.sessionId, device_id: imran.deviceId },
      request: null,
    });
    const notice = receipt.payload.alert_id as string;
    expect(alertRow(hub, notice)).toMatchObject({ state: 'open', hidden_session_id: imran.sessionId, hidden_device_id: imran.deviceId });
    // personal: one person row, never a "for" row
    expect(recipientsOf(hub, notice)).toEqual([{ staff_id: MGR, device_id: null, for_staff_id: null, recipient_set: 'recipient', step: 0 }]);
    const kind = kindOf('approval_receipt');
    expect(kind).toMatchObject({ family: 'info', silent: true, lead_fallback: false, expires_at_day_close: false, closes_on: 'seen', request: null });
    const logs = hub.logs();
    for (const text of SECRET_TEXT) expect(logs).not.toContain(text);
  });

  it('[01d §3.10] an answer on the raising device (any method) → on_requester_device true, answered_on_requester_device and approval_receipt, both hidden from that seat', async () => {
    const hub = await world(cleanups);
    const hamza = seat(hub, WAIT, 'Hamza tablet');
    const id = raiseAs(hub, hamza, voidInput());
    // the cheat: signed in as Imran on Hamza's tablet, answering with method pin
    const there = signInOn(hub, hamza, MGR);
    const ok = await answer(hub, there, byPin(id, PIN.b));
    expect(ok.statusCode).toBe(200);
    expect(eventsOf(hub, 'RequestAnswered')[0]?.payload).toMatchObject({ method: 'pin', device_id: hamza.deviceId, on_requester_device: true });
    const notice = raisedOf(hub, 'answered_on_requester_device')[0] as PosEvent;
    const receipt = raisedOf(hub, 'approval_receipt')[0] as PosEvent;
    const hidden = { session_id: there.sessionId, device_id: hamza.deviceId };
    expect(notice.payload).toEqual({
      alert_id: notice.payload.alert_id,
      kind: 'answered_on_requester_device',
      family: 'info',
      subject_stream_type: 'order',
      subject_stream_id: 'O1',
      dedupe_key: `on_requester_device:${id}`,
      requester_staff_id: null,
      target: { kind: 'person', staff_id: MGR },
      values: { request_alert_id: id, request_kind: 't_approval', decision: 'approve', device_id: hamza.deviceId },
      display: { ...display, device_name: 'Hamza tablet' }, // the answering device (§3.12, task 34 fix)
      details: null,
      hidden_from: hidden,
      request: null,
    });
    expect(receipt.payload).toMatchObject({ values: { on_requester_device: true, device_id: hamza.deviceId }, details: DETAILS, hidden_from: hidden });
    for (const e of [notice, receipt]) {
      expect(alertRow(hub, e.payload.alert_id as string)).toMatchObject({ state: 'open', hidden_session_id: there.sessionId, hidden_device_id: hamza.deviceId });
    }
    expect(kindOf('answered_on_requester_device')).toMatchObject({ family: 'info', silent: false, lead_fallback: false, expires_at_day_close: false, closes_on: 'seen', details_schema: null });
    // order of the drafts: RequestAnswered, the effect, request_result, approval_receipt, the notice
    const kinds = eventsOf(hub, 'AlertRaised').map((e) => e.payload.kind);
    expect(kinds.slice(-3)).toEqual(['request_result', 'approval_receipt', 'answered_on_requester_device']);
  });

  it('[01d §3.10] an accept kind answered on the raising device → the notice and no receipt; answered elsewhere → neither', async () => {
    const hub = await world(cleanups);
    const hamza = seat(hub, WAIT, 'Hamza tablet');
    const cash = seat(hub, CASH, 'Cash tablet');
    const here = raiseAs(hub, hamza, acceptInput(1));
    const elsewhere = raiseAs(hub, hamza, acceptInput(2));
    const there = signInOn(hub, hamza, CASH);
    expect((await answer(hub, there, { alert_id: here, decision: 'accept', method: 'session' })).statusCode).toBe(200);
    expect((await answer(hub, cash, { alert_id: elsewhere, decision: 'accept', method: 'session' })).statusCode).toBe(200);
    expect(raisedOf(hub, 'approval_receipt')).toHaveLength(0);
    const notices = raisedOf(hub, 'answered_on_requester_device');
    expect(notices).toHaveLength(1);
    expect(notices[0]?.payload).toMatchObject({
      target: { kind: 'person', staff_id: CASH },
      values: { request_alert_id: here, request_kind: 't_accept', decision: 'accept', device_id: hamza.deviceId },
      hidden_from: { session_id: there.sessionId, device_id: hamza.deviceId },
    });
    expect(eventsOf(hub, 'RequestAnswered').map((e) => e.payload.on_requester_device)).toEqual([true, false]);
  });

  it('[01d §3.10] the three raises of one AnswerRequest are one raiseMany on the cached fixed reads: statements = one raise ≤ (6 + R + T) + 2 × (R + T)', async () => {
    const hub = await world(cleanups);
    const hamza = seat(hub, WAIT, 'Hamza tablet');
    const id = raiseAs(hub, hamza, voidInput());
    const there = signInOn(hub, hamza, MGR);
    const counter = statementCounter(hub.deps.db);
    const original = alerts.raiseMany;
    const calls: Array<{ kinds: string[]; statements: number }> = [];
    vi.spyOn(alerts, 'raiseMany').mockImplementation((ctx, inputs) => {
      counter.reset();
      const out: RaiseResult[] = original(ctx, inputs);
      calls.push({ kinds: inputs.map((i) => i.kind), statements: counter.count });
      return out;
    });
    const raiseSpy = vi.spyOn(alerts, 'raise');
    expect((await answer(hub, there, byPin(id, PIN.b))).statusCode).toBe(200);
    expect(raiseSpy).not.toHaveBeenCalled();
    expect(calls).toEqual([{ kinds: ['request_result', 'approval_receipt', 'answered_on_requester_device'], statements: expect.any(Number) as number }]);
    vi.restoreAllMocks();

    // one raise of the same shape in a fresh transaction: dedupe 1 + the 5 fixed reads + R (fakePager) + T (0: person targets)
    const single = hub.deps.writer.run((tx) => {
      counter.reset();
      alerts.raise(
        ctxOf(hub, tx, there),
        requestResultInput(
          { alert_id: 'other', kind: 't_approval', subject: { stream_type: 'order', stream_id: 'O9' }, requester_staff_id: WAIT, display },
          { close_reason: 'answered', decision: 'approve', by_staff_id: MGR },
        ),
      );
      return counter.count;
    }).result;
    const R = 1;
    const T = 0;
    expect(single).toBe(6 + R + T);
    expect(calls[0]?.statements).toBe(single);
    expect(calls[0]?.statements).toBeLessThanOrEqual(6 + R + T + 2 * (R + T));
  });

  it('[01d §3.10] Imran with no route: no "for Imran" row on his lead’s device for either notice (an ordinary lead_fallback alert would get one)', async () => {
    const hub = await world(cleanups);
    const hamza = seat(hub, WAIT, 'Hamza tablet');
    const owner = seat(hub, OWNER, 'Owner tablet');
    // the owner (Imran's lead) has a connected staff session: a route
    const ws = await connectWs(hub.app);
    clients.push(ws);
    ws.send({ type: 'auth', device_token: owner.deviceToken, session_token: owner.sessionToken });
    await ws.untilCount(1);
    const id = raiseAs(hub, hamza, voidInput());
    // Imran is signed in nowhere; Hamza hands the tablet over and Imran answers in person
    expect((await answer(hub, hamza, inPerson(id, MGR, PIN.b))).statusCode).toBe(200);
    for (const kind of ['approval_receipt', 'answered_on_requester_device']) {
      const raised = raisedOf(hub, kind);
      expect(raised).toHaveLength(1);
      const noticeId = raised[0]?.payload.alert_id as string;
      expect(recipientsOf(hub, noticeId)).toEqual([{ staff_id: MGR, device_id: null, for_staff_id: null, recipient_set: 'recipient', step: 0 }]);
      const step = eventsOf(hub, 'AttemptSent').find((e) => e.payload.alert_id === noticeId);
      expect(step?.payload.routes).toEqual([]);
      const inbox = hub.deps.db.prepare('SELECT staff_id FROM alert_inbox WHERE alert_id = ?').pluck().all(noticeId);
      expect(inbox).toEqual([MGR]);
    }
    // the contrast: a lead_fallback info alert to Imran gets the "for Imran" row on the owner
    const info = raiseAs(hub, hamza, { kind: 't_info', subject: { stream_type: 'hub', stream_id: BRANCH }, target: { kind: 'person', staff_id: MGR }, display, dedupe_key: 'contrast' });
    expect(recipientsOf(hub, info)).toContainEqual(expect.objectContaining({ staff_id: OWNER, for_staff_id: MGR }));
  });

  it('[01d §3.10] both notices stay open after BusinessDayClosed; the device hiding ends, the session hiding stays', async () => {
    const hub = await world(cleanups);
    const hamza = seat(hub, WAIT, 'Hamza tablet');
    const id = raiseAs(hub, hamza, voidInput());
    const there = signInOn(hub, hamza, MGR);
    expect((await answer(hub, there, byPin(id, PIN.b))).statusCode).toBe(200);
    const notices = ['approval_receipt', 'answered_on_requester_device'].map((k) => raisedOf(hub, k)[0]?.payload.alert_id as string);
    const result = raisedOf(hub, 'request_result')[0]?.payload.alert_id as string;
    hub.deps.writer.run((tx) => {
      const e = aBusinessDayClosed();
      const draft: EventDraft = {
        stream_type: e.stream_type,
        stream_id: e.stream_id,
        event_type: e.event_type,
        schema_version: e.schema_version,
        payload: e.payload,
        occurred_at: hub.clock.branchNow(),
        actor_id: e.actor_id,
        device_id: e.device_id,
      };
      tx.append([draft]);
    });
    for (const n of notices) {
      expect(alertRow(hub, n)).toMatchObject({ state: 'open', expire_due: 0, hidden_session_id: there.sessionId, hidden_device_id: null });
    }
    // the contrast: request_result is not personal, so day close expires it
    expect(alertRow(hub, result)).toMatchObject({ state: 'open', expire_due: 1 });
  });
});
