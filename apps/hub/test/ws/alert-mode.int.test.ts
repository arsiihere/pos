import type { DeviceType } from '@pos/domain';
import type { EventDraft, WsAlertsOpen, WsReceipt } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { activity, revokeDevice } from '../../src/auth/session-store';
import { registerCatchUp } from '../../src/ws/catch-up';
import { wsHubFor } from '../../src/ws/server';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';

// A secret in a log field, read field by field: a raw search of the log text would also match digits inside a
// random number such as responseTime 13.025480000000243.
function logLeaks(logs: string, secrets: readonly string[]): string[] {
  const found: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') found.push(...secrets.filter((secret) => value.includes(secret)));
    else if (typeof value === 'number') found.push(...secrets.filter((secret) => value === Number(secret)));
    else if (value !== null && typeof value === 'object') Object.values(value).forEach(walk);
  };
  for (const line of logs.split('\n')) {
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      parsed = line;
    }
    walk(parsed);
  }
  return found;
}

type ReceiptFrom = { deviceId: string; sessionId: string | null; staffId: string | null; mode: 'session' | 'alert' };

const LOCK_ROW = {
  alert_id: 'A_ROW',
  kind: 'test_alert',
  family: 'info',
  step: 0,
  lock: { kind_label_key: 'alert.test_alert.lock', table_code: null, point_code: null, requester_name: 'Imran' },
  raised_at: 1_761_000_000_000,
};
const CARD = { kind_label_key: 'alert.test_alert.card', table_code: null, point_code: null, requester_name: 'Imran' };

const RECEIPT: WsReceipt = { type: 'receipt', alert_id: 'A_1', kind: 'delivered', step: 0 };

