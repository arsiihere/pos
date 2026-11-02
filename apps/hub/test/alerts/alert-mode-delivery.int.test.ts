import { ALERT_CONSTANTS } from '@pos/domain';
import type { DirectoryInput, EventDraft, PosEvent } from '@pos/events';
import { anAlertRaised, anAttemptSent, aPresenceSet } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAlertSockets } from '../../src/alerts/alert-sockets';
import { alerts, type RaiseInput } from '../../src/alerts/raise';
import { receiptBufferFor } from '../../src/alerts/receipts';
import { alertsTick } from '../../src/alerts/tick';
import { activity, endSession, revokeDevice, type SessionRow } from '../../src/auth/session-store';
import { wsHubFor } from '../../src/ws/server';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { FAKE_STEP_1_MS, registerFakes, resetFakes } from './fakes';

// 01d task 32: alert-mode delivery (§3.7 reconnect, revoke / rotation, header), §6 batch 3 `alerts_open`,
// BF-5 `binding_route_until` and the `binding_route` frame; tests #26, #28, #64, #65 (BF-3), #49's alerts_open part.
// Real WS clients against a test hub; DB assertions where possible, a fence frame instead of timed waits.

const ALI = 'S_CASH'; // "Ali": the person a tablet is bound to; lead S_MGR (directory below)
const BILAL = 'S_WAIT';
const MGR = 'S_MGR'; // approver of void-item, Ali's lead
const OWNER = 'S_OWNER';

const DETAILS = { item: 'Mutton platter', quantity: 1, amount: 480_000, reason: 'customer changed mind' };
const SECRET_VALUES = ['Mutton platter', '480000', 'customer changed mind'];
const IDLE = ALERT_CONSTANTS.binding_route_idle_ms;

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
  const staff = base.staff.map((s) => (s.staff_id === ALI ? { ...s, lead_staff_id: MGR } : s));
  return { ...base, roles, staff };
}

type DeviceKind = 'tablet' | 'cashier_kiosk' | 'kds' | 'phone';
type Frame = { type: string; alert_id?: string } & Record<string, unknown>;

