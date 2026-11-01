import { DomainError } from '@pos/domain';
import type { AlertView, DirectoryInput, EventDraft, PosEvent } from '@pos/events';
import { anAlertClosed, anAlertRaised, anAttemptSent, aPresenceSet, aRequestAnswered } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alerts, type RaiseInput } from '../../src/alerts/raise';
import { registerRoute, unregisterRoute } from '../../src/alerts/routes';
import { wsHubFor } from '../../src/ws/server';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { fakePager, registerFakes, resetFakes } from './fakes';

// 01d task 20: ws-frames.ts. §6 batch 3 (card vs lock, device targets, hidden from the answering seat,
// cumulative alert_closed, may-answer sockets), §3.6 alert_seen, §3.12 details, §7 logging; tests #29, #49.
// Real WS clients against a test hub; frames go out from the writer's after-commit hook (registerAlerts).

const OWNER = 'S_OWNER'; // not an approver of void-item (role R_OWNER not in approver_role_ids)
const MGR = 'S_MGR'; // approver (R_MGR), approve-void branch scope
const MGR2 = 'S_MGR2'; // approver, absent at raise (not a recipient), signs in later
const CASH = 'S_CASH';
const WAIT = 'S_WAIT'; // requester: void-item requires approval by R_MGR

const DETAILS = { item: 'Mutton platter', quantity: 1, amount: 480_000, reason: 'customer changed mind' };
const SECRET_VALUES = ['Mutton platter', '480000', '480_000', 'customer changed mind'];

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const roles = base.roles.map((role) =>
    role.role_id === 'R_WAIT'
      ? {
          ...role,
          permissions: [
            { permission: 'void-item' as const, grant_type: 'requires_approval' as const, approver_role_id: 'R_MGR', approver_role_ids: ['R_MGR'], scope: 'branch' as const },
          ],
        }
      : role,
  );
  const mgr = base.staff.find((s) => s.staff_id === MGR);
  if (mgr === undefined) throw new Error('fixture has no S_MGR');
  return { ...base, roles, staff: [...base.staff, { ...mgr, staff_id: MGR2, display_name: 'Manager two' }] };
}

interface World {
  hub: TestHub;
  devices: Map<string, { deviceId: string; token: string }>;
  clients: WsClient[];
  /** statements counted from the last beforeCommit to the end of the after-commit hooks */
  lastHookStatements(): number;
}

async function world(cleanups: Array<() => Promise<void>>): Promise<World> {
  const probe: { reset: () => void; count: () => number; last: number } = { reset: () => undefined, count: () => 0, last: -1 };
  const hub = await createTestHub({ testHooks: { beforeCommit: () => probe.reset() } });
  cleanups.push(() => hub.close());
  const counter = statementCounter(hub.deps.db);
  probe.reset = () => counter.reset();
  probe.count = () => counter.count;
  // registered after registerAlerts' hook, so it sees the frames hook's statements
  hub.deps.writer.addAfterCommit(() => {
    probe.last = probe.count();
  });
  await seedDirectory(hub, await directory());
  return { hub, devices: new Map(), clients: [], lastHookStatements: () => probe.last };
}

function device(w: World, name: string, type: 'tablet' | 'cashier_kiosk' | 'kds' | 'phone'): string {
  const d = pairDevice(w.hub, { type, stationId: type === 'kds' ? 'station-1' : undefined, name });
  w.devices.set(d.deviceId, d);
  return d.deviceId;
}

function tokenOf(w: World, deviceId: string): string {
  const d = w.devices.get(deviceId);
  if (d === undefined) throw new Error(`unknown device ${deviceId}`);
  return d.token;
}

async function staffSocket(w: World, staffId: string, deviceId: string): Promise<{ ws: WsClient; sessionId: string }> {
  const session = openSession(w.hub, { kind: 'staff', staffId, deviceId });
  const ws = await connectWs(w.hub.app);
  ws.send({ type: 'auth', device_token: tokenOf(w, deviceId), session_token: session.token });
  await ws.untilCount(1);
  expect(ws.messages[0]).toMatchObject({ type: 'catch_up' });
  w.clients.push(ws);
  return { ws, sessionId: session.sessionId };
}

