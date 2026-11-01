import type { DirectoryInput, EventDraft, PosEvent } from '@pos/events';
import { aBusinessDayClosed } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alerts, type RaiseInput } from '../../src/alerts/raise';
import { receiptBufferFor } from '../../src/alerts/receipts';
import { activity } from '../../src/auth/session-store';
import { currentDirectory } from '../../src/auth/guards';
import { createCommandRegistry, defineCommand, type CommandCtx, type CommandDef } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { wsHubFor } from '../../src/ws/server';
import { aDirectory, PIN } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, endSessionNow, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { registerFakes, resetFakes } from './fakes';
import { z } from 'zod';

// 01d task 26: MarkAlertsSeen (§6.4), RequestSeen and the alert_seen frame (§3.6), closes_on: 'seen' and
// the answering-seat exception (§3.5, §3.10), "for" rows (§3.4.3); tests #16, #33 and #23's command part.
// Assertions are on the DB and on spies (no WS polling): the alert_seen frame is ws-frames.ts's (task 20).

const OWNER = 'S_OWNER'; // Hamza's lead
const MGR = 'S_MGR'; // approver of WAIT's voids
const CASH = 'S_CASH'; // the accept kinds' receiver
const WAIT = 'S_WAIT'; // "Hamza": requester
const TENANT = 'tenant-a';
const BRANCH = 'branch-1';

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
  const staff = base.staff.map((s) => (s.staff_id === WAIT ? { ...s, lead_staff_id: OWNER } : s));
  return { ...base, roles, staff };
}

interface Seat {
  staffId: string | null;
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

/** Another staff session on a seat's device (one open session per device: the seat's ends first). */
function signInOn(hub: TestHub, on: Seat, staffId: string): Seat {
  endSessionNow(hub, on.sessionId);
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: on.deviceId });
  return { ...on, staffId, sessionId: session.sessionId, sessionToken: session.token };
}

/** A connected staff socket for the seat: a screen route (§3.4.3), so a lead_fallback alert reaches them. */
async function online(hub: TestHub, s: Seat, clients: WsClient[]): Promise<void> {
  const ws = await connectWs(hub.app);
  clients.push(ws);
  ws.send({ type: 'auth', device_token: s.deviceToken, session_token: s.sessionToken });
  await ws.untilCount(1);
}

