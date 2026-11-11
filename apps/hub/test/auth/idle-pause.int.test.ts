import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BranchConfig, DirectoryInput } from '@pos/events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyStaffDirectory } from '../../src/auth/apply-directory';
import { swapDirectory } from '../../src/auth/guards';
import { activity, createSession, idlePause } from '../../src/auth/session-store';
import { sweepOnce } from '../../src/auth/session-sweeper';
import { boot, type BootHandle } from '../../src/lib/boot';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { offlineCloud } from '../helpers/stub-cloud';
import { stubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';

// 00 v1.8 M95 (02b H-1): the paused idle clock. All time moves on the hub test clock; no timing asserts.
const TTL = 300_000; // 5 min
const MIN = 60_000;
const SWEEP = 15_000;
const CAP = 14_400_000; // 4 h, the 01a default of queue_auto_send_max_ms
const HOST = '192.168.10.2:3000';
const PONG_MS = 30_000; // ws/server.ts: no pong for 30 s → the hub terminates the socket (00 §6.17 Q8)

const cleanups: Array<() => Promise<void> | void> = [];

interface Device {
  deviceId: string;
  token: string;
}

interface Session {
  sessionId: string;
  token: string;
}

describe('00 M95 paused idle clock', () => {
  afterEach(async () => {
    vi.useRealTimers();
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    activity.drain();
    activity.drainDevices();
    swapBranchConfig(null);
  });

  it('[00 #152] socket closes, 15 min pass with a 5 min TTL, the device reconnects → the session is still active; 2 min used before the drop → it ends 3 min after reconnect if idle', async () => {
    const hub = await open();
    const { device, session } = waiterOn(hub);
    const ws = await sessionSocket(hub, device, session);
    hub.clock.advance(2 * MIN);
    await drop(hub, ws, device);
    const droppedAt = hub.clock.branchNow();
    expect(idlePause.state(hub.deps.db, device.deviceId)).toEqual({ open_sockets: 0, paused_at: droppedAt, paused_since: droppedAt });

    sweepFor(hub, 15 * MIN);
    expect(endReason(hub, session.sessionId)).toBeNull();

    const again = await sessionSocket(hub, device, session);
    expect(again.messages[0]).toMatchObject({ type: 'catch_up' });
    expect(idlePause.state(hub.deps.db, device.deviceId)).toEqual({ open_sockets: 1, paused_at: null, paused_since: null });
    expect(endReason(hub, session.sessionId)).toBeNull();

    sweepFor(hub, 3 * MIN);
    expect(endReason(hub, session.sessionId)).toBeNull();
    hub.clock.advance(1);
    expect(sweepOnce(hub.deps).ended).toEqual([session.sessionId]);
    expect(endReason(hub, session.sessionId)).toBe('idle_timeout');
  });

  it('[00 §10 #152 terminate] [00 #31 missed pong] a socket that stops answering pings is terminated at PONG_MS → the device is paused at the terminate; 15 min off with a 5 min TTL → still active; on reconnect the shift applies (ends 3 min later if idle)', async () => {
    const hub = await open();
    const { device, session } = waiterOn(hub);
    // The hub's own keepalive timers (setTimeout / setInterval in ws/server.ts armKeepalive) run on vitest's fake timers,
    // so PONG_MS passes without a wall-clock wait; idle time moves only on the hub test clock (03a AD-32: no timing asserts).
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const ws = await connectWs(hub.app);
    cleanups.push(() => ws.close());
    ws.raw._autoPong = false; // the device stops answering pings (a dropped Wi-Fi link): no clean close
    ws.send({ type: 'auth', device_token: device.token, session_token: session.token });
    await ws.untilCount(1);
    expect(ws.messages[0]).toMatchObject({ type: 'catch_up' });
    expect(idlePause.state(hub.deps.db, device.deviceId)).toEqual({ open_sockets: 1, paused_at: null, paused_since: null });

    hub.clock.advance(2 * MIN); // 2 min of the 5 min TTL used before the link drops
    const terminatedAt = hub.clock.branchNow();
    await vi.advanceTimersByTimeAsync(PONG_MS - 1);
    expect(idlePause.state(hub.deps.db, device.deviceId)?.open_sockets).toBe(1); // not yet: pings sent, no pong
    await vi.advanceTimersByTimeAsync(1);
    const closed = await ws.untilClose();
    expect(closed.code).toBe(1006); // terminated by the hub, not a clean close
    vi.useRealTimers();
    await waitUntil(() => idlePause.state(hub.deps.db, device.deviceId)?.open_sockets === 0);
    expect(idlePause.state(hub.deps.db, device.deviceId)).toEqual({ open_sockets: 0, paused_at: terminatedAt, paused_since: terminatedAt });

    sweepFor(hub, 15 * MIN); // idle time does not advance while disconnected
    expect(endReason(hub, session.sessionId)).toBeNull();

    const again = await sessionSocket(hub, device, session);
    expect(again.messages[0]).toMatchObject({ type: 'catch_up' });
    expect(idlePause.state(hub.deps.db, device.deviceId)).toEqual({ open_sockets: 1, paused_at: null, paused_since: null });
    sweepFor(hub, 3 * MIN);
    expect(endReason(hub, session.sessionId)).toBeNull();
    hub.clock.advance(1);
    expect(sweepOnce(hub.deps).ended).toEqual([session.sessionId]);
    expect(endReason(hub, session.sessionId)).toBe('idle_timeout');
  });

  it('[00 #153] a command arriving over HTTP before the socket, then a second drop → paused_at set again, a later replay is accepted', async () => {
    const hub = await open();
    const { device, session } = waiterOn(hub);
    const ws = await sessionSocket(hub, device, session);
    hub.clock.advance(MIN);
    await drop(hub, ws, device);
    const firstDrop = hub.clock.branchNow();

    sweepFor(hub, 10 * MIN);
    const first = await command(hub, device, session, 'cmd-1');
    expect(first.statusCode).toBe(200);
    const contactAt = hub.clock.branchNow();
    // still no socket after the HTTP contact → paused again from now; paused_since unchanged
    expect(idlePause.state(hub.deps.db, device.deviceId)).toEqual({ open_sockets: 0, paused_at: contactAt, paused_since: firstDrop });

    const back = await sessionSocket(hub, device, session);
    expect(back.messages[0]).toMatchObject({ type: 'catch_up' });
    hub.clock.advance(30_000);
    await drop(hub, back, device);
    const secondDrop = hub.clock.branchNow();
    expect(idlePause.state(hub.deps.db, device.deviceId)).toEqual({ open_sockets: 0, paused_at: secondDrop, paused_since: secondDrop });

    sweepFor(hub, 10 * MIN);
    expect(endReason(hub, session.sessionId)).toBeNull();
    const replay = await command(hub, device, session, 'cmd-1');
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    const queued = await command(hub, device, session, 'cmd-2');
    expect(queued.statusCode).toBe(200);
    expect(endReason(hub, session.sessionId)).toBeNull();
  });

  it('[00 #154] hub down 60 s across the TTL → paused from hub_down_at, the next command is accepted', async () => {
    const hub = await open();
    const { device, session } = waiterOn(hub);
    const ws = await sessionSocket(hub, device, session);
    hub.clock.advance(4 * MIN + 30_000);
    const hubDownAt = hub.clock.branchNow();
    await drop(hub, ws, device);
    restartPause(hub, hubDownAt);
    hub.clock.advance(MIN); // 5 min 30 s since the last activity: across the TTL
    expect(idlePause.state(hub.deps.db, device.deviceId)).toEqual({ open_sockets: 0, paused_at: hubDownAt, paused_since: hubDownAt });

    const res = await command(hub, device, session, 'cmd-after-restart');
    expect(res.statusCode).toBe(200);
    expect(endReason(hub, session.sessionId)).toBeNull();
  });

  it('[00 #154] a crash mid-outage does not count the time before the crash (sweeper flush of paused devices)', async () => {
    const hub = await open();
    const { device, session } = waiterOn(hub);
    const startedAt = hub.clock.branchNow();
    const ws = await sessionSocket(hub, device, session);
    hub.clock.advance(2 * MIN);
    await drop(hub, ws, device);

    sweepFor(hub, 10 * MIN); // the 15 s flush (M5) writes the shifted last_activity_at of the paused device
    expect(storedLastActivity(hub, session.sessionId)).toBe(startedAt + 10 * MIN);

    hub.clock.advance(10_000); // crash 10 s after the last flush; the in-memory state is lost
    const hubDownAt = hub.clock.branchNow();
    restartPause(hub, hubDownAt);
    hub.clock.advance(MIN);

    const res = await command(hub, device, session, 'cmd-after-crash');
    expect(res.statusCode).toBe(200);
    expect(endReason(hub, session.sessionId)).toBeNull();
  });

  it('[00 #155] M95 cap: device off 5 h with the sweeper running → session ended idle_timeout at 4 h', async () => {
    const hub = await open();
    const { device, session } = waiterOn(hub);
    const ws = await sessionSocket(hub, device, session);
    await drop(hub, ws, device);

    sweepFor(hub, CAP, MIN);
    expect(endReason(hub, session.sessionId)).toBeNull();
    hub.clock.advance(1);
    expect(sweepOnce(hub.deps).ended).toEqual([session.sessionId]);
    expect(endReason(hub, session.sessionId)).toBe('idle_timeout');
    sweepFor(hub, MIN * 60, MIN);

    // an ended session is never accepted again (M19, M39, M59 unchanged)
    const late = await command(hub, device, session, 'cmd-late');
    expect(late.statusCode).toBe(401);
    expect(late.json().error.code).toBe('SESSION_EXPIRED');
    const socket = await connectWs(hub.app);
    cleanups.push(() => socket.close());
    socket.send({ type: 'auth', device_token: device.token, session_token: session.token });
    expect((await socket.untilClose()).code).toBe(4401);
  });

  it('[00 #155] M95 cap: HTTP-only contacts every 10 min for 5 h → still ended at 4 h (paused_since)', async () => {
    const hub = await open();
    const { device, session } = waiterOn(hub);
    const ws = await sessionSocket(hub, device, session);
    await drop(hub, ws, device);
    const pausedSince = hub.clock.branchNow();

    for (let i = 1; i <= 24; i += 1) {
      sweepFor(hub, 10 * MIN, MIN);
      const res = await command(hub, device, session, `cmd-${i}`);
      expect(res.statusCode).toBe(200);
    }
    expect(hub.clock.branchNow()).toBe(pausedSince + CAP);
    expect(idlePause.state(hub.deps.db, device.deviceId)?.paused_since).toBe(pausedSince);
    expect(sweepOnce(hub.deps).ended).toEqual([]);
    hub.clock.advance(1);
    expect(sweepOnce(hub.deps).ended).toEqual([session.sessionId]);
    expect(endReason(hub, session.sessionId)).toBe('idle_timeout');

    sweepFor(hub, 10 * MIN, MIN);
    const late = await command(hub, device, session, 'cmd-25');
    expect(late.statusCode).toBe(401);
    expect(late.json().error.code).toBe('SESSION_EXPIRED');
  });

  it('[00 M95] the cap is the branch setting engine_settings.queue_auto_send_max_ms', async () => {
    const hub = await open();
    const { device, session } = waiterOn(hub);
    const ws = await sessionSocket(hub, device, session);
    await drop(hub, ws, device);
    swapBranchConfig({
      config: { engine_settings: { queue_auto_send_max_ms: 3_600_000 } } as unknown as BranchConfig,
      snapshotHash: 'h',
      configVersion: 1,
      snapshotSchemaVersion: 4,
      appliedAt: 0,
    });
    sweepFor(hub, 3_600_000, MIN);
    expect(endReason(hub, session.sessionId)).toBeNull();
    hub.clock.advance(1);
    expect(sweepOnce(hub.deps).ended).toEqual([session.sessionId]);
  });

  it('[00 #156] M95: an open alert-mode socket keeps the device unpaused', async () => {
    const hub = await open();
    const { device, session } = waiterOn(hub);
    const ws = await sessionSocket(hub, device, session);
    const alert = await connectWs(hub.app);
    cleanups.push(() => alert.close());
    alert.send({ type: 'auth', device_token: device.token });
    await alert.untilCount(1);
    expect(alert.messages[0]).toMatchObject({ type: 'alerts_open' });
    expect(idlePause.state(hub.deps.db, device.deviceId)).toEqual({ open_sockets: 2, paused_at: null, paused_since: null });

    ws.close();
    await waitUntil(() => idlePause.state(hub.deps.db, device.deviceId)?.open_sockets === 1);
    expect(idlePause.state(hub.deps.db, device.deviceId)).toEqual({ open_sockets: 1, paused_at: null, paused_since: null });

    sweepFor(hub, TTL);
    expect(endReason(hub, session.sessionId)).toBeNull();
    hub.clock.advance(1);
    expect(sweepOnce(hub.deps).ended).toEqual([session.sessionId]);
  });

  it('[00 #156] M95: a connected socket that only pongs still idles out (M59)', async () => {
    const hub = await open();
    const { device, session } = waiterOn(hub);
    const ws = await sessionSocket(hub, device, session);
    for (let elapsed = 0; elapsed < TTL; elapsed += SWEEP) {
      hub.clock.advance(SWEEP);
      const at = hub.clock.branchNow();
      ws.raw.pong();
      await waitUntil(() => activity.deviceSeenAt(device.deviceId) === at);
      expect(sweepOnce(hub.deps).ended).toEqual([]);
    }
    hub.clock.advance(1);
    expect(sweepOnce(hub.deps).ended).toEqual([session.sessionId]);
    expect(endReason(hub, session.sessionId)).toBe('idle_timeout');
  });

  it('[00 M95] restart during a paused outage keeps paused_since from before the restart', async () => {
    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    const wall = { now: 1_761_000_000_000 };
    const mono = { now: 0 };
    const start = (): Promise<BootHandle> =>
      boot({ configPath: cfg.path, wallNow: () => wall.now, monoNow: () => mono.now, configClient: stubConfigCloud(), cloudClient: offlineCloud() });

    // boot 1: seed the directory, a tablet and a waiter session (no socket ever opens)
    const first = await start();
    await seedOn(first);
    const device = pairDevice(asHub(first), { type: 'tablet' });
    const session = first.deps.writer.run((tx) =>
      createSession(tx, { kind: 'staff', staffId: 'S_CASH', stationId: null, deviceId: device.deviceId, idleTtlMs: TTL, eventDeviceId: device.deviceId }),
    ).result;
    await first.stop();

    // boot 2: no heartbeat yet (first boot of this hub_heartbeat row) → paused at boot time
    wall.now += MIN;
    const second = await start();
    const bootTwo = second.deps.clock.branchNow();
    expect(hubStarted(second).hub_down_at).toBeNull();
    expect(idlePause.state(second.deps.db, device.deviceId)).toEqual({ open_sockets: 0, paused_at: bootTwo, paused_since: bootTwo });
    // the hub's last heartbeat 60 s later, then the hub goes down for 3 h
    const hubDownAt = bootTwo + MIN;
    second.deps.db.prepare('INSERT INTO hub_heartbeat (branch_id, last_beat) VALUES (?, ?)').run('branch-1', hubDownAt);
    await second.stop();

    // boot 3: paused from HubStarted.hub_down_at; paused_since is the pre-restart hub_down_at, not boot time
    wall.now = hubDownAt + 3 * 3_600_000;
    const third = await start();
    cleanups.push(() => third.stop());
    expect(hubStarted(third).hub_down_at).toBe(hubDownAt);
    expect(idlePause.state(third.deps.db, device.deviceId)).toEqual({ open_sockets: 0, paused_at: hubDownAt, paused_since: hubDownAt });

    const query = await third.app.inject({
      method: 'GET',
      url: '/queries/session',
      headers: { host: HOST, authorization: `Bearer ${device.token}`, 'x-session-token': session.token },
    });
    expect(query.statusCode).toBe(200);
    expect(idlePause.state(third.deps.db, device.deviceId)?.paused_since).toBe(hubDownAt);

    // the cap counts from paused_since (hub_down_at), not from boot
    mono.now += hubDownAt + CAP - third.deps.clock.branchNow();
    expect(third.deps.clock.branchNow()).toBe(hubDownAt + CAP);
    expect(sweepOnce(third.deps).ended).toEqual([]);
    mono.now += 1;
    expect(sweepOnce(third.deps).ended).toEqual([session.sessionId]);
  });
});

async function open(): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  await seedDirectory(hub, await fiveMinuteDirectory());
  return hub;
}

