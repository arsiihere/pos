import type { AlertView, DirectoryInput } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineAlertKind, unregisterAlertKind } from '../../src/alerts/kinds';
import { alerts, type RaiseInput } from '../../src/alerts/raise';
import { activity } from '../../src/auth/session-store';
import { wsHubFor } from '../../src/ws/server';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type DeviceProfileInput, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { registerFakes, resetFakes } from './fakes';

// ⚠️ 01d hook for 03b v1.0.16 §3.5 step 4 / §6.21 (run 3 verify R3-B-3): a kind's optional `excludesDevice(values,
// device_id)` keeps one alert off a device at every step and on every path: device rows at resolve, a person's screen and
// alert-connection routes, step frames, the `alerts` catch-up, `alerts-inbox` and `alerts_open`. Memory only.

const X = 'S_WAIT';
const KIND = 't_filtered';

function defineKind(): void {
  defineAlertKind({
    kind: KIND,
    family: 'action',
    subject: 'order',
    steps: [
      {
        at: { ms: 0 },
        to: [
          { target: 'raised_target', set: 'recipient' },
          { target: { kind: 'screen_devices', screen_from_value: 'counter_screen' }, set: 'recipient' },
        ],
      },
    ],
    closes_on: 'owner',
    values_schema: z.object({ blocked: z.string(), counter_screen: z.enum(['takeaway', 'parking']).optional() }),
    details_schema: null,
    lead_fallback: false,
    expires_at_day_close: true,
    silent: false,
    labels: { card: 'alert.t_filtered.card', lock: 'alert.t_filtered.lock' },
    request: null,
    excludesDevice: (values, device_id) => values.blocked === device_id,
  });
}

type Frame = { type: string; alert_id?: string; alert?: AlertView };

describe('[01d hook, 03b v1.0.16 §6.21] excludesDevice', () => {
  let hub: TestHub;
  const clients: WsClient[] = [];
  const devices = new Map<string, string>();

  beforeEach(async () => {
    hub = await createTestHub();
    registerFakes();
    defineKind();
    await seedDirectory(hub, (await aDirectory()) as DirectoryInput);
    hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();
  });
  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    devices.clear();
    unregisterAlertKind(KIND);
    resetFakes();
    activity.drain();
    activity.drainDevices();
    await hub.close();
  });

  const TAKEAWAY: DeviceProfileInput = { access: 'everyone', screens: ['takeaway'] };
  const device = (name: string, profile: DeviceProfileInput, type: 'cashier_kiosk' | 'phone' = 'cashier_kiosk'): string => {
    const d = pairDevice(hub, { type, name, profile });
    devices.set(d.deviceId, d.token);
    return d.deviceId;
  };
  const session = (deviceId: string) => openSession(hub, { kind: 'staff', staffId: X, deviceId, legacyProfile: false });
  async function socket(deviceId: string, token?: string): Promise<WsClient> {
    const ws = await connectWs(hub.app);
    ws.send(token === undefined ? { type: 'auth', device_token: devices.get(deviceId) } : { type: 'auth', device_token: devices.get(deviceId), session_token: token });
    await ws.untilCount(1);
    clients.push(ws);
    return ws;
  }
  async function fence(): Promise<void> {
    const id = `FENCE_${Math.random()}`;
    wsHubFor(hub.app).sendToDevices([...devices.keys()], { type: 'alert_seen', alert_id: id });
    for (const c of clients) for (let i = 0; i < 50 && !c.messages.some((m) => (m as Frame).alert_id === id); i += 1) await c.untilCount(c.messages.length + 1);
  }
  const alertFrames = (c: WsClient, id: string): AlertView[] => (c.messages as Frame[]).flatMap((m) => (m.type === 'alert' && m.alert?.alert_id === id ? [m.alert] : []));

  function raise(blocked: string): string {
    const input: RaiseInput = {
      kind: KIND,
      subject: { stream_type: 'order', stream_id: 'O1' },
      target: { kind: 'person', staff_id: X },
      values: { blocked, counter_screen: 'takeaway' },
      display: { kind_label_key: 'alert.t_filtered.lock', table_code: '#1' },
      dedupe_key: `f:${blocked}`,
    };
    return hub.deps.writer.run((tx) => {
      const r = alerts.raise(alerts.tickCtx(tx, hub.clock.branchNow()), input);
      tx.append(r.events);
      return r.alert_id;
    }).result;
  }

  it('no device row, no route and no frame to the excluded device, the person\'s own session there included; other devices unchanged', async () => {
    const k = device('K', TAKEAWAY);
    const blocked = device('L', TAKEAWAY);
    const phone = device('X phone', { access: 'everyone', screens: ['dine_in'] }, 'phone');
    const onBlocked = session(blocked);
    const wsBlocked = await socket(blocked, onBlocked.token);
    const wsK = await socket(k, session(k).token);
    const onPhone = session(phone);
    const wsPhone = await socket(phone, onPhone.token);
    const id = raise(blocked);
    await fence();
    const step = hub.deps.db.prepare("SELECT payload FROM events WHERE event_type = 'AttemptSent' ORDER BY seq DESC LIMIT 1").get() as { payload: string };
    const p = JSON.parse(step.payload) as { recipients: Array<{ device_id: string | null }>; routes: Array<{ ref: string }> };
    expect(p.recipients.flatMap((r) => (r.device_id === null ? [] : [r.device_id]))).toEqual([k]);
    expect(p.routes.map((r) => r.ref)).not.toContain(blocked);
    expect(alertFrames(wsBlocked, id)).toEqual([]);
    expect(alertFrames(wsK, id).length).toBeGreaterThan(0);
    expect(alertFrames(wsPhone, id).length).toBeGreaterThan(0);
    // reconnect paths: catch-up, inbox and alerts_open of the excluded device list nothing of it
    const again = await socket(blocked, onBlocked.token);
    const rows = ((again.messages[0] as { state: { alerts?: { alerts: Array<{ alert_id: string }> } } }).state.alerts?.alerts ?? []).map((r) => r.alert_id);
    expect(rows).not.toContain(id);
    const res = await hub.app.inject({ method: 'GET', url: '/queries/alerts-inbox', headers: { authorization: `Bearer ${devices.get(blocked)}`, 'x-session-token': onBlocked.token } });
    expect((res.json() as { data: { alerts: Array<{ alert_id: string }> } }).data.alerts.map((a) => a.alert_id)).not.toContain(id);
    const fromPhone = await hub.app.inject({ method: 'GET', url: '/queries/alerts-inbox', headers: { authorization: `Bearer ${devices.get(phone)}`, 'x-session-token': onPhone.token } });
    expect((fromPhone.json() as { data: { alerts: Array<{ alert_id: string }> } }).data.alerts.map((a) => a.alert_id)).toContain(id);
    const alertMode = await socket(blocked);
    expect((alertMode.messages[0] as { alerts: Array<{ alert_id: string }> }).alerts.map((a) => a.alert_id)).not.toContain(id);
  });
});