async function stationSocket(w: World, deviceId: string): Promise<WsClient> {
  const response = await w.hub.app.inject({ method: 'POST', url: '/auth/station', headers: { authorization: `Bearer ${tokenOf(w, deviceId)}` } });
  const body = response.json() as { data: { session_token: string } };
  const ws = await connectWs(w.hub.app);
  ws.send({ type: 'auth', device_token: tokenOf(w, deviceId), session_token: body.data.session_token });
  await ws.untilCount(1);
  expect(ws.messages[0]).toMatchObject({ type: 'catch_up' });
  w.clients.push(ws);
  return ws;
}

async function alertSocket(w: World, deviceId: string): Promise<WsClient> {
  const ws = await connectWs(w.hub.app);
  ws.send({ type: 'auth', device_token: tokenOf(w, deviceId) });
  await ws.untilCount(1);
  expect(ws.messages[0]).toMatchObject({ type: 'alerts_open' });
  w.clients.push(ws);
  return ws;
}

let fenceNo = 0;
/** Every frame sent before this call has reached every client (per-socket order). */
async function fence(w: World): Promise<void> {
  fenceNo += 1;
  const id = `FENCE_${fenceNo}`;
  wsHubFor(w.hub.app).sendToDevices([...w.devices.keys()], { type: 'alert_seen', alert_id: id });
  for (const client of w.clients) {
    for (let i = 0; i < 50 && !client.messages.some((m) => (m as { alert_id?: string }).alert_id === id); i += 1) {
      await client.untilCount(client.messages.length + 1);
    }
  }
}

type Frame = { type: string; alert_id?: string; alert?: AlertView & Record<string, unknown> } & Record<string, unknown>;

/** Alert frames (no fences, no catch_up / alerts_open). */
function framesOf(client: WsClient): Frame[] {
  return (client.messages as Frame[]).filter(
    (m) => ['alert', 'alert_closed', 'alert_seen'].includes(m.type) && !(m.alert_id ?? '').startsWith('FENCE_'),
  );
}

const alertFrames = (client: WsClient): Array<AlertView & Record<string, unknown>> =>
  framesOf(client).flatMap((f) => (f.type === 'alert' && f.alert !== undefined ? [f.alert] : []));