async function fiveMinuteDirectory(): Promise<DirectoryInput> {
  const directory = await aDirectory();
  for (const role of directory.roles) role.session_idle_ttl_ms = TTL;
  return directory;
}

function waiterOn(hub: TestHub): { device: Device; session: Session } {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: device.deviceId });
  return { device, session };
}

async function sessionSocket(hub: TestHub, device: Device, session: Session): Promise<WsClient> {
  const ws = await connectWs(hub.app);
  cleanups.push(() => ws.close());
  ws.send({ type: 'auth', device_token: device.token, session_token: session.token });
  await ws.untilCount(1);
  return ws;
}

async function drop(hub: TestHub, ws: WsClient, device: Device): Promise<void> {
  ws.close();
  await waitUntil(() => idlePause.state(hub.deps.db, device.deviceId)?.open_sockets === 0);
}

// What boot does after a restart (in-memory state lost): unflushed touches are gone, every device is paused at hub_down_at.
function restartPause(hub: TestHub, hubDownAt: number): void {
  activity.drain();
  idlePause.boot(hub.deps.db, hubDownAt);
}

function sweepFor(hub: TestHub, ms: number, step = SWEEP): void {
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    hub.clock.advance(Math.min(step, ms - elapsed));
    expect(sweepOnce(hub.deps).ended).toEqual([]);
  }
}

