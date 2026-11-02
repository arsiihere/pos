import type { DirectoryInput, EventDraft, PosEvent } from '@pos/events';
import { anAttemptSent } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { alerts, type RaiseInput, type RaiseResult } from '../../src/alerts/raise';
import { activity } from '../../src/auth/session-store';
import { currentDirectory } from '../../src/auth/guards';
import type { CommandCtx, CommandDef } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { FAKE_EFFECT_EVENT, fakeApply, registerFakes, resetFakes } from './fakes';

// 01d task 25: WithdrawRequest (§6.3, §3.3 "Withdraw", §3.5 read-only contract for `onWithdraw`); test #13.
// alert_closed frames are ws-frames.ts's (task 20): asserted here on the hub's sockets, not re-implemented.

const OWNER = 'S_OWNER'; // the requester's lead
const CASH = 'S_CASH'; // the accept kinds' receiver
const WAIT = 'S_WAIT'; // the requester
const TENANT = 'tenant-a';
const BRANCH = 'branch-1';

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory({ directory_version: 1 });
  const staff = base.staff.map((s) => (s.staff_id === WAIT ? { ...s, lead_staff_id: OWNER } : s));
  return { ...base, staff };
}

interface Seat {
  staffId: string;
  deviceId: string;
  deviceToken: string;
  sessionId: string;
  sessionToken: string;
}

async function world(cleanups: Array<() => Promise<void>>, clients: WsClient[] = []): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(async () => {
    for (const client of clients.splice(0)) client.close();
    await hub.close();
  });
  await seedDirectory(hub, await directory());
  return hub;
}

function seat(hub: TestHub, staffId: string, name: string = staffId): Seat {
  const device = pairDevice(hub, { type: 'tablet', name });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { staffId, deviceId: device.deviceId, deviceToken: device.token, sessionId: session.sessionId, sessionToken: session.token };
}

async function socketOf(hub: TestHub, s: Seat, clients: WsClient[]): Promise<WsClient> {
  const ws = await connectWs(hub.app);
  ws.send({ type: 'auth', device_token: s.deviceToken, session_token: s.sessionToken });
  await ws.untilCount(1);
  expect(ws.messages[0]).toMatchObject({ type: 'catch_up' });
  clients.push(ws);
  return ws;
}

async function until(client: WsClient, pred: (m: Record<string, unknown>) => boolean): Promise<void> {
  for (let i = 0; i < 50 && !(client.messages as Array<Record<string, unknown>>).some(pred); i += 1) {
    await client.untilCount(client.messages.length + 1);
  }
}

/** A request raised by a command handler on the seat (raised_device_id = that device). */
function raiseAs(hub: TestHub, s: Seat, input: RaiseInput): RaiseResult {
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
    return result;
  }).result;
}

const display = { kind_label_key: 'alert.t.lock', table_code: '12', requester_name: 'Order taker' };
const acceptInput = (n = 1, requester = WAIT): RaiseInput => ({
  kind: 't_accept',
  subject: { stream_type: 'table', stream_id: `T${n}` },
  target: { kind: 'person', staff_id: CASH },
  display,
  dedupe_key: `accept:T${n}`,
  requester_staff_id: requester,
  request: { receiver_staff_id: CASH },
});

let commandNo = 0;
function post(hub: TestHub, s: Seat, url: string, commandType: string, payload: Record<string, unknown>, commandId: string) {
  return hub.app.inject({
    method: 'POST',
    url,
    headers: { authorization: `Bearer ${s.deviceToken}`, 'x-session-token': s.sessionToken },
    payload: {
      command_id: commandId,
      tenant_id: TENANT,
      branch_id: BRANCH,
      command_type: commandType,
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: s.staffId,
      device_id: s.deviceId,
    },
  });
}
const withdraw = (hub: TestHub, s: Seat, alertId: string, commandId = `wd-auto-${(commandNo += 1)}`) =>
  post(hub, s, '/commands/withdraw-request', 'WithdrawRequest', { alert_id: alertId }, commandId);
