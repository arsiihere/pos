import { AlertDetailsBase, type AlertView, type DirectoryInput } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineAlertKind, unregisterAlertKind } from '../../src/alerts/kinds';
import * as catchUp from '../../src/alerts/catch-up';
import { alerts, type RaiseInput } from '../../src/alerts/raise';
import { receiptBufferFor } from '../../src/alerts/receipts';
import { activity } from '../../src/auth/session-store';
import { wsHubFor } from '../../src/ws/server';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, endSessionNow, openSession, pairDevice, seedDirectory, type DeviceProfileInput, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { fakePoint, registerFakes, resetFakes } from './fakes';

// 01d v1.3.7 §3.5 counter row, §6 batch 3 counter card exception (Q-37a) and live counter view refresh (R3-M-2),
// §6.7, §11 (b); tests 108–113. A counter row = a device row of a `counter_card` kind whose device's CURRENT profile
// shows the gated screen; it gets the card on a signed-in staff socket of that device (frames, catch-up, the
// viewer's own inbox row), `lock` everywhere else. Real WS clients, real commands.

const BRANCH = 'branch-1';
const X = 'S_WAIT'; // the raised target (the placer)
const Q = 'S_CASH'; // another cashier, not a recipient
const MGR = 'S_MGR';
const OWNER = 'S_OWNER';
const CARD_KIND = 't_ready_counter';
const LOCK_KIND = 't_ready_plain';
const STEP_1_MS = 30_000;
const DETAILS = { identifier: '#12', lines: [{ name: 'Zinger', quantity: 2, state: 'done' }] };

function defineKinds(): void {
  for (const [kind, counter_card] of [[CARD_KIND, true], [LOCK_KIND, false]] as const) {
    defineAlertKind({
      kind,
      family: 'action',
      subject: 'order',
      steps: [
        {
          at: { ms: 0 },
          to: [
            { target: 'raised_target', set: 'recipient' },
            { target: { kind: 'screen_devices', screen_from_value: 'counter_screen' }, set: 'recipient' },
            { target: { kind: 'point', from_value: 'point_id' }, set: 'recipient' },
          ],
        },
        // a later step without screen_devices: the managers only (X is dropped → "Moved to")
        { at: { ms: STEP_1_MS }, to: [{ target: { kind: 'managers' }, set: 'recipient' }] },
      ],
      closes_on: 'owner',
      values_schema: z.object({ point_id: z.string().min(1), counter_screen: z.enum(['takeaway', 'parking']).optional() }),
      details_schema: AlertDetailsBase.pick({ identifier: true, lines: true }),
      lead_fallback: false,
      expires_at_day_close: true,
      silent: false,
      labels: { card: `alert.${kind}.card`, lock: `alert.${kind}.lock` },
      request: null,
      counter_card,
    });
  }
}

/** The socket is still open (ws readyState 1). */
const isOpen = (c: WsClient): boolean => (c.raw as unknown as { readyState: number }).readyState === 1;

type Frame = { type: string; alert_id?: string; alert?: AlertView & Record<string, unknown>; alerts?: { alerts: Array<Record<string, unknown>> } } & Record<string, unknown>;