function command(hub: TestHub, device: Device, session: Session, commandId: string) {
  return hub.app.inject({
    method: 'POST',
    url: '/commands/test-noop',
    headers: { authorization: `Bearer ${device.token}`, 'x-session-token': session.token },
    payload: {
      command_id: commandId,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'TestNoop',
      payload: {},
      occurred_at: hub.clock.branchNow(),
      actor_id: 'S_CASH',
      device_id: device.deviceId,
    },
  });
}

function endReason(hub: TestHub, sessionId: string): string | null {
  return (hub.deps.db.prepare('SELECT end_reason FROM staff_sessions WHERE session_id = ?').get(sessionId) as { end_reason: string | null })
    .end_reason;
}

function storedLastActivity(hub: TestHub, sessionId: string): number {
  return (
    hub.deps.db.prepare('SELECT last_activity_at FROM staff_sessions WHERE session_id = ?').get(sessionId) as { last_activity_at: number }
  ).last_activity_at;
}

async function waitUntil(check: () => boolean, ms = 1_000): Promise<void> {
  for (let waited = 0; waited < ms && !check(); waited += 10) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!check()) throw new Error('condition not met');
}

function asHub(booted: BootHandle): TestHub {
  return { app: booted.app, deps: booted.deps, clock: booted.deps.clock } as unknown as TestHub;
}

