import type { DirectoryInput, EventDraft, PosEvent } from '@pos/events';
import { aDevicePaired, aPresenceSet } from '@pos/events/testing';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alerts, type RaiseInput } from '../../src/alerts/raise';
import { receiptBufferFor } from '../../src/alerts/receipts';
import { alertsTick } from '../../src/alerts/tick';
import { activity, endSession, type SessionRow } from '../../src/auth/session-store';
import { sweepOnce } from '../../src/auth/session-sweeper';
import { wsHubFor } from '../../src/ws/server';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { FAKE_STEP_1_MS, registerFakes, resetFakes } from './fakes';

// 01d task 36: `GET /queries/alert-receipts?alert_id=` (§6.10): per step, the recipients from
// `alert_recipients` (a person with no route listed "no route", §3.4.3; a lead's "for" row carries
// `for_staff_id`, AD-106), the routes from the step events of the subject stream read from the alert's
// `raised_seq` on (v0.5 m12), and delivered (per step) / seen per person and device from `alert_receipts`,
// each naming the device and, for an alert-connection receipt, the person it is bound to. 4 statements;
// `manage-devices` required. Tests #46, #57 (hub: all but (vi), the client header), #62 and Review Focus 5.
// Real WS clients and HTTP injects against a test hub; the hub clock is moved by hand (no Date.now()).

const OWNER = 'S_OWNER'; // "Owner": R_OWNER (every permission, branch scope); MGR's lead
const MGR = 'S_MGR'; // "Manager": R_MGR (manage-devices, approve-void, managers); lead of CASH and ALI
const MGR2 = 'S_MGR2'; // "Manager two": R_MGR, on leave (no device) — #62 only
const CASH = 'S_CASH'; // "Cashier": no manage-devices
const ALI = 'S_WAIT'; // "Order taker" (Ali): the person a tablet is bound to; lead MGR; 5 min idle TTL
const TENANT = 'tenant-a';
const BRANCH = 'branch-1';
const MIN = 60_000;
const DETAILS = { item: 'Mutton platter', quantity: 1, amount: 480_000, reason: 'customer changed mind' };

async function directory(o: { withMgr2?: boolean } = {}): Promise<DirectoryInput> {
  const base = await aDirectory();
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
  const lead: Record<string, string> = { [CASH]: MGR, [ALI]: MGR, [MGR]: OWNER };
  const staff = base.staff.map((s) => (lead[s.staff_id] === undefined ? s : { ...s, lead_staff_id: lead[s.staff_id] ?? null }));
  const mgr = staff.find((s) => s.staff_id === MGR);
  if (mgr === undefined) throw new Error('fixture has no S_MGR');
  if (o.withMgr2 === true) staff.push({ ...mgr, staff_id: MGR2, display_name: 'Manager two', lead_staff_id: null });
  return { ...base, roles, staff };
}

interface Seat {
  staffId: string;
  deviceId: string;
  deviceToken: string;
  sessionId: string;
  sessionToken: string;
}

interface Recipient {
  staff_id: string | null;
  staff_name: string | null;
  device_id: string | null;
  device_name: string | null;
  for_staff_id: string | null;
  for_staff_name: string | null;
  set: string;
  no_route: boolean;
}
interface Route {
  staff_id: string | null;
  route: string;
  ref: string;
}
interface Step {
  step: number;
  recipients: Recipient[];
  routes: Route[];
}
interface Receipt {
  kind: 'delivered' | 'seen';
  step: number | null;
  staff_id: string | null;
  staff_name: string | null;
  device_id: string;
  device_name: string | null;
  route: string;
  at: number;
}
interface View {
  alert_id: string;
  kind: string;
  steps: Step[];
  receipts: Receipt[];
}

const person = (staff_id: string, staff_name: string, o: Partial<Recipient> = {}): Recipient => ({
  staff_id,
  staff_name,
  device_id: null,
  device_name: null,
  for_staff_id: null,
  for_staff_name: null,
  set: 'recipient',
  no_route: false,
  ...o,
});
const bySeat = (a: Recipient, b: Recipient): number => `${a.staff_id ?? ''}|${a.device_id ?? ''}|${a.for_staff_id ?? ''}`.localeCompare(`${b.staff_id ?? ''}|${b.device_id ?? ''}|${b.for_staff_id ?? ''}`);
const sorted = (rows: Recipient[]): Recipient[] => [...rows].sort(bySeat);

