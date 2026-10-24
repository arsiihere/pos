import type { EventDraft } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { registerCatchUp } from '../../src/ws/catch-up';
import { createTestHub, endSessionNow, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs } from '../helpers/ws-client';

const GUEST = '192.168.20.7';

describe('websocket auth', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #48] no frame of any kind before auth: wait 5.1s, zero frames, close 4401', async () => {
    const hub = await open(cleanups);
    const ws = await connect(hub);
    const closed = await ws.untilClose(8_000);
    expect(ws.messages).toEqual([]);
    expect(closed.code).toBe(4401);
  }, 12_000);

  it('[00 §10 #49] a non-auth frame, a bad device, a bad session and an admin session close 4401 with zero frames; a revoked device closes 4403', async () => {
    const hub = await open(cleanups);
    await seedDirectory(hub);
    const device = pairDevice(hub, { type: 'tablet' });
    const ended = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: device.deviceId });
    endSessionNow(hub, ended.sessionId);
    const staff = openSession(hub, { kind: 'staff', staffId: 'S_MGR', deviceId: device.deviceId });
    const other = pairDevice(hub, { type: 'tablet' });
    const admin = openSession(hub, { kind: 'admin', staffId: 'S_MGR', deviceId: device.deviceId });
    const revoked = pairDevice(hub, { type: 'tablet' });
    hub.deps.db.prepare('UPDATE devices SET revoked_at = ? WHERE device_id = ?').run(hub.clock.branchNow(), revoked.deviceId);

    const notAuth = await connect(hub);
    notAuth.send({ type: 'ack', last_seq: 1 });
    expect((await notAuth.untilClose()).code).toBe(4401);
    expect(notAuth.messages).toEqual([]);

    const badDevice = await connect(hub);
    badDevice.send({ type: 'auth', device_token: 'missing', session_token: staff.token });
    expect((await badDevice.untilClose()).code).toBe(4401);
    expect(badDevice.messages).toEqual([]);

    const badSession = await connect(hub);
    badSession.send({ type: 'auth', device_token: device.token, session_token: 'missing' });
    expect((await badSession.untilClose()).code).toBe(4401);
    expect(badSession.messages).toEqual([]);

    const otherDevice = await connect(hub);
    otherDevice.send({ type: 'auth', device_token: other.token, session_token: staff.token });
    expect((await otherDevice.untilClose()).code).toBe(4401);
    expect(otherDevice.messages).toEqual([]);

    const endedSession = await connect(hub);
    endedSession.send({ type: 'auth', device_token: device.token, session_token: ended.token });
    expect((await endedSession.untilClose()).code).toBe(4401);
    expect(endedSession.messages).toEqual([]);

    const adminSession = await connect(hub);
    adminSession.send({ type: 'auth', device_token: device.token, session_token: admin.token });
    expect((await adminSession.untilClose()).code).toBe(4401);
    expect(adminSession.messages).toEqual([]);

    const revokedDevice = await connect(hub);
    revokedDevice.send({ type: 'auth', device_token: revoked.token, session_token: staff.token });
    expect((await revokedDevice.untilClose()).code).toBe(4403);
    expect(revokedDevice.messages).toEqual([]);
  });

  it('[00 §10 #50] tokens in the query string are ignored and the auth frame is still required', async () => {
    const hub = await open(cleanups);
    await seedDirectory(hub);
    const device = pairDevice(hub, { type: 'tablet' });
    const staff = openSession(hub, { kind: 'staff', staffId: 'S_MGR', deviceId: device.deviceId });
    const path = `/ws?device_token=${device.token}&session_token=${staff.token}`;

    const queryOnly = await connect(hub, { path });
    queryOnly.send({ type: 'ack', last_seq: 0 });
    expect((await queryOnly.untilClose()).code).toBe(4401);
    expect(queryOnly.messages).toEqual([]);
    expect(hub.logs()).not.toContain(device.token);
    expect(hub.logs()).not.toContain(staff.token);

    const framed = await connect(hub, { path: '/ws?device_token=query&session_token=query' });
    framed.send({ type: 'auth', device_token: device.token, session_token: staff.token });
    await framed.untilCount(1);
    expect(framed.messages[0]).toMatchObject({ type: 'catch_up' });
  });

  it('[00 §10 #51] catch-up as_of_seq then events strictly ascending; a boot ClockAlarm sets hub.clock_alarm', async () => {
    const hub = await open(cleanups);
    await seedDirectory(hub);
    registerCatchUp({
      part: 'probe',
      appliesTo: (ctx) => ctx.staffId === 'S_PROBE',
      build: () => ({ open: true }),
    });
    const device = pairDevice(hub, { type: 'tablet' });
    const staff = openSession(hub, { kind: 'staff', staffId: 'S_PROBE', deviceId: device.deviceId });
    hub.deps.writer.run((tx) => {
      tx.append([clockAlarm(10, 20)]);
    });
    const asOf = hub.deps.writer.lastSeq();

    const ws = await connect(hub);
    ws.send({ type: 'auth', device_token: device.token, session_token: staff.token });
    await ws.untilCount(1);
    expect(ws.messages[0]).toMatchObject({
      type: 'catch_up',
      as_of_seq: asOf,
      state: { hub: { clock_alarm: { wall_ms: 10, last_recorded_at: 20 }, branch_name: '' }, probe: { open: true } },
    });

    hub.deps.writer.run((tx) => {
      tx.append([clockAlarm(11, 21), clockAlarm(12, 22)]);
    });
    await ws.untilCount(3);
    const events = ws.messages.slice(1);
    expect(events.map((message) => (message as { type: string }).type)).toEqual(['event', 'event']);
    const seqs = events.map((message) => (message as { seq: number }).seq);
    expect(seqs[0]).toBeGreaterThan(asOf);
    expect(seqs[1]).toBeGreaterThan(seqs[0]!);

    const kds = pairDevice(hub, { type: 'kds', stationId: 'station-1' });
    const station = openSession(hub, { kind: 'station', deviceId: kds.deviceId, stationId: 'station-1' });
    const stationWs = await connect(hub);
    stationWs.send({ type: 'auth', device_token: kds.token, session_token: station.token });
    await stationWs.untilCount(1);
    expect(stationWs.messages[0]).toMatchObject({ type: 'catch_up', state: { hub: { clock_alarm: { wall_ms: 12, last_recorded_at: 22 } } } });
    expect((stationWs.messages[0] as { state: { probe?: unknown } }).state.probe).toBeUndefined();
  });

  it('[00 §10 #119] guest network is forbidden on admin auth, admin devices, pairing requests, and the socket closes 4403 before auth', async () => {
    const hub = await open(cleanups);
    for (const target of [
      { method: 'POST' as const, url: '/admin/auth' },
      { method: 'GET' as const, url: '/admin/queries/devices' },
      { method: 'POST' as const, url: '/pair/requests' },
    ]) {
      const guest = await hub.app.inject({ ...target, remoteAddress: GUEST, payload: {} });
      expect(guest.statusCode).toBe(403);
      expect(guest.json().error.code).toBe('GUEST_NETWORK_FORBIDDEN');
    }
    const ws = await connect(hub, { remoteAddress: GUEST });
    const closed = await ws.untilClose();
    expect(closed.code).toBe(4403);
    expect(ws.messages).toEqual([]);
  });

  it('[00 §3.1 M45] WS upgrade with a bad Host closes 4403', async () => {
    const hub = await open(cleanups);
    const ws = await connect(hub, { headers: { host: 'evil.example:3000' } });
    const closed = await ws.untilClose();
    expect(closed.code).toBe(4403);
    expect(ws.messages).toEqual([]);
  });
});

async function open(cleanups: Array<() => Promise<void>>): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  return hub;
}

async function connect(hub: TestHub, o?: { path?: string; headers?: Record<string, string>; remoteAddress?: string }) {
  const ws = await connectWs(hub.app, o);
  return ws;
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