describe('websocket alert mode', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 H-1] a device token without session_token gets alerts_open first (all four device types), no catch_up and no event frames', async () => {
    const hub = await open(cleanups);
    const types: DeviceType[] = ['tablet', 'cashier_kiosk', 'kds', 'phone'];
    const sockets: WsClient[] = [];
    for (const type of types) {
      const device = pairDevice(hub, { type, stationId: 'station-1', ownerStaffId: 'S_MGR' });
      const ws = await connectWs(hub.app);
      ws.send({ type: 'auth', device_token: device.token });
      await ws.untilCount(1);
      expect(ws.messages[0]).toEqual({ type: 'alerts_open', alerts: [], binding_route_until: null });
      sockets.push(ws);
    }
    hub.deps.writer.run((tx) => {
      tx.append([clockAlarm(10, 20)]);
    });
    const watcher = pairDevice(hub, { type: 'tablet' });
    await seedDirectory(hub);
    const staff = openSession(hub, { kind: 'staff', staffId: 'S_MGR', deviceId: watcher.deviceId });
    const session = await connectWs(hub.app);
    session.send({ type: 'auth', device_token: watcher.token, session_token: staff.token });
    await session.untilCount(1);
    hub.deps.writer.run((tx) => {
      tx.append([clockAlarm(11, 21)]);
    });
    await session.untilCount(2);
    expect(session.messages[1]).toMatchObject({ type: 'event' });
    for (const ws of sockets) {
      expect(ws.messages.map((m) => (m as { type: string }).type)).toEqual(['alerts_open']);
    }
  });

  it('[00 H-1] setAlertsOpen replaces the default builder and receives the device id', async () => {
    const hub = await open(cleanups);
    const seen: string[] = [];
    wsHubFor(hub.app).setAlertsOpen((deviceId) => {
      seen.push(deviceId);
      return { type: 'alerts_open', alerts: [], binding_route_until: 1_761_000_100_000 };
    });
    const device = pairDevice(hub, { type: 'tablet' });
    const ws = await connectWs(hub.app);
    ws.send({ type: 'auth', device_token: device.token });
    await ws.untilCount(1);
    expect(ws.messages[0]).toEqual({ type: 'alerts_open', alerts: [], binding_route_until: 1_761_000_100_000 });
    expect(seen).toEqual([device.deviceId]);
  });

  it('[00 H-1] a revoked device closes 4403 and an unknown token 4401, with zero frames', async () => {
    const hub = await open(cleanups);
    const revoked = pairDevice(hub, { type: 'tablet' });
    hub.deps.db.prepare('UPDATE devices SET revoked_at = ? WHERE device_id = ?').run(hub.clock.branchNow(), revoked.deviceId);

    const gone = await connectWs(hub.app);
    gone.send({ type: 'auth', device_token: revoked.token });
    expect((await gone.untilClose()).code).toBe(4403);
    expect(gone.messages).toEqual([]);

    const unknown = await connectWs(hub.app);
    unknown.send({ type: 'auth', device_token: 'missing' });
    expect((await unknown.untilClose()).code).toBe(4401);
    expect(unknown.messages).toEqual([]);
    expect(wsHubFor(hub.app).alertSockets()).toEqual([]);
  });

  it('[00 H-1] after auth a non-receipt frame (ack, invalid JSON) closes 4401 and leaves the alert list', async () => {
    const hub = await open(cleanups);
    const device = pairDevice(hub, { type: 'tablet' });
    const ws = await authAlert(hub, device.token);
    ws.send({ type: 'ack', last_seq: 1 });
    expect((await ws.untilClose()).code).toBe(4401);
    expect(wsHubFor(hub.app).alertSockets()).toEqual([]);

    const again = await authAlert(hub, device.token);
    again.raw.send('{not json');
    expect((await again.untilClose()).code).toBe(4401);
    expect(wsHubFor(hub.app).alertSockets()).toEqual([]);
  });

  it('[00 H-1] a receipt frame calls onReceipt with mode alert and sessionId null', async () => {
    const hub = await open(cleanups);
    const calls: Array<[ReceiptFrom, WsReceipt]> = [];
    wsHubFor(hub.app).onReceipt((from, msg) => calls.push([from, msg]));
    const device = pairDevice(hub, { type: 'tablet' });
    const ws = await authAlert(hub, device.token);
    ws.send(RECEIPT);
    await waitUntil(() => calls.length === 1);
    expect(calls[0]).toEqual([{ deviceId: device.deviceId, sessionId: null, staffId: null, mode: 'alert' }, RECEIPT]);
    expect(wsHubFor(hub.app).alertSockets()).toEqual([{ deviceId: device.deviceId, deviceType: 'tablet' }]);
  });

  it('[01d Review Focus 4] a malformed receipt on an alert-mode socket is ignored and the socket stays open', async () => {
    const hub = await open(cleanups);
    const calls: ReceiptFrom[] = [];
    wsHubFor(hub.app).onReceipt((from) => calls.push(from));
    const device = pairDevice(hub, { type: 'tablet' });
    const ws = await authAlert(hub, device.token);
    ws.send({ ...RECEIPT, kind: 'seen' });
    ws.send({ ...RECEIPT, step: -5 });
    ws.send({ ...RECEIPT, alert_id: 'A_2' });
    await waitUntil(() => calls.length === 1);
    expect(calls).toHaveLength(1);
    expect(wsHubFor(hub.app).alertSockets()).toEqual([{ deviceId: device.deviceId, deviceType: 'tablet' }]);
    wsHubFor(hub.app).sendToDevices([device.deviceId], { type: 'alert_seen', alert_id: 'A_2' });
    await ws.untilCount(2);
    expect(ws.messages[1]).toEqual({ type: 'alert_seen', alert_id: 'A_2' });
  });

  it('[00 H-1] a second alert-mode auth for the device closes the first 4409 and logs both remote addresses', async () => {
    const hub = await open(cleanups);
    const device = pairDevice(hub, { type: 'tablet' });
    const first = await authAlert(hub, device.token, '192.168.10.31');
    const second = await authAlert(hub, device.token, '192.168.10.32');
    expect((await first.untilClose()).code).toBe(4409);
    const line = logLines(hub).find((entry) => entry.old_remote_address !== undefined);
    expect(line).toMatchObject({
      device_id: device.deviceId,
      old_remote_address: '192.168.10.31',
      new_remote_address: '192.168.10.32',
    });
    expect(wsHubFor(hub.app).alertSockets()).toEqual([{ deviceId: device.deviceId, deviceType: 'tablet' }]);
    wsHubFor(hub.app).sendToDevices([device.deviceId], { type: 'alert_seen', alert_id: 'A_9' });
    await second.untilCount(2);
    expect(second.messages[1]).toEqual({ type: 'alert_seen', alert_id: 'A_9' });
    expect(first.messages).toHaveLength(1);
  });

  it('[00 H-1] DeviceRevoked committed closes that device alert socket 4403 with no frame first; other devices stay', async () => {
    const hub = await open(cleanups);
    const target = pairDevice(hub, { type: 'tablet' });
    const bystander = pairDevice(hub, { type: 'cashier_kiosk' });
    const ws = await authAlert(hub, target.token);
    const other = await authAlert(hub, bystander.token);
    hub.deps.writer.run((tx) => {
      revokeDevice(tx, target.deviceId, {
        reason: null,
        cause: 'manual',
        actorId: 'S_MGR',
        eventDeviceId: 'hub-admin',
        revokedBy: 'S_MGR',
      });
    });
    expect((await ws.untilClose()).code).toBe(4403);
    expect(ws.messages).toHaveLength(1);
    expect(wsHubFor(hub.app).alertSockets()).toEqual([{ deviceId: bystander.deviceId, deviceType: 'cashier_kiosk' }]);
    expect(other.messages).toHaveLength(1);
  });

  it('[00 H-1] DeviceTokenRotated committed closes that device alert socket 4401 with no frame first', async () => {
    const hub = await open(cleanups);
    const target = pairDevice(hub, { type: 'phone', ownerStaffId: 'S_MGR' });
    const ws = await authAlert(hub, target.token);
    hub.deps.writer.run((tx) => {
      tx.append([
        {
          stream_type: 'hub',
          stream_id: target.deviceId,
          event_type: 'DeviceTokenRotated',
          schema_version: 1,
          payload: { device_id: target.deviceId, pair_request_id: 'PR_1' },
          occurred_at: hub.clock.branchNow(),
          actor_id: 'S_MGR',
          device_id: target.deviceId,
        },
      ]);
    });
    expect((await ws.untilClose()).code).toBe(4401);
    expect(ws.messages).toHaveLength(1);
    expect(wsHubFor(hub.app).alertSockets()).toEqual([]);
  });

  it('[00 H-1] the alert socket is never in connectedSessions() nor in deliver(), but sendToDevices reaches it', async () => {
    const hub = await open(cleanups);
    await seedDirectory(hub);
    const device = pairDevice(hub, { type: 'tablet' });
    const staff = openSession(hub, { kind: 'staff', staffId: 'S_MGR', deviceId: device.deviceId });
    const alert = await authAlert(hub, device.token);
    const session = await connectWs(hub.app);
    session.send({ type: 'auth', device_token: device.token, session_token: staff.token });
    await session.untilCount(1);
    const wsHub = wsHubFor(hub.app);
    expect(wsHub.connectedSessions()).toEqual([
      { staffId: 'S_MGR', deviceId: device.deviceId, sessionId: staff.sessionId, kind: 'staff' },
    ]);
    const before = hub.published.length;
    hub.deps.writer.run((tx) => {
      tx.append([clockAlarm(10, 20)]);
    });
    expect(hub.published.length).toBe(before + 1);
    await session.untilCount(2);
    expect(alert.messages).toHaveLength(1);

    wsHub.sendToDevices([device.deviceId], { type: 'alert_seen', alert_id: 'A_3' });
    await alert.untilCount(2);
    await session.untilCount(3);
    expect(alert.messages[1]).toEqual({ type: 'alert_seen', alert_id: 'A_3' });
    expect(session.messages[2]).toEqual({ type: 'alert_seen', alert_id: 'A_3' });

    wsHub.sendToStaff(['S_MGR'], { type: 'alert_seen', alert_id: 'A_4' });
    await session.untilCount(4);
    expect(alert.messages).toHaveLength(2);
  });

  it('[00 H-13] a pong on an alert-mode socket refreshes last seen through activity.deviceSeen', async () => {
    const hub = await open(cleanups);
    const device = pairDevice(hub, { type: 'kds', stationId: 'station-1' });
    const ws = await authAlert(hub, device.token);
    hub.clock.advance(5_000);
    expect(activity.deviceSeenAt(device.deviceId)).not.toBe(hub.clock.branchNow());
    ws.raw.pong();
    await waitUntil(() => activity.deviceSeenAt(device.deviceId) === hub.clock.branchNow());
    expect(activity.deviceSeenAt(device.deviceId)).toBe(hub.clock.branchNow());
  });

  it('[00 H-1] a staff-session receipt calls onReceipt with mode session and its staffId', async () => {
    const hub = await open(cleanups);
    await seedDirectory(hub);
    const calls: Array<[ReceiptFrom, WsReceipt]> = [];
    wsHubFor(hub.app).onReceipt((from, msg) => calls.push([from, msg]));
    const device = pairDevice(hub, { type: 'tablet' });
    const staff = openSession(hub, { kind: 'staff', staffId: 'S_MGR', deviceId: device.deviceId });
    const ws = await connectWs(hub.app);
    ws.send({ type: 'auth', device_token: device.token, session_token: staff.token });
    await ws.untilCount(1);
    ws.send(RECEIPT);
    await waitUntil(() => calls.length === 1);
    expect(calls[0]).toEqual([
      { deviceId: device.deviceId, sessionId: staff.sessionId, staffId: 'S_MGR', mode: 'session' },
      RECEIPT,
    ]);
  });

  it('[01d Review Focus 4] a malformed receipt on a staff-session socket is ignored and the socket stays open', async () => {
    const hub = await open(cleanups);
    await seedDirectory(hub);
    const calls: ReceiptFrom[] = [];
    wsHubFor(hub.app).onReceipt((from) => calls.push(from));
    const device = pairDevice(hub, { type: 'tablet' });
    const staff = openSession(hub, { kind: 'staff', staffId: 'S_MGR', deviceId: device.deviceId });
    const ws = await connectWs(hub.app);
    ws.send({ type: 'auth', device_token: device.token, session_token: staff.token });
    await ws.untilCount(1);
    ws.send({ ...RECEIPT, step: -5 });
    ws.send({ ...RECEIPT, kind: 'seen' });
    ws.raw.send('{not json');
    ws.send({ ...RECEIPT, alert_id: 'A_5' });
    await waitUntil(() => calls.length === 1);
    expect(calls).toHaveLength(1);
    hub.deps.writer.run((tx) => {
      tx.append([clockAlarm(10, 20)]);
    });
    await ws.untilCount(2);
    expect(ws.messages[1]).toMatchObject({ type: 'event' });
  });

  it('[00 H-1, §6.21] a throwing alerts_open builder closes only that socket 1011 with one { err, device_id } log line; the hub stays up', async () => {
    const hub = await open(cleanups);
    const bystander = pairDevice(hub, { type: 'cashier_kiosk' });
    const other = await authAlert(hub, bystander.token);
    const broken = pairDevice(hub, { type: 'tablet' });
    wsHubFor(hub.app).setAlertsOpen((deviceId) => {
      if (deviceId === broken.deviceId) throw new Error('alerts_open probe failure');
      return { type: 'alerts_open', alerts: [], binding_route_until: null };
    });
    const ws = await connectWs(hub.app);
    ws.send({ type: 'auth', device_token: broken.token });
    expect((await ws.untilClose()).code).toBe(1011);
    expect(ws.messages).toEqual([]);
    const lines = logLines(hub).filter((entry) => entry.device_id === broken.deviceId && entry.err !== undefined);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ err: { message: 'alerts_open probe failure' } });
    expect(wsHubFor(hub.app).alertSockets()).toEqual([{ deviceId: bystander.deviceId, deviceType: 'cashier_kiosk' }]);
    wsHubFor(hub.app).sendToAlertMode([bystander.deviceId], { type: 'alert_seen', alert_id: 'A_6' });
    await other.untilCount(2);
    expect(other.messages[1]).toEqual({ type: 'alert_seen', alert_id: 'A_6' });
  });

  it('[00 H-1, §6.21] a failing alerts_open builder keeps the device existing alert socket (no 4409)', async () => {
    const hub = await open(cleanups);
    const device = pairDevice(hub, { type: 'tablet' });
    const first = await authAlert(hub, device.token);
    wsHubFor(hub.app).setAlertsOpen(() => {
      throw new Error('alerts_open probe failure');
    });
    const second = await connectWs(hub.app);
    second.send({ type: 'auth', device_token: device.token });
    expect((await second.untilClose()).code).toBe(1011);
    expect(wsHubFor(hub.app).alertSockets()).toEqual([{ deviceId: device.deviceId, deviceType: 'tablet' }]);
    wsHubFor(hub.app).sendToAlertMode([device.deviceId], { type: 'alert_seen', alert_id: 'A_7' });
    await first.untilCount(2);
    expect(first.messages[1]).toEqual({ type: 'alert_seen', alert_id: 'A_7' });
  });

  it('[00 H-1, §6.21; 01d §7] a built alerts_open row with card (or details) closes the socket 1011 and sends nothing; a lock-only row is sent', async () => {
    const hub = await open(cleanups);
    const leaky = pairDevice(hub, { type: 'tablet' });
    const detailed = pairDevice(hub, { type: 'tablet' });
    const clean = pairDevice(hub, { type: 'tablet' });
    wsHubFor(hub.app).setAlertsOpen((deviceId) => {
      if (deviceId === leaky.deviceId) {
        return { type: 'alerts_open', alerts: [{ ...LOCK_ROW, card: CARD }], binding_route_until: null } as unknown as WsAlertsOpen;
      }
      if (deviceId === detailed.deviceId) {
        return {
          type: 'alerts_open',
          alerts: [{ ...LOCK_ROW, details: { amount: 480_000 } }],
          binding_route_until: null,
        } as unknown as WsAlertsOpen;
      }
      return { type: 'alerts_open', alerts: [LOCK_ROW], binding_route_until: null } as WsAlertsOpen;
    });
    for (const device of [leaky, detailed]) {
      const ws = await connectWs(hub.app);
      ws.send({ type: 'auth', device_token: device.token });
      expect((await ws.untilClose()).code).toBe(1011);
      expect(ws.messages).toEqual([]);
      expect(logLines(hub).filter((entry) => entry.device_id === device.deviceId && entry.err !== undefined)).toHaveLength(1);
    }
    expect(hub.logs()).not.toContain('alert.test_alert.card');
    expect(logLeaks(hub.logs(), ['480000'])).toEqual([]);
    const ok = await authAlert(hub, clean.token);
    expect(ok.messages[0]).toEqual({ type: 'alerts_open', alerts: [LOCK_ROW], binding_route_until: null });
    expect(wsHubFor(hub.app).alertSockets()).toEqual([{ deviceId: clean.deviceId, deviceType: 'tablet' }]);
  });

  it('[00 §6.21] a throwing catch-up part closes only that session socket 1011 with one { err, device_id } log line; the hub stays up', async () => {
    const hub = await open(cleanups);
    await seedDirectory(hub);
    const stop = registerCatchUp({
      part: 'probe_throw',
      appliesTo: (ctx) => ctx.staffId === 'S_PROBE',
      build: () => {
        throw new Error('catch-up probe failure');
      },
    });
    try {
      const good = pairDevice(hub, { type: 'tablet' });
      const goodStaff = openSession(hub, { kind: 'staff', staffId: 'S_MGR', deviceId: good.deviceId });
      const healthy = await connectWs(hub.app);
      healthy.send({ type: 'auth', device_token: good.token, session_token: goodStaff.token });
      await healthy.untilCount(1);

      const bad = pairDevice(hub, { type: 'tablet' });
      const badStaff = openSession(hub, { kind: 'staff', staffId: 'S_PROBE', deviceId: bad.deviceId });
      const ws = await connectWs(hub.app);
      ws.send({ type: 'auth', device_token: bad.token, session_token: badStaff.token });
      expect((await ws.untilClose()).code).toBe(1011);
      expect(ws.messages).toEqual([]);
      const lines = logLines(hub).filter((entry) => entry.device_id === bad.deviceId && entry.err !== undefined);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ err: { message: 'catch-up probe failure' } });
      expect(wsHubFor(hub.app).connectedSessions().map((s) => s.deviceId)).toEqual([good.deviceId]);

      hub.deps.writer.run((tx) => {
        tx.append([clockAlarm(10, 20)]);
      });
      await healthy.untilCount(2);
      expect(healthy.messages[1]).toMatchObject({ type: 'event' });
    } finally {
      stop();
    }
  });
});

async function open(cleanups: Array<() => Promise<void>>): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  return hub;
}

async function authAlert(hub: TestHub, token: string, remoteAddress?: string): Promise<WsClient> {
  const ws = await connectWs(hub.app, remoteAddress === undefined ? undefined : { remoteAddress });
  ws.send({ type: 'auth', device_token: token });
  await ws.untilCount(1);
  expect(ws.messages[0]).toMatchObject({ type: 'alerts_open' });
  return ws;
}

function logLines(hub: TestHub): Array<Record<string, unknown>> {
  return hub
    .logs()
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function waitUntil(check: () => boolean, ms = 1_000): Promise<void> {
  for (let waited = 0; waited < ms && !check(); waited += 10) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!check()) throw new Error('condition not met');
}

function clockAlarm(wallMs: number, last: number): EventDraft {
  return {
    stream_type: 'hub',
    stream_id: 'branch-1',
    event_type: 'ClockAlarm',
    schema_version: 1,
    payload: { wall_ms: wallMs, last_recorded_at: last, delta_ms: wallMs - last, source: 'boot' },
    occurred_at: 1_761_000_000_000,
    actor_id: null,
    device_id: 'hub',
  };
}