const answer = (hub: TestHub, s: Seat, payload: Record<string, unknown>) =>
  post(hub, s, '/commands/answer-request', 'AnswerRequest', payload, `wd-answer-${(commandNo += 1)}`);

function eventsOf(hub: TestHub, type: string): PosEvent[] {
  return (hub.deps.db.prepare('SELECT * FROM events WHERE event_type = ? ORDER BY seq').all(type) as Array<Record<string, unknown>>).map(
    (row) => ({ ...row, payload: JSON.parse(row.payload as string) }) as unknown as PosEvent,
  );
}

function alertRow(hub: TestHub, id: string): Record<string, unknown> {
  return hub.deps.db.prepare('SELECT state, close_reason, decision, closed_by_staff_id FROM alerts WHERE alert_id = ?').get(id) as Record<string, unknown>;
}

function counts(hub: TestHub): { events: number; commands: number } {
  return {
    events: hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get() as number,
    commands: hub.deps.db.prepare('SELECT COUNT(*) FROM processed_commands').pluck().get() as number,
  };
}

/** Counts the statements of each `handle` call of WithdrawRequest (the §6.3 Queries row). */
function countHandle(hub: TestHub): { calls: number[]; restore(): void } {
  const def = commandRegistry(hub.app).byPath('withdraw-request') as CommandDef;
  const counter = statementCounter(hub.deps.db);
  const original = def.handle;
  const calls: number[] = [];
  def.handle = (ctx, payload, cmd) => {
    counter.reset();
    try {
      return original.call(def, ctx, payload, cmd);
    } finally {
      calls.push(counter.count);
    }
  };
  return {
    calls,
    restore() {
      def.handle = original;
    },
  };
}