describe('01d alert-mode delivery (task 32)', () => {
  let hub: TestHub;
  const clients: WsClient[] = [];
  const devices = new Map<string, string>(); // device id → token

  beforeEach(async () => {
    hub = await createTestHub();
    registerFakes();
    await seedDirectory(hub, await directory());
    cleanFlags();
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    devices.clear();
    resetFakes();
    activity.drain();
    activity.drainDevices();
    await hub.close();
  });

  /** A SessionStarted / SessionEnded marks no_approver dirty (task 31's pass); these tests do not test it. */
  function cleanFlags(): void {
    hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();
  }

  function device(type: DeviceKind, name: string): string {
    const d = pairDevice(hub, { type, name, stationId: type === 'kds' ? 'station-1' : undefined });
    devices.set(d.deviceId, d.token);
    return d.deviceId;
  }

  function token(deviceId: string): string {
    const t = devices.get(deviceId);
    if (t === undefined) throw new Error(`unknown device ${deviceId}`);
    return t;
  }

  function signIn(staffId: string, deviceId: string): string {
    const s = openSession(hub, { kind: 'staff', staffId, deviceId });
    cleanFlags();
    return s.sessionId;
  }

  function signOut(sessionId: string, reason: 'logout' | 'idle_timeout'): void {
    const row = hub.deps.db.prepare('SELECT * FROM staff_sessions WHERE session_id = ?').get(sessionId) as SessionRow;
    hub.deps.writer.run((tx) => endSession(tx, row, reason, null, null, 'hub'));
    cleanFlags();
  }

  async function alertSocket(deviceId: string): Promise<WsClient> {
    const ws = await connectWs(hub.app);
    ws.send({ type: 'auth', device_token: token(deviceId) });
    await ws.untilCount(1);
    expect(ws.messages[0]).toMatchObject({ type: 'alerts_open' });
    clients.push(ws);
    return ws;
  }

  async function staffSocket(staffId: string, deviceId: string): Promise<WsClient> {
    const session = openSession(hub, { kind: 'staff', staffId, deviceId });
    cleanFlags();
    const ws = await connectWs(hub.app);
    ws.send({ type: 'auth', device_token: token(deviceId), session_token: session.token });
    await ws.untilCount(1);
    expect(ws.messages[0]).toMatchObject({ type: 'catch_up' });
    clients.push(ws);
    return ws;
  }

  let fenceNo = 0;
  /** Every frame sent before this call has reached every open client (per-socket order). */
  async function fence(): Promise<void> {
    fenceNo += 1;
    const id = `FENCE_${fenceNo}`;
    wsHubFor(hub.app).sendToDevices([...devices.keys()], { type: 'alert_seen', alert_id: id });
    for (const client of clients) {
      // a socket the hub closed (replaced 4409, 4401, 4403) never gets the fence
      const closed = await client.untilClose(1).then(
        () => true,
        () => false,
      );
      if (closed) continue;
      for (let i = 0; i < 50 && !client.messages.some((m) => (m as Frame).alert_id === id); i += 1) {
        await client.untilCount(client.messages.length + 1);
      }
    }
  }

  const frames = (client: WsClient, type: string): Frame[] =>
    (client.messages as Frame[]).filter((m) => m.type === type && !(m.alert_id ?? '').startsWith('FENCE_'));

  const openOf = (client: WsClient): { alerts: Array<Record<string, unknown>>; binding_route_until: number | null } =>
    client.messages[0] as { alerts: Array<Record<string, unknown>>; binding_route_until: number | null };

  function raise(input: RaiseInput): string {
    return hub.deps.writer.run((tx) => {
      const result = alerts.raise(alerts.tickCtx(tx, hub.clock.branchNow()), input);
      tx.append(result.events);
      return result.alert_id;
    }).result;
  }

  function tick(): void {
    hub.deps.writer.run((tx) => tx.append(alertsTick.intents(tx, hub.deps.state.get(), hub.clock.branchNow())));
  }

  function append(events: PosEvent[]): void {
    hub.deps.writer.run((tx) => {
      tx.append(events.map((e): EventDraft => ({
        stream_type: e.stream_type,
        stream_id: e.stream_id,
        event_type: e.event_type,
        schema_version: e.schema_version,
        payload: e.payload,
        occurred_at: e.occurred_at,
        actor_id: e.actor_id,
        device_id: e.device_id,
      })));
    });
  }

  const display = { kind_label_key: 'alert.t.lock', table_code: '12', requester_name: 'Order taker' };
  const toPerson = (n: number, staffId: string, kind = 't_two_step', family?: string): RaiseInput => ({
    kind,
    subject: { stream_type: kind === 't_action' ? 'table' : 'hub', stream_id: kind === 't_action' ? 'T12' : 'branch-1' },
    target: { kind: 'person', staff_id: staffId },
    display,
    dedupe_key: `p:${n}:${family ?? ''}`,
  });
  const toDevice = (n: number, deviceId: string): RaiseInput => ({
    kind: 't_info',
    subject: { stream_type: 'hub', stream_id: 'branch-1' },
    target: { kind: 'device', device_id: deviceId },
    display,
    dedupe_key: `d:${n}`,
  });
  const voidInput = (): RaiseInput => ({
    kind: 't_approval',
    subject: { stream_type: 'order', stream_id: 'O1' },
    target: { kind: 'answerers' },
    values: { order_id: 'O1' },
    display,
    details: DETAILS,
    dedupe_key: 'void:O1:L1',
    requester_staff_id: BILAL,
    request: { approver_role_ids: ['R_MGR'] },
  });

  /** A builder-seeded urgent alert for one person (inbox) or device, optionally hidden from a device. */
  function seedUrgent(o: { id: string; staffId?: string; deviceId?: string; hiddenDevice?: string }): void {
    append([
      anAlertRaised({
        payload: {
          alert_id: o.id,
          kind: 't_two_step',
          family: 'urgent',
          dedupe_key: `seed:${o.id}`,
          display,
          hidden_from: o.hiddenDevice === undefined ? null : { session_id: 'SESSION_ELSEWHERE', device_id: o.hiddenDevice },
        },
      }),
      anAttemptSent({
        payload: {
          alert_id: o.id,
          step: 0,
          recipients: [{ staff_id: o.staffId ?? null, device_id: o.deviceId ?? null, for_staff_id: null, set: 'recipient' }],
          routes: [],
        },
      }),
    ]);
  }

  const ids = (client: WsClient): string[] => openOf(client).alerts.map((a) => String(a.alert_id));

  function expectNoSecret(text: string): void {
    for (const value of SECRET_VALUES) expect(text).not.toContain(value);
    for (const key of ['"details"', '"card"', '"answers"', '"needs_pin"', '"silent"']) expect(text).not.toContain(key);
  }

  // ---------------------------------------------------------------------------------------------- #26

  it('[01d #26] alert-mode auth with a device token only → alerts_open, then alert frames with lock only; a non-receipt frame closes 4401; revoke 4403; rotation 4401', async () => {
    const tab = device('tablet', 'tab');
    const before = raise(toDevice(1, tab)); // open before the socket: replayed by alerts_open
    const ws = await alertSocket(tab);
    const open = openOf(ws);
    expect(open).toEqual({
      type: 'alerts_open',
      alerts: [
        {
          alert_id: before,
          kind: 't_info',
          family: 'info',
          step: 0,
          lock: { kind_label_key: 'alert.t_info.lock', table_code: '12', point_code: null, requester_name: 'Order taker' },
          raised_at: hub.clock.branchNow(),
          seen_by_me: false, // §8.3 (task 34): a device-target row with no person
        },
      ],
      binding_route_until: null,
    });
    const after = raise(toDevice(2, tab));
    await fence();
    const got = frames(ws, 'alert');
    expect(got.map((f) => (f.alert as { alert_id: string }).alert_id)).toEqual([after]);
    expect(got[0]?.alert).not.toHaveProperty('card');
    expect((got[0]?.alert as { lock: unknown }).lock).toEqual(open.alerts[0]?.lock);

    ws.send({ type: 'ack', last_seq: 1 });
    expect((await ws.untilClose()).code).toBe(4401);

    const revoked = device('tablet', 'revoked');
    const rotated = device('tablet', 'rotated');
    const wsRevoked = await alertSocket(revoked);
    const wsRotated = await alertSocket(rotated);
    hub.deps.writer.run((tx) => {
      revokeDevice(tx, revoked, { reason: null, cause: 'manual', actorId: MGR, eventDeviceId: 'hub-admin', revokedBy: MGR });
    });
    expect((await wsRevoked.untilClose()).code).toBe(4403);
    hub.deps.writer.run((tx) => {
      tx.append([
        {
          stream_type: 'hub',
          stream_id: rotated,
          event_type: 'DeviceTokenRotated',
          schema_version: 1,
          payload: { device_id: rotated, pair_request_id: 'PR_1' },
          occurred_at: hub.clock.branchNow(),
          actor_id: MGR,
          device_id: rotated,
        },
      ]);
    });
    expect((await wsRotated.untilClose()).code).toBe(4401);
    expect(wsHubFor(hub.app).alertSockets()).toEqual([]);
  });

  // ---------------------------------------------------------------------------------------------- #28

  it('[01d #28] a session-less tablet bound to Ali receives Ali\'s alert; signed-in Bilal on another tablet does not', async () => {
    const t = device('tablet', 't');
    const u = device('tablet', 'u');
    signOut(signIn(ALI, t), 'idle_timeout'); // the binding stays (§3.7), no session on T
    const tWs = await alertSocket(t);
    const bilal = await staffSocket(BILAL, u);
    const id = raise(toPerson(1, ALI));
    await fence();
    expect(frames(tWs, 'alert').map((f) => (f.alert as { alert_id: string }).alert_id)).toEqual([id]);
    expect(frames(bilal, 'alert')).toEqual([]);
    // and T's reconnect replays it (the bound person's part, the binding is a route)
    const again = await alertSocket(t);
    expect(ids(again)).toEqual([id]);
  });

  // ---------------------------------------------------------------------------------------------- #64

  it('[01d #64] T bound to Ali with an open urgent alert for Ali: Ali absent, or Ali\'s last activity > 2 h ago → T\'s reconnect alerts_open has no Ali alert; a device-target alert on T is still listed', async () => {
    const t = device('tablet', 't');
    const t0 = hub.clock.branchNow();
    signOut(signIn(ALI, t), 'idle_timeout');
    seedUrgent({ id: 'A_ALI', staffId: ALI });
    seedUrgent({ id: 'A_DEV', deviceId: t });
    const present = await alertSocket(t);
    expect(ids(present).sort()).toEqual(['A_ALI', 'A_DEV']);
    expect(openOf(present).binding_route_until).toBe(t0 + IDLE);

    append([aPresenceSet({ payload: { staff_ids: [ALI], present: false, set_by: OWNER } })]);
    const absent = await alertSocket(t);
    expect(ids(absent)).toEqual(['A_DEV']);
    // BF-5 / task 17 carry: no "pauses at HH:MM" for a binding that is not a route
    expect(openOf(absent).binding_route_until).toBeNull();

    append([aPresenceSet({ payload: { staff_ids: [ALI], present: true, set_by: OWNER } })]);
    hub.clock.set(t0 + IDLE); // exactly 2 h: still a route
    expect(ids(await alertSocket(t)).sort()).toEqual(['A_ALI', 'A_DEV']);
    hub.clock.set(t0 + IDLE + 1); // > 2 h: the shelf tablet no longer replays Ali's alerts
    const idle = await alertSocket(t);
    expect(ids(idle)).toEqual(['A_DEV']);
    expect(openOf(idle).binding_route_until).toBeNull();
  });

  // ---------------------------------------------------------------------------------------------- #65

  it('[01d #65] a kiosk binds no one: after a cashier signs in and out it is never the cashier\'s route (an action alert goes "for" to the lead); /app/android/latest → 403; BF-3: no binding row, a signed-out kiosk\'s receipt has staff_id \'\'', async () => {
    const kiosk = device('cashier_kiosk', 'kiosk');
    const mgrTab = device('tablet', 'mgr');
    const signedIn = signIn(ALI, kiosk);
    expect(hub.deps.db.prepare('SELECT COUNT(*) AS n FROM device_bindings WHERE device_id = ?').get(kiosk)).toEqual({ n: 0 });
    signOut(signedIn, 'logout');
    const kWs = await alertSocket(kiosk);
    expect(openOf(kWs)).toEqual({ type: 'alerts_open', alerts: [], binding_route_until: null });
    await staffSocket(MGR, mgrTab);

    const action = raise(toPerson(1, ALI, 't_action'));
    const step = hub.deps.db
      .prepare(`SELECT payload FROM events WHERE event_type = 'AttemptSent' AND json_extract(payload, '$.alert_id') = ?`)
      .get(action) as { payload: string };
    const p = JSON.parse(step.payload) as { recipients: Array<Record<string, unknown>>; routes: Array<{ ref: string }> };
    expect(p.recipients).toEqual([{ staff_id: MGR, device_id: null, for_staff_id: ALI, set: 'recipient' }]);
    expect(p.routes.map((r) => r.ref)).not.toContain(kiosk);
    await fence();
    expect(frames(kWs, 'alert')).toEqual([]);
    // the kiosk's reconnect does not list the cashier's alert either (§3.7 table: never adds the person's alerts)
    expect(ids(await alertSocket(kiosk))).toEqual([]);

    const res = await hub.app.inject({ method: 'GET', url: '/app/android/latest', headers: { authorization: `Bearer ${token(kiosk)}` } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('DEVICE_TYPE_NOT_ALLOWED');

    // BF-3: a device-target alert on the signed-out kiosk, its alert-mode receipt → staff_id ''
    const dev = raise(toDevice(2, kiosk));
    const kWs2 = await alertSocket(kiosk);
    expect(ids(kWs2)).toEqual([dev]);
    kWs2.send({ type: 'receipt', alert_id: dev, kind: 'delivered', step: 0 });
    await fence();
    receiptBufferFor(hub.app).flush();
    expect(hub.deps.db.prepare('SELECT staff_id, device_id, kind, step FROM alert_receipts WHERE alert_id = ?').all(dev)).toEqual([
      { staff_id: '', device_id: kiosk, kind: 'delivered', step: 0 },
    ]);
  });

  // ---------------------------------------------------------------------------------------------- §3.7

  it('[01d §3.7] alerts_open takes ≤ 3 statements (alerts, presence, activity), 1 for an unbound device, the same for 1 and 20 open alerts', async () => {
    const t = device('tablet', 't');
    const kiosk = device('cashier_kiosk', 'kiosk');
    signOut(signIn(ALI, t), 'idle_timeout');
    raise(toPerson(1, ALI));
    raise(toDevice(1, kiosk));
    const sockets = createAlertSockets({
      db: hub.deps.db,
      branchId: 'branch-1',
      clock: hub.clock,
      ws: () => wsHubFor(hub.app),
      recordSent: () => undefined,
      log: { error: () => undefined },
    });
    const counter = statementCounter(hub.deps.db);
    counter.reset();
    expect(sockets.alertsOpen(t).alerts).toHaveLength(1);
    expect(counter.count).toBeLessThanOrEqual(3);
    const one = counter.count;
    for (let n = 2; n <= 20; n += 1) raise(toPerson(n, ALI));
    counter.reset();
    expect(sockets.alertsOpen(t).alerts).toHaveLength(20);
    expect(counter.count).toBe(one);
    counter.reset();
    expect(sockets.alertsOpen(kiosk).alerts).toHaveLength(1);
    expect(counter.count).toBe(1);
  });

  it('[01d §3.7] alerts_open never lists an alert hidden from the device; the same person on another device still gets it', async () => {
    const t = device('tablet', 't');
    const u = device('tablet', 'u');
    signOut(signIn(ALI, t), 'idle_timeout');
    signOut(signIn(ALI, u), 'idle_timeout');
    seedUrgent({ id: 'A_HID', staffId: ALI, hiddenDevice: t });
    seedUrgent({ id: 'A_HID_DEV', deviceId: t, hiddenDevice: t });
    seedUrgent({ id: 'A_OK', staffId: ALI });
    expect(ids(await alertSocket(t))).toEqual(['A_OK']);
    expect(ids(await alertSocket(u)).sort()).toEqual(['A_HID', 'A_OK']);
  });

  it('[01d §3.7] a receipt for an alerts_open row is accepted (sent through alerts_open) with the bound person', async () => {
    const t = device('tablet', 't');
    signOut(signIn(ALI, t), 'idle_timeout');
    const id = raise(toPerson(1, ALI));
    const ws = await alertSocket(t);
    expect(ids(ws)).toEqual([id]);
    ws.send({ type: 'receipt', alert_id: id, kind: 'delivered', step: 0 });
    await fence();
    receiptBufferFor(hub.app).flush();
    expect(hub.deps.db.prepare('SELECT staff_id, device_id FROM alert_receipts WHERE alert_id = ?').all(id)).toEqual([{ staff_id: ALI, device_id: t }]);
  });

  // ---------------------------------------------------------------------------------------------- #49

  it('[01d #49] alerts_open with real rows: a t_approval with details replayed to the approver\'s bound tablet carries no details, card or amount anywhere; logs carry none', async () => {
    const t = device('tablet', 't');
    const kds = device('kds', 'kds');
    signOut(signIn(MGR, t), 'idle_timeout');
    await alertSocket(t); // the approver has a route (no G1-9d shortcut): step 0 to MGR
    const id = raise(voidInput());
    seedUrgent({ id: 'A_KDS', deviceId: kds });
    const ws = await alertSocket(t);
    expect(ids(ws)).toEqual([id]);
    expect(openOf(ws).alerts[0]).toEqual({
      alert_id: id,
      kind: 't_approval',
      family: 'urgent',
      step: 0,
      lock: { kind_label_key: 'alert.t_approval.lock', table_code: '12', point_code: null, requester_name: 'Order taker' },
      raised_at: hub.clock.branchNow(),
      seen_by_me: false, // §8.3 (task 34): the bound approver has not seen it
    });
    const kWs = await alertSocket(kds);
    expect(ids(kWs)).toEqual(['A_KDS']);
    for (const client of [ws, kWs]) expectNoSecret(JSON.stringify(client.messages[0]));
    expectNoSecret(hub.logs());
  });

  it('[01d §3.4.3 (c)] only staff sessions of this branch count as activity: a fresh admin session does not keep a > 2 h tablet binding a route; routing and the header agree', async () => {
    const t = device('tablet', 't');
    const adminDev = device('tablet', 'admin');
    const t0 = hub.clock.branchNow();
    signOut(signIn(MGR, t), 'idle_timeout'); // MGR's last staff activity: t0
    hub.clock.set(t0 + IDLE + 1_000);
    openSession(hub, { kind: 'admin', staffId: MGR, deviceId: adminDev }); // fresh, but not a staff session
    cleanFlags();
    const tWs = await alertSocket(t);
    expect(openOf(tWs).binding_route_until).toBeNull();

    const id = raise(toPerson(1, MGR));
    const step = hub.deps.db
      .prepare(`SELECT payload FROM events WHERE event_type = 'AttemptSent' AND json_extract(payload, '$.alert_id') = ?`)
      .get(id) as { payload: string };
    const routes = (JSON.parse(step.payload) as { routes: Array<{ route: string; ref: string }> }).routes;
    expect(routes.filter((r) => r.route === 'alert_connection').map((r) => r.ref)).not.toContain(t);
    await fence();
    expect(frames(tWs, 'alert')).toEqual([]);
    expect(frames(tWs, 'binding_route')).toEqual([]);
    const again = await alertSocket(t);
    expect(ids(again)).toEqual([]);
    expect(openOf(again).binding_route_until).toBeNull();
  });

  // ---------------------------------------------------------------------------------------------- BF-5

  it('[01d BF-5] binding_route_until = Ali\'s last activity + 2 h on a bound tablet, null on a kiosk; a sign-in elsewhere that moves it sends binding_route on the next tick that routes to T, once', async () => {
    const t = device('tablet', 't');
    const u = device('tablet', 'u');
    const kiosk = device('cashier_kiosk', 'kiosk');
    const t0 = hub.clock.branchNow();
    signOut(signIn(ALI, t), 'idle_timeout');
    signOut(signIn(ALI, kiosk), 'logout');
    const tWs = await alertSocket(t);
    expect(openOf(tWs).binding_route_until).toBe(t0 + IDLE);
    expect(openOf(await alertSocket(kiosk)).binding_route_until).toBeNull();

    raise(toPerson(1, ALI)); // routes to T; the deadline is unchanged → no frame
    await fence();
    expect(frames(tWs, 'alert')).toHaveLength(1);
    expect(frames(tWs, 'binding_route')).toEqual([]);

    hub.clock.set(t0 + 30_000);
    const elsewhere = signIn(ALI, u); // the deadline moves; no tick has routed to T yet
    activity.touch(elsewhere, t0 + 45_000); // in-memory activity of the active session is newer (§3.4.3 (c))
    await fence();
    expect(frames(tWs, 'binding_route')).toEqual([]);

    hub.clock.set(t0 + FAKE_STEP_1_MS);
    tick(); // step 1 of alert 1 routes to T
    await fence();
    expect(frames(tWs, 'alert').map((f) => (f.alert as { step: number }).step)).toEqual([0, 1]);
    expect(frames(tWs, 'binding_route')).toEqual([{ type: 'binding_route', until: t0 + 45_000 + IDLE }]);

    raise(toPerson(2, ALI)); // routes to T again, same deadline → nothing new
    hub.clock.set(t0 + 2 * FAKE_STEP_1_MS);
    tick();
    await fence();
    expect(frames(tWs, 'alert')).toHaveLength(4);
    expect(frames(tWs, 'binding_route')).toHaveLength(1);
    expectNoSecret(JSON.stringify(tWs.messages));
  });
});
