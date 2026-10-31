import type { BranchConfig } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs } from '../helpers/ws-client';

const HASH = 'b'.repeat(64);
const cleanups: Array<() => Promise<void> | void> = [];

describe('GET /queries/branch-config (§6.23)', () => {
  const zone = process.env.TZ;
  afterEach(async () => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[01a §10 #92] staff and station sessions get the current snapshot, hash and version with 0 statements; before the first apply data is null; no session → 401', async () => {
    const hub = await open();
    const staff = staffOn(hub);
    const before = await get(hub, staff);
    expect(before.statusCode).toBe(200);
    expect(before.json()).toEqual({ data: null });

    const config = aBranchConfig({ config_version: 9 });
    withConfig(config);
    const station = stationOn(hub);
    const counter = statementCounter(hub.deps.readDb);
    for (const who of [staff, station]) {
      const res = await get(hub, who);
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual({
        config_version: 9,
        snapshot_hash: HASH,
        snapshot: config,
        hub_time: { now_ms: hub.clock.branchNow(), utc_offset_ms: offset(hub.clock.branchNow()) },
      });
    }
    expect(counter.count).toBe(0);

    const anonymous = await hub.app.inject({
      method: 'GET',
      url: '/queries/branch-config',
      headers: { authorization: `Bearer ${staff.deviceToken}` },
    });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().error.code).toBe('SESSION_INVALID');
  });

  it('[01a §10 #151] hub_time in the catch-up branch_config part and GET /queries/branch-config: fake clock at T, TZ Asia/Karachi → utc_offset_ms 18 000 000; before the first config the catch-up part is null', async () => {
    process.env.TZ = 'Asia/Karachi';
    const hub = await open();
    const t = Date.UTC(2026, 9, 25, 7, 30);
    hub.clock.set(t);
    const staff = staffOn(hub);
    expect((await catchUp(hub, staff)).branch_config).toBeNull();

    withConfig(aBranchConfig());
    const expected = { now_ms: t, utc_offset_ms: 18_000_000 };
    expect(((await catchUp(hub, staff)).branch_config as { hub_time: unknown }).hub_time).toEqual(expected);
    expect((await get(hub, staff)).json().data.hub_time).toEqual(expected);
  });
});

function offset(ms: number): number {
  return 0 - new Date(ms).getTimezoneOffset() * 60_000;
}

async function open(): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  await seedDirectory(hub, await aDirectory());
  return hub;
}

function withConfig(config: BranchConfig): void {
  swapBranchConfig({ config, snapshotHash: HASH, configVersion: config.config_version, snapshotSchemaVersion: 2, appliedAt: 0 });
}

type Who = { deviceToken: string; sessionToken: string };

function staffOn(hub: TestHub): Who {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: device.deviceId });
  return { deviceToken: device.token, sessionToken: session.token };
}

function stationOn(hub: TestHub): Who {
  const device = pairDevice(hub, { type: 'kds', stationId: 'S1' });
  const session = openSession(hub, { kind: 'station', deviceId: device.deviceId, stationId: 'S1' });
  return { deviceToken: device.token, sessionToken: session.token };
}

function get(hub: TestHub, who: Who) {
  return hub.app.inject({
    method: 'GET',
    url: '/queries/branch-config',
    headers: { authorization: `Bearer ${who.deviceToken}`, 'x-session-token': who.sessionToken },
  });
}

async function catchUp(hub: TestHub, who: Who): Promise<Record<string, unknown>> {
  const ws = await connectWs(hub.app);
  cleanups.push(() => ws.close());
  ws.send({ type: 'auth', device_token: who.deviceToken, session_token: who.sessionToken });
  await ws.untilCount(1);
  return (ws.messages[0] as { state: Record<string, unknown> }).state;
}