type Frame = { type: string; alert_id?: string; alert?: { alert_id: string; step: number } } & Record<string, unknown>;

describe('01d alert-receipts (task 36)', () => {
  let hub: TestHub;
  const clients: WsClient[] = [];
  const tokens = new Map<string, string>(); // device id → token
  let receiptsSeen = 0;
  let commandNo = 0;

  async function start(o: { withMgr2?: boolean } = {}): Promise<void> {
    hub = await createTestHub();
    registerFakes();
    await seedDirectory(hub, await directory(o));
    cleanFlags();
    wsHubFor(hub.app).onReceipt(() => {
      receiptsSeen += 1;
    });
  }

  beforeEach(() => {
    receiptsSeen = 0;
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    tokens.clear();
    vi.restoreAllMocks();
    resetFakes();
    activity.drain();
    activity.drainDevices();
    await hub.close();
  });

  /** A SessionStarted / SessionEnded marks no_approver dirty (task 31's pass); these tests do not test it. */
  function cleanFlags(): void {
    hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();
  }

  const at = (base: number, minutes: number): number => base + minutes * MIN;

  function device(type: 'tablet' | 'phone' | 'cashier_kiosk', name: string, ownerStaffId?: string): string {
    const d = pairDevice(hub, { type, name, ownerStaffId });
    tokens.set(d.deviceId, d.token);
    return d.deviceId;
  }

  function token(deviceId: string): string {
    const t = tokens.get(deviceId);
    if (t === undefined) throw new Error(`unknown device ${deviceId}`);
    return t;
  }

  function signIn(staffId: string, deviceId: string): Seat {
    const s = openSession(hub, { kind: 'staff', staffId, deviceId });
    cleanFlags();
    return { staffId, deviceId, deviceToken: token(deviceId), sessionId: s.sessionId, sessionToken: s.token };
  }

  function signOut(sessionId: string, reason: 'logout' | 'idle_timeout'): void {
    const row = hub.deps.db.prepare('SELECT * FROM staff_sessions WHERE session_id = ?').get(sessionId) as SessionRow;
    hub.deps.writer.run((tx) => endSession(tx, row, reason, null, null, 'hub'));
    cleanFlags();
  }

  /** A fresh reader session on its own tablet (never connected, so never a route), for HTTP queries. */
  function reader(staffId: string): Seat {
    return signIn(staffId, device('tablet', `Reader ${staffId}`));
  }

  async function alertSocket(deviceId: string): Promise<WsClient> {
    const ws = await connectWs(hub.app);
    ws.send({ type: 'auth', device_token: token(deviceId) });
    await ws.untilCount(1);
    expect(ws.messages[0]).toMatchObject({ type: 'alerts_open' });
    clients.push(ws);
    return ws;
  }

  async function staffSocket(s: Seat): Promise<WsClient> {
    const ws = await connectWs(hub.app);
    ws.send({ type: 'auth', device_token: s.deviceToken, session_token: s.sessionToken });
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
    wsHubFor(hub.app).sendToDevices([...tokens.keys()], { type: 'alert_seen', alert_id: id });
    for (const client of clients) {
      for (let i = 0; i < 50 && !client.messages.some((m) => (m as Frame).alert_id === id); i += 1) {
        await client.untilCount(client.messages.length + 1);
      }
    }
  }

  const alertFrames = (client: WsClient): Array<{ alert_id: string; step: number }> =>
    (client.messages as Frame[]).filter((m) => m.type === 'alert').map((m) => ({ alert_id: m.alert?.alert_id ?? '', step: m.alert?.step ?? -1 }));

  /** Sends delivered receipts and waits (setImmediate turns, no timer) until the hub has handed them over. */
  async function deliver(ws: WsClient, alertId: string, step: number): Promise<void> {
    const before = receiptsSeen;
    ws.send({ type: 'receipt', alert_id: alertId, kind: 'delivered', step });
    for (let i = 0; i < 2_000 && receiptsSeen === before; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
    expect(receiptsSeen).toBe(before + 1);
  }

  function flush(): void {
    receiptBufferFor(hub.app).flush();
  }

  function raise(input: RaiseInput, alertId?: string): string {
    return hub.deps.writer.run((tx) => {
      if (alertId !== undefined) vi.spyOn(tx.ids, 'next').mockReturnValueOnce(alertId);
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
      tx.append(
        events.map(
          (e): EventDraft => ({
            stream_type: e.stream_type,
            stream_id: e.stream_id,
            event_type: e.event_type,
            schema_version: e.schema_version,
            payload: e.payload,
            occurred_at: e.occurred_at,
            actor_id: e.actor_id,
            device_id: e.device_id,
          }),
        ),
      );
    });
  }

  function post(s: Seat, path: string, type: string, payload: Record<string, unknown>) {
    commandNo += 1;
    return hub.app.inject({
      method: 'POST',
      url: `/commands/${path}`,
      headers: { authorization: `Bearer ${s.deviceToken}`, 'x-session-token': s.sessionToken },
      payload: {
        command_id: `cmd-${commandNo}`,
        tenant_id: TENANT,
        branch_id: BRANCH,
        command_type: type,
        payload,
        occurred_at: hub.clock.branchNow(),
        actor_id: s.staffId,
        device_id: s.deviceId,
      },
    });
  }

  function receiptsQuery(s: Seat, alertId?: string) {
    return hub.app.inject({
      method: 'GET',
      url: alertId === undefined ? '/queries/alert-receipts' : `/queries/alert-receipts?alert_id=${encodeURIComponent(alertId)}`,
      headers: { authorization: `Bearer ${s.deviceToken}`, 'x-session-token': s.sessionToken },
    });
  }

  async function view(alertId: string, by: Seat = reader(MGR)): Promise<View> {
    const response = await receiptsQuery(by, alertId);
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { data: View }).data;
  }

  const display = { kind_label_key: 'alert.t.lock', table_code: '12', requester_name: 'Order taker' };
  let dedupe = 0;
  const actionTo = (staffId: string): RaiseInput => ({
    kind: 't_action',
    subject: { stream_type: 'table', stream_id: 'T12' },
    target: { kind: 'person', staff_id: staffId },
    display,
    dedupe_key: `action:${(dedupe += 1)}`,
  });
  const twoStepTo = (target: RaiseInput['target']): RaiseInput => ({
    kind: 't_two_step',
    subject: { stream_type: 'hub', stream_id: BRANCH },
    target,
    display,
    dedupe_key: `two:${(dedupe += 1)}`,
  });

  /**
   * A signed-in person's routes on their own connected tablet: the screen (session socket) and the binding
   * that sign-in set, which is a route while the tablet is connected (§3.4.3 (a): a session socket counts).
   */
  const ownTablet = (staffId: string, tab: string): Route[] => [
    { staff_id: staffId, route: 'screen', ref: tab },
    { staff_id: staffId, route: 'alert_connection', ref: tab },
  ];

  /** "For Ali on the lead" (§3.4.3 "For" rows, AD-106): the lead's row only, the lead's routes. */
  function expectForAli(v: View, mgrTab: string): void {
    expect(v.steps).toHaveLength(1);
    expect(v.steps[0]?.recipients).toEqual([person(MGR, 'Manager', { for_staff_id: ALI, for_staff_name: 'Order taker' })]);
    expect(v.steps[0]?.routes).toEqual(ownTablet(MGR, mgrTab));
  }

  /** Ali's own row, routed through the binding of T (§3.4.3 alert connection). */
  function expectOnT(v: View, t: string): void {
    expect(v.steps).toHaveLength(1);
    expect(v.steps[0]?.recipients).toEqual([person(ALI, 'Order taker')]);
    expect(v.steps[0]?.routes).toEqual([{ staff_id: ALI, route: 'alert_connection', ref: t }]);
  }

  // ---------------------------------------------------------------------------------------------- #46

  it('[01d #46] a two-step alert to a team: per-step recipients from alert_recipients, routes from the step events read from raised_seq (50 older hub-stream events not read), delivered per step / seen per device; a person with no route listed "no route"; 4 statements', async () => {
    await start();
    const ALERT = '01JRECEIPTS00000000000046AA';
    const aliTab = device('tablet', 'Tablet 3');
    const ali = signIn(ALI, aliTab);
    const aliWs = await staffSocket(ali); // Ali: screen route on Tablet 3; Cashier: no device, nobody to fall back to

    // 50 older events on the same hub stream that name this alert id (so only the seq bound keeps them out)
    hub.deps.writer.run((tx) => {
      tx.append(
        Array.from({ length: 50 }, (_, i) => ({
          stream_type: 'hub' as const,
          stream_id: BRANCH,
          event_type: i % 2 === 0 ? 'AttemptSent' : 'EscalationStepped',
          schema_version: 1,
          payload: { alert_id: ALERT, step: i % 2, recipients: [], routes: [{ staff_id: 'S_OLD', route: 'screen', ref: `OLD-${i}` }] },
          occurred_at: hub.clock.branchNow(),
          actor_id: null,
          device_id: 'hub',
        })),
      );
    });

    const t0 = hub.clock.branchNow();
    expect(raise(twoStepTo({ kind: 'team', lead_staff_id: MGR, depth: 'direct' }), ALERT)).toBe(ALERT);
    hub.clock.set(t0 + 1_000);
    await deliver(aliWs, ALERT, 0);
    flush(); // alert_receipts.at is the event's recorded_at (the flush), so each receipt is flushed at its time
    hub.clock.set(t0 + FAKE_STEP_1_MS);
    tick();
    hub.clock.set(t0 + FAKE_STEP_1_MS + 2_000);
    await deliver(aliWs, ALERT, 1);
    const seen = await post(ali, 'mark-alerts-seen', 'MarkAlertsSeen', { alert_ids: [ALERT] });
    expect(seen.statusCode, seen.body).toBe(200);
    flush();

    const mgr = reader(MGR);
    const counter = statementCounter(hub.deps.readDb);
    const v = await view(ALERT, mgr);
    expect(counter.count).toBe(4);

    expect(v.alert_id).toBe(ALERT);
    expect(v.kind).toBe('t_two_step');
    expect(v.steps.map((s) => s.step)).toEqual([0, 1]);
    for (const s of v.steps) {
      expect(sorted(s.recipients)).toEqual([person(CASH, 'Cashier', { no_route: true }), person(ALI, 'Order taker')]);
      expect(s.routes).toEqual(ownTablet(ALI, aliTab));
    }
    expect(JSON.stringify(v)).not.toContain('OLD');
    expect(v.receipts).toEqual([
      { kind: 'delivered', step: 0, staff_id: ALI, staff_name: 'Order taker', device_id: aliTab, device_name: 'Tablet 3', route: 'screen', at: t0 + 1_000 },
      { kind: 'delivered', step: 1, staff_id: ALI, staff_name: 'Order taker', device_id: aliTab, device_name: 'Tablet 3', route: 'screen', at: t0 + FAKE_STEP_1_MS + 2_000 },
      { kind: 'seen', step: null, staff_id: ALI, staff_name: 'Order taker', device_id: aliTab, device_name: 'Tablet 3', route: 'screen', at: t0 + FAKE_STEP_1_MS + 2_000 },
    ]);
  });

  it('[01d #46] without manage-devices → 403 PERMISSION_DENIED (no statement); unknown alert → 404 ALERT_NOT_FOUND (1 statement); no alert_id → 400', async () => {
    await start();
    const id = raise(twoStepTo({ kind: 'person', staff_id: CASH }));
    const cash = reader(CASH);
    const counter = statementCounter(hub.deps.readDb);
    const denied = await receiptsQuery(cash, id);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED', details: { permission: 'manage-devices' } } });
    expect(counter.count).toBe(0);

    const mgr = reader(MGR);
    counter.reset();
    const missing = await receiptsQuery(mgr, '01JNOSUCHALERT000000000000');
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: 'ALERT_NOT_FOUND' } });
    expect(counter.count).toBe(1);

    expect((await receiptsQuery(mgr)).statusCode).toBe(400);
    expect((await receiptsQuery(mgr, '')).statusCode).toBe(400);
  });

  // ---------------------------------------------------------------------------------------------- #57

  it('[01d #57 hub] Ali bound to T: T disconnected → "for Ali" on the lead; nobody ticked → T counts (safety rule) and the receipt says "delivered to device T, bound to Ali (not signed in)"; Ali absent → "for Ali"; Ali present → T', async () => {
    await start();
    const t = device('tablet', 'Tablet T');
    const mgrTab = device('tablet', 'Manager tablet');
    signOut(signIn(ALI, t).sessionId, 'idle_timeout'); // the binding stays (§3.7); no session on T
    const mgrWs = await staffSocket(signIn(MGR, mgrTab)); // the lead has a screen route

    // T not connected → not a route → the action alert goes to the lead "for Ali"
    const offline = raise(actionTo(ALI));
    expectForAli(await view(offline), mgrTab);

    // T connected, nobody ticked today → everyone present (§3.4.1 safety rule) → T gets it
    const tWs = await alertSocket(t);
    const safety = raise(actionTo(ALI));
    expectOnT(await view(safety), t);
    await fence();
    expect(alertFrames(tWs).map((f) => f.alert_id)).toEqual([safety]);
    const deliveredAt = hub.clock.branchNow();
    await deliver(tWs, safety, 0);
    flush();
    // "delivered to device Tablet T, bound to Order taker (not signed in)": route alert_connection + the bound person
    expect((await view(safety)).receipts).toEqual([
      { kind: 'delivered', step: 0, staff_id: ALI, staff_name: 'Order taker', device_id: t, device_name: 'Tablet T', route: 'alert_connection', at: deliveredAt },
    ]);

    // T connected but Ali marked absent today → the same as disconnected
    append([aPresenceSet({ payload: { staff_ids: [ALI], present: false, set_by: OWNER } })]);
    const absent = raise(actionTo(ALI));
    expectForAli(await view(absent), mgrTab);

    // Ali present → T again
    append([aPresenceSet({ payload: { staff_ids: [ALI], present: true, set_by: OWNER } })]);
    const present = raise(actionTo(ALI));
    expectOnT(await view(present), t);
    await fence();
    expect(alertFrames(tWs).map((f) => f.alert_id)).toEqual([safety, present]);
    expect(alertFrames(mgrWs).map((f) => f.alert_id)).toEqual([offline, absent]);
  });

  it('[01d #57 hub] 2 h rule (i): Ali signs in on T at 12:00, idles out at 12:05; an alert at 13:59 goes to T, one at 14:06 to the lead "for Ali"', async () => {
    await start();
    const noon = hub.clock.branchNow();
    const t = device('tablet', 'Tablet T');
    const mgrTab = device('tablet', 'Manager tablet');
    const ali = signIn(ALI, t);
    hub.clock.set(at(noon, 5));
    activity.touch(ali.sessionId, at(noon, 5)); // Ali's last tap on T at 12:05
    sweepOnce(hub.deps); // flushes it to staff_sessions.last_activity_at
    signOut(ali.sessionId, 'idle_timeout');
    expect(hub.deps.db.prepare('SELECT last_activity_at FROM staff_sessions WHERE session_id = ?').pluck().get(ali.sessionId)).toBe(at(noon, 5));
    await alertSocket(t);
    hub.clock.set(at(noon, 100));
    await staffSocket(signIn(MGR, mgrTab));

    hub.clock.set(at(noon, 119)); // 13:59
    expectOnT(await view(raise(actionTo(ALI))), t);
    hub.clock.set(at(noon, 126)); // 14:06
    expectForAli(await view(raise(actionTo(ALI))), mgrTab);
  });

  it('[01d #57 hub] 2 h rule (ii): Ali signs in on another tablet at 13:00 → at 14:30 T is still a route (activity anywhere); at 15:01 it is not', async () => {
    await start();
    const noon = hub.clock.branchNow();
    const t = device('tablet', 'Tablet T');
    const u = device('tablet', 'Tablet U');
    const mgrTab = device('tablet', 'Manager tablet');
    signOut(signIn(ALI, t).sessionId, 'idle_timeout'); // last activity on T: 12:00
    await alertSocket(t);
    hub.clock.set(at(noon, 60));
    signIn(ALI, u); // 13:00 on U (U is bound too, but not connected)
    hub.clock.set(at(noon, 145));
    await staffSocket(signIn(MGR, mgrTab));

    hub.clock.set(at(noon, 150)); // 14:30: > 2 h after T's own activity, < 2 h after U's
    expectOnT(await view(raise(actionTo(ALI))), t);
    hub.clock.set(at(noon, 181)); // 15:01
    expectForAli(await view(raise(actionTo(ALI))), mgrTab);
  });

  it('[01d #57 hub] 2 h rule (iii): a MarkAlertsSeen on T at 13:50 extends the route to 15:50', async () => {
    await start();
    const noon = hub.clock.branchNow();
    const t = device('tablet', 'Tablet T');
    const mgrTab = device('tablet', 'Manager tablet');
    await alertSocket(t);
    hub.clock.set(at(noon, 108)); // 13:48: Ali signs in on T (activity 13:48 → 15:48)
    const ali = signIn(ALI, t);
    const first = raise(actionTo(ALI));
    hub.clock.set(at(noon, 110)); // 13:50
    const seen = await post(ali, 'mark-alerts-seen', 'MarkAlertsSeen', { alert_ids: [first] });
    expect(seen.statusCode, seen.body).toBe(200);
    hub.clock.set(at(noon, 225));
    await staffSocket(signIn(MGR, mgrTab));

    hub.clock.set(at(noon, 229)); // 15:49: past 15:48, within 15:50
    expectOnT(await view(raise(actionTo(ALI))), t);
    hub.clock.set(at(noon, 231)); // 15:51
    expectForAli(await view(raise(actionTo(ALI))), mgrTab);
  });

  it('[01d #57 hub] 2 h rule (iv): a phone owner binding with no session for 3 h, page open, is still a route; its receipt names the phone and the owner', async () => {
    await start();
    const phone = device('phone', 'Owner phone', OWNER);
    append([
      aDevicePaired({
        stream_id: phone,
        payload: { device_id: phone, device_name: 'Owner phone', device_type: 'phone', station_id: null, owner_staff_id: OWNER, pairing_token_id: '01J00000000000000000000008', pairing_request_id: null },
      }),
    ]);
    expect(hub.deps.db.prepare('SELECT staff_id, session_id FROM device_bindings WHERE device_id = ?').get(phone)).toEqual({ staff_id: OWNER, session_id: null });
    const phoneWs = await alertSocket(phone);
    hub.clock.set(hub.clock.branchNow() + 3 * 60 * MIN);

    const id = raise(actionTo(OWNER));
    const v = await view(id);
    expect(v.steps[0]?.recipients).toEqual([person(OWNER, 'Owner')]);
    expect(v.steps[0]?.routes).toEqual([{ staff_id: OWNER, route: 'alert_connection', ref: phone }]);
    await deliver(phoneWs, id, 0);
    flush();
    expect((await view(id)).receipts).toEqual([
      { kind: 'delivered', step: 0, staff_id: OWNER, staff_name: 'Owner', device_id: phone, device_name: 'Owner phone', route: 'alert_connection', at: hub.clock.branchNow() },
    ]);
  });

  it('[01d #57 hub] 2 h rule (v): the tick issues the same statements for 1 and 150 due alerts routed through a bound tablet, the activity read included once', async () => {
    await start();
    const t = device('tablet', 'Tablet T');
    signOut(signIn(ALI, t).sessionId, 'idle_timeout');
    await alertSocket(t);

    const measure = (count: number): { statements: number; activity: number; steps: number } => {
      const base = hub.clock.branchNow();
      hub.deps.writer.run((tx) => {
        const results = alerts.raiseMany(
          alerts.tickCtx(tx, base),
          Array.from({ length: count }, () => twoStepTo({ kind: 'person', staff_id: ALI })),
        );
        tx.append(results.flatMap((r) => r.events));
      });
      hub.clock.set(base + FAKE_STEP_1_MS);
      const sqls = recorder(hub.deps.db);
      let steps = 0;
      hub.deps.writer.run((tx) => {
        sqls.reset();
        const state = hub.deps.state.get();
        const now = hub.clock.branchNow();
        expect(alertsTick.due(tx.db, state, now)).toBe(true);
        const drafts = alertsTick.intents(tx, state, now);
        sqls.stop();
        steps = drafts.filter((d) => d.event_type === 'AttemptSent').length;
        // every stepped alert is routed through T's binding (activity read (9) consulted)
        for (const d of drafts) if (d.event_type === 'AttemptSent') expect((d.payload as { routes: Route[] }).routes).toEqual([{ staff_id: ALI, route: 'alert_connection', ref: t }]);
        tx.append(drafts);
      });
      sqls.restore();
      return { statements: sqls.log.length, activity: sqls.log.filter((s) => /MAX\(last_activity_at\)/.test(s)).length, steps };
    };
    const one = measure(1);
    const many = measure(150);
    expect(one.steps).toBe(1);
    expect(many.steps).toBe(150);
    expect(one.activity).toBe(1);
    expect(many.activity).toBe(1);
    expect(many.statements).toBe(one.statements);
  });

  // ---------------------------------------------------------------------------------------------- #62

  it('[01d #62] a void with the owner (remote) and a second manager (on leave) with no route → no "for" rows; the duty manager gets one card per step; the receipt view shows "Owner: no route"; no details in the view', async () => {
    await start({ withMgr2: true });
    const mgrTab = device('tablet', 'Manager tablet');
    const mgrWs = await staffSocket(signIn(MGR, mgrTab));
    const t0 = hub.clock.branchNow();
    const id = raise({
      kind: 't_approval',
      subject: { stream_type: 'order', stream_id: 'O1' },
      target: { kind: 'answerers' },
      values: { order_id: 'O1' },
      display,
      details: DETAILS,
      dedupe_key: 'void:O1:L1',
      requester_staff_id: ALI,
      request: { approver_role_ids: ['R_MGR', 'R_OWNER'] },
    });
    hub.clock.set(t0 + 45_000);
    tick();
    hub.clock.set(t0 + 120_000);
    tick();
    await fence();
    expect(alertFrames(mgrWs).filter((f) => f.alert_id === id).map((f) => f.step)).toEqual([0, 1, 2]);

    const v = await view(id);
    expect(v.steps.map((s) => s.step)).toEqual([0, 1, 2]);
    for (const s of v.steps) {
      expect(s.recipients.filter((r) => r.for_staff_id !== null)).toEqual([]);
      expect(sorted(s.recipients.filter((r) => r.set === 'answerer'))).toEqual([
        person(MGR, 'Manager', { set: 'answerer' }),
        person(MGR2, 'Manager two', { set: 'answerer', no_route: true }),
        person(OWNER, 'Owner', { set: 'answerer', no_route: true }), // "Owner: no route"
      ]);
      expect(s.routes).toEqual(ownTablet(MGR, mgrTab));
    }
    const text = JSON.stringify(v);
    for (const secret of ['Mutton platter', '480000', 'customer changed mind', '"details"']) expect(text).not.toContain(secret);
  });

  it('[01d #62] an action kind to a person with no route still goes "for" to the lead; a fallback that reaches a person already in the step adds no second copy; no_approver adds no "for" row', async () => {
    await start();
    const mgrTab = device('tablet', 'Manager tablet');
    const mgrWs = await staffSocket(signIn(MGR, mgrTab));

    // Cashier has no route; the lead (Manager) has one → "for Cashier" on the lead
    const forCash = raise(actionTo(CASH));
    const v1 = await view(forCash);
    expect(v1.steps[0]?.recipients).toEqual([person(MGR, 'Manager', { for_staff_id: CASH, for_staff_name: 'Cashier' })]);

    // the whole team of the Owner: Manager, Cashier, Order taker; the lead of the last two is already in the step
    const team = raise({ ...actionTo(CASH), target: { kind: 'team', lead_staff_id: OWNER, depth: 'all' } });
    const v2 = await view(team);
    expect(sorted(v2.steps[0]?.recipients ?? [])).toEqual([
      person(CASH, 'Cashier', { no_route: true }),
      person(MGR, 'Manager'),
      person(ALI, 'Order taker', { no_route: true }),
    ]);
    expect(v2.steps[0]?.routes).toEqual(ownTablet(MGR, mgrTab));
    await fence();
    expect(alertFrames(mgrWs).filter((f) => f.alert_id === team)).toHaveLength(1);

    // no_approver (lead_fallback false): the managers with no route are listed "no route", never "for"
    const warning = raise({
      kind: 'no_approver',
      subject: { stream_type: 'hub', stream_id: BRANCH },
      target: { kind: 'always_on' },
      values: { permission: 'void-item' },
      display: { kind_label_key: 'alert.no_approver.lock' },
      dedupe_key: 'no_approver:void-item',
    });
    const v3 = await view(warning);
    expect(sorted(v3.steps[0]?.recipients ?? [])).toEqual([person(MGR, 'Manager'), person(OWNER, 'Owner', { no_route: true })]);
  });

  // --------------------------------------------------------------------------------------------- RF-5

  it('[01d RF-5] SendTestAlert to a team whose lead has no reports → "no recipients"; to an offline paired device → the device listed with no route and no delivery; the sender reads both', async () => {
    await start();
    const mgr = reader(MGR);
    const offline = device('tablet', 'Tablet 9');

    const teamRes = await post(mgr, 'send-test-alert', 'SendTestAlert', { target: { kind: 'team', lead_staff_id: CASH } });
    expect(teamRes.statusCode, teamRes.body).toBe(200);
    const teamId = (teamRes.json() as { data: { result: { alert_id: string } } }).data.result.alert_id;
    expect(await view(teamId, mgr)).toEqual({ alert_id: teamId, kind: 'test_alert', steps: [{ step: 0, recipients: [], routes: [] }], receipts: [] });

    const devRes = await post(mgr, 'send-test-alert', 'SendTestAlert', { target: { kind: 'device', device_id: offline } });
    expect(devRes.statusCode, devRes.body).toBe(200);
    const devId = (devRes.json() as { data: { result: { alert_id: string } } }).data.result.alert_id;
    expect(await view(devId, mgr)).toEqual({
      alert_id: devId,
      kind: 'test_alert',
      steps: [
        {
          step: 0,
          recipients: [{ staff_id: null, staff_name: null, device_id: offline, device_name: 'Tablet 9', for_staff_id: null, for_staff_name: null, set: 'recipient', no_route: true }],
          routes: [],
        },
      ],
      receipts: [],
    });
  });

  it('[01d RF-5] a device-target test to a connected kiosk: the device row is routed and its signed-out receipt has no person', async () => {
    await start();
    const mgr = reader(MGR);
    const kiosk = device('cashier_kiosk', 'Kiosk 1');
    const kWs = await alertSocket(kiosk);
    const res = await post(mgr, 'send-test-alert', 'SendTestAlert', { target: { kind: 'device', device_id: kiosk } });
    expect(res.statusCode, res.body).toBe(200);
    const id = (res.json() as { data: { result: { alert_id: string } } }).data.result.alert_id;
    await deliver(kWs, id, 0);
    flush();
    const v = await view(id, mgr);
    expect(v.steps[0]?.recipients).toEqual([
      { staff_id: null, staff_name: null, device_id: kiosk, device_name: 'Kiosk 1', for_staff_id: null, for_staff_name: null, set: 'recipient', no_route: false },
    ]);
    expect(v.steps[0]?.routes).toEqual([{ staff_id: null, route: 'alert_connection', ref: kiosk }]);
    expect(v.receipts).toEqual([
      { kind: 'delivered', step: 0, staff_id: null, staff_name: null, device_id: kiosk, device_name: 'Kiosk 1', route: 'alert_connection', at: hub.clock.branchNow() },
    ]);
  });
});

/** Records the SQL of every statement executed on the connection (get / all / run) while started. */
function recorder(db: Database.Database): { log: string[]; reset(): void; stop(): void; restore(): void } {
  const log: string[] = [];
  let on = true;
  const original = db.prepare;
  const prepare = original.bind(db);
  db.prepare = ((sql: string) => {
    const statement = prepare(sql);
    const wrap =
      <A extends unknown[], R>(fn: (...args: A) => R) =>
      (...args: A): R => {
        if (on) log.push(sql);
        return fn(...args);
      };
    statement.get = wrap(statement.get.bind(statement));
    statement.all = wrap(statement.all.bind(statement));
    statement.run = wrap(statement.run.bind(statement));
    return statement;
  }) as typeof db.prepare;
  return {
    log,
    reset() {
      log.length = 0;
      on = true;
    },
    stop() {
      on = false;
    },
    restore() {
      db.prepare = original;
    },
  };
}