function asDraft(event: PosEvent): EventDraft {
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

const voidInput = (over: Partial<RaiseInput> = {}): RaiseInput => ({
  kind: 't_approval',
  subject: { stream_type: 'order', stream_id: 'O1' },
  target: { kind: 'answerers' },
  values: { order_id: 'O1' },
  display: { kind_label_key: 'alert.t_approval.lock', table_code: '12', requester_name: 'Order taker' },
  details: DETAILS,
  dedupe_key: 'void:O1:L1',
  requester_staff_id: WAIT,
  request: { approver_role_ids: ['R_MGR'] },
  ...over,
});

function raise(w: World, input: RaiseInput): string {
  return w.hub.deps.writer.run((tx) => {
    const result = alerts.raise(alerts.tickCtx(tx, w.hub.clock.branchNow()), input);
    tx.append(result.events);
    return result.alert_id;
  }).result;
}

function append(w: World, events: PosEvent[]): void {
  w.hub.deps.writer.run((tx) => {
    tx.append(events.map(asDraft));
  });
}

type Row = { staff_id: string | null; device_id: string | null; for_staff_id: string | null; set: 'answerer' | 'informed' | 'recipient' };
const personRow = (staff_id: string, set: Row['set'] = 'recipient', for_staff_id: string | null = null): Row => ({ staff_id, device_id: null, for_staff_id, set });
const deviceRow = (device_id: string, set: Row['set'] = 'recipient'): Row => ({ staff_id: null, device_id, for_staff_id: null, set });

/** A builder-seeded alert of a fake kind, with its step 0 (and the hidden columns when given). */
function seedAlert(
  w: World,
  o: { id: string; kind?: string; family?: string; rows: Row[]; routes?: Array<{ staff_id: string | null; route: string; ref: string }>; hidden?: { session_id: string; device_id: string } },
): void {
  append(w, [
    anAlertRaised({
      payload: {
        alert_id: o.id,
        kind: o.kind ?? 't_two_step',
        family: o.family ?? 'info',
        dedupe_key: `seed:${o.id}`,
        display: { kind_label_key: 'alert.seed.lock', table_code: '7', requester_name: 'Cashier' },
        hidden_from: o.hidden ?? null,
      },
    }),
    anAttemptSent({ payload: { alert_id: o.id, step: 0, recipients: o.rows, routes: o.routes ?? [] } }),
  ]);
}

function stepEvent(id: string, step: number, rows: Row[], routes: Array<{ staff_id: string | null; route: string; ref: string }> = []): PosEvent {
  return anAttemptSent({ payload: { alert_id: id, step, recipients: rows, routes } });
}

function expectNoSecret(text: string): void {
  for (const value of SECRET_VALUES) expect(text).not.toContain(value);
  expect(text).not.toContain('"details"');
}

describe('01d ws-frames (task 20)', () => {
  const cleanups: Array<() => Promise<void>> = [];
  beforeEach(() => registerFakes());
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    resetFakes();
  });

  it('[01d #29] a staff-session socket gets card; an alert-mode socket never gets card (no amounts or reasons in frames)', async () => {
    const w = await world(cleanups);
    const tab = device(w, 'tab', 'tablet');
    const mgrDev = device(w, 'mgr', 'tablet');
    openSession(w.hub, { kind: 'staff', staffId: MGR, deviceId: tab }); // binds the tablet to MGR (§3.7)
    const mode = await alertSocket(w, tab);
    const mgr = await staffSocket(w, MGR, mgrDev);
    const id = raise(w, voidInput());
    await fence(w);

    const staff = alertFrames(mgr.ws);
    expect(staff).toHaveLength(1);
    expect(staff[0]).toMatchObject({ alert_id: id, step: 0, set: 'answerer', for_staff_id: null });
    expect(staff[0]?.card).toEqual({ kind_label_key: 'alert.t_approval.card', table_code: '12', point_code: null, requester_name: 'Order taker', details: DETAILS });

    const locked = alertFrames(mode);
    expect(locked).toHaveLength(1);
    expect(locked[0]).toMatchObject({ alert_id: id, step: 0, set: 'answerer', for_staff_id: null });
    expect(locked[0]).not.toHaveProperty('card');
    expect(locked[0]?.lock).toEqual({ kind_label_key: 'alert.t_approval.lock', table_code: '12', point_code: null, requester_name: 'Order taker' });
    expectNoSecret(JSON.stringify(mode.messages));
  });

  it('[01d #49] details reach only the approver staff socket card; alert-mode, KDS station socket and alerts_open carry no details or amount; logs carry none; bad details → details_invalid', async () => {
    const w = await world(cleanups);
    const tab = device(w, 'tab', 'tablet');
    const mgrDev = device(w, 'mgr', 'tablet');
    const kds = device(w, 'kds', 'kds');
    openSession(w.hub, { kind: 'staff', staffId: MGR, deviceId: tab });
    const mode = await alertSocket(w, tab);
    const mgr = await staffSocket(w, MGR, mgrDev);
    const kdsWs = await stationSocket(w, kds);
    const id = raise(w, voidInput());
    // step 1 of the approval tier adds always_on (the KDS), as the tick (task 30) will write it
    append(w, [
      {
        ...stepEvent(id, 1, [personRow(MGR, 'answerer'), deviceRow(kds, 'informed')], [
          { staff_id: MGR, route: 'screen', ref: mgrDev },
          { staff_id: MGR, route: 'alert_connection', ref: tab },
          { staff_id: null, route: 'screen', ref: kds },
        ]),
        stream_type: 'order',
        stream_id: 'O1',
      },
    ]);
    await fence(w);

    const cards = alertFrames(mgr.ws);
    expect(cards.map((a) => a.step)).toEqual([0, 1]);
    for (const a of cards) expect(a.card?.details).toEqual(DETAILS);

    const kdsFrames = alertFrames(kdsWs);
    expect(kdsFrames).toHaveLength(1);
    expect(kdsFrames[0]).toMatchObject({ alert_id: id, step: 1, set: 'informed', for_staff_id: null });
    expect(alertFrames(mode).map((a) => a.step)).toEqual([0, 1]);
    for (const client of [mode, kdsWs]) {
      for (const a of alertFrames(client)) {
        expect(a).not.toHaveProperty('card');
        // AD-23: alert-mode / lock frames never carry the signed-in-only answer fields
        for (const key of ['answers', 'needs_pin', 'silent', 'details']) {
          expect(a).not.toHaveProperty(key);
          expect(a.lock).not.toHaveProperty(key);
        }
      }
      expectNoSecret(JSON.stringify(client.messages));
    }
    // alerts_open (default builder until task 32) never carries card or details
    expect(mode.messages[0]).toMatchObject({ type: 'alerts_open' });
    expectNoSecret(JSON.stringify(mode.messages[0]));
    expectNoSecret(w.hub.logs());

    const bad = (() => {
      try {
        raise(w, voidInput({ dedupe_key: 'void:O1:L2', details: { item: 'Mutton platter' } }));
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    expect(bad).toBeInstanceOf(DomainError);
    expect((bad as DomainError).code).toBe('VALIDATION_FAILED');
    expect((bad as DomainError).details).toMatchObject({ issue: 'details_invalid' });
    expectNoSecret(w.hub.logs());
  });

  it('[01d §6 batch 3] one alert frame per step per socket, with set and for_staff_id per recipient', async () => {
    const w = await world(cleanups);
    const a = device(w, 'a', 'tablet');
    const b = device(w, 'b', 'tablet');
    const c = device(w, 'c', 'tablet');
    const mgr = await staffSocket(w, MGR, a);
    const mgrSecond = await staffSocket(w, MGR, b);
    const owner = await staffSocket(w, OWNER, c);
    // the owner takes two "for" rows (§3.4.3, one card per person on the lead's screen) and MGR one direct row
    seedAlert(w, {
      id: 'A_STEP',
      rows: [personRow(MGR, 'recipient'), personRow(OWNER, 'recipient', CASH), personRow(OWNER, 'recipient', WAIT)],
    });
    append(w, [stepEvent('A_STEP', 1, [personRow(MGR, 'recipient')])]);
    await fence(w);

    for (const client of [mgr.ws, mgrSecond.ws]) {
      const got = alertFrames(client);
      expect(got.map((f) => [f.step, f.set, f.for_staff_id])).toEqual([
        [0, 'recipient', null],
        [1, 'recipient', null],
      ]);
      expect(got.every((f) => f.card !== undefined && f.card.kind_label_key === 'alert.t_two_step.card')).toBe(true);
      expect(got[0]).toMatchObject({ kind: 't_two_step', family: 'info', escalation: false, raised_at: w.hub.clock.branchNow() });
    }
    expect(alertFrames(owner.ws).map((f) => [f.step, f.for_staff_id])).toEqual([
      [0, CASH],
      [0, WAIT],
    ]);
  });

  it('[01d §6 batch 3] device-target recipients (kiosk cashier socket, KDS station socket) get lock only, even when the cashier is also a person recipient', async () => {
    const w = await world(cleanups);
    const kiosk = device(w, 'kiosk', 'cashier_kiosk');
    const kds = device(w, 'kds', 'kds');
    const tab = device(w, 'tab', 'tablet');
    const cashKiosk = await staffSocket(w, CASH, kiosk);
    const cashTab = await staffSocket(w, CASH, tab);
    const kdsWs = await stationSocket(w, kds);
    const kioskAlert = await alertSocket(w, kiosk);
    // CASH is also a direct and a "for" person recipient: the kiosk socket still gets only the device-target lock
    seedAlert(w, { id: 'A_DEV', rows: [deviceRow(kiosk), deviceRow(kds), personRow(CASH), personRow(CASH, 'recipient', WAIT)] });
    await fence(w);

    for (const client of [cashKiosk.ws, kdsWs, kioskAlert]) {
      const got = alertFrames(client);
      expect(got).toHaveLength(1);
      expect(got[0]).not.toHaveProperty('card');
      expect(got[0]).toMatchObject({ alert_id: 'A_DEV', set: 'recipient', for_staff_id: null });
    }
    const own = alertFrames(cashTab.ws);
    expect(own.map((f) => f.for_staff_id)).toEqual([null, WAIT]);
    expect(own.every((f) => f.card !== undefined)).toBe(true);
  });

  it('[01d §6 batch 3] hidden_session_id / hidden_device_id: nothing to that session or any socket of that device; the same person on another device still gets it', async () => {
    const w = await world(cleanups);
    const seat = device(w, 'seat', 'tablet'); // the answering seat T (one active session per device)
    const other = device(w, 'other', 'tablet');
    const s1 = await staffSocket(w, CASH, seat);
    const s2 = await staffSocket(w, CASH, other);
    const seatAlert = await alertSocket(w, seat);
    const rows = [personRow(CASH), personRow(MGR), deviceRow(seat)];
    const routes = [{ staff_id: CASH, route: 'alert_connection', ref: seat }];
    seedAlert(w, { id: 'A_HID', rows, routes, hidden: { session_id: s1.sessionId, device_id: seat } });
    await fence(w);
    expect(alertFrames(s1.ws)).toEqual([]);
    expect(alertFrames(seatAlert)).toEqual([]);
    expect(alertFrames(s2.ws).map((f) => f.alert_id)).toEqual(['A_HID']);
    // the device part alone (another session id): still nothing to any socket of the seat
    seedAlert(w, { id: 'A_HID_DEV', rows, routes, hidden: { session_id: 'SESSION_ELSEWHERE', device_id: seat } });
    await fence(w);
    expect(alertFrames(s1.ws)).toEqual([]);
    expect(alertFrames(seatAlert)).toEqual([]);
    expect(alertFrames(s2.ws).map((f) => f.alert_id)).toEqual(['A_HID', 'A_HID_DEV']);

    // the device part is cleared at day close; the session part stays (§3.10, v1.0 R2)
    w.hub.deps.db.prepare('UPDATE alerts SET hidden_device_id = NULL WHERE alert_id = ?').run('A_HID');
    append(w, [stepEvent('A_HID', 1, rows, routes)]);
    await fence(w);
    expect(alertFrames(s1.ws)).toEqual([]);
    expect(alertFrames(seatAlert).map((f) => f.step)).toEqual([1]);
    expect(alertFrames(s2.ws).filter((f) => f.alert_id === 'A_HID').map((f) => f.step)).toEqual([0, 1]);
  });

  it('[01d §6 batch 3] alert_closed for 3 alerts closed in one transaction: one recipients read; every device in any step, every inbox person, devices bound to them, and (requests) every socket that may answer now', async () => {
    const w = await world(cleanups);
    const tab = device(w, 'tab', 'tablet');
    const mgrDev = device(w, 'mgr', 'tablet');
    const kds = device(w, 'kds', 'kds');
    const kiosk = device(w, 'kiosk', 'cashier_kiosk');
    const ownerDev = device(w, 'owner', 'tablet');
    const mgr2Dev = device(w, 'mgr2', 'tablet');
    const cashDev = device(w, 'cash', 'tablet');
    append(w, [aPresenceSet({ payload: { staff_ids: [MGR2], present: false, set_by: OWNER } })]);
    openSession(w.hub, { kind: 'staff', staffId: MGR, deviceId: tab }); // tab bound to MGR
    const tabAlert = await alertSocket(w, tab);
    const mgr = await staffSocket(w, MGR, mgrDev);
    const kdsWs = await stationSocket(w, kds);
    const kioskAlert = await alertSocket(w, kiosk);
    const owner = await staffSocket(w, OWNER, ownerDev);
    const cash = await staffSocket(w, CASH, cashDev);
    const waitDev = device(w, 'wait', 'tablet');
    const wait = await staffSocket(w, WAIT, waitDev); // the requester

    const request = raise(w, voidInput()); // step 0: MGR (MGR2 absent)
    // A: step 0 the KDS, step 1 the kiosk only (the KDS dropped); B: CASH at step 0, dropped by step 1
    seedAlert(w, { id: 'A_ONE', rows: [deviceRow(kds)] });
    append(w, [stepEvent('A_ONE', 1, [deviceRow(kiosk)])]);
    seedAlert(w, { id: 'A_TWO', kind: 't_two_step', rows: [personRow(CASH)] });
    append(w, [stepEvent('A_TWO', 1, [personRow(OWNER)])]);
    // MGR2 signs in after the raise: may answer now, never a recipient
    const mgr2 = await staffSocket(w, MGR2, mgr2Dev);
    await fence(w);
    const before = new Map(w.clients.map((c) => [c, framesOf(c).length]));

    w.hub.deps.writer.run((tx) => {
      const ctx = alerts.tickCtx(tx, w.hub.clock.branchNow());
      tx.append([...alerts.closeMany(ctx, [{ alert_id: 'A_ONE', reason: 'done' }, { alert_id: 'A_TWO', reason: 'obsolete' }])]);
      tx.append([asDraft(aRequestAnswered({ stream_type: 'order', stream_id: 'O1', payload: { alert_id: request, answerer_staff_id: MGR, decision: 'approve' } }))]);
    });
    expect(w.lastHookStatements()).toBe(1);
    await fence(w);

    const closedOf = (client: WsClient): Frame[] => framesOf(client).slice(before.get(client)).filter((f) => f.type === 'alert_closed');
    const ids = (client: WsClient): string[] => closedOf(client).map((f) => f.alert_id as string).sort();
    expect(ids(kdsWs)).toEqual(['A_ONE']); // a device of an earlier step
    expect(ids(kioskAlert)).toEqual(['A_ONE']);
    expect(ids(cash.ws)).toEqual(['A_TWO']); // dropped by step 1, still in alert_inbox
    expect(ids(owner.ws)).toEqual(['A_TWO']); // not an approver: no close of the request
    expect(ids(mgr.ws)).toEqual([request]);
    expect(ids(tabAlert)).toEqual([request]); // bound to MGR
    expect(ids(mgr2.ws)).toEqual([request]); // may answer now
    expect(ids(wait.ws)).toEqual([request]); // §6.2 step (10): the requester's sockets
    expect(closedOf(mgr.ws)[0]).toEqual({ type: 'alert_closed', alert_id: request, reason: 'answered', decision: 'approve', by_name: 'Manager' });
    expect(closedOf(kdsWs)[0]).toEqual({ type: 'alert_closed', alert_id: 'A_ONE', reason: 'done', decision: null, by_name: null });
    expect(closedOf(cash.ws)[0]).toEqual({ type: 'alert_closed', alert_id: 'A_TWO', reason: 'obsolete', decision: null, by_name: null });

    // every request close reaches the requester (proposed AD row): a withdrawn request
    const second = raise(w, voidInput({ dedupe_key: 'void:O1:L3' }));
    await fence(w);
    const mark = framesOf(wait.ws).length;
    append(w, [
      {
        ...anAlertClosed({ payload: { alert_id: second, reason: 'withdrawn', by_staff_id: WAIT } }),
        event_type: 'RequestWithdrawn',
        stream_type: 'order',
        stream_id: 'O1',
        payload: { alert_id: second, by_staff_id: WAIT },
      },
    ]);
    await fence(w);
    expect(framesOf(wait.ws).slice(mark)).toEqual([{ type: 'alert_closed', alert_id: second, reason: 'withdrawn', decision: null, by_name: null }]);
  });

  it('[01d §3.6] alert_seen reaches the person staff sockets and the alert-mode sockets of devices bound to them, nobody else', async () => {
    const w = await world(cleanups);
    const tab = device(w, 'tab', 'tablet');
    const mgrDev = device(w, 'mgr', 'tablet');
    const otherTab = device(w, 'other', 'tablet');
    const ownerDev = device(w, 'owner', 'tablet');
    openSession(w.hub, { kind: 'staff', staffId: MGR, deviceId: tab });
    openSession(w.hub, { kind: 'staff', staffId: OWNER, deviceId: otherTab });
    const tabAlert = await alertSocket(w, tab);
    const otherAlert = await alertSocket(w, otherTab);
    const mgr = await staffSocket(w, MGR, mgrDev);
    const owner = await staffSocket(w, OWNER, ownerDev);
    const id = raise(w, voidInput());
    await fence(w);
    const before = new Map(w.clients.map((c) => [c, framesOf(c).length]));

    w.hub.deps.writer.run((tx) => {
      tx.append([
        {
          stream_type: 'order',
          stream_id: 'O1',
          event_type: 'RequestSeen',
          schema_version: 1,
          payload: { alert_id: id, staff_id: MGR, device_id: mgrDev },
          occurred_at: w.hub.clock.branchNow(),
          actor_id: MGR,
          device_id: mgrDev,
        },
      ]);
    });
    expect(w.lastHookStatements()).toBe(1);
    await fence(w);
    const seen = (client: WsClient): Frame[] => framesOf(client).slice(before.get(client));
    expect(seen(mgr.ws)).toEqual([{ type: 'alert_seen', alert_id: id }]);
    expect(seen(tabAlert)).toEqual([{ type: 'alert_seen', alert_id: id }]);
    expect(seen(owner.ws)).toEqual([]);
    expect(seen(otherAlert)).toEqual([]);
  });

  it('[01d §7] a corrupt details_json fails that frame only: logged with alert id and error name, never the details text', async () => {
    const w = await world(cleanups);
    const mgrDev = device(w, 'mgr', 'tablet');
    const mgr = await staffSocket(w, MGR, mgrDev);
    const id = raise(w, voidInput());
    w.hub.deps.db.prepare('UPDATE alerts SET details_json = ? WHERE alert_id = ?').run('{"item":"Mutton platter","reason":"customer changed mind" broken', id);
    append(w, [{ ...stepEvent(id, 1, [personRow(MGR, 'answerer')]), stream_type: 'order', stream_id: 'O1' }]);
    await fence(w);
    expect(alertFrames(mgr.ws).map((f) => f.step)).toEqual([0]);
    const lines = w.hub.logs().split('\n').filter((l) => l.includes('alert frames failed'));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toMatchObject({ alert_id: id, kind: 't_approval', step: 1, frames: 'step', err: { name: 'SyntaxError' } });
    expectNoSecret(w.hub.logs());
  });

  it('[01d §6 batch 3] frames go only after commit: none on rollback, none before the commit', async () => {
    const w = await world(cleanups);
    const mgrDev = device(w, 'mgr', 'tablet');
    const mgr = await staffSocket(w, MGR, mgrDev);
    const hubWs = wsHubFor(w.hub.app);
    const toSessions = vi.spyOn(hubWs, 'sendToSessions');
    const toAlert = vi.spyOn(hubWs, 'sendToAlertMode');

    expect(() =>
      w.hub.deps.writer.run((tx) => {
        const result = alerts.raise(alerts.tickCtx(tx, w.hub.clock.branchNow()), voidInput());
        tx.append(result.events);
        throw new Error('rolled back');
      }),
    ).toThrow('rolled back');
    expect(toSessions).not.toHaveBeenCalled();
    expect(toAlert).not.toHaveBeenCalled();
    expect(w.hub.deps.db.prepare('SELECT COUNT(*) AS n FROM alerts').get()).toEqual({ n: 0 });

    let callsAtCommit = -1;
    w.hub.deps.writer.run((tx) => {
      const result = alerts.raise(alerts.tickCtx(tx, w.hub.clock.branchNow()), voidInput());
      tx.append(result.events);
      tx.onCommit(() => {
        callsAtCommit = toSessions.mock.calls.length;
      });
    });
    expect(callsAtCommit).toBe(0);
    expect(toSessions).toHaveBeenCalled();
    await fence(w);
    expect(alertFrames(mgr.ws)).toHaveLength(1);
  });

  it('[01d §3.8] a registered text route gets the lock view after commit; a short_code route is skipped for a kind without a short label; a throwing send is logged and the write stands', async () => {
    const w = await world(cleanups);
    const sent: Array<{ alert: AlertView; step: number; ref: string }> = [];
    registerRoute({
      route: 'probe',
      format: 'text',
      ack: false,
      receipts: [],
      routesFor: (tx, staffIds) => {
        tx.db.prepare('SELECT 1').get();
        return new Map(staffIds.filter((id) => id === MGR).map((id) => [id, [{ route_ref: 'probe:1' }]]));
      },
      send: (alert, step, ref) => {
        sent.push({ alert, step, ref });
        if (ref === 'probe:1' && sent.length > 1) throw new Error('route down');
      },
    });
    try {
      fakePager.refs.set(MGR, ['pager:5']);
      const id = raise(w, voidInput());
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ step: 0, ref: 'probe:1', alert: { alert_id: id, set: 'answerer' } });
      expect(sent[0]?.alert).not.toHaveProperty('card');
      expect(fakePager.sent).toEqual([]);

      // a second raise whose route send throws: committed, logged without details
      const second = raise(w, voidInput({ dedupe_key: 'void:O1:L9' }));
      expect(w.hub.deps.db.prepare('SELECT state FROM alerts WHERE alert_id = ?').get(second)).toEqual({ state: 'open' });
      expect(w.hub.logs()).toContain('route down');
      expectNoSecret(w.hub.logs());
    } finally {
      unregisterRoute('probe');
    }
  });
});