async function seedOn(booted: BootHandle): Promise<void> {
  const input = await fiveMinuteDirectory();
  booted.deps.writer.run((tx) => {
    applyStaffDirectory(tx, input, (next) => {
      swapDirectory(booted.app, next);
    });
  });
}

function hubStarted(booted: BootHandle): { hub_down_at: number | null } {
  const row = booted.deps.db
    .prepare(`SELECT payload FROM events WHERE event_type = 'HubStarted' ORDER BY seq DESC LIMIT 1`)
    .get() as { payload: string };
  return JSON.parse(row.payload) as { hub_down_at: number | null };
}

function writeConfig(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pos-idle-pause-'));
  const dataDir = join(dir, 'data');
  const backupDir = join(dir, 'backup');
  mkdirSync(dataDir);
  mkdirSync(backupDir);
  const path = join(dir, 'config.json');
  writeFileSync(
    path,
    JSON.stringify({
      cloud_base_url: 'https://cloud.example',
      http_port: 3000,
      data_dir: dataDir,
      backup_dir: backupDir,
      min_client_version: '1.0.0',
      backup_encryption_key: Buffer.alloc(32, 7).toString('base64'),
      advertised_host: '192.168.10.2',
      provisioned: { tenant_id: 'tenant-a', branch_id: 'branch-1', branch_name: 'Main', branch_api_key: 'test-branch-api-key' },
    }),
  );
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
