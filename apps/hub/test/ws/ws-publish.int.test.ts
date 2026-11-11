import type { DirectoryInput, EventDraft } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { applyStaffDirectory } from '../../src/auth/apply-directory';
import { swapDirectory } from '../../src/auth/guards';
import { activity } from '../../src/auth/session-store';
import { registerEventAudience } from '../../src/ws/audience';
import { registerCatchUp, type SocketCtx } from '../../src/ws/catch-up';
import { wsHubFor } from '../../src/ws/server';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, endSessionNow, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { statementCounter } from '../helpers/statement-counter';
import { connectWs, type WsClient } from '../helpers/ws-client';

describe('websocket publish', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #52] SessionEnded is delivered then the socket closes 4401; a socket with no pong is terminated at 30s; pongs do not keep the session past its TTL', async () => {
    const hub = await open(cleanups);
    await seedDirectory(hub);
    const device = pairDevice(hub, { type: 'tablet' });
    const staff = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: device.deviceId });
    const ended = await connect(hub);
    ended.send({ type: 'auth', device_token: device.token, session_token: staff.token });
    await ended.untilCount(1);

    const quietDevice = pairDevice(hub, { type: 'tablet' });
    const quietSession = openSession(hub, { kind: 'staff', staffId: 'S_MGR', deviceId: quietDevice.deviceId });
    const quiet = await connect(hub);
    quiet.raw._autoPong = false;
    quiet.send({ type: 'auth', device_token: quietDevice.token, session_token: quietSession.token });
    await quiet.untilCount(1);

    const liveDevice = pairDevice(hub, { type: 'tablet' });
    const live = openSession(hub, { kind: 'staff', staffId: 'S_WAIT', deviceId: liveDevice.deviceId });
    const before = activityOf(hub, live.sessionId);
    const ponged = await connect(hub);
    let pings = 0;
    ponged.raw.on('ping', () => {
      pings += 1;
    });
    ponged.send({ type: 'auth', device_token: liveDevice.token, session_token: live.token });
    await ponged.untilCount(1);

    endSessionNow(hub, staff.sessionId, 'logout');
    await ended.untilCount(2);
    const closed = await ended.untilClose();
    expect(eventPayload(ended.messages.at(-1))).toMatchObject({ session_id: staff.sessionId, reason: 'logout' });
    expect(closed.code).toBe(4401);
    expect(closed.reason).toBe('logout');

    await Promise.all([
      (async () => {
        const terminated = await quiet.untilClose(35_000);
        expect(terminated.code).toBe(1006);
        expect(quiet.messages.filter(isEvent)).toEqual([]);
      })(),
      (async () => {
        await waitUntil(() => pings >= 1, 20_000);
        expect(activityOf(hub, live.sessionId)).toEqual(before);
        hub.clock.advance(300_001);
        const query = await hub.app.inject({
          method: 'GET',
          url: '/queries/session',
          headers: { authorization: `Bearer ${liveDevice.token}`, 'x-session-token': live.token },
        });
        expect(query.statusCode).toBe(401);
        expect(query.json().error.code).toBe('SESSION_EXPIRED');
      })(),
    ]);
  }, 45_000);

  it("[00 §10 #104] a second station login delivers SessionEnded replaced and closes 4401 with reason 'replaced'", async () => {
    const hub = await open(cleanups);
    const kds = pairDevice(hub, { type: 'kds', stationId: 'station-1' });
    const first = await station(hub, kds.token);
    const ws = await connect(hub);
    ws.send({ type: 'auth', device_token: kds.token, session_token: first.session_token });
    await ws.untilCount(1);
    const second = await station(hub, kds.token);
    expect(second.statusCode).toBe(200);
    await ws.untilCount(2);
    const closed = await ws.untilClose();
    expect(eventPayload(ws.messages.at(-1))).toMatchObject({ session_id: first.session_id, reason: 'replaced' });
    expect(closed).toEqual({ code: 4401, reason: 'replaced' });
  });

  it('[00 §10 #112] a socket registered between COMMIT and publish receives the event once, in catch-up', async () => {
    const stopAudience = registerEventAudience('HubStarted', () => true);
    let sendAuth: () => void = () => undefined;
    const hub = await createTestHub({
      testHooks: {
        beforePublish() {
          sendAuth();
        },
      },
    });
    cleanups.push(() => hub.close());
    await seedDirectory(hub);
    const device = pairDevice(hub, { type: 'tablet' });
    const staff = openSession(hub, { kind: 'staff', staffId: 'S_MGR', deviceId: device.deviceId });
    const ws = await connect(hub);
    sendAuth = () => {
      ws.send({ type: 'auth', device_token: device.token, session_token: staff.token });
    };
    let appendedSeq: number | undefined;
    try {
      const { appended } = hub.deps.writer.run((tx) => {
        tx.append([hubStarted()]);
      });
      appendedSeq = appended[0]?.seq;
      await ws.untilCount(1);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(ws.messages).toEqual([
        expect.objectContaining({ type: 'catch_up', as_of_seq: appendedSeq }),
      ]);
    } finally {
      stopAudience();
    }
    hub.deps.writer.run((tx) => {
      tx.append([hubStarted()]);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ws.messages).toEqual([
      expect.objectContaining({ type: 'catch_up', as_of_seq: appendedSeq }),
    ]);
  });

  it('[00 §4.2] DeviceRevoked for manual and owner_removed is delivered then the socket closes 4403', async () => {
    const hub = await open(cleanups);
    const directory = await aDirectory();
    await seedDirectory(hub, directory);
    const adminDevice = pairDevice(hub, { type: 'tablet' });
    const admin = openSession(hub, { kind: 'admin', staffId: 'S_OWNER', deviceId: adminDevice.deviceId });
    const target = pairDevice(hub, { type: 'tablet' });
    const staff = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: target.deviceId });
    const manual = await connect(hub);
    manual.send({ type: 'auth', device_token: target.token, session_token: staff.token });
    await manual.untilCount(1);

    const phone = pairDevice(hub, { type: 'phone', ownerStaffId: 'S_OWNER' });
    const owner = openSession(hub, { kind: 'staff', staffId: 'S_OWNER', deviceId: phone.deviceId });
    const owned = await connect(hub);
    owned.send({ type: 'auth', device_token: phone.token, session_token: owner.token });
    await owned.untilCount(1);

    const revoked = await hub.app.inject({
      method: 'POST',
      url: '/admin/commands/revoke-device',
      headers: { authorization: `Bearer ${adminDevice.token}`, 'x-admin-session': admin.token },
      payload: {
        command_id: 'cmd-revoke-ws',
        tenant_id: 'tenant-a',
        branch_id: 'branch-1',
        command_type: 'RevokeDevice',
        payload: { device_id: target.deviceId, reason: 'lost' },
        occurred_at: hub.clock.branchNow(),
        actor_id: 'S_OWNER',
        device_id: adminDevice.deviceId,
      },
    });
    expect(revoked.statusCode).toBe(200);
    await manual.untilClose();
    expect(manual.messages.some((message) => eventOf(message, 'DeviceRevoked')?.cause === 'manual')).toBe(true);
    expect((await settled(manual)).code).toBe(4403);

    const next: DirectoryInput = {
      ...directory,
      directory_version: directory.directory_version + 1,
      staff: directory.staff.filter((row) => row.staff_id !== 'S_OWNER'),
    };
    hub.deps.writer.run((tx) => {
      applyStaffDirectory(tx, next, (dir) => {
        swapDirectory(hub.app, dir);
      });
    });
    await owned.untilClose();
    expect(owned.messages.some((message) => eventOf(message, 'DeviceRevoked')?.cause === 'owner_removed')).toBe(true);
    expect((await settled(owned)).code).toBe(4403);

    const rotating = pairDevice(hub, { type: 'tablet' });
    const rotatingStaff = openSession(hub, { kind: 'staff', staffId: 'S_MGR', deviceId: rotating.deviceId });
    const rotatingWs = await connect(hub);
    rotatingWs.send({ type: 'auth', device_token: rotating.token, session_token: rotatingStaff.token });
    await rotatingWs.untilCount(1);
    const bystander = pairDevice(hub, { type: 'tablet' });
    const bystanderStaff = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: bystander.deviceId });
    const bystanderWs = await connect(hub);
    bystanderWs.send({ type: 'auth', device_token: bystander.token, session_token: bystanderStaff.token });
    await bystanderWs.untilCount(1);

    hub.deps.writer.run((tx) => {
      tx.append([deviceTokenRotated(rotating.deviceId)]);
    });
    await rotatingWs.untilCount(2);
    expect(eventOf(rotatingWs.messages.at(-1), 'DeviceTokenRotated')).toMatchObject({
      device_id: rotating.deviceId,
    });
    expect((await rotatingWs.untilClose()).code).toBe(4401);
    expect(bystanderWs.messages.some((message) => eventOf(message, 'DeviceTokenRotated') !== undefined)).toBe(false);
    expect((bystanderWs.raw as { readyState?: number }).readyState).toBe(1);
  });

  it('[00 H-4, 03b H-9] connectedSessions lists open session sockets with kind and stationId (a station socket lists its stationId) and no statement; sendToStaff reaches only that staff; sendToDevices every socket of the device; a closed socket leaves the list', async () => {
    const hub = await open(cleanups);
    await seedDirectory(hub);
    const tablet = pairDevice(hub, { type: 'tablet' });
    const other = pairDevice(hub, { type: 'tablet' });
    const kds = pairDevice(hub, { type: 'kds', stationId: 'station-1' });
    const cash = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: tablet.deviceId });
    const wait = openSession(hub, { kind: 'staff', staffId: 'S_WAIT', deviceId: other.deviceId });
    const stationLogin = await station(hub, kds.token);
    const cashWs = await connect(hub);
    cashWs.send({ type: 'auth', device_token: tablet.token, session_token: cash.token });
    await cashWs.untilCount(1);
    const waitWs = await connect(hub);
    waitWs.send({ type: 'auth', device_token: other.token, session_token: wait.token });
    await waitWs.untilCount(1);
    const kdsWs = await connect(hub);
    kdsWs.send({ type: 'auth', device_token: kds.token, session_token: stationLogin.session_token });
    await kdsWs.untilCount(1);

    const ws = wsHubFor(hub.app);
    if (ws === undefined) throw new Error('no ws hub');
    const counter = statementCounter(hub.deps.db);
    const readCounter = statementCounter(hub.deps.readDb);
    const sessions = ws.connectedSessions();
    expect(counter.count).toBe(0);
    expect(readCounter.count).toBe(0);
    expect(sessions).toHaveLength(3);
    expect(sessions).toEqual(
      expect.arrayContaining([
        // 03b H-9 (00 v1.9): + stationId, copied from SocketCtx (null on a staff socket).
        { staffId: 'S_CASH', deviceId: tablet.deviceId, sessionId: cash.sessionId, kind: 'staff', stationId: null },
        { staffId: 'S_WAIT', deviceId: other.deviceId, sessionId: wait.sessionId, kind: 'staff', stationId: null },
        { staffId: null, deviceId: kds.deviceId, sessionId: stationLogin.session_id, kind: 'station', stationId: 'station-1' },
      ]),
    );

    const frame = { type: 'alert_seen', alert_id: '01JD0000000000000000000000' } as const;
    ws.sendToStaff(['S_CASH'], frame);
    await cashWs.untilCount(2);
    expect(cashWs.messages.at(-1)).toEqual(frame);
    ws.sendToDevices([kds.deviceId], frame);
    await kdsWs.untilCount(2);
    expect(kdsWs.messages.at(-1)).toEqual(frame);
    ws.sendToDevices([tablet.deviceId], frame);
    await cashWs.untilCount(3);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(waitWs.messages).toHaveLength(1);
    expect(kdsWs.messages).toHaveLength(2);
    expect(cashWs.messages).toHaveLength(3);

    waitWs.close();
    for (let i = 0; i < 50 && ws.connectedSessions().length !== 2; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(ws.connectedSessions().map((s) => s.sessionId).sort()).toEqual([cash.sessionId, stationLogin.session_id].sort());
  });

  it('[01d §6 batch 3] sendToSessions reaches only the sockets of those session ids (staff or station), never another session of the same person or device', async () => {
    const hub = await open(cleanups);
    await seedDirectory(hub);
    const tablet = pairDevice(hub, { type: 'tablet' });
    const other = pairDevice(hub, { type: 'tablet' });
    const kds = pairDevice(hub, { type: 'kds', stationId: 'station-1' });
    const first = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: tablet.deviceId });
    const second = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: other.deviceId });
    const stationLogin = await station(hub, kds.token);
    const firstWs = await connect(hub);
    firstWs.send({ type: 'auth', device_token: tablet.token, session_token: first.token });
    await firstWs.untilCount(1);
    const secondWs = await connect(hub);
    secondWs.send({ type: 'auth', device_token: other.token, session_token: second.token });
    await secondWs.untilCount(1);
    const kdsWs = await connect(hub);
    kdsWs.send({ type: 'auth', device_token: kds.token, session_token: stationLogin.session_token });
    await kdsWs.untilCount(1);

    const ws = wsHubFor(hub.app);
    const counter = statementCounter(hub.deps.db);
    const frame = { type: 'alert_seen', alert_id: '01JD0000000000000000000001' } as const;
    ws.sendToSessions([first.sessionId, stationLogin.session_id, 'missing'], frame);
    await firstWs.untilCount(2);
    await kdsWs.untilCount(2);
    expect(firstWs.messages.at(-1)).toEqual(frame);
    expect(kdsWs.messages.at(-1)).toEqual(frame);
    const fence = { type: 'alert_seen', alert_id: 'FENCE' } as const;
    ws.sendToSessions([second.sessionId], fence);
    await secondWs.untilCount(2);
    expect(secondWs.messages.at(-1)).toEqual(fence);
    expect(counter.count).toBe(0);
  });

  it('[00 H-7] a catch-up part build receives the same socket context as appliesTo', async () => {
    const hub = await open(cleanups);
    await seedDirectory(hub);
    const tablet = pairDevice(hub, { type: 'tablet' });
    const cash = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: tablet.deviceId });
    const seen: { applies?: SocketCtx; build?: SocketCtx } = {};
    const stop = registerCatchUp({
      part: 'h7_probe',
      appliesTo(socket) {
        seen.applies = socket;
        return true;
      },
      build(_db, _state, socket) {
        seen.build = socket;
        return { staff: socket.staffId };
      },
    });
    cleanups.push(async () => stop());
    const ws = await connect(hub);
    ws.send({ type: 'auth', device_token: tablet.token, session_token: cash.token });
    await ws.untilCount(1);
    expect(seen.build).toBeDefined();
    expect(seen.build).toBe(seen.applies);
    expect(seen.build).toMatchObject({ deviceId: tablet.deviceId, sessionId: cash.sessionId, kind: 'staff', staffId: 'S_CASH' });
    expect((ws.messages[0] as { state: Record<string, unknown> }).state.h7_probe).toEqual({ staff: 'S_CASH' });
  });

  it('[00 §6.21] shutdown closes an open socket with 1012', async () => {
    const hub = await open(cleanups);
    await seedDirectory(hub);
    const device = pairDevice(hub, { type: 'tablet' });
    const staff = openSession(hub, { kind: 'staff', staffId: 'S_MGR', deviceId: device.deviceId });
    const ws = await connect(hub);
    ws.send({ type: 'auth', device_token: device.token, session_token: staff.token });
    await ws.untilCount(1);
    const closing = ws.untilClose();
    await hub.close();
    cleanups.pop();
    expect(await closing).toMatchObject({ code: 1012 });
  });
});

