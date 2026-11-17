import type { EventDraft } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { registerCatchUp } from '../../src/ws/catch-up';
import { statementCounter } from '../helpers/statement-counter';
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

  it("[00 v1.11 §10 #166] auth with a session ended by replacement closes 4401 with reason 'replaced'; a session ended another way closes 4401 with no reason", async () => {
    const hub = await open(cleanups);
    await seedDirectory(hub);
    // Q-70: the old KDS window has no socket while a newer window takes the station session over.
    const kds = pairDevice(hub, { type: 'kds', stationId: 'station-1' });
    const first = await station(hub, kds.token);
    const second = await station(hub, kds.token);
    expect(second.statusCode).toBe(200);
    const stale = await connect(hub);
    stale.send({ type: 'auth', device_token: kds.token, session_token: first.session_token });
    expect(await stale.untilClose()).toEqual({ code: 4401, reason: 'replaced' });
    expect(stale.messages).toEqual([]);

    // a staff session ended by replacement too (the rule reads end_reason, not the kind)
    const tablet = pairDevice(hub, { type: 'tablet' });
    const replacedStaff = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: tablet.deviceId });
    endSessionNow(hub, replacedStaff.sessionId, 'replaced');
    const staffWs = await connect(hub);
    staffWs.send({ type: 'auth', device_token: tablet.token, session_token: replacedStaff.token });
    expect(await staffWs.untilClose()).toEqual({ code: 4401, reason: 'replaced' });
    expect(staffWs.messages).toEqual([]);

    // the kind check: an admin session ended `replaced` → no reason
    const replacedAdmin = openSession(hub, { kind: 'admin', staffId: 'S_MGR', deviceId: tablet.deviceId });
    endSessionNow(hub, replacedAdmin.sessionId, 'replaced');
    const adminWs = await connect(hub);
    adminWs.send({ type: 'auth', device_token: tablet.token, session_token: replacedAdmin.token });
    expect(await adminWs.untilClose()).toEqual({ code: 4401, reason: '' });
    expect(adminWs.messages).toEqual([]);

    // a still-active session past its idle limit (M46; not ended yet) → no reason
    const idleTablet = pairDevice(hub, { type: 'tablet' });
    const stale2 = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: idleTablet.deviceId });
    const ttl = hub.deps.db.prepare('SELECT idle_ttl_ms FROM staff_sessions WHERE session_id = ?').pluck().get(stale2.sessionId) as number;
    hub.deps.db
      .prepare('UPDATE staff_sessions SET last_activity_at = ? WHERE session_id = ?')
      .run(hub.clock.branchNow() - ttl - 3_600_000, stale2.sessionId);
    const idleWs = await connect(hub);
    idleWs.send({ type: 'auth', device_token: idleTablet.token, session_token: stale2.token });
    expect(await idleWs.untilClose()).toEqual({ code: 4401, reason: '' });
    expect(idleWs.messages).toEqual([]);
    expect(hub.deps.db.prepare('SELECT ended_at FROM staff_sessions WHERE session_id = ?').pluck().get(stale2.sessionId)).toBeNull();

    // ended another way: logout, forced (station), idle_timeout → no reason
    const loggedOut = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: tablet.deviceId });
    endSessionNow(hub, loggedOut.sessionId, 'logout');
    const idled = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: tablet.deviceId });
    endSessionNow(hub, idled.sessionId, 'idle_timeout');
    const forced = await station(hub, kds.token);
    const forcedId = forced.session_id;
    endSessionNow(hub, forcedId, 'forced');
    for (const [deviceToken, sessionToken] of [
      [tablet.token, loggedOut.token],
      [tablet.token, idled.token],
      [kds.token, forced.session_token],
    ] as const) {
      const ws = await connect(hub);
      ws.send({ type: 'auth', device_token: deviceToken, session_token: sessionToken });
      expect(await ws.untilClose()).toEqual({ code: 4401, reason: '' });
      expect(ws.messages).toEqual([]);
    }

    // a replaced session presented from another device leaks nothing: no reason
    const otherDevice = await connect(hub);
    otherDevice.send({ type: 'auth', device_token: tablet.token, session_token: first.session_token });
    expect(await otherDevice.untilClose()).toEqual({ code: 4401, reason: '' });
    expect(otherDevice.messages).toEqual([]);

    // the reason comes from the one session lookup: a replaced auth runs no more statements than an unknown token,
    // which stops right after that lookup (no second SELECT for end_reason)
    const counter = statementCounter(hub.deps.db);
    const countAuth = async (sessionToken: string): Promise<number> => {
      const ws = await connect(hub);
      counter.reset();
      ws.send({ type: 'auth', device_token: tablet.token, session_token: sessionToken });
      await ws.untilClose();
      return counter.count;
    };
    const unknown = await countAuth('no-such-session');
    expect(await countAuth(replacedStaff.token)).toBe(unknown);
    expect(await countAuth(loggedOut.token)).toBe(unknown);

    // the device check comes first: a revoked device presenting its replaced session closes 4403
    const revokedKds = pairDevice(hub, { type: 'kds', stationId: 'station-1' });
    const revokedFirst = await station(hub, revokedKds.token);
    expect((await station(hub, revokedKds.token)).statusCode).toBe(200);
    hub.deps.db.prepare('UPDATE devices SET revoked_at = ? WHERE device_id = ?').run(hub.clock.branchNow(), revokedKds.deviceId);
    const revoked = await connect(hub);
    revoked.send({ type: 'auth', device_token: revokedKds.token, session_token: revokedFirst.session_token });
    expect((await revoked.untilClose()).code).toBe(4403);
    expect(revoked.messages).toEqual([]);
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
    const stopProbe = registerCatchUp({
      part: 'probe',
      appliesTo: (ctx) => ctx.staffId === 'S_PROBE',
      build: () => ({ open: true }),
    });
    try {
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
        state: { hub: { clock_alarm: { wall_ms: 10, last_recorded_at: 20 }, branch_name: 'Main' }, probe: { open: true } },
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
    } finally {
      stopProbe();
    }

    const later = pairDevice(hub, { type: 'tablet' });
    const laterStaff = openSession(hub, { kind: 'staff', staffId: 'S_PROBE', deviceId: later.deviceId });
    const laterWs = await connect(hub);
    laterWs.send({ type: 'auth', device_token: later.token, session_token: laterStaff.token });
    await laterWs.untilCount(1);
    expect((laterWs.messages[0] as { state: { probe?: unknown } }).state.probe).toBeUndefined();
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

    const old = await connect(hub, { headers: { 'x-client-version': '0.9.0' } });
    const oldClosed = await old.untilClose();
    expect(oldClosed.code).toBe(4426);
    expect(old.messages).toEqual([]);

    await seedDirectory(hub);
    const device = pairDevice(hub, { type: 'tablet' });
    const staff = openSession(hub, { kind: 'staff', staffId: 'S_MGR', deviceId: device.deviceId });
    const current = await connect(hub);
    current.send({ type: 'auth', device_token: device.token, session_token: staff.token });
    await current.untilCount(1);
    expect(current.messages[0]).toMatchObject({ type: 'catch_up' });
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

function station(hub: TestHub, token: string) {
  return hub.app
    .inject({ method: 'POST', url: '/auth/station', headers: { authorization: `Bearer ${token}` } })
    .then((response) => {
      const body = response.json() as { data?: { session_token: string; session_id: string } };
      return { statusCode: response.statusCode, session_token: body.data?.session_token ?? '', session_id: body.data?.session_id ?? '' };
    });
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