describe('01d WithdrawRequest (task 25)', () => {
  const cleanups: Array<() => Promise<void>> = [];
  beforeEach(() => registerFakes());
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    resetFakes();
    activity.drain();
    activity.drainDevices();
  });

  it('[01d #13] withdraw by the requester → closed withdrawn, RequestWithdrawn + onWithdraw events; by someone else → 403 not_requester; after answer → 409', async () => {
    const hub = await world(cleanups);
    const wait = seat(hub, WAIT);
    const cash = seat(hub, CASH);
    const owner = seat(hub, OWNER);
    const id = raiseAs(hub, wait, acceptInput(1)).alert_id;

    // by someone else (the receiver, the requester's lead) → 403, nothing written
    const before = counts(hub);
    for (const who of [cash, owner]) {
      const refused = await withdraw(hub, who, id);
      expect(refused.statusCode).toBe(403);
      expect(refused.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'not_requester' } });
    }
    expect(counts(hub)).toEqual(before);
    expect(fakeApply.calls.filter((c) => c.fn === 'onWithdraw')).toEqual([]);

    // by the requester → 200 { alert_id }, RequestWithdrawn on the subject, the kind's onWithdraw effect
    const ok = await withdraw(hub, wait, id);
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as { data: { event_ids: string[]; result: unknown } };
    expect(body.data.result).toEqual({ alert_id: id });
    const withdrawn = eventsOf(hub, 'RequestWithdrawn');
    expect(withdrawn).toHaveLength(1);
    expect(withdrawn[0]).toMatchObject({
      stream_type: 'table',
      stream_id: 'T1',
      actor_id: WAIT,
      device_id: wait.deviceId,
      payload: { alert_id: id, by_staff_id: WAIT },
    });
    expect(fakeApply.calls.filter((c) => c.fn === 'onWithdraw')).toEqual([{ fn: 'onWithdraw', kind: 't_accept', alert_id: id, answer: null }]);
    const effects = eventsOf(hub, FAKE_EFFECT_EVENT);
    expect(effects.map((e) => e.payload)).toEqual([{ alert_id: id }]);
    expect(new Set(body.data.event_ids)).toEqual(new Set([withdrawn[0]!.event_id, effects[0]!.event_id]));
    expect(alertRow(hub, id)).toEqual({ state: 'closed', close_reason: 'withdrawn', decision: null, closed_by_staff_id: WAIT });
    // no request_result: the requester is the one who withdrew (§3.10 raises it on answer / close only)
    expect(eventsOf(hub, 'AlertRaised').filter((e) => e.payload.kind === 'request_result')).toHaveLength(0);

    // withdraw again → 409 REQUEST_NOT_PENDING (closed withdrawn)
    const again = await withdraw(hub, wait, id);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toMatchObject({
      code: 'REQUEST_NOT_PENDING',
      details: { alert_id: id, state: 'closed', close_reason: 'withdrawn', decision: null, answered_by_staff_id: null, answered_by_name: null },
    });

    // after answer → 409 with the answer's details; no onWithdraw ran
    const answered = raiseAs(hub, wait, acceptInput(2)).alert_id;
    expect((await answer(hub, cash, { alert_id: answered, decision: 'accept', method: 'session' })).statusCode).toBe(200);
    const late = await withdraw(hub, wait, answered);
    expect(late.statusCode).toBe(409);
    expect(late.json().error).toMatchObject({
      code: 'REQUEST_NOT_PENDING',
      details: { alert_id: answered, state: 'closed', close_reason: 'answered', decision: 'accept', answered_by_staff_id: CASH, answered_by_name: 'Cashier' },
    });
    expect(fakeApply.calls.filter((c) => c.fn === 'onWithdraw' && c.alert_id === answered)).toEqual([]);
    expect(eventsOf(hub, 'RequestWithdrawn')).toHaveLength(1);
  });

  it('[01d §6.3] 1 statement per handle (onWithdraw reads none here); 404 for an unknown alert and for an alert with no request part', async () => {
    const hub = await world(cleanups);
    const wait = seat(hub, WAIT);
    const id = raiseAs(hub, wait, acceptInput()).alert_id;
    const info = raiseAs(hub, wait, {
      kind: 't_info',
      subject: { stream_type: 'hub', stream_id: BRANCH },
      target: { kind: 'person', staff_id: CASH },
      display,
      dedupe_key: 'info:1',
      requester_staff_id: WAIT,
    }).alert_id;
    const probe = countHandle(hub);
    const before = counts(hub);
    for (const missing of ['01J0000000000000000000NONE', info]) {
      const response = await withdraw(hub, wait, missing);
      expect(response.statusCode).toBe(404);
      expect(response.json().error).toMatchObject({ code: 'ALERT_NOT_FOUND', details: { alert_id: missing } });
    }
    expect(counts(hub)).toEqual(before);
    expect((await withdraw(hub, wait, id)).statusCode).toBe(200);
    probe.restore();
    expect(probe.calls).toEqual([1, 1, 1]);
  });

  it('[01d §6.3] onWithdraw runs on the read-only view: a write, append or onCommit there → 500, nothing written; drafts without this alert_id → 500', async () => {
    const hub = await world(cleanups);
    const wait = seat(hub, WAIT);
    const id = raiseAs(hub, wait, acceptInput()).alert_id;
    const before = counts(hub);
    for (const mode of ['write', 'append', 'onCommit', 'no_alert_id', 'other_alert_id'] as const) {
      fakeApply.mode = mode;
      const response = await withdraw(hub, wait, id);
      expect(response.statusCode, mode).toBe(500);
      expect(response.json().error.code).toBe('INTERNAL_ERROR');
    }
    expect(counts(hub)).toEqual(before);
    expect(hub.deps.db.prepare('SELECT step FROM alerts WHERE alert_id = ?').pluck().get(id)).toBe(0);
    expect(alertRow(hub, id).state).toBe('open');
    // the kind's own error passes through (§6.3 Errors), nothing written
    fakeApply.mode = 'throw';
    const refused = await withdraw(hub, wait, id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({ code: 'ITEM_WRONG_STAGE', details: { reason: 'fake_apply' } });
    expect(counts(hub)).toEqual(before);
    expect(alertRow(hub, id).state).toBe('open');
  });

  it('[01d §6.3] a deduped raiser who is not the requester → 403 not_requester; the requester can still withdraw', async () => {
    const hub = await world(cleanups);
    const wait = seat(hub, WAIT);
    const owner = seat(hub, OWNER);
    const first = raiseAs(hub, wait, acceptInput(1));
    const second = raiseAs(hub, owner, acceptInput(1, OWNER));
    expect(second).toMatchObject({ alert_id: first.alert_id, deduped: true, requester_staff_id: WAIT });
    const refused = await withdraw(hub, owner, second.alert_id);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'not_requester' } });
    expect(alertRow(hub, first.alert_id).state).toBe('open');
    expect((await withdraw(hub, wait, first.alert_id)).statusCode).toBe(200);
    expect(alertRow(hub, first.alert_id)).toMatchObject({ state: 'closed', close_reason: 'withdrawn', closed_by_staff_id: WAIT });
  });

  it('[01d §6.3] alert_closed { reason: withdrawn } after commit to every recipient of every step and the requester', async () => {
    const clients: WsClient[] = [];
    const hub = await world(cleanups, clients);
    const wait = seat(hub, WAIT, 'wait-tab');
    const cash = seat(hub, CASH, 'cash-tab');
    const owner = seat(hub, OWNER, 'owner-tab');
    const waitWs = await socketOf(hub, wait, clients);
    const cashWs = await socketOf(hub, cash, clients);
    const ownerWs = await socketOf(hub, owner, clients);
    const id = raiseAs(hub, wait, acceptInput()).alert_id;
    // step 1 as the tick will write it: the receiver again and the requester's lead, informed
    hub.deps.writer.run((tx) => {
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
    expect((await withdraw(hub, wait, id)).statusCode).toBe(200);
    const closedFrame = { type: 'alert_closed', alert_id: id, reason: 'withdrawn', decision: null, by_name: null };
    for (const client of [cashWs, ownerWs, waitWs]) {
      await until(client, (m) => m.type === 'alert_closed' && m.alert_id === id);
      // exactly once: the command sends no frame of its own (ws-frames.ts does, after commit)
      expect(client.messages.filter((m) => (m as { type: string }).type === 'alert_closed')).toEqual([closedFrame]);
    }
  });

  it('[01d §6.3] a station session → 403 { session_kind: station }; the same command_id replays the stored 200 (idempotency)', async () => {
    const hub = await world(cleanups);
    const wait = seat(hub, WAIT);
    const id = raiseAs(hub, wait, acceptInput()).alert_id;
    const kds = pairDevice(hub, { type: 'kds', stationId: 'station-1' });
    const station = openSession(hub, { kind: 'station', stationId: 'station-1', deviceId: kds.deviceId });
    const kdsSeat: Seat = { staffId: '', deviceId: kds.deviceId, deviceToken: kds.token, sessionId: station.sessionId, sessionToken: station.token };
    const response = await hub.app.inject({
      method: 'POST',
      url: '/commands/withdraw-request',
      headers: { authorization: `Bearer ${kdsSeat.deviceToken}`, 'x-session-token': kdsSeat.sessionToken },
      payload: {
        command_id: 'wd-station',
        tenant_id: TENANT,
        branch_id: BRANCH,
        command_type: 'WithdrawRequest',
        payload: { alert_id: id },
        occurred_at: hub.clock.branchNow(),
        actor_id: null,
        device_id: kds.deviceId,
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { session_kind: 'station' } });

    const first = await withdraw(hub, wait, id, 'wd-idem');
    expect(first.statusCode).toBe(200);
    const before = counts(hub);
    const replay = await withdraw(hub, wait, id, 'wd-idem');
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(first.json());
    expect(counts(hub)).toEqual(before);
  });
});