function eventPayload(message: unknown): Record<string, unknown> {
  return (message as { event: { payload: Record<string, unknown> } }).event.payload;
}

function eventOf(message: unknown, eventType: string): Record<string, unknown> | undefined {
  const frame = message as { type?: string; event?: { event_type?: string; payload?: Record<string, unknown> } };
  if (frame.type !== 'event' || frame.event?.event_type !== eventType) return undefined;
  return frame.event.payload;
}

function isEvent(message: unknown): boolean {
  return (message as { type?: string }).type === 'event';
}

function activityOf(hub: TestHub, sessionId: string): { at: number; touched: number | undefined } {
  const at = hub.deps.db.prepare('SELECT last_activity_at FROM staff_sessions WHERE session_id = ?').pluck().get(sessionId);
  return { at: Number(at), touched: activity.get(sessionId) };
}

async function settled(ws: WsClient): Promise<{ code: number; reason: string }> {
  return ws.untilClose(1_000);
}

async function waitUntil(ready: () => boolean, ms: number): Promise<void> {
  const steps = Math.ceil(ms / 50);
  for (let i = 0; i < steps; i += 1) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('condition was not met');
}

async function open(cleanups: Array<() => Promise<void>>): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  return hub;
}

async function connect(hub: TestHub): Promise<WsClient> {
  return connectWs(hub.app);
}

function station(hub: TestHub, token: string) {
  return hub.app.inject({
    method: 'POST',
    url: '/auth/station',
    headers: { authorization: `Bearer ${token}` },
  }).then((response) => {
    const body = response.json() as { data?: { session_token: string; session_id: string } };
    return { statusCode: response.statusCode, session_token: body.data?.session_token ?? '', session_id: body.data?.session_id ?? '' };
  });
}

function deviceTokenRotated(deviceId: string): EventDraft {
  return {
    stream_type: 'hub',
    stream_id: deviceId,
    event_type: 'DeviceTokenRotated',
    schema_version: 1,
    payload: { device_id: deviceId, pair_request_id: 'pair-rotate' },
    occurred_at: 1_761_000_000_000,
    actor_id: null,
    device_id: 'hub',
  };
}

function hubStarted(): EventDraft {
  return {
    stream_type: 'hub',
    stream_id: 'branch-1',
    event_type: 'HubStarted',
    schema_version: 1,
    payload: { hub_down_at: null, hub_up_at: 1_761_000_000_000, events_replayed: 0, missed_fires: 0, boot_ms: 1 },
    occurred_at: 1_761_000_000_000,
    actor_id: null,
    device_id: 'hub',
  };
}