function stationSeat(hub: TestHub): Seat {
  const kds = pairDevice(hub, { type: 'kds', stationId: 'ST1' });
  const session = openSession(hub, { kind: 'station', deviceId: kds.deviceId, stationId: 'ST1' });
  return { staffId: null, deviceId: kds.deviceId, deviceToken: kds.token, sessionId: session.sessionId, sessionToken: session.token };
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

/** Alerts raised by a command handler on the seat (raised_device_id = that device), in one transaction. */
function raiseAs(hub: TestHub, s: Seat, ...inputs: RaiseInput[]): string[] {
  return hub.deps.writer.run((tx) => {
    const results = alerts.raiseMany(ctxOf(hub, tx, s), inputs);
    tx.append(results.flatMap((r) => r.events));
    return results.map((r) => r.alert_id);
  }).result;
}

const display = { kind_label_key: 'alert.t.lock', table_code: '12', requester_name: 'Order taker' };
const acceptInput = (n = 1, target: string = CASH): RaiseInput => ({
  kind: 't_accept',
  subject: { stream_type: 'table', stream_id: `T${n}` },
  target: { kind: 'person', staff_id: target },
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
  request: { approver_role_ids: ['R_MGR', 'R_OWNER'] },
});
const infoInput = (n: number, to: string): RaiseInput => ({
  kind: 't_info',
  subject: { stream_type: 'hub', stream_id: BRANCH },
  target: { kind: 'person', staff_id: to },
  display,
  dedupe_key: `info:${n}`,
  requester_staff_id: null,
});
/** A personal notice (§3.10) to MGR, hidden from `hidden` (as AnswerRequest raises it, task 24). */
const receiptInput = (n: number, hidden: { session_id: string; device_id: string }): RaiseInput => ({
  kind: 'approval_receipt',
  subject: { stream_type: 'order', stream_id: `O${n}` },
  target: { kind: 'person', staff_id: MGR },
  values: { request_alert_id: `REQ${n}`, request_kind: 't_approval', decision: 'approve', device_id: hidden.device_id, on_requester_device: false },
  display,
  details: {},
  dedupe_key: `approval_receipt:REQ${n}`,
  requester_staff_id: null,
  hidden_from: hidden,
});

let commandNo = 0;
function post(hub: TestHub, s: Seat, name: string, commandType: string, payload: Record<string, unknown>, commandId = `seen-auto-${(commandNo += 1)}`) {
  return hub.app.inject({
    method: 'POST',
    url: `/commands/${name}`,
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
const markSeen = (hub: TestHub, s: Seat, ids: string[], commandId?: string) => post(hub, s, 'mark-alerts-seen', 'MarkAlertsSeen', { alert_ids: ids }, commandId);

async function seenOk(hub: TestHub, s: Seat, ids: string[]): Promise<string[]> {
  const response = await markSeen(hub, s, ids);
  expect(response.statusCode).toBe(200);
  return (response.json() as { data: { result: { seen: string[] } } }).data.result.seen;
}

function eventsOf(hub: TestHub, type: string): PosEvent[] {
  return (hub.deps.db.prepare('SELECT * FROM events WHERE event_type = ? ORDER BY seq').all(type) as Array<Record<string, unknown>>).map(
    (row) => ({ ...row, payload: JSON.parse(row.payload as string) }) as unknown as PosEvent,
  );
}

function alertRow(hub: TestHub, id: string): Record<string, unknown> {
  return hub.deps.db
    .prepare('SELECT state, close_reason, closed_by_staff_id, hidden_session_id, hidden_device_id FROM alerts WHERE alert_id = ?')
    .get(id) as Record<string, unknown>;
}

function inboxOf(hub: TestHub, id: string): string[] {
  return hub.deps.db.prepare('SELECT staff_id FROM alert_inbox WHERE alert_id = ? ORDER BY staff_id').pluck().all(id) as string[];
}

function counts(hub: TestHub): { events: number; commands: number } {
  return {
    events: hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get() as number,
    commands: hub.deps.db.prepare('SELECT COUNT(*) FROM processed_commands').pluck().get() as number,
  };
}

/** Flushes the receipt buffer and returns the AlertSeen events (staff, device) for an alert. */
function alertSeenOf(hub: TestHub, id: string): Array<{ staff_id: unknown; device_id: unknown }> {
  receiptBufferFor(hub.app).flush();
  return eventsOf(hub, 'AlertSeen')
    .filter((e) => e.payload.alert_id === id)
    .map((e) => ({ staff_id: e.payload.staff_id, device_id: e.payload.device_id }));
}

function dayClose(hub: TestHub): void {
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
}

/** Counts the statements of each `handle` call of MarkAlertsSeen (the §6.4 Queries row). */
function countHandle(hub: TestHub): { calls: number[]; restore(): void } {
  const def = commandRegistry(hub.app).byPath('mark-alerts-seen') as CommandDef;
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

/** The alert_seen frames sent to staff sockets (ws-frames.ts, after commit). */
function seenFrames(hub: TestHub): Array<{ staff: string[]; alert_id: unknown }> {
  const ws = wsHubFor(hub.app);
  const sent: Array<{ staff: string[]; alert_id: unknown }> = [];
  const original = ws.sendToStaff.bind(ws);
  vi.spyOn(ws, 'sendToStaff').mockImplementation((staffIds, frame) => {
    if (frame.type === 'alert_seen') sent.push({ staff: [...staffIds], alert_id: frame.alert_id });
    original(staffIds, frame);
  });
  return sent;
}

describe('01d MarkAlertsSeen (task 26)', () => {
  const cleanups: Array<() => Promise<void>> = [];
  const clients: WsClient[] = [];
  beforeEach(() => registerFakes());
  afterEach(async () => {
    for (const client of clients.splice(0)) client.close();
    for (const cleanup of cleanups.splice(0)) await cleanup();
    resetFakes();
    activity.drain();
    activity.drainDevices();
    vi.restoreAllMocks();
  });

  it('[01d #16] first seen of a request → RequestSeen once; second call → none; ids not in my inbox ignored; request_result closes done', async () => {
    const hub = await world(cleanups);
    const wait = seat(hub, WAIT);
    const cash = seat(hub, CASH);
    const mgr = seat(hub, MGR);
    const [id] = raiseAs(hub, wait, acceptInput(1));
    const frames = seenFrames(hub);

    // first seen → RequestSeen on the request's subject, in the command's transaction
    const first = await markSeen(hub, cash, [id!]);
    expect(first.statusCode).toBe(200);
    const body = first.json() as { data: { event_ids: string[]; result: { seen: string[] } } };
    expect(body.data.result).toEqual({ seen: [id] });
    const seen = eventsOf(hub, 'RequestSeen');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      stream_type: 'table',
      stream_id: 'T1',
      actor_id: CASH,
      device_id: cash.deviceId,
      payload: { alert_id: id, staff_id: CASH, device_id: cash.deviceId },
    });
    expect(body.data.event_ids).toEqual([seen[0]!.event_id]);
    expect(hub.deps.db.prepare('SELECT staff_id FROM request_seen WHERE alert_id = ?').pluck().all(id)).toEqual([CASH]);
    expect(frames).toEqual([{ staff: [CASH], alert_id: id }]);

    // second call (a new command_id) → acted on again, but no second RequestSeen and no frame
    expect(await seenOk(hub, cash, [id!])).toEqual([id]);
    expect(eventsOf(hub, 'RequestSeen')).toHaveLength(1);
    expect(frames).toHaveLength(1);

    // ids not in my inbox (MGR's info alert, an unknown id) → ignored: no error, no event, no leak
    const [info] = raiseAs(hub, wait, infoInput(1, MGR));
    const before = counts(hub);
    expect(await seenOk(hub, cash, [info!, '01J0000000000000000000NONE'])).toEqual([]);
    expect(counts(hub).events).toBe(before.events);
    expect(alertSeenOf(hub, info!)).toEqual([]);
    expect(alertRow(hub, info!)).toMatchObject({ state: 'open' });

    // request_result (closes_on 'seen') → closed 'done' by the requester's own seen
    const answered = await post(hub, cash, 'answer-request', 'AnswerRequest', { alert_id: id, decision: 'accept', method: 'session' });
    expect(answered.statusCode).toBe(200);
    const result = eventsOf(hub, 'AlertRaised').find((e) => e.payload.kind === 'request_result')!.payload.alert_id as string;
    expect(alertRow(hub, result)).toMatchObject({ state: 'open' });
    // not WAIT's: MGR's seen of it is ignored and closes nothing
    expect(await seenOk(hub, mgr, [result])).toEqual([]);
    expect(alertRow(hub, result)).toMatchObject({ state: 'open' });
    const closing = await markSeen(hub, wait, [result]);
    expect(closing.statusCode).toBe(200);
    expect(closing.json().data.result).toEqual({ seen: [result] });
    const closed = eventsOf(hub, 'AlertClosed').filter((e) => e.payload.alert_id === result);
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({
      stream_type: 'table',
      stream_id: 'T1',
      actor_id: WAIT,
      device_id: wait.deviceId,
      payload: { alert_id: result, reason: 'done', by_staff_id: WAIT, note: null },
    });
    expect(alertRow(hub, result)).toMatchObject({ state: 'closed', close_reason: 'done', closed_by_staff_id: WAIT });
    expect(alertSeenOf(hub, result)).toEqual([{ staff_id: WAIT, device_id: wait.deviceId }]);
    // seen again once closed: still in my inbox, so acted on (receipt deduped), no second close
    expect(await seenOk(hub, wait, [result])).toEqual([result]);
    expect(eventsOf(hub, 'AlertClosed').filter((e) => e.payload.alert_id === result)).toHaveLength(1);
    expect(alertSeenOf(hub, result)).toHaveLength(1);
  });

  it('[01d #33] handler-checked commands: unlisted command rejected at startup; no right → 403 / no id acted on, nothing written; a station session → 403 for each listed command', async () => {
    // the registry rule (startup error)
    const registry = createCommandRegistry();
    const unlisted = defineCommand({
      commandType: 'TestUnlisted',
      payloadSchema: z.object({}),
      sessionKind: 'device',
      permission: 'checked-in-handler',
      handle: () => ({ events: [], result: null }),
    });
    expect(() => registry.register(unlisted)).toThrow(/HANDLER_CHECKED_COMMANDS/);

    const hub = await world(cleanups);
    const wait = seat(hub, WAIT);
    const cash = seat(hub, CASH);
    const owner = seat(hub, OWNER);
    const [voidId] = raiseAs(hub, wait, voidInput(1));
    const [acceptId] = raiseAs(hub, wait, acceptInput(2));
    const [mgrInfo] = raiseAs(hub, wait, infoInput(1, MGR));
    let before = counts(hub);

    // answer: not an approver (refused before any PIN is verified)
    const notApprover = await post(hub, cash, 'answer-request', 'AnswerRequest', { alert_id: voidId, decision: 'approve', method: 'pin', pin: PIN.c });
    expect(notApprover.statusCode).toBe(403);
    expect(notApprover.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'not_approver' } });
    // withdraw: not the requester
    const notRequester = await post(hub, owner, 'withdraw-request', 'WithdrawRequest', { alert_id: acceptId });
    expect(notRequester.statusCode).toBe(403);
    expect(notRequester.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'not_requester' } });
    expect(counts(hub)).toEqual(before);
    // seen: ids not in my inbox (and not a request I may answer) → acts on no id, no event
    expect(await seenOk(hub, cash, [mgrInfo!, voidId!])).toEqual([]);
    expect(counts(hub).events).toBe(before.events);
    expect(alertSeenOf(hub, mgrInfo!)).toEqual([]);
    expect(alertSeenOf(hub, voidId!)).toEqual([]);

    // a station session → 403 { session_kind: 'station' } for each listed command, nothing written
    const kds = stationSeat(hub);
    before = counts(hub);
    const calls: Array<[string, string, Record<string, unknown>]> = [
      ['answer-request', 'AnswerRequest', { alert_id: acceptId, decision: 'accept', method: 'session' }],
      ['withdraw-request', 'WithdrawRequest', { alert_id: acceptId }],
      ['mark-alerts-seen', 'MarkAlertsSeen', { alert_ids: [acceptId] }],
    ];
    for (const [name, type, payload] of calls) {
      const blocked = await post(hub, kds, name, type, payload);
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { session_kind: 'station' } });
    }
    expect(counts(hub)).toEqual(before);
    expect(alertSeenOf(hub, acceptId!)).toEqual([]);
  });

  it('[01d §6.4] 1 read statement for 50 ids; 0 or 51 ids → 400; duplicate ids acted on once', async () => {
    const hub = await world(cleanups);
    const wait = seat(hub, WAIT);
    const cash = seat(hub, CASH);
    await online(hub, cash, clients);
    const infos = raiseAs(hub, wait, ...Array.from({ length: 46 }, (_, i) => infoInput(i, CASH)));
    const [request] = raiseAs(hub, wait, acceptInput(1));
    const [elsewhere] = raiseAs(hub, wait, acceptInput(2, MGR)); // CASH may answer it; no inbox row
    const [other] = raiseAs(hub, wait, infoInput(99, MGR));
    const ids = [...infos, request!, elsewhere!, other!, '01J0000000000000000000NONE'];
    expect(ids).toHaveLength(50);
    const probe = countHandle(hub);
    const seen = await seenOk(hub, cash, ids);
    probe.restore();
    expect(probe.calls).toEqual([1]);
    expect(seen).toEqual([...infos, request, elsewhere]);
    expect(eventsOf(hub, 'RequestSeen').map((e) => e.payload.alert_id)).toEqual([request, elsewhere]);

    for (const bad of [[], [...ids, infos[0]!]]) {
      const refused = await markSeen(hub, cash, bad);
      expect(refused.statusCode).toBe(400);
      expect(refused.json().error.code).toBe('VALIDATION_FAILED');
    }
    const [fresh] = raiseAs(hub, wait, acceptInput(3));
    expect(await seenOk(hub, cash, [fresh!, fresh!])).toEqual([fresh]);
    expect(eventsOf(hub, 'RequestSeen').filter((e) => e.payload.alert_id === fresh)).toHaveLength(1);
  });

  it('[01d §6.4] an open request I may answer now but have no inbox row for → RequestSeen and an inbox row; someone who may not → ignored', async () => {
    const hub = await world(cleanups);
    const wait = seat(hub, WAIT);
    const cash = seat(hub, CASH);
    const owner = seat(hub, OWNER);
    // sent to MGR only; CASH is the receiver (named), so CASH may answer it
    const [id] = raiseAs(hub, wait, acceptInput(1, MGR));
    expect(inboxOf(hub, id!)).toEqual([MGR]);
    expect(await seenOk(hub, owner, [id!])).toEqual([]);
    expect(eventsOf(hub, 'RequestSeen')).toHaveLength(0);

    expect(await seenOk(hub, cash, [id!])).toEqual([id]);
    expect(eventsOf(hub, 'RequestSeen').map((e) => e.payload)).toEqual([{ alert_id: id, staff_id: CASH, device_id: cash.deviceId }]);
    expect(inboxOf(hub, id!)).toEqual([CASH, MGR]);
    expect(alertSeenOf(hub, id!)).toEqual([{ staff_id: CASH, device_id: cash.deviceId }]);

    // once answered (closed), CASH's inbox row (from RequestSeen) still makes it acted on; no new RequestSeen
    expect((await post(hub, cash, 'answer-request', 'AnswerRequest', { alert_id: id, decision: 'accept', method: 'session' })).statusCode).toBe(200);
    expect(await seenOk(hub, cash, [id!])).toEqual([id]);
    expect(eventsOf(hub, 'RequestSeen')).toHaveLength(1);
  });

  it('[01d §3.5] answering seat: seen from the hidden session, or another session on the hidden device the same day → AlertSeen, not closed, id in seen; after BusinessDayClosed a new session there closes it; the original session never does', async () => {
    const hub = await world(cleanups);
    const tab = seat(hub, MGR, 'Hamza tablet');
    const own = seat(hub, MGR, 'Imran tablet');
    // n1 hidden from the session on Hamza's tablet; n2 hidden from Imran's own tablet session
    const [n1, n2] = raiseAs(hub, tab, receiptInput(1, { session_id: tab.sessionId, device_id: tab.deviceId }), receiptInput(2, { session_id: own.sessionId, device_id: own.deviceId }));

    // the answering session itself
    expect(await seenOk(hub, tab, [n1!])).toEqual([n1]);
    expect(alertRow(hub, n1!)).toMatchObject({ state: 'open' });
    expect(alertSeenOf(hub, n1!)).toEqual([{ staff_id: MGR, device_id: tab.deviceId }]);
    // another MGR session on the same device, the same day
    const again = signInOn(hub, tab, MGR);
    expect(await seenOk(hub, again, [n1!])).toEqual([n1]);
    expect(alertRow(hub, n1!)).toMatchObject({ state: 'open' });
    // n2 from its own (hidden) session
    expect(await seenOk(hub, own, [n2!])).toEqual([n2]);
    expect(alertRow(hub, n2!)).toMatchObject({ state: 'open' });
    expect(eventsOf(hub, 'AlertClosed')).toHaveLength(0);

    dayClose(hub);
    expect(alertRow(hub, n1!)).toMatchObject({ state: 'open', hidden_session_id: tab.sessionId, hidden_device_id: null });
    // the original session of n2 (still signed in) never closes it, even after the day close
    expect(await seenOk(hub, own, [n2!])).toEqual([n2]);
    expect(alertRow(hub, n2!)).toMatchObject({ state: 'open' });
    // a new session on Hamza's tablet after the day close → n1 closes 'done'
    const next = signInOn(hub, again, MGR);
    expect(await seenOk(hub, next, [n1!])).toEqual([n1]);
    expect(alertRow(hub, n1!)).toMatchObject({ state: 'closed', close_reason: 'done', closed_by_staff_id: MGR });
    expect(eventsOf(hub, 'AlertClosed').map((e) => e.payload.alert_id)).toEqual([n1]);
  });

  it('[01d §3.4.3] a lead’s seen of a "for Ali" card is accepted for the lead and closes nothing for Ali', async () => {
    const hub = await world(cleanups);
    const owner = seat(hub, OWNER, 'Owner tablet');
    const raiser = seat(hub, CASH);
    // the lead has a connected staff socket (a screen route); Hamza (WAIT) has none
    await online(hub, owner, clients);
    const [id] = raiseAs(hub, raiser, infoInput(1, WAIT));
    expect(hub.deps.db.prepare('SELECT staff_id, for_staff_id FROM alert_recipients WHERE alert_id = ?').all(id)).toContainEqual({
      staff_id: OWNER,
      for_staff_id: WAIT,
    });
    // Ali's own inbox row (if any) is routes.ts's (task 17; see the task 26 report), not this command's
    const inbox = inboxOf(hub, id!);
    expect(inbox).toContain(OWNER);
    const before = counts(hub);
    expect(await seenOk(hub, owner, [id!])).toEqual([id]);
    expect(counts(hub).events).toBe(before.events); // no RequestSeen, no AlertClosed
    expect(alertSeenOf(hub, id!)).toEqual([{ staff_id: OWNER, device_id: owner.deviceId }]);
    expect(alertRow(hub, id!)).toMatchObject({ state: 'open' });
    expect(inboxOf(hub, id!)).toEqual(inbox);
    expect(eventsOf(hub, 'AlertClosed')).toHaveLength(0);
  });

  it('[01d #23] a MarkAlertsSeen that rolls back buffers no AlertSeen, writes no RequestSeen and sends no alert_seen; a committed one buffers on commit', async () => {
    const hub = await world(cleanups);
    const wait = seat(hub, WAIT);
    const cash = seat(hub, CASH);
    const [id] = raiseAs(hub, wait, acceptInput(1));
    const buffer = receiptBufferFor(hub.app);
    const frames = seenFrames(hub);
    const def = commandRegistry(hub.app).byPath('mark-alerts-seen') as CommandDef;
    const original = def.handle;
    def.handle = (ctx, payload, cmd) => {
      const out = original.call(def, ctx, payload, cmd);
      expect(out.events.map((e) => e.event_type)).toEqual(['RequestSeen']);
      throw new Error('rolled back after handle');
    };
    const before = counts(hub);
    const failed = await markSeen(hub, cash, [id!]);
    def.handle = original;
    expect(failed.statusCode).toBe(500);
    expect(buffer.size()).toBe(0);
    expect(counts(hub)).toEqual(before);
    expect(frames).toEqual([]);

    expect(await seenOk(hub, cash, [id!])).toEqual([id]);
    expect(buffer.size()).toBe(1);
    expect(frames).toEqual([{ staff: [CASH], alert_id: id }]);
    expect(alertSeenOf(hub, id!)).toEqual([{ staff_id: CASH, device_id: cash.deviceId }]);
    // a repeat with a new command_id buffers no duplicate receipt
    expect(await seenOk(hub, cash, [id!])).toEqual([id]);
    expect(buffer.size()).toBe(0);
  });
});