describe('[01d v1.3.7 §6 batch 3] counter card #108–#113', () => {
  let hub: TestHub;
  const clients: WsClient[] = [];
  const devices = new Map<string, string>();

  beforeEach(async () => {
    hub = await createTestHub();
    registerFakes();
    defineKinds();
    await seedDirectory(hub, (await aDirectory()) as DirectoryInput);
    hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    devices.clear();
    unregisterAlertKind(CARD_KIND);
    unregisterAlertKind(LOCK_KIND);
    resetFakes();
    activity.drain();
    activity.drainDevices();
    await hub.close();
  });

  const TAKEAWAY: DeviceProfileInput = { access: 'everyone', screens: ['takeaway', 'cashier'] };

  function device(name: string, type: 'tablet' | 'cashier_kiosk' | 'phone', profile: DeviceProfileInput): string {
    const d = pairDevice(hub, { type, name, profile });
    devices.set(d.deviceId, d.token);
    return d.deviceId;
  }

  function signIn(staffId: string, deviceId: string): { sessionId: string; token: string } {
    return openSession(hub, { kind: 'staff', staffId, deviceId, legacyProfile: false });
  }

  async function staffSocket(deviceId: string, session: { token: string }): Promise<WsClient> {
    const ws = await connectWs(hub.app);
    ws.send({ type: 'auth', device_token: devices.get(deviceId), session_token: session.token });
    await ws.untilCount(1);
    expect(ws.messages[0]).toMatchObject({ type: 'catch_up' });
    clients.push(ws);
    return ws;
  }

  async function alertSocket(deviceId: string): Promise<WsClient> {
    const ws = await connectWs(hub.app);
    ws.send({ type: 'auth', device_token: devices.get(deviceId) });
    await ws.untilCount(1);
    expect(ws.messages[0]).toMatchObject({ type: 'alerts_open' });
    clients.push(ws);
    return ws;
  }

  let fenceNo = 0;
  async function fence(): Promise<void> {
    fenceNo += 1;
    const id = `FENCE_${fenceNo}`;
    wsHubFor(hub.app).sendToDevices([...devices.keys()], { type: 'alert_seen', alert_id: id });
    for (const client of clients) {
      if (!isOpen(client)) continue; // e.g. the socket of a session that ended
      for (let i = 0; i < 50 && !client.messages.some((m) => (m as { alert_id?: string }).alert_id === id); i += 1) {
        await client.untilCount(client.messages.length + 1);
      }
    }
  }

  const frames = (c: WsClient, type: string): Frame[] => (c.messages as Frame[]).filter((m) => m.type === type && !(m.alert_id ?? '').startsWith('FENCE_'));
  const alertFrames = (c: WsClient, id: string) => frames(c, 'alert').flatMap((f) => (f.alert?.alert_id === id ? [f.alert] : []));
  const catchUpRows = (c: WsClient): Array<Record<string, unknown>> =>
    ((c.messages[0] as { state: { alerts?: { alerts: Array<Record<string, unknown>> } } }).state.alerts?.alerts ?? []);

  function raise(kind = CARD_KIND, over: Partial<RaiseInput> = {}): string {
    const input: RaiseInput = {
      kind,
      subject: { stream_type: 'order', stream_id: 'O12' },
      target: { kind: 'person', staff_id: X },
      values: { point_id: 'P1', counter_screen: 'takeaway' },
      display: { kind_label_key: `alert.${kind}.lock`, table_code: '#12' },
      details: DETAILS,
      dedupe_key: `ready:O12:${kind}`,
      ...over,
    };
    return hub.deps.writer.run((tx) => {
      const r = alerts.raise(alerts.tickCtx(tx, hub.clock.branchNow()), input);
      tx.append(r.events);
      return r.alert_id;
    }).result;
  }

  /** The tick's next step for one alert (step 1: managers), through raiseMany's sibling: the tick loop is not run here. */
  async function stepOne(): Promise<void> {
    const { alertsTick } = await import('../../src/alerts/tick');
    hub.clock.advance(STEP_1_MS);
    hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();
    hub.deps.writer.run((tx) => tx.append(alertsTick.intents(tx, {} as never, hub.clock.branchNow())));
  }

  async function inbox(deviceId: string, session: { token: string }): Promise<Array<Record<string, unknown>>> {
    const res = await hub.app.inject({
      method: 'GET',
      url: '/queries/alerts-inbox',
      headers: { authorization: `Bearer ${devices.get(deviceId)}`, 'x-session-token': session.token },
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: { alerts: Array<Record<string, unknown>> } }).data.alerts;
  }

  let cmd = 0;
  /** SetDeviceProfile from the Owner's admin session (05a §6.4); the push then goes to every socket of the device. */
  async function setScreens(deviceId: string, screens: DeviceProfileInput['screens']): Promise<void> {
    const admin = openSession(hub, { kind: 'admin', staffId: OWNER });
    const version = (hub.deps.db.prepare('SELECT profile_version FROM device_profiles WHERE device_id = ?').get(deviceId) as { profile_version: number }).profile_version;
    cmd += 1;
    const res = await hub.app.inject({
      method: 'POST',
      url: '/admin/commands/set-device-profile',
      headers: { 'x-admin-session': admin.token },
      payload: {
        command_id: `cc-sdp-${cmd}`,
        tenant_id: 'tenant-a',
        branch_id: BRANCH,
        command_type: 'SetDeviceProfile',
        payload: { device_id: deviceId, expected_version: version, screens },
        occurred_at: hub.clock.branchNow(),
        actor_id: OWNER,
        device_id: 'hub-admin',
      },
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  it('#108: a counter row gets the card on signed-in staff sockets; the alert-mode socket and a kind without counter_card get lock', async () => {
    const k = device('Kiosk K', 'cashier_kiosk', TAKEAWAY);
    const l = device('Kiosk L', 'cashier_kiosk', TAKEAWAY);
    const xOnK = signIn(X, k);
    const kWs = await staffSocket(k, xOnK);
    const lWs = await staffSocket(l, signIn(Q, l));
    const id = raise();
    await fence();
    for (const ws of [kWs, lWs]) {
      const [view] = alertFrames(ws, id);
      expect(view?.card).toMatchObject({ kind_label_key: `alert.${CARD_KIND}.card`, table_code: '#12', details: DETAILS });
      expect(alertFrames(ws, id).every((v) => v.card !== undefined)).toBe(true);
    }
    // after X signs out, K's alert-mode socket gets lock (alerts_open), with the token as table_code
    endSessionNow(hub, xOnK.sessionId);
    const kAlert = await alertSocket(k);
    const open = (kAlert.messages[0] as { alerts: Array<Record<string, unknown>> }).alerts.find((a) => a.alert_id === id);
    expect(open).toMatchObject({ lock: { kind_label_key: `alert.${CARD_KIND}.lock`, table_code: '#12' } });
    expect(open).not.toHaveProperty('card');

    // the same kind without counter_card: K and L get lock
    const kWs2 = await staffSocket(k, signIn(X, k));
    const plain = raise(LOCK_KIND, { dedupe_key: 'plain' });
    await fence();
    for (const ws of [kWs2, lWs]) {
      const views = alertFrames(ws, plain);
      expect(views.length).toBeGreaterThan(0);
      for (const v of views) expect(v).not.toHaveProperty('card');
    }
    expect(alertFrames(kAlert, id)).toEqual([]);
  });

  it('#109: provenance — a Pass tablet with only a point row gets lock (frame and catch-up); point + counter rows → card; re-profiled away → lock, refreshed live without a reconnect or a new alert frame', async () => {
    const p = device('Pass tablet', 'tablet', { access: 'everyone', screens: ['pass'], point_id: null });
    const kp = device('Point kiosk', 'cashier_kiosk', TAKEAWAY);
    const ct = device('Counter tablet', 'tablet', TAKEAWAY);
    fakePoint.devices.set('P1', [p, kp]);
    const runner = signIn(MGR, p);
    const pWs = await staffSocket(p, runner);
    const kpWs = await staffSocket(kp, signIn(Q, kp));
    const ctSession = signIn(X, ct); // not a manager: step 1 (managers) sends this socket nothing
    const ctWs = await staffSocket(ct, ctSession);
    const id = raise();
    await fence();
    expect(alertFrames(pWs, id)[0]).not.toHaveProperty('card');
    expect(alertFrames(kpWs, id)[0]?.card).toBeDefined();
    expect(alertFrames(ctWs, id)[0]?.card).toBeDefined();
    const pAgain = await staffSocket(p, runner);
    expect(catchUpRows(pAgain).find((r) => r.alert_id === id)).not.toHaveProperty('card');

    // R3-M-2: re-profiled to dine_in while the staff session survives → the profile push carries the alerts part,
    // this alert now as a lock row; no reconnect, no new alert frame (no ring)
    const before = alertFrames(ctWs, id).length;
    await setScreens(ct, ['dine_in']);
    await fence();
    const [push] = frames(ctWs, 'device_profile');
    expect(push).toMatchObject({ type: 'device_profile', screens: ['dine_in'] });
    const row = push?.alerts?.alerts.find((r) => r.alert_id === id);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty('card');
    expect(alertFrames(ctWs, id)).toHaveLength(before);
    expect(isOpen(ctWs)).toBe(true);
    // the session survived and its catch-up agrees
    const ctAgain = await staffSocket(ct, ctSession);
    expect(catchUpRows(ctAgain).find((r) => r.alert_id === id)).not.toHaveProperty('card');
    // after the last targeted step the refresh still runs on a counter-only staff socket
    await stepOne();
    await setScreens(ct, ['dine_in', 'takeaway']);
    await fence();
    const back = frames(ctWs, 'device_profile').at(-1)?.alerts?.alerts.find((r) => r.alert_id === id);
    expect(back?.card).toBeDefined();
    expect(alertFrames(ctWs, id)).toHaveLength(before);
  });

  it('#110: X\'s inbox from his session on K → card; at the step without X it reads "Moved to" and keeps the card; from a phone → his own card', async () => {
    const k = device('Kiosk K', 'cashier_kiosk', TAKEAWAY);
    const phone = device('X phone', 'phone', { access: 'everyone', screens: ['dine_in'] });
    const xOnK = signIn(X, k);
    const kWs = await staffSocket(k, xOnK);
    const xOnPhone = signIn(X, phone);
    const id = raise();
    await fence();
    const [row] = (await inbox(k, xOnK)).filter((r) => r.alert_id === id);
    expect(row?.card).toBeDefined();
    await stepOne();
    await fence();
    const [moved] = (await inbox(k, xOnK)).filter((r) => r.alert_id === id);
    expect(moved?.moved_to_name).not.toBeNull();
    expect(moved?.card).toBeDefined();
    expect(alertFrames(kWs, id)[0]?.card).toBeDefined();
    const [fromPhone] = (await inbox(phone, xOnPhone)).filter((r) => r.alert_id === id);
    expect(fromPhone?.card).toBeDefined();
  });

  it('#111: X\'s delivered receipt on K is recorded as (X, K) and alert-receipts shows K\'s device row delivered', async () => {
    const k = device('Kiosk K', 'cashier_kiosk', TAKEAWAY);
    const kWs = await staffSocket(k, signIn(X, k));
    const id = raise();
    await fence();
    kWs.send({ type: 'receipt', alert_id: id, kind: 'delivered', step: 0 });
    await fence();
    receiptBufferFor(hub.app).flush();
    expect(hub.deps.db.prepare("SELECT staff_id, device_id FROM alert_receipts WHERE alert_id = ? AND kind = 'delivered'").all(id)).toEqual([{ staff_id: X, device_id: k }]);
    const mgr = device('Manager tablet', 'tablet', { access: 'listed', staff_ids: [MGR], screens: ['manager'] });
    const mgrSession = signIn(MGR, mgr);
    const res = await hub.app.inject({
      method: 'GET',
      url: `/queries/alert-receipts?alert_id=${id}`,
      headers: { authorization: `Bearer ${devices.get(mgr)}`, 'x-session-token': mgrSession.token },
    });
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as { data: { steps: Array<{ step: number; recipients: Array<{ device_id: string | null }> }>; receipts: Array<Record<string, unknown>> } }).data;
    expect(data.steps[0]?.recipients.some((r) => r.device_id === k)).toBe(true);
    expect(data.receipts).toEqual([expect.objectContaining({ kind: 'delivered', step: 0, device_id: k, staff_id: X })]);
  });

  it('#112: reconnects — K\'s staff socket catch-up carries the card, its alert-mode alerts_open the lock; a 05a edit raises no profile-reading alert', async () => {
    const k = device('Kiosk K', 'cashier_kiosk', TAKEAWAY);
    const session = signIn(Q, k);
    const id = raise();
    const again = await staffSocket(k, session);
    expect(catchUpRows(again).find((r) => r.alert_id === id)?.card).toMatchObject({ details: DETAILS });
    const alertMode = await alertSocket(k);
    const open = (alertMode.messages[0] as { alerts: Array<Record<string, unknown>> }).alerts.find((a) => a.alert_id === id);
    expect(open).toBeDefined();
    expect(open).not.toHaveProperty('card');
    // m-3: the edit's transaction raises nothing (05a only closes device_waiting)
    const seq = (hub.deps.db.prepare('SELECT MAX(seq) AS s FROM events').get() as { s: number }).s;
    await setScreens(k, ['takeaway']);
    expect(hub.deps.db.prepare("SELECT COUNT(*) AS n FROM events WHERE seq > ? AND event_type = 'AlertRaised'").get(seq)).toEqual({ n: 0 });
  });

  it('#113: a later step without screen_devices leaves device rows without moved_to; the close reaches K and L', async () => {
    const k = device('Kiosk K', 'cashier_kiosk', TAKEAWAY);
    const l = device('Kiosk L', 'cashier_kiosk', TAKEAWAY);
    const kWs = await staffSocket(k, signIn(X, k));
    const lWs = await staffSocket(l, signIn(Q, l));
    const id = raise();
    await stepOne();
    await fence();
    // device rows have no inbox row, so no moved_to: the cards stay
    expect(hub.deps.db.prepare('SELECT COUNT(*) AS n FROM alert_inbox WHERE alert_id = ? AND staff_id IS NULL').get(id)).toEqual({ n: 0 });
    expect(alertFrames(kWs, id).every((v) => v.card !== undefined)).toBe(true);
    hub.deps.writer.run((tx) => tx.append(alerts.close(alerts.tickCtx(tx, hub.clock.branchNow()), id, 'done')));
    await fence();
    for (const ws of [kWs, lWs]) expect(frames(ws, 'alert_closed').map((f) => f.alert_id)).toContain(id);
  });

  it('R3-M-2: a failing alerts refresh still sends the plain profile push and does not break the command', async () => {
    const ct = device('Counter tablet', 'tablet', TAKEAWAY);
    const ws = await staffSocket(ct, signIn(X, ct));
    raise();
    const spy = vi.spyOn(catchUp, 'alertsPartForSession').mockImplementation(() => {
      throw new Error('boom');
    });
    await setScreens(ct, ['dine_in']);
    await fence();
    spy.mockRestore();
    const [push] = frames(ws, 'device_profile');
    expect(push).toEqual({ type: 'device_profile', screens: ['dine_in'], access: 'everyone', point_id: null });
  });
});
